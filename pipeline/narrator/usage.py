import csv
import sys
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

CSV_PATH = Path(__file__).resolve().parent.parent / "usage.csv"
RUNS_CSV_PATH = Path(__file__).resolve().parent.parent / "runs.csv"

RUN_COLUMNS = [
    "timestamp_utc",
    "run_id",
    "pptx",
    "num_slides",
    "wall_clock_seconds",
    "parse_seconds",
    "rasterize_seconds",
    "summarize_seconds",
    "narrate_seconds",
    "tts_seconds",
    "segments_seconds",
    "concat_seconds",
    "encode_seconds",
    "video_duration_seconds",
    "video_bytes",
    "total_cost_usd",
]

COLUMNS = [
    "timestamp",
    "run_id",
    "pptx",
    "provider",
    "model",
    "call_type",
    "slide_index",
    "input_tokens",
    "output_tokens",
    "cache_creation_tokens",
    "cache_read_tokens",
    "input_chars",
    "output_bytes",
    "cost_usd",
    "duration_seconds",
]

ANTHROPIC_INPUT_PER_MTOK = {"claude-haiku-4-5": 1.0}
ANTHROPIC_OUTPUT_PER_MTOK = {"claude-haiku-4-5": 5.0}
OPENAI_TTS_PER_MCHAR = {
    "gpt-4o-mini-tts": 15.0,  # current default
    "tts-1-hd": 30.0,         # legacy, kept for historical CSV rows
    "tts-1": 15.0,            # legacy
}

_lock = Lock()
# `_context` carries per-run/job state used by both CSV and DB telemetry sinks.
# CSV-mode keys: run_id, pptx (set by `start_run`).
# DB-mode keys (set by `set_db_context`): project_id, slide_id, db_run_id, db_enabled.
_context: dict[str, Any] = {"run_id": "", "pptx": ""}
_run_totals: dict[str, float] = {}


def start_run(pptx_name: str) -> str:
    run_id = str(uuid4())
    _context["run_id"] = run_id
    _context["pptx"] = pptx_name
    _run_totals[run_id] = 0.0
    return run_id


def get_run_total(run_id: str) -> float:
    return _run_totals.get(run_id, 0.0)


def set_db_context(
    *,
    project_id: str | None = None,
    slide_id: str | None = None,
    run_id: str | None = None,
    db_enabled: bool = True,
) -> None:
    """Configure usage logging to also write usage_events rows.

    Worker mode calls this before invoking pipeline functions and again with
    `db_enabled=False` after. CLI one-shot mode never calls this — CSV-only.
    """
    _context["project_id"] = project_id
    _context["slide_id"] = slide_id
    _context["db_run_id"] = run_id
    _context["db_enabled"] = bool(db_enabled)


def _maybe_int(v: Any) -> int | None:
    """Convert a possibly-empty CSV value to int or None."""
    if v in (None, "", 0, "0"):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n or None


def _maybe_float(v: Any) -> float | None:
    if v in (None, ""):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f or None


def _write_usage_event_to_db(row: dict) -> None:
    """Best-effort write of a usage_events row. Never raises.

    Imports the DB modules lazily so usage.py keeps working in CLI mode
    without a DATABASE_URL configured.
    """
    try:
        from .db import connection
        from . import queries
        cost = float(row.get("cost_usd") or 0)
        with connection() as conn:
            with conn.transaction():
                queries.log_usage_event(
                    conn,
                    project_id=_context.get("project_id"),
                    slide_id=_context.get("slide_id"),
                    run_id=_context.get("db_run_id"),
                    provider=row.get("provider", ""),
                    model=row.get("model", ""),
                    call_type=row.get("call_type", ""),
                    input_tokens=_maybe_int(row.get("input_tokens")),
                    output_tokens=_maybe_int(row.get("output_tokens")),
                    cache_creation_tokens=_maybe_int(row.get("cache_creation_tokens")),
                    cache_read_tokens=_maybe_int(row.get("cache_read_tokens")),
                    input_chars=_maybe_int(row.get("input_chars")),
                    output_bytes=_maybe_int(row.get("output_bytes")),
                    cost_usd=cost,
                    duration_seconds=_maybe_float(row.get("duration_seconds")),
                )
    except Exception as e:
        # Never fail the pipeline because of telemetry.
        print(f"warning: failed to write usage_event to DB: {e}", file=sys.stderr)


def _append_row(row: dict) -> None:
    write_header = not CSV_PATH.exists()
    with _lock:
        with CSV_PATH.open("a", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=COLUMNS)
            if write_header:
                writer.writeheader()
            writer.writerow({c: row.get(c, "") for c in COLUMNS})

    rid = row.get("run_id") or ""
    cost = float(row.get("cost_usd") or 0)
    _run_totals[rid] = _run_totals.get(rid, 0.0) + cost

    if _context.get("db_enabled"):
        _write_usage_event_to_db(row)


def log_anthropic(
    *,
    model: str,
    call_type: str,
    usage,
    duration_seconds: float,
    slide_index: int | None = None,
) -> None:
    in_tok = getattr(usage, "input_tokens", 0) or 0
    out_tok = getattr(usage, "output_tokens", 0) or 0
    cache_create = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0

    cost = (
        (in_tok / 1_000_000) * ANTHROPIC_INPUT_PER_MTOK.get(model, 0)
        + (out_tok / 1_000_000) * ANTHROPIC_OUTPUT_PER_MTOK.get(model, 0)
    )

    _append_row({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": _context["run_id"],
        "pptx": _context["pptx"],
        "provider": "anthropic",
        "model": model,
        "call_type": call_type,
        "slide_index": slide_index if slide_index is not None else "",
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "cache_creation_tokens": cache_create,
        "cache_read_tokens": cache_read,
        "cost_usd": f"{cost:.6f}",
        "duration_seconds": f"{duration_seconds:.3f}",
    })


def log_run(row: dict) -> None:
    write_header = not RUNS_CSV_PATH.exists()
    with _lock:
        with RUNS_CSV_PATH.open("a", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=RUN_COLUMNS)
            if write_header:
                writer.writeheader()
            writer.writerow({c: row.get(c, "") for c in RUN_COLUMNS})


def log_openai_tts(
    *,
    model: str,
    text: str,
    output_bytes: int,
    duration_seconds: float,
    slide_index: int | None = None,
) -> None:
    chars = len(text)
    cost = (chars / 1_000_000) * OPENAI_TTS_PER_MCHAR.get(model, 0)

    _append_row({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": _context["run_id"],
        "pptx": _context["pptx"],
        "provider": "openai",
        "model": model,
        "call_type": "tts",
        "slide_index": slide_index if slide_index is not None else "",
        "input_chars": chars,
        "output_bytes": output_bytes,
        "cost_usd": f"{cost:.6f}",
        "duration_seconds": f"{duration_seconds:.3f}",
    })
