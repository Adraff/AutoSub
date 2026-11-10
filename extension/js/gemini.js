/*
 * Cliente mínimo de la API de Google Gemini (sin dependencias).
 * Usa el módulo https de Node incluido en CEP.
 *
 * Flujo de transcripción:
 *   1. Subir el audio con la Files API (subida reanudable en streaming).
 *   2. Esperar a que el archivo esté ACTIVE.
 *   3. generateContent pidiendo JSON con cada palabra y sus tiempos.
 *   4. Borrar el archivo subido.
 */
(function (global) {
  'use strict';

  var https = require('https');
  var fs = require('fs');
  var URL_BASE = 'https://generativelanguage.googleapis.com';

  function request(method, url, headers, body, onUploadProgress) {
    return new Promise(function (resolve, reject) {
      var u = new (require('url').URL)(url);
      var req = https.request({
        method: method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: headers || {}
      }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      });
      req.on('error', function (e) { reject(new Error('Error de red: ' + e.message)); });
      req.setTimeout(10 * 60 * 1000, function () { req.abort(); reject(new Error('Tiempo de espera agotado.')); });

      if (body && typeof body.pipe === 'function') {
        // Stream (archivo): reporta progreso de subida
        var sent = 0, total = Number(headers['Content-Length']) || 0;
        body.on('data', function (c) {
          sent += c.length;
          if (onUploadProgress && total) onUploadProgress(sent / total);
        });
        body.on('error', reject);
        body.pipe(req);
      } else {
        if (body) req.write(body);
        req.end();
      }
    });
  }

  /** Extrae del error 429 qué cuota se agotó (por día o por minuto), su límite y cuándo reintentar. */
  function parseQuota(j) {
    var q = { perDay: false, perMinute: false, limit: null, retrySec: null };
    var details = (j && j.error && j.error.details) || [];
    details.forEach(function (d) {
      var type = String(d['@type'] || '');
      if (/QuotaFailure$/.test(type)) {
        (d.violations || []).forEach(function (v) {
          var id = String(v.quotaId || '') + ' ' + String(v.quotaMetric || '');
          if (/PerDay/i.test(id)) {
            q.perDay = true;
            if (/Requests/i.test(id) && v.quotaValue) q.limit = Number(v.quotaValue);
          }
          if (/PerMinute/i.test(id)) q.perMinute = true;
        });
      } else if (/RetryInfo$/.test(type) && d.retryDelay) {
        q.retrySec = parseFloat(d.retryDelay);
      }
    });
    return q;
  }

  function apiError(res) {
    var msg = 'HTTP ' + res.status, j = null;
    try {
      j = JSON.parse(res.body);
      if (j.error && j.error.message) msg = j.error.message;
    } catch (e) { /* cuerpo no JSON */ }
    if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) {
      return new Error('La API key no es válida. Revisa que la copiaste completa (empieza por "AIza").');
    }
    if (res.status === 403) return new Error('Acceso denegado por Google: ' + msg);
    if (res.status === 429) {
      var q = parseQuota(j);
      var text = q.perDay
        ? 'Has agotado las peticiones gratuitas de hoy para este modelo. Se recargan a medianoche (hora del Pacífico) o puedes elegir otro modelo verde.'
        : 'Has alcanzado el límite gratuito por minuto de Gemini.' + (q.retrySec ? ' Vuelve a intentarlo en ' + Math.ceil(q.retrySec) + ' s.' : ' Espera un minuto y vuelve a intentarlo.');
      var err = new Error(text);
      err.quota = q;
      return err;
    }
    if (res.status >= 500) return new Error('Los servidores de Gemini están saturados (' + res.status + '). Inténtalo de nuevo en unos minutos.');
    return new Error(msg);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Lista los modelos que admiten generateContent. Sirve también para validar la clave. */
  function listModels(apiKey) {
    var all = [];
    function page(token) {
      var url = URL_BASE + '/v1beta/models?pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
      return request('GET', url, { 'x-goog-api-key': apiKey }).then(function (res) {
        if (res.status !== 200) throw apiError(res);
        var j = JSON.parse(res.body);
        (j.models || []).forEach(function (m) {
          var methods = m.supportedGenerationMethods || [];
          var id = String(m.name || '').replace(/^models\//, '');
          if (methods.indexOf('generateContent') >= 0 && /^gemini/i.test(id) &&
              !/(image|tts|embedding|live|native-audio|computer-use|robotics)/i.test(id)) {
            all.push({ id: id, label: m.displayName || id });
          }
        });
        if (j.nextPageToken) return page(j.nextPageToken);
        return all;
      });
    }
    return page(null);
  }

  /** Sube un archivo local con la Files API (subida reanudable). Devuelve el objeto file. */
  function uploadFile(apiKey, filePath, mimeType, onProgress) {
    var size = fs.statSync(filePath).size;
    var name = require('path').basename(filePath);
    return request('POST', URL_BASE + '/upload/v1beta/files', {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    }, JSON.stringify({ file: { display_name: 'autosub-' + name } })).then(function (res) {
      if (res.status !== 200) throw apiError(res);
      var uploadUrl = res.headers['x-goog-upload-url'];
      if (!uploadUrl) throw new Error('Google no devolvió la URL de subida.');
      return request('POST', uploadUrl, {
        'Content-Length': String(size),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      }, fs.createReadStream(filePath), onProgress);
    }).then(function (res) {
      if (res.status !== 200) throw apiError(res);
      return JSON.parse(res.body).file;
    });
  }

  function getFile(apiKey, name) {
    return request('GET', URL_BASE + '/v1beta/' + name, { 'x-goog-api-key': apiKey }).then(function (res) {
      if (res.status !== 200) throw apiError(res);
      return JSON.parse(res.body);
    });
  }

  function waitActive(apiKey, file) {
    var tries = 0;
    function check(f) {
      if (f.state === 'ACTIVE') return f;
      if (f.state === 'FAILED') throw new Error('Google no pudo procesar el audio subido.');
      if (++tries > 120) throw new Error('El audio tarda demasiado en procesarse en Google.');
      return sleep(2000).then(function () { return getFile(apiKey, f.name); }).then(check);
    }
    return Promise.resolve(file).then(check);
  }

  function deleteFile(apiKey, name) {
    return request('DELETE', URL_BASE + '/v1beta/' + name, { 'x-goog-api-key': apiKey }).catch(function () {});
  }

  function buildPrompt(language, duration) {
    var lang = (!language || language === 'auto')
      ? 'Detect the spoken language automatically and transcribe in that same language.'
      : 'The audio is in ' + language + ' (Spanish name of the language). Transcribe in that language.';
    return [
      'You are a professional subtitle transcriber with precise forced-alignment skills.',
      'Transcribe ALL speech in the attached audio, word by word, verbatim.',
      lang,
      'Never translate. Never summarize. Do not skip repeated words.',
      'Add natural punctuation and capitalization attached to the words (e.g. "Hola," "mundo.").',
      'Ignore music, noises and non-speech sounds (do not output tags like [music]).',
      'For every word give its start time "s" and end time "e" in SECONDS from the beginning of the audio, as decimal numbers with millisecond precision (e.g. 12.345).',
      'Timestamps must be accurate to the actual moment the word is spoken, strictly increasing, and never beyond the end of the audio' +
        (duration ? ' (' + duration.toFixed(2) + ' seconds)' : '') + '.',
      'If there is no speech at all, return an empty "words" array.',
      'Also return the ISO 639-1 code of the spoken language in "language".'
    ].join('\n');
  }

  var RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      language: { type: 'STRING' },
      words: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            w: { type: 'STRING' },
            s: { type: 'NUMBER' },
            e: { type: 'NUMBER' }
          },
          required: ['w', 's', 'e'],
          propertyOrdering: ['w', 's', 'e']
        }
      }
    },
    required: ['words'],
    propertyOrdering: ['language', 'words']
  };

  /** Intenta recuperar las palabras de un JSON cortado (cuando se agotan los tokens de salida). */
  function salvageJSON(text) {
    try { return JSON.parse(text); } catch (e) { /* sigue */ }
    var words = [];
    var re = /\{\s*"w"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"s"\s*:\s*([\d.]+)\s*,\s*"e"\s*:\s*([\d.]+)\s*\}/g, m;
    while ((m = re.exec(text))) {
      words.push({ w: JSON.parse('"' + m[1] + '"'), s: parseFloat(m[2]), e: parseFloat(m[3]) });
    }
    return { words: words, truncated: true };
  }

  /** Limpia y ordena los tiempos devueltos por la IA. */
  function sanitizeWords(words, duration) {
    var out = [];
    (words || []).forEach(function (x) {
      var w = String(x.w || '').replace(/\s+/g, ' ').trim();
      var s = Number(x.s), e = Number(x.e);
      if (!w || isNaN(s)) return;
      if (isNaN(e) || e < s) e = s + 0.25;
      out.push({ w: w, s: s, e: e });
    });
    if (!out.length) return out;

    // Algunos modelos devuelven milisegundos: lo detectamos y corregimos.
    var maxT = out[out.length - 1].e;
    if (duration > 0 && maxT > duration * 5 && maxT / 1000 <= duration * 1.5) {
      out.forEach(function (x) { x.s /= 1000; x.e /= 1000; });
    }

    out.sort(function (a, b) { return a.s - b.s; });
    for (var i = 0; i < out.length; i++) {
      var cur = out[i], next = out[i + 1];
      if (duration > 0) { cur.s = Math.min(cur.s, duration); cur.e = Math.min(cur.e, duration); }
      if (next && cur.e > next.s) cur.e = Math.max(cur.s + 0.05, next.s);
      if (cur.e - cur.s < 0.05) cur.e = cur.s + 0.05;
      cur.s = Math.round(cur.s * 1000) / 1000;
      cur.e = Math.round(cur.e * 1000) / 1000;
    }
    return out;
  }

  function generate(apiKey, model, body, onRequest) {
    var url = URL_BASE + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    var attempt = 0;
    function go() {
      return request('POST', url, {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      }, JSON.stringify(body)).then(function (res) {
        // Cada petición (salvo las rechazadas por cuota) cuenta para el límite diario
        if (res.status !== 429 && onRequest) onRequest();
        if ((res.status === 503 || res.status === 500) && attempt < 2) {
          attempt++;
          return sleep(4000 * attempt).then(go);
        }
        if (res.status !== 200) throw apiError(res);
        return JSON.parse(res.body);
      });
    }
    return go();
  }

  /**
   * Transcribe un archivo de audio/vídeo local.
   * opts: { apiKey, model, filePath, mimeType, language, duration,
   *         onStatus(texto, fraccion 0..1 o -1 si es indeterminado), onRequest() }
   * Devuelve { words:[{w,s,e}], language, truncated, usage }
   */
  function transcribe(opts) {
    var status = opts.onStatus || function () {};
    var uploaded = null;
    status('Subiendo audio a Gemini', 0);
    return uploadFile(opts.apiKey, opts.filePath, opts.mimeType, function (p) {
      status('Subiendo audio a Gemini', p * 0.8);
    }).then(function (file) {
      uploaded = file;
      status('Google está procesando el audio', 0.85);
      return waitActive(opts.apiKey, file);
    }).then(function (file) {
      status('La IA está transcribiendo', -1);
      var genConfig = {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 65536
      };
      // En los modelos 2.5 flash desactivamos el "razonamiento": más rápido y deja todos los tokens para la transcripción.
      if (/2\.5-flash/i.test(opts.model)) genConfig.thinkingConfig = { thinkingBudget: 0 };
      return generate(opts.apiKey, opts.model, {
        contents: [{
          role: 'user',
          parts: [
            { file_data: { mime_type: file.mimeType || opts.mimeType, file_uri: file.uri } },
            { text: buildPrompt(opts.language, opts.duration) }
          ]
        }],
        generationConfig: genConfig
      }, opts.onRequest);
    }).then(function (resp) {
      var cand = resp.candidates && resp.candidates[0];
      if (!cand) {
        var block = resp.promptFeedback && resp.promptFeedback.blockReason;
        throw new Error('Gemini no devolvió resultado' + (block ? ' (bloqueado: ' + block + ')' : '') + '.');
      }
      var text = ((cand.content && cand.content.parts) || []).map(function (p) { return p.text || ''; }).join('');
      var parsed = salvageJSON(text);
      var truncated = !!parsed.truncated || cand.finishReason === 'MAX_TOKENS';
      return {
        words: sanitizeWords(parsed.words, opts.duration),
        language: parsed.language || '',
        truncated: truncated,
        usage: resp.usageMetadata || {}
      };
    }).then(function (result) {
      if (uploaded) deleteFile(opts.apiKey, uploaded.name);
      return result;
    }, function (err) {
      if (uploaded) deleteFile(opts.apiKey, uploaded.name);
      throw err;
    });
  }

  /**
   * Clasifica un modelo para esta herramienta (transcribir audio):
   *  - free: tiene nivel gratuito y gasta pocos tokens (familia "flash").
   *    El "flash-lite" es el recomendado: el más barato en tokens y suficiente para transcribir.
   *  - paid: de pago o que gasta tokens de más (pro, razonamiento extendido, experimentales…).
   * Google no publica los precios en la API, así que se deduce del nombre del modelo.
   */
  function classifyModel(id) {
    id = String(id).toLowerCase();
    if (/(^|-)pro(-|$)|ultra|deep-?think/.test(id)) return { tier: 'paid', tag: 'de pago', rank: 9 };
    if (/thinking|-exp|learnlm/.test(id)) return { tier: 'paid', tag: 'más tokens', rank: 8 };
    if (/flash-lite|flash-8b/.test(id)) return { tier: 'free', tag: 'gratuito', rec: true, rank: /latest/.test(id) ? 0 : 1 };
    if (/flash/.test(id)) return { tier: 'free', tag: 'gratuito', rank: /latest/.test(id) ? 2 : 3 };
    return { tier: 'paid', tag: 'no recomendado', rank: 7 };
  }

  global.Gemini = {
    listModels: listModels,
    classifyModel: classifyModel,
    transcribe: transcribe,
    _sanitizeWords: sanitizeWords,
    _salvageJSON: salvageJSON
  };
})(window);
