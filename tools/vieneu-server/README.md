# Local VieNeu-TTS v3 Turbo Server (Windows)

A lightweight, loopback-only local HTTP text-to-speech server for IVF Journey powered by **VieNeu-TTS v3 Turbo** (`pnnbao-ump/VieNeu-TTS-v3-Turbo`), running on the **ONNX Runtime CPU** backend with **48 kHz** WAV output and built-in Vietnamese preset voices from `list_preset_voices()` (**25 preset voices** exposed in the verified `vieneu==3.8.5` setup; `GET /voices` is the runtime source of truth).

> **Security & Network Binding**
>
> This server is hard-coded to bind to **`127.0.0.1` (loopback only)** and therefore requires **no authentication**. It is strictly for local use on your own machine—**never expose this server to your LAN or the public internet**.

---

## Prerequisites (Windows)

### 1. Install Microsoft Visual C++ Redistributable 2015–2022 (x64) **BEFORE running**

ONNX Runtime on Windows requires the Microsoft Visual C++ 2015–2022 x64 runtime DLLs (`vcruntime140_1.dll`, `msvcp140_1.dll`, `msvcp140_2.dll`).

Download and install the official Microsoft installer first:

- **Official installer:** <https://aka.ms/vs/17/release/vc_redist.x64.exe>

Restart your terminal (or Windows, if prompted) after installing.

> **Last-resort troubleshooting only:** If you cannot run the installer on a locked-down machine, copying missing DLLs manually should only be done as a last resort using **Microsoft-signed matching x64 DLL files** from a trusted local Microsoft installation. **Never download DLLs from random third-party DLL download websites.**

### 2. Python 3.12 (`uv` recommended)

- Use **Python 3.12** (64-bit).
- **Do not use Python 3.14:** ONNX Runtime fails on Python 3.14 because it cannot load `onnxruntime_pybind11_state`.
- Install [`uv`](https://docs.astral.sh/uv/getting-started/installation/) if you do not already have it:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

---

## Setup

Run these commands from the **repository root** (`C:\Users\<you>\...\ivf-journey`):

### 1. Create the `.venv312` virtual environment

```powershell
uv venv --python 3.12 .venv312
```

### 2. Install dependencies

```powershell
uv pip install --python .venv312\Scripts\python.exe -r tools\vieneu-server\requirements.txt
```

`requirements.txt` pins `vieneu==3.8.5`. The server itself uses only the Python standard library plus `vieneu` (no FastAPI, uvicorn, or gradio).

---

## Starting the Server

From the repository root (Command Prompt or PowerShell):

```bat
tools\vieneu-server\start.bat
```

- `start.bat` activates `.venv312` at the repository root and runs `python tools\vieneu-server\server.py`. It **never installs packages** automatically.
- **First run:** The **~0.3B** VieNeu-TTS v3 Turbo model downloads automatically from Hugging Face (`pnnbao-ump/VieNeu-TTS-v3-Turbo`) and is cached locally. Ensure you have an internet connection on first startup.

---

## Environment Variables

All settings are optional and have sensible defaults:

| Variable | Default | Valid Values / Notes |
|---|---|---|
| `VIENEU_PORT` | `8765` | TCP port (`1`–`65535`) on `127.0.0.1` |
| `VIENEU_VOICE` | `Thiện Minh` | Must match one of the built-in preset voice IDs returned by `list_preset_voices()` (25 exposed in the verified `vieneu==3.8.5` setup; `GET /voices` is the runtime source of truth); server exits with a clear error if invalid |
| `VIENEU_PRECISION` | `int8` | `int8` (faster, smaller CPU footprint) or `fp32` |
| `VIENEU_CACHE_DIR` | `tools\vieneu-server\cache\` | Resolved relative to `server.py` when unset; created automatically |

### Windows Examples

**PowerShell:**

```powershell
$env:VIENEU_PORT = "8765"
$env:VIENEU_VOICE = "Thiện Minh"
$env:VIENEU_PRECISION = "int8"
$env:VIENEU_CACHE_DIR = "D:\tts-cache\vieneu"
.\tools\vieneu-server\start.bat
```

**Command Prompt (`cmd.exe`):**

```bat
set VIENEU_PORT=8765
set VIENEU_VOICE=Thiện Minh
set VIENEU_PRECISION=int8
set VIENEU_CACHE_DIR=D:\tts-cache\vieneu
tools\vieneu-server\start.bat
```

---

## CORS Allowlist

Only these two origins are allowed and echoed in `Access-Control-Allow-Origin` (with `Vary: Origin`):

- `https://ivf-journey.yundev.space`
- `http://localhost:5173`

All other origins do not receive `Access-Control-Allow-Origin`. CORS headers are applied to both success and error responses.

---

## Disk Cache & Concurrency

- Synthesized **48 kHz WAV** files are cached on disk at `<VIENEU_CACHE_DIR>\<sha256>.wav`, where `<sha256>` is the lowercase SHA-256 hex digest of UTF-8 `text|voice|precision`.
- Cache writes go to a temporary `.wav` file in the cache directory and atomically replace the final file.
- HTTP requests are handled concurrently via `http.server.ThreadingHTTPServer`, while a single global lock serializes ONNX CPU inference and rechecks the cache inside the lock to prevent duplicate synthesis.

---

## HTTP API Contract

Base URL: `http://127.0.0.1:8765`

### `GET /health`

Returns server status, model metadata, and every built-in preset voice returned by `list_preset_voices()` (25 entries exposed in the verified `vieneu==3.8.5` setup; `GET /voices` is the runtime source of truth).

**Example:**

```powershell
curl.exe -s http://127.0.0.1:8765/health
```

**Response (`200 OK`, `application/json; charset=utf-8`):**

```json
{
  "status": "ok",
  "model": "VieNeu-TTS v3 Turbo",
  "model_id": "pnnbao-ump/VieNeu-TTS-v3-Turbo",
  "precision": "int8",
  "sample_rate": 48000,
  "default_voice": "Thiện Minh",
  "voices": [
    { "id": "Thiện Minh", "label": "Thiện Minh (...)" }
  ]
}
```

### `GET /voices`

Returns the configured default voice ID and all built-in preset voices (`id` and `label`) returned by `list_preset_voices()` (25 exposed in the verified `vieneu==3.8.5` setup). This endpoint is the runtime source of truth for available preset voice IDs.

**Example:**

```powershell
curl.exe -s http://127.0.0.1:8765/voices
```

**Response (`200 OK`, `application/json; charset=utf-8`):**

```json
{
  "default_voice": "Thiện Minh",
  "voices": [
    { "id": "Thiện Minh", "label": "Thiện Minh (...)" }
  ]
}
```

### `OPTIONS /tts`

CORS preflight endpoint. Returns `204 No Content` with `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`, `Vary: Origin`, and `Access-Control-Allow-Origin` when `Origin` is allowlisted.

### `POST /tts`

Synthesizes Vietnamese text to a **48 kHz** WAV audio stream.

**Request JSON:**

- `text` *(string, required)*: 1 to 4000 characters; whitespace-only text is rejected.
- `voice` *(string, optional)*: preset voice `id` from `GET /voices`. When omitted, uses `VIENEU_VOICE` (`Thiện Minh`).
- Unknown fields are rejected with `400`.

**Example (PowerShell):**

```powershell
curl.exe -sS -X POST http://127.0.0.1:8765/tts `
  -H 'Content-Type: application/json' `
  --data-binary '{"text":"Xin chào bé yêu của ba mẹ.","voice":"Thiện Minh"}' `
  --output sample.wav `
  --write-out 'HTTP %{http_code} %{content_type}\n'
```

**Success Response (`200 OK`):**

- `Content-Type: audio/wav`
- `X-Cache: HIT` or `X-Cache: MISS`
- Body: 48 kHz WAV audio bytes (returned verbatim from disk cache)

**Error Response (`400 Bad Request` / `500 Internal Server Error`):**

```json
{"error": "Field 'text' must be at most 4000 characters"}
```

Errors are always UTF-8 JSON shaped `{"error": "..."}` with no Python tracebacks.

---

## Static Local Audio Pack (`render_pack.py`)

`tools/vieneu-server/render_pack.py` is a standalone offline batch renderer that pre-synthesizes Thai Giáo stories into static local audio files (**Ogg Opus** by default, or **MP3**). Because the audio files are generated ahead of time, **no HTTP TTS server needs to be running at playback time**.

The renderer loads the story corpus at runtime by invoking `node scripts/export-stories-json.mjs` into a temporary file outside the repository, speaks every story block (`p`, `h2`, `quote`, `tip`) in order (excluding titles and excerpts), chunks text at sentence boundaries (200–350 characters, never splitting inside a word), inserts 600 ms of leading/trailing silence and 250 ms of silence only between original story blocks, encodes each story to 48 kHz mono via `ffmpeg`, verifies the encoded output with `ffprobe`, and atomically promotes it to the final filename.

### Runtime Prerequisites

In addition to the Windows Visual C++ Redistributable and `.venv312` setup above (`vieneu==3.8.5` with `numpy`):

- **Node.js (`node`)** on `PATH` — invoked by `render_pack.py` to export `src/data/thaiGiao/week*.js` via `scripts/export-stories-json.mjs`.
- **FFmpeg (`ffmpeg` and `ffprobe`)** on `PATH` — used to encode Ogg Opus (`libopus`) or MP3 (`libmp3lame`) and verify codec, 48 kHz sample rate, mono channel layout, and duration before updating the manifest.

`render_pack.py` fails fast with a clear error if `node`, `ffmpeg`, or `ffprobe` is missing.

### Output, Manifest, and Report

- **Default output directory:** `tools/vieneu-server/audio/` (ignored by `tools/vieneu-server/.gitignore`).
- **Audio files:** `<out>/<id>.opus` (default) or `<out>/<id>.mp3`, written to a temporary `.part` file, verified by `ffprobe`, and atomically renamed. Temporary WAV and `.part` files are always cleaned up on errors or `Ctrl-C`.
- **Manifest (`<out>/manifest.json`):** An atomically rewritten JSON array sorted deterministically by `(week, day)`. Each entry contains:
  - `id`, `file`, `bytes`, `duration_s`, `words`, `voice`, `model`, `precision`, `text_hash` (plus `format` and `bitrate`).
  - Entries for stories not selected in the current run are preserved, and `manifest.json` is flushed after every successfully rendered story.
  - Byte counts and durations come from the actual files on disk (`stat` + `ffprobe`), never estimates.
- **Run Report (`--report [path]`):** Optional and independent of `manifest.json`. Passing `--report` without a path writes `<out>/report.json`; passing `--report <path>` resolves `<path>` relative to the caller's working directory. The report summarizes `rendered`, `skipped`, `failed`, `succeeded`, `words`, `total_audio_s`, `total_bytes`, `wall_clock_s`, `synth_s`, `rendered_audio_s`, `average_rtf` (`synth_s / rendered_audio_s` for newly rendered stories), and `failures`.

### Resume Behavior

- Before synthesizing a story, `render_pack.py` checks `manifest.json` and the output directory.
- A story is skipped (`status=skip`) **only** when `(id, voice, precision, text_hash)` matches the recorded entry, the expected output file for the requested `--format` (and `--bitrate`, when recorded) exists on disk, is non-empty, and its on-disk byte count matches the recorded `bytes`.
- **All-skip fast path:** `Vieneu` is initialized lazily at most once per run. If every selected story qualifies as a skip, the model is never loaded and the run completes in seconds.
- When the resume key or requested format differs, the story is re-rendered and replaces the stale manifest entry and file.
- Per-story errors are logged and recorded without aborting the batch; the process exits `0` if at least one selected story rendered or skipped validly, and nonzero if zero stories succeeded or a setup/CLI error occurred.

### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--voice` | `Thiện Minh` | Built-in VieNeu preset voice ID |
| `--precision` | `int8` | ONNX precision: `int8` or `fp32` |
| `--weeks` | *(all)* | Week filter as `N` or `A-B` (e.g. `16` or `16-20`), applied **before** `--limit` |
| `--limit` | *(none)* | Positive integer cap on the number of selected stories |
| `--format` | `opus` | Output format: `opus` (Ogg Opus, `libopus`) or `mp3` (`libmp3lame`) |
| `--bitrate` | `48k` | FFmpeg target audio bitrate (e.g. `48k`, `64k`) |
| `--out` | `tools/vieneu-server/audio` | Output directory (relative paths resolve from the caller's working directory) |
| `--report` | *(disabled)* | Optional report JSON path; if passed with no value, writes `<out>/report.json` |

### Examples

Run from the repository root using `.venv312\Scripts\python.exe`:

#### 1. Two-Story Proof Run (plus Resume Check)

```powershell
# Render the first 2 stories of week 16 to Ogg Opus and write audio/report.json
.venv312\Scripts\python.exe tools\vieneu-server\render_pack.py --weeks 16 --limit 2 --report

# Re-run the exact same command to verify fast all-skip resume (no Vieneu model load)
.venv312\Scripts\python.exe tools\vieneu-server\render_pack.py --weeks 16 --limit 2 --report
```

#### 2. Full 175-Story Production Run

> **Note:** Rendering the full **175-story** corpus is a **separate production run** and is not executed during development or smoke verification.

```powershell
.venv312\Scripts\python.exe tools\vieneu-server\render_pack.py --report
```

If interrupted (`Ctrl-C`) or stopped partway through, re-run the same command to resume from the last flushed manifest entry.
