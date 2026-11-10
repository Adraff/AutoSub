/*
 * Reparte las palabras transcritas en subtítulos respetando:
 *  - el ancho de la caja (medido en píxeles reales con la fuente de la capa),
 *  - el número máximo de líneas,
 *  - pausas largas, duración máxima y puntuación,
 *  - mantener o no el subtítulo en los silencios.
 * No depende de After Effects: se puede probar con Node.
 */
(function (root) {
  'use strict';

  var SENTENCE_END = /[.!?…。！？]["'»”’)\]]*$/;

  function wordWidth(w, widths, avgChar) {
    if (widths && Object.prototype.hasOwnProperty.call(widths, w)) return widths[w];
    return w.length * avgChar; // estimación si no se pudo medir
  }

  /** Reparte una lista de anchos en líneas con un ancho máximo (greedy). */
  function greedyLines(ws, maxW, spaceW) {
    var lines = [], cur = [], curW = 0;
    for (var i = 0; i < ws.length; i++) {
      var need = cur.length ? curW + spaceW + ws[i] : ws[i];
      if (cur.length && need > maxW) {
        lines.push(cur); cur = [i]; curW = ws[i];
      } else {
        cur.push(i); curW = need;
      }
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  /** Equilibra las líneas: busca el ancho mínimo que mantiene el mismo número de líneas. */
  function balancedLines(ws, maxW, spaceW) {
    var base = greedyLines(ws, maxW, spaceW);
    if (base.length < 2) return base;
    var widest = Math.max.apply(null, ws);
    var lo = widest, hi = maxW, best = base;
    for (var it = 0; it < 24 && hi - lo > 0.5; it++) {
      var mid = (lo + hi) / 2;
      var t = greedyLines(ws, mid, spaceW);
      if (t.length <= base.length) { best = t; hi = mid; } else { lo = mid; }
    }
    return best;
  }

  /**
   * words: [{w,s,e}]  (tiempos en segundos de composición)
   * opts:  { boxWidth, maxLines, spaceWidth, widths:{palabra:px}, avgCharWidth,
   *          gapBreak, maxDuration, breakPunct, keepSilence, tail, minGap, minDuration, endTime }
   * Devuelve [{ start, end, text, lines:[...], w0, w1 }]
   */
  function segment(words, opts) {
    var o = opts || {};
    // Pequeño margen de seguridad: el ajuste de línea de After Effects no es idéntico a la suma de anchos
    var boxW = Math.max(10, Number(o.boxWidth) || 1000) * 0.97;
    var maxLines = Math.max(1, Math.floor(Number(o.maxLines) || 2));
    var spaceW = Number(o.spaceWidth) || 15;
    var avgChar = Number(o.avgCharWidth) || 30;
    var gapBreak = o.gapBreak > 0 ? Number(o.gapBreak) : 0.7;
    var maxDur = o.maxDuration > 0 ? Number(o.maxDuration) : 5;
    var tail = o.tail != null ? Number(o.tail) : 0.2;
    var minGap = o.minGap != null ? Number(o.minGap) : 0.25;
    var minDur = o.minDuration != null ? Number(o.minDuration) : 0.6;
    var endTime = Number(o.endTime) || Infinity;
    var widths = o.widths || {};
    var forced = o.forceBreakBefore || {}; // índices de palabra que deben empezar subtítulo nuevo

    // 1) Agrupar palabras en bloques. Las líneas máximas son un LÍMITE: se simula cómo
    //    After Effects reparte el texto de corrido en la caja y solo se corta el subtítulo
    //    cuando la siguiente palabra ya no cabría en las líneas permitidas.
    var groups = [], cur = null;

    function flush() { if (cur && cur.idx.length) groups.push(cur); cur = null; }

    for (var i = 0; i < words.length; i++) {
      var wd = words[i];
      var wpx = wordWidth(wd.w, widths, avgChar);

      if (cur) {
        var prev = words[cur.idx[cur.idx.length - 1]];
        var first = words[cur.idx[0]];
        if (forced[i] ||
            wd.s - prev.e > gapBreak ||
            wd.e - first.s > maxDur ||
            (o.breakPunct && SENTENCE_END.test(prev.w))) {
          flush();
        }
      }
      if (!cur) cur = { idx: [], lines: 1, lineW: 0 };

      var need = cur.lineW ? cur.lineW + spaceW + wpx : wpx;
      if (cur.lineW === 0 || need <= boxW) {
        cur.lineW = need;
      } else if (cur.lines < maxLines) {
        cur.lines++; cur.lineW = wpx;
      } else {
        flush();
        cur = { idx: [], lines: 1, lineW: wpx };
      }
      cur.idx.push(i);
    }
    flush();

    // 2) Texto de corrido (sin saltos manuales): la caja de párrafo hace el ajuste de línea
    var segs = groups.map(function (g) {
      return {
        start: words[g.idx[0]].s,
        speechEnd: words[g.idx[g.idx.length - 1]].e,
        lines: g.lines,
        text: g.idx.map(function (k) { return words[k].w; }).join(' '),
        w0: g.idx[0],
        w1: g.idx[g.idx.length - 1]
      };
    });

    // 3) Tiempos de entrada/salida
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k];
      var nextStart = k + 1 < segs.length ? segs[k + 1].start : endTime;
      var end;
      if (o.keepSilence && k + 1 < segs.length) {
        end = nextStart;
      } else {
        end = Math.min(s.speechEnd + tail, nextStart);
        if (nextStart - end < minGap) end = nextStart; // evita parpadeos entre subtítulos muy seguidos
      }
      if (end - s.start < minDur) end = Math.min(s.start + minDur, nextStart);
      if (!isFinite(end)) end = s.speechEnd + tail;
      if (end <= s.start) end = s.start + 0.1;
      s.end = Math.round(end * 1000) / 1000;
      s.start = Math.round(s.start * 1000) / 1000;
      delete s.speechEnd;
    }
    return segs;
  }

  var api = { segment: segment, greedyLines: greedyLines, balancedLines: balancedLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Segmenter = api;
})(typeof window !== 'undefined' ? window : this);
