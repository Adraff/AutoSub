/*
 * Modo EffectCraft: el panel se abre en una ventana propia servida por "AutoSub para EffectCraft"
 * (puente local en 127.0.0.1). Este archivo proporciona al resto del panel las mismas piezas que
 * da CEP en After Effects (require('fs'), process, Buffer…), apoyándose en la API del puente.
 * En After Effects (CEP) no hace nada.
 */
(function (global) {
  'use strict';
  if (global.__adobe_cep__) return;

  var m = /token=([a-f0-9]+)/.exec(global.location.hash) || [null, null];
  var TOKEN = m[1];
  try {
    if (TOKEN) global.sessionStorage.setItem('autosub.token', TOKEN);
    else TOKEN = global.sessionStorage.getItem('autosub.token');
  } catch (e) { /* sin sessionStorage */ }
  if (!TOKEN) return;

  // ------------------------------------------------------------ llamadas a la API del puente
  function apiSync(name, body) {
    var x = new XMLHttpRequest();
    x.open('POST', '/api/' + name, false);
    x.setRequestHeader('X-AutoSub-Token', TOKEN);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify(body || {}));
    var r = JSON.parse(x.responseText);
    if (!r.ok) throw new Error(r.error || 'Error del puente de AutoSub');
    return r.data;
  }

  function api(name, body) {
    return fetch('/api/' + name, {
      method: 'POST',
      headers: { 'X-AutoSub-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) { return res.json(); }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'Error del puente de AutoSub');
      return r.data;
    }, function () {
      throw new Error('Se perdió la conexión con "AutoSub para EffectCraft". Vuelve a abrirlo desde el menú Inicio.');
    });
  }

  var env = apiSync('env');

  // ------------------------------------------------------------ Buffer mínimo (lo que usa audio.js)
  function NodeBuffer(n) { var u = new Uint8Array(n); Object.setPrototypeOf(u, NodeBuffer.prototype); return u; }
  NodeBuffer.prototype = Object.create(Uint8Array.prototype);
  // constructor = Uint8Array: así subarray/slice nativos crean Uint8Array normales (sin romper "species")
  NodeBuffer.prototype.constructor = Uint8Array;
  NodeBuffer.alloc = function (n) { return NodeBuffer(n); };
  NodeBuffer.from = function (x, enc) {
    var b;
    if (typeof x === 'string' && enc === 'base64') {
      var s = atob(x); b = NodeBuffer(s.length);
      for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
      return b;
    }
    if (typeof x === 'string') { var u = new TextEncoder().encode(x); b = NodeBuffer(u.length); b.set(u); return b; }
    b = NodeBuffer(x.length); b.set(x); return b;
  };
  NodeBuffer.isBuffer = function (x) { return x instanceof NodeBuffer; };
  var P = NodeBuffer.prototype;
  function dv(b) { return b._dv || (b._dv = new DataView(b.buffer, b.byteOffset, b.byteLength)); }
  P.toString = function (enc, a, z) {
    a = a || 0; z = z == null ? this.length : z;
    if (enc === 'base64') {
      var out = '', CH = 0x8000;
      for (var i = a; i < z; i += CH) out += String.fromCharCode.apply(null, this.subarray(i, Math.min(z, i + CH)));
      return btoa(out);
    }
    if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') return String.fromCharCode.apply(null, this.subarray(a, z));
    return new TextDecoder('utf-8').decode(this.subarray(a, z));
  };
  P.subarray = function (a, z) {
    var s = Uint8Array.prototype.subarray.call(this, a, z);
    Object.setPrototypeOf(s, NodeBuffer.prototype); delete s._dv;
    return s;
  };
  P.readInt8 = function (o) { return dv(this).getInt8(o); };
  P.readUInt16LE = function (o) { return dv(this).getUint16(o, true); };
  P.readUInt16BE = function (o) { return dv(this).getUint16(o, false); };
  P.readInt16LE = function (o) { return dv(this).getInt16(o, true); };
  P.readInt16BE = function (o) { return dv(this).getInt16(o, false); };
  P.readUInt32LE = function (o) { return dv(this).getUint32(o, true); };
  P.readUInt32BE = function (o) { return dv(this).getUint32(o, false); };
  P.readInt32LE = function (o) { return dv(this).getInt32(o, true); };
  P.readInt32BE = function (o) { return dv(this).getInt32(o, false); };
  P.readFloatLE = function (o) { return dv(this).getFloat32(o, true); };
  P.readFloatBE = function (o) { return dv(this).getFloat32(o, false); };
  P.readDoubleLE = function (o) { return dv(this).getFloat64(o, true); };
  P.readDoubleBE = function (o) { return dv(this).getFloat64(o, false); };
  P.readIntLE = function (o, n) { var v = 0; for (var i = n - 1; i >= 0; i--) v = v * 256 + this[o + i]; return v >= Math.pow(2, 8 * n - 1) ? v - Math.pow(2, 8 * n) : v; };
  P.readIntBE = function (o, n) { var v = 0; for (var i = 0; i < n; i++) v = v * 256 + this[o + i]; return v >= Math.pow(2, 8 * n - 1) ? v - Math.pow(2, 8 * n) : v; };
  P.write = function (s, o) { for (var i = 0; i < s.length; i++) this[(o || 0) + i] = s.charCodeAt(i) & 255; return s.length; };
  P.writeUInt32LE = function (v, o) { dv(this).setUint32(o, v, true); return o + 4; };
  P.writeUInt16LE = function (v, o) { dv(this).setUint16(o, v, true); return o + 2; };
  P.writeInt16LE = function (v, o) { dv(this).setInt16(o, v, true); return o + 2; };
  global.Buffer = NodeBuffer;

  // ------------------------------------------------------------ módulos tipo Node
  function fs(op, p, extra) { var b = extra || {}; b.op = op; b.path = p; return apiSync('fs', b); }
  var fsShim = {
    existsSync: function (p) { return fs('exists', p); },
    readFileSync: function (p, enc) {
      return enc ? fs('readText', p) : NodeBuffer.from(fs('readBase64', p), 'base64');
    },
    writeFileSync: function (p, data) {
      if (typeof data === 'string') fs('writeText', p, { data: data });
      else fs('writeBase64', p, { data: NodeBuffer.from(data).toString('base64') });
    },
    appendFileSync: function (p, data) { fs('appendText', p, { data: String(data) }); },
    statSync: function (p) { return fs('stat', p); },
    renameSync: function (p, to) { fs('rename', p, { to: to }); },
    mkdirSync: function (p) { fs('mkdir', p); },
    unlinkSync: function (p) { fs('unlink', p); },
    unlink: function (p, cb) { api('fs', { op: 'unlink', path: p }).then(function () { if (cb) cb(null); }, function (e) { if (cb) cb(e); }); }
  };
  var pathShim = {
    sep: '\\',
    join: function () {
      return Array.prototype.filter.call(arguments, Boolean).join('\\').replace(/[\\/]+/g, '\\');
    },
    dirname: function (p) { var i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 0 ? p.slice(0, i) : p; },
    basename: function (p) { return p.split(/[\\/]/).pop(); },
    extname: function (p) { var b = p.split(/[\\/]/).pop(), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; }
  };
  var osShim = { tmpdir: function () { return env.tmp; }, homedir: function () { return env.home; } };

  global.process = { platform: env.platform, env: { APPDATA: env.appdata } };
  global.require = function (name) {
    if (name === 'fs') return fsShim;
    if (name === 'path') return pathShim;
    if (name === 'os') return osShim;
    return {}; // https, child_process…: en este modo se usan las funciones del puente
  };

  // ------------------------------------------------------------ API pública del puente
  global.AutoSubBridge = {
    host: 'effectcraft',
    api: api,
    apiSync: apiSync,
    /** Ejecuta un comando de EffectCraft. Devuelve el "result" o lanza el error de EffectCraft. */
    ec: function (command, params) {
      return api('ec', { command: command, params: params || {} }).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'EffectCraft no respondió.');
        return r.result;
      });
    },
    http: function (opts) { return api('http', opts); },
    protect: function (text) { return apiSync('protect', { data: text }); },
    unprotect: function (b64) { return apiSync('unprotect', { data: b64 }); },
    saveDialog: function (title, name, ext) { return apiSync('saveDialog', { title: title, name: name, ext: ext }) || null; },
    openUrl: function (url) { api('openUrl', { url: url }); }
  };

  // Mantiene vivo el puente mientras la ventana está abierta
  api('ping');
  setInterval(function () { api('ping').catch(function () {}); }, 5000);
})(window);
