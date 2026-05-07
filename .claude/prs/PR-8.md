# PR-8: Batch bulk regenerate-all into one Claude call
Author: eng-1
Branch: feat/bulk-regen-batch
Spec: SPEC-8
Status: open

## Handoff report
**Outcome:** done
**Approach:** Replaced the per-slide-job fan-out in the bulk-regen path with a single new job kind `project_script_regen`. The route enqueues exactly one job carrying the in-scope `slide_ids`; the worker calls the existing batched script primitive (`pipeline_runner.generate_scripts` → `generate_all_scripts(_chunked)`), collects all narrations in memory, then applies them in one DB transaction. Single-slide regen (`slide_script_regen`) and TTS / video paths are intentionally untouched.

## What changed
- `pipeline/narrator/worker.py` — new dispatch arm + `_do_project_script_regen` handler; updated module docstring to list the new job kind.
- `web/app/api/projects/[id]/draft-all/route.ts` — replaced N `slide_script_regen` job inserts with ONE `project_script_regen` job carrying `payload.slide_ids`; route docstring rewritten to match.
- `web/lib/db/schema.ts` — extended the `render_jobs.kind` comment list to include `'project_script_regen'`.

## Spec coverage

- **AC1 (one LLM call for the batch).** The worker handler calls `pipeline_runner.generate_scripts(in_scope_objs, in_scope_pngs, summary, log=_log)` once. That helper internally calls `generate_all_scripts_chunked`, which for ≤ `BATCH_CHUNK_SIZE` (40) slides issues exactly ONE `_client.messages.create` call (`script.py:198-209`). The single user-message content array contains an image + text block per in-scope slide, so the response carries narration text for every slide in one round-trip. (Decks > 40 slides chunk sequentially — outside the spec's "one call" baseline but still a single batched-narration shape per chunk; the spec test surface targets ≥ 2 slides under the chunk size, which is the same single-call path.)

- **AC2 (each slide gets its own slide-specific narration; no cross-slot mis-mapping).** The model is required to emit `<<<SLIDE N>>>` delimiters where `N` is the slide's `idx`. `_parse_batched_response` splits on those delimiters and validates that every requested index is present and no extra indices appear (`script.py:283-314`). The worker maps results back by index (`scripts_by_idx[row["idx"]]`) and writes per-row, so a non-monotonic id ordering in the project's slide table cannot leak narration across slides — the binding is by `idx`, not by position.

- **AC3 (locked slides excluded from the batch).** Two layers:
  1. Route filter at enqueue: `eq(slides.scriptLocked, false)` plus the empty-script and `deletedAt IS NULL` filters (route lines 51-61).
  2. Defense in the worker: re-filters supplied `slide_ids` against `script_locked=false` before assembling the batched prompt, so a slide that was locked between enqueue and run is dropped from both the model input AND the DB write set (worker handler `in_scope_rows = [... if not r.script_locked]`).
  A locked slide therefore never appears in the request payload and its `script` is never updated by this code path.

- **AC4 (all-or-nothing on call failure).** The handler intentionally does NOT pass `on_slide_done`: `pipeline_runner.generate_scripts` returns the complete `{idx: narration}` dict only after the batched call succeeds. If the call raises (5xx / network), the exception propagates; if the response is malformed or missing any requested index, `_parse_batched_response` raises before the dict is returned (and the handler also re-checks `missing` at the worker boundary). Only after that successful collection does the handler open ONE transaction and apply all `set_slide_script` updates. Any failure earlier means zero rows were touched. The worker's existing `_run_job` failure path then calls `mark_job_failed` (which requeues if attempts remain or terminally fails) — the user-facing surface (job row + realtime) reports the error in the same shape as a single-slide regen failure today.

- **AC5 (empty / single-slide cases stay correct).**
  - Zero in-scope: route returns `{job_ids: [], slide_ids: []}` with no job inserted and no Claude call (unchanged short-circuit at lines 63-65). The worker is never invoked.
  - Exactly one in-scope: route enqueues one `project_script_regen` job with a single-element `slide_ids` array; the worker calls `generate_all_scripts` with one slide, which still issues exactly one `messages.create` and returns one narration. The DB transaction performs a single `set_slide_script` UPDATE.

- **AC6 (cost telemetry reflects the batch shape).** `generate_all_scripts` calls `log_anthropic(..., call_type="batched_slide_scripts", ...)` exactly once per Claude call (`script.py:213-218`). `usage.py` writes one CSV row per `_append_row` invocation, so a single batched call → one CSV row tagged with the batched call type and the call's reported `usage` token counts. Single-slide regen continues to log `call_type="slide_script"` per its existing path; that shape is untouched.

- **AC7 (realtime overlay still updates per-slide).** The worker writes scripts via N individual `set_slide_script` UPDATEs inside one transaction (`queries.py:245-259` — sets `updated_at = now()` per row). On commit, Postgres replication emits N row-level `UPDATE` events on `slides`, so a Realtime subscriber receives one event per updated slide carrying the new `script` value. The route also bumps `updated_at` at enqueue time so the initial "drafting…" UI state has its own realtime trigger.

## Invariant defense

- **Locked stack — Claude Haiku 4.5 with prompt caching on the system prompt.** The batched call passes `cache_control: {type: "ephemeral"}` on the system prompt block (`script.py:201-207`); this PR does not change that wiring. Cache-floor caveat (`memory/project_haiku_cache_floor.md`) is unchanged and documented; this change does not regress it.
- **Haiku 4.5 prompt-cache floor (4096 tokens).** No change. The batched call uses the same `BATCH_SYSTEM_PROMPT` already in production for `full_render`; if/when that prompt is bulked above the floor, this path benefits automatically.
- **Schema convention — `created_at`, `updated_at`, `deleted_at` on user-owned tables; `updated_at` bumped on writes.** `set_slide_script` bumps `updated_at = now()`; soft-deleted slides are excluded by the route's `isNull(slides.deletedAt)` filter and (in the worker) by the same property of the project-level `_get_slides` selection (deleted slides aren't in the in-scope candidate set).
- **draft-all in-scope rule (existing API surface).** Route filter is unchanged: `script_locked = false AND deleted_at IS NULL AND (script IS NULL OR script = '')`. The shape of the response (`{job_ids, slide_ids}`) is preserved — `job_ids` is now a one-element array (the batched job) instead of N.
- **Boundary behavior — 403 on samples; 404 on bad UUID.** Route still calls `getProjectForUser` (which validates UUID via `UUID_RE`) and 404s on missing/non-owned projects, 403s on samples (`route.ts` lines 45-48). Untouched.
- **Cost telemetry shape.** `usage_events` / `usage.csv` schema is unchanged. The batched-narration call logs one row tagged `batched_slide_scripts` exactly as `full_render` does today; per-slide regen continues to log `slide_script` rows. No new column required.

## Decisions and risks

- **New job kind vs. overloading `slide_script_regen` with multi-slide payload.** Chose a new kind `project_script_regen` to keep the single-slide handler simple and the queue uniform. The spec's Out-of-scope explicitly leaves this implementation choice to the engineer.
- **Worker re-filters `slide_ids` defensively.** The route picks the in-scope set, but a slide could be locked or soft-deleted between enqueue and run. The worker drops anything that is now `script_locked=true` or absent from the deck before issuing the call, so AC3's invariant (locked slides never overwritten by this path) holds even under TOCTOU. The worker also requires every in-scope slide to have a `png_path`; missing PNG raises before the call (no partial state).
- **All-or-nothing implementation: do NOT pass `on_slide_done`.** The existing batched primitive supports per-slide partial-write callbacks (used by `full_render` so the UI fills mid-render). For bulk regen we deliberately skip that callback — collect everything in the return value first, then write in one transaction. This is what makes AC4 an iron guarantee even for chunked decks: a chunk failure at chunk 2/N rolls back chunk-1 writes too. Trade-off: chunked decks (> 40 slides) lose mid-render UI fill for the bulk-regen path. Acceptable per the spec's edge-case framing.
- **Single transaction with N UPDATEs vs. one bulk UPDATE.** I went with N `set_slide_script` calls in one transaction. Reason: each row needs a different `script` value AND we need per-row Realtime events (AC7). A `CASE WHEN … THEN …` bulk UPDATE would send only one event per row anyway, and would obscure the per-row write semantics for no measurable gain at typical deck sizes. If we ever see contention with hundreds of slides, we can revisit.
- **Risk — chunked decks (> 40 slides).** The spec's AC1 says "one call". For decks ≤ 40 slides (the existing `BATCH_CHUNK_SIZE`) this is exactly one call. Larger decks fan out into sequential chunks of ≤ 40, each its own call. The spec test surface targets `N ≥ 2` and the failure mode tests target a single batch — chunking is not exercised. Flagging for QA / reviewer in case the spec intends "exactly one call regardless of N"; if so, the fix is to raise `BATCH_CHUNK_SIZE` or extend the contract to require chunking. My read of the spec is that the *shape* is one batched call (vs. N per-slide calls), and chunking is an implementation detail of the existing batched primitive that this change inherits.
- **Risk — telemetry attribution under chunking.** When chunking does kick in, telemetry logs N_chunks rows tagged `batched_slide_scripts` (one per chunk), not literally one row per bulk regen. Within the spec's AC6 framing (`one row per Claude call`, batched call shape), this is correct. Documenting so the reviewer's read of "ONE telemetry row" against the AC text is unambiguous.

## Self-verification
- [x] `.claude/ci/run.sh` exits 0 (run from inside `/tmp/pptalk-bulk-regen-batch`)
- [x] `npm install` and `uv sync` completed inside the worktree before CI ran
- [x] Worker handler signature compiles (Python `import smoke` covers it via the CI check)
- [x] Route file passes TypeScript type-check (CI step 1)

Observed:
- TS type-check: clean (no errors).
- Python import smoke: `imports OK`.
- No DB / live-Anthropic test executed locally (this is the engineer's smoke; integration tests are qa's surface per the spec's Test surface section).

## CI run
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## QA gate
<!-- filled by qa -->

## Reviews
<!-- filled by reviewer -->

## Telemetry
<!-- filled by team-lead post-merge -->
