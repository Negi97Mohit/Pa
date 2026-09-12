# Pa — Real-Time 3D AI Co-Star & Voice Companion

<p align="center">
  <img src="Pa.png" alt="Mohit and Pa" width="420" />
</p>

<p align="center">
  <strong>A real-time 3D AI companion for coding, live streaming, and voice interaction.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/3D-Three.js-blue.svg" alt="Three.js" />
  <img src="https://img.shields.io/badge/STT-Deepgram-purple.svg" alt="Deepgram" />
  <img src="https://img.shields.io/badge/LLM-OpenRouter-orange.svg" alt="OpenRouter" />
  <img src="https://img.shields.io/badge/TTS-ElevenLabs-red.svg" alt="ElevenLabs" />
</p>

---

## Overview

**Pa** is an interactive, real-time **3D AI companion and broadcast overlay** designed for coding, live streaming, and hands-free voice interaction.

Pa combines a rigged Three.js avatar with real-time speech recognition, LLM-based responses, text-to-speech, dynamic animations, and live subtitles.

It can run as a standalone browser application or as a transparent overlay inside **OBS Studio** and **Streamlabs**.

### Core Pipeline

```text
Microphone
    ↓
Wake Phrase Detection
    ↓
Deepgram Real-Time STT
    ↓
OpenRouter LLM
    ↓
ElevenLabs / Noiz TTS
    ↓
3D Avatar + Live Subtitles
```

---

## Features

### Hands-Free Voice Interaction

* Wake phrase activation with configurable phrases such as `OK Pa`, `Hey Panda`, or `Jarvis`
* Supports both single-step and two-step interactions
* Real-time voice activity detection and silence endpointing
* Automatic transition between idle, listening, thinking, and speaking states
* Barge-in support for interrupting an active response
* Automatically returns to idle after each interaction

### Configurable Wake Phrase

The wake phrase can be changed directly from the settings interface.

Changes are synchronized immediately across:

* HUD
* Subtitle interface
* Speech recognition logic
* Wake phrase matching

Matching is case-insensitive and tolerant of common punctuation variations.

### Real-Time Subtitles

Pa includes a broadcast-oriented live caption system designed for streaming overlays.

* Sub-second transcription using Deepgram
* Live user speech transcription
* Streaming response captions
* Frosted-glass caption interface
* Dedicated microphone controls
* Subtitle preview mode
* Optimized for webcam and chroma-key backgrounds

### 3D Avatar

The avatar is rendered using **Three.js** and supports a rigged `.glb` model with skeletal animations and morph targets.

Supported behaviors include:

* Idle animations
* Listening and attentive gestures
* Talking animations
* Thinking states
* Look-around behavior
* Walking
* Running
* Expression-driven animation states

The avatar can be repositioned, rotated, and scaled directly using mouse or touch controls.

### Streaming Overlay

Pa is designed to work as a browser-based broadcast source.

Supported environments include:

* OBS Studio
* Streamlabs
* Standalone Chrome / Edge

Background modes include:

* Webcam background
* Chroma green
* Transparent / avatar-only mode

Press `H` to hide the application UI and output a clean overlay.

---

## Meet Pa

<p align="center">
  <img src="Pa&me.png" alt="Pa and Mohit" width="550" />
</p>

---

## Getting Started

### Requirements

* Node.js
* Google Chrome or Microsoft Edge
* Microphone
* API keys for the enabled services

### 1. Clone

```bash
git clone https://github.com/Negi97Mohit/Pa.git
cd Pa
```

### 2. Configure Environment

Copy the example environment file:

```bash
copy .env.example .env
```

Add your API keys:

```env
# LLM Provider
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Text-to-Speech
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here

# Real-Time Speech-to-Text
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Local Server
PORT=3000
```

> **Security:** `.env` and the generated `env.js` file are excluded from version control through `.gitignore`.

### 3. Start the Server

Using Node.js:

```bash
node server.js
```

Or on Windows:

```bat
start.bat
```

### 4. Open Pa

Open Chrome or Microsoft Edge and navigate to:

```text
http://localhost:3000/
```

Allow microphone access when prompted.

---

## Voice Interaction

Enable the microphone using the control in the subtitle bar or through Settings.

Then say:

```text
OK Pa, tell me an interesting fact about space.
```

Pa will:

1. Detect the wake phrase
2. Capture the spoken prompt
3. Transcribe the audio in real time
4. Generate a response through the configured LLM
5. Convert the response to speech
6. Animate the avatar
7. Display synchronized subtitles
8. Return to the idle state

---

## Keyboard Shortcuts

| Key     | Action                                         |
| ------- | ---------------------------------------------- |
| `H`     | Toggle application UI for clean overlay output |
| `Esc`   | Close the Settings drawer                      |
| `Enter` | Submit a question from the text fallback input |

---

## OBS Studio Setup

Pa can be embedded directly into an OBS scene using a Browser Source.

### 1. Add a Browser Source

In OBS:

```text
Sources → Browser
```

Set the URL to:

```text
http://localhost:3000/
```

### 2. Configure Resolution

Recommended:

```text
Width: 1920
Height: 1080
```

Use your stream resolution if different.

### 3. Configure Audio

Enable:

```text
Control audio via OBS
```

if you want Pa's voice routed through the OBS audio mixer.

### 4. Configure Pa

From the Settings drawer:

* Select **Transparent** or **Chroma Green**
* Position the avatar
* Adjust the scale
* Configure the wake phrase
* Press `H` to hide the application UI

Pa can then operate as a live 3D AI co-star inside your stream layout.

---

## Architecture

```text
┌──────────────────────────────┐
│          Microphone          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     Wake Phrase Detection    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       Deepgram STT           │
│      Real-Time Streaming     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       OpenRouter LLM         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     ElevenLabs / Noiz TTS    │
└──────────────┬───────────────┘
               │
          ┌────┴─────┐
          ▼          ▼
┌────────────────┐ ┌────────────────┐
│   3D Avatar    │ │ Live Subtitles │
│    Three.js    │ │   Broadcast UI │
└────────────────┘ └────────────────┘
```

---

## Project Structure

```text
Pa/
├── .env.example
├── .gitattributes
├── .gitignore
├── ai-costar-overlay.html
├── LICENSE
├── Pa&me.png
├── Pa.png
├── README.md
├── rigged-model.glb
├── server.js
└── start.bat
```

### Key Components

| File                     | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `ai-costar-overlay.html` | Main 3D AI companion application                  |
| `rigged-model.glb`       | Rigged 3D avatar and animation assets             |
| `server.js`              | Local static server and environment configuration |
| `start.bat`              | Windows launcher                                  |
| `.env.example`           | Environment variable template                     |

---

## Technology Stack

| Layer          | Technology                                |
| -------------- | ----------------------------------------- |
| 3D Rendering   | Three.js                                  |
| Avatar         | GLB + skeletal animations + morph targets |
| Speech-to-Text | Deepgram                                  |
| LLM            | OpenRouter                                |
| Text-to-Speech | ElevenLabs / Noiz                         |
| Runtime        | Node.js                                   |
| Interface      | HTML / CSS / JavaScript                   |
| Streaming      | OBS Browser Source                        |

---

## License

This project is licensed under the [MIT License](LICENSE).

Created by **Mohit Negi**.
