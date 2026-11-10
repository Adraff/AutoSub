/*
 * Lógica principal del panel AutoSub.
 */
(function () {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var os = require('os');

  var $ = function (id) { return document.getElementById(id); };
  var compInfo = null;
  var busy = false;
  var models = [];

  var MIME = {
    wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', mp3: 'audio/mp3', aac: 'audio/aac',
    m4a: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
    mp4: 'video/mp4', mov: 'video/mov', avi: 'video/avi', mpg: 'video/mpeg', mpeg: 'video/mpeg',
    webm: 'video/webm', wmv: 'video/wmv', flv: 'video/x-flv', '3gp': 'video/3gpp', mkv: 'video/webm'
  };

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function fmtTime(t) {
    var m = Math.floor(t / 60), s = (t - m * 60).toFixed(2);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtDuration(ms) {
    var min = Math.ceil(ms / 60000), h = Math.floor(min / 60);
    return h ? h + ' h ' + (min % 60) + ' min' : min + ' min';
  }

  function setStatus(el, text, cls) { el.textContent = text; el.className = 'status ' + (cls || ''); }

  // ================================================================ LOG
  // Todo lo que pasa queda en la pestaña "Log" y en el archivo autosub.log de la carpeta de configuración.
  var logEntries = [];
  var LOG_FILE = path.join(Config.dir(), 'autosub.log');

  function log(msg, cls) {
    var now = new Date();
    var e = { t: now.toLocaleTimeString(), msg: msg, cls: cls || '' };
    logEntries.push(e);
    if (logEntries.length > 1000) logEntries.shift();
    appendLogDom(e);
    if (cls === 'err') $('logDot').className = 'dot err';
    try {
      fs.appendFileSync(LOG_FILE, now.toISOString() + ' [' + (cls || 'info') + '] ' + msg + '\n', 'utf8');
      if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    } catch (err) { /* sin acceso al archivo: solo en pantalla */ }
  }

  function logRun(title) { log('── ' + title + ' ──', 'run'); }

  function appendLogDom(e) {
    var list = $('logList');
    if (list.firstElementChild && list.firstElementChild.tagName === 'P') list.innerHTML = '';
    var d = document.createElement('div');
    d.className = e.cls;
    d.innerHTML = '<span class="t">' + e.t + '</span>  ' + escapeHTML(e.msg);
    list.appendChild(d);
    list.scrollTop = list.scrollHeight;
  }

  function copyLog() {
    var ta = document.createElement('textarea');
    ta.value = logEntries.map(function (e) { return e.t + '  ' + e.msg; }).join('\n');
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    document.body.removeChild(ta);
  }

  // ================================================================ ESTADO DEL TRABAJO (Generar)
  var fakeTimer = null;

  /** Muestra qué se está haciendo y el porcentaje. p: 0..1, o null para ocultar. */
  function job(text, p, cls) {
    stopFake();
    var box = $('job');
    if (p === null) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('jobText').className = cls || '';
    if (cls === 'err') {
      $('jobText').innerHTML = escapeHTML(text) + ' · <a id="jobLogLink">Ver log</a>';
      $('jobLogLink').onclick = function () { showTab('log'); };
    } else {
      $('jobText').textContent = text;
    }
    $('jobPct').textContent = cls === 'err' ? '' : Math.round(p * 100) + '%';
    $('jobBar').style.width = Math.round(p * 100) + '%';
    $('jobBar').style.background = cls === 'err' ? 'var(--err)' : (cls === 'ok' ? 'var(--ok)' : '');
  }

  /** Progreso estimado mientras esperamos a la IA (Google no informa del avance). */
  function jobWaiting(text, from, to, estSeconds) {
    var t0 = Date.now();
    job(text, from);
    fakeTimer = setInterval(function () {
      var el = (Date.now() - t0) / 1000;
      var p = from + (to - from) * (1 - Math.exp(-el / estSeconds));
      $('jobText').textContent = text + ' · ' + Math.round(el) + ' s';
      $('jobPct').textContent = Math.round(p * 100) + '%';
      $('jobBar').style.width = Math.round(p * 100) + '%';
    }, 500);
  }

  function stopFake() { if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; } }

  function setBusy(b) {
    busy = b;
    ['btnGenerate', 'btnReflow', 'btnSaveSubs', 'btnExport'].forEach(function (id) { $(id).disabled = b; });
  }

  // ================================================================ AJUSTES
  function readSettings() {
    var ml = document.querySelector('#maxLines button.on');
    return {
      audioSource: $('audioSource').value,
      language: $('language').value,
      boxWidth: Number($('boxWidth').value) || 1000,
      maxLines: ml ? Number(ml.getAttribute('data-v')) : 2,
      fontSize: Number($('fontSize').value) || 80,
      background: $('bgBox').checked,
      keepSilence: $('keepSilence').checked,
      gapBreak: Number($('gapBreak').value) || 0.5,
      maxDuration: Number($('maxDuration').value) || 5,
      breakPunct: $('breakPunct').checked,
      vad: $('vad').checked,
      exportFormat: $('exportFormat').value,
      exportOrigin: $('exportOrigin').value,
      exportOneLine: $('exportOneLine').checked
    };
  }

  function writeSettings(s) {
    if (!s) return;
    if (s.audioSource) $('audioSource').value = s.audioSource;
    if (s.language) $('language').value = s.language;
    if (s.boxWidth) $('boxWidth').value = s.boxWidth;
    if (s.maxLines) {
      Array.prototype.forEach.call(document.querySelectorAll('#maxLines button'), function (b) {
        b.classList.toggle('on', Number(b.getAttribute('data-v')) === Number(s.maxLines));
      });
    }
    if (s.fontSize) $('fontSize').value = s.fontSize;
    if ('background' in s) $('bgBox').checked = !!s.background;
    if ('keepSilence' in s) $('keepSilence').checked = !!s.keepSilence;
    if (s.gapBreak) $('gapBreak').value = s.gapBreak;
    if (s.maxDuration) $('maxDuration').value = s.maxDuration;
    if ('breakPunct' in s) $('breakPunct').checked = !!s.breakPunct;
    if ('vad' in s) $('vad').checked = !!s.vad;
    if (s.exportFormat) $('exportFormat').value = s.exportFormat;
    if (s.exportOrigin) $('exportOrigin').value = s.exportOrigin;
    if ('exportOneLine' in s) $('exportOneLine').checked = !!s.exportOneLine;
  }

  function persistSettings() { Config.setSettings(readSettings()); }

  // ================================================================ API KEY
  function updateKeyUI() {
    var ok = Config.hasKey();
    $('keyDot').className = 'dot ' + (ok ? 'ok' : 'warn');
    $('keyDot').parentNode.title = ok ? 'Ajustes · API key guardada' : 'Ajustes · Falta la API key';
    var k = Config.get('apiKey');
    $('setKey').value = '';
    $('setKey').placeholder = ok ? 'Guardada y cifrada (••••' + k.slice(-4) + ')' : 'AIza...';
    var scheme = Config.keyScheme();
    $('keyInfo').textContent = ok
      ? (scheme === 'dpapi' ? '🔒 Cifrada con tu cuenta de Windows (DPAPI): otras cuentas del equipo no pueden leerla.'
        : scheme === 'keychain' ? '🔒 Guardada en el Llavero de tu usuario de macOS.' : '')
      : 'Sin clave. Pulsa "Guía" para crear una gratis.';
  }

  function validateAndSaveKey(key, statusEl) {
    key = String(key || '').trim();
    if (!key) { setStatus(statusEl, 'Pega primero tu clave.', 'err'); return Promise.resolve(false); }
    setStatus(statusEl, 'Comprobando la clave con Google…', 'busy');
    return Gemini.listModels(key).then(function (list) {
      try { Config.set('apiKey', key); } catch (e) {
        setStatus(statusEl, '✖ No se pudo cifrar la clave: ' + e.message, 'err');
        log('Error al cifrar la API key: ' + e.message, 'err');
        return false;
      }
      Config.set('models', list);
      fillModels(list);
      updateKeyUI();
      log('API key validada y guardada cifrada (' + list.length + ' modelos disponibles).', 'ok');
      setStatus(statusEl, '✔ Clave válida, cifrada y guardada.', 'ok');
      return true;
    }, function (e) {
      log('API key rechazada: ' + e.message, 'err');
      setStatus(statusEl, '✖ ' + e.message, 'err');
      return false;
    });
  }

  // ================================================================ SELECTOR DE MODELO
  function sortedModels(list) {
    return list.map(function (m) {
      var c = Gemini.classifyModel(m.id);
      return { id: m.id, label: m.label, tier: c.tier, tag: c.tag, rec: c.rec, rank: c.rank };
    }).sort(function (a, b) { return a.rank - b.rank || a.label.localeCompare(b.label); });
  }

  function fillModels(list) {
    models = sortedModels(list && list.length ? list : [{ id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite Latest' }]);
    var current = Config.get('model');
    if (!current || !models.some(function (m) { return m.id === current; })) {
      current = models[0].id; // el más barato y gratuito disponible
      Config.set('model', current);
    }
    renderModelList();
    selectModel(current, true);
  }

  function renderModelList() {
    var box = $('modelList');
    box.innerHTML = '';
    var lastTier = null;
    models.forEach(function (m) {
      if (m.tier !== lastTier) {
        var sep = document.createElement('div');
        sep.className = 'msel-sep';
        sep.textContent = m.tier === 'free' ? 'Gratuitos · recomendados' : 'De pago o gastan más tokens';
        box.appendChild(sep);
        lastTier = m.tier;
      }
      var o = document.createElement('div');
      o.className = 'mopt ' + m.tier + (m.id === Config.get('model') ? ' sel' : '');
      o.title = m.id;
      o.innerHTML = '<i class="mdot ' + m.tier + '"></i><span class="mname">' + escapeHTML(m.label) +
        (m.rec ? ' ★' : '') + '</span><span class="mtag">' + m.tag + '</span>';
      o.onclick = function (e) { e.stopPropagation(); selectModel(m.id); $('modelList').classList.add('hidden'); };
      box.appendChild(o);
    });
  }

  function selectModel(id, silent) {
    var m = models.filter(function (x) { return x.id === id; })[0] || { id: id, label: id, tier: 'paid', tag: '' };
    Config.set('model', m.id);
    $('modelBtn').className = 'msel-btn ' + m.tier;
    $('modelName').textContent = m.label + (m.rec ? ' ★' : '');
    $('modelTag').textContent = m.tag;
    $('modelBtn').title = m.id + (m.rec ? ' · recomendado: el que menos tokens gasta' : '');
    if (!silent) log('Modelo seleccionado: ' + m.id);
    renderModelList();
    updateQuota();
  }

  // ================================================================ CUOTA
  function updateQuota() {
    var model = Config.get('model');
    if (!model) return;
    var q = Quota.status(model);
    var left = Math.max(0, q.limit - q.used);
    var fill = $('qFill');
    fill.style.width = Math.round((1 - q.pct) * 100) + '%';
    fill.style.background = q.pct >= 0.9 ? 'var(--err)' : (q.pct >= 0.6 ? 'var(--warn)' : 'var(--ok)');
    $('qText').textContent = (q.exhausted ? 'Cuota agotada' : 'Quedan ' + (q.source === 'default' ? '≈' : '') + left + '/' + q.limit + ' hoy') +
      ' · se recarga en ' + fmtDuration(q.resetMs);
    $('quota').title = 'Uso estimado de tu API key para ' + model + ' en este equipo:\n' +
      q.used + ' peticiones y ' + q.tokens.toLocaleString() + ' tokens hoy.\n' +
      'Límite: ' + q.limit + ' peticiones/día ' + (q.source === 'google' ? '(informado por Google)' : q.source === 'user' ? '(ajustado por ti)' : '(estimado; ajústalo en Ajustes)') +
      '\nSe recarga a medianoche, hora del Pacífico.';
    $('limModel').textContent = model.replace(/^gemini-/, '');
    if (document.activeElement !== $('limitRpd')) $('limitRpd').value = q.limit;
  }

  // ================================================================ ASISTENTE DE API KEY
  var wzStep = 1;
  function showWizard(step) {
    wzStep = step || 1;
    $('wizard').classList.remove('hidden');
    Array.prototype.forEach.call(document.querySelectorAll('.wizard-step'), function (el) {
      el.classList.toggle('hidden', Number(el.getAttribute('data-step')) !== wzStep);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.dots span'), function (d, i) {
      d.classList.toggle('on', i < wzStep);
    });
    $('wzBack').style.visibility = wzStep > 1 ? 'visible' : 'hidden';
    $('wzNext').style.visibility = wzStep < 4 ? 'visible' : 'hidden';
    if (wzStep === 4) setTimeout(function () { $('wzKey').focus(); }, 50);
  }
  function hideWizard() { $('wizard').classList.add('hidden'); $('wzKey').value = ''; }

  function initWizard() {
    $('wzNext').onclick = function () { showWizard(Math.min(4, wzStep + 1)); };
    $('wzBack').onclick = function () { showWizard(Math.max(1, wzStep - 1)); };
    $('wzSkip').onclick = hideWizard;
    $('wzOpenStudio').onclick = function () { CEP.openURL('https://aistudio.google.com/apikey'); };
    $('wzToggle').onclick = function () { $('wzKey').type = $('wzKey').type === 'password' ? 'text' : 'password'; };
    $('wzValidate').onclick = function () {
      validateAndSaveKey($('wzKey').value, $('wzStatus')).then(function (ok) {
        if (ok) setTimeout(hideWizard, 1200);
      });
    };
    $('wzKey').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('wzValidate').click(); });
  }

  // ================================================================ COMPOSICIÓN
  function refreshComp() {
    if (busy || !CEP.available) return Promise.resolve();
    return CEP.call('compInfo').then(function (info) {
      compInfo = info;
      var el = $('compInfo');
      if (!info.comp) {
        el.innerHTML = '<span class="w">⚠ Abre una composición</span>';
        el.title = '';
        return;
      }
      var c = info.comp;
      var wa = fmtTime(c.workAreaStart) + '–' + fmtTime(c.workAreaStart + c.workAreaDuration);
      el.innerHTML = (c.hasAudio ? '' : '<span class="w">⚠ sin audio · </span>') +
        '<b>' + escapeHTML(c.name) + '</b> · ' + c.width + '×' + c.height + ' · ' + wa +
        (info.subLayer ? ' · ✓ subtítulos' : '');
      el.title = c.name + '\n' + c.width + '×' + c.height + ' · ' + c.frameRate.toFixed(2) + ' fps\nÁrea de trabajo: ' + wa +
        (info.subLayer ? '\nCapa de subtítulos: ' + info.subLayer : '') +
        (info.selected ? '\nCapa seleccionada: ' + info.selected.name : '');
      $('btnReflow').disabled = !info.hasWords;
    }).catch(function () { /* AE ocupado: se reintenta luego */ });
  }

  // ================================================================ GENERACIÓN
  function getAudio(settings) {
    var tmpDir = path.join(os.tmpdir(), 'AutoSub');
    function fromComp() {
      job('Exportando el audio de la composición', 0.03);
      log('Exportando el audio de la composición (área de trabajo)…');
      return CEP.call('renderAudio', { folder: tmpDir.replace(/\\/g, '/') }).then(function (r) {
        log('Audio exportado: ' + r.path);
        return {
          path: r.path, temp: true, duration: r.duration,
          toComp: function (t) { return t + r.offset; },
          range: [r.offset, r.offset + r.duration]
        };
      });
    }
    function fromLayer() {
      job('Leyendo el archivo de la capa', 0.05);
      return CEP.call('layerSource').then(function (r) {
        log('Usando el archivo original: ' + r.path);
        var k = (r.stretch || 100) / 100;
        return {
          path: r.path, temp: false, duration: r.duration,
          toComp: function (t) { return r.startTime + t * k; },
          range: [Math.min(r.inPoint, r.outPoint), Math.max(r.inPoint, r.outPoint)]
        };
      });
    }
    if (settings.audioSource === 'layer') return fromLayer();
    return fromComp().catch(function (e) {
      log('No se pudo exportar el audio de la composición: ' + e.message, 'warn');
      if (compInfo && compInfo.selected && compInfo.selected.file) {
        log('Probando con el archivo de la capa seleccionada…', 'warn');
        return fromLayer();
      }
      throw new Error(e.message + ' Selecciona la capa de vídeo y elige "Audio: Capa seleccionada".');
    });
  }

  function mimeFor(p) {
    var ext = path.extname(p).slice(1).toLowerCase();
    var m = MIME[ext];
    if (!m) throw new Error('Formato no compatible con Gemini: .' + ext + '. Usa "Audio: Composición".');
    return m;
  }

  /** Mide palabras, segmenta y escribe los subtítulos en la capa. */
  function layoutAndApply(words, settings, storeWords, p0) {
    var unique = {};
    words.forEach(function (w) { unique[w.w] = 1; });
    var list = Object.keys(unique);
    job('Midiendo la tipografía', p0);
    log('Midiendo ' + list.length + ' palabras con la tipografía de la capa…');
    return CEP.call('measure', { words: list }).then(function (m) {
      var segs = Segmenter.segment(words, {
        boxWidth: settings.boxWidth,
        maxLines: settings.maxLines,
        spaceWidth: m.space,
        avgCharWidth: m.avgChar,
        widths: m.widths,
        gapBreak: settings.gapBreak,
        maxDuration: settings.maxDuration,
        breakPunct: settings.breakPunct,
        keepSilence: settings.keepSilence,
        endTime: compInfo && compInfo.comp ? compInfo.comp.duration : undefined
      });
      job('Creando ' + segs.length + ' subtítulos', p0 + (1 - p0) * 0.5);
      log('Creando ' + segs.length + ' subtítulos (ancho ' + settings.boxWidth + ' px, máx. ' + settings.maxLines + ' líneas, ' +
        (settings.keepSilence ? 'se mantienen' : 'se ocultan') + ' en silencios)…');
      var payload = { segments: segs, settings: settings };
      if (storeWords) payload.words = words.map(function (w) { return [w.w, w.s, w.e]; });
      return CEP.call('apply', payload);
    });
  }

  function generate() {
    if (busy) return;
    if (!Config.hasKey()) { showWizard(1); return; }
    var apiKey = Config.get('apiKey');
    var model = Config.get('model');
    var q = Quota.status(model);
    if (q.exhausted && !confirm('Según el contador, la cuota gratuita de hoy para este modelo está agotada.\n¿Intentarlo igualmente?')) return;

    var settings = readSettings();
    persistSettings();
    setBusy(true);
    logRun('Generar subtítulos · ' + model);
    var audio = null;

    refreshComp().then(function () {
      if (!compInfo || !compInfo.comp) throw new Error('Abre una composición en la línea de tiempo.');
      return getAudio(settings);
    }).then(function (a) {
      audio = a;
      var mime = mimeFor(a.path);
      var mb = fs.statSync(a.path).size / 1048576;
      log('Audio listo: ' + mb.toFixed(1) + ' MB, ' + fmtTime(a.duration) + ' (' + mime + ').', 'ok');
      if (a.duration > 20 * 60) log('Aviso: más de 20 min de audio pueden superar el límite de respuesta de la IA.', 'warn');
      if (/^video\//.test(mime)) log('Aviso: se subirá un vídeo completo; es más lento y gasta más tokens que usar el audio de la composición.', 'warn');
      var lastText = '';
      return Gemini.transcribe({
        apiKey: apiKey,
        model: model,
        filePath: a.path,
        mimeType: mime,
        language: settings.language,
        duration: a.duration,
        onStatus: function (text, p) {
          if (text !== lastText) { log(text + '…'); lastText = text; }
          if (p >= 0) job(text, 0.12 + p * 0.3);
          else jobWaiting(text, 0.45, 0.85, 8 + a.duration * 0.12);
        },
        onRequest: function () { Quota.recordRequest(model); updateQuota(); }
      });
    }).then(function (res) {
      stopFake();
      var tokens = res.usage.totalTokenCount || 0;
      Quota.recordTokens(model, tokens);
      updateQuota();
      log('Respuesta de la IA: ' + res.words.length + ' palabras · ' + tokens.toLocaleString() + ' tokens (' +
        (res.usage.promptTokenCount || 0).toLocaleString() + ' de entrada, ' + (res.usage.candidatesTokenCount || 0).toLocaleString() + ' de salida).', 'ok');
      if (res.truncated) log('La respuesta de la IA se cortó: puede que falten las últimas frases.', 'warn');

      var aiWords = res.words;
      if (settings.vad && /\.(wav|aif|aiff)$/i.test(audio.path) && aiWords.length) {
        job('Ajustando tiempos con el audio', 0.87);
        try {
          var ref = AudioAlign.refine(audio.path, aiWords);
          if (ref.regions.length) {
            aiWords = ref.words;
            log('Tiempos ajustados a ' + ref.regions.length + ' tramos de voz detectados en el audio.', 'ok');
          } else {
            log('No se distinguió la voz del fondo; se usan los tiempos de la IA.', 'warn');
          }
        } catch (err) {
          log('Ajuste fino omitido: ' + err.message, 'warn');
        }
      } else if (settings.vad && aiWords.length) {
        log('Ajuste fino solo disponible con "Audio: Composición" (o capas WAV/AIFF).', 'warn');
      }
      if (audio.temp) fs.unlink(audio.path, function () {});

      var words = aiWords.map(function (w) {
        return { w: w.w, s: audio.toComp(w.s), e: audio.toComp(w.e) };
      }).filter(function (w) { return w.e >= audio.range[0] - 0.05 && w.s <= audio.range[1] + 0.05; });
      if (!words.length) throw new Error('La IA no detectó voz en el audio.');
      if (res.language) log('Idioma detectado: ' + res.language);
      return CEP.call('ensureLayer', { fontSize: settings.fontSize, background: settings.background }).then(function () {
        return layoutAndApply(words, settings, true, 0.9);
      });
    }).then(function (r) {
      job('✔ ' + r.count + ' subtítulos creados', 1, 'ok');
      log('Listo: ' + r.count + ' subtítulos creados en una sola capa.', 'ok');
    }).catch(function (e) {
      stopFake();
      if (audio && audio.temp) fs.unlink(audio.path, function () {});
      if (e.quota) { Quota.learnFromError(model, e.quota); updateQuota(); }
      log('Error: ' + e.message, 'err');
      job('✖ ' + e.message, 1, 'err');
    }).then(function () {
      setBusy(false);
      refreshComp();
    });
  }

  function reflow() {
    if (busy) return;
    var settings = readSettings();
    persistSettings();
    setBusy(true);
    logRun('Reorganizar');
    job('Leyendo palabras guardadas', 0.1);
    CEP.call('getStore').then(function (store) {
      if (!store.words || !store.words.length) throw new Error('No hay palabras guardadas en la capa. Genera los subtítulos primero.');
      var words = store.words.map(function (a) { return { w: a[0], s: a[1], e: a[2] }; });
      return CEP.call('ensureLayer', { fontSize: settings.fontSize, background: settings.background }).then(function () {
        return layoutAndApply(words, settings, false, 0.3);
      });
    }).then(function (r) {
      job('✔ Reorganizado: ' + r.count + ' subtítulos', 1, 'ok');
      log('Reorganizado: ' + r.count + ' subtítulos.', 'ok');
    }).catch(function (e) {
      log('Error: ' + e.message, 'err');
      job('✖ ' + e.message, 1, 'err');
    }).then(function () { setBusy(false); });
  }

  // ================================================================ EDITOR
  var editorSubs = [];

  function renderEditor() {
    var box = $('subList');
    var filter = $('subSearch').value.trim().toLowerCase();
    box.innerHTML = '';
    if (!editorSubs.length) { box.innerHTML = '<p class="muted">No hay subtítulos en la capa.</p>'; return; }
    editorSubs.forEach(function (s, i) {
      if (filter && s.text.toLowerCase().indexOf(filter) < 0) return;
      var el = document.createElement('div');
      el.className = 'sub' + (s.dirty ? ' dirty' : '');
      el.innerHTML =
        '<span class="idx">' + (i + 1) + '</span>' +
        '<div class="times"><input type="number" step="0.01" class="st" title="Entrada (s)">' +
        '<input type="number" step="0.01" class="en" title="Salida (s)"></div>' +
        '<textarea rows="2"></textarea>' +
        '<button class="btn go" title="Ir a este momento">▶</button>';
      var st = el.querySelector('.st'), en = el.querySelector('.en'), ta = el.querySelector('textarea');
      st.value = s.start.toFixed(2); en.value = s.end.toFixed(2); ta.value = s.text;
      function dirty() { s.dirty = true; el.classList.add('dirty'); }
      st.oninput = function () { s.start = Number(st.value); dirty(); };
      en.oninput = function () { s.end = Number(en.value); dirty(); };
      ta.oninput = function () { s.text = ta.value; dirty(); };
      el.querySelector('.go').onclick = function () { CEP.call('gotoTime', { t: s.start + 0.01 }); };
      box.appendChild(el);
    });
  }

  function loadSubs() {
    CEP.call('readSubs').then(function (r) {
      editorSubs = r.subs;
      renderEditor();
    }).catch(function (e) { $('subList').innerHTML = '<p class="status err">' + escapeHTML(e.message) + '</p>'; });
  }

  function saveSubs() {
    if (busy) return;
    var changed = editorSubs.filter(function (s) { return s.dirty; }).length;
    var subs = editorSubs.filter(function (s) { return s.text.trim(); }).map(function (s) {
      var end = Math.max(s.end, s.start + 0.04);
      return { start: s.start, end: end, text: s.text.trim() };
    }).sort(function (a, b) { return a.start - b.start; });
    setBusy(true);
    CEP.call('writeSubs', { subs: subs }).then(function () {
      log('Editor: guardados ' + changed + ' subtítulos modificados (' + subs.length + ' en total).', 'ok');
      loadSubs();
    }).catch(function (e) { log('Error al guardar en el editor: ' + e.message, 'err'); alert(e.message); })
      .then(function () { setBusy(false); });
  }

  // ================================================================ EXPORTAR
  function exportSubs() {
    var s = readSettings();
    persistSettings();
    var st = $('exportStatus');
    var fmt = Exporters.formats[s.exportFormat];
    setStatus(st, 'Leyendo subtítulos…', 'busy');
    Promise.all([CEP.call('readSubs'), CEP.call('getStore').catch(function () { return { words: [] }; })]).then(function (res) {
      var r = res[0], store = res[1];
      if (!r.subs.length) throw new Error('No hay subtítulos que exportar.');
      // r.offset = control "Desfase" de la capa; se resta el origen elegido
      var offset = (s.exportOrigin === 'workarea' ? r.workAreaStart : 0) - (r.offset || 0);
      var words = (store.words || []).map(function (a) { return { w: a[0], s: a[1], e: a[2] }; });
      var subs = r.subs.map(function (x) {
        var o = { start: Math.max(0, x.start - offset), end: Math.max(0, x.end - offset), text: x.text };
        if (s.exportFormat === 'json') {
          o.words = words.filter(function (w) { return w.s >= x.start - 0.01 && w.s < x.end; }).map(function (w) {
            return { w: w.w, s: +(w.s - offset).toFixed(3), e: +(w.e - offset).toFixed(3) };
          });
        }
        return o;
      }).filter(function (x) { return x.end > 0; });

      var content = fmt.fn(subs, { oneLine: s.exportOneLine });
      var defName = (r.compName || 'subtitulos').replace(/[\\/:*?"<>|]/g, '_') + '.' + fmt.ext;
      var file = CEP.saveDialog('Exportar subtítulos', defName, [fmt.ext]);
      if (!file && !(window.cep && window.cep.fs)) file = path.join(os.homedir(), 'Desktop', defName);
      if (!file) { setStatus(st, 'Exportación cancelada.', ''); return; }
      if (!/\.[a-z0-9]+$/i.test(file)) file += '.' + fmt.ext;
      fs.writeFileSync(file, content, 'utf8');
      log('Exportado ' + fmt.ext.toUpperCase() + ': ' + file + ' (' + subs.length + ' subtítulos).', 'ok');
      setStatus(st, '✔ Guardado: ' + file + ' (' + subs.length + ' subtítulos)', 'ok');
    }).catch(function (e) {
      log('Error al exportar: ' + e.message, 'err');
      setStatus(st, '✖ ' + e.message, 'err');
    });
  }

  // ================================================================ INICIO
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-tab') === name); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'edit' && !editorSubs.length) loadSubs();
    if (name === 'log') { $('logDot').className = 'dot hidden'; $('logList').scrollTop = $('logList').scrollHeight; }
    if (name === 'settings') updateQuota();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.onclick = function () { showTab(t.getAttribute('data-tab')); };
    });
    initWizard();
    writeSettings(Config.getSettings());
    fillModels(Config.get('models'));
    updateKeyUI();
    $('cfgPath').textContent = Config.file();
    log('AutoSub iniciado. Configuración: ' + Config.file());

    // Generar
    $('btnGenerate').onclick = generate;
    $('btnReflow').onclick = reflow;
    $('boxWidth80').onclick = function () {
      if (compInfo && compInfo.comp) { $('boxWidth').value = Math.round(compInfo.comp.width * 0.8); persistSettings(); }
    };
    Array.prototype.forEach.call(document.querySelectorAll('#maxLines button'), function (b) {
      b.onclick = function (e) {
        e.preventDefault();
        document.querySelectorAll('#maxLines button').forEach(function (x) { x.classList.toggle('on', x === b); });
        persistSettings();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('input, select'), function (el) {
      if (el.closest('#wizard') || el.closest('#tab-settings') || el.id === 'subSearch') return;
      el.addEventListener('change', persistSettings);
    });

    // Selector de modelo
    $('modelBtn').onclick = function (e) {
      e.stopPropagation();
      var list = $('modelList');
      if (!list.classList.contains('hidden')) { list.classList.add('hidden'); return; }
      // Abrir hacia arriba o hacia abajo según el espacio libre del panel
      var r = $('modelBtn').getBoundingClientRect();
      var above = r.top - 34, below = window.innerHeight - r.bottom - 6;
      var down = below >= Math.min(260, above);
      list.classList.toggle('down', down);
      list.style.maxHeight = Math.max(120, Math.min(300, down ? below : above)) + 'px';
      list.classList.remove('hidden');
    };
    document.addEventListener('click', function () { $('modelList').classList.add('hidden'); });
    $('quota').onclick = function () { showTab('settings'); };

    // Editar
    $('btnLoadSubs').onclick = loadSubs;
    $('btnSaveSubs').onclick = saveSubs;
    $('subSearch').oninput = renderEditor;

    // Exportar
    $('btnExport').onclick = exportSubs;

    // Log
    $('logCopy').onclick = copyLog;
    $('logClear').onclick = function () { logEntries = []; $('logList').innerHTML = '<p class="muted">Log vacío.</p>'; };

    // Ajustes
    $('setToggle').onclick = function () { $('setKey').type = $('setKey').type === 'password' ? 'text' : 'password'; };
    $('setSaveKey').onclick = function () { validateAndSaveKey($('setKey').value, $('setStatus')); };
    $('setWizard').onclick = function () { showWizard(1); };
    $('setDeleteKey').onclick = function () {
      if (!confirm('¿Borrar la API key guardada en este equipo?')) return;
      Config.set('apiKey', ''); updateKeyUI();
      log('API key borrada de este equipo.');
      setStatus($('setStatus'), 'Clave borrada.', '');
    };
    $('refreshModels').onclick = function () {
      if (!Config.hasKey()) { setStatus($('setStatus'), 'Primero guarda tu API key.', 'err'); return; }
      Gemini.listModels(Config.get('apiKey')).then(function (m) {
        Config.set('models', m); fillModels(m);
        log('Lista de modelos actualizada (' + m.length + ').');
        setStatus($('setStatus'), 'Lista de modelos actualizada.', 'ok');
      }, function (e) { setStatus($('setStatus'), '✖ ' + e.message, 'err'); });
    };
    $('limitRpd').onchange = function () {
      var v = Number($('limitRpd').value);
      Quota.setLimit(Config.get('model'), v);
      log('Límite diario de ' + Config.get('model') + ' ajustado a ' + v + ' peticiones.');
      updateQuota();
    };
    $('openLimits').onclick = function () { CEP.openURL('https://aistudio.google.com/usage'); };

    CEP.ensureHost().then(function () {
      return refreshComp();
    }).then(function () {
      // Ancho por defecto: 80% de la composición la primera vez
      if (!Config.getSettings().boxWidth && compInfo && compInfo.comp) {
        $('boxWidth').value = Math.round(compInfo.comp.width * 0.8);
        $('fontSize').value = Math.round(compInfo.comp.height * 0.065);
      }
    });
    setInterval(refreshComp, 3000);
    setInterval(updateQuota, 30000);

    if (!Config.hasKey()) showWizard(1);
  }

  init();
})();
