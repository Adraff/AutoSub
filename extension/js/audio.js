/*
 * Ajuste fino de tiempos con el audio real (sin dependencias).
 *
 * Los tiempos por palabra que devuelve la IA son aproximados: suelen ir desplazados,
 * "estirados" o sin huecos en los silencios. Aquí leemos el WAV/AIFF exportado,
 * detectamos dónde hay voz de verdad (VAD por energía) y encajamos las palabras
 * de la IA en esos tramos de voz. Así:
 *   - cada frase empieza cuando de verdad empieza a sonar,
 *   - los silencios quedan como huecos reales (y funcionan las opciones de silencio).
 */
(function (root) {
  'use strict';

  var fs = typeof require === 'function' ? require('fs') : null;

  // ------------------------------------------------------------------ lectura PCM
  function ext80(buf, off) {
    var sign = buf[off] & 0x80 ? -1 : 1;
    var exp = ((buf[off] & 0x7f) << 8) | buf[off + 1];
    var hi = buf.readUInt32BE(off + 2), lo = buf.readUInt32BE(off + 6);
    if (exp === 0 && hi === 0 && lo === 0) return 0;
    return sign * (hi * Math.pow(2, -31) + lo * Math.pow(2, -63)) * Math.pow(2, exp - 16383);
  }

  function parseWav(buf) {
    var p = 12, fmt = null, data = null;
    while (p + 8 <= buf.length) {
      var id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4), body = p + 8;
      if (id === 'fmt ') {
        var tag = buf.readUInt16LE(body);
        if (tag === 0xFFFE && size >= 26) tag = buf.readUInt16LE(body + 24);
        fmt = { tag: tag, channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
      } else if (id === 'data') {
        data = { offset: body, size: Math.min(size, buf.length - body) };
      }
      p = body + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('WAV sin datos de audio.');
    if (fmt.tag !== 1 && fmt.tag !== 3) throw new Error('WAV comprimido no compatible.');
    return { le: true, float: fmt.tag === 3, bits: fmt.bits, channels: fmt.channels, sampleRate: fmt.sampleRate, offset: data.offset, size: data.size, unsigned8: true };
  }

  function parseAiff(buf) {
    var isC = buf.toString('ascii', 8, 12) === 'AIFC';
    var p = 12, comm = null, ssnd = null;
    while (p + 8 <= buf.length) {
      var id = buf.toString('ascii', p, p + 4), size = buf.readUInt32BE(p + 4), body = p + 8;
      if (id === 'COMM') {
        comm = { channels: buf.readUInt16BE(body), bits: buf.readUInt16BE(body + 6), sampleRate: ext80(buf, body + 8), comp: 'NONE' };
        if (isC && size >= 22) comm.comp = buf.toString('ascii', body + 18, body + 22);
      } else if (id === 'SSND') {
        var off = buf.readUInt32BE(body);
        ssnd = { offset: body + 8 + off, size: Math.min(size - 8 - off, buf.length - body - 8 - off) };
      }
      p = body + size + (size & 1);
    }
    if (!comm || !ssnd) throw new Error('AIFF sin datos de audio.');
    var c = comm.comp.toLowerCase();
    if (c !== 'none' && c !== 'sowt' && c !== 'fl32' && c !== 'fl64') throw new Error('AIFF comprimido no compatible.');
    return {
      le: c === 'sowt', float: c === 'fl32' || c === 'fl64', bits: c === 'fl64' ? 64 : (c === 'fl32' ? 32 : comm.bits),
      channels: comm.channels, sampleRate: comm.sampleRate, offset: ssnd.offset, size: ssnd.size, unsigned8: false
    };
  }

  function sampleReader(f, buf) {
    var b = f.bits;
    if (f.float && b === 32) return f.le ? function (o) { return buf.readFloatLE(o); } : function (o) { return buf.readFloatBE(o); };
    if (f.float && b === 64) return f.le ? function (o) { return buf.readDoubleLE(o); } : function (o) { return buf.readDoubleBE(o); };
    if (b === 16) return f.le ? function (o) { return buf.readInt16LE(o) / 32768; } : function (o) { return buf.readInt16BE(o) / 32768; };
    if (b === 24) return f.le ? function (o) { return buf.readIntLE(o, 3) / 8388608; } : function (o) { return buf.readIntBE(o, 3) / 8388608; };
    if (b === 32) return f.le ? function (o) { return buf.readInt32LE(o) / 2147483648; } : function (o) { return buf.readInt32BE(o) / 2147483648; };
    if (b === 8) return f.unsigned8 ? function (o) { return (buf[o] - 128) / 128; } : function (o) { return buf.readInt8(o) / 128; };
    throw new Error('Profundidad de bits no compatible: ' + b);
  }

  var SR = 16000; // Gemini procesa el audio internamente a 16 kHz mono: no se pierde nada

  /** Lee un WAV/AIFF y lo convierte a mono 16 kHz (Float32Array). */
  function decode(filePath) {
    var buf = fs.readFileSync(filePath);
    var head = buf.toString('ascii', 0, 4), kind = buf.toString('ascii', 8, 12);
    var f;
    if (head === 'RIFF' && kind === 'WAVE') f = parseWav(buf);
    else if (head === 'FORM' && (kind === 'AIFF' || kind === 'AIFC')) f = parseAiff(buf);
    else throw new Error('Solo se puede analizar WAV o AIFF.');

    var read = sampleReader(f, buf);
    var bps = Math.ceil(f.bits / 8), frameBytes = bps * f.channels;
    var total = Math.floor(f.size / frameBytes);
    var ratio = f.sampleRate / SR;
    var outLen = Math.max(1, Math.floor(total / ratio));
    var out = new Float32Array(outLen), cnt = new Uint16Array(outLen);
    var o = f.offset;
    // Reducción de frecuencia promediando muestras (filtro paso bajo sencillo)
    for (var i = 0; i < total; i++) {
      var s = 0;
      for (var c = 0; c < f.channels; c++) { s += read(o); o += bps; }
      var k = Math.min(outLen - 1, Math.floor(i / ratio));
      out[k] += s / f.channels;
      cnt[k]++;
    }
    for (var j = 0; j < outLen; j++) if (cnt[j]) out[j] /= cnt[j];
    return { samples: out, sampleRate: SR, duration: outLen / SR };
  }

  /** Energía (dB) en tramos de 10 ms. */
  function energyOf(dec) {
    var hop = SR / 100, x = dec.samples;
    var db = new Float32Array(Math.ceil(x.length / hop));
    for (var w = 0; w < db.length; w++) {
      var a = w * hop, b = Math.min(x.length, a + hop), sum = 0;
      for (var i = a; i < b; i++) sum += x[i] * x[i];
      db[w] = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12);
    }
    return { db: db, step: 0.01, duration: dec.duration };
  }

  function energy(filePath) { return energyOf(decode(filePath)); }

  /** Escribe un WAV PCM 16 bits mono. */
  function writeWav(filePath, samples, sr) {
    var n = samples.length, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (var i = 0; i < n; i++) {
      var v = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    fs.writeFileSync(filePath, buf);
  }

  /**
   * Prepara el audio que se envía a la IA para gastar los mínimos tokens:
   *  - mono 16 kHz (archivo ~6 veces más pequeño, subida más rápida),
   *  - opcionalmente sin silencios: solo los tramos con voz, separados por una pausa corta.
   * Devuelve { file, duration, origDuration, regions, toOriginal(t), trimmed }.
   */
  function prepareUpload(filePath, outPath, opts) {
    var o = opts || {};
    var dec = decode(filePath);
    var regions = detectSpeech(energyOf(dec));
    var PAD = 0.15, GAP = 0.3;
    var parts = [];
    if (o.trim && regions.length) {
      regions.forEach(function (r) {
        var s = Math.max(0, r.s - PAD), e = Math.min(dec.duration, r.e + PAD);
        var last = parts[parts.length - 1];
        if (last && s <= last.e + GAP) last.e = e; else parts.push({ s: s, e: e });
      });
    }
    var speech = parts.reduce(function (a, p) { return a + (p.e - p.s); }, 0);
    var trimmed = parts.length > 0 && speech + GAP * parts.length < dec.duration * 0.9;

    if (!trimmed) {
      writeWav(outPath, dec.samples, SR);
      return { file: outPath, duration: dec.duration, origDuration: dec.duration, regions: regions,
        toOriginal: function (t) { return t; }, trimmed: false };
    }

    var gapN = Math.round(GAP * SR), total = 0, map = [];
    parts.forEach(function (p) {
      var a = Math.round(p.s * SR), b = Math.round(p.e * SR);
      map.push({ out: total / SR, s: p.s, len: (b - a) / SR, a: a, b: b });
      total += (b - a) + gapN;
    });
    var out = new Float32Array(total);
    map.forEach(function (m) { out.set(dec.samples.subarray(m.a, m.b), Math.round(m.out * SR)); });
    writeWav(outPath, out, SR);

    function toOriginal(t) {
      var m = map[0];
      for (var i = 0; i < map.length; i++) { if (map[i].out <= t) m = map[i]; else break; }
      return m.s + Math.min(Math.max(0, t - m.out), m.len); // dentro de la pausa añadida → fin del tramo
    }
    return { file: outPath, duration: total / SR, origDuration: dec.duration, regions: regions,
      toOriginal: toOriginal, trimmed: true };
  }

  // ------------------------------------------------------------------ detección de voz
  function percentile(arr, p) {
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  }

  /** Tramos con voz: [{s,e}] en segundos del archivo. */
  function detectSpeech(en, opts) {
    var o = opts || {};
    var db = en.db, step = en.step;
    if (!db.length) return [];
    var floor = percentile(db, 0.1), peak = percentile(db, 0.98);
    if (peak - floor < 8) return []; // sin contraste: no se puede distinguir voz de fondo
    var thr = Math.max(floor + 6, floor + (peak - floor) * (o.sensitivity || 0.35));

    var regions = [], start = -1;
    for (var i = 0; i < db.length; i++) {
      if (db[i] > thr) { if (start < 0) start = i; }
      else if (start >= 0) { regions.push({ s: start * step, e: i * step }); start = -1; }
    }
    if (start >= 0) regions.push({ s: start * step, e: db.length * step });

    var fillGap = o.fillGap || 0.18, minLen = o.minLen || 0.08, pad = o.pad || 0.04;
    var merged = [];
    regions.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r.s - last.e < fillGap) last.e = r.e; else merged.push({ s: r.s, e: r.e });
    });
    return merged.filter(function (r) { return r.e - r.s >= minLen; }).map(function (r) {
      return { s: Math.max(0, r.s - pad), e: Math.min(en.duration, r.e + pad) };
    });
  }

  // ------------------------------------------------------------------ alineado
  function nearestRegion(regions, t) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      var d = t < r.s ? r.s - t : (t > r.e ? t - r.e : 0);
      if (d < bestD) { bestD = d; best = i; }
      if (r.s > t + bestD) break;
    }
    return { i: best, d: bestD };
  }

  function assignDP(ws, regions, maxSnap) {
    var N = ws.length, M = regions.length, BAND = 6 + maxSnap, KMAX = 80;
    var INF = 1e30;
    var mids = ws.map(function (w) { return (w.s + w.e) / 2; });
    var need = ws.map(function (w) { return 0.05 + 0.065 * w.w.length; }); // s que "pide" cada palabra
    var cost = [], back = [];
    for (var r = 0; r <= M; r++) {
      cost.push(new Float64Array(N + 1).fill(INF));
      back.push(new Int32Array(N + 1).fill(-2));
    }
    cost[0][0] = 0;

    for (r = 0; r < M; r++) {
      var R = regions[r], D = Math.max(0.05, R.e - R.s);
      var skip = 1.0 * Math.min(D, 3);
      for (var i = 0; i <= N; i++) {
        var c0 = cost[r][i];
        if (c0 >= INF) continue;
        // a) este tramo no tiene palabras (ruido, música, respiración…)
        if (c0 + skip < cost[r + 1][i]) { cost[r + 1][i] = c0 + skip; back[r + 1][i] = -1; }
        if (i === N) continue;
        if (mids[i] < R.s - BAND || mids[i] > R.e + BAND) continue;
        // b) asignar las palabras i..j-1 a este tramo
        var tc = 0, sumNeed = 0;
        for (var j = i + 1; j <= N && j - i <= KMAX; j++) {
          var m = mids[j - 1];
          if (m > R.e + BAND) break;
          var d = m < R.s ? R.s - m : (m > R.e ? m - R.e : 0);
          tc += 2 * Math.max(0, d - 0.2);
          sumNeed += need[j - 1];
          var c = c0 + tc + 0.6 * Math.abs(Math.log(sumNeed / D));
          if (c < cost[r + 1][j]) { cost[r + 1][j] = c; back[r + 1][j] = i; }
        }
      }
    }

    var out = new Array(N);
    if (cost[M][N] >= INF) {
      // Sin solución dentro de la banda: tramo más cercano a cada palabra
      var prev = 0;
      for (var k = 0; k < N; k++) { prev = Math.max(prev, nearestRegion(regions, mids[k]).i); out[k] = prev; }
      return out;
    }
    var ii = N;
    for (r = M; r > 0; r--) {
      var p = back[r][ii];
      if (p >= 0) { for (var q = p; q < ii; q++) out[q] = r - 1; ii = p; }
    }
    return out;
  }

  /**
   * Encaja las palabras de la IA en los tramos de voz detectados.
   * words: [{w,s,e}] (segundos del archivo). Devuelve una copia ajustada.
   */
  function align(words, regions, opts) {
    var o = opts || {};
    if (!words.length || !regions || !regions.length) return words.slice();
    var maxSnap = o.maxSnap || 1.5;
    var ws = words.map(function (w) { return { w: w.w, s: w.s, e: w.e }; });

    // 1) Corrección global de desplazamiento/escala usando el principio y el final del habla
    var g0 = ws[0].s, g1 = ws[ws.length - 1].e;
    var r0 = nearestRegion(regions, g0), r1 = nearestRegion(regions, g1);
    if (r0.d < 3 && r1.d < 3 && g1 - g0 > 1) {
      var v0 = regions[r0.i].s, v1 = regions[r1.i].e;
      var k = (v1 - v0) / (g1 - g0);
      if (k > 0.8 && k < 1.25) {
        ws.forEach(function (w) { w.s = v0 + (w.s - g0) * k; w.e = v0 + (w.e - g0) * k; });
      }
    }

    // 2) Asignar grupos consecutivos de palabras a tramos de voz (programación dinámica).
    //    Coste = distancia a los tiempos de la IA + desajuste de velocidad de habla
    //            + penalización por dejar sin palabras un tramo con sonido.
    var assign = assignDP(ws, regions, maxSnap);

    // 3) Dentro de cada tramo, repartir las palabras: mezcla de los tiempos relativos de la IA
    //    y de la longitud de cada palabra, ocupando exactamente el tramo real.
    var i = 0;
    while (i < ws.length) {
      var j = i;
      while (j + 1 < ws.length && assign[j + 1] === assign[i]) j++;
      var R = regions[assign[i]], a = ws[i].s, b = ws[j].e, span = R.e - R.s;
      var tot = 0, acc = 0, x;
      for (x = i; x <= j; x++) tot += ws[x].w.length + 2;
      var useAI = b - a > 0.05;
      for (x = i; x <= j; x++) {
        var cs = acc / tot; acc += ws[x].w.length + 2; var ce = acc / tot;
        var as = useAI ? (ws[x].s - a) / (b - a) : cs, ae = useAI ? (ws[x].e - a) / (b - a) : ce;
        ws[x].s = R.s + span * (as + cs) / 2;
        ws[x].e = R.s + span * (ae + ce) / 2;
      }
      i = j + 1;
    }

    // 4) Orden y sin solapes
    for (i = 0; i < ws.length; i++) {
      var w = ws[i];
      delete w.r;
      if (i > 0 && w.s < ws[i - 1].e) w.s = ws[i - 1].e;
      if (w.e < w.s + 0.04) w.e = w.s + 0.04;
      w.s = Math.round(w.s * 1000) / 1000;
      w.e = Math.round(w.e * 1000) / 1000;
    }
    return ws;
  }

  /** Analiza el archivo y devuelve las palabras ajustadas + nº de tramos de voz. */
  function refine(filePath, words, opts) {
    var en = energy(filePath);
    var regions = detectSpeech(en, opts);
    return { words: regions.length ? align(words, regions, opts) : words, regions: regions };
  }

  var api = { energy: energy, decode: decode, detectSpeech: detectSpeech, align: align, refine: refine,
    prepareUpload: prepareUpload, writeWav: writeWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AudioAlign = api;
})(typeof window !== 'undefined' ? window : this);
