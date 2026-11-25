"""Standalone batch renderer for the IVF Journey local static audio pack.

Loads stories by running scripts/export-stories-json.mjs via Node into a
temporary file outside the repository, synthesizes speech with a single
VieNeu-TTS v3 Turbo (ONNX CPU) instance, encodes each story to Ogg Opus or MP3
via ffmpeg, verifies outputs with ffprobe, and maintains a resumable atomic
manifest.json plus optional report JSON.
"""

from __future__ import annotations

import argparse
import atexit
import contextvars
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path, PureWindowsPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXPORTER_SCRIPT = REPO_ROOT / "scripts" / "export-stories-json.mjs"
DEFAULT_OUT_DIR = REPO_ROOT / "tools" / "vieneu-server" / "audio"

DEFAULT_VOICE = "Thiện Minh"
DEFAULT_PRECISION = "int8"
VALID_PRECISIONS = ("int8", "fp32")
DEFAULT_FORMAT = "opus"
VALID_FORMATS = ("opus", "mp3")
DEFAULT_BITRATE = "48k"

MODEL_ID = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
TARGET_SAMPLE_RATE = 48000
TARGET_CHANNELS = 1

EDGE_SILENCE_MS = 600
BLOCK_SILENCE_MS = 250
CHUNK_TARGET_MIN_CHARS = 200
CHUNK_MAX_CHARS = 350

WEEKS_SINGLE_RE = re.compile(r"^(\d+)$")
WEEKS_RANGE_RE = re.compile(r"^(\d+)-(\d+)$")
STORY_ID_RE = re.compile(r"^w(\d+)-d(\d+)$")
BITRATE_RE = re.compile(r"^[1-9]\d*[kKmM]?$")
SENTENCE_END_RE = re.compile(r"""[.!?…]+["”’')\]»]*(?=\s+|$)""")
WHITESPACE_RE = re.compile(r"\s+")
CLAUSE_BREAK_CHARS = frozenset(",;:—–")

_REPORT_DEFAULT_SENTINEL = object()
_STAGED_TOOL_DIRS: set[Path] = set()


class CLIError(Exception):
    """Raised for invalid CLI arguments."""


class SetupError(Exception):
    """Raised for missing tools, exporter errors, or unrecoverable setup failures."""


@dataclass(frozen=True)
class RenderConfig:
    voice: str
    precision: str
    weeks_raw: str | None
    weeks_range: tuple[int, int] | None
    limit: int | None
    audio_format: str
    bitrate: str
    out_dir: Path
    report_path: Path | None


def _configure_stdio_utf8() -> None:
    """Prevent Windows cp1252 console encoding errors on Vietnamese text."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass


def _resolve_user_path(raw: str) -> Path:
    """Resolve a user-supplied path relative to the caller's working directory."""
    return (Path.cwd() / Path(raw).expanduser()).resolve()


def parse_weeks_spec(raw: str) -> tuple[int, int]:
    """Parse --weeks value as N or A-B."""
    value = raw.strip()
    m_single = WEEKS_SINGLE_RE.match(value)
    if m_single:
        week = int(m_single.group(1))
        if week <= 0:
            raise CLIError(f"Invalid --weeks value {raw!r}: week must be a positive integer")
        return (week, week)

    m_range = WEEKS_RANGE_RE.match(value)
    if m_range:
        start = int(m_range.group(1))
        end = int(m_range.group(2))
        if start <= 0 or end <= 0:
            raise CLIError(f"Invalid --weeks value {raw!r}: weeks must be positive integers")
        if start > end:
            raise CLIError(f"Invalid --weeks range {raw!r}: start ({start}) > end ({end})")
        return (start, end)

    raise CLIError(f"Invalid --weeks value {raw!r}: expected N or A-B (e.g. 16 or 16-20)")


def parse_args(argv: list[str]) -> RenderConfig:
    """Parse and validate CLI arguments."""
    parser = argparse.ArgumentParser(
        prog="render_pack.py",
        description=(
            "Render static local Thai Giao story audio files (Opus/MP3) using "
            "VieNeu-TTS v3 Turbo (ONNX CPU) with resumable manifest tracking."
        ),
    )
    parser.add_argument(
        "--voice",
        default=DEFAULT_VOICE,
        help=f"Preset voice ID (default: {DEFAULT_VOICE})",
    )
    parser.add_argument(
        "--precision",
        default=DEFAULT_PRECISION,
        choices=VALID_PRECISIONS,
        help=f"ONNX precision (default: {DEFAULT_PRECISION})",
    )
    parser.add_argument(
        "--weeks",
        default=None,
        help="Optional week filter as N or A-B (applied before --limit)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional positive integer cap on number of stories to process",
    )
    parser.add_argument(
        "--format",
        dest="audio_format",
        default=DEFAULT_FORMAT,
        choices=VALID_FORMATS,
        help=f"Output audio format (default: {DEFAULT_FORMAT})",
    )
    parser.add_argument(
        "--bitrate",
        default=DEFAULT_BITRATE,
        help=f"FFmpeg audio bitrate, e.g. 48k or 64k (default: {DEFAULT_BITRATE})",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output directory for audio files and manifest.json (default: tools/vieneu-server/audio)",
    )
    parser.add_argument(
        "--report",
        nargs="?",
        const=_REPORT_DEFAULT_SENTINEL,
        default=None,
        help="Write run summary JSON to given path, or <out>/report.json if omitted",
    )

    try:
        ns = parser.parse_args(argv)
    except SystemExit as exc:
        if exc.code == 0:
            raise
        raise CLIError(f"Invalid command-line arguments (exit {exc.code})") from exc

    voice = ns.voice.strip() if isinstance(ns.voice, str) else ""
    if not voice:
        raise CLIError("Invalid --voice: must be a non-empty preset voice ID")

    weeks_range: tuple[int, int] | None = None
    weeks_raw: str | None = None
    if ns.weeks is not None:
        weeks_raw = ns.weeks.strip()
        weeks_range = parse_weeks_spec(weeks_raw)

    limit: int | None = ns.limit
    if limit is not None and limit <= 0:
        raise CLIError(f"Invalid --limit {limit}: must be a positive integer")

    bitrate = ns.bitrate.strip() if isinstance(ns.bitrate, str) else ""
    if not BITRATE_RE.match(bitrate):
        raise CLIError(
            f"Invalid --bitrate {ns.bitrate!r}: expected positive number with optional k/M suffix (e.g. 48k)"
        )

    if ns.out is None:
        out_dir = DEFAULT_OUT_DIR.resolve()
    else:
        if not ns.out.strip():
            raise CLIError("Invalid --out: path must be non-empty")
        out_dir = _resolve_user_path(ns.out)

    report_path: Path | None
    if ns.report is None:
        report_path = None
    elif ns.report is _REPORT_DEFAULT_SENTINEL:
        report_path = out_dir / "report.json"
    else:
        if not isinstance(ns.report, str) or not ns.report.strip():
            raise CLIError("Invalid --report: path must be non-empty when provided")
        report_path = _resolve_user_path(ns.report)

    return RenderConfig(
        voice=voice,
        precision=ns.precision,
        weeks_raw=weeks_raw,
        weeks_range=weeks_range,
        limit=limit,
        audio_format=ns.audio_format,
        bitrate=bitrate,
        out_dir=out_dir,
        report_path=report_path,
    )


def _cleanup_staged_dir(path: Path) -> None:
    """Remove a temporary staging directory and unregister it from atexit tracking."""
    _STAGED_TOOL_DIRS.discard(path)
    if not path.exists():
        return
    try:
        for child in path.rglob("*"):
            try:
                if child.is_file():
                    os.chmod(child, 0o600)
            except OSError:
                pass
    except OSError:
        pass
    shutil.rmtree(path, ignore_errors=True)


def _cleanup_all_staged_dirs() -> None:
    """Remove any remaining staged executable directories on process exit."""
    for path in list(_STAGED_TOOL_DIRS):
        _cleanup_staged_dir(path)


atexit.register(_cleanup_all_staged_dirs)


class _ExecutableStagingScope:
    """Tracks the temporary staging directory for WindowsApps executables within a run."""

    def __init__(self) -> None:
        self._dir: Path | None = None

    def get_or_create_dir(self, tool_name: str, src_path: Path, hint: str) -> Path:
        if self._dir is None:
            temp_root = tempfile.gettempdir()
            try:
                created = Path(tempfile.mkdtemp(prefix="ivf-staged-tools-"))
            except OSError as exc:
                raise SetupError(
                    f"Failed to create temporary staging directory for {tool_name!r} "
                    f"(source: {src_path}, destination: {temp_root}): {exc}. {hint}"
                ) from exc
            self._dir = created
            _STAGED_TOOL_DIRS.add(created)
        return self._dir

    def cleanup(self) -> None:
        if self._dir is not None:
            _cleanup_staged_dir(self._dir)
            self._dir = None


_ACTIVE_STAGING_SCOPE: contextvars.ContextVar[_ExecutableStagingScope | None] = contextvars.ContextVar(
    "_ACTIVE_STAGING_SCOPE",
    default=None,
)


def _has_windowsapps_parent(path_obj: Path | PureWindowsPath) -> bool:
    return any(part.lower() == "windowsapps" for part in path_obj.parent.parts)


def _is_windowsapps_path(executable_path: str) -> bool:
    """Return True on Windows when executable_path resides inside a WindowsApps directory."""
    if sys.platform != "win32":
        return False
    raw_path = Path(executable_path)
    if _has_windowsapps_parent(raw_path) or _has_windowsapps_parent(PureWindowsPath(executable_path)):
        return True
    try:
        resolved_path = raw_path.resolve()
    except OSError:
        return False
    return _has_windowsapps_parent(resolved_path) or _has_windowsapps_parent(PureWindowsPath(str(resolved_path)))


def _probe_args_for_executable(name: str) -> list[str]:
    """Return harmless version-check CLI arguments for verifying a staged executable."""
    if name.lower() in ("ffmpeg", "ffprobe"):
        return ["-version"]
    return ["--version"]


def _stage_windowsapps_executable(name: str, resolved_path: str, hint: str) -> str:
    """Copy a WindowsApps-packaged executable into a writable temp dir and verify launch."""
    src_path = Path(resolved_path)
    scope = _ACTIVE_STAGING_SCOPE.get()
    owned_standalone_dir: Path | None = None

    if scope is not None:
        base_dir = scope.get_or_create_dir(name, src_path, hint)
    else:
        temp_root = tempfile.gettempdir()
        try:
            owned_standalone_dir = Path(tempfile.mkdtemp(prefix="ivf-staged-tools-"))
        except OSError as exc:
            raise SetupError(
                f"Failed to create temporary staging directory for {name!r} "
                f"(source: {src_path}, destination: {temp_root}): {exc}. {hint}"
            ) from exc
        _STAGED_TOOL_DIRS.add(owned_standalone_dir)
        base_dir = owned_standalone_dir

    dest_name = src_path.name or f"{name}.exe"
    dest_path = base_dir / dest_name
    if dest_path.exists():
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "tool"
        try:
            sub_dir = Path(tempfile.mkdtemp(dir=str(base_dir), prefix=f"{safe_name}-"))
        except OSError as exc:
            if owned_standalone_dir is not None:
                _cleanup_staged_dir(owned_standalone_dir)
            raise SetupError(
                f"Failed to create staging subdirectory for {name!r} "
                f"(source: {src_path}, destination: {base_dir}): {exc}. {hint}"
            ) from exc
        dest_path = sub_dir / dest_name

    try:
        try:
            shutil.copyfile(str(src_path), str(dest_path))
        except OSError as exc:
            _safe_unlink(dest_path)
            raise SetupError(
                f"Failed to copy executable {name!r} from WindowsApps source {src_path} "
                f"to {dest_path}: {exc}. {hint}"
            ) from exc

        probe_cmd = [str(dest_path), *_probe_args_for_executable(name)]
        try:
            proc = subprocess.run(
                probe_cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
                timeout=15,
            )
        except OSError as exc:
            _safe_unlink(dest_path)
            raise SetupError(
                f"Failed to launch staged executable {name!r} "
                f"(source: {src_path}, destination: {dest_path}): {exc}. {hint}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            _safe_unlink(dest_path)
            raise SetupError(
                f"Timed out launching staged executable {name!r} "
                f"(source: {src_path}, destination: {dest_path}): {exc}. {hint}"
            ) from exc

        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            _safe_unlink(dest_path)
            raise SetupError(
                f"Staged executable {name!r} failed launch verification (exit {proc.returncode}; "
                f"source: {src_path}, destination: {dest_path}): {err or 'no error output'}. {hint}"
            )
    except BaseException:
        if owned_standalone_dir is not None:
            _cleanup_staged_dir(owned_standalone_dir)
        raise

    return str(dest_path)


def require_executable(name: str, hint: str) -> str:
    """Locate an executable on PATH or raise SetupError.

    On Windows, executables resolved inside WindowsApps are staged to a unique
    writable temporary directory so Python subprocess.run() can launch them.
    """
    resolved = shutil.which(name)
    if not resolved:
        raise SetupError(f"Required executable {name!r} was not found on PATH. {hint}")
    if _is_windowsapps_path(resolved):
        return _stage_windowsapps_executable(name, resolved, hint)
    return resolved


def story_sort_key(story_id: str, week: int | None = None, day: int | None = None) -> tuple[int, int, str]:
    """Deterministic numeric sort key (week, day, id)."""
    if isinstance(week, int) and isinstance(day, int):
        return (week, day, story_id)
    match = STORY_ID_RE.match(story_id)
    if match:
        return (int(match.group(1)), int(match.group(2)), story_id)
    return (sys.maxsize, sys.maxsize, story_id)


def load_stories_via_exporter(node_bin: str) -> list[dict[str, Any]]:
    """Run scripts/export-stories-json.mjs to a temp file outside the repo and read stories."""
    if not EXPORTER_SCRIPT.is_file():
        raise SetupError(f"Story exporter script not found: {EXPORTER_SCRIPT}")

    tmp_dir = tempfile.mkdtemp(prefix="ivf-stories-export-")
    export_path = Path(tmp_dir) / "stories.json"
    try:
        proc = subprocess.run(
            [node_bin, str(EXPORTER_SCRIPT), "--out", str(export_path)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if proc.returncode != 0:
            stderr_msg = (proc.stderr or proc.stdout or "").strip()
            raise SetupError(
                f"Story exporter failed (exit {proc.returncode}): {stderr_msg or 'no error output'}"
            )
        if not export_path.is_file():
            raise SetupError("Story exporter succeeded but did not create output JSON file")

        try:
            raw_data = json.loads(export_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SetupError(f"Failed to parse exported stories JSON: {exc}") from exc
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    if not isinstance(raw_data, list):
        raise SetupError("Exported stories JSON must be a top-level array")

    stories: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for idx, item in enumerate(raw_data):
        if not isinstance(item, dict):
            raise SetupError(f"Exported story at index {idx} is not an object")
        story_id = item.get("id")
        week = item.get("week")
        day = item.get("day")
        blocks = item.get("blocks")
        if not isinstance(story_id, str) or not story_id.strip():
            raise SetupError(f"Exported story at index {idx} has invalid id")
        if story_id in seen_ids:
            raise SetupError(f"Duplicate story id in exported corpus: {story_id}")
        seen_ids.add(story_id)
        if not isinstance(week, int) or isinstance(week, bool):
            raise SetupError(f"Exported story {story_id} has non-integer week")
        if not isinstance(day, int) or isinstance(day, bool):
            raise SetupError(f"Exported story {story_id} has non-integer day")
        if not isinstance(blocks, list):
            raise SetupError(f"Exported story {story_id} has non-list blocks")

        validated_blocks: list[dict[str, str]] = []
        for b_idx, blk in enumerate(blocks):
            if not isinstance(blk, dict):
                raise SetupError(f"Exported story {story_id} block[{b_idx}] is not an object")
            b_type = blk.get("type")
            b_text = blk.get("text")
            if not isinstance(b_type, str) or not isinstance(b_text, str):
                raise SetupError(
                    f"Exported story {story_id} block[{b_idx}] must have string type and text"
                )
            validated_blocks.append({"type": b_type, "text": b_text})

        stories.append(
            {
                "id": story_id,
                "week": week,
                "day": day,
                "title": item.get("title", ""),
                "blocks": validated_blocks,
            }
        )

    stories.sort(key=lambda s: story_sort_key(s["id"], s["week"], s["day"]))
    return stories


def select_stories(stories: list[dict[str, Any]], config: RenderConfig) -> list[dict[str, Any]]:
    """Filter by --weeks first, then apply --limit, preserving deterministic order."""
    selected = list(stories)
    if config.weeks_range is not None:
        w_min, w_max = config.weeks_range
        selected = [s for s in selected if w_min <= s["week"] <= w_max]
    if config.limit is not None:
        selected = selected[: config.limit]
    return selected


def count_words(blocks: list[dict[str, str]]) -> int:
    """Count whitespace-separated tokens over story block texts only."""
    joined = " ".join(block["text"] for block in blocks)
    return len(joined.split())


def compute_text_hash(blocks: list[dict[str, str]]) -> str:
    """Compute SHA-256 hex digest over deterministic UTF-8 ordered blocks (type + text)."""
    canonical = [{"type": block["type"], "text": block["text"]} for block in blocks]
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _split_long_span_at_words(
    text: str,
    start: int,
    end: int,
    *,
    target_min: int = CHUNK_TARGET_MIN_CHARS,
    max_chars: int = CHUNK_MAX_CHARS,
) -> list[tuple[int, int]]:
    """Split a single span exceeding max_chars strictly at whitespace boundaries."""
    spans: list[tuple[int, int]] = []
    cur = start

    while cur < end and text[cur].isspace():
        cur += 1
    while end > cur and text[end - 1].isspace():
        end -= 1

    while cur < end:
        if end - cur <= max_chars:
            spans.append((cur, end))
            break

        segment = text[cur:end]
        spaces = list(WHITESPACE_RE.finditer(segment))
        if not spaces:
            # Single token longer than max_chars: never split inside a word.
            spans.append((cur, end))
            break

        clause_break: re.Match[str] | None = None
        last_fitting: re.Match[str] | None = None
        for m in spaces:
            if m.start() == 0:
                continue
            if m.start() <= max_chars:
                last_fitting = m
                if m.start() >= target_min and segment[m.start() - 1] in CLAUSE_BREAK_CHARS:
                    clause_break = m
            else:
                break

        chosen = clause_break or last_fitting or spaces[0]
        piece_end = cur + chosen.start()
        if piece_end > cur:
            spans.append((cur, piece_end))
        cur = cur + chosen.end()
        while cur < end and text[cur].isspace():
            cur += 1

    return spans


def chunk_block_text(
    text: str,
    *,
    target_min: int = CHUNK_TARGET_MIN_CHARS,
    max_chars: int = CHUNK_MAX_CHARS,
) -> list[str]:
    """Chunk block text at sentence boundaries targeting 200-350 chars without splitting words."""
    if not text or not text.strip():
        return []

    n = len(text)
    lead = 0
    while lead < n and text[lead].isspace():
        lead += 1
    tail = n
    while tail > lead and text[tail - 1].isspace():
        tail -= 1

    # Extract sentence spans [start, end) preserving original characters verbatim.
    raw_sentence_spans: list[tuple[int, int]] = []
    pos = lead
    for match in SENTENCE_END_RE.finditer(text, lead, tail):
        sent_end = match.end()
        if sent_end > pos:
            raw_sentence_spans.append((pos, sent_end))
        pos = sent_end
        while pos < tail and text[pos].isspace():
            pos += 1
    if pos < tail:
        raw_sentence_spans.append((pos, tail))

    # Split any individual sentence > max_chars strictly at whitespace/word boundaries.
    unit_spans: list[tuple[int, int]] = []
    for s_start, s_end in raw_sentence_spans:
        if s_end - s_start <= max_chars:
            unit_spans.append((s_start, s_end))
        else:
            unit_spans.extend(
                _split_long_span_at_words(
                    text,
                    s_start,
                    s_end,
                    target_min=target_min,
                    max_chars=max_chars,
                )
            )

    if not unit_spans:
        return []

    # Greedily pack adjacent sentence/clause spans up to max_chars using exact slices.
    chunks: list[str] = []
    cur_start, cur_end = unit_spans[0]
    for u_start, u_end in unit_spans[1:]:
        if u_end - cur_start <= max_chars:
            cur_end = u_end
        else:
            chunks.append(text[cur_start:cur_end])
            cur_start, cur_end = u_start, u_end
    chunks.append(text[cur_start:cur_end])

    return chunks


def _parse_preset_voices(raw_voices: Any) -> list[dict[str, str]]:
    """Normalize list_preset_voices() (label, voice_id) pairs."""
    voices: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for entry in raw_voices:
        if not isinstance(entry, (tuple, list)) or len(entry) != 2:
            raise SetupError(f"Unexpected preset voice entry from list_preset_voices(): {entry!r}")
        label, voice_id = entry
        voice_id_str = str(voice_id)
        if voice_id_str not in seen_ids:
            seen_ids.add(voice_id_str)
            voices.append({"id": voice_id_str, "label": str(label)})
    return voices


class LazyVieneuEngine:
    """Lazily initializes at most one Vieneu instance for the entire run."""

    def __init__(self, voice_id: str, precision: str) -> None:
        self.voice_id = voice_id
        self.precision = precision
        self._model: Any | None = None
        self._resolved_voice: Any | None = None
        self.sample_rate: int = TARGET_SAMPLE_RATE

    def ensure_ready(self) -> tuple[Any, Any, int]:
        """Initialize the single model on first use and validate/resolve preset voice."""
        if self._model is not None:
            return self._model, self._resolved_voice, self.sample_rate

        try:
            from vieneu import Vieneu
        except Exception as exc:
            raise SetupError(f"Failed to import vieneu: {exc}") from exc

        try:
            model = Vieneu(
                mode="v3turbo",
                precision=self.precision,
                device="cpu",
                backend="onnx",
            )
        except Exception as exc:
            raise SetupError(f"Failed to initialize Vieneu ({MODEL_ID}, {self.precision}): {exc}") from exc

        try:
            voices = _parse_preset_voices(model.list_preset_voices())
            voice_ids = {v["id"] for v in voices}
            if self.voice_id not in voice_ids:
                available = ", ".join(v["id"] for v in voices)
                raise SetupError(
                    f"Voice {self.voice_id!r} is not an available preset voice ID. "
                    f"Available IDs ({len(voices)}): {available}"
                )

            resolved_voice: Any = self.voice_id
            get_preset = getattr(model, "get_preset_voice", None)
            if callable(get_preset):
                try:
                    voice_obj = get_preset(self.voice_id)
                except NotImplementedError:
                    voice_obj = self.voice_id
                if voice_obj is not None:
                    resolved_voice = voice_obj

            raw_sr = getattr(model, "sample_rate", TARGET_SAMPLE_RATE)
            try:
                sample_rate = int(raw_sr) if raw_sr else TARGET_SAMPLE_RATE
            except (TypeError, ValueError):
                sample_rate = TARGET_SAMPLE_RATE

            if sample_rate != TARGET_SAMPLE_RATE:
                raise SetupError(
                    f"Expected model sample rate {TARGET_SAMPLE_RATE} Hz, got {sample_rate} Hz"
                )
        except Exception:
            close_fn = getattr(model, "close", None)
            if callable(close_fn):
                try:
                    close_fn()
                except Exception:
                    pass
            raise

        self._model = model
        self._resolved_voice = resolved_voice
        self.sample_rate = sample_rate
        return self._model, self._resolved_voice, self.sample_rate

    def close(self) -> None:
        """Close the single model instance if it was initialized."""
        model = self._model
        self._model = None
        self._resolved_voice = None
        if model is None:
            return
        close_fn = getattr(model, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:
                pass


def _to_mono_float32(audio: Any) -> np.ndarray:
    """Convert raw model.infer() output to a contiguous 1D float32 mono PCM array."""
    arr = np.asarray(audio, dtype=np.float32)
    if arr.ndim == 0:
        raise RuntimeError("model.infer() returned a scalar instead of PCM audio")
    if arr.ndim == 2:
        if arr.shape[0] <= 8 and arr.shape[1] > arr.shape[0]:
            arr = arr.mean(axis=0, dtype=np.float32)
        else:
            arr = arr.mean(axis=1, dtype=np.float32)
    elif arr.ndim > 2:
        arr = arr.reshape(-1)
    if arr.size == 0:
        raise RuntimeError("model.infer() returned empty PCM audio")
    return np.ascontiguousarray(arr, dtype=np.float32)


def synthesize_story_pcm(
    model: Any,
    resolved_voice: Any,
    sample_rate: int,
    blocks: list[dict[str, str]],
    synth_acc: list[float] | None = None,
) -> tuple[np.ndarray, float]:
    """Synthesize all blocks in order into a single 1D float32 mono array and return (pcm, synth_s)."""
    block_chunk_lists: list[list[str]] = []
    for block in blocks:
        chunks = chunk_block_text(block["text"])
        if chunks:
            block_chunk_lists.append(chunks)

    if not block_chunk_lists:
        raise RuntimeError("Story contains no speakable block text")

    edge_silence = np.zeros(int(round(sample_rate * (EDGE_SILENCE_MS / 1000.0))), dtype=np.float32)
    block_silence = np.zeros(int(round(sample_rate * (BLOCK_SILENCE_MS / 1000.0))), dtype=np.float32)

    pcm_parts: list[np.ndarray] = [edge_silence]
    synth_seconds = 0.0

    for block_idx, chunks in enumerate(block_chunk_lists):
        if block_idx > 0:
            pcm_parts.append(block_silence)
        for segment in chunks:
            t0 = time.perf_counter()
            raw_audio = model.infer(
                text=segment,
                voice=resolved_voice,
                apply_watermark=False,
                max_chars=CHUNK_MAX_CHARS,
            )
            dt = time.perf_counter() - t0
            synth_seconds += dt
            if synth_acc is not None:
                synth_acc[0] = synth_seconds
            pcm_parts.append(_to_mono_float32(raw_audio))

    pcm_parts.append(edge_silence)
    full_pcm = np.concatenate(pcm_parts)
    return np.ascontiguousarray(full_pcm, dtype=np.float32), synth_seconds


def encode_wav_to_part(
    ffmpeg_bin: str,
    wav_path: Path,
    part_path: Path,
    audio_format: str,
    bitrate: str,
) -> None:
    """Encode a temporary WAV file to a .part target using ffmpeg."""
    if audio_format == "opus":
        codec_args = [
            "-c:a",
            "libopus",
            "-b:a",
            bitrate,
            "-ac",
            str(TARGET_CHANNELS),
            "-ar",
            str(TARGET_SAMPLE_RATE),
            "-f",
            "ogg",
        ]
    elif audio_format == "mp3":
        codec_args = [
            "-c:a",
            "libmp3lame",
            "-b:a",
            bitrate,
            "-ac",
            str(TARGET_CHANNELS),
            "-ar",
            str(TARGET_SAMPLE_RATE),
            "-f",
            "mp3",
        ]
    else:
        raise ValueError(f"Unsupported audio format: {audio_format}")

    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(wav_path),
        "-vn",
        *codec_args,
        str(part_path),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"ffmpeg encode failed (exit {proc.returncode}): {err or 'no error output'}")


def probe_and_verify_audio(
    ffprobe_bin: str,
    audio_path: Path,
    expected_format: str,
) -> tuple[float, int]:
    """Verify encoded file via ffprobe (codec, 48 kHz, mono, duration > 0) and return (duration_s, bytes)."""
    if not audio_path.is_file():
        raise RuntimeError(f"Encoded file does not exist: {audio_path}")
    file_bytes = audio_path.stat().st_size
    if file_bytes <= 0:
        raise RuntimeError(f"Encoded file is empty: {audio_path}")

    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,duration:format=duration,size",
        "-of",
        "json",
        str(audio_path),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"ffprobe failed (exit {proc.returncode}): {err or 'no error output'}")

    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ffprobe returned invalid JSON: {exc}") from exc

    streams = info.get("streams")
    if not isinstance(streams, list) or not streams:
        raise RuntimeError("ffprobe found no audio stream in encoded file")
    stream = streams[0]
    if not isinstance(stream, dict):
        raise RuntimeError("ffprobe stream entry is malformed")

    expected_codec = "opus" if expected_format == "opus" else "mp3"
    codec_name = str(stream.get("codec_name") or "").lower()
    if codec_name != expected_codec:
        raise RuntimeError(f"ffprobe codec mismatch: expected {expected_codec!r}, got {codec_name!r}")

    try:
        sample_rate = int(stream.get("sample_rate"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"ffprobe invalid sample_rate: {stream.get('sample_rate')!r}") from exc
    if sample_rate != TARGET_SAMPLE_RATE:
        raise RuntimeError(
            f"ffprobe sample_rate mismatch: expected {TARGET_SAMPLE_RATE}, got {sample_rate}"
        )

    try:
        channels = int(stream.get("channels"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"ffprobe invalid channels: {stream.get('channels')!r}") from exc
    if channels != TARGET_CHANNELS:
        raise RuntimeError(f"ffprobe channels mismatch: expected {TARGET_CHANNELS}, got {channels}")

    fmt_obj = info.get("format") if isinstance(info.get("format"), dict) else {}
    raw_duration = fmt_obj.get("duration")
    if raw_duration in (None, "", "N/A"):
        raw_duration = stream.get("duration")
    try:
        duration_s = float(raw_duration)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"ffprobe missing/invalid duration: {raw_duration!r}") from exc
    if not math.isfinite(duration_s) or duration_s <= 0.0:
        raise RuntimeError(f"ffprobe non-positive duration: {duration_s!r}")

    return duration_s, file_bytes


def write_json_atomically(path: Path, payload: Any) -> None:
    """Write UTF-8 JSON atomically to path, creating parent directories if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    os.close(fd)
    try:
        serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        with open(tmp_name, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(serialized)
            handle.flush()
            try:
                os.fsync(handle.fileno())
            except OSError:
                pass
        os.replace(tmp_name, path)
    except BaseException:
        try:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
        except OSError:
            pass
        raise


def load_manifest(manifest_path: Path) -> dict[str, dict[str, Any]]:
    """Load existing manifest.json array indexed by story id."""
    if not manifest_path.exists():
        return {}
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SetupError(f"Failed to read existing manifest {manifest_path}: {exc}") from exc

    if not isinstance(raw, list):
        raise SetupError(f"Existing manifest {manifest_path} must be a JSON array")

    by_id: dict[str, dict[str, Any]] = {}
    for idx, entry in enumerate(raw):
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"].strip():
            raise SetupError(f"Existing manifest {manifest_path} entry[{idx}] is missing a valid 'id'")
        by_id[entry["id"]] = entry
    return by_id


def flush_manifest(manifest_path: Path, manifest_by_id: dict[str, dict[str, Any]]) -> None:
    """Sort manifest entries deterministically and atomically rewrite manifest.json."""
    entries = sorted(
        manifest_by_id.values(),
        key=lambda e: story_sort_key(str(e.get("id", ""))),
    )
    write_json_atomically(manifest_path, entries)


def check_resume_candidate(
    existing: dict[str, Any] | None,
    *,
    story_id: str,
    voice: str,
    precision: str,
    text_hash: str,
    audio_format: str,
    bitrate: str,
    out_dir: Path,
) -> tuple[bool, int, float]:
    """Return (can_skip, actual_bytes, duration_s) if existing entry & file match resume rules."""
    if existing is None:
        return (False, 0, 0.0)

    if (
        existing.get("id") != story_id
        or existing.get("voice") != voice
        or existing.get("precision") != precision
        or existing.get("text_hash") != text_hash
    ):
        return (False, 0, 0.0)

    if "model" in existing and existing.get("model") != MODEL_ID:
        return (False, 0, 0.0)

    expected_file = f"{story_id}.{audio_format}"
    if existing.get("file") != expected_file:
        return (False, 0, 0.0)

    if "format" in existing and existing.get("format") != audio_format:
        return (False, 0, 0.0)

    if "bitrate" in existing and existing.get("bitrate") != bitrate:
        return (False, 0, 0.0)

    recorded_bytes = existing.get("bytes")
    if not isinstance(recorded_bytes, int) or isinstance(recorded_bytes, bool) or recorded_bytes <= 0:
        return (False, 0, 0.0)

    recorded_duration = existing.get("duration_s")
    if (
        not isinstance(recorded_duration, (int, float))
        or isinstance(recorded_duration, bool)
        or not math.isfinite(float(recorded_duration))
        or float(recorded_duration) <= 0.0
    ):
        return (False, 0, 0.0)

    target_path = out_dir / expected_file
    try:
        if not target_path.is_file():
            return (False, 0, 0.0)
        actual_bytes = target_path.stat().st_size
    except OSError:
        return (False, 0, 0.0)

    if actual_bytes <= 0 or actual_bytes != recorded_bytes:
        return (False, 0, 0.0)

    return (True, actual_bytes, float(recorded_duration))


def _remove_stale_file_if_replaced(out_dir: Path, old_entry: dict[str, Any] | None, new_file: str) -> None:
    """Delete an older format file in out_dir if a story was re-rendered to a different filename."""
    if not old_entry:
        return
    old_file = old_entry.get("file")
    if not isinstance(old_file, str) or not old_file or old_file == new_file:
        return
    try:
        out_resolved = out_dir.resolve()
        old_path = (out_dir / old_file).resolve()
        if old_path.parent == out_resolved and old_path.is_file():
            old_path.unlink()
    except OSError:
        pass


def format_eta(seconds: float) -> str:
    """Format ETA in MM:SS or HH:MM:SS."""
    total = max(0, int(round(seconds)))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _safe_unlink(path: Path | None) -> None:
    if path is None:
        return
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def render_single_story(
    *,
    story: dict[str, Any],
    words: int,
    text_hash: str,
    engine: LazyVieneuEngine,
    ffmpeg_bin: str,
    ffprobe_bin: str,
    config: RenderConfig,
    synth_acc: list[float] | None = None,
) -> tuple[dict[str, Any], float]:
    """Synthesize, encode to .part, verify via ffprobe, and atomically rename to final file."""
    story_id = story["id"]
    final_filename = f"{story_id}.{config.audio_format}"
    final_path = config.out_dir / final_filename
    part_path = config.out_dir / f"{story_id}.{config.audio_format}.part"

    model, resolved_voice, sample_rate = engine.ensure_ready()

    wav_fd, wav_name = tempfile.mkstemp(prefix=f"vieneu-{story_id}-", suffix=".wav")
    os.close(wav_fd)
    wav_path = Path(wav_name)

    try:
        full_pcm, synth_seconds = synthesize_story_pcm(
            model=model,
            resolved_voice=resolved_voice,
            sample_rate=sample_rate,
            blocks=story["blocks"],
            synth_acc=synth_acc,
        )

        model.save(full_pcm, str(wav_path))
        if not wav_path.is_file() or wav_path.stat().st_size <= 0:
            raise RuntimeError("model.save() produced an empty temporary WAV file")

        _safe_unlink(part_path)
        encode_wav_to_part(
            ffmpeg_bin=ffmpeg_bin,
            wav_path=wav_path,
            part_path=part_path,
            audio_format=config.audio_format,
            bitrate=config.bitrate,
        )

        duration_s, _part_bytes = probe_and_verify_audio(
            ffprobe_bin=ffprobe_bin,
            audio_path=part_path,
            expected_format=config.audio_format,
        )

        os.replace(part_path, final_path)
        actual_bytes = final_path.stat().st_size
        if actual_bytes <= 0:
            raise RuntimeError(f"Final audio file is empty after rename: {final_path}")

        entry = {
            "id": story_id,
            "file": final_filename,
            "bytes": actual_bytes,
            "duration_s": round(duration_s, 3),
            "words": words,
            "voice": config.voice,
            "model": MODEL_ID,
            "precision": config.precision,
            "format": config.audio_format,
            "bitrate": config.bitrate,
            "text_hash": text_hash,
        }
        return entry, synth_seconds
    finally:
        _safe_unlink(wav_path)
        _safe_unlink(part_path)


@dataclass(frozen=True)
class _PlannedStory:
    story: dict[str, Any]
    words: int
    text_hash: str
    can_skip: bool
    skip_bytes: int
    skip_duration_s: float


def _plan_selected_stories(
    selected: list[dict[str, Any]],
    manifest_by_id: dict[str, dict[str, Any]],
    config: RenderConfig,
) -> list[_PlannedStory]:
    """Compute words/hash once per selected story and check resume eligibility."""
    planned: list[_PlannedStory] = []
    for story in selected:
        story_id = story["id"]
        blocks = story["blocks"]
        words = count_words(blocks)
        text_hash = compute_text_hash(blocks)
        existing = manifest_by_id.get(story_id)
        can_skip, skip_bytes, skip_duration_s = check_resume_candidate(
            existing,
            story_id=story_id,
            voice=config.voice,
            precision=config.precision,
            text_hash=text_hash,
            audio_format=config.audio_format,
            bitrate=config.bitrate,
            out_dir=config.out_dir,
        )
        planned.append(
            _PlannedStory(
                story=story,
                words=words,
                text_hash=text_hash,
                can_skip=can_skip,
                skip_bytes=skip_bytes,
                skip_duration_s=skip_duration_s,
            )
        )
    return planned


def run(argv: list[str]) -> int:
    """Main execution entrypoint returning a process exit code."""
    _configure_stdio_utf8()
    wall_start = time.perf_counter()

    try:
        config = parse_args(argv)
    except CLIError as exc:
        print(f"CLI error: {exc}", file=sys.stderr, flush=True)
        return 2

    staging_scope = _ExecutableStagingScope()
    scope_token = _ACTIVE_STAGING_SCOPE.set(staging_scope)
    try:
        try:
            node_bin = require_executable("node", "Install Node.js and ensure 'node' is on PATH.")

            try:
                config.out_dir.mkdir(parents=True, exist_ok=True)
                if not config.out_dir.is_dir():
                    raise SetupError(f"Output path is not a directory: {config.out_dir}")
            except OSError as exc:
                raise SetupError(f"Cannot create output directory {config.out_dir}: {exc}") from exc

            all_stories = load_stories_via_exporter(node_bin)
            selected = select_stories(all_stories, config)
            if not selected:
                raise SetupError(
                    f"No stories selected (weeks={config.weeks_raw!r}, limit={config.limit!r})"
                )

            manifest_path = config.out_dir / "manifest.json"
            manifest_by_id = load_manifest(manifest_path)

            planned_stories = _plan_selected_stories(selected, manifest_by_id, config)
            needs_render = any(not item.can_skip for item in planned_stories)

            ffmpeg_bin: str | None = None
            ffprobe_bin: str | None = None
            if needs_render:
                ffmpeg_bin = require_executable("ffmpeg", "Install FFmpeg and ensure 'ffmpeg' is on PATH.")
                ffprobe_bin = require_executable(
                    "ffprobe",
                    "Install FFmpeg (including ffprobe) and ensure it is on PATH.",
                )
        except SetupError as exc:
            print(f"Setup error: {exc}", file=sys.stderr, flush=True)
            return 1
        except KeyboardInterrupt:
            print("Interrupted by user (Ctrl-C).", file=sys.stderr, flush=True)
            return 130

        engine = LazyVieneuEngine(voice_id=config.voice, precision=config.precision)

        rendered_count = 0
        skipped_count = 0
        failed_count = 0
        succeeded_words = 0
        total_audio_s = 0.0
        total_bytes = 0
        rendered_synth_s = 0.0
        rendered_audio_s = 0.0
        non_skip_wall_s = 0.0
        non_skip_count = 0
        failures: list[dict[str, str]] = []
        total_selected = len(planned_stories)

        try:
            for idx, item in enumerate(planned_stories):
                story = item.story
                story_id = story["id"]
                words = item.words
                text_hash = item.text_hash
                story_t0 = time.perf_counter()
                remaining = total_selected - (idx + 1)

                if item.can_skip:
                    skipped_count += 1
                    succeeded_words += words
                    total_audio_s += item.skip_duration_s
                    total_bytes += item.skip_bytes

                    elapsed = time.perf_counter() - wall_start
                    if remaining == 0:
                        eta_s = 0.0
                    elif non_skip_count > 0:
                        eta_s = (non_skip_wall_s / non_skip_count) * remaining
                    else:
                        eta_s = (elapsed / (idx + 1)) * remaining

                    print(
                        f"[{idx + 1}/{total_selected}] status=skip id={story_id} "
                        f"words={words} synth=0.00s audio={item.skip_duration_s:.2f}s "
                        f"bytes={item.skip_bytes} eta={format_eta(eta_s)}",
                        flush=True,
                    )
                    continue

                synth_acc = [0.0]
                try:
                    if ffmpeg_bin is None or ffprobe_bin is None:
                        raise SetupError("FFmpeg/ffprobe executables were not resolved before rendering")
                    entry, synth_seconds = render_single_story(
                        story=story,
                        words=words,
                        text_hash=text_hash,
                        engine=engine,
                        ffmpeg_bin=ffmpeg_bin,
                        ffprobe_bin=ffprobe_bin,
                        config=config,
                        synth_acc=synth_acc,
                    )
                    old_entry = manifest_by_id.get(story_id)
                    manifest_by_id[story_id] = entry
                    flush_manifest(manifest_path, manifest_by_id)
                    _remove_stale_file_if_replaced(config.out_dir, old_entry, entry["file"])

                    rendered_count += 1
                    succeeded_words += words
                    total_audio_s += float(entry["duration_s"])
                    total_bytes += int(entry["bytes"])
                    rendered_synth_s += synth_seconds
                    rendered_audio_s += float(entry["duration_s"])

                    non_skip_count += 1
                    non_skip_wall_s += time.perf_counter() - story_t0
                    eta_s = (non_skip_wall_s / non_skip_count) * remaining if remaining > 0 else 0.0

                    print(
                        f"[{idx + 1}/{total_selected}] status=rendered id={story_id} "
                        f"words={words} synth={synth_seconds:.2f}s "
                        f"audio={float(entry['duration_s']):.2f}s "
                        f"bytes={int(entry['bytes'])} eta={format_eta(eta_s)}",
                        flush=True,
                    )
                except SetupError as exc:
                    print(f"Setup error: {exc}", file=sys.stderr, flush=True)
                    return 1
                except Exception as exc:
                    failed_count += 1
                    err_msg = str(exc).replace("\r", " ").replace("\n", " ").strip() or exc.__class__.__name__
                    failures.append({"id": story_id, "error": err_msg})

                    non_skip_count += 1
                    non_skip_wall_s += time.perf_counter() - story_t0
                    eta_s = (non_skip_wall_s / non_skip_count) * remaining if remaining > 0 else 0.0

                    print(
                        f"[{idx + 1}/{total_selected}] status=failed id={story_id} "
                        f"words={words} synth={synth_acc[0]:.2f}s eta={format_eta(eta_s)} error={err_msg}",
                        flush=True,
                    )
                    print(f"Error rendering {story_id}: {err_msg}", file=sys.stderr, flush=True)
        except KeyboardInterrupt:
            print("Interrupted by user (Ctrl-C).", file=sys.stderr, flush=True)
            return 130
        finally:
            engine.close()

        wall_clock_s = time.perf_counter() - wall_start
        average_rtf = (
            round(rendered_synth_s / rendered_audio_s, 4) if rendered_audio_s > 0.0 else None
        )
        succeeded_count = rendered_count + skipped_count

        if config.report_path is not None:
            report_payload = {
                "voice": config.voice,
                "model": MODEL_ID,
                "precision": config.precision,
                "format": config.audio_format,
                "bitrate": config.bitrate,
                "weeks": config.weeks_raw,
                "limit": config.limit,
                "out_dir": str(config.out_dir),
                "selected": total_selected,
                "rendered": rendered_count,
                "skipped": skipped_count,
                "failed": failed_count,
                "succeeded": succeeded_count,
                "words": succeeded_words,
                "total_audio_s": round(total_audio_s, 3),
                "total_bytes": total_bytes,
                "wall_clock_s": round(wall_clock_s, 3),
                "synth_s": round(rendered_synth_s, 3),
                "rendered_audio_s": round(rendered_audio_s, 3),
                "average_rtf": average_rtf,
                "failures": failures,
            }
            try:
                write_json_atomically(config.report_path, report_payload)
            except OSError as exc:
                print(f"Failed to write report {config.report_path}: {exc}", file=sys.stderr, flush=True)
                return 1

        return 0 if succeeded_count > 0 else 1
    finally:
        _ACTIVE_STAGING_SCOPE.reset(scope_token)
        staging_scope.cleanup()


def main() -> int:
    try:
        return run(sys.argv[1:])
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 0


if __name__ == "__main__":
    sys.exit(main())
