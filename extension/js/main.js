/*
 * Lógica principal del panel AutoSub (After Effects).
 *
 *  - Generar: SOLO crea capas de subtítulos nuevas (cada generación es una capa propia).
 *    Sus ajustes son los valores por defecto para la próxima generación y no tocan capas existentes.
 *  - Editar: estilo y subtítulos de la capa de AutoSub seleccionada en la línea de tiempo
 *    (o la única que haya). Así se pueden tener varias capas y editarlas por separado.
 *  - Exportar: exporta la capa seleccionada.
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

  // ================================================================ ESTADO DEL TRABAJO
  // Hay una barra de progreso en Generar (#job) y otra en Editar (#jobEdit).
  var fakeTimer = null;
  var jobBoxId = 'job';

  function jobEl(sel) { return $(jobBoxId).querySelector(sel); }

  /** Muestra qué se está haciendo y el porcentaje. p: 0..1, o null para ocultar. */
  function job(text, p, cls) {
    stopFake();
    var box = $(jobBoxId);
    if (p === null) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var tx = jobEl('.jtext');
    tx.className = 'jtext ' + (cls || '');
    if (cls === 'err') {
      tx.innerHTML = escapeHTML(text) + ' · <a class="jlog">' + t('log.view') + '</a>';
      tx.querySelector('.jlog').onclick = function () { showTab('log'); };
    } else {
      tx.textContent = text;
    }
    jobEl('.jpct').textContent = cls === 'err' ? '' : Math.round(p * 100) + '%';
    jobEl('.bar').style.width = Math.round(p * 100) + '%';
    jobEl('.bar').style.background = cls === 'err' ? 'var(--err)' : (cls === 'ok' ? 'var(--ok)' : '');
  }

  /** Progreso estimado mientras esperamos a la IA (Google no informa del avance). */
  function jobWaiting(text, from, to, estSeconds) {
    var t0 = Date.now();
    job(text, from);
    fakeTimer = setInterval(function () {
      var el = (Date.now() - t0) / 1000;
      var p = from + (to - from) * (1 - Math.exp(-el / estSeconds));
      jobEl('.jtext').textContent = text + ' · ' + Math.round(el) + ' s';
      jobEl('.jpct').textContent = Math.round(p * 100) + '%';
      jobEl('.bar').style.width = Math.round(p * 100) + '%';
    }, 500);
  }

  function stopFake() { if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; } }

  function setBusy(b) {
    busy = b;
    ['btnGenerate', 'btnReflow', 'btnSaveSubs', 'btnExport'].forEach(function (id) { $(id).disabled = b; });
  }

  // ================================================================ AJUSTES (pestaña Generar)
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
      interpret: $('interpret').checked,
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
    if (s.maxLines) setSeg('maxLines', s.maxLines);
    if (s.fontSize) $('fontSize').value = s.fontSize;
    if (s.bottomPad != null) $('bottomPad').value = s.bottomPad;
    if ('background' in s) $('bgBox').checked = !!s.background;
    if ('stroke' in s) $('stroke').checked = !!s.stroke;
    if ('shadow' in s) $('shadow').checked = !!s.shadow;
    $('interpret').checked = !!s.interpret;
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

  function setSeg(id, v) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' button'), function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-v')) === Number(v));
    });
  }
  function getSeg(id) {
    var b = document.querySelector('#' + id + ' button.on');
    return b ? Number(b.getAttribute('data-v')) : 2;
  }

  // ================================================================ IDIOMA DEL PANEL
  function applyLanguage() {
    I18N.setLang(Config.getSettings().uiLang || 'auto');
    I18N.apply(document);
    updateKeyUI();
    if (models.length) { renderModelList(); selectModel(Config.get('model'), true); }
    updateQuota();
    genFonts.render();
    editFonts.render();
    updateEditorBar();
    renderCompInfo();
    updateTabs();
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
      current = models[0].id;
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
  // Desplegable con buscador: todas las familias (cada una con su propia letra). Hay dos:
  // uno en Generar (tipografía por defecto) y otro en Editar (la de la capa seleccionada).
  var fonts = [];          // [{ f: familia, s: [[estilo, postScriptName], ...] }]

  function findFontByPS(ps) {
    for (var i = 0; i < fonts.length; i++) {
      for (var j = 0; j < fonts[i].s.length; j++) if (fonts[i].s[j][1] === ps) return { fam: fonts[i], style: fonts[i].s[j] };
    }
    return null;
  }

  function FontPicker(prefix, onPick) {
    var ids = { btn: prefix + 'FontBtn', pop: prefix + 'FontPop', search: prefix + 'FontSearch', list: prefix + 'FontList', name: prefix + 'FontName', style: prefix + 'FontStyle' };
    if (!prefix) ids = { btn: 'fontBtn', pop: 'fontPop', search: 'fontSearch', list: 'fontList', name: 'fontName', style: 'fontStyle' };
    var self = { family: null };
    var hl = -1, shown = [];

    function fillStyles(fam, selectPS) {
      var sel = $(ids.style);
      sel.innerHTML = '';
      fam.s.forEach(function (st) {
        var o = document.createElement('option');
        o.value = st[1]; o.textContent = st[0];
        sel.appendChild(o);
      });
      if (selectPS && fam.s.some(function (st) { return st[1] === selectPS; })) sel.value = selectPS;
      else {
        var pick = fam.s.filter(function (st) { return /^bold$|^negrita$/i.test(st[0]); })[0] ||
          fam.s.filter(function (st) { return /regular|normal|book/i.test(st[0]); })[0] || fam.s[0];
        sel.value = pick[1];
      }
    }

    self.render = function () {
      if (!fonts.length) return;
      $(ids.name).textContent = self.family ? self.family.f : '—';
      $(ids.name).style.fontFamily = self.family ? '"' + self.family.f + '", sans-serif' : '';
    };

    /** Muestra la fuente con ese nombre PostScript (sin aplicar nada). */
    self.show = function (ps, fallback) {
      var hit = (ps && findFontByPS(ps)) || (fallback && findFontByPS(fallback)) || findFontByPS('Arial-BoldMT') ||
        (fonts[0] && { fam: fonts[0], style: fonts[0].s[0] });
      if (!hit) return;
      self.family = hit.fam;
      fillStyles(hit.fam, hit.style[1]);
      self.render();
    };

    self.value = function () { return $(ids.style).value; };
    self.label = function () { return (self.family ? self.family.f : '') + ' ' + (($(ids.style).selectedOptions[0] || {}).textContent || ''); };

    function renderList() {
      var q = $(ids.search).value.trim().toLowerCase();
      shown = q ? fonts.filter(function (f) { return f.f.toLowerCase().indexOf(q) >= 0; }) : fonts;
      var box = $(ids.list);
      box.innerHTML = '';
      if (!shown.length) { box.innerHTML = '<div class="fsel-none">' + t('gen.fontNone') + '</div>'; return; }
      var frag = document.createDocumentFragment();
      shown.forEach(function (fam, i) {
        var o = document.createElement('div');
        o.className = 'fopt' + (fam === self.family ? ' sel' : '') + (i === hl ? ' hl' : '');
        o.textContent = fam.f;
        o.style.fontFamily = '"' + fam.f + '", sans-serif';
        o.onmousedown = function (e) { e.preventDefault(); choose(fam); };
        frag.appendChild(o);
      });
      box.appendChild(frag);
    }

    function open() {
      if (!fonts.length) return;
      var pop = $(ids.pop), r = $(ids.btn).getBoundingClientRect();
      pop.classList.toggle('up', window.innerHeight - r.bottom < 220 && r.top > window.innerHeight - r.bottom);
      pop.classList.remove('hidden');
      $(ids.search).value = '';
      hl = -1;
      renderList();
      var sel = $(ids.list).querySelector('.sel');
      if (sel) $(ids.list).scrollTop = sel.offsetTop - 60;
      setTimeout(function () { $(ids.search).focus(); }, 0);
    }
    self.close = function () { $(ids.pop).classList.add('hidden'); };

    function choose(fam) {
      self.close();
      self.family = fam;
      fillStyles(fam);
      self.render();
      onPick(self.value());
    }

    $(ids.btn).onclick = function (e) {
      e.stopPropagation();
      var willOpen = $(ids.pop).classList.contains('hidden');
      genFonts.close(); editFonts.close();
      if (willOpen) open();
    };
    $(ids.pop).onclick = function (e) { e.stopPropagation(); };
    $(ids.search).oninput = function () { hl = 0; renderList(); $(ids.list).scrollTop = 0; };
    $(ids.search).onkeydown = function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        hl = Math.max(0, Math.min(shown.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
        renderList();
        var h = $(ids.list).querySelector('.hl');
        if (h) h.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (shown[Math.max(0, hl)]) choose(shown[Math.max(0, hl)]);
      } else if (e.key === 'Escape') self.close();
    };
    $(ids.style).addEventListener('change', function () { onPick(self.value()); });
    return self;
  }

  var genFonts = null, editFonts = null;

  function loadFonts() {
    return CEP.call('getFonts').then(function (r) {
      if (!r.supported || !r.fonts.length) {
        $('fontName').textContent = t('gen.fontNeeds'); $('eFontName').textContent = t('gen.fontNeeds');
        $('fontBtn').disabled = true; $('fontStyle').disabled = true;
        $('eFontBtn').disabled = true; $('eFontStyle').disabled = true;
        log(t('l.fontsNeed'), 'warn');
        return;
      }
      fonts = r.fonts.sort(function (a, b) { return a.f.localeCompare(b.f); });
      $('fontCount').textContent = t('gen.fontCount', { n: fonts.length });
      log(t('l.fontsLoaded', { n: fonts.length }));
      genFonts.show(Config.getSettings().font, 'Arial-BoldMT');
      if (editStyle) editFonts.show(editStyle.font);
    }).catch(function (e) { log(t('l.fontsFail', { msg: e.message }), 'warn'); });
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

  // ================================================================ COMPOSICIÓN Y CAPA DE TRABAJO
  function renderCompInfo() {
    var el = $('compInfo'), info = compInfo;
    if (!info) return;
    if (!info.comp) { el.innerHTML = '<span class="w">' + t('gen.openComp') + '</span>'; el.title = ''; return; }
    var c = info.comp;
    var wa = fmtTime(c.workAreaStart) + '–' + fmtTime(c.workAreaStart + c.workAreaDuration);
    var nSubs = (info.subLayers || []).length;
    el.innerHTML = (c.hasAudio ? '' : '<span class="w">' + t('gen.noAudio') + '</span>') +
      '<b>' + escapeHTML(c.name) + '</b> · ' + c.width + '×' + c.height + ' · ' + wa + (nSubs ? t('gen.hasSubs') + (nSubs > 1 ? ' ×' + nSubs : '') : '');
    el.title = c.name + '\n' + c.width + '×' + c.height + ' · ' + c.frameRate.toFixed(2) + ' fps\n' + t('gen.workArea') + ': ' + wa +
      (info.selected ? '\n' + t('gen.selLayer') + ': ' + info.selected.name : '');
  }

  function hasAnySubs() {
    return !!(compInfo && compInfo.subLayers && compInfo.subLayers.some(function (l) { return l.markers > 0; }));
  }

  /** Muestra en Editar/Exportar sobre qué capa se trabaja, o pide elegir una si hay varias. */
  function renderTarget(id, action) {
    var el = $(id);
    if (!compInfo || !compInfo.comp) { el.className = 'target'; el.textContent = ''; return false; }
    if (compInfo.subIndex) {
      el.className = 'target';
      el.innerHTML = t('target.layer', { name: escapeHTML(compInfo.subLayer) });
      return true;
    }
    el.className = 'target warn';
    el.textContent = t('target.pick', { n: (compInfo.subLayers || []).length, action: t(action) });
    return false;
  }

  /** Editar y Exportar solo se pueden usar cuando ya hay subtítulos generados. */
  function updateTabs() {
    var ok = hasAnySubs();
    ['tabEdit', 'tabExport'].forEach(function (id) {
      $(id).disabled = !ok;
      $(id).title = ok ? '' : t('tab.edit.locked');
    });
    if (!ok && ($('tab-edit').classList.contains('active') || $('tab-export').classList.contains('active'))) showTab('gen');
    var editOk = renderTarget('editTarget', 'target.edit');
    $('editBody').classList.toggle('off', !editOk);
    var expOk = renderTarget('exportTarget', 'target.export');
    if (!busy) $('btnExport').disabled = !expOk;
  }

  var lastTarget = null;
  function refreshComp() {
    if (busy || !CEP.available) return Promise.resolve();
    return CEP.call('compInfo').then(function (info) {
      compInfo = info;
      renderCompInfo();
      updateTabs();
      // Si cambia la capa de trabajo (otra selección), se recarga Editar
      var key = info.subIndex ? info.subIndex + '|' + info.subLayer : null;
      if (key !== lastTarget) {
        lastTarget = key;
        editorSubs = []; editorSig = null; editStyle = null;
        if ($('tab-edit').classList.contains('active') && key) { loadEditStyle(); loadSubs(); }
      } else if (info.comp) {
        checkEditorSync();
      }
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

  /** Mide palabras, segmenta y escribe los subtítulos en la capa indicada (índice). */
  function layoutAndApply(words, settings, storeWords, p0, layerIdx) {
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
      return CEP.call('countLines', { layer: layerIdx, texts: multi.map(function (s) { return s.text; }) }).then(function (counts) {
        var over = multi.filter(function (s, i) { return counts[i] > settings.maxLines && s.w1 > s.w0; });
        if (!over.length) return segs;
        if (pass < 2) {
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

    return CEP.call('measure', { layer: layerIdx, words: list }).then(function (m) {
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
      var payload = { layer: layerIdx, segments: segs, settings: settings };
      if (storeWords) payload.words = words.map(function (w) { return w.p != null ? [w.w, w.s, w.e, w.p] : [w.w, w.s, w.e]; });
      return CEP.call('apply', payload);
    });
  }

  /** Genera una capa de subtítulos NUEVA con los ajustes de la pestaña Generar. */
  function generate() {
    if (busy) return;
    if (!Config.hasKey()) { showWizard(1); return; }
    var apiKey = Config.get('apiKey');
    var model = Config.get('model');
    var q = Quota.status(model);
    if (q.exhausted && !confirm(t('q.confirmExhausted'))) return;

    var settings = readSettings();
    var mode = settings.interpret ? 'interpret' : 'literal';
    persistSettings();
    jobBoxId = 'job';
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

      var aiWords = res.words;
      if (prep && prep.trimmed) {
        aiWords = aiWords.map(function (w) {
          var s = prep.toOriginal(w.s), e = prep.toOriginal(w.e);
          return { w: w.w, s: s, e: Math.max(e, s + 0.05), p: w.p };
        });
      }
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
      // Siempre una capa NUEVA: así se pueden generar varios subtítulos en la misma composición
      return CEP.call('ensureLayer', {
        create: true, fontSize: settings.fontSize, background: settings.background, stroke: settings.stroke, shadow: settings.shadow,
        boxWidth: settings.boxWidth, maxLines: settings.maxLines, font: settings.font, bottomPad: settings.bottomPad
      }).then(function (layer) {
        log(t('l.newLayer', { name: layer.name }));
        return layoutAndApply(words, settings, true, 0.9, layer.index);
      });
    }).then(function (r) {
      job(t('job.done', { n: r.count }), 1, 'ok');
      log(t('l.done', { n: r.count }), 'ok');
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

  // ================================================================ EDITAR: ESTILO DE LA CAPA
  var editStyle = null;   // estilo leído de la capa de trabajo

  function targetIdx() { return compInfo && compInfo.subIndex; }

  function loadEditStyle() {
    if (!targetIdx()) return Promise.resolve();
    return CEP.call('layerStyle', { layer: targetIdx() }).then(function (s) {
      editStyle = s;
      $('eFontSize').value = s.fontSize;
      $('eBoxWidth').value = s.boxWidth;
      setSeg('eMaxLines', s.maxLines);
      $('eStroke').checked = s.stroke;
      $('eShadow').checked = s.shadow;
      $('eBg').checked = s.background;
      $('btnReflow').disabled = busy || !s.hasWords;
      if (fonts.length) editFonts.show(s.font);
    }).catch(function (e) { log(t('l.error', { msg: e.message }), 'err'); });
  }

  function editValues() {
    return {
      layer: targetIdx(),
      font: editFonts.value() || (editStyle && editStyle.font),
      fontSizeSet: Number($('eFontSize').value) || 0,
      boxWidth: Number($('eBoxWidth').value) || (editStyle && editStyle.boxWidth) || 1000,
      maxLines: getSeg('eMaxLines'),
      stroke: $('eStroke').checked,
      shadow: $('eShadow').checked,
      background: $('eBg').checked
    };
  }

  /** Aplica a la capa seleccionada el trazo, la sombra y la caja de fondo (sin reorganizar). */
  function applyEditToggles() {
    if (busy || !targetIdx()) return;
    var v = editValues();
    CEP.call('ensureLayer', { layer: v.layer, stroke: v.stroke, shadow: v.shadow, background: v.background, boxWidth: v.boxWidth, maxLines: v.maxLines })
      .then(function (r) { log(t('l.styleApplied', { name: r.name })); })
      .catch(function (e) { log(t('l.error', { msg: e.message }), 'err'); });
  }

  /** Aplica tipografía/tamaño/caja a la capa seleccionada y vuelve a repartir sus subtítulos. */
  function reflowTarget() {
    if (busy || !targetIdx()) return;
    var v = editValues();
    jobBoxId = 'jobEdit';
    setBusy(true);
    logRun(t('l.run.reflow') + ' · ' + (compInfo.subLayer || ''));
    job(t('job.readWords'), 0.1);
    CEP.call('getStore', { layer: v.layer }).then(function (store) {
      return CEP.call('ensureLayer', v).then(function () {
        if (!store.words || !store.words.length) return null; // sin palabras guardadas: solo estilo
        var words = store.words.map(function (a) { return { w: a[0], s: a[1], e: a[2], p: a[3] }; });
        // Ajustes de tiempos con los que se generó la capa + los valores de la caja editados
        var gen = readSettings(), s = store.settings || {};
        var settings = {
          boxWidth: v.boxWidth, maxLines: v.maxLines,
          gapBreak: s.gapBreak || gen.gapBreak, maxDuration: s.maxDuration || gen.maxDuration,
          breakPunct: 'breakPunct' in s ? s.breakPunct : gen.breakPunct,
          keepSilence: 'keepSilence' in s ? s.keepSilence : gen.keepSilence
        };
        for (var k in s) if (!(k in settings)) settings[k] = s[k];
        return layoutAndApply(words, settings, false, 0.3, v.layer);
      });
    }).then(function (r) {
      if (r) { job(t('job.reflowed', { n: r.count }), 1, 'ok'); log(t('l.reflowed', { n: r.count }), 'ok'); }
      else job('✔', 1, 'ok');
      editorSubs = []; editorSig = null;
    }).catch(function (e) {
      log(t('l.error', { msg: e.message }), 'err');
      job('✖ ' + e.message, 1, 'err');
    }).then(function () {
      setBusy(false);
      refreshComp().then(function () { loadEditStyle(); loadSubs(); });
    });
  }

  // ================================================================ EDITAR: SUBTÍTULOS
  // Cada fila recuerda su estado original. Al guardar solo se envían los CAMBIOS hechos aquí;
  // así no se pisan los ajustes hechos a mano en la línea de tiempo (mover o alargar marcadores).
  var editorSubs = [];
  var editorSig = null;

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
    if (!targetIdx()) { editorSubs = []; renderEditor(); return; }
    CEP.call('readSubs', { layer: targetIdx() }).then(function (r) {
      editorSubs = r.subs.map(function (s) {
        return { start: s.start, end: s.end, text: s.text, orig: { start: s.start, end: s.end, text: s.text } };
      });
      editorSig = compInfo ? compInfo.markerSig : null;
      $('subChanged').classList.add('hidden');
      renderEditor(); updateEditorBar();
    }).catch(function (e) { $('subList').innerHTML = '<p class="status err">' + escapeHTML(e.message) + '</p>'; });
  }

  function checkEditorSync() {
    if (!compInfo || editorSig === null || compInfo.markerSig === editorSig) return;
    if (!editorDirty()) { loadSubs(); return; }
    $('subChanged').classList.remove('hidden');
  }

  function saveSubs() {
    if (busy || !targetIdx()) return;
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
    CEP.call('patchSubs', { layer: targetIdx(), changes: changes, inserts: inserts }).then(function (r) {
      log(t('l.editSaved', { c: changes.length, i: inserts.length, n: r.count }), 'ok');
      if (r.missing) log(t('l.editMissing', { n: r.missing }), 'warn');
      setBusy(false);
      return refreshComp();
    }).then(function () { loadSubs(); })
      .catch(function (e) { setBusy(false); log(t('l.editErr', { msg: e.message }), 'err'); alert(e.message); });
  }

  // ================================================================ EXPORTAR
  function exportSubs() {
    if (!targetIdx()) return;
    var s = readSettings();
    persistSettings();
    var st = $('exportStatus');
    var fmt = Exporters.formats[s.exportFormat];
    setStatus(st, t('exp.reading'), 'busy');
    var L = { layer: targetIdx() };
    Promise.all([CEP.call('readSubs', L), CEP.call('getStore', L).catch(function () { return { words: [] }; })]).then(function (res) {
      var r = res[0], store = res[1];
      if (!r.subs.length) throw new Error(t('exp.none'));
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
      var base = (r.compName || 'subtitles') + ((compInfo.subLayers || []).length > 1 ? ' - ' + compInfo.subLayer : '');
      var defName = base.replace(/[\\/:*?"<>|]/g, '_') + '.' + fmt.ext;
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
    if ((name === 'edit' && $('tabEdit').disabled) || (name === 'export' && $('tabExport').disabled)) return;
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-tab') === name); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'edit') { if (!editStyle) loadEditStyle(); if (!editorSubs.length) loadSubs(); }
    if (name === 'log') { $('logDot').className = 'dot hidden'; $('logList').scrollTop = $('logList').scrollHeight; }
    if (name === 'settings') updateQuota();
  }

  function init() {
    var saved = Config.getSettings();
    I18N.setLang(saved.uiLang || 'auto');
    I18N.apply(document);

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tb) {
      tb.onclick = function () { showTab(tb.getAttribute('data-tab')); };
    });
    initWizard();

    // Tipografía de Generar: solo es el valor por defecto de la próxima generación
    genFonts = FontPicker('', function (ps) {
      persistSettings();
      log(t('l.fontSel', { name: genFonts.label(), ps: ps }));
    });
    // Tipografía de Editar: se aplica a la capa seleccionada
    editFonts = FontPicker('e', function () { reflowTarget(); });

    writeSettings(saved);
    if (saved.bottomPad == null) $('bottomPad').value = '';
    fillModels(Config.get('models'));
    updateKeyUI();
    $('cfgPath').textContent = Config.file();
    log(t('l.start', { file: Config.file() }));
    log(t('l.lang', { lang: I18N.lang === 'en' ? 'English' : 'Español' }));

    // Generar
    $('btnGenerate').onclick = generate;
    $('boxWidth80').onclick = function () {
      if (compInfo && compInfo.comp) { $('boxWidth').value = Math.round(compInfo.comp.width * 0.8); persistSettings(); }
    };
    Array.prototype.forEach.call(document.querySelectorAll('#maxLines button'), function (b) {
      b.onclick = function (e) { e.preventDefault(); setSeg('maxLines', b.getAttribute('data-v')); persistSettings(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tab-gen input, #tab-gen select, #tab-export input, #tab-export select'), function (el) {
      if (el.closest('#fontRow')) return;
      el.addEventListener('change', persistSettings);
    });

    // Editar: estilo de la capa seleccionada
    $('btnReflow').onclick = reflowTarget;
    ['eStroke', 'eShadow', 'eBg'].forEach(function (id) { $(id).addEventListener('change', applyEditToggles); });
    ['eFontSize', 'eBoxWidth'].forEach(function (id) { $(id).addEventListener('change', reflowTarget); });
    Array.prototype.forEach.call(document.querySelectorAll('#eMaxLines button'), function (b) {
      b.onclick = function (e) { e.preventDefault(); setSeg('eMaxLines', b.getAttribute('data-v')); reflowTarget(); };
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
    document.addEventListener('click', function () { $('modelList').classList.add('hidden'); genFonts.close(); editFonts.close(); });
    $('quota').onclick = function () { showTab('settings'); };

    // Editar: lista
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
