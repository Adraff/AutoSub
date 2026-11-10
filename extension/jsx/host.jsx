/*
 * AutoSub - script host para After Effects (ExtendScript / ES3).
 *
 * Idea central: TODOS los subtitulos viven en UNA sola capa de texto.
 *  - Cada subtitulo es un marcador de capa (comentario = texto, duracion = tiempo en pantalla).
 *  - Una expresion en "Texto de origen" muestra el marcador activo.
 *  - Como es una sola capa, cambiar fuente/tamano/color/trazo en el panel Caracter
 *    afecta a todos los subtitulos a la vez.
 *  - Las palabras con sus tiempos se guardan en el comentario de la capa para poder
 *    reorganizar sin volver a llamar a la IA.
 *
 * Nota: este archivo evita caracteres no ASCII literales; se usan secuencias \u.
 */

var AutoSub = (function () {

  var TAG = 'AUTOSUB1';
  var LAYER_NAME = 'AutoSub - Subtitulos';
  var BG_NAME = 'AutoSub - Fondo';

  var FX = {
    offset: 'Desfase (fotogramas)',
    fade: 'Fundido (fotogramas)',
    pop: 'Pop (%)',
    bgOpacity: 'Fondo: Opacidad',
    bgColor: 'Fondo: Color',
    bgPad: 'Fondo: Margen',
    bgRound: 'Fondo: Redondez'
  };

  // ------------------------------------------------------------------ JSON (ES3)
  function q(s) {
    s = String(s);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 32 || code > 126) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
      else out += c;
    }
    return out + '"';
  }

  function stringify(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return q(v);
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(stringify(v[i]));
      return '[' + a.join(',') + ']';
    }
    var parts = [];
    for (var k in v) {
      if (v.hasOwnProperty(k) && typeof v[k] !== 'function') parts.push(q(k) + ':' + stringify(v[k]));
    }
    return '{' + parts.join(',') + '}';
  }

  function parse(s) {
    // Solo se usa con datos generados por el propio panel.
    return eval('(' + s + ')');
  }

  // ------------------------------------------------------------------ utilidades
  function activeComp() {
    var c = app.project && app.project.activeItem;
    if (!c || !(c instanceof CompItem)) {
      throw new Error('Abre o selecciona una composici\u00f3n en la l\u00ednea de tiempo.');
    }
    return c;
  }

  function textDocProp(layer) {
    return layer.property('ADBE Text Properties').property('ADBE Text Document');
  }

  function isAutoSubLayer(layer) {
    return layer instanceof TextLayer && String(layer.comment || '').indexOf(TAG) === 0;
  }

  function findSubLayer(comp) {
    var sel = comp.selectedLayers, i;
    for (i = 0; i < sel.length; i++) if (isAutoSubLayer(sel[i])) return sel[i];
    for (i = 1; i <= comp.numLayers; i++) if (isAutoSubLayer(comp.layer(i))) return comp.layer(i);
    return null;
  }

  function requireSubLayer(comp) {
    var l = findSubLayer(comp);
    if (!l) throw new Error('No hay ninguna capa de AutoSub en esta composici\u00f3n. Genera los subt\u00edtulos primero.');
    return l;
  }

  function readStore(layer) {
    var c = String(layer.comment || '');
    if (c.indexOf(TAG) !== 0) return null;
    try { return parse(c.substring(TAG.length)); } catch (e) { return null; }
  }

  function writeStore(layer, data) {
    layer.comment = TAG + stringify(data);
  }

  function addSlider(layer, name, value) {
    var fx = layer.property('ADBE Effect Parade');
    var e = fx.property(name);
    if (!e) {
      e = fx.addProperty('ADBE Slider Control');
      e.name = name;
      e.property(1).setValue(value);
    }
    return e;
  }

  function addColor(layer, name, value) {
    var fx = layer.property('ADBE Effect Parade');
    var e = fx.property(name);
    if (!e) {
      e = fx.addProperty('ADBE Color Control');
      e.name = name;
      e.property(1).setValue(value);
    }
    return e;
  }

  // Fragmento comun de las expresiones: encuentra el marcador activo "k" (o null)
  // "tt" es el tiempo con el desfase global aplicado (positivo = subtitulos mas tarde).
  var EXPR_FIND_MARKER =
    'var tt = time - effect("' + FX.offset + '")(1) * thisComp.frameDuration;\n' +
    'var m = thisLayer.marker, k = null;\n' +
    'if (m.numKeys > 0) {\n' +
    '  var n = m.nearestKey(tt).index;\n' +
    '  if (m.key(n).time > tt) n--;\n' +
    '  if (n >= 1 && tt < m.key(n).time + m.key(n).duration) k = m.key(n);\n' +
    '}\n';

  var EXPR_TEXT =
    '// AutoSub: muestra el marcador activo. Usa | en el marcador para saltar de linea.\n' +
    EXPR_FIND_MARKER +
    '(k ? k.comment.replace(/\\s*\\|\\s*/g, "\\r") : "");';

  var EXPR_ANCHOR =
    '// AutoSub: ancla abajo-centro para que el texto crezca hacia arriba\n' +
    'var r = sourceRectAtTime(time, false);\n' +
    '[r.left + r.width / 2, r.top + r.height];';

  var EXPR_OPACITY =
    '// AutoSub: fundido de entrada/salida\n' +
    'var f = effect("' + FX.fade + '")(1) * thisComp.frameDuration;\n' +
    EXPR_FIND_MARKER +
    'var o = value;\n' +
    'if (f > 0 && k) { o = value * Math.max(0, Math.min(1, (tt - k.time) / f, (k.time + k.duration - tt) / f)); }\n' +
    'o;';

  var EXPR_SCALE =
    '// AutoSub: efecto "pop" al aparecer cada subtitulo\n' +
    'var p = effect("' + FX.pop + '")(1);\n' +
    EXPR_FIND_MARKER +
    'var s = value;\n' +
    'if (p != 0 && k) {\n' +
    '  var d = Math.min(0.25, k.duration / 2), x = (tt - k.time) / d;\n' +
    '  if (x < 1) { var e = 1 - Math.pow(1 - Math.max(0, x), 3); s = value * ((100 - p + p * e) / 100); }\n' +
    '}\n' +
    's;';

  function bgRef() { return 'var L = thisComp.layer("' + LAYER_NAME + '");\nvar r = L.sourceRectAtTime(time, false);\n'; }

  // ------------------------------------------------------------------ capa de subtitulos
  function createSubLayer(comp, opts) {
    var layer = comp.layers.addText('Subt\u00edtulo');
    layer.name = LAYER_NAME;
    layer.startTime = 0;
    layer.inPoint = 0;
    layer.outPoint = comp.duration;

    var prop = textDocProp(layer);
    var td = prop.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) {}
    var size = Number(opts.fontSize) || Math.round(comp.height * 0.065);
    td.fontSize = size;
    try { td.font = 'Arial-BoldMT'; } catch (e1) {}
    td.applyFill = true;
    td.fillColor = [1, 1, 1];
    td.applyStroke = true;
    td.strokeColor = [0, 0, 0];
    td.strokeWidth = Math.max(1, Math.round(size * 0.08));
    td.strokeOverFill = false;
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    td.text = 'Subt\u00edtulo de ejemplo';
    prop.setValue(td);

    layer.property('ADBE Transform Group').property('ADBE Position').setValue([comp.width / 2, comp.height * 0.92]);
    setupRig(layer);
    writeStore(layer, { v: 1, words: [], settings: {} });
    return layer;
  }

  /** Controles y expresiones de la capa. Se reaplica siempre para actualizar capas de versiones anteriores. */
  function setupRig(layer) {
    addSlider(layer, FX.offset, 0);
    addSlider(layer, FX.fade, 0);
    addSlider(layer, FX.pop, 0);
    var tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').expression = EXPR_ANCHOR;
    tr.property('ADBE Opacity').expression = EXPR_OPACITY;
    tr.property('ADBE Scale').expression = EXPR_SCALE;
    textDocProp(layer).expression = EXPR_TEXT;
  }

  function offsetSeconds(layer, comp) {
    var e = layer.property('ADBE Effect Parade').property(FX.offset);
    return e ? e.property(1).value * comp.frameDuration : 0;
  }

  function findLayerByName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    return null;
  }

  function ensureBackground(comp, layer, enabled) {
    var existing = findLayerByName(comp, BG_NAME);
    if (!enabled) {
      if (existing) existing.enabled = false;
      return;
    }
    if (existing) { existing.enabled = true; return; }

    // La expresion del fondo apunta a la capa por nombre: aseguramos el nombre correcto
    layer.name = LAYER_NAME;
    addSlider(layer, FX.bgOpacity, 70);
    addColor(layer, FX.bgColor, [0, 0, 0]);
    addSlider(layer, FX.bgPad, 20);
    addSlider(layer, FX.bgRound, 12);

    var sh = comp.layers.addShape();
    sh.name = BG_NAME;
    sh.startTime = 0; sh.inPoint = 0; sh.outPoint = comp.duration;
    var tr = sh.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue([0, 0]);
    tr.property('ADBE Position').setValue([0, 0]);

    var grp = sh.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    grp.name = 'Caja';
    sh.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Rect');
    sh.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Fill');

    // Volvemos a obtener las referencias (anadir propiedades invalida las anteriores)
    var vecs = sh.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group');
    var rect = vecs.property(1), fill = vecs.property(2);

    rect.property('ADBE Vector Rect Size').expression =
      bgRef() + 'var p = L.effect("' + FX.bgPad + '")(1), sc = L.transform.scale;\n' +
      '[(r.width + 2 * p) * sc[0] / 100, (r.height + 2 * p) * sc[1] / 100];';
    rect.property('ADBE Vector Rect Position').expression =
      bgRef() + 'L.toComp([r.left + r.width / 2, r.top + r.height / 2]);';
    rect.property('ADBE Vector Rect Roundness').expression =
      'thisComp.layer("' + LAYER_NAME + '").effect("' + FX.bgRound + '")(1);';
    fill.property('ADBE Vector Fill Color').expression =
      'thisComp.layer("' + LAYER_NAME + '").effect("' + FX.bgColor + '")(1);';
    sh.property('ADBE Transform Group').property('ADBE Opacity').expression =
      bgRef() + '(r.width > 0) ? L.effect("' + FX.bgOpacity + '")(1) * L.transform.opacity / 100 : 0;';

    sh.moveAfter(layer);
  }

  // ------------------------------------------------------------------ funciones expuestas
  var api = {};

  api.compInfo = function () {
    var c = app.project && app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return { comp: null };
    var sel = c.selectedLayers, selected = null;
    if (sel.length) {
      var l = sel[0];
      selected = { name: l.name, index: l.index, hasAudio: !!l.hasAudio, file: null };
      try { if (l.source && l.source.mainSource && l.source.mainSource.file) selected.file = l.source.mainSource.file.fsName; } catch (e) {}
    }
    var hasAudio = false;
    for (var i = 1; i <= c.numLayers; i++) {
      var ly = c.layer(i);
      if (ly.hasAudio && ly.audioEnabled) { hasAudio = true; break; }
    }
    var sub = findSubLayer(c);
    var store = sub ? readStore(sub) : null;
    return {
      comp: {
        name: c.name, width: c.width, height: c.height, duration: c.duration,
        frameRate: c.frameRate, workAreaStart: c.workAreaStart, workAreaDuration: c.workAreaDuration,
        hasAudio: hasAudio
      },
      selected: selected,
      subLayer: sub ? sub.name : null,
      hasWords: !!(store && store.words && store.words.length),
      savedSettings: store ? store.settings : null
    };
  };

  /** Renderiza el audio del area de trabajo a un archivo temporal (AIFF o WAV). */
  api.renderAudio = function (a) {
    var comp = activeComp();
    var hasAudio = false;
    for (var i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).hasAudio && comp.layer(i).audioEnabled) { hasAudio = true; break; }
    }
    if (!hasAudio) throw new Error('La composici\u00f3n no tiene capas con audio activado.');

    var rq = app.project.renderQueue;
    var paused = [];
    for (i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i);
      if (it.status === RQItemStatus.QUEUED) { it.render = false; paused.push(it); }
    }

    var item = rq.items.add(comp);
    var outPath = null, err = null;
    try {
      item.timeSpanStart = comp.workAreaStart;
      item.timeSpanDuration = comp.workAreaDuration;
      var om = item.outputModule(1);
      var tpl = null, tpls = om.templates;
      for (i = 0; i < tpls.length && !tpl; i++) if (/aiff/i.test(tpls[i])) tpl = tpls[i];
      for (i = 0; i < tpls.length && !tpl; i++) if (/wav/i.test(tpls[i])) tpl = tpls[i];

      var ext = '.aif';
      if (tpl) {
        om.applyTemplate(tpl);
        if (/wav/i.test(tpl)) ext = '.wav';
      } else {
        var tries = [
          { 'Format': 'WAV', 'Output Audio': 'On', 'Video Output': 'false' },
          { 'Format': 'WAV' },
          { 'Format': 'AIFF' }
        ];
        var okFmt = false;
        for (i = 0; i < tries.length && !okFmt; i++) {
          try { om.setSettings(tries[i]); } catch (e) { continue; }
          var f = String(om.getSettings(GetSettingsFormat.STRING)['Format'] || '');
          if (/wav/i.test(f)) { okFmt = true; ext = '.wav'; }
          else if (/aiff/i.test(f)) { okFmt = true; ext = '.aif'; }
        }
        if (!okFmt) throw new Error('No se encontr\u00f3 una plantilla de salida de solo audio (AIFF/WAV).');
      }

      var folder = new Folder(a.folder);
      if (!folder.exists) folder.create();
      om.file = new File(folder.fsName + '/autosub_' + new Date().getTime() + ext);
      rq.render();
      outPath = om.file.fsName;
    } catch (e2) {
      err = e2;
    }
    try { item.remove(); } catch (e3) {}
    for (i = 0; i < paused.length; i++) { try { paused[i].render = true; } catch (e4) {} }
    if (err) throw err;

    var outFile = new File(outPath);
    if (!outFile.exists) throw new Error('El render de audio no gener\u00f3 ning\u00fan archivo.');
    return { path: outFile.fsName, offset: comp.workAreaStart, duration: comp.workAreaDuration };
  };

  /** Datos del archivo original de la capa seleccionada. */
  api.layerSource = function () {
    var comp = activeComp();
    var l = comp.selectedLayers[0];
    if (!l) throw new Error('Selecciona en la l\u00ednea de tiempo la capa de v\u00eddeo o audio a subtitular.');
    if (!l.source || !l.source.mainSource || !l.source.mainSource.file) {
      throw new Error('La capa seleccionada no procede de un archivo (selecciona un v\u00eddeo o audio importado).');
    }
    if (!l.hasAudio) throw new Error('La capa seleccionada no tiene audio.');
    return {
      path: l.source.mainSource.file.fsName,
      startTime: l.startTime,
      stretch: l.stretch,
      inPoint: l.inPoint,
      outPoint: l.outPoint,
      duration: l.source.duration
    };
  };

  /** Crea (o reutiliza) la capa de subtitulos. */
  api.ensureLayer = function (a) {
    var comp = activeComp();
    var layer = findSubLayer(comp);
    if (!layer) layer = createSubLayer(comp, a || {});
    else setupRig(layer);
    ensureBackground(comp, layer, !!a.background);
    return { name: layer.name };
  };

  /** Mide en pixeles de la composicion el ancho de cada palabra con el estilo actual de la capa. */
  api.measure = function (a) {
    var comp = activeComp();
    var layer = requireSubLayer(comp);
    var dup = layer.duplicate();
    var out = { widths: {}, space: 0, avgChar: 0 };
    try {
      dup.enabled = false;
      var prop = textDocProp(dup);
      prop.expressionEnabled = false;
      var t = dup.inPoint;
      var scaleX = Math.abs(layer.property('ADBE Transform Group').property('ADBE Scale').value[0]) / 100;
      var td = prop.value;

      var measure = function (s) {
        td.text = s;
        prop.setValue(td);
        return dup.sourceRectAtTime(t, false).width * scaleX;
      };

      var w2 = measure('xx');
      out.space = Math.max(1, measure('x x') - w2);
      out.avgChar = measure('abcdefghijklmnopqrstuvwxyz') / 26;
      var words = a.words || [];
      for (var i = 0; i < words.length; i++) out.widths[words[i]] = measure(words[i]);
    } finally {
      dup.remove();
    }
    return out;
  };

  /** Escribe los subtitulos como marcadores y guarda las palabras para reorganizar despues. */
  api.apply = function (a) {
    var comp = activeComp();
    var layer = requireSubLayer(comp);
    var mk = layer.property('ADBE Marker');
    for (var i = mk.numKeys; i >= 1; i--) mk.removeKey(i);

    var segs = a.segments || [];
    var times = [], values = [];
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      var mv = new MarkerValue(String(s.text).replace(/\r\n?|\n/g, ' | '));
      mv.duration = Math.max(0.04, s.end - s.start);
      times.push(s.start);
      values.push(mv);
    }
    if (times.length) {
      try { mk.setValuesAtTimes(times, values); }
      catch (e) { for (i = 0; i < times.length; i++) mk.setValueAtTime(times[i], values[i]); }
    }
    if (layer.outPoint < comp.duration) layer.outPoint = comp.duration;

    if (a.words) writeStore(layer, { v: 1, words: a.words, settings: a.settings || {} });
    else {
      var st = readStore(layer) || { v: 1, words: [] };
      st.settings = a.settings || st.settings;
      writeStore(layer, st);
    }
    return { count: segs.length };
  };

  /** Palabras guardadas en la capa. */
  api.getStore = function () {
    var comp = activeComp();
    var layer = requireSubLayer(comp);
    return readStore(layer) || { v: 1, words: [], settings: {} };
  };

  /** Lee los subtitulos actuales (marcadores) de la capa. */
  api.readSubs = function () {
    var comp = activeComp();
    var layer = requireSubLayer(comp);
    var mk = layer.property('ADBE Marker');
    var list = [];
    for (var i = 1; i <= mk.numKeys; i++) {
      var v = mk.keyValue(i);
      var t = mk.keyTime(i);
      list.push({ start: t, end: t + v.duration, text: String(v.comment).replace(/\s*\|\s*/g, '\n') });
    }
    return { subs: list, offset: offsetSeconds(layer, comp), workAreaStart: comp.workAreaStart, compName: comp.name };
  };

  /** Reescribe los subtitulos editados en el panel. */
  api.writeSubs = function (a) {
    return api.apply({ segments: a.subs || [] });
  };

  api.gotoTime = function (a) {
    var comp = activeComp();
    comp.time = Math.max(0, Math.min(comp.duration, Number(a.t) || 0));
    return true;
  };

  var MUTATING = { ensureLayer: 1, apply: 1, writeSubs: 1, measure: 1, renderAudio: 1 };

  return {
    dispatch: function (fn, argsJSON) {
      var undo = false;
      try {
        if (!api.hasOwnProperty(fn)) throw new Error('Funci\u00f3n desconocida: ' + fn);
        var args = argsJSON ? parse(argsJSON) : {};
        if (MUTATING[fn] && fn !== 'renderAudio') { app.beginUndoGroup('AutoSub'); undo = true; }
        var data = api[fn](args || {});
        if (undo) app.endUndoGroup();
        return stringify({ ok: true, data: data });
      } catch (e) {
        if (undo) { try { app.endUndoGroup(); } catch (e2) {} }
        return stringify({ ok: false, error: (e && e.message) ? e.message : String(e) });
      }
    }
  };
})();
