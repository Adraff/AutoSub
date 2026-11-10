/*
 * Contador de uso de la API key (estimado en este equipo).
 *
 * Google no ofrece ninguna forma de consultar cuánta cuota gratuita te queda, así que:
 *  - contamos cada petición de transcripción y los tokens que informa Gemini,
 *  - el contador se reinicia a medianoche hora del Pacífico (como la cuota de Google),
 *  - el límite diario se aprende automáticamente del error 429 de Google, y además
 *    se puede ajustar a mano en Ajustes.
 * En el nivel gratuito el límite que se agota en la práctica es el de PETICIONES POR DÍA
 * (los tokens se limitan por minuto, no por día).
 */
(function (root) {
  'use strict';

  var DEFAULT_RPD = 20; // valor prudente hasta conocer el real

  function pacificNow(d) {
    var f = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var p = {};
    f.formatToParts(d || new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { day: p.year + '-' + p.month + '-' + p.day, h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
  }

  function msToReset(d) {
    var p = pacificNow(d);
    return (86400 - (p.h * 3600 + p.m * 60 + p.s)) * 1000;
  }

  function usage() {
    var u = Config.get('usage') || {};
    var today = pacificNow().day;
    if (u.day !== today) u = { day: today, models: {} };
    if (!u.models) u.models = {};
    return u;
  }

  function entry(u, model) {
    if (!u.models[model]) u.models[model] = { req: 0, tokens: 0, exhausted: false };
    return u.models[model];
  }

  function limitFor(model) {
    var l = (Config.get('limits') || {})[model];
    return l && l.rpd ? l : { rpd: DEFAULT_RPD, source: 'default' };
  }

  var api = {
    msToReset: msToReset,

    recordRequest: function (model) {
      var u = usage(); entry(u, model).req++; Config.set('usage', u);
    },

    recordTokens: function (model, tokens) {
      var u = usage(); entry(u, model).tokens += Number(tokens) || 0; Config.set('usage', u);
    },

    /** Aprende del error 429 de Google (límite real y si se agotó la cuota diaria). */
    learnFromError: function (model, q) {
      if (!q) return;
      if (q.limit) {
        var limits = Config.get('limits') || {};
        limits[model] = { rpd: q.limit, source: 'google' };
        Config.set('limits', limits);
      }
      if (q.perDay) {
        var u = usage(), e = entry(u, model);
        e.exhausted = true;
        if (q.limit) e.req = Math.max(e.req, q.limit);
        Config.set('usage', u);
      }
    },

    setLimit: function (model, rpd) {
      var limits = Config.get('limits') || {};
      if (rpd > 0) limits[model] = { rpd: Math.round(rpd), source: 'user' };
      else delete limits[model];
      Config.set('limits', limits);
    },

    status: function (model) {
      var u = usage(), e = u.models[model] || { req: 0, tokens: 0, exhausted: false };
      var l = limitFor(model);
      var used = e.exhausted ? Math.max(e.req, l.rpd) : e.req;
      return {
        used: used, limit: l.rpd, source: l.source, tokens: e.tokens,
        pct: Math.min(1, used / l.rpd), exhausted: e.exhausted || used >= l.rpd,
        resetMs: msToReset()
      };
    }
  };

  root.Quota = api;
})(window);
