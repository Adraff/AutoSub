# AutoSub: AI-powered automatic subtitles for After Effects

**English** · [Español](README.es.md)

**AutoSub** is a free, open-source panel for **Adobe After Effects**. It listens to your composition's audio, transcribes it with **Google Gemini** AI (using your own free API key) and creates synced subtitles directly on your timeline.

> 🆓 **Free and open.** You can use, share, modify and improve it at no cost (GPL v3 license). All you need is a free Google Gemini API key, which anyone can create in a minute with a Google account.
>
> 🤖 **Built entirely with [Claude Code](https://claude.com/claude-code)**: all the code, the installer and this documentation were written with Claude Code, Anthropic's AI coding assistant.

---

## ✨ Features

- **English and Spanish interface:** follows the After Effects language automatically, or choose it in Settings.
- **Interpretive mode:** a switch next to the Generate button lets the AI understand the context and write clean subtitles, without fillers ("uhhh", "umm"), stutters, repetitions or mispronounced words. Off by default (literal transcription).
- **Several subtitle layers per composition:** every generation creates a new, independent layer, each with its own style and background box.
- **Human-like subtitle breaks:** the AI splits speech into meaningful phrases and AutoSub chooses where to cut like a subtitler would: at commas and pauses, never leaving a lone word or ending on "de", "the", "of"…
- **Automatic transcription** of the composition's audio (or of a layer's source file), with per-word timing.
- **Fine sync adjustment:** analyzes the real audio to place each phrase exactly where it is heard and to respect silences.
- **Control every subtitle at once:** all subtitles live in a single text layer. Change the font, size, color or stroke and it applies to all of them.
- **Real paragraph text box:** set the box width in pixels; the text flows naturally inside it and the line count (1 to 4) is only a maximum. Text is centered in the box and the anchor point stays fixed at the box center, so nothing jumps and it is ready to animate.
- **Default typeface picker:** a drop-down with every font installed on your system, each shown in its own typeface, with search (requires After Effects 2024 or later).
- **Stroke and shadow:** turn the text stroke on or off, and add After Effects' native *Drop Shadow* effect to the layer (easy to tweak later in Effect Controls).
- **Bottom margin:** set how far from the bottom edge the subtitle box is placed when it is created, so you don't have to move it every time.
- **Low token usage:** only audio is ever sent (never video), converted to mono 16 kHz, with silences removed, and the AI replies with compact phrases instead of word-by-word data.
- **Silences:** choose whether a subtitle stays on screen while nobody is speaking or disappears.
- **Global offset:** one control shifts every subtitle earlier or later.
- **Effects:** optional background box that fits the text, fade and "pop" animation.
- **Built-in editor:** at the top, the style of the selected subtitle layer (typeface, size, box width, lines, stroke, shadow and background); below, its subtitles. Fix the text and timing of each subtitle, add a subtitle at the playhead or after any other one, and delete subtitles. Saving only applies your changes, so manual adjustments made on the timeline are kept, and everything can be undone with Ctrl+Z (the editor refreshes itself).
- **Export** to **SRT**, **WebVTT**, **TXT** or **JSON** (with per-word timing).
- **Model picker:** free models are shown in green and the most efficient one is marked with ★. Paid models, or models that waste tokens, are shown in grey.
- **Quota bar:** shows how many free requests you have left today and when they refill.
- **Encrypted API key:** stored encrypted with your system account (DPAPI on Windows, Keychain on macOS).
- **Log tab:** a detailed record of everything the panel does, for checking or reporting problems.
- **Custom installer** with no third-party tools.

## 📥 Installation

### Windows
1. Download **`AutoSub-Installer.exe`** from [**Releases**](../../releases/latest).
2. Close After Effects and run the installer. Click **Instalar** (Install).
3. Open After Effects and go to **Window > Extensions > AutoSub**.

> Windows may show a SmartScreen warning because the installer is not signed. Click *More info > Run anyway*.

The installer copies the panel to `%APPDATA%\Adobe\CEP\extensions\com.autosub.ae` (for your user only, no administrator rights needed). It also enables `PlayerDebugMode`, which lets After Effects load unsigned panels. To uninstall, run it again and click **Desinstalar** (Uninstall).

### macOS
1. Download **`AutoSub-macOS.zip`** from [**Releases**](../../releases/latest) and unzip it.
2. Double-click `Instalar-AutoSub-mac.command`. If macOS blocks it, right-click > Open.

### Requirements
- After Effects 2019 (v16) or later. Tested on 2025 and 2026.
- An internet connection and a free Google Gemini API key.

## 🔑 Free Gemini API key

The first time you open the panel, a step-by-step guide appears:
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with your Google account.
2. Click **Create API key** and copy the key (it starts with `AIza…`).
3. Paste it into the panel. AutoSub checks it with Google and stores it **encrypted**.

No credit card is needed. The free tier has a daily request limit, which the panel shows in the quota bar.

## 🎬 Usage

1. Open your composition and set the **work area** to the part you want to subtitle.
2. In the **Generar** (Generate) tab, choose the language, box width, number of lines and other options.
3. Pick a green model (★ is recommended), turn on **Interpretive** if you want clean, context-aware subtitles, and click **✦ Generate**. Each generation creates a new layer.
4. To edit a layer, select it on the timeline and open the **Edit** tab (it unlocks once subtitles exist): its style is at the top and its subtitles below. You can also use the **Character** panel and then click **↻ Re-layout**.
5. Export the selected layer from the **Export** tab.

### Layer controls (Effect Controls panel)
| Control | What it does |
|---|---|
| Offset (frames) · Desfase (fotogramas) | Shifts every subtitle earlier (−) or later (+), in frames |
| Fade (frames) · Fundido (fotogramas) | Fade in and out of each subtitle, in frames |
| Pop (%) | Scale animation when a subtitle appears |
| Background: Opacity / Color / Padding / Roundness | Background box opacity, color, padding and roundness (if enabled) |

You can also edit on the timeline: each subtitle is a layer marker. Drag a marker to change its timing or double-click it to change the text. Use `|` to force a line break.

## 🔒 Privacy and security
- The API key is encrypted with **DPAPI** (Windows) or the **Keychain** (macOS). Other accounts on the computer cannot read it.
- Audio is only sent to Google Gemini for transcription, and AutoSub deletes it from Google's servers when it is done.
- AutoSub has no servers of its own and collects no data.

## 🛠️ For developers

```
extension/            CEP panel (what gets installed)
  CSXS/manifest.xml
  index.html, css/
  js/main.js          Panel logic and UI
  js/gemini.js        Gemini API client (Files API + generateContent)
  js/audio.js         WAV/AIFF reading, voice detection and timing refinement
  js/segment.js       Splits words into subtitles (width, lines, silences)
  js/exporters.js     SRT / VTT / TXT / JSON
  js/quota.js         Usage counter and daily quota
  js/secret.js        API key encryption (DPAPI / Keychain)
  js/config.js        User configuration
  js/cep.js           Bridge to After Effects (no external libraries)
  js/i18n.js          English and Spanish texts
  jsx/host.jsx        After Effects script: layer, markers, expressions, audio render
installer/
  Installer.cs        Windows installer (C#, built with the csc.exe that ships with Windows)
  build.ps1           Builds dist/AutoSub-Installer.exe and dist/AutoSub-macOS.zip
  Instalar-AutoSub-mac.command
```

To build the installers:
```bash
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

There are no external dependencies. Everything uses what After Effects (CEP + Node.js) and Windows (.NET Framework) already include.

## ⚠️ Known limitations
- Per-word timing is estimated by the AI. The fine sync adjustment improves it a lot, but it can be less precise with very loud background music.
- Audio longer than about 20 minutes may exceed the AI's maximum response size. If that happens, split the work area.
- Google does not let apps check your remaining quota. The bar is an **estimate** based on usage from this computer, and it corrects itself when Google reports the quota is used up.

## 🤝 Contributing
Improvements are welcome: open an *issue* or a *pull request*.

## 📄 License
[GNU GPL v3](LICENSE). You are free to use, study, share and modify AutoSub. If you distribute a modified version, it must stay open source under the same GPL v3 license.

---
<sub>Project built entirely with Claude Code (Anthropic).</sub>
