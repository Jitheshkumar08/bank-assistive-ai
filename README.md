# Multimodal Assistive AI System for Context-Aware Guidance

A mobile-first banking assistance application. A customer signs in, scans a QR
code that identifies their branch, and is guided through banking tasks by a
conversational assistant that accepts text or voice.

## Repository layout

```
Bank-assistive-ai/
├── frontend/          React + TypeScript + Vite + Tailwind   (planned)
├── backend/           NestJS + Prisma + PostgreSQL           (planned)
├── language_engine/   Python AI engine                       (existing)
└── docs/              architecture / api / database / project
```

## Architecture


```
Frontend  ──HTTPS──▶  NestJS API  ──internal HTTP──▶  Python AI engine
                          │                                │
                          ▼                    STT · Intent · Dialogue
                     PostgreSQL                RAG · Workflow · LLM · TTS
```

Three rules hold this together:

1. **AI logic lives only in `language_engine/`.** Dialogue, workflow, and
   retrieval logic is never duplicated in Node or React.
2. **Secrets never reach the browser.** The Groq API key belongs to the Python
   engine; database credentials and the JWT secret belong to NestJS.
3. **The engine is reached through one interface.** NestJS depends on an
   `AiEngineClient` abstraction, so a mock implementation can be swapped for the
   real engine without changing any controller, service, or component.

## `language_engine/`

The Python engine is the existing, working part of this project. It provides
speech-to-text, intent detection, LLM-assisted dialogue understanding, a
JSON-driven workflow engine, retrieval-augmented question answering, and
text-to-speech.

Its design keeps two ideas separate, and the rest of the system follows suit:

- **Session state** — what the assistant is doing (idle, listening, speaking).
- **Workflow state** — what the current banking task is doing (active,
  suspended, completed, cancelled).

Completing or cancelling a workflow never ends the session. Pausing a workflow
stops its progression without stopping the assistant, so the customer can ask a
question mid-task and then resume.

### Running the engine

Requires Python 3.13 and a Groq API key.

```bash
cd language_engine
python -m venv venv
venv/Scripts/activate
pip install -r requirements.txt
```

```bash
python -m app.main
```

The offline regression suite needs no network, microphone, or model downloads:

```bash
python -m debugging.test_remediation
```

## Speech

The assistant listens and answers aloud. Both directions run through the
Python engine, reached only via the Node API.

```
speech in    microphone -> NestJS /assistant/voice -> FastAPI -> Whisper -> transcript
                        -> the same conversation a typed message uses
speech out   reply text -> NestJS /assistant/speak -> FastAPI -> edge-tts -> audio bytes
                        -> browser <audio>
```

A typed question gets a written answer. A spoken question gets a written
answer **and** a spoken one -- the reply is only read aloud when the turn
began as speech.

**Voices** come from the engine's own map, so the web and the CLI speak
alike:

| Language | Voice |
|---|---|
| `en` | `en-IN-NeerjaNeural` |
| `kn` | `kn-IN-SapnaNeural` |
| `hi` | `hi-IN-SwaraNeural` |

The language is taken from the visit, which inherits it from the account.
A browser cannot choose the voice: `/assistant/speak` rejects a request
carrying a `language` field. A language with no voice is refused rather
than answered in English -- **Tulu has no voice today**, and the
translator remains a pass-through, so nothing mediates it through
Kannada yet.

**Audio format** is whatever edge-tts actually produces, identified from
the bytes rather than assumed, and sent with the matching `Content-Type`.
edge-tts returns MP3, so that is normally `audio/mpeg`. Generated audio
is never stored: it is written to a uniquely named temporary file, read,
and deleted, with `Cache-Control: no-store` on the response.

Server-side playback (`TextToSpeech.speak()`, pygame) is untouched and
still used by the CLI. The web path stops at the bytes.

### Running the engine service

Requires **Python 3.13** -- torch and openai-whisper do not publish
reliable wheels for newer interpreters.

```bash
cd language_engine
py -3.13 -m venv venv
venv/Scripts/activate
pip install -r requirements.txt
```

```bash
uvicorn service.main:app --host 127.0.0.1 --port 8000
```

**FFmpeg must be on PATH.** Whisper shells out to it to decode the
WebM/Opus and MP4 that browsers record. Without it transcription fails
with `FileNotFoundError: [WinError 2]` from `subprocess`, which looks
nothing like a missing codec:

```bash
winget install Gyan.FFmpeg
```

**On Windows, set `PYTHONIOENCODING=utf-8` when running the CLI or the
test suites.** The engine prints `✅` in its progress output, and the
default console codepage cannot encode it -- redirecting output without
this makes a passing run exit non-zero with `UnicodeEncodeError`, which
reads like a test failure but is not:

```bash
PYTHONIOENCODING=utf-8 python -m debugging.test_remediation
```

The service does not need it: `service/config.py` reconfigures its own
streams to UTF-8 on import, before the engine prints anything. Setting
the variable in `.env` cannot help there, because Python reads it at
interpreter startup, long before any file is loaded.

### The Groq API key

**`GROQ_API_KEY` must be set** before starting the service. The dialogue
layer refuses to construct without one, so the whole service fails to
start.

Put it in `language_engine/.env`, which is gitignored:

```bash
cd language_engine
cp .env.example .env      # Windows: copy .env.example .env
```

```ini
GROQ_API_KEY=your-key-here
```

A key is issued at <https://console.groq.com/keys>.

`service/config.py` applies that file to the process environment when the
`service` package is imported -- which happens before any `app.*` module
is imported, and so before the engine reads the key. Nothing in `app/`
opens a file to find it, so without this step a filled-in `.env` would
have no effect at all.

A variable already exported in the shell always wins over the file, so a
checked-out `.env` cannot override a deployment's own secret. Empty
values are skipped rather than applied, which keeps the placeholder lines
in `.env.example` from turning "not set" into "set but blank". Startup
logs the *names* it loaded and never a value.

Without a key the service now stops in about two seconds with a message
naming the file to edit, instead of failing deep inside model loading.
Note what still works if the key is wrong rather than missing: speech,
intent detection and workflow activation all continue, and the LLM step
degrades to a safe "take your time" reply instead of breaking the
conversation.

The same variables are documented in `language_engine/.env.example`:
`AI_ENGINE_TOKEN` (shared secret with the NestJS backend; must match
`backend/.env`), `MAX_AUDIO_BYTES`, `HOST` and `PORT`.

## Development approach

The application is built one phase at a time: inspect, plan, implement, test,
report. The backend and database come first, then authentication, then the
frontend shell, then branch context, then the assistant interface against a
mock AI client — and only then is the real Python engine connected.
