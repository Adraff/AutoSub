/*
 * Lógica principal del panel AutoSub (After Effects).
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

  // Valores antiguos del selector de idioma del audio (versiones < 1.5)
  var OLD_LANG = { 'español': 'es', 'inglés': 'en', 'portugués': 'pt', 'francés': 'fr', 'italiano': 'it', 'alemán': 'de', 'catalán': 'ca' };

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function fmtTime(x) {
    var m = Math.floor(x / 60), s = (x - m * 60).toFixed(2);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtDuration(ms) {
    var min = Math.ceil(ms / 60000), h = Math.floor(min / 60);
    return h ? h + ' h ' + (min % 60) + ' min' : min + ' min';
  }

  function num(n) { return Number(n || 0).toLocaleString(I18N.lang); }

  function setStatus(el, text, cls) { el.textContent = text; el.className = 'status ' + (cls || ''); }

  // ================================================================ LOG
  // Todo queda en la pestaña "Log" y en el archivo autosub.log de la carpeta de configuración.
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
      $('jobText').innerHTML = escapeHTML(text) + ' · <a id="jobLogLink">' + t('log.view') + '</a>';
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
    ['btnGenerate', 'btnInterpret', 'btnReflow', 'btnSaveSubs', 'btnExport'].forEach(function (id) { $(id).disabled = b; });
    if (!b && compInfo) $('btnReflow').disabled = !compInfo.hasWords;
  }

  // ================================================================ AJUSTES
  function readSettings() {
    var ml = document.querySelector('#maxLines button.on');
    var saved = Config.getSettings();
    return {
      audioSource: $('audioSource').value,
      language: $('language').value,
      boxWidth: Number($('boxWidth').value) || 1000,
      maxLines: ml ? Number(ml.getAttribute('data-v')) : 2,
      fontSize: Number($('fontSize').value) || 80,
      bottomPad: $('bottomPad').value === '' ? null : Number($('bottomPad').value),
      background: $('bgBox').checked,
      stroke: $('stroke').checked,
      shadow: $('shadow').checked,
      keepSilence: $('keepSilence').checked,
      gapBreak: Number($('gapBreak').value) || 0.5,
      maxDuration: Number($('maxDuration').value) || 5,
      breakPunct: $('breakPunct').checked,
      vad: $('vad').checked,
      trimSilence: $('trimSilence').checked,
      font: $('fontStyle').value || saved.font || '',
      exportFormat: $('exportFormat').value,
      exportOrigin: $('exportOrigin').value,
      exportOneLine: $('exportOneLine').checked,
      uiLang: $('uiLang').value || 'auto'
    };
  }

  function writeSettings(s) {
    if (!s) return;
    if (s.audioSource) $('audioSource').value = s.audioSource;
    if (s.language) $('language').value = OLD_LANG[s.language] || s.language;
    if (s.boxWidth) $('boxWidth').value = s.boxWidth;
    if (s.maxLines) {
      Array.prototype.forEach.call(document.querySelectorAll('#maxLines button'), function (b) {
        b.classList.toggle('on', Number(b.getAttribute('data-v')) === Number(s.maxLines));
      });
    }
    if (s.fontSize) $('fontSize').value = s.fontSize;
    if (s.bottomPad != null) $('bottomPad').value = s.bottomPad;
    if ('background' in s) $('bgBox').checked = !!s.background;
    if ('stroke' in s) $('stroke').checked = !!s.stroke;
    if ('shadow' in s) $('shadow').checked = !!s.shadow;
    if ('keepSilence' in s) $('keepSilence').checked = !!s.keepSilence;
    if (s.gapBreak) $('gapBreak').value = s.gapBreak;
    if (s.maxDuration) $('maxDuration').value = s.maxDuration;
    if ('breakPunct' in s) $('breakPunct').checked = !!s.breakPunct;
    if ('vad' in s) $('vad').checked = !!s.vad;
    if ('trimSilence' in s) $('trimSilence').checked = !!s.trimSilence;
    if (s.exportFormat) $('exportFormat').value = s.exportFormat;
    if (s.exportOrigin) $('exportOrigin').value = s.exportOrigin;
    if ('exportOneLine' in s) $('exportOneLine').checked = !!s.exportOneLine;
    $('uiLang').value = s.uiLang || 'auto';
  }

  function persistSettings() { Config.setSettings(readSettings()); }

  // ================================================================ IDIOMA DEL PANEL
  /** Aplica el idioma a todos los textos fijos y vuelve a pintar los dinámicos. */
  function applyLanguage() {
    I18N.setLang(Config.getSettings().uiLang || 'auto');
    I18N.apply(document);
    updateKeyUI();
    if (models.length) { renderModelList(); selectModel(Config.get('model'), true); }
    updateQuota();
    renderFontButton();
    updateEditorBar();
    renderCompInfo();
    updateEditTab();
    if (fonts.length) $('fontCount').textContent = t('gen.fontCount', { n: fonts.length });
  }

  // ================================================================ API KEY
  function updateKeyUI() {
    var ok = Config.hasKey();
    $('keyDot').className = 'dot ' + (ok ? 'ok' : 'warn');
    $('keyDot').parentNode.title = ok ? t('key.ok') : t('key.missing');
    var k = Config.get('apiKey');
    $('setKey').value = '';
    $('setKey').placeholder = ok ? t('key.saved', { last: k.slice(-4) }) : 'AIza...';
    var scheme = Config.keyScheme();
    $('keyInfo').textContent = ok ? (scheme === 'dpapi' ? t('key.dpapi') : scheme === 'keychain' ? t('key.keychain') : '') : t('key.none');
  }

  function validateAndSaveKey(key, statusEl) {
    key = String(key || '').trim();
    if (!key) { setStatus(statusEl, t('key.pasteFirst'), 'err'); return Promise.resolve(false); }
    setStatus(statusEl, t('key.checking'), 'busy');
    return Gemini.listModels(key).then(function (list) {
      try { Config.set('apiKey', key); } catch (e) {
        setStatus(statusEl, t('key.encryptFail', { msg: e.message }), 'err');
        log(t('l.keyEncFail', { msg: e.message }), 'err');
        return false;
      }
      Config.set('models', list);
      fillModels(list);
      updateKeyUI();
      log(t('l.keySaved', { n: list.length }), 'ok');
      setStatus(statusEl, t('key.valid'), 'ok');
      return true;
    }, function (e) {
      log(t('l.keyRejected', { msg: e.message }), 'err');
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
        sep.textContent = m.tier === 'free' ? t('model.sepFree') : t('model.sepPaid');
        box.appendChild(sep);
        lastTier = m.tier;
      }
      var o = document.createElement('div');
      o.className = 'mopt ' + m.tier + (m.id === Config.get('model') ? ' sel' : '');
      o.title = m.id;
      o.innerHTML = '<i class="mdot ' + m.tier + '"></i><span class="mname">' + escapeHTML(m.label) +
        (m.rec ? ' ★' : '') + '</span><span class="mtag">' + t(m.tag) + '</span>';
      o.onclick = function (e) { e.stopPropagation(); selectModel(m.id); $('modelList').classList.add('hidden'); };
      box.appendChild(o);
    });
  }

  function selectModel(id, silent) {
    var m = models.filter(function (x) { return x.id === id; })[0] || { id: id, label: id, tier: 'paid', tag: '' };
    Config.set('model', m.id);
    $('modelBtn').className = 'msel-btn ' + m.tier;
    $('modelName').textContent = m.label + (m.rec ? ' ★' : '');
    $('modelTag').textContent = m.tag ? t(m.tag) : '';
    $('modelBtn').title = m.id + (m.rec ? ' · ' + t('model.rec') : '');
    if (!silent) log(t('l.model', { id: m.id }));
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
    $('qText').textContent = (q.exhausted ? t('quota.exhausted') : t('quota.left', { approx: q.source === 'default' ? '≈' : '', left: left, limit: q.limit })) +
      t('quota.reset', { time: fmtDuration(q.resetMs) });
    $('quota').title = t('quota.tip', {
      model: model, used: q.used, tokens: num(q.tokens), limit: q.limit,
      src: t(q.source === 'google' ? 'quota.src.google' : q.source === 'user' ? 'quota.src.user' : 'quota.src.default')
    });
    $('limLabel').textContent = t('set.rpd', { model: model.replace(/^gemini-/, '') });
    if (document.activeElement !== $('limitRpd')) $('limitRpd').value = q.limit;
  }

  // ================================================================ TIPOGRAFÍAS
  // Desplegable propio con buscador: muestra TODAS las familias (cada una con su propia letra)
  // y se filtra al escribir. El estilo (Bold, Regular…) se elige en el selector de al lado.
  var fonts = [];          // [{ f: familia, s: [[estilo, postScriptName], ...] }]
  var currentFamily = null;

  function findFontByPS(ps) {
    for (var i = 0; i < fonts.length; i++) {
      for (var j = 0; j < fonts[i].s.length; j++) if (fonts[i].s[j][1] === ps) return { fam: fonts[i], style: fonts[i].s[j] };
    }
    return null;
  }

  function fillStyles(fam, selectPS) {
    var sel = $('fontStyle');
    sel.innerHTML = '';
    fam.s.forEach(function (st) {
      var o = document.createElement('option');
      o.value = st[1]; o.textContent = st[0];
      sel.appendChild(o);
    });
    if (selectPS && fam.s.some(function (st) { return st[1] === selectPS; })) sel.value = selectPS;
    else {
      // Para subtítulos se prefiere un estilo Bold; si no, Regular
      var pick = fam.s.filter(function (st) { return /^bold$|^negrita$/i.test(st[0]); })[0] ||
        fam.s.filter(function (st) { return /regular|normal|book/i.test(st[0]); })[0] || fam.s[0];
      sel.value = pick[1];
    }
  }

  function renderFontButton() {
    if (!fonts.length) return;
    $('fontName').textContent = currentFamily ? currentFamily.f : '—';
    $('fontName').style.fontFamily = currentFamily ? '"' + currentFamily.f + '", sans-serif' : '';
  }

  function showFont(ps) {
    var hit = ps && findFontByPS(ps);
    if (!hit) hit = findFontByPS('Arial-BoldMT') || (fonts[0] && { fam: fonts[0], style: fonts[0].s[0] });
    if (!hit) return;
    currentFamily = hit.fam;
    fillStyles(hit.fam, hit.style[1]);
    renderFontButton();
  }

  var fontHl = -1, fontShown = [];
  function renderFontList() {
    var q = $('fontSearch').value.trim().toLowerCase();
    fontShown = q ? fonts.filter(function (f) { return f.f.toLowerCase().indexOf(q) >= 0; }) : fonts;
    var box = $('fontList');
    box.innerHTML = '';
    if (!fontShown.length) { box.innerHTML = '<div class="fsel-none">' + t('gen.fontNone') + '</div>'; return; }
    var frag = document.createDocumentFragment();
    fontShown.forEach(function (fam, i) {
      var o = document.createElement('div');
      o.className = 'fopt' + (fam === currentFamily ? ' sel' : '') + (i === fontHl ? ' hl' : '');
      o.textContent = fam.f;
      o.style.fontFamily = '"' + fam.f + '", sans-serif';
      o.title = fam.f + ' · ' + fam.s.length;
      o.onmousedown = function (e) { e.preventDefault(); chooseFamily(fam); };
      frag.appendChild(o);
    });
    box.appendChild(frag);
  }

  function openFontPop() {
    if (!fonts.length) return;
    var pop = $('fontPop');
    var r = $('fontBtn').getBoundingClientRect();
    pop.classList.toggle('up', window.innerHeight - r.bottom < 220 && r.top > window.innerHeight - r.bottom);
    pop.classList.remove('hidden');
    $('fontSearch').value = '';
    fontHl = -1;
    renderFontList();
    var sel = $('fontList').querySelector('.sel');
    if (sel) $('fontList').scrollTop = sel.offsetTop - 60;
    setTimeout(function () { $('fontSearch').focus(); }, 0);
  }

  function closeFontPop() { $('fontPop').classList.add('hidden'); }

  function chooseFamily(fam) {
    closeFontPop();
    currentFamily = fam;
    fillStyles(fam);
    renderFontButton();
    applyFont();
  }

  function loadFonts() {
    return CEP.call('getFonts').then(function (r) {
      if (!r.supported || !r.fonts.length) {
        $('fontName').textContent = t('gen.fontNeeds');
        $('fontBtn').disabled = true; $('fontStyle').disabled = true;
        log(t('l.fontsNeed'), 'warn');
        return;
      }
      fonts = r.fonts.sort(function (a, b) { return a.f.localeCompare(b.f); });
      $('fontCount').textContent = t('gen.fontCount', { n: fonts.length });
      log(t('l.fontsLoaded', { n: fonts.length }));
      showFont((compInfo && compInfo.subFont) || Config.getSettings().font || 'Arial-BoldMT');
    }).catch(function (e) { log(t('l.fontsFail', { msg: e.message }), 'warn'); });
  }

  /** Aplica la tipografía elegida: se guarda como predeterminada y se aplica a la capa existente. */
  function applyFont() {
    var ps = $('fontStyle').value;
    if (!ps) return;
    persistSettings();
    log(t('l.fontSel', { name: (currentFamily ? currentFamily.f : '') + ' ' + ($('fontStyle').selectedOptions[0] || {}).textContent, ps: ps }));
    applyStyleToLayer();
  }

  /** Lleva a la capa existente los cambios de estilo del panel (tipografía, trazo, sombra, fondo). */
  function applyStyleToLayer() {
    if (busy || !compInfo || !compInfo.subLayer) return;
    if (compInfo.hasWords) reflow(); // recalcula el reparto con el nuevo estilo
    else CEP.call('ensureLayer', layerOpts(readSettings())).catch(function (e) { log(t('l.error', { msg: e.message }), 'err'); });
  }

  function initFontPicker() {
    $('fontBtn').onclick = function (e) {
      e.stopPropagation();
      if ($('fontPop').classList.contains('hidden')) openFontPop(); else closeFontPop();
    };
    $('fontPop').onclick = function (e) { e.stopPropagation(); };
    $('fontSearch').oninput = function () { fontHl = 0; renderFontList(); $('fontList').scrollTop = 0; };
    $('fontSearch').onkeydown = function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        fontHl = Math.max(0, Math.min(fontShown.length - 1, fontHl + (e.key === 'ArrowDown' ? 1 : -1)));
        renderFontList();
        var hl = $('fontList').querySelector('.hl');
        if (hl) hl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (fontShown[Math.max(0, fontHl)]) chooseFamily(fontShown[Math.max(0, fontHl)]);
      } else if (e.key === 'Escape') closeFontPop();
    };
    $('fontStyle').addEventListener('change', applyFont);
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
  function renderCompInfo() {
    var el = $('compInfo'), info = compInfo;
    if (!info) return;
    if (!info.comp) { el.innerHTML = '<span class="w">' + t('gen.openComp') + '</span>'; el.title = ''; return; }
    var c = info.comp;
    var wa = fmtTime(c.workAreaStart) + '–' + fmtTime(c.workAreaStart + c.workAreaDuration);
    el.innerHTML = (c.hasAudio ? '' : '<span class="w">' + t('gen.noAudio') + '</span>') +
      '<b>' + escapeHTML(c.name) + '</b> · ' + c.width + '×' + c.height + ' · ' + wa + (info.subLayer ? t('gen.hasSubs') : '');
    el.title = c.name + '\n' + c.width + '×' + c.height + ' · ' + c.frameRate.toFixed(2) + ' fps\n' + t('gen.workArea') + ': ' + wa +
      (info.subLayer ? '\n' + t('gen.subLayer') + ': ' + info.subLayer : '') +
      (info.selected ? '\n' + t('gen.selLayer') + ': ' + info.selected.name : '');
  }

  /** La pestaña Editar solo se puede usar cuando la composición ya tiene subtítulos. */
  function updateEditTab() {
    var ok = !!(compInfo && compInfo.subLayer && compInfo.markerCount > 0);
    $('tabEdit').disabled = !ok;
    $('tabEdit').title = ok ? '' : t('tab.edit.locked');
    if (!ok && $('tab-edit').classList.contains('active')) showTab('gen');
  }

  function refreshComp() {
    if (busy || !CEP.available) return Promise.resolve();
    return CEP.call('compInfo').then(function (info) {
      compInfo = info;
      renderCompInfo();
      if (info.comp) {
        $('btnReflow').disabled = !info.hasWords;
        checkEditorSync();
      }
      updateEditTab();
    }).catch(function () { /* AE ocupado: se reintenta luego */ });
  }

  // ================================================================ GENERACIÓN
  function getAudio(settings) {
    var tmpDir = path.join(os.tmpdir(), 'AutoSub');
    function fromComp() {
      job(t('job.exportComp'), 0.03);
      log(t('l.exportComp'));
      return CEP.call('renderAudio', { folder: tmpDir.replace(/\\/g, '/') }).then(function (r) {
        log(t('l.exported', { path: r.path }));
        return { path: r.path, temp: true, duration: r.duration, toComp: function (x) { return x + r.offset; }, range: [r.offset, r.offset + r.duration] };
      });
    }
    // Último recurso: el archivo original de la capa (puede ser un vídeo, que gasta muchos más tokens)
    function fromLayerFile() {
      return CEP.call('layerSource').then(function (r) {
        log(t('l.useFile', { path: r.path }), 'warn');
        var k = (r.stretch || 100) / 100;
        return {
          path: r.path, temp: false, duration: r.duration,
          toComp: function (x) { return r.startTime + x * k; },
          range: [Math.min(r.inPoint, r.outPoint), Math.max(r.inPoint, r.outPoint)]
        };
      });
    }
    // Solo el audio de la capa seleccionada (nunca se envía vídeo)
    function fromLayer() {
      if (!compInfo || !compInfo.selected) return Promise.reject(new Error(t('e.selectLayer')));
      job(t('job.exportLayer'), 0.03);
      log(t('l.exportLayer', { name: compInfo.selected.name }));
      return CEP.call('renderAudio', { folder: tmpDir.replace(/\\/g, '/'), layerIndex: compInfo.selected.index }).then(function (r) {
        log(t('l.exported', { path: r.path }));
        return { path: r.path, temp: true, duration: r.duration, toComp: function (x) { return x + r.offset; }, range: [r.offset, r.offset + r.duration] };
      }, function (e) {
        log(t('l.layerFail', { msg: e.message }), 'warn');
        return fromLayerFile();
      });
    }
    if (settings.audioSource === 'layer') return fromLayer();
    return fromComp().catch(function (e) {
      log(t('l.compFail', { msg: e.message }), 'warn');
      if (compInfo && compInfo.selected && compInfo.selected.file) {
        log(t('l.tryLayerFile'), 'warn');
        return fromLayerFile();
      }
      throw new Error(e.message + t('e.compAudioHint'));
    });
  }

  function mimeFor(p) {
    var ext = path.extname(p).slice(1).toLowerCase();
    var m = MIME[ext];
    if (!m) throw new Error(t('e.format', { ext: ext }));
    return m;
  }

  /** Mide palabras, segmenta y escribe los subtítulos en la capa. */
  function layoutAndApply(words, settings, storeWords, p0) {
    var unique = {};
    words.forEach(function (w) { unique[w.w] = 1; });
    var list = Object.keys(unique);
    job(t('job.measure'), p0);
    log(t('l.measure', { n: list.length }));
    var forced = {};
    var segOpts = null;

    // Comprueba con la caja real de After Effects que ningún subtítulo supere las líneas máximas.
    function verify(segs, pass) {
      var multi = segs.filter(function (s) { return s.lines >= settings.maxLines; });
      if (!multi.length || pass >= 3) return Promise.resolve(segs);
      return CEP.call('countLines', { texts: multi.map(function (s) { return s.text; }) }).then(function (counts) {
        var over = multi.filter(function (s, i) { return counts[i] > settings.maxLines && s.w1 > s.w0; });
        if (!over.length) return segs;
        if (pass < 2) {
          // La tipografía real ocupa algo más que lo medido: se recalcula todo con más margen
          segOpts.boxWidth *= 0.95;
          log(t('l.boxRetry', { n: over.length, lines: settings.maxLines }));
        } else {
          over.forEach(function (s) { forced[Math.ceil((s.w0 + s.w1 + 1) / 2)] = 1; });
          segOpts.forceBreakBefore = forced;
          log(t('l.boxSplit', { n: over.length }));
        }
        return verify(Segmenter.segment(words, segOpts), pass + 1);
      });
    }

    return CEP.call('measure', { words: list }).then(function (m) {
      segOpts = {
        boxWidth: settings.boxWidth, maxLines: settings.maxLines,
        spaceWidth: m.space, avgCharWidth: m.avgChar, widths: m.widths,
        gapBreak: settings.gapBreak, maxDuration: settings.maxDuration,
        breakPunct: settings.breakPunct, keepSilence: settings.keepSilence,
        endTime: compInfo && compInfo.comp ? compInfo.comp.duration : undefined
      };
      job(t('job.check'), p0 + (1 - p0) * 0.3);
      return verify(Segmenter.segment(words, segOpts), 0);
    }).then(function (segs) {
      job(t('job.create', { n: segs.length }), p0 + (1 - p0) * 0.6);
      log(t('l.creating', { n: segs.length, w: settings.boxWidth, lines: settings.maxLines, silence: t(settings.keepSilence ? 'l.silKeep' : 'l.silHide') }));
      var payload = { segments: segs, settings: settings };
      if (storeWords) payload.words = words.map(function (w) { return w.p != null ? [w.w, w.s, w.e, w.p] : [w.w, w.s, w.e]; });
      return CEP.call('apply', payload);
    });
  }

  function layerOpts(settings) {
    return {
      fontSize: settings.fontSize, background: settings.background, stroke: settings.stroke, shadow: settings.shadow,
      boxWidth: settings.boxWidth, maxLines: settings.maxLines, font: settings.font, bottomPad: settings.bottomPad
    };
  }

  /** mode: 'literal' (transcripción exacta) o 'interpret' (la IA entiende el contexto y limpia el texto). */
  function generate(mode) {
    if (busy) return;
    if (!Config.hasKey()) { showWizard(1); return; }
    var apiKey = Config.get('apiKey');
    var model = Config.get('model');
    var q = Quota.status(model);
    if (q.exhausted && !confirm(t('q.confirmExhausted'))) return;

    var settings = readSettings();
    persistSettings();
    setBusy(true);
    logRun(t(mode === 'interpret' ? 'l.run.interp' : 'l.run.gen', { model: model }));
    var audio = null, prep = null, temps = [];

    function cleanup() { temps.forEach(function (p) { fs.unlink(p, function () {}); }); temps = []; }

    refreshComp().then(function () {
      if (!compInfo || !compInfo.comp) throw new Error(t('e.noComp'));
      return getAudio(settings);
    }).then(function (a) {
      audio = a;
      if (a.temp) temps.push(a.path);
      var upload = a.path, uploadDur = a.duration, mime = mimeFor(a.path);

      // Optimización de tokens: mono 16 kHz y, si se elige, sin silencios
      if (/\.(wav|aif|aiff)$/i.test(a.path)) {
        job(t('job.optimize'), 0.08);
        try {
          var out = path.join(os.tmpdir(), 'AutoSub', 'autosub_up_' + Date.now() + '.wav');
          prep = AudioAlign.prepareUpload(a.path, out, { trim: settings.trimSilence });
          temps.push(out);
          upload = out; uploadDur = prep.duration; mime = 'audio/wav';
          log(t('l.optimized', { mb: (fs.statSync(out).size / 1048576).toFixed(1) }), 'ok');
          if (prep.trimmed) {
            log(t('l.trimmed', { sent: fmtTime(prep.duration), total: fmtTime(prep.origDuration), pct: Math.round((1 - prep.duration / prep.origDuration) * 100) }), 'ok');
          }
        } catch (err) {
          prep = null;
          log(t('l.optFail', { msg: err.message }), 'warn');
        }
      }

      log(t('l.sending', { mb: (fs.statSync(upload).size / 1048576).toFixed(1), dur: fmtTime(uploadDur), mime: mime }));
      if (uploadDur > 20 * 60) log(t('l.long'), 'warn');
      if (/^video\//.test(mime)) log(t('l.video'), 'warn');
      var lastText = '';
      return Gemini.transcribe({
        apiKey: apiKey, model: model, filePath: upload, mimeType: mime,
        language: settings.language, duration: uploadDur, mode: mode,
        onStatus: function (text, p) {
          if (text !== lastText) { log(text + '…'); lastText = text; }
          if (p >= 0) job(text, 0.12 + p * 0.3);
          else jobWaiting(text, 0.45, 0.85, 6 + uploadDur * (mode === 'interpret' ? 0.12 : 0.08));
        },
        onRequest: function () { Quota.recordRequest(model); updateQuota(); }
      });
    }).then(function (res) {
      stopFake();
      var tokens = res.usage.totalTokenCount || 0;
      Quota.recordTokens(model, tokens);
      updateQuota();
      log(t('l.response', { phrases: res.phrases, words: res.words.length, tokens: num(tokens), 'in': num(res.usage.promptTokenCount), out: num(res.usage.candidatesTokenCount) }), 'ok');
      if (res.truncated) log(t('l.truncated'), 'warn');

      // Volver a la línea de tiempo original (si se quitaron silencios)
      var aiWords = res.words;
      if (prep && prep.trimmed) {
        aiWords = aiWords.map(function (w) {
          var s = prep.toOriginal(w.s), e = prep.toOriginal(w.e);
          return { w: w.w, s: s, e: Math.max(e, s + 0.05), p: w.p };
        });
      }

      // Ajuste fino con los tramos de voz reales
      if (settings.vad && prep && aiWords.length) {
        job(t('job.align'), 0.87);
        if (prep.regions.length) {
          aiWords = AudioAlign.align(aiWords, prep.regions);
          log(t('l.aligned', { n: prep.regions.length }), 'ok');
        } else {
          log(t('l.noContrast'), 'warn');
        }
      } else if (settings.vad && aiWords.length) {
        log(t('l.noAlign'), 'warn');
      }
      cleanup();

      var words = aiWords.map(function (w) {
        return { w: w.w, s: audio.toComp(w.s), e: audio.toComp(w.e), p: w.p };
      }).filter(function (w) { return w.e >= audio.range[0] - 0.05 && w.s <= audio.range[1] + 0.05; });
      if (!words.length) throw new Error(t('e.noSpeech'));
      if (res.language) log(t('l.detected', { lang: res.language }));
      return CEP.call('ensureLayer', layerOpts(settings)).then(function () {
        return layoutAndApply(words, settings, true, 0.9);
      });
    }).then(function (r) {
      job(t('job.done', { n: r.count }), 1, 'ok');
      log(t('l.done', { n: r.count }), 'ok');
      editorSubs = []; editorSig = null;
    }).catch(function (e) {
      stopFake();
      cleanup();
      if (e.quota) { Quota.learnFromError(model, e.quota); updateQuota(); }
      log(t('l.error', { msg: e.message }), 'err');
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
    logRun(t('l.run.reflow'));
    job(t('job.readWords'), 0.1);
    CEP.call('getStore').then(function (store) {
      if (!store.words || !store.words.length) throw new Error(t('e.noWords'));
      var words = store.words.map(function (a) { return { w: a[0], s: a[1], e: a[2], p: a[3] }; });
      return CEP.call('ensureLayer', layerOpts(settings)).then(function () {
        return layoutAndApply(words, settings, false, 0.3);
      });
    }).then(function (r) {
      job(t('job.reflowed', { n: r.count }), 1, 'ok');
      log(t('l.reflowed', { n: r.count }), 'ok');
      editorSubs = []; editorSig = null;
    }).catch(function (e) {
      log(t('l.error', { msg: e.message }), 'err');
      job('✖ ' + e.message, 1, 'err');
    }).then(function () { setBusy(false); refreshComp(); });
  }

  // ================================================================ EDITOR
  // Cada fila recuerda su estado original. Al guardar solo se envían los CAMBIOS hechos aquí;
  // así no se pisan los ajustes hechos a mano en la línea de tiempo (mover o alargar marcadores).
  var editorSubs = [];
  var editorSig = null;      // huella de los marcadores cuando se cargó el editor

  function editorDirty() {
    return editorSubs.some(function (s) { return s.isNew || s.del || s.dText || s.dStart || s.dEnd; });
  }

  function renderEditor() {
    var box = $('subList');
    var filter = $('subSearch').value.trim().toLowerCase();
    box.innerHTML = '';
    var visible = editorSubs.filter(function (s) { return !s.del; });
    if (!visible.length) { box.innerHTML = '<p class="muted">' + escapeHTML(t('edit.empty')) + '</p>'; return; }
    visible.forEach(function (s, i) {
      if (filter && s.text.toLowerCase().indexOf(filter) < 0) return;
      var el = document.createElement('div');
      el.className = 'sub' + (s.isNew || s.dText || s.dStart || s.dEnd ? ' dirty' : '');
      el.innerHTML =
        '<span class="idx">' + (i + 1) + '</span>' +
        '<div class="times"><input type="number" step="0.01" class="st" title="' + t('edit.in') + '">' +
        '<input type="number" step="0.01" class="en" title="' + t('edit.out') + '"></div>' +
        '<textarea rows="2" placeholder="' + t('edit.textPh') + '"></textarea>' +
        '<div class="acts"><button class="btn go" title="' + t('edit.go') + '">▶</button>' +
        '<button class="btn go add" title="' + t('edit.add') + '">＋</button>' +
        '<button class="btn go del" title="' + t('edit.del') + '">✕</button></div>';
      var st = el.querySelector('.st'), en = el.querySelector('.en'), ta = el.querySelector('textarea');
      st.value = s.start.toFixed(2); en.value = s.end.toFixed(2); ta.value = s.text;
      function mark() { el.classList.add('dirty'); updateEditorBar(); }
      st.oninput = function () { s.start = Number(st.value); s.dStart = true; mark(); };
      en.oninput = function () { s.end = Number(en.value); s.dEnd = true; mark(); };
      ta.oninput = function () { s.text = ta.value; s.dText = true; mark(); };
      el.querySelector('.go').onclick = function () { CEP.call('gotoTime', { t: s.start + 0.01 }); };
      el.querySelector('.add').onclick = function () { insertSub(s.end, s); };
      el.querySelector('.del').onclick = function () {
        if (s.isNew) editorSubs.splice(editorSubs.indexOf(s), 1); else s.del = true;
        renderEditor(); updateEditorBar();
      };
      box.appendChild(el);
      if (s.focus) { delete s.focus; setTimeout(function () { ta.focus(); ta.select(); }, 30); }
    });
  }

  /** Crea un subtítulo nuevo en el tiempo x (sin pisar al siguiente). */
  function insertSub(x, after) {
    var sorted = editorSubs.filter(function (s) { return !s.del; }).sort(function (a, b) { return a.start - b.start; });
    var next = sorted.filter(function (s) { return s !== after && s.start > x + 0.001; })[0];
    var end = x + 2;
    if (next) end = Math.min(end, next.start);
    if (end - x < 0.3) end = x + 1;
    var s = { start: Math.round(x * 100) / 100, end: Math.round(end * 100) / 100, text: '', isNew: true, focus: true };
    editorSubs.push(s);
    editorSubs.sort(function (a, b) { return a.start - b.start; });
    $('subSearch').value = '';
    renderEditor(); updateEditorBar();
    log(t('l.editNew', { t: fmtTime(s.start) }));
  }

  function insertAtCursor() {
    CEP.call('getTime').then(function (r) { insertSub(r.t); })
      .catch(function (e) { log(t('l.error', { msg: e.message }), 'err'); });
  }

  function updateEditorBar() {
    var n = editorSubs.filter(function (s) { return s.isNew || s.del || s.dText || s.dStart || s.dEnd; }).length;
    $('btnSaveSubs').textContent = n ? t('edit.saveN', { n: n }) : t('edit.save');
  }

  function loadSubs() {
    CEP.call('readSubs').then(function (r) {
      editorSubs = r.subs.map(function (s) {
        return { start: s.start, end: s.end, text: s.text, orig: { start: s.start, end: s.end, text: s.text } };
      });
      editorSig = compInfo ? compInfo.markerSig : null;
      $('subChanged').classList.add('hidden');
      renderEditor(); updateEditorBar();
    }).catch(function (e) { $('subList').innerHTML = '<p class="status err">' + escapeHTML(e.message) + '</p>'; });
  }

  /** Si los marcadores cambiaron fuera del panel (Ctrl+Z, edición a mano…), recarga o avisa. */
  function checkEditorSync() {
    if (!compInfo || editorSig === null || compInfo.markerSig === editorSig) return;
    if (!editorDirty()) { loadSubs(); return; }
    $('subChanged').classList.remove('hidden');
  }

  function saveSubs() {
    if (busy) return;
    var changes = [], inserts = [];
    editorSubs.forEach(function (s) {
      var emptied = !String(s.text).trim();
      if (s.isNew) { if (!emptied) inserts.push({ start: s.start, end: Math.max(s.end, s.start + 0.04), text: s.text.trim() }); return; }
      if (s.del || emptied) { changes.push({ orig: s.orig, del: true }); return; }
      if (!(s.dText || s.dStart || s.dEnd)) return;
      var c = { orig: s.orig };
      if (s.dText) c.text = s.text.trim();
      if (s.dStart) c.start = s.start;
      if (s.dEnd) c.end = Math.max(s.end, s.start + 0.04);
      changes.push(c);
    });
    if (!changes.length && !inserts.length) { log(t('l.editNone')); return; }
    setBusy(true);
    CEP.call('patchSubs', { changes: changes, inserts: inserts }).then(function (r) {
      log(t('l.editSaved', { c: changes.length, i: inserts.length, n: r.count }), 'ok');
      if (r.missing) log(t('l.editMissing', { n: r.missing }), 'warn');
      return refreshComp();
    }).then(function () { loadSubs(); })
      .catch(function (e) { log(t('l.editErr', { msg: e.message }), 'err'); alert(e.message); })
      .then(function () { setBusy(false); });
  }

  // ================================================================ EXPORTAR
  function exportSubs() {
    var s = readSettings();
    persistSettings();
    var st = $('exportStatus');
    var fmt = Exporters.formats[s.exportFormat];
    setStatus(st, t('exp.reading'), 'busy');
    Promise.all([CEP.call('readSubs'), CEP.call('getStore').catch(function () { return { words: [] }; })]).then(function (res) {
      var r = res[0], store = res[1];
      if (!r.subs.length) throw new Error(t('exp.none'));
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
      var defName = (r.compName || 'subtitles').replace(/[\\/:*?"<>|]/g, '_') + '.' + fmt.ext;
      var file = CEP.saveDialog(t('exp.dialog'), defName, [fmt.ext]);
      if (!file && !(window.cep && window.cep.fs)) file = path.join(os.homedir(), 'Desktop', defName);
      if (!file) { setStatus(st, t('exp.cancel'), ''); return; }
      if (!/\.[a-z0-9]+$/i.test(file)) file += '.' + fmt.ext;
      fs.writeFileSync(file, content, 'utf8');
      log(t('l.exported2', { fmt: fmt.ext.toUpperCase(), file: file, n: subs.length }), 'ok');
      setStatus(st, t('exp.saved', { file: file, n: subs.length }), 'ok');
    }).catch(function (e) {
      log(t('l.exportErr', { msg: e.message }), 'err');
      setStatus(st, '✖ ' + e.message, 'err');
    });
  }

  // ================================================================ INICIO
  function showTab(name) {
    if (name === 'edit' && $('tabEdit').disabled) return;
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-tab') === name); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'edit' && !editorSubs.length) loadSubs();
    if (name === 'log') { $('logDot').className = 'dot hidden'; $('logList').scrollTop = $('logList').scrollHeight; }
    if (name === 'settings') updateQuota();
  }

  function init() {
    // Idioma antes de pintar nada
    var saved = Config.getSettings();
    I18N.setLang(saved.uiLang || 'auto');
    I18N.apply(document);

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tb) {
      tb.onclick = function () { showTab(tb.getAttribute('data-tab')); };
    });
    initWizard();
    initFontPicker();
    writeSettings(saved);
    if (saved.bottomPad == null) $('bottomPad').value = '';
    fillModels(Config.get('models'));
    updateKeyUI();
    $('cfgPath').textContent = Config.file();
    log(t('l.start', { file: Config.file() }));
    log(t('l.lang', { lang: I18N.lang === 'en' ? 'English' : 'Español' }));

    // Generar
    $('btnGenerate').onclick = function () { generate('literal'); };
    $('btnInterpret').onclick = function () { generate('interpret'); };
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
      if (el.closest('#wizard') || el.closest('#tab-settings') || el.closest('#fontRow') || el.id === 'subSearch') return;
      el.addEventListener('change', persistSettings);
    });
    // Trazo, sombra y caja de fondo se aplican al momento a la capa existente
    ['stroke', 'shadow', 'bgBox'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (busy || !compInfo || !compInfo.subLayer) return;
        CEP.call('ensureLayer', layerOpts(readSettings())).catch(function (e) { log(t('l.error', { msg: e.message }), 'err'); });
      });
    });

    // Selector de modelo
    $('modelBtn').onclick = function (e) {
      e.stopPropagation();
      var list = $('modelList');
      if (!list.classList.contains('hidden')) { list.classList.add('hidden'); return; }
      var r = $('modelBtn').getBoundingClientRect();
      var above = r.top - 34, below = window.innerHeight - r.bottom - 6;
      var down = below >= Math.min(260, above);
      list.classList.toggle('down', down);
      list.style.maxHeight = Math.max(120, Math.min(300, down ? below : above)) + 'px';
      list.classList.remove('hidden');
    };
    document.addEventListener('click', function () { $('modelList').classList.add('hidden'); closeFontPop(); });
    $('quota').onclick = function () { showTab('settings'); };

    // Editar
    $('btnLoadSubs').onclick = loadSubs;
    $('btnAddSub').onclick = insertAtCursor;
    $('subChanged').addEventListener('click', function (e) { if (e.target && e.target.id === 'subReload') loadSubs(); });
    $('btnSaveSubs').onclick = saveSubs;
    $('subSearch').oninput = renderEditor;

    // Exportar
    $('btnExport').onclick = exportSubs;

    // Log
    $('logCopy').onclick = copyLog;
    $('logClear').onclick = function () { logEntries = []; $('logList').innerHTML = '<p class="muted">' + t('log.empty') + '</p>'; };

    // Ajustes
    $('uiLang').onchange = function () { persistSettings(); applyLanguage(); log(t('l.lang', { lang: I18N.lang === 'en' ? 'English' : 'Español' })); };
    $('setToggle').onclick = function () { $('setKey').type = $('setKey').type === 'password' ? 'text' : 'password'; };
    $('setSaveKey').onclick = function () { validateAndSaveKey($('setKey').value, $('setStatus')); };
    $('setWizard').onclick = function () { showWizard(1); };
    $('setDeleteKey').onclick = function () {
      if (!confirm(t('key.confirmDelete'))) return;
      Config.set('apiKey', ''); updateKeyUI();
      log(t('l.keyDeleted'));
      setStatus($('setStatus'), t('key.deleted'), '');
    };
    $('refreshModels').onclick = function () {
      if (!Config.hasKey()) { setStatus($('setStatus'), t('key.needFirst'), 'err'); return; }
      Gemini.listModels(Config.get('apiKey')).then(function (m) {
        Config.set('models', m); fillModels(m);
        log(t('l.modelsUpdated', { n: m.length }));
        setStatus($('setStatus'), t('models.updated'), 'ok');
      }, function (e) { setStatus($('setStatus'), '✖ ' + e.message, 'err'); });
    };
    $('limitRpd').onchange = function () {
      var v = Number($('limitRpd').value);
      Quota.setLimit(Config.get('model'), v);
      log(t('l.limitSet', { model: Config.get('model'), n: v }));
      updateQuota();
    };
    $('openLimits').onclick = function () { CEP.openURL('https://aistudio.google.com/usage'); };

    CEP.ensureHost().then(function () {
      return refreshComp();
    }).then(function () {
      // Valores por defecto según la composición la primera vez
      var s0 = Config.getSettings();
      if (compInfo && compInfo.comp) {
        if (!s0.boxWidth) $('boxWidth').value = Math.round(compInfo.comp.width * 0.8);
        if (!s0.fontSize) $('fontSize').value = Math.round(compInfo.comp.height * 0.065);
        if (s0.bottomPad == null) $('bottomPad').value = Math.round(compInfo.comp.height * 0.08);
      }
      return loadFonts();
    }).catch(function (e) {
      log(t('l.connErr', { msg: e.message }), 'err');
    });
    setInterval(refreshComp, 3000);
    setInterval(updateQuota, 30000);

    if (!Config.hasKey()) showWizard(1);
  }

  init();
})();
