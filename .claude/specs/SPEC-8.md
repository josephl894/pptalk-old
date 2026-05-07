# SPEC-8: Batch bulk regenerate-all into a single LLM call
Author: team-lead
Status: draft
Linked PR: PR-8
Linked impl branch: feat/bulk-regen-batch
Linked test branch: test/bulk-regen-batch
Created: 2026-05-07

## User request
> issue. regenerate all slides is too slow. the slide speaker notes are being populated per slide

Clarifying round-trip (team-lead → user, 2026-05-07):

- Q1 — Surface? **A: Web UI button.** (The "Draft all narrations" / regenerate-all bulk action in the editor overview overlay.)
- Q2 — Strategy? **A: Batch into one LLM call.** Keep one Claude request that returns all narration scripts at once; do not parallelize N per-slide calls.
- Q3 — Scope? **A: Script (narration text) only.** TTS and video are not touched by this change.

## Why (problem statement)
The bulk regenerate-all flow currently enqueues one `slide_script_regen` job per slide, and the worker drains them one at a time. For a deck with N slides, the user observes N sequential round-trips to Claude — wall-clock is dominated by per-call latency, not by tokens. The desired state is a single batched Claude call that returns all in-scope slide narrations together, collapsing N round-trips into one. This is a script-only change; audio / video are unaffected.

## Acceptance criteria

1. **AC1 — One narration call for the batch.** Given a project with N unlocked, non-deleted slides where N ≥ 2, When the user triggers regenerate-all from the web UI, Then exactly ONE Claude `messages.create` call **of `call_type` `batched_slide_scripts` (or its successor — the narration-generation call)** is issued for the bulk regeneration (not N), and that call's response carries narration text for every in-scope slide in a single round-trip. **The implementation MAY make additional O(1) setup calls whose count does not scale with N (e.g. a single `deck_summary` call regardless of slide count); these are not counted by this AC.** The user's symptom — "speaker notes populated per slide" — is about the per-slide narration loop; O(1) setup calls do not reproduce that symptom and are out of scope for the count constraint.
2. **AC2 — Each slide gets its own slide-specific narration.** Given a successful batch response, When the response is applied, Then each in-scope slide's `script` column is updated to the narration that the model returned **for that specific slide_id**, with no cross-slot mis-mapping (verified with a fixture where slides arrive in non-monotonic id order).
3. **AC3 — Locked slides are excluded from the batch.** Given a slide with `script_locked = true`, When the user triggers regenerate-all, Then that slide is NOT included in the batched prompt AND its `script` value is unchanged after the call returns. (Preserves the existing draft-all rule that locked slides are skipped.)
4. **AC4 — All-or-nothing on call failure.** Given the batch Claude call fails (5xx, network error, malformed response that cannot be mapped to all in-scope slides), When the failure occurs, Then NO in-scope slide's `script` is partially overwritten in the database, AND the user-facing surface reports an error (toast / error event consistent with how single-slide regen failure is reported today).
5. **AC5 — Empty / single-slide cases stay correct.** Given the project has zero in-scope slides (all locked or empty), When regenerate-all is triggered, Then no Claude call is made and the operation succeeds with an empty result. Given exactly one in-scope slide, When regenerate-all is triggered, Then exactly one Claude call is made and that one slide's script is updated. (No off-by-one in the batching path's edge cases.)
6. **AC6 — Cost telemetry reflects the batch shape.** Given a successful bulk regenerate-all, When `usage.csv` is appended, Then the bulk regen produces exactly ONE narration-call row (the `batched_slide_scripts` row, or its successor) — not N. Any O(1) setup calls permitted by AC1 (e.g. `deck_summary`) may add their own one row each; the constraint is that narration-call rows do not scale with N. Existing single-slide regen telemetry shape is unchanged.
7. **AC7 — Realtime overlay still updates per-slide.** Given the editor overview overlay is open while the batch runs, When the batch completes and slide.script values are written, Then each in-scope slide's `updated_at` is bumped so postgres_changes fires for every updated slide (the overlay's per-slide live update behavior is preserved even though the LLM call is collapsed).

## Out of scope

- TTS regeneration. Audio is not re-rendered by this change; it remains driven by its own pipeline step / job type.
- Video re-encode.
- Single-slide regenerate (`POST /api/slides/[id]/regen`) — keeps its current one-call-per-slide shape.
- Changing the `script_locked` lock/unlock semantics for either single-slide or bulk regen.
- UI copy / button label changes ("Draft all narrations" wording stays as today).
- Voice / persona / wpm / pacing prompt changes.
- Whether the batch is implemented by collapsing N `slide_script_regen` jobs into one new job type (e.g. `project_script_regen`) vs. handling it in-route — that is an implementation decision the engineer makes; the spec only constrains the observable contract above.
- Cross-deck batching (batching across projects). Batch is scoped to a single project's regenerate-all action.
- Streaming partial results to the UI as the model writes. Single-shot response is acceptable for this spec.

## Invariants in scope

- **Locked stack — Script LLM is Claude Haiku 4.5 with prompt caching on the system prompt.** Batched call must still pass `cache_control` on the system prompt (no regression in caching wiring). Reference: `hats/engineering.md` Locked stack.
- **Haiku 4.5 prompt-cache floor is 4096 tokens.** If the system prompt is bulked up to clear the floor, the batched call must continue to benefit; if it's still under the floor today, this change does not need to fix that — it just must not regress wiring. Reference: `memory/project_haiku_cache_floor.md`.
- **Schema convention — every user-owned table has `created_at`, `updated_at`, `deleted_at`.** Slide row updates must bump `updated_at` so Realtime fires (AC7). Soft-deleted slides (`deleted_at IS NOT NULL`) are excluded from the batch in-scope set. Reference: `hats/engineering.md` Locked stack / Schema convention.
- **draft-all in-scope rule (existing API surface).** The set of slides the batch operates on matches today's `POST /api/projects/[id]/draft-all` filter: `script_locked = false AND deleted_at IS NULL`. The empty-script filter (`script IS NULL OR script = ''`) is governed by the route's existing semantics; this spec does not change which slides are in-scope, only how they are processed once selected. Reference: `hats/engineering.md` API surface.
- **Boundary behavior — 403 on samples; 404 on bad UUID.** The web entry point continues to enforce these (no regression). Reference: `hats/engineering.md` Patterns and pitfalls #5.
- **Cost telemetry shape.** `usage.csv` rows continue to be one row per Claude call; batched call therefore yields one row, not N. Reference: `pipeline/narrator/usage.py` shape (carries forward unchanged per `hats/engineering.md` Audit findings).

## Test surface

- **AC1 → integration (worker / route + mocked Anthropic client).** Trigger bulk regen for a fixture project with N ≥ 2 unlocked slides; assert `mock_anthropic.messages.create.call_count == 1`. Inspect the single call's `messages` payload and assert it contains a per-slide structure (e.g., per-slide blocks keyed by slide_id) for each in-scope slide.
- **AC2 → integration (mocked Anthropic returning a multi-slide structured response).** Use a fixture where slide ids are deliberately non-monotonic (e.g., insert slide #3 before slide #2 in the project, or shuffle ids). Assert each slide's stored `script` matches the narration returned under that slide's id key in the mock response — no off-by-one, no cross-slot leak.
- **AC3 → integration.** Fixture: 4 slides, slide #2 has `script_locked = true` and a known existing script. Trigger bulk regen with a mocked Anthropic response covering only the 3 unlocked slides. Assert: (a) the request payload to Anthropic does NOT include slide #2's content, (b) slide #2's `script` value in DB is byte-identical to its pre-call value, (c) the other three slides have their scripts updated.
- **AC4 → integration (failure modes).** Two cases: (a) mock Anthropic to raise / return 5xx; (b) mock Anthropic to return a response missing one of the requested slide_ids. In both: assert NO in-scope slide's `script` was modified in DB, and the user-facing surface (route response + any event/toast) reports an error in the same shape single-slide regen failures use.
- **AC5 → integration (edge cases).** Case 1: project with 0 in-scope slides — assert `mock_anthropic.messages.create.call_count == 0` and the operation returns successfully with empty arrays / a no-op result. Case 2: project with exactly 1 in-scope slide — assert `call_count == 1` and that slide's script is updated.
- **AC6 → integration (telemetry).** Run bulk regen for N = 5 unlocked slides with a mocked Anthropic; assert `usage.csv` gains exactly ONE row attributable to this run (filter by run id / timestamp window) with token counts equal to the single call's reported usage.
- **AC7 → integration (Realtime fires per slide).** With Supabase local running, subscribe to `slides` table changes for a fixture project; trigger bulk regen for N = 3 unlocked slides; assert N postgres_changes events fire (one per updated slide), each with the new `script` value. Alternatively, assert at the DB level that `updated_at` for each in-scope slide is bumped in the same transaction the script is written.

## Open questions (resolved before dispatch)

- (none — clarifying round-trip resolved Surface, Strategy, and Scope above; spec is ready to dispatch.)

## Post-gate clarifications (2026-05-07)

Surfaced by QA gate run #1 against PR-8 commit 34e3c35. The original AC1/AC6 wording said "exactly ONE Claude `messages.create` call" without distinguishing call types. The engineer's implementation makes one O(1) `deck_summary` call (improves narration coherence; constant cost regardless of N) plus one batched narration call. Two readings were both coherent against the original wording.

**Resolution (team-lead, spec author):** the user's symptom — "speaker notes are being populated per slide" — is about the per-slide narration loop. The deck_summary call is O(1) and does not reproduce that symptom. AC1 and AC6 amended above to constrain narration-call count (not total call count), and to explicitly permit O(1) setup calls that do not scale with N. Implementation as shipped on `feat/bulk-regen-batch` therefore satisfies the amended spec; QA re-gates with assertions filtered to narration-call rows (call_type = `batched_slide_scripts`).

This is a SPEC fix, not an impl fix — engineer's branch is unchanged.
