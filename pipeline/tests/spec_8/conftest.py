"""SPEC-8 test fixtures.

Provides:
- `db_conn` — a real psycopg connection to the local Supabase Postgres.
- `make_fixture_project` — factory that inserts a project + N slides with
  controllable `idx` order and `script_locked` flags. Cleans up on teardown.
- `mock_anthropic` — patches `narrator.script._client.messages.create` and
  returns a configurable mock; the test can preset its return value or
  side_effect (e.g. raise) and assert call_count / call_args.
- `drain_worker` — runs the in-process Worker against the test DB until no
  more jobs are claimable, so tests can drive the bulk-regen path through
  the actual job-dispatch surface (impl-agnostic — works whether the impl
  collapses N `slide_script_regen` jobs into one batched call OR introduces
  a new job kind handled by the worker's `_dispatch`).
- `live_route_url` — base URL for the spec-named entry point
  (`POST /api/projects/[id]/draft-all`). Defaults to http://localhost:3001
  but can be overridden via PPTALK_TEST_BASE_URL.

The fixtures here read the existing codebase only at the level of public
shape (psycopg `connection()`, the `Worker` class). They do NOT read the
modules under test for the SPEC-8 behavior (`narrator.script`'s batch path
or any new bulk-regen code) — those are exercised through their public
interface (the mock + worker dispatch + DB end-state).
"""

from __future__ import annotations

import os
from typing import Iterator
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from uuid_extensions import uuid7

from narrator.db import close_pool, connection


# Anonymous "system" user used by sample-deck seeding; tests use a freshly
# minted user to avoid colliding with anyone else's projects.
def _new_user(conn) -> UUID:
    user_id = uuid7()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO users (id, browser_id, created_at, updated_at)
            VALUES (%s, %s, now(), now())
            """,
            (user_id, f"spec8-{user_id}"),
        )
    conn.commit()
    return user_id


def _delete_project(conn, project_id: UUID) -> None:
    """Hard-delete a fixture project + all child rows."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM render_jobs WHERE project_id = %s", (project_id,))
        cur.execute(
            "DELETE FROM usage_events WHERE project_id = %s",
            (project_id,),
        )
        cur.execute("DELETE FROM slides WHERE project_id = %s", (project_id,))
        cur.execute("DELETE FROM renders WHERE project_id = %s", (project_id,))
        cur.execute("DELETE FROM projects WHERE id = %s", (project_id,))
    conn.commit()


@pytest.fixture(scope="session")
def _session_pool_close() -> Iterator[None]:
    yield
    close_pool()


@pytest.fixture
def db_conn(_session_pool_close) -> Iterator:
    """A real psycopg connection — caller commits."""
    with connection() as conn:
        yield conn


@pytest.fixture
def make_fixture_project(db_conn):
    """Factory: create a project with N slides, return (user_id, project_id, slides).

    Each slide spec is a dict:
        {
          "idx": int,                     # 0-based; can be non-monotonic on insert
          "script": str | None,           # initial script value
          "script_locked": bool,          # default False
          "title": str,                   # default "Slide N"
        }

    Returned `slides` is a list of dicts with keys: id, idx, script, script_locked, title
    (in the order they were inserted, NOT in idx order — so tests can verify
    AC2's non-monotonic mapping).
    """
    created: list[tuple[object, UUID]] = []  # (conn-for-cleanup-discovery, project_id)

    def _make(slide_specs: list[dict], *, name: str = "spec8-fixture") -> dict:
        user_id = _new_user(db_conn)
        project_id = uuid7()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO projects (
                  id, user_id, name, source_kind, source_path,
                  aspect_w, aspect_h, num_slides, status,
                  created_at, updated_at
                ) VALUES (%s, %s, %s, 'pptx', %s, 16, 9, %s, 'editing', now(), now())
                """,
                (project_id, user_id, name, f"{user_id}/{project_id}/source/deck.pptx",
                 len(slide_specs)),
            )

            inserted_slides = []
            for spec in slide_specs:
                slide_id = uuid7()
                idx = spec["idx"]
                title = spec.get("title", f"Slide {idx}")
                script = spec.get("script")
                script_locked = spec.get("script_locked", False)
                cur.execute(
                    """
                    INSERT INTO slides (
                      id, project_id, idx, original_idx, title, body_text,
                      speaker_notes, png_path, script, script_locked,
                      created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                              now(), now())
                    """,
                    (slide_id, project_id, idx, idx, title,
                     f"Body for slide {idx}",
                     None, f"{user_id}/{project_id}/slides/{idx:03d}.png",
                     script, script_locked),
                )
                inserted_slides.append({
                    "id": slide_id,
                    "idx": idx,
                    "title": title,
                    "script": script,
                    "script_locked": script_locked,
                })
        db_conn.commit()
        created.append(project_id)
        return {
            "user_id": user_id,
            "project_id": project_id,
            "slides": inserted_slides,
        }

    yield _make

    # Teardown: hard-delete the fixture data. Use a fresh connection because
    # db_conn may be in a failed transaction state.
    with connection() as cleanup_conn:
        for project_id in created:
            try:
                _delete_project(cleanup_conn, project_id)
            except Exception:
                cleanup_conn.rollback()


@pytest.fixture
def mock_anthropic():
    """Patch `narrator.script._client.messages.create` with a MagicMock.

    The mock starts with no return value configured; tests must set
    `mock_anthropic.return_value = ...` (a fake response object) or
    `mock_anthropic.side_effect = ...` before triggering the bulk-regen path.

    Yields the MagicMock so tests can assert on it.
    """
    with patch("narrator.script._client") as client_mock:
        # `_client.messages.create(...)` -> returns whatever the test sets.
        # We expose the `messages.create` mock directly to the test.
        yield client_mock.messages.create


def _claim_one_in_process(worker_kinds: list[str] | None = None) -> dict | None:
    """Claim a single job using the same path as Worker._claim_one."""
    from narrator import queries

    with connection() as conn:
        return queries.claim_next_job(conn, "spec8-test-worker", worker_kinds)


def _run_job_in_process(job: dict) -> tuple[bool, str | None]:
    """Run a single job through the in-process Worker dispatch.

    Returns (ok, error_message). On success marks the job done; on failure
    marks it failed (mirroring Worker._run_job).
    """
    from narrator import queries
    from narrator.worker import Worker

    worker = Worker(worker_id="spec8-test-worker")
    try:
        worker._dispatch(job)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        with connection() as conn:
            with conn.transaction():
                queries.mark_job_failed(conn, job["id"], err[:1000])
        return False, err

    with connection() as conn:
        with conn.transaction():
            queries.mark_job_done(conn, job["id"])
    return True, None


@pytest.fixture
def drain_worker():
    """Run the in-process worker until no more jobs are claimable.

    Returns a function `drain(max_iterations=20) -> list[dict]` that returns
    the list of (job, ok, err) tuples in the order they were processed.
    Bounded so a buggy impl can't infinite-loop the test.
    """
    def _drain(max_iterations: int = 20) -> list[tuple[dict, bool, str | None]]:
        processed: list[tuple[dict, bool, str | None]] = []
        for _ in range(max_iterations):
            job = _claim_one_in_process()
            if job is None:
                break
            ok, err = _run_job_in_process(job)
            processed.append((job, ok, err))
        return processed
    return _drain


@pytest.fixture
def live_route_url() -> str:
    """Base URL for the live Next.js dev server (gate-time only).

    Skip a test that needs this when no server is reachable so unit-style
    tests can still run without the full gate stack.
    """
    return os.environ.get("PPTALK_TEST_BASE_URL", "http://localhost:3001")
