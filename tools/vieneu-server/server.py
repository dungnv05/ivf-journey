"""Local loopback HTTP TTS server powered by VieNeu-TTS v3 Turbo (ONNX CPU)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import http.server
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from typing import Any
from urllib.parse import urlsplit

from vieneu import Vieneu

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_VOICE = "Thiện Minh"
DEFAULT_PRECISION = "int8"
VALID_PRECISIONS = frozenset({"int8", "fp32"})

MODEL_NAME = "VieNeu-TTS v3 Turbo"
MODEL_ID = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
DEFAULT_SAMPLE_RATE = 48000

MAX_TEXT_LENGTH = 4000
MAX_BODY_BYTES = 1024 * 1024

ALLOWED_ORIGINS = frozenset(
    {
        "https://ivf-journey.yundev.space",
        "http://localhost:5173",
    }
)
ALLOWED_TTS_KEYS = frozenset({"text", "voice"})
KNOWN_PATHS = frozenset({"/health", "/voices", "/tts"})

INFERENCE_LOCK = threading.Lock()
_LOG_LOCK = threading.Lock()


@dataclass(frozen=True)
class ServerConfig:
    port: int
    default_voice: str
    precision: str
    cache_dir: Path


def _configure_stdio_utf8() -> None:
    """Prevent Windows cp1252 console encoding errors on Vietnamese text."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass


def load_config() -> ServerConfig:
    """Read and validate environment configuration and ensure cache dir exists."""
    raw_port = os.environ.get("VIENEU_PORT", str(DEFAULT_PORT)).strip()
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise ValueError(f"Invalid VIENEU_PORT {raw_port!r}: must be an integer 1..65535") from exc
    if not (1 <= port <= 65535):
        raise ValueError(f"Invalid VIENEU_PORT {port}: must be between 1 and 65535")

    raw_precision = os.environ.get("VIENEU_PRECISION", DEFAULT_PRECISION).strip().lower()
    if raw_precision not in VALID_PRECISIONS:
        valid_list = ", ".join(sorted(VALID_PRECISIONS))
        raise ValueError(
            f"Invalid VIENEU_PRECISION {raw_precision!r}: must be one of {valid_list}"
        )

    default_voice = os.environ.get("VIENEU_VOICE", DEFAULT_VOICE)
    if not isinstance(default_voice, str) or not default_voice.strip():
        raise ValueError("Invalid VIENEU_VOICE: must be a non-empty preset voice ID")

    raw_cache_dir = os.environ.get("VIENEU_CACHE_DIR", "").strip()
    if raw_cache_dir:
        cache_dir = Path(raw_cache_dir).expanduser().resolve()
    else:
        cache_dir = (Path(__file__).resolve().parent / "cache").resolve()

    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        if not cache_dir.is_dir():
            raise ValueError(f"VIENEU_CACHE_DIR is not a directory: {cache_dir}")
        probe_fd, probe_path = tempfile.mkstemp(dir=str(cache_dir), prefix=".probe.")
        os.close(probe_fd)
        os.unlink(probe_path)
    except OSError as exc:
        raise ValueError(f"Cache directory is not writable ({cache_dir}): {exc}") from exc

    return ServerConfig(
        port=port,
        default_voice=default_voice,
        precision=raw_precision,
        cache_dir=cache_dir,
    )


def cache_key_for(text: str, voice: str, precision: str) -> str:
    """Compute SHA-256 hex digest of UTF-8 'text|voice|precision'."""
    material = f"{text}|{voice}|{precision}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _parse_preset_voices(raw_voices: Any) -> list[dict[str, str]]:
    """Normalize list_preset_voices() (label, voice_id) pairs."""
    voices: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for entry in raw_voices:
        if not isinstance(entry, (tuple, list)) or len(entry) != 2:
            raise RuntimeError(
                f"Unexpected preset voice entry from list_preset_voices(): {entry!r}"
            )
        label, voice_id = entry
        label_str = str(label)
        voice_id_str = str(voice_id)
        if voice_id_str not in seen_ids:
            seen_ids.add(voice_id_str)
            voices.append({"id": voice_id_str, "label": label_str})
    return voices


class TTSState:
    """Holds the loaded VieNeu model, preset voices, and disk cache synthesis logic."""

    def __init__(self, config: ServerConfig, model: Any) -> None:
        self.config = config
        self.model = model
        self.voices = _parse_preset_voices(model.list_preset_voices())
        self.voice_ids = frozenset(v["id"] for v in self.voices)
        self._voice_cache: dict[str, Any] = {}

        if config.default_voice not in self.voice_ids:
            available = ", ".join(v["id"] for v in self.voices)
            raise ValueError(
                f"Configured VIENEU_VOICE {config.default_voice!r} is not an available preset voice ID. "
                f"Available IDs ({len(self.voices)}): {available}"
            )

        raw_sr = getattr(model, "sample_rate", DEFAULT_SAMPLE_RATE)
        try:
            self.sample_rate = int(raw_sr) if raw_sr else DEFAULT_SAMPLE_RATE
        except (TypeError, ValueError):
            self.sample_rate = DEFAULT_SAMPLE_RATE

    def _resolve_voice(self, voice_id: str) -> Any:
        """Resolve a preset voice ID via get_preset_voice() when available (called under lock)."""
        if voice_id in self._voice_cache:
            return self._voice_cache[voice_id]

        get_preset = getattr(self.model, "get_preset_voice", None)
        if callable(get_preset):
            try:
                voice_obj = get_preset(voice_id)
            except NotImplementedError:
                voice_obj = voice_id
            if voice_obj is not None:
                self._voice_cache[voice_id] = voice_obj
                return voice_obj
        return voice_id

    def synthesize(self, text: str, voice: str) -> tuple[bytes, bool, float]:
        """Return (wav_bytes, cache_hit, synth_seconds) with atomic disk caching."""
        digest = cache_key_for(text, voice, self.config.precision)
        final_path = self.config.cache_dir / f"{digest}.wav"

        if final_path.is_file():
            try:
                cached = final_path.read_bytes()
                if cached:
                    return cached, True, 0.0
            except OSError:
                pass

        with INFERENCE_LOCK:
            if final_path.is_file():
                cached = final_path.read_bytes()
                if cached:
                    return cached, True, 0.0

            t0 = time.perf_counter()
            voice_arg = self._resolve_voice(voice)
            audio = self.model.infer(text=text, voice=voice_arg)

            tmp_fd, tmp_name = tempfile.mkstemp(
                dir=str(self.config.cache_dir),
                prefix=f".{digest}.",
                suffix=".wav",
            )
            os.close(tmp_fd)
            try:
                self.model.save(audio, tmp_name)
                if not os.path.isfile(tmp_name) or os.path.getsize(tmp_name) == 0:
                    raise RuntimeError("Model save produced an empty WAV file")
                os.replace(tmp_name, final_path)
            except Exception:
                try:
                    if os.path.exists(tmp_name):
                        os.unlink(tmp_name)
                except OSError:
                    pass
                raise

            synth_seconds = time.perf_counter() - t0
            wav_bytes = final_path.read_bytes()
            return wav_bytes, False, synth_seconds


def _log_request(
    method: str,
    path: str,
    status: int,
    chars: int | None,
    cache_state: str,
    synth_seconds: float,
) -> None:
    """Emit exactly one concise log line per HTTP request."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    safe_path = path.replace("\r", "").replace("\n", "")
    chars_str = str(chars) if chars is not None else "n/a"
    line = (
        f"{ts} {method} {safe_path} status={status} "
        f"chars={chars_str} cache={cache_state} synth={synth_seconds:.3f}s"
    )
    with _LOG_LOCK:
        print(line, flush=True)


def make_handler(state: TTSState) -> type[http.server.BaseHTTPRequestHandler]:
    """Build a request handler class bound to the shared TTSState."""

    class TTSRequestHandler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            # Suppress BaseHTTPRequestHandler's default request log line.
            return

        def _request_path(self) -> str:
            raw = getattr(self, "path", "/") or "/"
            return urlsplit(raw).path

        def _send_cors_headers(self, *, preflight: bool = False, expose_cache: bool = False) -> None:
            headers = getattr(self, "headers", None)
            origin = headers.get("Origin") if headers is not None else None
            self.send_header("Vary", "Origin")
            if origin in ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                if expose_cache:
                    self.send_header("Access-Control-Expose-Headers", "X-Cache")
            if preflight:
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Max-Age", "600")

        def _write_body(self, body: bytes) -> None:
            if not body or getattr(self, "command", None) == "HEAD":
                return
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

        def _send_json(
            self,
            status: int,
            payload: dict[str, Any],
            *,
            extra_headers: dict[str, str] | None = None,
            close_conn: bool = False,
            chars: int | None = None,
            cache_state: str = "n/a",
            synth_seconds: float = 0.0,
        ) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if close_conn:
                self.close_connection = True
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            if close_conn:
                self.send_header("Connection", "close")
            if extra_headers:
                for key, value in extra_headers.items():
                    self.send_header(key, value)
            self.end_headers()
            self._write_body(body)
            _log_request(
                getattr(self, "command", "-") or "-",
                self._request_path(),
                status,
                chars,
                cache_state,
                synth_seconds,
            )

        def _send_error_json(
            self,
            status: int,
            message: str,
            *,
            extra_headers: dict[str, str] | None = None,
            chars: int | None = None,
            cache_state: str = "n/a",
            synth_seconds: float = 0.0,
        ) -> None:
            self._send_json(
                status,
                {"error": message},
                extra_headers=extra_headers,
                close_conn=True,
                chars=chars,
                cache_state=cache_state,
                synth_seconds=synth_seconds,
            )

        def send_error(
            self,
            code: int,
            message: str | None = None,
            explain: str | None = None,
        ) -> None:
            """Return JSON instead of default HTML for low-level HTTP protocol errors."""
            self._send_error_json(code, message or "Bad request")

        def do_OPTIONS(self) -> None:
            path = self._request_path()
            if path not in KNOWN_PATHS:
                self._send_error_json(404, "Not found")
                return

            self.send_response(204)
            self._send_cors_headers(preflight=True)
            self.send_header("Content-Length", "0")
            self.end_headers()
            _log_request("OPTIONS", path, 204, None, "n/a", 0.0)

        def do_GET(self) -> None:
            path = self._request_path()
            if path == "/health":
                self._send_json(
                    200,
                    {
                        "status": "ok",
                        "model": MODEL_NAME,
                        "model_id": MODEL_ID,
                        "precision": state.config.precision,
                        "sample_rate": state.sample_rate,
                        "default_voice": state.config.default_voice,
                        "voices": state.voices,
                    },
                )
                return

            if path == "/voices":
                self._send_json(
                    200,
                    {
                        "default_voice": state.config.default_voice,
                        "voices": state.voices,
                    },
                )
                return

            if path == "/tts":
                self._send_error_json(
                    405,
                    "Method not allowed",
                    extra_headers={"Allow": "POST, OPTIONS"},
                )
                return

            self._send_error_json(404, "Not found")

        def do_POST(self) -> None:
            path = self._request_path()
            if path in ("/health", "/voices"):
                self._send_error_json(
                    405,
                    "Method not allowed",
                    extra_headers={"Allow": "GET, OPTIONS"},
                )
                return

            if path != "/tts":
                self._send_error_json(404, "Not found")
                return

            self._handle_tts()

        def _handle_unsupported_method(self) -> None:
            path = self._request_path()
            if path in ("/health", "/voices"):
                self._send_error_json(
                    405,
                    "Method not allowed",
                    extra_headers={"Allow": "GET, OPTIONS"},
                )
            elif path == "/tts":
                self._send_error_json(
                    405,
                    "Method not allowed",
                    extra_headers={"Allow": "POST, OPTIONS"},
                )
            else:
                self._send_error_json(404, "Not found")

        def do_PUT(self) -> None:
            self._handle_unsupported_method()

        def do_DELETE(self) -> None:
            self._handle_unsupported_method()

        def do_PATCH(self) -> None:
            self._handle_unsupported_method()

        def do_HEAD(self) -> None:
            self._handle_unsupported_method()

        def _handle_tts(self) -> None:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                self._send_error_json(400, "Missing Content-Length header", chars=0)
                return

            try:
                content_length = int(raw_length.strip())
            except ValueError:
                self._send_error_json(400, "Invalid Content-Length header", chars=0)
                return

            if content_length < 0:
                self._send_error_json(400, "Invalid Content-Length header", chars=0)
                return

            if content_length > MAX_BODY_BYTES:
                self._send_error_json(413, "Request body too large", chars=0)
                return

            try:
                raw_body = self.rfile.read(content_length)
            except OSError:
                self._send_error_json(400, "Failed to read request body", chars=0)
                return

            if len(raw_body) != content_length:
                self._send_error_json(400, "Incomplete request body", chars=0)
                return

            try:
                body_text = raw_body.decode("utf-8")
            except UnicodeDecodeError:
                self._send_error_json(400, "Request body must be valid UTF-8", chars=0)
                return

            try:
                payload = json.loads(body_text)
            except json.JSONDecodeError:
                self._send_error_json(400, "Malformed JSON body", chars=0)
                return

            if not isinstance(payload, dict):
                self._send_error_json(400, "Request body must be a JSON object", chars=0)
                return

            unknown_keys = sorted(set(payload.keys()) - ALLOWED_TTS_KEYS)
            if unknown_keys:
                self._send_error_json(
                    400,
                    f"Unknown field(s): {', '.join(unknown_keys)}",
                    chars=0,
                )
                return

            if "text" not in payload:
                self._send_error_json(400, "Missing required field: text", chars=0)
                return

            text = payload["text"]
            if not isinstance(text, str):
                self._send_error_json(400, "Field 'text' must be a string", chars=0)
                return

            text_len = len(text)
            if text_len == 0 or not text.strip():
                self._send_error_json(
                    400,
                    "Field 'text' must contain at least 1 non-whitespace character",
                    chars=text_len,
                )
                return

            if text_len > MAX_TEXT_LENGTH:
                self._send_error_json(
                    400,
                    f"Field 'text' must be at most {MAX_TEXT_LENGTH} characters",
                    chars=text_len,
                )
                return

            if "voice" in payload:
                voice = payload["voice"]
                if not isinstance(voice, str):
                    self._send_error_json(
                        400,
                        "Field 'voice' must be a string",
                        chars=text_len,
                    )
                    return
                if voice not in state.voice_ids:
                    self._send_error_json(
                        400,
                        "Invalid voice ID",
                        chars=text_len,
                    )
                    return
            else:
                voice = state.config.default_voice

            t_start = time.perf_counter()
            try:
                wav_bytes, cache_hit, synth_seconds = state.synthesize(text, voice)
            except Exception:
                elapsed = time.perf_counter() - t_start
                self._send_error_json(
                    500,
                    "Speech synthesis failed",
                    chars=text_len,
                    cache_state="MISS",
                    synth_seconds=elapsed,
                )
                return

            cache_header = "HIT" if cache_hit else "MISS"
            self.send_response(200)
            self._send_cors_headers(expose_cache=True)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.send_header("X-Cache", cache_header)
            self.end_headers()
            self._write_body(wav_bytes)
            _log_request("POST", "/tts", 200, text_len, cache_header, synth_seconds)

    return TTSRequestHandler


def create_server(state: TTSState) -> http.server.ThreadingHTTPServer:
    """Create the loopback-only ThreadingHTTPServer bound to 127.0.0.1."""
    handler_cls = make_handler(state)
    server = http.server.ThreadingHTTPServer((HOST, state.config.port), handler_cls)
    server.daemon_threads = True
    return server


def main() -> int:
    _configure_stdio_utf8()

    try:
        config = load_config()
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr, flush=True)
        return 1

    try:
        model = Vieneu(
            mode="v3turbo",
            precision=config.precision,
            device="cpu",
            backend="onnx",
        )
        state = TTSState(config=config, model=model)
    except Exception as exc:
        print(f"Failed to initialize {MODEL_NAME}: {exc}", file=sys.stderr, flush=True)
        return 1

    try:
        server = create_server(state)
    except OSError as exc:
        print(
            f"Failed to bind http://{HOST}:{config.port}: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 1

    print(
        f"VieNeu TTS server ready on http://{HOST}:{config.port} "
        f"(model={MODEL_NAME}, precision={config.precision}, "
        f"sample_rate={state.sample_rate}Hz, voices={len(state.voices)}, "
        f"default_voice={config.default_voice!r}, cache_dir={config.cache_dir})",
        flush=True,
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        close_fn = getattr(model, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
