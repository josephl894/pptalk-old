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
<reviewer fills this in; verdict line at the bottom: APPROVED or CHANGES_REQUESTED>
