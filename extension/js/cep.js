/*
 * Puente mínimo con After Effects (sin librerías externas).
 * Usa directamente el objeto window.__adobe_cep__ que CEP inyecta en el panel.
 */
(function (global) {
  'use strict';

  var hasCEP = typeof global.__adobe_cep__ !== 'undefined';

  // Convierte un objeto a un literal de cadena seguro para ExtendScript
  // (escapa todo lo que no sea ASCII para evitar problemas de codificación).
  function toJsxStringLiteral(obj) {
    var json = JSON.stringify(obj === undefined ? null : obj);
    var lit = JSON.stringify(json);
    return lit.replace(/[\u007f-￿]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  /**
   * Llama a AutoSub.<fn>(argsJSON) en el script host y devuelve una promesa con el
   * resultado ya parseado. El host siempre responde {ok:true,data} o {ok:false,error}.
   */
  function call(fn, args) {
    return new Promise(function (resolve, reject) {
      if (!hasCEP) {
        reject(new Error('Este panel debe ejecutarse dentro de After Effects.'));
        return;
      }
      var script = 'AutoSub.dispatch(' + JSON.stringify(fn) + ',' + toJsxStringLiteral(args || {}) + ')';
      global.__adobe_cep__.evalScript(script, function (res) {
        if (res === 'EvalScript error.' || res === undefined || res === null) {
          reject(new Error('Error al ejecutar el script en After Effects (' + fn + ').'));
          return;
        }
        var parsed;
        try { parsed = JSON.parse(res); } catch (e) {
          reject(new Error('Respuesta no válida de After Effects: ' + String(res).slice(0, 200)));
          return;
        }
        if (parsed && parsed.ok) resolve(parsed.data);
        else reject(new Error((parsed && parsed.error) || 'Error desconocido en After Effects.'));
      });
    });
  }

  function extensionPath() {
    if (!hasCEP) return '';
    return global.__adobe_cep__.getSystemPath('extension').replace(/^file:\/*/, '');
  }

  function openURL(url) {
    if (global.cep && global.cep.util && global.cep.util.openURLInDefaultBrowser) {
      global.cep.util.openURLInDefaultBrowser(url);
    } else {
      global.open(url, '_blank');
    }
  }

  /** Diálogo nativo de "Guardar como". Devuelve la ruta o null si se cancela. */
  function saveDialog(title, defaultName, extensions) {
    if (global.cep && global.cep.fs && global.cep.fs.showSaveDialogEx) {
      var r = global.cep.fs.showSaveDialogEx(title, '', extensions, defaultName);
      if (r && r.err === 0 && r.data) return r.data;
      return null;
    }
    return null;
  }

  // Al cargar el panel, asegura que el script host está evaluado (por si AE no lo cargó).
  function ensureHost() {
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
    available: hasCEP,
    call: call,
    extensionPath: extensionPath,
    openURL: openURL,
    saveDialog: saveDialog,
    ensureHost: ensureHost
  };
})(window);
