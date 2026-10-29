# Gemini Scrapi: OpenAI-Compatible Server for Gemini Web

A local, OpenAI-compatible HTTP server (`/v1/chat/completions`, `/v1/models`) powered by **Bun.js** and **Camoufox** (stealth anti-detect Firefox) automating `https://gemini.google.com`.

---

## Features

- **OpenAI Compatible**: Drop-in endpoint for any tool or client supporting the standard OpenAI API (`/v1/chat/completions`, `/v1/models`).
- **Real-Time Streaming**: In-page `MutationObserver` captures streaming text snapshots and emits Server-Sent Events (`stream: true`).
- **Camoufox Anti-Detect**: Headless or headed browser execution with anti-fingerprinting and `humanize: true` enabled.
- **Authenticated Profile Support**: Reuses your existing authenticated Camoufox profile (`~/Library/Application Support/camoufox/Profiles/...`) with access to all models.
- **Request Serialization**: FIFO queue ensures exactly one generation runs per browser tab, preventing concurrent prompt collisions.
- **Model Switching**: Dynamically selects models (`3.5 Flash-Lite`, `3.6 Flash`, `3.8 Flash`, `3.1 Pro`, `4 Argon`).
- **CSP Compliant**: Uses `execCommand('insertText')` to bypass Gemini's TrustedHTML CSP enforcement.

---

## How to Start the Server

### 1. Prerequisites
- [Bun](https://bun.sh) (v1.3+ installed)
- Camoufox with logged-in Gemini session (or `cookies.json` in project directory)

### 2. Configuration
The default configuration is saved in `.env`:

```ini
PORT=6331
API_KEY=sk-gemini-scrapi-local
HEADLESS=true
CAMOUFOX_PROFILE_DIR=~/Library/Application Support/camoufox/Profiles/2jpccw9p.default-default
GEMINI_URL=https://gemini.google.com/app
REQUEST_TIMEOUT_MS=120000
```

### 3. Starting the Server

```bash
# Production / standard start
bun start

# Or with live watch reload during development
bun dev

# Or directly
bun run src/server.ts
```

The server will initialize Camoufox with your profile and start listening on:
`http://localhost:6331`

---

## OpenCode Integration

Gemini Scrapi is configured as an OpenAI-compatible provider in your `~/.config/opencode/opencode.jsonc`:

```jsonc
"provider": {
  "gemini-scrapi": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "Gemini Scrapi",
    "options": {
      "baseURL": "http://127.0.0.1:6331/v1",
      "apiKey": "sk-gemini-scrapi-local"
    },
    "models": {
      "3.5 Flash-Lite": {
        "name": "Gemini 3.5 Flash-Lite"
      },
      "3.6 Flash": {
        "name": "Gemini 3.6 Flash"
      },
      "3.8 Flash": {
        "name": "Gemini 3.8 Flash"
      },
      "3.1 Pro": {
        "name": "Gemini 3.1 Pro"
      },
      "4 Argon": {
        "name": "Gemini 4 Argon"
      }
    }
  }
}
```

You can now use any of these models in OpenCode:
- `gemini-scrapi/3.6 Flash`
- `gemini-scrapi/3.1 Pro`
- `gemini-scrapi/4 Argon`
- `gemini-scrapi/3.5 Flash-Lite`
- `gemini-scrapi/3.8 Flash`

---

## Direct API Usage

### 1. List Available Models

```bash
curl -s http://localhost:6331/v1/models \
  -H "Authorization: Bearer sk-gemini-scrapi-local"
```

### 2. Chat Completion (Non-Streaming)

```bash
curl -s http://localhost:6331/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-gemini-scrapi-local" \
  -d '{
    "model": "3.6 Flash",
    "messages": [
      {"role": "user", "content": "What is the capital of France? Answer in one word."}
    ],
    "stream": false
  }'
```

### 3. Chat Completion (Streaming SSE)

```bash
curl -N -s http://localhost:6331/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-gemini-scrapi-local" \
  -d '{
    "model": "3.1 Pro",
    "messages": [
      {"role": "user", "content": "Write a short haiku about coding."}
    ],
    "stream": true
  }'
```

### 4. Health Check

```bash
curl -s http://localhost:6331/health
```
