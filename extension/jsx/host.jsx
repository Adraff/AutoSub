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

  // Idioma de los mensajes y de los nombres que se crean (lo envia el panel en cada llamada)
  var LANG = 'es';
  function M(es, en) { return LANG === 'en' ? en : es; }
  function nm(pair) { return LANG === 'en' ? pair[1] : pair[0]; }

  // Nombres en [espanol, ingles]. Se reconocen ambos, asi las capas creadas en un idioma
  // siguen funcionando si se cambia el idioma del panel.
  var NAMES = {
    layer: ['AutoSub - Subtitulos', 'AutoSub - Subtitles'],
    bg: ['AutoSub - Fondo', 'AutoSub - Background']
  };
  var FX = {
    offset: ['Desfase (fotogramas)', 'Offset (frames)'],
    fade: ['Fundido (fotogramas)', 'Fade (frames)'],
    pop: ['Pop (%)', 'Pop (%)'],
    bgOpacity: ['Fondo: Opacidad', 'Background: Opacity'],
    bgColor: ['Fondo: Color', 'Background: Color'],
    bgPad: ['Fondo: Margen', 'Background: Padding'],
    bgRound: ['Fondo: Redondez', 'Background: Roundness']
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
      throw new Error(M('Abre o selecciona una composici\u00f3n en la l\u00ednea de tiempo.', 'Open or select a composition on the timeline.'));
    }
    return c;
  }

  function textDocProp(layer) {
    return layer.property('ADBE Text Properties').property('ADBE Text Document');
  }

  function isAutoSubLayer(layer) {
    return layer instanceof TextLayer && String(layer.comment || '').indexOf(TAG) === 0;
  }

  function listSubLayers(comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) if (isAutoSubLayer(comp.layer(i))) out.push(comp.layer(i));
    return out;
  }

  /** Capa de fondo vinculada (por id) a una capa de subtitulos. */
  function bgOf(comp, layer) {
    var st = readStore(layer), id = st && st.id;
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i), c = String(l.comment || '');
      if (id && c === 'AUTOSUBBG:' + id) return l;
    }
    return null;
  }

  /**
   * Capa de subtitulos con la que se trabaja:
   *  1) la indicada por el panel (a.layer = indice), si es de AutoSub;
   *  2) la capa de AutoSub seleccionada en la linea de tiempo (o la de su fondo);
   *  3) si en la composicion solo hay una, esa.
   * Si hay varias y ninguna seleccionada, devuelve null (hay que elegir una).
   */
  function findSubLayer(comp, a) {
    var i, l;
    if (a && a.layer) {
      try { l = comp.layer(Number(a.layer)); } catch (e) { l = null; }
      if (l && isAutoSubLayer(l)) return l;
    }
    var subs = listSubLayers(comp), sel = comp.selectedLayers;
    for (i = 0; i < sel.length; i++) if (isAutoSubLayer(sel[i])) return sel[i];
    for (i = 0; i < sel.length; i++) {
      for (var j = 0; j < subs.length; j++) if (bgOf(comp, subs[j]) === sel[i]) return subs[j];
    }
    return subs.length === 1 ? subs[0] : null;
  }

  function requireSubLayer(comp, a) {
    var l = findSubLayer(comp, a);
    if (!l) {
      if (listSubLayers(comp).length > 1) throw new Error(M('Hay varias capas de subt\u00edtulos: selecciona en la l\u00ednea de tiempo la que quieres usar.', 'There are several subtitle layers: select the one you want on the timeline.'));
      throw new Error(M('No hay ninguna capa de AutoSub en esta composici\u00f3n. Genera los subt\u00edtulos primero.', 'There is no AutoSub layer in this composition. Generate the subtitles first.'));
    }
    return l;
  }

  function uniqueName(comp, base) {
    var name = base, n = 2, taken;
    do {
      taken = false;
      for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) { taken = true; break; }
      if (taken) name = base + ' ' + (n++);
    } while (taken);
    return name;
  }

  function newId() { return 'S' + new Date().getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function readStore(layer) {
    var c = String(layer.comment || '');
    if (c.indexOf(TAG) !== 0) return null;
    try { return parse(c.substring(TAG.length)); } catch (e) { return null; }
  }

  function writeStore(layer, data) {
    layer.comment = TAG + stringify(data);
  }

  function findFx(layer, key) {
    var fx = layer.property('ADBE Effect Parade');
    return fx.property(FX[key][0]) || fx.property(FX[key][1]) || null;
  }

  function fxName(layer, key) { var e = findFx(layer, key); return e ? e.name : nm(FX[key]); }

  function addSlider(layer, key, value) {
    var e = findFx(layer, key);
    if (!e) {
      e = layer.property('ADBE Effect Parade').addProperty('ADBE Slider Control');
      e.name = nm(FX[key]);
      e.property(1).setValue(value);
    }
    return e;
  }

  function addColor(layer, key, value) {
    var e = findFx(layer, key);
    if (!e) {
      e = layer.property('ADBE Effect Parade').addProperty('ADBE Color Control');
      e.name = nm(FX[key]);
      e.property(1).setValue(value);
    }
    return e;
  }

  // Fragmento comun de las expresiones: encuentra el marcador activo "k" (o null)
  // "tt" es el tiempo con el desfase global aplicado (positivo = subtitulos mas tarde).
  function exprFindMarker(L) {
    return 'var tt = time - effect("' + fxName(L, 'offset') + '")(1) * thisComp.frameDuration;\n' +
      'var m = thisLayer.marker, k = null;\n' +
      'if (m.numKeys > 0) {\n' +
      '  var n = m.nearestKey(tt).index;\n' +
      '  if (m.key(n).time > tt) n--;\n' +
      '  if (n >= 1 && tt < m.key(n).time + m.key(n).duration) k = m.key(n);\n' +
      '}\n';
  }

  function exprText(L) {
    return '// AutoSub: muestra el marcador activo / shows the active marker. "|" = salto de linea / line break\n' +
      exprFindMarker(L) +
      'var CR = String.fromCharCode(13);\n' +
      '(k ? k.comment.split(" | ").join(CR).split("|").join(CR) : "");';
  }

  function exprOpacity(L) {
    return '// AutoSub: fundido / fade\n' +
      'var f = effect("' + fxName(L, 'fade') + '")(1) * thisComp.frameDuration;\n' +
      exprFindMarker(L) +
      'var o = value;\n' +
      'if (f > 0 && k) { o = value * Math.max(0, Math.min(1, (tt - k.time) / f, (k.time + k.duration - tt) / f)); }\n' +
      'o;';
  }

  function exprScale(L) {
    return '// AutoSub: pop\n' +
      'var p = effect("' + fxName(L, 'pop') + '")(1);\n' +
      exprFindMarker(L) +
      'var s = value;\n' +
      'if (p != 0 && k) {\n' +
      '  var d = Math.min(0.25, k.duration / 2), x = (tt - k.time) / d;\n' +
      '  if (x < 1) { var e = 1 - Math.pow(1 - Math.max(0, x), 3); s = value * ((100 - p + p * e) / 100); }\n' +
      '}\n' +
      's;';
  }

  function bgRef(L) { return 'var L = thisComp.layer("' + L.name + '");\nvar r = L.sourceRectAtTime(time, false);\n'; }

  // ------------------------------------------------------------------ capa de subtitulos
  // La capa es un TEXTO DE PARRAFO (caja) del ancho elegido: After Effects reparte el texto
  // de corrido dentro de la caja. El texto se centra vertical y horizontalmente en la caja
  // y el punto de anclaje queda fijo en el centro de la caja (no salta entre subtitulos).

  var STYLE_KEYS = ['font', 'fontSize', 'applyFill', 'fillColor', 'applyStroke', 'strokeColor', 'strokeWidth',
    'strokeOverFill', 'tracking', 'fauxBold', 'fauxItalic', 'allCaps', 'smallCaps'];

  function scaleX(layer) {
    return Math.abs(layer.property('ADBE Transform Group').property('ADBE Scale').value[0]) / 100 || 1;
  }

  function boxHeight(td, maxLines) {
    var lead = td.fontSize * 1.2;
    try { if (td.autoLeading === false && td.leading > 0) lead = td.leading; } catch (e) {}
    return Math.ceil(lead * (maxLines + 1) + td.fontSize * 0.4);
  }

  /** Ajusta tamano de la caja, centrado y punto de anclaje (centro exacto de la caja). */
  function layoutBox(layer, opts) {
    var prop = textDocProp(layer);
    var td = prop.value;
    if (opts.font) { try { td.font = opts.font; } catch (e0) {} }
    if (opts.fontSizeSet > 0) td.fontSize = Number(opts.fontSizeSet);
    var sc = scaleX(layer);
    var maxLines = Math.max(1, Number(opts.maxLines) || 2);
    var w = Math.max(20, (Number(opts.boxWidth) || 1000) / sc);
    var h = boxHeight(td, maxLines);
    td.boxTextSize = [w, h];
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    try { td.boxVerticalAlignment = BoxVerticalAlignment.CENTER; } catch (e1) {}
    prop.setValue(td);

    var anchor = layer.property('ADBE Transform Group').property('ADBE Anchor Point');
    anchor.expression = '';
    var center = [0, 0];
    try {
      var t2 = prop.value, pos = t2.boxTextPos, size = t2.boxTextSize;
      center = [pos[0] + size[0] / 2, pos[1] + size[1] / 2];
    } catch (e2) {}
    var old = anchor.value;
    anchor.setValue(old.length > 2 ? [center[0], center[1], 0] : center);
    return h * sc;
  }

  function createSubLayer(comp, opts) {
    var size = Number(opts.fontSize) || Math.round(comp.height * 0.065);
    var layer = comp.layers.addBoxText([Number(opts.boxWidth) || comp.width * 0.8, size * 3], 'Subt\u00edtulo');
    layer.name = uniqueName(comp, nm(NAMES.layer));
    layer.startTime = 0;
    layer.inPoint = 0;
    layer.outPoint = comp.duration;

    var prop = textDocProp(layer);
    var td = prop.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) {}
    td.fontSize = size;
    try { td.font = opts.font || 'Arial-BoldMT'; } catch (e1) {}
    td.applyFill = true;
    td.fillColor = [1, 1, 1];
    td.applyStroke = opts.stroke !== false;
    td.strokeColor = [0, 0, 0];
    td.strokeWidth = Math.max(1, Math.round(size * 0.08));
    td.strokeOverFill = false;
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    td.text = M('Subt\u00edtulo de ejemplo', 'Sample subtitle');
    prop.setValue(td);

    setupRig(layer);
    var boxH = layoutBox(layer, opts);
    // Margen inferior: distancia entre la caja y el borde inferior (solo al crear la capa)
    var pad = (opts.bottomPad != null && opts.bottomPad !== '' && !isNaN(Number(opts.bottomPad)))
      ? Number(opts.bottomPad) : Math.round(comp.height * 0.08);
    layer.property('ADBE Transform Group').property('ADBE Position')
      .setValue([comp.width / 2, comp.height - pad - boxH / 2]);
    writeStore(layer, { v: 1, id: newId(), words: [], settings: {} });
    return layer;
  }

  /** Convierte una capa de versiones anteriores (texto de punto) en caja de parrafo, conservando estilo y ajustes. */
  function convertLegacy(comp, old, opts) {
    var otd = textDocProp(old).value;
    var o = {};
    for (var k in opts) o[k] = opts[k];
    o.fontSize = otd.fontSize;
    o.font = opts.font || otd.font;
    var layer = createSubLayer(comp, o);

    var prop = textDocProp(layer);
    prop.expressionEnabled = false;
    var td = prop.value;
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      try { td[STYLE_KEYS[i]] = otd[STYLE_KEYS[i]]; } catch (e) {}
    }
    if (opts.font) { try { td.font = opts.font; } catch (e2) {} }
    prop.setValue(td);
    prop.expressionEnabled = true;

    // Copiar valores de los controles
    var ofx = old.property('ADBE Effect Parade'), nfx = layer.property('ADBE Effect Parade');
    for (var key in FX) {
      var oe = findFx(old, key);
      if (!oe) continue;
      var ne = findFx(layer, key);
      if (!ne) ne = (key === 'bgColor') ? addColor(layer, key, oe.property(1).value) : addSlider(layer, key, oe.property(1).value);
      else ne.property(1).setValue(oe.property(1).value);
    }
    var oldName = old.name;
    layer.comment = old.comment;
    var boxH = layoutBox(layer, o);
    var opos = old.property('ADBE Transform Group').property('ADBE Position').value;
    layer.property('ADBE Transform Group').property('ADBE Position').setValue([opos[0], opos[1] - boxH / 2]);
    layer.moveBefore(old);
    old.remove();
    layer.name = oldName;
    setupRig(layer);
    return layer;
  }

  /** Controles y expresiones de la capa. Se reaplica siempre para actualizar capas de versiones anteriores. */
  function setupRig(layer) {
    addSlider(layer, 'offset', 0);
    addSlider(layer, 'fade', 0);
    addSlider(layer, 'pop', 0);
    var tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Opacity').expression = exprOpacity(layer);
    tr.property('ADBE Scale').expression = exprScale(layer);
    textDocProp(layer).expression = exprText(layer);
  }

  function offsetSeconds(layer, comp) {
    var e = findFx(layer, 'offset');
    return e ? e.property(1).value * comp.frameDuration : 0;
  }

  function findLayerByName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    return null;
  }

  function ensureBackground(comp, layer, enabled) {
    var st = readStore(layer) || { v: 1, words: [], settings: {} };
    if (!st.id) { st.id = newId(); writeStore(layer, st); }
    var existing = bgOf(comp, layer);
    if (!existing) {
      // Fondo de versiones anteriores (sin vinculo): se adopta si nadie lo usa
      var legacy = findLayerByName(comp, NAMES.bg[0]) || findLayerByName(comp, NAMES.bg[1]);
      if (legacy && String(legacy.comment || '').indexOf('AUTOSUBBG:') !== 0) { legacy.comment = 'AUTOSUBBG:' + st.id; existing = legacy; }
    }
    if (!enabled) {
      if (existing) existing.enabled = false;
      return;
    }
    if (existing) { existing.enabled = true; return; }

    // La expresion del fondo apunta a la capa de subtitulos por su nombre actual
    addSlider(layer, 'bgOpacity', 70);
    addColor(layer, 'bgColor', [0, 0, 0]);
    addSlider(layer, 'bgPad', 20);
    addSlider(layer, 'bgRound', 12);

    var sh = comp.layers.addShape();
    sh.name = uniqueName(comp, layer.name + ' - ' + M('Fondo', 'Background'));
    sh.comment = 'AUTOSUBBG:' + st.id;
    sh.startTime = 0; sh.inPoint = 0; sh.outPoint = comp.duration;
    var tr = sh.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue([0, 0]);
    tr.property('ADBE Position').setValue([0, 0]);

    var grp = sh.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    grp.name = M('Caja', 'Box');
    sh.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Rect');
    sh.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Fill');

    // Volvemos a obtener las referencias (anadir propiedades invalida las anteriores)
    var vecs = sh.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group');
    var rect = vecs.property(1), fill = vecs.property(2);

    rect.property('ADBE Vector Rect Size').expression =
      bgRef(layer) + 'var p = L.effect("' + fxName(layer, 'bgPad') + '")(1), sc = L.transform.scale;\n' +
      '[(r.width + 2 * p) * sc[0] / 100, (r.height + 2 * p) * sc[1] / 100];';
    rect.property('ADBE Vector Rect Position').expression =
      bgRef(layer) + 'L.toComp([r.left + r.width / 2, r.top + r.height / 2]);';
    rect.property('ADBE Vector Rect Roundness').expression =
      'thisComp.layer("' + layer.name + '").effect("' + fxName(layer, 'bgRound') + '")(1);';
    fill.property('ADBE Vector Fill Color').expression =
      'thisComp.layer("' + layer.name + '").effect("' + fxName(layer, 'bgColor') + '")(1);';
    sh.property('ADBE Transform Group').property('ADBE Opacity').expression =
      bgRef(layer) + '(r.width > 0) ? L.effect("' + fxName(layer, 'bgOpacity') + '")(1) * L.transform.opacity / 100 : 0;';

    sh.moveAfter(layer);
  }

  /** Activa/desactiva el trazo del texto y el efecto nativo "Sombra paralela" (Drop Shadow). */
  function applyStrokeShadow(layer, a) {
    if (a.stroke != null) {
      var prop = textDocProp(layer), td = prop.value;
      td.applyStroke = !!a.stroke;
      if (a.stroke && !(td.strokeWidth > 0)) td.strokeWidth = Math.max(1, Math.round(td.fontSize * 0.08));
      prop.setValue(td);
    }
    if (a.shadow != null) {
      var fx = layer.property('ADBE Effect Parade'), ds = null, i;
      for (i = 1; i <= fx.numProperties; i++) if (fx.property(i).matchName === 'ADBE Drop Shadow') { ds = fx.property(i); break; }
      if (a.shadow) {
        if (!ds) {
          var size = textDocProp(layer).value.fontSize;
          ds = layer.property('ADBE Effect Parade').addProperty('ADBE Drop Shadow');
          try { ds.property('ADBE Drop Shadow-0004').setValue(Math.max(2, Math.round(size * 0.05))); } catch (e1) {}
          try { ds.property('ADBE Drop Shadow-0005').setValue(Math.max(2, Math.round(size * 0.1))); } catch (e2) {}
        }
        ds.enabled = true;
      } else if (ds) {
        ds.enabled = false; // se desactiva (no se borra) para conservar los ajustes del usuario
      }
    }
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
    var subs = listSubLayers(c), list = [];
    for (i = 0; i < subs.length; i++) list.push({ index: subs[i].index, name: subs[i].name, markers: subs[i].property('ADBE Marker').numKeys });
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
      subIndex: sub ? sub.index : null,
      subLayers: list,
      subFont: sub ? textDocProp(sub).value.font : null,
      hasWords: !!(store && store.words && store.words.length),
      markerSig: sub ? markerSignature(sub) : '',
      markerCount: sub ? sub.property('ADBE Marker').numKeys : 0,
      savedSettings: store ? store.settings : null
    };
  };

  /** Estilo actual de la capa de trabajo: lo muestra la pestana Editar. */
  api.layerStyle = function (a) {
    var comp = activeComp(), layer = requireSubLayer(comp, a);
    var td = textDocProp(layer).value, st = readStore(layer) || {}, s = st.settings || {};
    var fx = layer.property('ADBE Effect Parade'), shadow = false, i;
    for (i = 1; i <= fx.numProperties; i++) if (fx.property(i).matchName === 'ADBE Drop Shadow' && fx.property(i).enabled) shadow = true;
    var bg = bgOf(comp, layer), sc = scaleX(layer), bw = s.boxWidth;
    try { bw = Math.round(td.boxTextSize[0] * sc); } catch (e) {}
    return {
      index: layer.index, name: layer.name, font: td.font, fontSize: Math.round(td.fontSize),
      boxWidth: bw, maxLines: s.maxLines || 2, stroke: !!td.applyStroke, shadow: shadow,
      background: !!(bg && bg.enabled), hasWords: !!(st.words && st.words.length)
    };
  };

  /** Huella de los marcadores: cambia si se editan en la linea de tiempo o con Ctrl+Z. */
  function markerSignature(layer) {
    var mk = layer.property('ADBE Marker'), n = mk.numKeys, h = 0;
    for (var i = 1; i <= n; i++) {
      var v = mk.keyValue(i), c = String(v.comment);
      h = (h * 31 + Math.round(mk.keyTime(i) * 1000) + Math.round(v.duration * 1000) * 7 + c.length * 13) % 1000000007;
      for (var j = 0; j < c.length; j += 5) h = (h * 17 + c.charCodeAt(j)) % 1000000007;
    }
    return n + ':' + h;
  }

  /**
   * Renderiza SOLO AUDIO a un archivo temporal (AIFF o WAV):
   *  - sin layerIndex: el area de trabajo de la composicion,
   *  - con layerIndex: solo esa capa (se silencian las demas) entre su entrada y su salida.
   * Nunca se envia video a la IA: el video gasta ~9 veces mas tokens.
   */
  api.renderAudio = function (a) {
    var comp = activeComp();
    var i, start = comp.workAreaStart, dur = comp.workAreaDuration;
    var restore = [];

    if (a.layerIndex) {
      var target = comp.layer(a.layerIndex);
      if (!target || !target.hasAudio) throw new Error(M('La capa seleccionada no tiene audio.', 'The selected layer has no audio.'));
      start = Math.max(0, target.inPoint);
      dur = Math.min(comp.duration, target.outPoint) - start;
      if (dur <= 0) throw new Error(M('La capa seleccionada est\u00e1 fuera de la composici\u00f3n.', 'The selected layer is outside the composition.'));
      for (i = 1; i <= comp.numLayers; i++) {
        var ly = comp.layer(i);
        if (!ly.hasAudio && !ly.solo) continue;
        restore.push({ l: ly, audio: ly.hasAudio ? ly.audioEnabled : null, solo: ly.solo });
        try { if (ly.solo) ly.solo = false; } catch (e0) {}
        if (ly.hasAudio) ly.audioEnabled = (ly === target);
      }
    } else {
      var hasAudio = false;
      for (i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).hasAudio && comp.layer(i).audioEnabled) { hasAudio = true; break; }
      }
      if (!hasAudio) throw new Error(M('La composici\u00f3n no tiene capas con audio activado.', 'The composition has no layers with audio enabled.'));
    }

    function restoreLayers() {
      for (var r = 0; r < restore.length; r++) {
        try { if (restore[r].audio !== null) restore[r].l.audioEnabled = restore[r].audio; } catch (e1) {}
        try { restore[r].l.solo = restore[r].solo; } catch (e2) {}
      }
    }

    var rq = app.project.renderQueue;
    var paused = [];
    for (i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i);
      if (it.status === RQItemStatus.QUEUED) { it.render = false; paused.push(it); }
    }

    var item = rq.items.add(comp);
    var outPath = null, err = null;
    try {
      item.timeSpanStart = start;
      item.timeSpanDuration = dur;
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
        if (!okFmt) throw new Error(M('No se encontr\u00f3 una plantilla de salida de solo audio (AIFF/WAV).', 'No audio-only output template (AIFF/WAV) was found.'));
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
    restoreLayers();
    if (err) throw err;

    var outFile = new File(outPath);
    if (!outFile.exists) throw new Error(M('El render de audio no gener\u00f3 ning\u00fan archivo.', 'The audio render did not create any file.'));
    return { path: outFile.fsName, offset: start, duration: dur };
  };

  /** Datos del archivo original de la capa seleccionada. */
  api.layerSource = function () {
    var comp = activeComp();
    var l = comp.selectedLayers[0];
    if (!l) throw new Error(M('Selecciona en la l\u00ednea de tiempo la capa de v\u00eddeo o audio a subtitular.', 'Select the video or audio layer to subtitle on the timeline.'));
    if (!l.source || !l.source.mainSource || !l.source.mainSource.file) {
      throw new Error(M('La capa seleccionada no procede de un archivo (selecciona un v\u00eddeo o audio importado).', 'The selected layer does not come from a file (select an imported video or audio).'));
    }
    if (!l.hasAudio) throw new Error(M('La capa seleccionada no tiene audio.', 'The selected layer has no audio.'));
    return {
      path: l.source.mainSource.file.fsName,
      startTime: l.startTime,
      stretch: l.stretch,
      inPoint: l.inPoint,
      outPoint: l.outPoint,
      duration: l.source.duration
    };
  };

  /** Crea (o reutiliza) la capa de subtitulos y ajusta la caja: ancho, lineas, tipografia y ancla centrada. */
  api.ensureLayer = function (a) {
    var comp = activeComp();
    var layer = a.create ? createSubLayer(comp, a) : requireSubLayer(comp, a);
    if (!a.create && !textDocProp(layer).value.boxText) layer = convertLegacy(comp, layer, a);
    else { setupRig(layer); layoutBox(layer, a); }
    applyStrokeShadow(layer, a);
    // Recordar en la capa el ancho y las lineas de su caja (los muestra la pestana Editar)
    var st = readStore(layer) || { v: 1, words: [], settings: {} };
    st.settings = st.settings || {};
    if (a.maxLines) st.settings.maxLines = Number(a.maxLines);
    if (a.boxWidth) st.settings.boxWidth = Number(a.boxWidth);
    writeStore(layer, st);
    ensureBackground(comp, layer, !!a.background);
    return { index: layer.index, name: layer.name, font: textDocProp(layer).value.font };
  };

  /** Duplicado temporal sin expresion para medir texto con el estilo y la caja de la capa. */
  function withMeasureLayer(a, fn) {
    var comp = activeComp();
    var layer = requireSubLayer(comp, a);
    var dup = layer.duplicate();
    try {
      dup.enabled = false;
      var prop = textDocProp(dup);
      prop.expressionEnabled = false;
      var td = prop.value, t = dup.inPoint, sc = scaleX(layer);
      return fn(function (s) {
        td.text = s;
        prop.setValue(td);
        var r = dup.sourceRectAtTime(t, false);
        return { w: r.width * sc, h: r.height * sc };
      });
    } finally {
      dup.remove();
    }
  }

  /** Mide en pixeles de la composicion el ancho de cada palabra con el estilo actual de la capa. */
  api.measure = function (a) {
    return withMeasureLayer(a, function (m) {
      var out = { widths: {}, space: 0, avgChar: 0 };
      var w2 = m('xx').w;
      out.space = Math.max(1, m('x x').w - w2);
      out.avgChar = m('abcdefghijklmnopqrstuvwxyz').w / 26;
      var words = a.words || [];
      for (var i = 0; i < words.length; i++) out.widths[words[i]] = m(words[i]).w;
      return out;
    });
  };

  /** Cuenta cuantas lineas ocupa cada texto dentro de la caja real (verificacion final). */
  api.countLines = function (a) {
    return withMeasureLayer(a, function (m) {
      var h1 = m('Hg').h, lead = Math.max(1, m('Hg\rHg').h - h1);
      var out = [];
      var texts = a.texts || [];
      for (var i = 0; i < texts.length; i++) {
        var h = m(texts[i]).h;
        out.push(1 + Math.max(0, Math.round((h - h1) / lead)));
      }
      return out;
    });
  };

  /** Tipografias instaladas (After Effects 2024 o posterior). */
  api.getFonts = function () {
    var list = [];
    try {
      var fams = app.fonts.allFonts;
      for (var i = 0; i < fams.length; i++) {
        var styles = [];
        for (var j = 0; j < fams[i].length; j++) styles.push([fams[i][j].styleName, fams[i][j].postScriptName]);
        if (styles.length) list.push({ f: fams[i][0].familyName, s: styles });
      }
    } catch (e) {
      return { fonts: [], supported: false };
    }
    return { fonts: list, supported: true };
  };

  /** Escribe los subtitulos como marcadores y guarda las palabras para reorganizar despues. */
  api.apply = function (a) {
    var comp = activeComp();
    var layer = requireSubLayer(comp, a);
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

    // Se conserva el resto de datos de la capa (su id enlaza la caja de fondo)
    var st = readStore(layer) || { v: 1, words: [], settings: {} };
    if (a.words) st.words = a.words;
    if (a.settings) st.settings = a.settings;
    writeStore(layer, st);
    return { count: segs.length };
  };

  /** Palabras guardadas en la capa. */
  api.getStore = function (a) {
    var comp = activeComp();
    var layer = requireSubLayer(comp, a);
    return readStore(layer) || { v: 1, words: [], settings: {} };
  };

  /** Lee los subtitulos actuales (marcadores) de la capa. */
  api.readSubs = function (a) {
    var comp = activeComp();
    var layer = requireSubLayer(comp, a);
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
    return api.apply({ segments: a.subs || [], layer: a.layer });
  };

  function toPanelText(c) { return String(c).replace(/\s*\|\s*/g, '\n'); }
  function toMarkerText(t) { return String(t).replace(/\r\n?|\n/g, ' | '); }

  /**
   * Aplica SOLO los cambios hechos en el editor del panel sobre el estado ACTUAL de los marcadores.
   * Asi se respetan los ajustes hechos a mano en la linea de tiempo (arrastrar marcadores o su duracion)
   * despues de cargar el editor. Cada cambio identifica su marcador por el texto y el tiempo originales.
   * a = { changes: [{ orig:{start,text}, text?, start?, end?, del? }], inserts: [{start,end,text}] }
   */
  api.patchSubs = function (a) {
    var comp = activeComp();
    var layer = requireSubLayer(comp, a);
    var mk = layer.property('ADBE Marker');
    var cur = [], i;
    for (i = 1; i <= mk.numKeys; i++) {
      var v = mk.keyValue(i);
      cur.push({ t: mk.keyTime(i), d: v.duration, c: String(v.comment), used: false, del: false });
    }

    function find(orig) {
      var best = -1, bestD = 1e9, k, d;
      for (k = 0; k < cur.length; k++) {   // mismo texto y mismo tiempo
        if (cur[k].used) continue;
        d = Math.abs(cur[k].t - orig.start);
        if (toPanelText(cur[k].c) === orig.text && d < 0.02) return k;
      }
      for (k = 0; k < cur.length; k++) {   // mismo texto (el marcador se movio a mano)
        if (cur[k].used || toPanelText(cur[k].c) !== orig.text) continue;
        d = Math.abs(cur[k].t - orig.start);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best >= 0) return best;
      for (k = 0; k < cur.length; k++) {   // mismo tiempo (el texto se cambio en la linea de tiempo)
        if (!cur[k].used && Math.abs(cur[k].t - orig.start) < 0.02) return k;
      }
      return -1;
    }

    var missing = 0, changes = a.changes || [];
    for (i = 0; i < changes.length; i++) {
      var ch = changes[i], k = find(ch.orig);
      if (k < 0) { missing++; continue; }
      var m = cur[k];
      m.used = true;
      if (ch.del) { m.del = true; continue; }
      if (ch.text != null) m.c = toMarkerText(ch.text);
      if (ch.start != null) {
        var end = m.t + m.d;
        m.t = Math.max(0, Number(ch.start));
        if (ch.end == null) m.d = Math.max(0.04, end - m.t);
      }
      if (ch.end != null) m.d = Math.max(0.04, Number(ch.end) - m.t);
    }
    var ins = a.inserts || [];
    for (i = 0; i < ins.length; i++) {
      cur.push({ t: Math.max(0, Number(ins[i].start)), d: Math.max(0.04, ins[i].end - ins[i].start), c: toMarkerText(ins[i].text) });
    }

    var kept = [];
    for (i = 0; i < cur.length; i++) if (!cur[i].del) kept.push(cur[i]);
    kept.sort(function (x, y) { return x.t - y.t; });
    for (i = mk.numKeys; i >= 1; i--) mk.removeKey(i);
    for (i = 0; i < kept.length; i++) {
      var mv = new MarkerValue(kept[i].c);
      mv.duration = kept[i].d;
      mk.setValueAtTime(kept[i].t, mv);
    }
    return { count: kept.length, missing: missing };
  };

  api.getTime = function () {
    return { t: activeComp().time };
  };

  api.gotoTime = function (a) {
    var comp = activeComp();
    comp.time = Math.max(0, Math.min(comp.duration, Number(a.t) || 0));
    return true;
  };

  var MUTATING = { ensureLayer: 1, apply: 1, writeSubs: 1, patchSubs: 1, measure: 1, countLines: 1, renderAudio: 1 };

  return {
    dispatch: function (fn, argsJSON) {
      var undo = false;
      try {
        var args = argsJSON ? parse(argsJSON) : {};
        LANG = (args && args._lang === 'en') ? 'en' : 'es';
        if (!api.hasOwnProperty(fn)) throw new Error(M('Funci\u00f3n desconocida: ', 'Unknown function: ') + fn);
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
