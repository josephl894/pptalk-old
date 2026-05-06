"""Thin SQL helpers for the worker.

Conventions
-----------
- Every function takes `conn` (a psycopg.Connection) as the first argument.
- Functions do NOT commit — the caller controls the transaction boundary.
  EXCEPTION: `claim_next_job` MUST commit before returning, because it is
  the lock-and-claim atom. See its docstring.
- Parameterized SQL only — never %-format or f-string user values into SQL.
- IDs are UUIDv7 (sortable, distributed-safe). Generated client-side via
  `uuid_extensions.uuid7()` which returns a `uuid.UUID` instance that
  psycopg accepts directly as a uuid bind value.
- Schema matches `web/lib/db/schema.ts` (Drizzle) — do not drift.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
from uuid_extensions import uuid7


# ---------------------------------------------------------------------------
# Job queue
# ---------------------------------------------------------------------------

def claim_next_job(
    conn: psycopg.Connection,
    worker_id: str,
    kinds: list[str] | None = None,
) -> dict | None:
    """Atomically claim the highest-priority queued job.

    Uses `FOR UPDATE SKIP LOCKED` so concurrent workers cannot grab the same
    row. On success, sets status='running', claimed_by=worker_id,
    claimed_at=now(), started_at=now(), attempts = attempts + 1.

    THIS FUNCTION COMMITS BEFORE RETURNING. The lock-and-claim must be
    durable; otherwise a crashing worker could leave the job stuck.

    Args:
        conn: psycopg connection (autocommit must be False; we commit here).
        worker_id: free-form string identifying the worker (e.g. host+pid).
        kinds: optional whitelist of `kind` values; if None, any kind is
            eligible.

    Returns:
        The claimed job row as a dict, or None if no job was available.
    """
    params: list[Any] = []
    where = ["status = 'queued'", "attempts < max_attempts"]
    if kinds:
        where.append("kind = ANY(%s)")
        params.append(list(kinds))

    select_sql = f"""
        SELECT id
        FROM render_jobs
        WHERE {' AND '.join(where)}
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    """

    with conn.cursor() as cur:
        cur.execute(select_sql, params)
        row = cur.fetchone()
        if row is None:
            conn.commit()
            return None

        job_id = row["id"]
        cur.execute(
            """
            UPDATE render_jobs
               SET status = 'running',
                   claimed_by = %s,
                   claimed_at = now(),
                   started_at = now(),
                   attempts = attempts + 1,
                   updated_at = now()
             WHERE id = %s
             RETURNING *
            """,
            (worker_id, job_id),
        )
        claimed = cur.fetchone()

    conn.commit()
    return claimed


def mark_job_done(conn: psycopg.Connection, job_id: str | UUID) -> None:
    """Mark a job as successfully completed."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE render_jobs
               SET status = 'done',
                   completed_at = now(),
                   updated_at = now()
             WHERE id = %s
            """,
            (job_id,),
        )


def mark_job_failed(
    conn: psycopg.Connection,
    job_id: str | UUID,
    error: str,
) -> None:
    """Mark a job as failed; requeue if attempts remain.

    If `attempts < max_attempts`, the job is requeued (status='queued',
    claimed_by/claimed_at cleared) so another worker can pick it up.
    Otherwise the job is terminally failed.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE render_jobs
               SET status = CASE
                       WHEN attempts < max_attempts THEN 'queued'
                       ELSE 'failed'
                   END,
                   completed_at = CASE
                       WHEN attempts < max_attempts THEN NULL
                       ELSE now()
                   END,
                   claimed_by = CASE
                       WHEN attempts < max_attempts THEN NULL
                       ELSE claimed_by
                   END,
                   claimed_at = CASE
                       WHEN attempts < max_attempts THEN NULL
                       ELSE claimed_at
                   END,
                   error = %s,
                   updated_at = now()
             WHERE id = %s
            """,
            (error, job_id),
        )


def heartbeat_job(conn: psycopg.Connection, job_id: str | UUID) -> None:
    """Touch updated_at on a running job to signal liveness."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE render_jobs SET updated_at = now() WHERE id = %s",
            (job_id,),
        )


# ---------------------------------------------------------------------------
# Project / slide writes
# ---------------------------------------------------------------------------

def update_project_status(
    conn: psycopg.Connection,
    project_id: str | UUID,
    status: str,
    num_slides: int | None = None,
    aspect_w: int | None = None,
    aspect_h: int | None = None,
) -> None:
    """Update project status and optional metadata. Only sets fields that
    are not None (besides `status`, which is always set)."""
    sets = ["status = %s", "updated_at = now()"]
    params: list[Any] = [status]
    if num_slides is not None:
        sets.append("num_slides = %s")
        params.append(num_slides)
    if aspect_w is not None:
        sets.append("aspect_w = %s")
        params.append(aspect_w)
    if aspect_h is not None:
        sets.append("aspect_h = %s")
        params.append(aspect_h)

    params.append(project_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE projects SET {', '.join(sets)} WHERE id = %s",
            params,
        )


def upsert_slide(
    conn: psycopg.Connection,
    *,
    slide_id: str | UUID | None = None,
    project_id: str | UUID,
    idx: int,
    original_idx: int,
    title: str | None,
    body_text: str | None,
    speaker_notes: str | None,
) -> str:
    """Insert or update a slide row (keyed on project_id + idx).

    Returns the slide_id as a string. Generates a UUIDv7 if `slide_id` is None.
    """
    sid = slide_id if slide_id is not None else uuid7()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO slides (
                id, project_id, idx, original_idx,
                title, body_text, speaker_notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id, idx) DO UPDATE SET
                original_idx = EXCLUDED.original_idx,
                title = EXCLUDED.title,
                body_text = EXCLUDED.body_text,
                speaker_notes = EXCLUDED.speaker_notes,
                updated_at = now()
            RETURNING id
            """,
            (sid, project_id, idx, original_idx, title, body_text, speaker_notes),
        )
        row = cur.fetchone()
    return str(row["id"])


def set_slide_png(
    conn: psycopg.Connection,
    slide_id: str | UUID,
    png_path: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE slides
               SET png_path = %s, updated_at = now()
             WHERE id = %s
            """,
            (png_path, slide_id),
        )


def set_slide_script(
    conn: psycopg.Connection,
    slide_id: str | UUID,
    script: str,
    locked: bool = False,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE slides
               SET script = %s, script_locked = %s, updated_at = now()
             WHERE id = %s
            """,
            (script, locked, slide_id),
        )


def set_slide_audio(
    conn: psycopg.Connection,
    slide_id: str | UUID,
    audio_path: str,
    duration_s: float,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE slides
               SET audio_path = %s,
                   audio_duration_s = %s,
                   updated_at = now()
             WHERE id = %s
            """,
            (audio_path, duration_s, slide_id),
        )


# ---------------------------------------------------------------------------
# Render outputs
# ---------------------------------------------------------------------------

def insert_render(
    conn: psycopg.Connection,
    *,
    project_id: str | UUID,
    mp4_path: str,
    srt_path: str | None,
    captions: bool,
    video_duration_s: float | None,
    video_bytes: int | None,
    cost_usd: float | None,
) -> str:
    """Insert a finished render row. Returns the render_id as a string."""
    rid = uuid7()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO renders (
                id, project_id, mp4_path, srt_path,
                captions, video_duration_s, video_bytes, cost_usd
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                rid, project_id, mp4_path, srt_path,
                captions, video_duration_s, video_bytes, cost_usd,
            ),
        )
        row = cur.fetchone()
    return str(row["id"])


# ---------------------------------------------------------------------------
# Usage telemetry — mirrors usage.py CSV shape
# ---------------------------------------------------------------------------

def log_usage_event(
    conn: psycopg.Connection,
    *,
    project_id: str | UUID | None,
    slide_id: str | UUID | None,
    run_id: str | None,
    provider: str,
    model: str,
    call_type: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    input_chars: int | None = None,
    output_bytes: int | None = None,
    cost_usd: float,
    duration_seconds: float | None = None,
) -> None:
    """Append a usage event row. Mirrors the CSV columns in usage.py.

    Caller controls commit. `run_id` is the legacy CSV correlation id and is
    optional; new callers can pass None.
    """
    eid = uuid7()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO usage_events (
                id, project_id, slide_id, run_id,
                provider, model, call_type,
                input_tokens, output_tokens,
                cache_creation_tokens, cache_read_tokens,
                input_chars, output_bytes,
                cost_usd, duration_seconds
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s, %s,
                %s, %s
            )
            """,
            (
                eid, project_id, slide_id, run_id,
                provider, model, call_type,
                input_tokens, output_tokens,
                cache_creation_tokens, cache_read_tokens,
                input_chars, output_bytes,
                cost_usd, duration_seconds,
            ),
        )
