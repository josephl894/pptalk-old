"""SPEC-8 — Batch bulk regenerate-all into a single LLM call.

These tests exercise the bulk-regen path the spec names:
`POST /api/projects/[id]/draft-all` from the editor's overview overlay.

The tests drive the path in two stages so they're impl-agnostic:
  1. POST to the live route (hits the actual API surface — which job(s) the
     route enqueues is the engineer's choice).
  2. Drain the in-process worker (claims and dispatches whatever was enqueued)
     with `narrator.script._client.messages.create` mocked.

The mock is the SPEC's named "mocked Anthropic client." It lets us assert
call_count == 1 (AC1, AC5, AC6), control what the model "returns" (AC2),
verify what was sent in the prompt (AC3), and simulate failures (AC4).

Preconditions for the gate:
  - Supabase Postgres is reachable via DATABASE_URL.
  - Next.js dev server reachable at PPTALK_TEST_BASE_URL (default :3001).
  - The standalone worker subprocess is NOT running (so the test's
    in-process worker is the only claimer).
  - A `pptalk_uid` cookie value pointing at an existing user is supplied via
    PPTALK_TEST_COOKIE if the route requires anon-cookie auth. Tests use
    the fixture project's owning user and set that cookie on each request.

Each test is ONE acceptance criterion. The AC text is repeated verbatim at
the top of each test function so the spec/impl/test triangle stays visible.
"""

from __future__ import annotations

import csv
import datetime as dt
import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import requests

from narrator.db import connection


# --------------------------------------------------------------------------- #
# Helpers shared across tests
# --------------------------------------------------------------------------- #

def _build_anthropic_response(per_slide: dict[int, str]) -> MagicMock:
    """Build a fake Anthropic `messages.create` response.

    `per_slide` is `{slide_idx: narration}` keyed by the slide's 1-based deck
    index. The fake response packages all narrations in the `<<<SLIDE N>>>`
    delimited format that `narrator.script._parse_batched_response` expects.
    """
    parts = []
    for idx in sorted(per_slide.keys()):
        parts.append(f"<<<SLIDE {idx}>>>\n{per_slide[idx]}")
    text = "\n\n".join(parts)

    response = MagicMock()
    response.content = [MagicMock(text=text, type="text")]
    response.usage = MagicMock(
        input_tokens=1234,
        output_tokens=567,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
    )
    return response


def _trigger_draft_all(base_url: str, project_id, browser_id) -> requests.Response:
    """POST /api/projects/[id]/draft-all as the project's owning user.

    `browser_id` is the value of the `pptalk_uid` cookie (the route's
    `getCurrentUser` looks users up by `users.browser_id`).
    """
    url = f"{base_url}/api/projects/{project_id}/draft-all"
    cookies = {"pptalk_uid": str(browser_id)}
    return requests.post(url, cookies=cookies, timeout=15)


def _route_reachable(base_url: str) -> bool:
    try:
        r = requests.get(f"{base_url}/api/projects", timeout=2)
        return r.status_code in (200, 401, 307)
    except Exception:
        return False


def _read_slide_scripts(project_id) -> dict[str, dict]:
    """Return {idx_as_str: {"id":..., "script":..., "script_locked":..., "updated_at":...}}."""
    out = {}
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, idx, script, script_locked, updated_at, deleted_at
              FROM slides
             WHERE project_id = %s
             ORDER BY idx ASC
            """,
            (project_id,),
        )
        for row in cur.fetchall():
            out[str(row["idx"])] = {
                "id": row["id"],
                "idx": row["idx"],
                "script": row["script"],
                "script_locked": row["script_locked"],
                "updated_at": row["updated_at"],
                "deleted_at": row["deleted_at"],
            }
    return out


def _usage_csv_path() -> Path:
    """Location of usage.csv that the pipeline appends to."""
    return Path(__file__).resolve().parents[2] / "usage.csv"


def _usage_rows_after(t0: dt.datetime, project_id=None) -> list[dict]:
    """Return usage.csv rows whose timestamp >= t0 (and optionally tagged with project_id).

    `usage.py` writes CSV rows that include a timestamp column and may include
    a project_id column; we match on whichever columns are present so the
    test stays robust to schema additions.
    """
    path = _usage_csv_path()
    if not path.exists():
        return []
    rows: list[dict] = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts_raw = row.get("timestamp") or row.get("created_at")
            if not ts_raw:
                continue
            try:
                ts = dt.datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            except Exception:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=dt.timezone.utc)
            if ts < t0:
                continue
            if project_id is not None and "project_id" in row:
                if row.get("project_id") not in (str(project_id), ""):
                    continue
            rows.append(row)
    return rows


@pytest.fixture(autouse=True)
def _require_route(live_route_url):
    """Skip every test in this module unless the dev server is reachable."""
    if not _route_reachable(live_route_url):
        pytest.skip(
            f"dev server not reachable at {live_route_url}; "
            f"start `npm run dev` (port 3001) before running SPEC-8 tests"
        )


# --------------------------------------------------------------------------- #
# AC1 — One LLM call for the batch
# --------------------------------------------------------------------------- #

def test_ac1_one_llm_call_for_n_unlocked_slides(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC1: One LLM call for the batch.

    Given a project with N unlocked, non-deleted slides where N >= 2, when
    the user triggers regenerate-all from the web UI, then exactly ONE
    Claude `messages.create` call is issued for the bulk regeneration (not
    N), and that call's response carries narration text for every in-scope
    slide in a single round-trip.
    """
    fx = make_fixture_project([
        {"idx": 1, "script": None},
        {"idx": 2, "script": None},
        {"idx": 3, "script": None},
        {"idx": 4, "script": None},
        {"idx": 5, "script": None},
    ])
    project_id = fx["project_id"]

    mock_anthropic.return_value = _build_anthropic_response({
        1: "Narration for slide one.",
        2: "Narration for slide two.",
        3: "Narration for slide three.",
        4: "Narration for slide four.",
        5: "Narration for slide five.",
    })

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code == 200, f"draft-all returned {r.status_code}: {r.text}"

    drain_worker(max_iterations=10)

    assert mock_anthropic.call_count == 1, (
        f"expected exactly 1 Claude messages.create call for the batch, "
        f"got {mock_anthropic.call_count}"
    )

    after = _read_slide_scripts(project_id)
    for idx in (1, 2, 3, 4, 5):
        assert after[str(idx)]["script"], (
            f"slide idx={idx} has no script after bulk regen — "
            f"the single call must carry narration for every in-scope slide"
        )


# --------------------------------------------------------------------------- #
# AC2 — Each slide gets its own slide-specific narration (no cross-slot leak)
# --------------------------------------------------------------------------- #

def test_ac2_per_slide_mapping_with_non_monotonic_ids(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC2: Each slide gets its own slide-specific narration.

    Verify mapping is by slide identity, not insert order or list position.
    The fixture inserts slides whose UUIDs (uuid7) ARE monotonic by insert
    time but whose `idx` values are deliberately shuffled — so insert order
    != idx order. A correct impl maps narrations to slides by idx (or some
    stable per-slide key), not by list position in the request payload.
    """
    fx = make_fixture_project([
        {"idx": 3, "script": None, "title": "Topic C"},
        {"idx": 1, "script": None, "title": "Topic A"},
        {"idx": 2, "script": None, "title": "Topic B"},
    ])
    project_id = fx["project_id"]

    mock_anthropic.return_value = _build_anthropic_response({
        1: "AAA narration for topic A.",
        2: "BBB narration for topic B.",
        3: "CCC narration for topic C.",
    })

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code == 200, f"draft-all returned {r.status_code}: {r.text}"

    drain_worker(max_iterations=10)

    after = _read_slide_scripts(project_id)
    assert "AAA" in (after["1"]["script"] or ""), (
        f"slide idx=1 (Topic A) should have received AAA narration; got "
        f"{after['1']['script']!r}"
    )
    assert "BBB" in (after["2"]["script"] or ""), (
        f"slide idx=2 (Topic B) should have received BBB narration; got "
        f"{after['2']['script']!r}"
    )
    assert "CCC" in (after["3"]["script"] or ""), (
        f"slide idx=3 (Topic C) should have received CCC narration; got "
        f"{after['3']['script']!r}"
    )


# --------------------------------------------------------------------------- #
# AC3 — Locked slides are excluded from the batch
# --------------------------------------------------------------------------- #

def test_ac3_locked_slide_excluded_from_batch_and_unchanged(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC3: Locked slides are excluded from the batch.

    The locked slide (idx=2) must NOT be present in the prompt sent to
    Anthropic AND its `script` value must be byte-identical before and after
    the call.
    """
    LOCKED_BODY = "DO NOT TOUCH — user-curated narration."
    fx = make_fixture_project([
        {"idx": 1, "script": None},
        {"idx": 2, "script": LOCKED_BODY, "script_locked": True},
        {"idx": 3, "script": None},
        {"idx": 4, "script": None},
    ])
    project_id = fx["project_id"]

    # Mock returns narration for ONLY the unlocked slides. If the impl tries
    # to send the locked slide and parses by idx, the parser will see
    # missing idx=2 and either succeed (impl correctly excluded) or fail.
    mock_anthropic.return_value = _build_anthropic_response({
        1: "Narration for slide one.",
        3: "Narration for slide three.",
        4: "Narration for slide four.",
    })

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code == 200, f"draft-all returned {r.status_code}: {r.text}"

    drain_worker(max_iterations=10)

    # (a) Exactly one call.
    assert mock_anthropic.call_count == 1, (
        f"expected 1 Claude call, got {mock_anthropic.call_count}"
    )

    # (b) The request payload to Anthropic does NOT include slide #2's
    #     content. We probe by stringifying the call args; the prompt
    #     references slide indices via their `Slide N` headers and locked
    #     slide #2 should not appear.
    call_args_blob = repr(mock_anthropic.call_args)
    # Locked slide's body text must not be in the prompt.
    assert LOCKED_BODY not in call_args_blob, (
        "locked slide's existing script leaked into the batch prompt"
    )
    # Locked slide's title-coded body should not be present either.
    assert "Body for slide 2" not in call_args_blob, (
        "locked slide (idx=2) body was included in the batch prompt"
    )

    # (c) Locked slide's script unchanged; others updated.
    after = _read_slide_scripts(project_id)
    assert after["2"]["script"] == LOCKED_BODY, (
        f"locked slide idx=2 script was modified: {after['2']['script']!r}"
    )
    assert after["2"]["script_locked"] is True, "locked flag should remain True"
    for idx in (1, 3, 4):
        assert after[str(idx)]["script"], f"unlocked slide idx={idx} not updated"


# --------------------------------------------------------------------------- #
# AC4 — All-or-nothing on call failure
# --------------------------------------------------------------------------- #

def test_ac4_all_or_nothing_on_anthropic_5xx(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC4 (case a): batch Claude call raises → no slide partially overwritten.

    None of the in-scope slides' `script` values must change. The bulk-regen
    surface must report an error in the same shape single-slide regen
    failures use today (job marked failed in DB).
    """
    fx = make_fixture_project([
        {"idx": 1, "script": None},
        {"idx": 2, "script": None},
        {"idx": 3, "script": None},
    ])
    project_id = fx["project_id"]

    # Snapshot the pre-call state.
    before = _read_slide_scripts(project_id)

    # Simulate Anthropic returning a 5xx by raising an exception.
    mock_anthropic.side_effect = RuntimeError("simulated anthropic 5xx")

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    # Route response itself may be 200 (jobs enqueued) or 5xx (sync impl);
    # the spec only constrains the post-state.
    assert r.status_code in (200, 500, 502, 503), r.status_code

    drained = drain_worker(max_iterations=10)

    # No slide's script value was overwritten.
    after = _read_slide_scripts(project_id)
    for idx in ("1", "2", "3"):
        assert after[idx]["script"] == before[idx]["script"], (
            f"slide idx={idx} script was modified despite call failure: "
            f"before={before[idx]['script']!r} after={after[idx]['script']!r}"
        )

    # User-facing surface reports an error — at least one job ended in the
    # `failed` status (mirroring single-slide regen failure semantics).
    failed_or_route_error = any(not ok for (_job, ok, _err) in drained) or r.status_code >= 500
    assert failed_or_route_error, (
        "expected the bulk-regen surface to surface an error "
        "(failed job OR 5xx route response) on Anthropic 5xx; "
        "neither happened — silent failure is not allowed"
    )


def test_ac4_all_or_nothing_on_malformed_response(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC4 (case b): response missing one requested slide id → no partial write.

    If the model returns narration for only 2 of 3 in-scope slides, the
    impl must NOT write the partial successes; either all in-scope slides
    are updated or none are.
    """
    fx = make_fixture_project([
        {"idx": 1, "script": None},
        {"idx": 2, "script": None},
        {"idx": 3, "script": None},
    ])
    project_id = fx["project_id"]

    before = _read_slide_scripts(project_id)

    # Response only covers idx 1 and 3 — idx 2 is missing.
    mock_anthropic.return_value = _build_anthropic_response({
        1: "Narration for slide one.",
        3: "Narration for slide three.",
    })

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code in (200, 500, 502, 503), r.status_code

    drain_worker(max_iterations=10)

    after = _read_slide_scripts(project_id)
    for idx in ("1", "2", "3"):
        assert after[idx]["script"] == before[idx]["script"], (
            f"slide idx={idx} was partially overwritten despite malformed batch "
            f"response: before={before[idx]['script']!r} after={after[idx]['script']!r}"
        )


# --------------------------------------------------------------------------- #
# AC5 — Empty / single-slide cases
# --------------------------------------------------------------------------- #

def test_ac5_zero_in_scope_slides_makes_no_call(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC5 case 1: 0 in-scope slides → 0 Claude calls.

    A project where all slides are locked has nothing to regenerate. The
    impl must short-circuit and not call Anthropic at all.
    """
    fx = make_fixture_project([
        {"idx": 1, "script": "L1", "script_locked": True},
        {"idx": 2, "script": "L2", "script_locked": True},
    ])
    project_id = fx["project_id"]

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code == 200, f"draft-all returned {r.status_code}: {r.text}"

    drain_worker(max_iterations=10)

    assert mock_anthropic.call_count == 0, (
        f"expected 0 Claude calls when no slides are in-scope; "
        f"got {mock_anthropic.call_count}"
    )

    # Locked slides untouched.
    after = _read_slide_scripts(project_id)
    assert after["1"]["script"] == "L1"
    assert after["2"]["script"] == "L2"


def test_ac5_single_in_scope_slide_makes_one_call(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC5 case 2: exactly 1 in-scope slide → exactly 1 Claude call.

    Verifies the batching path doesn't off-by-one on N=1 and that the
    single slide's script is updated.
    """
    fx = make_fixture_project([
        {"idx": 1, "script": "L1", "script_locked": True},
        {"idx": 2, "script": None},
        {"idx": 3, "script": "L3", "script_locked": True},
    ])
    project_id = fx["project_id"]

    mock_anthropic.return_value = _build_anthropic_response({
        2: "Narration for the only unlocked slide.",
    })

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code == 200, f"draft-all returned {r.status_code}: {r.text}"

    drain_worker(max_iterations=10)

    assert mock_anthropic.call_count == 1, (
        f"expected exactly 1 Claude call for N=1 in-scope slide; "
        f"got {mock_anthropic.call_count}"
    )

    after = _read_slide_scripts(project_id)
    assert after["2"]["script"] and "Narration for the only unlocked slide." in after["2"]["script"]
    # Locked siblings unchanged.
    assert after["1"]["script"] == "L1"
    assert after["3"]["script"] == "L3"


# --------------------------------------------------------------------------- #
# AC6 — Cost telemetry reflects the batch shape
# --------------------------------------------------------------------------- #

def test_ac6_usage_csv_one_row_per_batch(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC6: usage.csv gains exactly ONE row attributable to a bulk regen.

    Pre-existing rows are ignored; we only inspect rows written between the
    test's start time and end time.
    """
    fx = make_fixture_project([
        {"idx": 1, "script": None},
        {"idx": 2, "script": None},
        {"idx": 3, "script": None},
        {"idx": 4, "script": None},
        {"idx": 5, "script": None},
    ])
    project_id = fx["project_id"]

    mock_anthropic.return_value = _build_anthropic_response({
        1: "n1", 2: "n2", 3: "n3", 4: "n4", 5: "n5",
    })

    t0 = dt.datetime.now(tz=dt.timezone.utc)
    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code == 200, r.text

    drain_worker(max_iterations=10)
    t1 = dt.datetime.now(tz=dt.timezone.utc)

    # Filter usage.csv for rows in [t0, t1] tagged with this project (or
    # untagged — usage.csv may not always carry project_id).
    rows_in_window = _usage_rows_after(t0)
    # Restrict to anthropic / Claude-shaped rows when the row carries
    # provider info.
    anthropic_rows = [
        row for row in rows_in_window
        if (row.get("provider") or "").lower() in ("anthropic", "claude", "")
    ]

    # The single batched call should have produced exactly ONE row.
    assert len(anthropic_rows) == 1, (
        f"expected exactly 1 anthropic usage.csv row from the batch run, "
        f"got {len(anthropic_rows)} rows in window [{t0}, {t1}]: "
        f"{anthropic_rows}"
    )


# --------------------------------------------------------------------------- #
# AC7 — Realtime overlay still updates per-slide
# --------------------------------------------------------------------------- #

def test_ac7_per_slide_updated_at_bumped(
    make_fixture_project, mock_anthropic, drain_worker, live_route_url,
):
    """AC7: each in-scope slide's `updated_at` is bumped.

    The overlay's per-slide live update is driven by Supabase Realtime which
    fires on any column change in the row. Bumping `updated_at` (the schema
    convention) is the load-bearing observable. We check at the DB level to
    avoid coupling to a specific Realtime client.
    """
    fx = make_fixture_project([
        {"idx": 1, "script": None},
        {"idx": 2, "script": None},
        {"idx": 3, "script": None},
    ])
    project_id = fx["project_id"]

    before = _read_slide_scripts(project_id)
    pre_updated = {idx: row["updated_at"] for idx, row in before.items()}

    mock_anthropic.return_value = _build_anthropic_response({
        1: "n1", 2: "n2", 3: "n3",
    })

    r = _trigger_draft_all(live_route_url, project_id, fx["browser_id"])
    assert r.status_code == 200, r.text

    drain_worker(max_iterations=10)

    after = _read_slide_scripts(project_id)
    for idx in ("1", "2", "3"):
        assert after[idx]["updated_at"] > pre_updated[idx], (
            f"slide idx={idx} updated_at was not bumped: "
            f"before={pre_updated[idx]} after={after[idx]['updated_at']}"
        )
