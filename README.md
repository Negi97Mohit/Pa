# 🐼 Pa: Real-Time 3D AI Co-Star & Voice Companion

<p align="center">
  <img src="Pa&me.png" alt="Mohit and Pa" width="420" style="border-radius: 16px; box-shadow: 0 12px 36px rgba(0,0,0,0.4);" />
</p>

<p align="center">
  <em>Pair programming with Pa — your intelligent, hands-free 3D AI co-star overlay for coding, live streaming, and voice chat.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/3D%20Engine-Three.js%20r160-blue.svg" alt="Three.js" />
  <img src="https://img.shields.io/badge/Live%20STT-Deepgram%20Nova--2-purple.svg" alt="Deepgram" />
  <img src="https://img.shields.io/badge/LLM-OpenRouter-orange.svg" alt="OpenRouter" />
  <img src="https://img.shields.io/badge/Voice-ElevenLabs%20%7C%20Noiz-red.svg" alt="Voice" />
</p>

---

## 🌟 Overview

**Pa** is a production-ready, interactive **3D AI Co-Star Overlay** built for OBS, Streamlabs, or standalone browser use. Powered by **Three.js**, **Deepgram real-time streaming STT**, **OpenRouter LLMs**, and **ElevenLabs TTS**, Pa listens hands-free to your voice, responds aloud, gestures dynamically, and displays sleek broadcast-style live subtitles.

---

## ✨ Features

- 🎙️ **Hands-Free Assistant ("OK Pa")**:
  - Activated by saying **"OK Pa"** (or any custom phrase).
  - Supports single-breath prompts (*"OK Pa, what's a quantum computer?"*) and two-step prompts (*"OK Pa"* ➔ perks up and listens).
  - **Smart start/stop detection** with VAD endpointing and silence debounce.
  - Automatically resets to idle once the response finishes — only hears and responds again when summoned.
  - **Barge-in support**: Interrupt Pa anytime simply by saying the wake phrase again.

- ⚡ **Live Real-Time Wake Phrase Customizer**:
  - Change your wake phrase directly in the settings drawer (e.g. `Hey Panda`, `Jarvis`, `Buddy`, `Computer`).
  - **Instant Live Synchronization**: Updates the HUD, subtitle bar prompt, and regex speech engine on every keystroke without refreshing.
  - **Punctuation & Case-Insensitive Matching**: Effortlessly matches lowercase, uppercase, and punctuation-formatted speech (e.g. `"ok, pa"`, `"OK PA"`, `"Hey, Panda!"`).

- 💬 **Broadcast-Grade Live Subtitle Bar**:
  - Centered frosted-glass closed-caption bar (`z-index: 30`) designed for high contrast over webcams or chroma screens.
  - Live transcription displays your words as you speak with Deepgram sub-second latency.
  - Glowing gold `[🐼 HEARING PROMPT]` pill during active prompt recording.
  - Synchronized streaming captions as Pa replies aloud.
  - Built-in **1-click Mic button** and **"👁️ Preview Subtitles"** tool for instant UI testing.

- 🧸 **3D Rigged Avatar (Three.js)**:
  - Native loading of `rigged-model.glb` with morph targets and skeletal animations.
  - Mood-driven animations: talking, thinking, attentive listening gestures, idle look-around, walking, and running.
  - Direct viewport mouse & touch controls: drag to reposition, rotate, and pinch/wheel to scale.

- 🎥 **Streamer-Ready Backdrop & Camera Overlay**:
  - Integrated webcam background with mirror mode.
  - Quick **"Skip (Panda Only)"** mode for clean transparent backgrounds or OBS chroma-keying (`#00ff00`).
  - Press `H` to toggle all UI chrome for a clean overlay output.

---

## 📸 Meet Pa

<p align="center">
  <img src="Pa&me.png" alt="Pa and Me" width="550" />
</p>

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Negi97Mohit/Pa.git
cd Pa
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
copy .env.example .env
```

Open `.env` and fill in your API keys:

```env
# OpenRouter (AI Model Provider)
OPENROUTER_API_KEY=your_openrouter_api_key_here

# ElevenLabs (Text-to-Speech)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here

# Deepgram (Real-Time Live Speech-to-Text)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Local Server Port
PORT=3000
```

> 🔒 **Security Notice:** The `.env` file and auto-generated `env.js` are strictly ignored by `.gitignore` and will never be committed to Git.

### 3. Start the Local Server

Run via Node.js:

```bash
node server.js
```

Or on Windows, simply double-click:

```bat
start.bat
```

### 4. Open in Browser

Open Google Chrome or Microsoft Edge and navigate to:

👉 **[http://localhost:3000/](http://localhost:3000/)**

---

## 🎙️ How to Talk with Pa

1. Click the **`[🎙️ Turn On Mic]`** button on the bottom Subtitle Bar (or enable Microphone in Settings).
2. Allow microphone access when prompted by the browser.
3. Say:
   > *"OK Pa, tell me an interesting fact about space!"*
4. Watch Pa perk up, listen attentively, and speak back with synchronized live subtitles!

---

## 🎛️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `H` | Toggle all UI panels and buttons (ideal for OBS capture) |
| `Esc` | Close Settings Drawer |
| `Enter` (in text fallback box) | Send text question directly to Pa without speaking |

---

## 📺 OBS Studio Setup (Streaming Overlay)

1. In OBS Studio, add a **Browser** source.
2. Set the URL to: `http://localhost:3000/`
3. Set Width to `1920` and Height to `1080` (or your stream resolution).
4. Check **"Control audio via OBS"** if you wish to route Pa's voice through OBS audio mixer.
5. In Pa's settings drawer:
   - Select **Chroma Green** or **Transparent** background.
   - Position and scale Pa wherever you like on screen.
   - Press `H` to hide the settings button and HUD.

---

## 📂 Project Structure

```text
Pa/
├── .env.example            # Environment template for API keys
├── .gitattributes          # Git LFS tracking for 3D binary assets (*.glb)
├── .gitignore              # Ignores .env, env.js, node_modules, and secrets
├── ai-costar-overlay.html  # Complete single-page 3D overlay application
├── LICENSE                 # MIT License
├── Pa&me.png               # Project showcase photo
├── README.md               # Project documentation
├── rigged-model.glb        # Rigged 3D Panda model & animations (Git LFS)
├── server.js               # Zero-dependency local Node.js static/env server
└── start.bat               # Windows one-click launcher
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — created by **Mohit Negi**.
