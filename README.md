# Gemini Scrapi: OpenAI-Compatible Server for Gemini Web

A local, OpenAI-compatible HTTP server (`/v1/chat/completions`, `/v1/models`) powered by **Bun.js** and **Camoufox** (stealth anti-detect Firefox) automating `https://gemini.google.com`.

## Features

- **OpenAI Compatible**: Drop-in endpoint for any tool or client supporting the standard OpenAI API (`/v1/chat/completions`, `/v1/models`).
- **Real-Time Streaming**: In-page `MutationObserver` captures streaming text snapshots and emits Server-Sent Events (`stream: true`).
- **Camoufox Anti-Detect**: Headless or headed browser execution with anti-fingerprinting and `humanize: true` enabled.
- **Session Authentication**: Seamlessly loads `cookies.json` into the browser context.
- **Request Serialization**: FIFO queue ensures exactly one generation runs per browser tab, preventing concurrent prompt collisions.
- **Model Switching**: Dynamically inspects and selects models (`3.5 Flash-Lite`, `3.6 Flash`, `3.8 Flash`, `3.1 Pro`, `4 Argon`).
- **CSP Compliant**: Uses `execCommand('insertText')` to bypass Gemini's TrustedHTML CSP enforcement.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.3+ recommended)

### Installation

```bash
bun install
```

### Configuration

Copy `.env.example` to `.env` (or configure inline):

```ini
PORT=3000
API_KEY=sk-gemini-scrapi-local
HEADLESS=true
GEMINI_URL=https://gemini.google.com/app
REQUEST_TIMEOUT_MS=120000
```

To authenticate with your Google account, place your exported `cookies.json` in the project root directory.

### Running the Server

```bash
# Start server
bun start

# Or with live reload in development
bun dev
```

## API Usage

### 1. List Available Models

```bash
curl -s http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-gemini-scrapi-local"
```

### 2. Chat Completion (Non-Streaming)

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-gemini-scrapi-local" \
  -d '{
    "model": "3.5 Flash-Lite",
    "messages": [
      {"role": "user", "content": "What is the speed of light? Answer in one sentence."}
    ],
    "stream": false
  }'
```

### 3. Chat Completion (Streaming SSE)

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-gemini-scrapi-local" \
  -d '{
    "model": "3.5 Flash-Lite",
    "messages": [
      {"role": "user", "content": "Write a short poem about the ocean."}
    ],
    "stream": true
  }'
```

### 4. Health Check

```bash
curl -s http://localhost:3000/health
```
