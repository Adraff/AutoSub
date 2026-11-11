# AutoSub: subtítulos automáticos con IA para After Effects y EffectCraft

[English](README.md) · **Español**

**AutoSub** es un panel gratuito y de código abierto para **Adobe After Effects** y **[EffectCraft](https://github.com/storytold/effectcraft)**. Escucha el audio de tu composición, lo transcribe con la inteligencia artificial **Google Gemini** (usando tu propia API key gratuita) y crea los subtítulos sincronizados directamente en la línea de tiempo.

> 🆓 **Libre y gratuito.** Puedes usarlo, compartirlo, modificarlo y mejorarlo sin pagar nada (licencia GPL v3). Solo necesitas una API key gratuita de Google Gemini, que cada persona crea en un minuto con su cuenta de Google.
>
> 🤖 **Hecho íntegramente con [Claude Code](https://claude.com/claude-code)**: todo el código, el instalador y esta documentación se escribieron con Claude Code, el asistente de programación de Anthropic.

---

## ✨ Qué hace

- **Funciona en After Effects y en EffectCraft:** el mismo panel y los mismos subtítulos en los dos programas.
- **Cortes como los haría una persona:** la IA separa el habla en frases con sentido y AutoSub decide dónde cortar como un subtitulador: en comas y pausas, sin dejar palabras sueltas ni terminar en "de", "la", "y"…
- **Transcripción automática** del audio de la composición (o del archivo de una capa), con tiempos por palabra.
- **Ajuste fino de la sincronización:** analiza el audio real para colocar cada frase en el momento exacto en que se oye y respetar los silencios.
- **Todos los subtítulos se controlan a la vez:** viven en una sola capa de texto. Si cambias la fuente, el tamaño, el color o el trazo, el cambio se aplica a todos.
- **Caja de texto de párrafo real:** eliges el ancho de la caja en píxeles y el texto entra de corrido. El número de líneas (de 1 a 4) es solo un máximo. El texto va centrado en la caja y el punto de anclaje queda fijo en el centro, así que nada salta y está listo para animar.
- **Tipografía predeterminada:** elige cualquier fuente instalada en tu sistema, con buscador (requiere After Effects 2024 o posterior).
- **Bajo consumo de tokens:** nunca se envía vídeo, solo el audio, convertido a mono 16 kHz y sin silencios. Además, la IA responde con frases compactas en lugar de palabra por palabra.
- **Silencios:** puedes elegir si el subtítulo sigue en pantalla mientras nadie habla o desaparece.
- **Desfase global:** con un control adelantas o retrasas todos los subtítulos.
- **Efectos:** caja de fondo opcional que se ajusta al texto, fundido y efecto "pop".
- **Editor integrado:** corrige el texto y los tiempos de cada subtítulo, crea uno nuevo en el cursor o después de otro, y elimina los que sobren. Al guardar solo se aplican tus cambios, así que los ajustes hechos a mano en la línea de tiempo se respetan, y todo se puede deshacer con Ctrl+Z (el editor se actualiza solo).
- **Exportación** a **SRT**, **WebVTT**, **TXT** o **JSON** (con tiempos por palabra).
- **Selector de modelos:** los gratuitos aparecen en verde y el más eficiente va marcado con ★. Los de pago o los que gastan tokens de más aparecen en gris.
- **Barra de cuota:** muestra cuántas peticiones gratuitas te quedan hoy y cuánto falta para que se recarguen.
- **API key cifrada:** se guarda cifrada con tu cuenta del sistema (DPAPI en Windows, Llavero en macOS).
- **Pestaña Log:** registro detallado de todo lo que hace el panel, para revisar o reportar problemas.
- **Instalador propio**, sin herramientas de terceros.

## 📥 Instalación

### Windows
1. Descarga **`AutoSub-Installer.exe`** desde la sección [**Releases**](../../releases/latest).
2. Cierra After Effects y ejecuta el instalador. Pulsa **Instalar**.
3. Abre After Effects y ve a **Ventana > Extensiones > AutoSub - Subtítulos IA**.

> Windows puede mostrar un aviso de SmartScreen porque el instalador no está firmado. Pulsa *Más información > Ejecutar de todas formas*.

El instalador copia el panel en `%APPDATA%\Adobe\CEP\extensions\com.autosub.ae` (solo para tu usuario, sin permisos de administrador). También activa `PlayerDebugMode`, que es lo que permite a After Effects cargar paneles sin firmar. Para desinstalar, vuelve a abrirlo y pulsa **Desinstalar**.

### EffectCraft (Windows)
1. Ejecuta el mismo **`AutoSub-Installer.exe`** y marca **EffectCraft**.
2. Abre **AutoSub para EffectCraft** desde el menú Inicio o el Escritorio. Abre EffectCraft (con su canal de control activado) y muestra el panel en su propia ventana.

> EffectCraft no tiene paneles HTML como After Effects, así que AutoSub se comunica con él por su canal de control local (solo 127.0.0.1) y su scripting compatible con After Effects. Si EffectCraft ya está abierto sin el canal de control, ciérralo y pulsa *Reintentar*. EffectCraft todavía no permite centrar el texto en vertical dentro de las cajas de párrafo, así que ahí el texto queda alineado arriba en la caja.

### macOS (After Effects)
1. Descarga **`AutoSub-macOS.zip`** desde [**Releases**](../../releases/latest) y descomprímelo.
2. Haz doble clic en `Instalar-AutoSub-mac.command`. Si macOS lo bloquea, haz clic derecho > Abrir.

### Requisitos
- After Effects 2019 (v16) o posterior (probado en 2025 y 2026), y/o EffectCraft 0.24 o posterior en Windows.
- Conexión a internet y una API key gratuita de Google Gemini.

## 🔑 API key gratuita de Gemini

La primera vez que abres el panel aparece una guía paso a paso:
1. Entra en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con tu cuenta de Google.
2. Pulsa **Create API key** y copia la clave (empieza por `AIza…`).
3. Pégala en el panel. AutoSub la comprueba con Google y la guarda **cifrada**.

No hace falta tarjeta de crédito. El nivel gratuito tiene un límite de peticiones al día, que el panel te muestra en la barra de cuota.

## 🎬 Uso

1. Abre tu composición y ajusta el **área de trabajo** al tramo que quieras subtitular.
2. En la pestaña **Generar**, elige idioma, ancho de caja, número de líneas y demás opciones.
3. Elige un modelo verde (se recomienda el ★) y pulsa **✦ Generar**.
4. Para cambiar el estilo, selecciona la capa `AutoSub - Subtitulos` y usa el panel **Carácter**. Después pulsa **↻** para recalcular los saltos de línea.
5. Exporta desde la pestaña **Exportar**.

### Controles de la capa (panel Controles de efectos)
| Control | Para qué sirve |
|---|---|
| Desfase (fotogramas) | Adelanta (−) o retrasa (+) todos los subtítulos |
| Fundido (fotogramas) | Fundido de entrada y salida de cada subtítulo |
| Pop (%) | Efecto de escala al aparecer |
| Fondo: Opacidad / Color / Margen / Redondez | Caja de fondo (si la activaste) |

También puedes editar en la línea de tiempo: cada subtítulo es un marcador de la capa. Arrastra un marcador para cambiar sus tiempos o haz doble clic para cambiar el texto. Usa `|` para forzar un salto de línea.

## 🔒 Privacidad y seguridad
- La API key se cifra con **DPAPI** (Windows) o el **Llavero** (macOS). Otras cuentas del ordenador no pueden leerla.
- El audio solo se envía a Google Gemini para transcribirlo, y AutoSub lo borra de los servidores de Google al terminar.
- AutoSub no usa servidores propios ni recoge datos.

## 🛠️ Para desarrolladores

```
extension/            Panel CEP (lo que se instala)
  CSXS/manifest.xml
  index.html, css/
  js/main.js          Lógica del panel e interfaz
  js/gemini.js        Cliente de la API de Gemini (Files API + generateContent)
  js/audio.js         Lectura WAV/AIFF, detección de voz y ajuste fino de tiempos
  js/segment.js       Reparto de palabras en subtítulos (ancho, líneas, silencios)
  js/exporters.js     SRT / VTT / TXT / JSON
  js/quota.js         Contador de uso y cuota diaria
  js/secret.js        Cifrado de la API key (DPAPI / Llavero)
  js/config.js        Configuración del usuario
  js/cep.js           Puente con el programa: After Effects (CEP) o EffectCraft
  js/bridge.js        Modo EffectCraft: utilidades tipo Node sobre el puente local
  jsx/host.jsx        Script de After Effects: capa, marcadores, expresiones, render de audio
installer/
  Installer.cs        Instalador de Windows (C#, se compila con el csc.exe que trae Windows)
  AutoSubEffectCraft.cs  "AutoSub para EffectCraft": puente local + ventana del panel
  build.ps1           Genera dist/AutoSub-Installer.exe y dist/AutoSub-macOS.zip
  Instalar-AutoSub-mac.command
```

Para generar los instaladores:
```bash
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

No hay dependencias externas. Todo usa lo que ya traen After Effects (CEP + Node.js) y Windows (.NET Framework).

## ⚠️ Limitaciones conocidas
- Los tiempos por palabra los estima la IA. El ajuste fino con el audio los mejora mucho, pero con música de fondo muy fuerte puede ser menos preciso.
- Audios de más de unos 20 minutos pueden superar el tamaño máximo de respuesta de la IA. En ese caso, divide el área de trabajo.
- Google no permite consultar la cuota restante. La barra es una **estimación** basada en el uso desde este equipo y se corrige sola cuando Google avisa de que se agotó.

## 🤝 Contribuir
Las mejoras son bienvenidas: abre un *issue* o un *pull request*.

## 📄 Licencia
[GNU GPL v3](LICENSE). Puedes usar, estudiar, compartir y modificar AutoSub libremente. Si distribuyes una versión modificada, tiene que seguir siendo de código abierto bajo la misma licencia GPL v3.

---
<sub>Proyecto creado íntegramente con Claude Code (Anthropic).</sub>
