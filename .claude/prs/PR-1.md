# PR-1: Batched narration in a single Haiku call
Author: eng-1
Branch: feat/batched-narration
Status: open

## Why
Per-slide parallel narration in `cli.py` was the bottleneck of the script-drafting phase (~2min for 30 slides at NARRATE_CONCURRENCY=3). Each per-slide call only saw the deck summary plus its own slide, so the "continuous context" intuition wasn't actually wired up. A single batched Haiku call sees the whole deck at once, restoring real continuity and eliminating per-slide round-trip stalls.

## What changed
- `pipeline/narrator/script.py` — new `generate_all_scripts(slides, png_paths, deck_summary) -> dict[int, str]`. Builds one user message with all images interleaved with title/body text. New `BATCH_SYSTEM_PROMPT` extends `SYSTEM_PROMPT` with delimiter rules. Output is split on `<<<SLIDE N>>>` markers and validated against expected indices. `max_tokens = max(2000, 200 * N)`, capped at Haiku 4.5's 8192 ceiling — raises a clear error if N would exceed the cap (chunked-batch fallback deferred — see open question). Logs as `call_type="batched_slide_scripts"` with no `slide_index`.
- `pipeline/narrator/cli.py` — narrate phase now calls `generate_all_scripts` once. Per-slide `slide_done` events still emit (after the batched call returns) so UI progress fills in. Removed unused `NARRATE_CONCURRENCY` constant and the `generate_slide_script` import. `ThreadPoolExecutor` import retained for the TTS phase.
- `generate_slide_script` is left intact in `script.py` because `worker.py` (single-slide regen) and `pipeline_runner.py` (worker-mode full render) still call it. Per the ticket's "Out of scope" + explicit `cli.py:112-133` scope, I did not touch the worker path. Flag for team-lead if you want a follow-up to migrate `pipeline_runner.generate_scripts` too.

## Test plan
- [x] `.claude/ci/run.sh` exits 0
- [x] manual smoke: ran `generate_all_scripts` against the 40-slide `introduction-to-prevention-effectiveness.pptx` (cached PNGs from a prior render). Wall-clock for the narrate phase: **51.04s** (1.28s/slide), vs prior ~2min at NARRATE_CONCURRENCY=3 on a 30-slide deck. All 40 narrations returned with matching indices. Spot-checked slides 1, 2, 10, 20, 40 — quality on par with prior per-slide output, and continuity is visibly improved (e.g. slide 2 enumerates "First… Second… Third…" referring to the rest of the deck, which the per-slide version couldn't have produced). `usage.csv` got a single new row: `call_type=batched_slide_scripts`, `slide_index=""`, 66909 input tokens, 3464 output tokens, $0.084.
- [ ] qa regression (if requested by team-lead)

## CI run
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## Open question (flagged, not solved)
**Output-token ceiling on large decks.** Haiku 4.5's 8192 max-output cap is reached at ~40 slides under the 200-tokens/slide budget (`max(2000, 200*N) > 8192` when `N > 40`). All but the smallest sample deck is above this — `samples/introduction-to-public-health-laboratories.pptx` is 45 slides, the largest (`introduction-to-epidemiology.pptx`) is 61. The current code raises a clear error in that case rather than producing partial output. Proposed fallback when we need it: chunked-batch (e.g., split into runs of ≤30 slides, prepend a "you previously narrated slides 1-30 with this last sentence: …" preface to subsequent batches). Not needed for the demo path; deferring per ticket guidance.

## Reviews

### reviewer @ 2026-05-06T17:05:00Z
- `pipeline/narrator/cli.py:125` — `scripts = [scripts_by_idx[s.index] for s in slides]` is now unused (the TTS phase keys off `scripts_by_idx[slide.index]` directly at line 141). Pre-existing on `main`, but worth deleting in a follow-up since it survived the rewrite. Non-blocking.
- `pipeline/narrator/cli.py:115-124` — `slide_done` events now fire in a tight burst after the single batched call returns rather than streaming as each slide finishes. Functionally fine for the CLI debug path; flag if/when a future ticket migrates the worker to the batched call (worker emits per-slide DB updates that drive Realtime — bursting them all at once would change the perceived progress UX in the editor).
- `pipeline/narrator/script.py:160-166` — clean fail-fast with explicit message when `max(2000, 200*N) > 8192` (i.e. N > 40). Properly addresses the foot-gun concern; no risk of silent truncation.
- `pipeline/narrator/script.py:192-220` — `_parse_batched_response` validates missing indices and errors clearly, but does not flag *extra* (unexpected) indices in the response. If the model invents `<<<SLIDE 99>>>` for a 40-slide deck it lands silently in the dict. Low risk because callers index by expected slide, but a `set(out) - set(expected_indices)` warning would be a cheap add. Non-blocking.
- `pipeline/narrator/script.py:172-178` — `BATCH_SYSTEM_PROMPT` keeps the `cache_control: ephemeral` marker, but per `memory/project_haiku_cache_floor.md` the 4096-token Haiku 4.5 cache floor still applies; the prompt is far below that, so the marker no-ops silently. Same posture as the per-slide path — not a regression. Worth noting that the projected cache savings stay dormant until the system prompt bulks up.
- `.claude/prs/PR-1.md:16` — the wall-clock figures ("51.04s", "~2min") are observational benchmarks of the change, not effort/time estimates for scoping. Within the spirit of the no-time-estimates rule.
- Worker / pipeline_runner left untouched — confirmed: `pipeline/narrator/worker.py:420` still calls `pipeline_runner.generate_scripts` (per-slide, parallel x3), so the demo critical path (project-driven render via `render_jobs`) does NOT benefit from this batched call. The CLI is local-debug only per `SCOPE-DEMO.md`. Reasonable scope decision for this PR. Flagging for team-lead that a follow-up ticket to migrate `pipeline_runner.generate_scripts` (with a chunked-batch fallback for >40-slide decks) is the logical next step if the speedup matters for the demo flow.
- `>40-slide` ceiling: at the current `200 * N` budget, `samples/introduction-to-public-health-laboratories.pptx` (45) and `introduction-to-epidemiology.pptx` (61) raise on the CLI path. Demo path (worker) is unaffected. PR's "Open question" section captures this clearly. Non-blocking.
- `log_anthropic` — new path logs `call_type="batched_slide_scripts"` with no `slide_index` (lands as empty string in CSV, NULL in DB via `_maybe_int`). Distinguishable from the per-slide `"slide_script"` rows. ✓
- CI: `.claude/ci/run.sh` exits 0 on the branch (re-run by reviewer).
- Locked-rules sweep clean — no `/api/render/route.ts` extension, no design-token / copy-lock / schema / auth / aspect-ratio touch, no `npm run build` introduction, no SQLite/Prisma/Redis additions. Diff is pipeline-Python only.

**Verdict: APPROVED**

## QA

### qa @ 2026-05-07T00:18:00Z

**Verdict: PASS**

Smoke ran from an isolated worktree (`/tmp/pptalk-pr1`) on commit `88ea3b8` to neutralize the branch-swap race we hit on the first attempt (see "incident" note below).

- Python import smoke (worktree): `from narrator import cli, parse, parse_pdf, render, render_pdf, script, tts, video, usage, db, queries, storage, pipeline_runner, worker` → `imports OK`. (TS type-check skipped — diff is pipeline-Python only and reviewer already passed CI on this commit; copying `web/node_modules` into the worktree just to re-prove TS-OK on an untouched surface is wasted I/O.)
- 40-slide render `samples/introduction-to-prevention-effectiveness.pptx → /tmp/pptalk-pr1/out/qa-pr1.mp4`:
  - MP4 produced: `1440x1080`, `h264 + aac`, `duration=823.24s`, `46036788 bytes`. Plays.
  - Narrate phase wall-clock: **42.68s** for 40 slides (single batched call). For comparison: prior per-slide × NARRATE_CONCURRENCY=3 baseline reported ~2 min for 30 slides on `main`. Speedup confirmed.
  - CLI banner: `Generating narration (batched, single call)` ✓
  - All 40 `slide_done` narrate events emit in strict sequential order (1, 2, …, 40), as expected when events fire after a single batched call returns. Compare TTS phase events on the same run, which arrive in completion order (4, 7, 6, 3, 1, 8, …) — confirms the narrate burst is post-batched-call, not parallel-per-slide.
  - Continuity is visible: slide 4 says "Now, let's start with Topic 1," slide 7 says "We're now on Topic 2," slide 18 says "Now, let's address Topic 4." The model can only produce these transitions because it sees the full deck — confirms the "continuous context" intuition is now actually wired up.
- Telemetry (`pipeline/usage.csv` in worktree, fresh file for this run):
  - Exactly **1** row with `call_type=batched_slide_scripts`: 66902 input tokens, 2680 output tokens, $0.080302, duration 42.653s, empty `slide_index`. ✓
  - **0** rows with `call_type=slide_script` for `run_id=50f82bda-720a-474b-aaf4-f4d1a821cd65`. ✓
  - `runs.csv`: `narrate_seconds=42.683`, `num_slides=40`, `total_cost_usd=0.277322`. Total wall-clock 106.097s.
- >40-slide pre-flight error path verified by dry call (no token spend per team-lead's guidance — recycled the 40 PNGs from the prior render's work dir to fake 41 slides and called `generate_all_scripts` directly):
  - Raises `RuntimeError: Batched narration would exceed Haiku 4.5 output ceiling (8192 tokens) for 41 slides; chunked-batch fallback not yet implemented.` ✓
  - Verified via `grep -c batched_slide_scripts usage.csv` before/after = 1 → 1 (no API call made). Pre-flight check fires before `_client.messages.create()`. ✓
- CSV writer regression check: `slide_index` lands as empty string for the batched row, distinguishable from per-slide rows. ✓
- Non-blocking observations from this smoke (do not block merge):
  - The reviewer's note about the unused `scripts = [scripts_by_idx[s.index] for s in slides]` line in `cli.py:125` is still present; cosmetic.
  - The `cache_control: ephemeral` marker on `BATCH_SYSTEM_PROMPT` no-ops silently (prompt is well below the 4096-token Haiku 4.5 cache floor — see `memory/project_haiku_cache_floor.md`). Same posture as per-slide path; not a regression.
  - Worker / `pipeline_runner.generate_scripts` is untouched, so the demo critical path (project-driven render via `render_jobs`) does NOT benefit from this batched call yet. Already tracked as task #3.

**Incident note (process, not product).** First smoke attempt against the live working tree was invalidated by a branch swap mid-CLI-startup at 17:06:02 PDT (working tree flipped to `fix/voice-overlay` between my `git checkout feat/batched-narration` and the `narrator render` Python process loading `cli.py`). 38 `slide_script` rows under run_id `c914b56f...` were the smoking gun. Re-ran in `/tmp/pptalk-pr1` worktree per team-lead's guidance, which pins the working tree regardless of any other agent's checkouts. Standardizing per-agent worktrees is now task #7.
