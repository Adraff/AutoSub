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

  var t = function (k, p) { return global.I18N ? global.I18N.t(k, p) : k; };

  function request(method, url, headers, body, onUploadProgress) {
    if (body && body.file) body = fs.createReadStream(body.file);
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
      req.on('error', function (e) { reject(new Error(t('g.net', { msg: e.message }))); });
      req.setTimeout(10 * 60 * 1000, function () { req.abort(); reject(new Error(t('g.timeout'))); });

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
      return new Error(t('g.keyInvalid'));
    }
    if (res.status === 403) return new Error(t('g.denied', { msg: msg }));
    if (res.status === 429) {
      var q = parseQuota(j);
      var text = q.perDay
        ? t('g.quotaDay')
        : t('g.quotaMin') + (q.retrySec ? t('g.retryIn', { s: Math.ceil(q.retrySec) }) : t('g.retryMin'));
      var err = new Error(text);
      err.quota = q;
      return err;
    }
    if (res.status >= 500) return new Error(t('g.busy', { status: res.status }));
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
      if (!uploadUrl) throw new Error(t('g.noUploadUrl'));
      return request('POST', uploadUrl, {
        'Content-Length': String(size),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      }, { file: filePath }, onProgress);
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
      if (f.state === 'FAILED') throw new Error(t('g.fileFailed'));
      if (++tries > 120) throw new Error(t('g.fileSlow'));
      return sleep(2000).then(function () { return getFile(apiKey, f.name); }).then(check);
    }
    return Promise.resolve(file).then(check);
  }

  function deleteFile(apiKey, name) {
    return request('DELETE', URL_BASE + '/v1beta/' + name, { 'x-goog-api-key': apiKey }).catch(function () {});
  }

  var LANG_NAMES = { es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', it: 'Italian', de: 'German', ca: 'Catalan',
    'español': 'Spanish', 'inglés': 'English', 'portugués': 'Portuguese', 'francés': 'French', 'italiano': 'Italian', 'alemán': 'German', 'catalán': 'Catalan' };

  /**
   * mode "literal": transcripción exacta.
   * mode "interpret": la IA entiende el contexto y escribe subtítulos limpios y legibles, como un
   * subtitulador profesional: sin muletillas, titubeos, repeticiones ni falsos comienzos, y corrigiendo
   * palabras mal pronunciadas o mal oídas según el contexto (sin cambiar el sentido ni resumir).
   */
  function buildPrompt(language, duration, mode) {
    var name = LANG_NAMES[language];
    var lang = name
      ? 'The audio is in ' + name + '. Write the subtitles in that language.'
      : 'Detect the spoken language automatically and write the subtitles in that same language.';
    var style = mode === 'interpret' ? [
      'You are a professional subtitle editor. Listen to the whole audio first and understand its context and topic.',
      'Write clean, readable subtitles that faithfully convey what the speaker MEANS, as a professional subtitler would:',
      '- Remove filler sounds and hesitations (e.g. "eh", "ehh", "eeeh", "mmm", "este", "o sea" used as filler, "um", "uh", "like" used as filler), stretched sounds ("yyyy", "peeero") and stutters.',
      '- Remove false starts and accidental repetitions ("el, el, el coche" becomes "el coche").',
      '- Fix mispronounced, cut-off or misheard words using the context, and write names, brands and technical terms correctly.',
      "- Keep the speaker's own words, tone and meaning. Do not summarize, do not add information, do not translate.",
      '- Use correct spelling, punctuation and capitalization.'
    ] : [
      'You are a professional subtitle transcriber with precise forced-alignment skills.',
      'Transcribe ALL speech in the attached audio verbatim.',
      'Never translate. Never summarize. Do not skip repeated words.',
      'Use natural punctuation and capitalization.'
    ];
    return style.concat([
      lang,
      'Ignore music, noises and non-speech sounds (do not output tags like [music]).',
      'Split the speech into short phrases of 1 to 8 words, cutting at natural pauses and meaningful units, like a professional subtitler (never end a phrase on an article, preposition or conjunction such as "de", "la", "y", "the", "of").',
      'For every phrase give "s" (start) and "e" (end) in SECONDS from the beginning of the audio, with 2 decimals (e.g. 12.34), and the text in "x".',
      'Times must match exactly when the phrase is spoken, be strictly increasing and never beyond the end of the audio' +
        (duration ? ' (' + duration.toFixed(2) + ' s)' : '') + '.',
      'If there is no speech, return an empty "p" array. Return the ISO 639-1 language code in "l".'
    ]).join('\n');
  }

  // Respuesta compacta: frases en lugar de palabras sueltas (gasta ~60-70% menos tokens de salida).
  // Los tiempos de cada palabra se reparten después y se afinan con el audio real.
  var RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      l: { type: 'STRING' },
      p: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { s: { type: 'NUMBER' }, e: { type: 'NUMBER' }, x: { type: 'STRING' } },
          required: ['s', 'e', 'x'],
          propertyOrdering: ['s', 'e', 'x']
        }
      }
    },
    required: ['p'],
    propertyOrdering: ['l', 'p']
  };

  /** Intenta recuperar las frases de un JSON cortado (cuando se agotan los tokens de salida). */
  function salvageJSON(text) {
    try { return JSON.parse(text); } catch (e) { /* sigue */ }
    var phrases = [];
    var re = /\{\s*"s"\s*:\s*([\d.]+)\s*,\s*"e"\s*:\s*([\d.]+)\s*,\s*"x"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g, m;
    while ((m = re.exec(text))) {
      phrases.push({ s: parseFloat(m[1]), e: parseFloat(m[2]), x: JSON.parse('"' + m[3] + '"') });
    }
    return { p: phrases, truncated: true };
  }

  /** Reparte cada frase en palabras con tiempos proporcionales a su longitud. */
  function phrasesToWords(phrases) {
    var words = [];
    (phrases || []).forEach(function (ph, pi) {
      var ws = String(ph.x || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
      var s = Number(ph.s), e = Number(ph.e);
      if (!ws.length || isNaN(s)) return;
      if (isNaN(e) || e <= s) e = s + 0.3 * ws.length;
      var tot = 0, acc = 0;
      ws.forEach(function (w) { tot += w.length + 1; });
      ws.forEach(function (w) {
        var a = s + (e - s) * acc / tot;
        acc += w.length + 1;
        words.push({ w: w, s: a, e: s + (e - s) * acc / tot, p: pi });
      });
    });
    return words;
  }

  /** Limpia y ordena los tiempos devueltos por la IA. */
  function sanitizeWords(words, duration) {
    var out = [];
    (words || []).forEach(function (x) {
      var w = String(x.w || '').replace(/\s+/g, ' ').trim();
      var s = Number(x.s), e = Number(x.e);
      if (!w || isNaN(s)) return;
      if (isNaN(e) || e < s) e = s + 0.25;
      out.push({ w: w, s: s, e: e, p: x.p });
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
    status(t('job.upload'), 0);
    return uploadFile(opts.apiKey, opts.filePath, opts.mimeType, function (p) {
      status(t('job.upload'), p * 0.8);
    }).then(function (file) {
      uploaded = file;
      status(t('job.processing'), 0.85);
      return waitActive(opts.apiKey, file);
    }).then(function (file) {
      status(t(opts.mode === 'interpret' ? 'job.interpreting' : 'job.transcribing'), -1);
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
            { text: buildPrompt(opts.language, opts.duration, opts.mode) }
          ]
        }],
        generationConfig: genConfig
      }, opts.onRequest);
    }).then(function (resp) {
      var cand = resp.candidates && resp.candidates[0];
      if (!cand) {
        var block = resp.promptFeedback && resp.promptFeedback.blockReason;
        throw new Error(t('g.noResult', { block: block ? t('g.blocked', { r: block }) : '' }));
      }
      var text = ((cand.content && cand.content.parts) || []).map(function (p) { return p.text || ''; }).join('');
      var parsed = salvageJSON(text);
      var truncated = !!parsed.truncated || cand.finishReason === 'MAX_TOKENS';
      return {
        phrases: (parsed.p || []).length,
        words: sanitizeWords(phrasesToWords(parsed.p), opts.duration),
        language: parsed.l || '',
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
    if (/(^|-)pro(-|$)|ultra|deep-?think/.test(id)) return { tier: 'paid', tag: 'model.paid', rank: 9 };
    if (/thinking|-exp|learnlm/.test(id)) return { tier: 'paid', tag: 'model.tokens', rank: 8 };
    if (/flash-lite|flash-8b/.test(id)) return { tier: 'free', tag: 'model.free', rec: true, rank: /latest/.test(id) ? 0 : 1 };
    if (/flash/.test(id)) return { tier: 'free', tag: 'model.free', rank: /latest/.test(id) ? 2 : 3 };
    return { tier: 'paid', tag: 'model.notrec', rank: 7 };
  }

  global.Gemini = {
    listModels: listModels,
    classifyModel: classifyModel,
    transcribe: transcribe,
    _sanitizeWords: sanitizeWords,
    _salvageJSON: salvageJSON,
    _phrasesToWords: phrasesToWords
  };
})(window);
