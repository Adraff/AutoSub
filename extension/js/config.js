/*
 * Configuración persistente del usuario (API key cifrada, modelo, ajustes y uso).
 * Se guarda fuera de la carpeta de la extensión para sobrevivir a reinstalaciones:
 *   Windows: %APPDATA%\AutoSub\config.json
 *   macOS:   ~/Library/Application Support/AutoSub/config.json
 *
 * La API key NUNCA se guarda en texto plano: se cifra con el sistema operativo (ver secret.js).
 */
(function (global) {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var os = require('os');

  function configDir() {
    if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AutoSub');
    }
    return path.join(os.homedir(), 'Library', 'Application Support', 'AutoSub');
  }

  function configFile() { return path.join(configDir(), 'config.json'); }

  var DEFAULTS = { model: '', settings: {}, usage: {}, limits: {} };
  var data = null;
  var keyCache = null; // clave descifrada, solo en memoria

  // mkdir recursivo compatible con versiones antiguas de Node (CEP 9 usa Node 8).
  function mkdirp(dir) {
    if (fs.existsSync(dir)) return;
    mkdirp(path.dirname(dir));
    fs.mkdirSync(dir);
  }

  function load() {
    if (data) return data;
    try { data = JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch (e) { data = {}; }
    for (var k in DEFAULTS) if (!(k in data)) data[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    // Migración: versiones anteriores guardaban la clave en texto plano
    if (data.apiKey) {
      var plain = data.apiKey;
      delete data.apiKey;
      try { setKey(plain); } catch (e2) { console.error(e2); }
      save();
    }
    return data;
  }

  function save() {
    try {
      mkdirp(configDir());
      fs.writeFileSync(configFile(), JSON.stringify(load(), null, 2), 'utf8');
    } catch (e) {
      console.error('No se pudo guardar la configuración', e);
    }
  }

  function getKey() {
    if (keyCache !== null) return keyCache;
    var enc = load().apiKeyEnc;
    try { keyCache = enc ? Secret.unprotect(enc) : ''; } catch (e) { keyCache = ''; }
    return keyCache;
  }

  function setKey(value) {
    var d = data; // ya cargado
    if (!value) {
      Secret.remove(d.apiKeyEnc);
      delete d.apiKeyEnc;
      keyCache = '';
    } else {
      d.apiKeyEnc = Secret.protect(value);
      keyCache = value;
    }
  }

  global.Config = {
    file: configFile,
    dir: configDir,
    hasKey: function () { return !!getKey(); },
    keyScheme: function () { var e = load().apiKeyEnc; return e ? e.scheme : ''; },
    get: function (key) { return key === 'apiKey' ? getKey() : load()[key]; },
    set: function (key, value) {
      load();
      if (key === 'apiKey') setKey(value); else data[key] = value;
      save();
    },
    getSettings: function () { return load().settings || {}; },
    setSettings: function (s) { load().settings = s; save(); }
  };
})(window);
