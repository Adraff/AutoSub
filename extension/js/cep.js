/*
 * Puente con el programa anfitrión (sin librerías externas):
 *  - After Effects: window.__adobe_cep__ (panel CEP) ejecuta jsx/host.jsx.
 *  - EffectCraft: el puente local (bridge.js) envía el mismo jsx/host.jsx a EffectCraft con su
 *    comando "script.run" (EffectCraft entiende el modelo de objetos de After Effects). Lo que
 *    EffectCraft hace de otra forma (exportar audio, lista de fuentes) se resuelve con sus comandos.
 */
(function (global) {
  'use strict';

  var hasCEP = typeof global.__adobe_cep__ !== 'undefined';
  var bridge = global.AutoSubBridge || null;

  function toJsxStringLiteral(obj) {
    var json = JSON.stringify(obj === undefined ? null : obj);
    var lit = JSON.stringify(json);
    return lit.replace(/[\u007f-￿]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function parseHostReply(res, fn) {
    var parsed;
    try { parsed = JSON.parse(res); } catch (e) {
      throw new Error('Respuesta no válida del programa (' + fn + '): ' + String(res).slice(0, 200));
    }
    if (parsed && parsed.ok) return parsed.data;
    throw new Error((parsed && parsed.error) || 'Error desconocido.');
  }

  // ================================================================ After Effects (CEP)
  function callAE(fn, args) {
    return new Promise(function (resolve, reject) {
      var script = 'AutoSub.dispatch(' + JSON.stringify(fn) + ',' + toJsxStringLiteral(args || {}) + ')';
      global.__adobe_cep__.evalScript(script, function (res) {
        if (res === 'EvalScript error.' || res === undefined || res === null) {
          reject(new Error('Error al ejecutar el script en After Effects (' + fn + ').'));
          return;
        }
        try { resolve(parseHostReply(res, fn)); } catch (e) { reject(e); }
      });
    });
  }

  // ================================================================ EffectCraft
  var hostSource = null;
  function loadHostSource() {
    if (hostSource) return hostSource;
    var x = new XMLHttpRequest();
    x.open('GET', 'jsx/host.jsx', false);
    x.send();
    hostSource = x.responseText;
    return hostSource;
  }

  /** Ejecuta una función de host.jsx dentro de EffectCraft. */
  function runInEC(fn, args) {
    var code = loadHostSource() + '\nAutoSub.dispatch(' + JSON.stringify(fn) + ',' + JSON.stringify(JSON.stringify(args || {})) + ');';
    return bridge.ec('script.run', { code: code, name: 'AutoSub' }).then(function (r) {
      if (r && r.error) throw new Error('EffectCraft: ' + (r.error.message || r.error));
      return parseHostReply(r.result, fn);
    });
  }

  /** Exporta solo audio (mono 16 kHz) con la cola de render de EffectCraft. */
  function renderAudioEC(args) {
    var plan;
    return runInEC('audioPlan', args).then(function (p) {
      plan = p;
      var out = (args.folder || '').replace(/\//g, '\\') + '\\autosub_' + Date.now() + '.wav';
      plan.path = out;
      return bridge.ec('renderQueue.add', {
        comp: plan.compName, format: 'wav', output: out, timeSpan: 'custom',
        start: plan.start, duration: plan.duration, audio: 'on',
        sampleRate: 16000, audioChannels: 'mono', audioFormat: 16
      });
    }).then(function () {
      return bridge.ec('renderQueue.render', { wait: true });
    }).then(function () {
      return bridge.ec('renderQueue.list', {}).then(function (l) {
        // Quita de la cola el elemento de AutoSub
        var items = (l && l.items) || l || [];
        var mine = items.filter ? items.filter(function (it) { return String(it.outputPath || '').replace(/\//g, '\\') === plan.path; }) : [];
        return Promise.all(mine.map(function (it) { return bridge.ec('renderQueue.remove', { item: it.id }).catch(function () {}); }));
      }).catch(function () {});
    }).then(function () {
      return runInEC('audioRestore', { restore: plan.restore });
    }).then(function () {
      if (!bridge.apiSync('fs', { op: 'exists', path: plan.path })) throw new Error('EffectCraft no generó el audio.');
      return { path: plan.path, offset: plan.start, duration: plan.duration };
    }, function (e) {
      if (plan && plan.restore) runInEC('audioRestore', { restore: plan.restore }).catch(function () {});
      throw e;
    });
  }

  function getFontsEC() {
    return bridge.ec('text.fonts', {}).then(function (r) {
      return {
        supported: true,
        fonts: (r.families || []).map(function (f) {
          // En EffectCraft la fuente se identifica como "Familia|Estilo"
          return { f: f.family, s: (f.styles || []).map(function (st) { return [st, f.family + '|' + st]; }) };
        })
      };
    });
  }

  /** Aplica una fuente "Familia|Estilo" con el comando nativo de EffectCraft. */
  function applyFontEC(layerName, font) {
    var parts = String(font).split('|');
    return bridge.ec('layer.setText', { layer: layerName, font: parts[0], style: parts[1] || 'Regular' });
  }

  function callEC(fn, args) {
    args = args || {};
    if (fn === 'getFonts') return getFontsEC();
    if (fn === 'renderAudio') return renderAudioEC(args);
    if (fn === 'ensureLayer' && args.font && args.font.indexOf('|') > 0) {
      var font = args.font, a2 = {};
      for (var k in args) a2[k] = args[k];
      a2.font = null;
      return runInEC('ensureLayer', a2).then(function (r) {
        return applyFontEC(r.name, font).then(function () { return runInEC('ensureLayer', a2); }, function () { return r; });
      });
    }
    return runInEC(fn, args);
  }

  // ================================================================ API común
  function call(fn, args) {
    if (hasCEP) return callAE(fn, args);
    if (bridge) return callEC(fn, args);
    return Promise.reject(new Error('Este panel debe abrirse desde After Effects o desde "AutoSub para EffectCraft".'));
  }

  function extensionPath() {
    if (!hasCEP) return '';
    return global.__adobe_cep__.getSystemPath('extension').replace(/^file:\/*/, '');
  }

  function openURL(url) {
    if (global.cep && global.cep.util && global.cep.util.openURLInDefaultBrowser) global.cep.util.openURLInDefaultBrowser(url);
    else if (bridge) bridge.openUrl(url);
    else global.open(url, '_blank');
  }

  /** Diálogo nativo de "Guardar como". Devuelve la ruta o null si se cancela. */
  function saveDialog(title, defaultName, extensions) {
    if (global.cep && global.cep.fs && global.cep.fs.showSaveDialogEx) {
      var r = global.cep.fs.showSaveDialogEx(title, '', extensions, defaultName);
      if (r && r.err === 0 && r.data) return r.data;
      return null;
    }
    if (bridge) return bridge.saveDialog(title, defaultName, extensions && extensions[0]);
    return null;
  }

  /** Comprueba que el anfitrión responde (y en EffectCraft, que está abierto con el canal de control). */
  function ensureHost() {
    if (bridge) {
      return bridge.api('ecLaunch').then(function (st) {
        if (!st.installed) throw new Error('No se encontró EffectCraft instalado en este equipo.');
        if (!st.connected) {
          throw new Error(st.running
            ? 'EffectCraft está abierto sin el canal de control. Ciérralo y pulsa "Reintentar": AutoSub lo abrirá de nuevo conectado.'
            : 'No se pudo conectar con EffectCraft.');
        }
        return st;
      });
    }
    if (!hasCEP) return Promise.resolve();
    return new Promise(function (resolve) {
      global.__adobe_cep__.evalScript('typeof AutoSub', function (t) {
        if (t === 'object') { resolve(); return; }
        var p = (extensionPath() + '/jsx/host.jsx').replace(/\\/g, '/');
        global.__adobe_cep__.evalScript('$.evalFile(' + JSON.stringify(p) + ')', function () { resolve(); });
      });
    });
  }

  global.CEP = {
    available: hasCEP || !!bridge,
    host: bridge ? 'effectcraft' : 'aftereffects',
    hostName: bridge ? 'EffectCraft' : 'After Effects',
    call: call,
    extensionPath: extensionPath,
    openURL: openURL,
    saveDialog: saveDialog,
    ensureHost: ensureHost
  };
})(window);
