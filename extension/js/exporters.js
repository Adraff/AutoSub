/*
 * Conversión de subtítulos a formatos de archivo (SRT, VTT, TXT, JSON).
 * subs: [{ start, end, text }]  (segundos; las líneas separadas por \r o \n)
 */
(function (root) {
  'use strict';

  function pad(n, len) { n = String(n); while (n.length < len) n = '0' + n; return n; }

  function timecode(sec, sep) {
    if (sec < 0) sec = 0;
    var ms = Math.round(sec * 1000);
    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var m = Math.floor(ms / 60000); ms -= m * 60000;
    var s = Math.floor(ms / 1000); ms -= s * 1000;
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + sep + pad(ms, 3);
  }

  function lines(text, oneLine) {
    var t = String(text || '').replace(/\r\n?/g, '\n').trim();
    return oneLine ? t.replace(/\s*\n\s*/g, ' ') : t;
  }

  function toSRT(subs, opt) {
    opt = opt || {};
    return subs.map(function (s, i) {
      return (i + 1) + '\n' + timecode(s.start, ',') + ' --> ' + timecode(s.end, ',') + '\n' + lines(s.text, opt.oneLine) + '\n';
    }).join('\n');
  }

  function toVTT(subs, opt) {
    opt = opt || {};
    return 'WEBVTT\n\n' + subs.map(function (s, i) {
      return (i + 1) + '\n' + timecode(s.start, '.') + ' --> ' + timecode(s.end, '.') + '\n' + lines(s.text, opt.oneLine) + '\n';
    }).join('\n');
  }

  function toTXT(subs, opt) {
    opt = opt || {};
    return subs.map(function (s) { return lines(s.text, opt.oneLine); }).join('\n\n') + '\n';
  }

  function toJSON(subs, opt) {
    opt = opt || {};
    return JSON.stringify({
      generator: 'AutoSub',
      subtitles: subs.map(function (s) {
        var o = { start: s.start, end: s.end, text: lines(s.text, opt.oneLine) };
        if (s.words) o.words = s.words;
        return o;
      })
    }, null, 2);
  }

  var api = {
    timecode: timecode,
    formats: {
      srt: { ext: 'srt', fn: toSRT },
      vtt: { ext: 'vtt', fn: toVTT },
      txt: { ext: 'txt', fn: toTXT },
      json: { ext: 'json', fn: toJSON }
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Exporters = api;
})(typeof window !== 'undefined' ? window : this);
