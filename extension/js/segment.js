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

  // Palabras tras las que no se debe cortar un subtítulo (es, en, pt, fr, it, ca)
  var FUNCTION_WORDS = {};
  ('de del la el los las lo le les un una unos unas y e o u ni que a al en con por para sin sobre entre hasta desde ' +
   'hacia según su sus mi mis tu tus nuestro nuestra se me te nos os muy más tan como pero si cuando donde porque ' +
   'the a an of to in on at for and or but with from by into my your his her its our their this that these those is are was ' +
   'do da dos das no na nos nas um uma ao pelo pela em com mas ' +
   'le la les un une des du au aux et ou mais pour par dans sur avec ' +
   'il lo gli i una di da del della nel con per ma ' +
   'els les per amb').split(' ').forEach(function (w) { if (w) FUNCTION_WORDS[w] = 1; });

  function bare(w) { return String(w).toLowerCase().replace(/^[¿¡"'«“(\[]+|[.,;:!?…"'»”)\]]+$/g, ''); }

  /** Coste de cortar el subtítulo después de la palabra j (cuanto menor, más natural). */
  function breakCost(words, j, gapBreak) {
    var w = words[j].w, next = words[j + 1];
    var c = 10;
    if (/[.!?…]["'»”)\]]*$/.test(w)) c = 0;
    else if (/[,;:—–]["'»”)\]]*$/.test(w)) c = 0.5;
    else {
      if (words[j].p != null && next.p != null && words[j].p !== next.p) c = Math.min(c, 1.5);
      var gap = next.s - words[j].e;
      if (gap >= (gapBreak || 0.5)) c = 0;          // pausa clara: el mejor sitio para cortar
      else if (gap >= 0.25) c = Math.min(c, 1);
      if (FUNCTION_WORDS[bare(w)]) c += 9;
      if (/^[A-ZÁÉÍÓÚÑ]/.test(w) && /^[A-ZÁÉÍÓÚÑ]/.test(next.w)) c += 6; // nombres propios: "After Effects"
    }
    return c;
  }

  /** Coste por tamaño: evita subtítulos de una o dos palabras salvo que no haya otra opción. */
  function sizeCost(n, wholeChunk, firstWord) {
    if (wholeChunk) return 0;
    if (n === 1) return 14 + (FUNCTION_WORDS[bare(firstWord)] ? 6 : 0);
    if (n === 2) return 4;
    if (n === 3) return 1;
    return 0;
  }

  /**
   * words: [{w,s,e,p?}]  (tiempos en segundos de composición; p = número de frase de la IA)
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

    // 1) Cortes obligatorios: pausas MUY largas, fin de frase (si está activado) y cortes forzados.
    //    Una pausa normal (>= "silencio que corta") no obliga a cortar: es el mejor sitio para hacerlo,
    //    pero si dejaría una palabra suelta se prefiere mantenerla con su frase.
    var hardGap = Math.max(1.5, gapBreak * 2.5);
    var chunks = [], start = 0;
    for (var i = 1; i <= words.length; i++) {
      if (i === words.length || forced[i] || words[i].s - words[i - 1].e > hardGap ||
          (o.breakPunct && SENTENCE_END.test(words[i - 1].w))) {
        chunks.push([start, i - 1]);
        start = i;
      }
    }

    // 2) Dentro de cada tramo, elegir los cortes como lo haría una persona (programación dinámica):
    //    - cada subtítulo cabe en las líneas máximas y en la duración máxima,
    //    - se prefiere cortar en comas, pausas y en los límites de frase que marcó la IA,
    //    - se evita cortar justo después de artículos/preposiciones ("de", "la", "y"…),
    //    - se evitan los subtítulos de una sola palabra ("huérfanas") y los muy cortos,
    //    - y se prefieren menos subtítulos (aprovechando el espacio de la caja).
    var groups = [];
    chunks.forEach(function (ch) {
      var a0 = ch[0], len = ch[1] - ch[0] + 1;
      var best = [0], back = [-1];
      for (var k = 1; k <= len; k++) { best.push(Infinity); back.push(-1); }
      var linesOf = {};
      for (var a = 0; a < len; a++) {
        if (best[a] === Infinity) continue;
        var lines = 1, lineW = 0;
        for (var b = a; b < len; b++) {
          var wd = words[a0 + b], wpx = wordWidth(wd.w, widths, avgChar);
          var need = lineW ? lineW + spaceW + wpx : wpx;
          if (lineW === 0 || need <= boxW) lineW = need;
          else { lines++; lineW = wpx; }
          if (lines > maxLines && b > a) break;
          if (b > a && wd.e - words[a0 + a].s > maxDur) break;
          var n = b - a + 1;
          var cost = best[a] + 2 + sizeCost(n, a === 0 && b === len - 1, words[a0 + a].w) +
            (b < len - 1 ? breakCost(words, a0 + b, gapBreak) : 0);
          if (cost < best[b + 1]) { best[b + 1] = cost; back[b + 1] = a; linesOf[b + 1] = lines; }
        }
      }
      var cuts = [], e = len;
      while (e > 0) { var s0 = back[e]; cuts.unshift([s0, e - 1, linesOf[e]]); e = s0; }
      cuts.forEach(function (c) {
        var idx = [];
        for (var x = c[0]; x <= c[1]; x++) idx.push(a0 + x);
        groups.push({ idx: idx, lines: Math.min(c[2] || 1, maxLines) });
      });
    });

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
