/*
 * Textos del panel en español e inglés.
 * Idioma: el elegido en Ajustes o, en "Automático", el idioma de la interfaz de After Effects.
 * Uso: I18N.t('clave', { n: 3 }) → texto con {n} sustituido.
 * En el HTML: data-i18n="clave" (texto), data-i18n-html (con etiquetas), data-i18n-title, data-i18n-ph (placeholder).
 */
(function (global) {
  'use strict';

  var S = {
    es: {
      // pestañas
      'tab.gen': 'Generar', 'tab.edit': 'Editar', 'tab.export': 'Exportar', 'tab.log': 'Log',
      'tab.settings.title': 'Ajustes y API key', 'tab.edit.locked': 'Genera los subtítulos primero',
      // asistente
      'wz.title': 'Configura tu API key', 'wz.sub': 'Gratis, con tu cuenta de Google.',
      'wz.s1.h': '¿Qué es?',
      'wz.s1.p1': 'AutoSub usa <b>Google Gemini</b> para transcribir el audio. Cada persona usa <b>su propia clave gratuita</b> (con límites diarios).',
      'wz.s1.p2': 'La clave se guarda <b>cifrada</b> con tu usuario del sistema: otras cuentas del ordenador no pueden leerla. Solo se envía a Google.',
      'wz.s2.h': 'Abre Google AI Studio', 'wz.s2.p': 'Inicia sesión con tu cuenta de Google en la página de claves.',
      'wz.s2.btn': 'Abrir aistudio.google.com/apikey ↗', 'wz.s2.note': 'Si es la primera vez, acepta las condiciones de AI Studio.',
      'wz.s3.h': 'Crea la clave', 'wz.s3.l1': 'Pulsa <b>"Create API key"</b>.', 'wz.s3.l2': 'Si te lo pide, elige el proyecto que viene por defecto.',
      'wz.s3.l3': 'Copia la clave. Empieza por <code>AIza…</code>', 'wz.s3.note': 'No hace falta tarjeta ni facturación.',
      'wz.s4.h': 'Pégala aquí', 'wz.validate': 'Comprobar y guardar', 'wz.back': 'Atrás', 'wz.next': 'Siguiente', 'wz.skip': 'Más tarde',
      'common.showHide': 'Mostrar/ocultar',
      // generar
      'gen.selectComp': 'Selecciona una composición…', 'gen.openComp': '⚠ Abre una composición', 'gen.noAudio': '⚠ sin audio · ',
      'gen.hasSubs': ' · ✓ subtítulos', 'gen.workArea': 'Área de trabajo', 'gen.subLayer': 'Capa de subtítulos', 'gen.selLayer': 'Capa seleccionada',
      'gen.audio': 'Audio', 'gen.audio.title': 'De dónde se toma el audio', 'gen.audio.comp': 'Composición', 'gen.audio.layer': 'Capa seleccionada',
      'gen.lang': 'Idioma del audio', 'lang.auto': 'Automático', 'lang.es': 'Español', 'lang.en': 'Inglés', 'lang.pt': 'Portugués',
      'lang.fr': 'Francés', 'lang.it': 'Italiano', 'lang.de': 'Alemán', 'lang.ca': 'Catalán',
      'gen.boxWidth': 'Ancho caja (px)', 'gen.box80': '80% del ancho de la composición', 'gen.maxLines': 'Líneas máx.',
      'gen.font': 'Tipografía', 'gen.fontSearch': 'Buscar tipografía…', 'gen.fontLoading': 'Cargando fuentes…',
      'gen.fontNeeds': 'Requiere After Effects 2024 o posterior', 'gen.fontCount': '({n} familias)', 'gen.fontNone': 'Sin resultados',
      'gen.keepSilence': 'Mantener en silencios', 'gen.keepSilence.title': 'Si está desactivado, el subtítulo desaparece cuando nadie habla',
      'gen.bgBox': 'Caja de fondo', 'gen.stroke': 'Trazo', 'gen.shadow': 'Sombra',
      'gen.shadow.title': 'Añade el efecto "Sombra paralela" de After Effects a la capa (se edita en Controles de efectos)',
      'gen.adv': 'Avanzado', 'gen.gapBreak': 'Silencio que corta (s)', 'gen.maxDuration': 'Duración máx. (s)',
      'gen.fontSize': 'Letra inicial (px)', 'gen.bottomPad': 'Margen inferior (px)',
      'gen.bottomPad.title': 'Distancia entre la caja de subtítulos y el borde inferior al crearla (solo para colocarla la primera vez)',
      'gen.breakPunct': 'Cortar tras . ? !', 'gen.vad': 'Ajuste fino con el audio', 'gen.vad.title': 'Analiza el audio para encajar cada frase donde realmente se oye la voz',
      'gen.trim': 'Quitar silencios al enviar', 'gen.trim.title': 'Envía a la IA solo los tramos con voz: gasta menos tokens',
      'gen.model.title': 'Modelo de IA', 'gen.btnLiteral': '✦ Generar', 'gen.btnLiteral.title': 'Transcripción literal: escribe exactamente lo que se dice',
      'gen.btnInterp': '✧ Interpretativa',
      'gen.btnInterp.title': 'La IA entiende el contexto y escribe subtítulos limpios: sin muletillas ("eeeh", "yyyy"), sin repeticiones ni palabras mal pronunciadas',
      'gen.reflow.title': 'Reorganizar con los ajustes y el estilo actuales (sin volver a llamar a la IA)',
      // modelos y cuota
      'model.free': 'gratuito', 'model.paid': 'de pago', 'model.tokens': 'más tokens', 'model.notrec': 'no recomendado',
      'model.sepFree': 'Gratuitos · recomendados', 'model.sepPaid': 'De pago o gastan más tokens', 'model.rec': 'recomendado: el que menos tokens gasta',
      'quota.exhausted': 'Cuota agotada', 'quota.left': 'Quedan {approx}{left}/{limit} hoy', 'quota.reset': ' · se recarga en {time}',
      'quota.tip': 'Uso estimado de tu API key para {model} en este equipo:\n{used} peticiones y {tokens} tokens hoy.\nLímite: {limit} peticiones/día {src}\nSe recarga a medianoche, hora del Pacífico.',
      'quota.src.google': '(informado por Google)', 'quota.src.user': '(ajustado por ti)', 'quota.src.default': '(estimado; ajústalo en Ajustes)',
      // editor
      'edit.search': 'Buscar…', 'edit.addHere': '＋ Aquí', 'edit.addHere.title': 'Crear un subtítulo en el punto actual de la línea de tiempo',
      'edit.reload.title': 'Recargar desde la capa', 'edit.save': 'Guardar', 'edit.saveN': 'Guardar ({n})',
      'edit.changed': 'Los subtítulos cambiaron en la línea de tiempo (por ejemplo con Ctrl+Z). <a id="subReload">Recargar</a> (perderás los cambios sin guardar).',
      'edit.none': 'Sin subtítulos cargados.', 'edit.empty': 'No hay subtítulos. Usa "＋ Aquí" para crear uno en el punto actual de la línea de tiempo.',
      'edit.hint': 'Estilo: cambia la fuente/tamaño de la capa en el panel Carácter y pulsa ↻ en Generar. Usa <code>|</code> para saltar de línea. Al guardar solo se aplican tus cambios: los ajustes hechos a mano en los marcadores se respetan, y todo se puede deshacer con Ctrl+Z.',
      'edit.in': 'Entrada (s)', 'edit.out': 'Salida (s)', 'edit.textPh': 'Texto del subtítulo', 'edit.go': 'Ir a este momento',
      'edit.add': 'Añadir un subtítulo después de este', 'edit.del': 'Eliminar este subtítulo',
      // exportar
      'exp.format': 'Formato', 'exp.txt': 'Texto (.txt)', 'exp.json': 'JSON (por palabra)', 'exp.origin': 'Tiempos desde',
      'exp.origin.comp': 'Inicio comp.', 'exp.origin.wa': 'Área de trabajo', 'exp.oneLine': 'Unir líneas en una', 'exp.btn': 'Exportar archivo…',
      'exp.dialog': 'Exportar subtítulos', 'exp.reading': 'Leyendo subtítulos…', 'exp.none': 'No hay subtítulos que exportar.',
      'exp.cancel': 'Exportación cancelada.', 'exp.saved': '✔ Guardado: {file} ({n} subtítulos)',
      // log
      'log.desc': 'Registro de todo lo que hace AutoSub', 'log.copy': 'Copiar', 'log.clear': 'Limpiar',
      'log.emptyStart': 'Todavía no hay actividad.', 'log.empty': 'Log vacío.', 'log.view': 'Ver log',
      // ajustes
      'set.key': 'API key de Gemini', 'set.save': 'Guardar', 'set.guide': 'Guía', 'set.models': 'Modelos ⟳', 'set.models.title': 'Actualizar la lista de modelos',
      'set.delete': 'Borrar', 'set.quota': 'Cuota diaria', 'set.rpd': 'Peticiones/día ({model})', 'set.limits': 'Ver límites reales ↗',
      'set.quotaHint': 'Google no permite consultar la cuota restante, así que AutoSub cuenta tus peticiones en este equipo y se reinicia a medianoche (hora del Pacífico). El límite se corrige solo si Google avisa de que se agotó.',
      'set.uiLang': 'Idioma del panel', 'set.uiLang.auto': 'Automático (idioma de After Effects)',
      'key.ok': 'Ajustes · API key guardada', 'key.missing': 'Ajustes · Falta la API key', 'key.saved': 'Guardada y cifrada (••••{last})',
      'key.dpapi': '🔒 Cifrada con tu cuenta de Windows (DPAPI): otras cuentas del equipo no pueden leerla.',
      'key.keychain': '🔒 Guardada en el Llavero de tu usuario de macOS.', 'key.none': 'Sin clave. Pulsa "Guía" para crear una gratis.',
      'key.pasteFirst': 'Pega primero tu clave.', 'key.checking': 'Comprobando la clave con Google…',
      'key.encryptFail': '✖ No se pudo cifrar la clave: {msg}', 'key.valid': '✔ Clave válida, cifrada y guardada.',
      'key.confirmDelete': '¿Borrar la API key guardada en este equipo?', 'key.deleted': 'Clave borrada.', 'key.needFirst': 'Primero guarda tu API key.',
      'models.updated': 'Lista de modelos actualizada.',
      // trabajo y log
      'job.exportComp': 'Exportando el audio de la composición', 'job.exportLayer': 'Exportando el audio de la capa',
      'job.optimize': 'Optimizando el audio', 'job.upload': 'Subiendo audio a Gemini', 'job.processing': 'Google está procesando el audio',
      'job.transcribing': 'La IA está transcribiendo', 'job.interpreting': 'La IA está interpretando y escribiendo',
      'job.align': 'Ajustando tiempos con el audio', 'job.measure': 'Midiendo la tipografía', 'job.check': 'Comprobando la caja de texto',
      'job.create': 'Creando {n} subtítulos', 'job.done': '✔ {n} subtítulos creados', 'job.readWords': 'Leyendo palabras guardadas',
      'job.reflowed': '✔ Reorganizado: {n} subtítulos', 'job.retry': ' Reintentar',
      'l.start': 'AutoSub iniciado. Configuración: {file}', 'l.lang': 'Idioma del panel: {lang}.',
      'l.run.gen': 'Generar subtítulos · {model}', 'l.run.interp': 'Generación interpretativa · {model}', 'l.run.reflow': 'Reorganizar',
      'l.exportComp': 'Exportando el audio de la composición (área de trabajo)…', 'l.exportLayer': 'Exportando solo el audio de la capa "{name}"…',
      'l.exported': 'Audio exportado: {path}', 'l.useFile': 'Usando el archivo original: {path}',
      'l.layerFail': 'No se pudo exportar el audio de la capa: {msg}', 'l.compFail': 'No se pudo exportar el audio de la composición: {msg}',
      'l.tryLayerFile': 'Probando con el archivo de la capa seleccionada…',
      'e.selectLayer': 'Selecciona en la línea de tiempo la capa a subtitular.',
      'e.compAudioHint': ' Selecciona la capa de vídeo y elige "Audio: Capa seleccionada".',
      'e.format': 'Formato no compatible con Gemini: .{ext}. Usa "Audio: Composición".',
      'l.optimized': 'Audio optimizado: mono 16 kHz, {mb} MB.', 'l.trimmed': 'Silencios quitados: se envían {sent} de {total} ({pct}% menos tokens de entrada).',
      'l.optFail': 'No se pudo optimizar el audio ({msg}); se envía tal cual.', 'l.sending': 'Enviando: {mb} MB, {dur} ({mime}).',
      'l.long': 'Aviso: más de 20 min de audio pueden superar el límite de respuesta de la IA.',
      'l.video': 'Aviso: se subirá un vídeo completo; gasta muchos más tokens. Usa "Audio: Composición" o selecciona la capa con audio.',
      'l.response': 'Respuesta de la IA: {phrases} frases, {words} palabras · {tokens} tokens ({in} de entrada, {out} de salida).',
      'l.truncated': 'La respuesta de la IA se cortó: puede que falten las últimas frases.',
      'l.aligned': 'Tiempos ajustados a {n} tramos de voz detectados en el audio.', 'l.noContrast': 'No se distinguió la voz del fondo; se usan los tiempos de la IA.',
      'l.noAlign': 'Ajuste fino no disponible con este archivo de origen; se usan los tiempos de la IA.',
      'e.noSpeech': 'La IA no detectó voz en el audio.', 'l.detected': 'Idioma detectado: {lang}',
      'l.done': 'Listo: {n} subtítulos creados en una sola capa.', 'l.error': 'Error: {msg}',
      'e.noComp': 'Abre una composición en la línea de tiempo.', 'q.confirmExhausted': 'Según el contador, la cuota gratuita de hoy para este modelo está agotada.\n¿Intentarlo igualmente?',
      'e.noWords': 'No hay palabras guardadas en la capa. Genera los subtítulos primero.', 'l.reflowed': 'Reorganizado: {n} subtítulos.',
      'l.measure': 'Midiendo {n} palabras con la tipografía de la capa…',
      'l.boxRetry': 'Ajuste de caja: {n} subtítulo(s) ocupaban más de {lines} líneas; se recalculan los cortes.',
      'l.boxSplit': 'Ajuste de caja: se dividen {n} subtítulo(s) que no cabían.',
      'l.creating': 'Creando {n} subtítulos (ancho {w} px, máx. {lines} líneas, {silence} en silencios)…',
      'l.silKeep': 'se mantienen', 'l.silHide': 'se ocultan',
      'l.fontsLoaded': 'Tipografías del sistema cargadas: {n} familias.', 'l.fontsNeed': 'La lista de tipografías requiere After Effects 2024 o posterior; usa el panel Carácter.',
      'l.fontsFail': 'No se pudieron leer las tipografías: {msg}', 'l.fontSel': 'Tipografía seleccionada: {name} ({ps})',
      'l.model': 'Modelo seleccionado: {id}', 'l.keySaved': 'API key validada y guardada cifrada ({n} modelos disponibles).',
      'l.keyRejected': 'API key rechazada: {msg}', 'l.keyEncFail': 'Error al cifrar la API key: {msg}', 'l.keyDeleted': 'API key borrada de este equipo.',
      'l.modelsUpdated': 'Lista de modelos actualizada ({n}).', 'l.limitSet': 'Límite diario de {model} ajustado a {n} peticiones.',
      'l.editNew': 'Editor: nuevo subtítulo en {t} (pendiente de guardar).', 'l.editNone': 'Editor: no hay cambios que guardar.',
      'l.editSaved': 'Editor: guardados {c} cambios y {i} subtítulos nuevos ({n} en total). Se puede deshacer con Ctrl+Z en After Effects.',
      'l.editMissing': 'Editor: {n} subtítulo(s) ya no existían en la capa y se omitieron.', 'l.editErr': 'Error al guardar en el editor: {msg}',
      'l.exported2': 'Exportado {fmt}: {file} ({n} subtítulos).', 'l.exportErr': 'Error al exportar: {msg}', 'l.connErr': 'Error de conexión: {msg}',
      // errores de Gemini
      'g.keyInvalid': 'La API key no es válida. Revisa que la copiaste completa (empieza por "AIza").',
      'g.denied': 'Acceso denegado por Google: {msg}',
      'g.quotaDay': 'Has agotado las peticiones gratuitas de hoy para este modelo. Se recargan a medianoche (hora del Pacífico) o puedes elegir otro modelo verde.',
      'g.quotaMin': 'Has alcanzado el límite gratuito por minuto de Gemini.', 'g.retryIn': ' Vuelve a intentarlo en {s} s.', 'g.retryMin': ' Espera un minuto y vuelve a intentarlo.',
      'g.busy': 'Los servidores de Gemini están saturados ({status}). Inténtalo de nuevo en unos minutos.',
      'g.net': 'Error de red: {msg}', 'g.timeout': 'Tiempo de espera agotado.', 'g.noUploadUrl': 'Google no devolvió la URL de subida.',
      'g.fileFailed': 'Google no pudo procesar el audio subido.', 'g.fileSlow': 'El audio tarda demasiado en procesarse en Google.',
      'g.noResult': 'Gemini no devolvió resultado{block}.', 'g.blocked': ' (bloqueado: {r})'
    },

    en: {
      'tab.gen': 'Generate', 'tab.edit': 'Edit', 'tab.export': 'Export', 'tab.log': 'Log',
      'tab.settings.title': 'Settings and API key', 'tab.edit.locked': 'Generate the subtitles first',
      'wz.title': 'Set up your API key', 'wz.sub': 'Free, with your Google account.',
      'wz.s1.h': 'What is it?',
      'wz.s1.p1': 'AutoSub uses <b>Google Gemini</b> to transcribe the audio. Everyone uses <b>their own free key</b> (with daily limits).',
      'wz.s1.p2': 'The key is stored <b>encrypted</b> with your system user: other accounts on the computer cannot read it. It is only sent to Google.',
      'wz.s2.h': 'Open Google AI Studio', 'wz.s2.p': 'Sign in with your Google account on the keys page.',
      'wz.s2.btn': 'Open aistudio.google.com/apikey ↗', 'wz.s2.note': 'If it is your first time, accept the AI Studio terms.',
      'wz.s3.h': 'Create the key', 'wz.s3.l1': 'Click <b>"Create API key"</b>.', 'wz.s3.l2': 'If asked, choose the default project.',
      'wz.s3.l3': 'Copy the key. It starts with <code>AIza…</code>', 'wz.s3.note': 'No card or billing needed.',
      'wz.s4.h': 'Paste it here', 'wz.validate': 'Check and save', 'wz.back': 'Back', 'wz.next': 'Next', 'wz.skip': 'Later',
      'common.showHide': 'Show/hide',
      'gen.selectComp': 'Select a composition…', 'gen.openComp': '⚠ Open a composition', 'gen.noAudio': '⚠ no audio · ',
      'gen.hasSubs': ' · ✓ subtitles', 'gen.workArea': 'Work area', 'gen.subLayer': 'Subtitle layer', 'gen.selLayer': 'Selected layer',
      'gen.audio': 'Audio', 'gen.audio.title': 'Where the audio comes from', 'gen.audio.comp': 'Composition', 'gen.audio.layer': 'Selected layer',
      'gen.lang': 'Audio language', 'lang.auto': 'Automatic', 'lang.es': 'Spanish', 'lang.en': 'English', 'lang.pt': 'Portuguese',
      'lang.fr': 'French', 'lang.it': 'Italian', 'lang.de': 'German', 'lang.ca': 'Catalan',
      'gen.boxWidth': 'Box width (px)', 'gen.box80': '80% of the composition width', 'gen.maxLines': 'Max. lines',
      'gen.font': 'Typeface', 'gen.fontSearch': 'Search typeface…', 'gen.fontLoading': 'Loading fonts…',
      'gen.fontNeeds': 'Requires After Effects 2024 or later', 'gen.fontCount': '({n} families)', 'gen.fontNone': 'No results',
      'gen.keepSilence': 'Keep during silences', 'gen.keepSilence.title': 'When off, the subtitle disappears while nobody is speaking',
      'gen.bgBox': 'Background box', 'gen.stroke': 'Stroke', 'gen.shadow': 'Shadow',
      'gen.shadow.title': 'Adds After Effects\' "Drop Shadow" effect to the layer (edit it in Effect Controls)',
      'gen.adv': 'Advanced', 'gen.gapBreak': 'Pause that splits (s)', 'gen.maxDuration': 'Max. duration (s)',
      'gen.fontSize': 'Initial size (px)', 'gen.bottomPad': 'Bottom margin (px)',
      'gen.bottomPad.title': 'Distance between the subtitle box and the bottom edge when it is created (only for its first placement)',
      'gen.breakPunct': 'Split after . ? !', 'gen.vad': 'Fine sync with the audio', 'gen.vad.title': 'Analyzes the audio to place each phrase where the voice is actually heard',
      'gen.trim': 'Remove silences when sending', 'gen.trim.title': 'Sends only the speech parts to the AI: uses fewer tokens',
      'gen.model.title': 'AI model', 'gen.btnLiteral': '✦ Generate', 'gen.btnLiteral.title': 'Literal transcription: writes exactly what is said',
      'gen.btnInterp': '✧ Interpretive',
      'gen.btnInterp.title': 'The AI understands the context and writes clean subtitles: no fillers ("uhhh", "umm"), repetitions or mispronounced words',
      'gen.reflow.title': 'Re-layout with the current settings and style (without calling the AI again)',
      'model.free': 'free', 'model.paid': 'paid', 'model.tokens': 'more tokens', 'model.notrec': 'not recommended',
      'model.sepFree': 'Free · recommended', 'model.sepPaid': 'Paid or use more tokens', 'model.rec': 'recommended: uses the fewest tokens',
      'quota.exhausted': 'Quota used up', 'quota.left': '{approx}{left}/{limit} left today', 'quota.reset': ' · refills in {time}',
      'quota.tip': 'Estimated usage of your API key for {model} on this computer:\n{used} requests and {tokens} tokens today.\nLimit: {limit} requests/day {src}\nRefills at midnight, Pacific time.',
      'quota.src.google': '(reported by Google)', 'quota.src.user': '(set by you)', 'quota.src.default': '(estimate; adjust it in Settings)',
      'edit.search': 'Search…', 'edit.addHere': '＋ Here', 'edit.addHere.title': 'Create a subtitle at the current timeline position',
      'edit.reload.title': 'Reload from the layer', 'edit.save': 'Save', 'edit.saveN': 'Save ({n})',
      'edit.changed': 'The subtitles changed on the timeline (for example with Ctrl+Z). <a id="subReload">Reload</a> (unsaved changes will be lost).',
      'edit.none': 'No subtitles loaded.', 'edit.empty': 'No subtitles. Use "＋ Here" to create one at the current timeline position.',
      'edit.hint': 'Style: change the layer\'s font/size in the Character panel and click ↻ in Generate. Use <code>|</code> for a line break. Saving only applies your changes: manual marker adjustments are kept, and everything can be undone with Ctrl+Z.',
      'edit.in': 'In (s)', 'edit.out': 'Out (s)', 'edit.textPh': 'Subtitle text', 'edit.go': 'Go to this moment',
      'edit.add': 'Add a subtitle after this one', 'edit.del': 'Delete this subtitle',
      'exp.format': 'Format', 'exp.txt': 'Text (.txt)', 'exp.json': 'JSON (per word)', 'exp.origin': 'Times from',
      'exp.origin.comp': 'Comp start', 'exp.origin.wa': 'Work area', 'exp.oneLine': 'Join lines into one', 'exp.btn': 'Export file…',
      'exp.dialog': 'Export subtitles', 'exp.reading': 'Reading subtitles…', 'exp.none': 'There are no subtitles to export.',
      'exp.cancel': 'Export cancelled.', 'exp.saved': '✔ Saved: {file} ({n} subtitles)',
      'log.desc': 'Record of everything AutoSub does', 'log.copy': 'Copy', 'log.clear': 'Clear',
      'log.emptyStart': 'No activity yet.', 'log.empty': 'Log cleared.', 'log.view': 'View log',
      'set.key': 'Gemini API key', 'set.save': 'Save', 'set.guide': 'Guide', 'set.models': 'Models ⟳', 'set.models.title': 'Refresh the model list',
      'set.delete': 'Delete', 'set.quota': 'Daily quota', 'set.rpd': 'Requests/day ({model})', 'set.limits': 'See real limits ↗',
      'set.quotaHint': 'Google does not let apps check the remaining quota, so AutoSub counts your requests on this computer and resets at midnight (Pacific time). The limit corrects itself if Google reports it was used up.',
      'set.uiLang': 'Panel language', 'set.uiLang.auto': 'Automatic (After Effects language)',
      'key.ok': 'Settings · API key saved', 'key.missing': 'Settings · API key missing', 'key.saved': 'Saved and encrypted (••••{last})',
      'key.dpapi': '🔒 Encrypted with your Windows account (DPAPI): other accounts on this computer cannot read it.',
      'key.keychain': '🔒 Stored in your macOS user Keychain.', 'key.none': 'No key. Click "Guide" to create one for free.',
      'key.pasteFirst': 'Paste your key first.', 'key.checking': 'Checking the key with Google…',
      'key.encryptFail': '✖ Could not encrypt the key: {msg}', 'key.valid': '✔ Valid key, encrypted and saved.',
      'key.confirmDelete': 'Delete the API key saved on this computer?', 'key.deleted': 'Key deleted.', 'key.needFirst': 'Save your API key first.',
      'models.updated': 'Model list updated.',
      'job.exportComp': 'Exporting the composition audio', 'job.exportLayer': 'Exporting the layer audio',
      'job.optimize': 'Optimizing the audio', 'job.upload': 'Uploading audio to Gemini', 'job.processing': 'Google is processing the audio',
      'job.transcribing': 'The AI is transcribing', 'job.interpreting': 'The AI is interpreting and writing',
      'job.align': 'Syncing timing with the audio', 'job.measure': 'Measuring the typeface', 'job.check': 'Checking the text box',
      'job.create': 'Creating {n} subtitles', 'job.done': '✔ {n} subtitles created', 'job.readWords': 'Reading saved words',
      'job.reflowed': '✔ Re-laid out: {n} subtitles', 'job.retry': ' Retry',
      'l.start': 'AutoSub started. Settings: {file}', 'l.lang': 'Panel language: {lang}.',
      'l.run.gen': 'Generate subtitles · {model}', 'l.run.interp': 'Interpretive generation · {model}', 'l.run.reflow': 'Re-layout',
      'l.exportComp': 'Exporting the composition audio (work area)…', 'l.exportLayer': 'Exporting only the audio of layer "{name}"…',
      'l.exported': 'Audio exported: {path}', 'l.useFile': 'Using the original file: {path}',
      'l.layerFail': 'Could not export the layer audio: {msg}', 'l.compFail': 'Could not export the composition audio: {msg}',
      'l.tryLayerFile': 'Trying the selected layer\'s file…',
      'e.selectLayer': 'Select the layer to subtitle on the timeline.',
      'e.compAudioHint': ' Select the video layer and choose "Audio: Selected layer".',
      'e.format': 'Format not supported by Gemini: .{ext}. Use "Audio: Composition".',
      'l.optimized': 'Audio optimized: mono 16 kHz, {mb} MB.', 'l.trimmed': 'Silences removed: sending {sent} of {total} ({pct}% fewer input tokens).',
      'l.optFail': 'Could not optimize the audio ({msg}); sending it as is.', 'l.sending': 'Sending: {mb} MB, {dur} ({mime}).',
      'l.long': 'Warning: more than 20 min of audio may exceed the AI\'s response limit.',
      'l.video': 'Warning: a whole video will be uploaded; it uses many more tokens. Use "Audio: Composition" or select the layer with audio.',
      'l.response': 'AI response: {phrases} phrases, {words} words · {tokens} tokens ({in} input, {out} output).',
      'l.truncated': 'The AI response was cut off: the last phrases may be missing.',
      'l.aligned': 'Timing synced to {n} speech regions detected in the audio.', 'l.noContrast': 'The voice could not be told apart from the background; using the AI timing.',
      'l.noAlign': 'Fine sync is not available with this source file; using the AI timing.',
      'e.noSpeech': 'The AI did not detect speech in the audio.', 'l.detected': 'Detected language: {lang}',
      'l.done': 'Done: {n} subtitles created in a single layer.', 'l.error': 'Error: {msg}',
      'e.noComp': 'Open a composition on the timeline.', 'q.confirmExhausted': 'According to the counter, today\'s free quota for this model is used up.\nTry anyway?',
      'e.noWords': 'There are no saved words in the layer. Generate the subtitles first.', 'l.reflowed': 'Re-laid out: {n} subtitles.',
      'l.measure': 'Measuring {n} words with the layer\'s typeface…',
      'l.boxRetry': 'Box check: {n} subtitle(s) took more than {lines} lines; recalculating the breaks.',
      'l.boxSplit': 'Box check: splitting {n} subtitle(s) that did not fit.',
      'l.creating': 'Creating {n} subtitles (width {w} px, max. {lines} lines, {silence} during silences)…',
      'l.silKeep': 'kept', 'l.silHide': 'hidden',
      'l.fontsLoaded': 'System typefaces loaded: {n} families.', 'l.fontsNeed': 'The typeface list requires After Effects 2024 or later; use the Character panel.',
      'l.fontsFail': 'Could not read the typefaces: {msg}', 'l.fontSel': 'Typeface selected: {name} ({ps})',
      'l.model': 'Model selected: {id}', 'l.keySaved': 'API key validated and saved encrypted ({n} models available).',
      'l.keyRejected': 'API key rejected: {msg}', 'l.keyEncFail': 'Error encrypting the API key: {msg}', 'l.keyDeleted': 'API key deleted from this computer.',
      'l.modelsUpdated': 'Model list updated ({n}).', 'l.limitSet': 'Daily limit for {model} set to {n} requests.',
      'l.editNew': 'Editor: new subtitle at {t} (not saved yet).', 'l.editNone': 'Editor: no changes to save.',
      'l.editSaved': 'Editor: saved {c} changes and {i} new subtitles ({n} in total). You can undo it with Ctrl+Z in After Effects.',
      'l.editMissing': 'Editor: {n} subtitle(s) no longer existed in the layer and were skipped.', 'l.editErr': 'Error saving in the editor: {msg}',
      'l.exported2': 'Exported {fmt}: {file} ({n} subtitles).', 'l.exportErr': 'Export error: {msg}', 'l.connErr': 'Connection error: {msg}',
      'g.keyInvalid': 'The API key is not valid. Check that you copied all of it (it starts with "AIza").',
      'g.denied': 'Access denied by Google: {msg}',
      'g.quotaDay': 'You have used up today\'s free requests for this model. They refill at midnight (Pacific time), or you can pick another green model.',
      'g.quotaMin': 'You reached Gemini\'s free per-minute limit.', 'g.retryIn': ' Try again in {s} s.', 'g.retryMin': ' Wait a minute and try again.',
      'g.busy': 'Gemini\'s servers are overloaded ({status}). Try again in a few minutes.',
      'g.net': 'Network error: {msg}', 'g.timeout': 'Request timed out.', 'g.noUploadUrl': 'Google did not return the upload URL.',
      'g.fileFailed': 'Google could not process the uploaded audio.', 'g.fileSlow': 'The audio is taking too long to process on Google.',
      'g.noResult': 'Gemini returned no result{block}.', 'g.blocked': ' (blocked: {r})'
    }
  };

  /** Idioma de la interfaz de After Effects (p. ej. "es_ES"), o el del navegador. */
  function hostLocale() {
    try {
      if (global.__adobe_cep__) {
        var env = JSON.parse(global.__adobe_cep__.getHostEnvironment());
        if (env && env.appUILocale) return String(env.appUILocale);
      }
    } catch (e) { /* sin información */ }
    return global.navigator ? navigator.language : 'en';
  }

  var lang = 'es';

  function resolve(pref) {
    if (pref === 'es' || pref === 'en') return pref;
    return /^es/i.test(hostLocale()) ? 'es' : 'en';
  }

  function t(key, params) {
    var s = (S[lang] && S[lang][key]) || S.es[key] || key;
    if (params) s = s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? params[k] : m; });
    return s;
  }

  function apply(root) {
    root = root || document;
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-html]'), function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-title]'), function (el) { el.title = t(el.getAttribute('data-i18n-title')); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-ph]'), function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
    document.documentElement.lang = lang;
  }

  global.I18N = {
    t: t,
    apply: apply,
    hostLocale: hostLocale,
    get lang() { return lang; },
    /** pref: 'auto' | 'es' | 'en' */
    setLang: function (pref) { lang = resolve(pref); return lang; }
  };
  global.t = t;
})(window);
