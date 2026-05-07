"""DB-driven worker shell.

Polls `render_jobs` (FOR UPDATE SKIP LOCKED), downloads sources from Supabase
Storage, calls into `pipeline_runner`, uploads artifacts back, and updates the
DB. Owns all I/O orchestration; `pipeline_runner` is pure.

Job kinds (see PLAN-DEMO Phase 1C spec for payload shape and behavior):
    parse_only            - parse + rasterize + upload PNGs + populate slides
    full_render           - end-to-end (re-parses if slides empty), produces MP4
    slide_script_regen    - regenerate one slide's script
    project_script_regen  - bulk regen N slides via ONE batched Claude call
    slide_tts             - synthesize one slide's audio
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from PIL import Image
from uuid_extensions import uuid7

from . import pipeline_runner, queries, storage, usage
from .db import connection
from .parse_pdf import SourceKind


HEARTBEAT_INTERVAL_S = 30.0


def _default_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


def _video_duration(path: Path) -> float:
    """Return the duration of an MP4 in seconds via ffprobe."""
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            str(path),
        ],
    )
    return float(json.loads(out)["format"]["duration"])


def _content_type_for_source(kind: SourceKind | str) -> str:
    k = kind.value if isinstance(kind, SourceKind) else str(kind)
    if k == "pptx":
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    if k == "pdf":
        return "application/pdf"
    return "application/octet-stream"


def _source_filename(kind: SourceKind | str) -> str:
    k = kind.value if isinstance(kind, SourceKind) else str(kind)
    return f"deck.{k}"


def _log(msg: str) -> None:
    print(f"[worker {datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# DB read helpers (lookups outside transactions)
# ---------------------------------------------------------------------------

def _get_project(conn, project_id: str | UUID) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, name, source_kind, source_path,
                   aspect_w, aspect_h, num_slides, status
              FROM projects
             WHERE id = %s
            """,
            (project_id,),
        )
        return cur.fetchone()


def _get_slides(conn, project_id: str | UUID) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, project_id, idx, original_idx, title, body_text,
                   speaker_notes, png_path, script, script_locked,
                   audio_path, audio_duration_s, voice
              FROM slides
             WHERE project_id = %s
             ORDER BY idx ASC
            """,
            (project_id,),
        )
        return list(cur.fetchall())


def _get_slide(conn, slide_id: str | UUID) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, project_id, idx, original_idx, title, body_text,
                   speaker_notes, png_path, script, script_locked,
                   audio_path, audio_duration_s, voice
              FROM slides
             WHERE id = %s
            """,
            (slide_id,),
        )
        return cur.fetchone()


def _sum_run_cost(conn, run_id: str) -> float:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM usage_events WHERE run_id = %s",
            (run_id,),
        )
        row = cur.fetchone()
        return float(row["total"]) if row else 0.0


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

class Worker:
    def __init__(
        self,
        worker_id: str | None = None,
        poll_interval_s: float = 1.5,
        kinds: list[str] | None = None,
    ):
        self.worker_id = worker_id or _default_worker_id()
        self.poll_interval_s = poll_interval_s
        self.kinds = kinds  # None = all kinds
        self._shutdown = False

    # ----- lifecycle -----

    def _install_signals(self) -> None:
        def handler(signum, frame):
            _log(f"received signal {signum}; shutting down after current job")
            self._shutdown = True
        signal.signal(signal.SIGINT, handler)
        signal.signal(signal.SIGTERM, handler)

    def run(self) -> None:
        """Main loop: poll, claim, dispatch, mark done/failed.

        Exits cleanly on SIGINT/SIGTERM after any in-flight job completes.
        """
        self._install_signals()
        _log(f"starting worker_id={self.worker_id} kinds={self.kinds or 'all'} poll={self.poll_interval_s}s")
        while not self._shutdown:
            try:
                claimed = self._claim_one()
            except Exception as e:
                _log(f"claim error: {e!r}; sleeping")
                time.sleep(self.poll_interval_s)
                continue

            if claimed is None:
                time.sleep(self.poll_interval_s)
                continue

            self._run_job(claimed)
        _log("worker exited")

    def _claim_one(self) -> dict | None:
        """One claim transaction. Returns the claimed job row or None."""
        with connection() as conn:
            return queries.claim_next_job(conn, self.worker_id, self.kinds)

    def _run_job(self, job: dict) -> None:
        job_id = job["id"]
        kind = job["kind"]
        _log(f"claimed job {job_id} kind={kind} project={job.get('project_id')}")
        try:
            self._dispatch(job)
        except Exception as e:
            tb = traceback.format_exc()
            _log(f"job {job_id} failed: {e!r}\n{tb}")
            err_msg = f"{type(e).__name__}: {e}"
            try:
                with connection() as conn:
                    with conn.transaction():
                        queries.mark_job_failed(conn, job_id, err_msg[:1000])
            except Exception as e2:
                _log(f"failed to mark job failed: {e2!r}")
            return

        try:
            with connection() as conn:
                with conn.transaction():
                    queries.mark_job_done(conn, job_id)
            _log(f"job {job_id} done")
        except Exception as e:
            _log(f"failed to mark job done (job actually completed): {e!r}")

    # ----- dispatch -----

    def _dispatch(self, job: dict) -> None:
        kind = job["kind"]
        if kind == "parse_only":
            self._do_parse_only(job)
        elif kind == "full_render":
            self._do_full_render(job)
        elif kind == "slide_script_regen":
            self._do_slide_script_regen(job)
        elif kind == "project_script_regen":
            self._do_project_script_regen(job)
        elif kind == "slide_tts":
            self._do_slide_tts(job)
        else:
            raise ValueError(f"Unknown job kind: {kind}")

    # ----- handlers -----

    def _do_parse_only(self, job: dict) -> None:
        """parse + rasterize + upload PNGs + slides rows + project metadata."""
        project_id = job["project_id"]
        run_id = str(uuid7())
        with tempfile.TemporaryDirectory(prefix="pptalk_parse_") as tmpdir:
            tmp = Path(tmpdir)
            with connection() as conn:
                project = _get_project(conn, project_id)
            if project is None:
                raise RuntimeError(f"project {project_id} not found")

            user_id = project["user_id"]
            source_kind = SourceKind(project["source_kind"])
            source_path = project["source_path"]

            usage.set_db_context(project_id=str(project_id), run_id=run_id, db_enabled=True)
            try:
                self._parse_and_upload(
                    project_id=project_id,
                    user_id=user_id,
                    source_kind=source_kind,
                    source_path=source_path,
                    tmp=tmp,
                )
            finally:
                usage.set_db_context(db_enabled=False)

    def _parse_and_upload(
        self,
        *,
        project_id,
        user_id,
        source_kind: SourceKind,
        source_path: str,
        tmp: Path,
    ) -> tuple[list[dict], list[Path]]:
        """Shared parse+rasterize+upload step. Returns (slides_rows, png_local_paths).

        `slides_rows` is the freshly-read slides table for the project (after upsert).
        """
        # Download source
        local_source = tmp / _source_filename(source_kind)
        storage.download_to(source_path, local_source)
        _log(f"downloaded source -> {local_source} ({local_source.stat().st_size} bytes)")

        # Parse + rasterize
        result = pipeline_runner.parse_and_rasterize(local_source, source_kind, tmp)
        _log(f"parsed {len(result.slides)} slides; aspect {result.aspect_w}x{result.aspect_h}")

        # Upload PNGs and upsert slide rows
        slide_id_by_idx: dict[int, str] = {}
        for slide, png in zip(result.slides, result.pngs):
            key = storage.slide_png_path(user_id, project_id, slide.index)
            storage.upload_file(key, png, "image/png")
            with connection() as conn:
                with conn.transaction():
                    sid = queries.upsert_slide(
                        conn,
                        project_id=project_id,
                        idx=slide.index,
                        original_idx=slide.index,
                        title=slide.title or None,
                        body_text=slide.body or None,
                        speaker_notes=slide.speaker_notes or None,
                    )
                    queries.set_slide_png(conn, sid, key)
                    if slide.speaker_notes:
                        # When we have speaker notes, lock the script to the
                        # author's words (script generator can later fall back
                        # to body if the user clears the lock).
                        queries.set_slide_script(conn, sid, slide.speaker_notes, locked=True)
            slide_id_by_idx[slide.index] = sid

        # Update project metadata
        with connection() as conn:
            with conn.transaction():
                queries.update_project_status(
                    conn,
                    project_id,
                    status="ready",
                    num_slides=len(result.slides),
                    aspect_w=result.aspect_w,
                    aspect_h=result.aspect_h,
                )
            slides_rows = _get_slides(conn, project_id)

        _log(f"parse_only: project status=ready, num_slides={len(result.slides)}")

        # Return slide rows + local PNG paths so callers (full_render) can reuse
        # the in-memory artifacts without re-downloading.
        return slides_rows, result.pngs

    def _do_full_render(self, job: dict) -> None:
        project_id = job["project_id"]
        payload = job.get("payload") or {}
        voice = (payload.get("voice") if isinstance(payload, dict) else None) or "alloy"
        captions_requested = bool(payload.get("captions")) if isinstance(payload, dict) else False
        if captions_requested:
            # TODO(phase 4): generate per-slide-segment SRT from audio durations.
            _log("TODO: captions=true requested but SRT generation is deferred to Phase 4")

        run_id = str(uuid7())

        with tempfile.TemporaryDirectory(prefix="pptalk_render_") as tmpdir:
            tmp = Path(tmpdir)
            with connection() as conn:
                project = _get_project(conn, project_id)
                if project is None:
                    raise RuntimeError(f"project {project_id} not found")
                slides_rows = _get_slides(conn, project_id)

            user_id = project["user_id"]
            source_kind = SourceKind(project["source_kind"])

            usage.set_db_context(project_id=str(project_id), run_id=run_id, db_enabled=True)
            try:
                # If slides not yet populated, run parse+rasterize first.
                pngs_local: list[Path] = []
                if not slides_rows:
                    _log("slides empty; running implicit parse_only first")
                    slides_rows, pngs_local = self._parse_and_upload(
                        project_id=project_id,
                        user_id=user_id,
                        source_kind=source_kind,
                        source_path=project["source_path"],
                        tmp=tmp,
                    )

                # Mark project as rendering (status doc'd in schema.ts).
                with connection() as conn:
                    with conn.transaction():
                        queries.update_project_status(conn, project_id, status="rendering")

                # If we don't have local PNGs (slides already parsed earlier),
                # download them from Storage.
                slide_dir = tmp / "slides"
                slide_dir.mkdir(parents=True, exist_ok=True)
                if not pngs_local:
                    pngs_local = []
                    for s in slides_rows:
                        local_png = slide_dir / f"slide_{s['idx']:03d}.png"
                        storage.download_to(s["png_path"], local_png)
                        pngs_local.append(local_png)
                    _log(f"downloaded {len(pngs_local)} slide PNGs from storage")

                # Build per-idx Slide objects (for script generation).
                from .parse import Slide as SlideDC
                slide_objs: list[SlideDC] = []
                pngs_in_order: list[Path] = []
                for row, png in zip(slides_rows, pngs_local):
                    slide_objs.append(
                        SlideDC(
                            index=row["idx"],
                            title=row["title"] or "",
                            body=row["body_text"] or "",
                            speaker_notes=row["speaker_notes"] or "",
                        )
                    )
                    pngs_in_order.append(png)

                # Generate scripts for slides whose script_locked = false.
                summary = None
                slides_to_gen: list[SlideDC] = []
                pngs_to_gen: list[Path] = []
                row_by_idx = {r["idx"]: r for r in slides_rows}
                for s_obj, png in zip(slide_objs, pngs_in_order):
                    row = row_by_idx[s_obj.index]
                    if row.get("script_locked") and row.get("script"):
                        continue
                    if row.get("script") and not row.get("script_locked"):
                        # Already auto-generated previously; reuse.
                        continue
                    slides_to_gen.append(s_obj)
                    pngs_to_gen.append(png)

                if slides_to_gen:
                    summary = None  # let generate_scripts compute it
                    _log(f"generating scripts for {len(slides_to_gen)} slide(s)")

                    # Per-slide DB write callback
                    def _on_script_done(slide, script):
                        try:
                            sid = row_by_idx[slide.index]["id"]
                            with connection() as conn:
                                with conn.transaction():
                                    queries.set_slide_script(conn, sid, script, locked=False)
                        except Exception as e:
                            _log(f"warning: failed to persist script for slide {slide.index}: {e!r}")

                    new_scripts = pipeline_runner.generate_scripts(
                        slides_to_gen, pngs_to_gen, summary,
                        on_slide_done=_on_script_done,
                        log=_log,
                    )

                # Re-read slides (now with scripts persisted).
                with connection() as conn:
                    slides_rows = _get_slides(conn, project_id)
                row_by_idx = {r["idx"]: r for r in slides_rows}

                # Build {idx: script} from the DB so we use whatever's persisted
                # (locked OR auto-generated).
                scripts: dict[int, str] = {}
                for s_obj in slide_objs:
                    row = row_by_idx[s_obj.index]
                    if not row.get("script"):
                        raise RuntimeError(
                            f"slide {s_obj.index} has no script after generation"
                        )
                    scripts[s_obj.index] = row["script"]

                # TTS — every slide.
                _log(f"synthesizing audio for {len(slide_objs)} slide(s) voice={voice}")
                def _on_tts_done(slide, mp3_local: Path):
                    try:
                        from .video import get_audio_duration
                        dur = get_audio_duration(mp3_local)
                        sid = row_by_idx[slide.index]["id"]
                        key = storage.slide_audio_path(user_id, project_id, slide.index)
                        storage.upload_file(key, mp3_local, "audio/mpeg")
                        with connection() as conn:
                            with conn.transaction():
                                queries.set_slide_audio(conn, sid, key, dur)
                                # Persist voice override on the slide.
                                with conn.cursor() as cur:
                                    cur.execute(
                                        "UPDATE slides SET voice = %s, updated_at = now() WHERE id = %s",
                                        (voice, sid),
                                    )
                    except Exception as e:
                        _log(f"warning: failed to upload audio for slide {slide.index}: {e!r}")

                mp3_by_idx = pipeline_runner.synthesize_audio(
                    scripts, slide_objs, voice, tmp,
                    on_slide_done=_on_tts_done,
                )

                # Encode video.
                pngs_for_encode = [pngs_in_order[i] for i in range(len(slide_objs))]
                mp3s_for_encode = [mp3_by_idx[s.index] for s in slide_objs]

                render_id = str(uuid7())
                mp4_local = tmp / f"render_{render_id}.mp4"
                _log("encoding video...")
                pipeline_runner.encode_video(pngs_for_encode, mp3s_for_encode, mp4_local)

                # Upload MP4
                mp4_key = storage.render_mp4_path(user_id, project_id, render_id)
                storage.upload_file(mp4_key, mp4_local, "video/mp4")
                video_dur = _video_duration(mp4_local)
                video_bytes = mp4_local.stat().st_size

                # Sum cost from usage_events for this run
                with connection() as conn:
                    cost = _sum_run_cost(conn, run_id)

                # Insert renders row
                with connection() as conn:
                    with conn.transaction():
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
                                    render_id, project_id, mp4_key, None,
                                    False, video_dur, video_bytes, cost,
                                ),
                            )
                        queries.update_project_status(conn, project_id, status="rendered")

                _log(
                    f"full_render done: render_id={render_id} "
                    f"mp4={mp4_key} dur={video_dur:.2f}s bytes={video_bytes} cost=${cost:.6f}"
                )
            finally:
                usage.set_db_context(db_enabled=False)

    def _do_slide_script_regen(self, job: dict) -> None:
        payload = job.get("payload") or {}
        slide_id = payload.get("slide_id")
        if not slide_id:
            raise ValueError("slide_script_regen payload missing slide_id")

        run_id = str(uuid7())
        with tempfile.TemporaryDirectory(prefix="pptalk_regen_") as tmpdir:
            tmp = Path(tmpdir)
            with connection() as conn:
                slide = _get_slide(conn, slide_id)
                if slide is None:
                    raise RuntimeError(f"slide {slide_id} not found")
                project = _get_project(conn, slide["project_id"])
                if project is None:
                    raise RuntimeError(f"project {slide['project_id']} not found")
                deck_slides = _get_slides(conn, slide["project_id"])

            png_path = slide.get("png_path")
            if not png_path:
                raise RuntimeError(f"slide {slide_id} has no png_path")

            local_png = tmp / f"slide_{slide['idx']:03d}.png"
            storage.download_to(png_path, local_png)

            from .parse import Slide as SlideDC
            slide_objs_for_summary = [
                SlideDC(
                    index=s["idx"], title=s["title"] or "",
                    body=s["body_text"] or "", speaker_notes=s["speaker_notes"] or "",
                )
                for s in deck_slides
            ]
            this_slide = SlideDC(
                index=slide["idx"],
                title=slide["title"] or "",
                body=slide["body_text"] or "",
                speaker_notes=slide["speaker_notes"] or "",
            )

            usage.set_db_context(
                project_id=str(slide["project_id"]),
                slide_id=str(slide_id),
                run_id=run_id,
                db_enabled=True,
            )
            try:
                from .script import summarize_deck, generate_slide_script
                summary = summarize_deck(slide_objs_for_summary)
                script = generate_slide_script(this_slide, local_png, summary)
            finally:
                usage.set_db_context(db_enabled=False)

            with connection() as conn:
                with conn.transaction():
                    queries.set_slide_script(conn, slide_id, script, locked=False)

            _log(f"slide_script_regen done slide={slide_id}")

    def _do_project_script_regen(self, job: dict) -> None:
        """Bulk regenerate scripts for many slides via ONE batched Claude call.

        Payload: `{slide_ids: [<uuid>, ...]}` — the route picks the in-scope set
        (script_locked=false AND empty script AND deleted_at IS NULL); the worker
        re-filters defensively against `script_locked=false AND deleted_at IS NULL`
        in case a slide was locked or deleted between enqueue and run.

        Contract:
        - Exactly ONE Anthropic call for batches of <= BATCH_CHUNK_SIZE slides
          (chunked sequentially for larger projects; single call is the spec
          baseline at AC1).
        - All-or-nothing: scripts are collected in memory first; if the call
          fails or the response can't be mapped to every requested slide_id,
          NO slide's script is updated in DB.
        - Each in-scope slide's `updated_at` is bumped (one UPDATE per slide
          via `set_slide_script`) so per-slide realtime fires for the overview
          overlay's progress display.
        """
        payload = job.get("payload") or {}
        raw_ids = payload.get("slide_ids") or []
        if not isinstance(raw_ids, list):
            raise ValueError("project_script_regen payload.slide_ids must be a list")
        project_id = job["project_id"]

        run_id = str(uuid7())

        with connection() as conn:
            project = _get_project(conn, project_id)
            if project is None:
                raise RuntimeError(f"project {project_id} not found")
            deck_slides = _get_slides(conn, project_id)
            # _get_slides does not filter `deleted_at IS NULL` (it's shared with
            # full_render). Pull the live set of non-deleted slide ids for this
            # project so we can drop any soft-deleted slides from the in-scope
            # set defensively (TOCTOU between enqueue and run).
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM slides WHERE project_id = %s AND deleted_at IS NULL",
                    (project_id,),
                )
                live_ids = {str(r["id"]) for r in cur.fetchall()}

        # Build full deck SlideDC list once for the deck summary (used to give
        # the model context across the project, even when only some slides are
        # in scope for regeneration).
        from .parse import Slide as SlideDC

        # Index by string id for the requested set lookup.
        deck_by_id = {str(s["id"]): s for s in deck_slides}

        # Resolve and filter the requested set: keep only slides that exist in
        # this project, are not soft-deleted, and are not locked. AC3 requires
        # locked slides to never appear in the batched prompt; the schema's
        # soft-delete convention requires `deleted_at IS NOT NULL` rows to be
        # invisible to writers.
        requested = [str(sid) for sid in raw_ids if str(sid) in deck_by_id]
        in_scope_rows = [
            deck_by_id[sid] for sid in requested
            if sid in live_ids and not deck_by_id[sid].get("script_locked")
        ]

        if not in_scope_rows:
            # Nothing to do — empty set is success, no Claude call.
            _log(f"project_script_regen no-op (0 in-scope slides) project={project_id}")
            return

        # Order by current slide.idx so the model sees a coherent progression.
        in_scope_rows.sort(key=lambda r: r["idx"])

        # Build SlideDC objects for both the full-deck summary input and the
        # in-scope batch input. Index used by SlideDC must match the index the
        # delimiter parser will key by — we use the slide's `idx` (its current
        # 1-based-ish ordinal in the deck after any reorder; same convention
        # `full_render` uses today).
        full_deck_objs = [
            SlideDC(
                index=s["idx"],
                title=s["title"] or "",
                body=s["body_text"] or "",
                speaker_notes=s["speaker_notes"] or "",
            )
            for s in deck_slides
        ]

        with tempfile.TemporaryDirectory(prefix="pptalk_bulk_regen_") as tmpdir:
            tmp = Path(tmpdir)

            # Download PNGs for in-scope slides only.
            in_scope_objs: list[SlideDC] = []
            in_scope_pngs: list[Path] = []
            for row in in_scope_rows:
                png_path = row.get("png_path")
                if not png_path:
                    raise RuntimeError(
                        f"slide {row['id']} has no png_path; cannot regenerate"
                    )
                local_png = tmp / f"slide_{row['idx']:03d}.png"
                storage.download_to(png_path, local_png)
                in_scope_objs.append(
                    SlideDC(
                        index=row["idx"],
                        title=row["title"] or "",
                        body=row["body_text"] or "",
                        speaker_notes=row["speaker_notes"] or "",
                    )
                )
                in_scope_pngs.append(local_png)

            usage.set_db_context(
                project_id=str(project_id),
                run_id=run_id,
                db_enabled=True,
            )
            try:
                from .script import summarize_deck
                # Summary uses the full deck for context; only the in-scope
                # slides are sent as images for narration.
                summary = summarize_deck(full_deck_objs)

                # IMPORTANT: do NOT pass on_slide_done here — we want strict
                # all-or-nothing (AC4). Collect all scripts in memory; only
                # apply to DB after the batched call(s) have all returned
                # successfully and every requested index is mapped.
                scripts_by_idx = pipeline_runner.generate_scripts(
                    in_scope_objs, in_scope_pngs, summary,
                    log=_log,
                )
            finally:
                usage.set_db_context(db_enabled=False)

        # Validate: every in-scope slide must have a script in the response.
        # `generate_all_scripts` already raises on missing/extra indices, but
        # double-check at the worker boundary so a malformed result never
        # results in a partial DB write.
        missing = [r["idx"] for r in in_scope_rows if r["idx"] not in scripts_by_idx]
        if missing:
            raise RuntimeError(
                f"batched regen response missing slide indices: {missing}"
            )

        # All-or-nothing apply: single transaction, one UPDATE per slide so
        # each row's `updated_at` is bumped (realtime per-slide fan-out).
        with connection() as conn:
            with conn.transaction():
                for row in in_scope_rows:
                    queries.set_slide_script(
                        conn,
                        row["id"],
                        scripts_by_idx[row["idx"]],
                        locked=False,
                    )

        _log(
            f"project_script_regen done project={project_id} "
            f"slides_updated={len(in_scope_rows)}"
        )

    def _do_slide_tts(self, job: dict) -> None:
        payload = job.get("payload") or {}
        slide_id = payload.get("slide_id")
        voice = payload.get("voice") or "alloy"
        if not slide_id:
            raise ValueError("slide_tts payload missing slide_id")

        run_id = str(uuid7())
        with tempfile.TemporaryDirectory(prefix="pptalk_tts_") as tmpdir:
            tmp = Path(tmpdir)
            with connection() as conn:
                slide = _get_slide(conn, slide_id)
                if slide is None:
                    raise RuntimeError(f"slide {slide_id} not found")
                project = _get_project(conn, slide["project_id"])
                if project is None:
                    raise RuntimeError(f"project {slide['project_id']} not found")

            script = slide.get("script")
            if not script or not str(script).strip():
                raise RuntimeError(f"slide {slide_id} has no script; cannot synthesize")

            usage.set_db_context(
                project_id=str(slide["project_id"]),
                slide_id=str(slide_id),
                run_id=run_id,
                db_enabled=True,
            )
            try:
                from .tts import synthesize
                from .video import get_audio_duration
                mp3_local = tmp / f"slide_{slide['idx']:03d}.mp3"
                synthesize(script, mp3_local, voice=voice, slide_index=slide["idx"])
                dur = get_audio_duration(mp3_local)
                key = storage.slide_audio_path(project["user_id"], slide["project_id"], slide["idx"])
                storage.upload_file(key, mp3_local, "audio/mpeg")
            finally:
                usage.set_db_context(db_enabled=False)

            with connection() as conn:
                with conn.transaction():
                    queries.set_slide_audio(conn, slide_id, key, dur)
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE slides SET voice = %s, updated_at = now() WHERE id = %s",
                            (voice, slide_id),
                        )

            _log(f"slide_tts done slide={slide_id} dur={dur:.2f}s")
