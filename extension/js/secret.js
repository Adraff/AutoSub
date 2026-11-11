/*
 * Guardado cifrado de la API key con el sistema operativo (sin dependencias).
 *
 *  Windows: DPAPI (ProtectedData, ámbito CurrentUser). La clave cifrada solo la puede
 *           descifrar tu misma cuenta de Windows en este equipo. Otros usuarios del
 *           ordenador (u otro PC al que se copie el archivo) no pueden leerla.
 *  macOS:   Llavero (Keychain) de tu usuario.
 *
 * El secreto se pasa a PowerShell por una variable de entorno del proceso hijo,
 * nunca por la línea de comandos (que otros usuarios podrían ver en el administrador de tareas).
 */
(function (root) {
  'use strict';

  var cp = require('child_process');
  var ENTROPY = 'AutoSub-AE-v1';
  var KC_SERVICE = 'com.autosub.ae.apikey', KC_ACCOUNT = 'autosub';

  function ps(script, input) {
    var env = {};
    for (var k in process.env) env[k] = process.env[k];
    env.AUTOSUB_IN = input;
    var exe = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    var out = cp.execFileSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env: env, windowsHide: true, timeout: 20000
    });
    return String(out).trim();
  }

  var PS_HEAD = 'Add-Type -AssemblyName System.Security; $e=[Text.Encoding]::UTF8.GetBytes("' + ENTROPY + '"); ';

  var bridge = root.AutoSubBridge || null;

  function protect(plain) {
    if (bridge) return { scheme: 'dpapi', data: bridge.protect(plain) }; // mismo cifrado DPAPI, hecho por el puente
    if (process.platform === 'win32') {
      var data = ps(PS_HEAD +
        '$b=[Text.Encoding]::UTF8.GetBytes($env:AUTOSUB_IN); ' +
        '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$e,"CurrentUser"))', plain);
      if (!data) throw new Error('No se pudo cifrar la clave.');
      return { scheme: 'dpapi', data: data };
    }
    if (process.platform === 'darwin') {
      cp.execFileSync('security', ['add-generic-password', '-U', '-a', KC_ACCOUNT, '-s', KC_SERVICE, '-w', plain]);
      return { scheme: 'keychain' };
    }
    throw new Error('Sistema no compatible con el guardado cifrado.');
  }

  function unprotect(obj) {
    if (!obj || !obj.scheme) return '';
    if (obj.scheme === 'dpapi' && bridge) return bridge.unprotect(obj.data);
    if (obj.scheme === 'dpapi') {
      // Se devuelve en base64 para no depender de la codificación de la consola
      var b64 = ps(PS_HEAD +
        '$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:AUTOSUB_IN),$e,"CurrentUser"); ' +
        '[Convert]::ToBase64String($b)', obj.data);
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    if (obj.scheme === 'keychain') {
      return String(cp.execFileSync('security', ['find-generic-password', '-a', KC_ACCOUNT, '-s', KC_SERVICE, '-w'])).trim();
    }
    return '';
  }

  function remove(obj) {
    if (obj && obj.scheme === 'keychain') {
      try { cp.execFileSync('security', ['delete-generic-password', '-a', KC_ACCOUNT, '-s', KC_SERVICE]); } catch (e) {}
    }
  }

  var api = { protect: protect, unprotect: unprotect, remove: remove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Secret = api;
})(typeof window !== 'undefined' ? window : this);
