# PR-3: Chunked batched narration on the worker path
Author: eng-1
Branch: feat/batched-narration-worker
Status: open

## Why
PR-1 landed batched narration in the CLI debug path only. The actual demo flow (web upload → `render_jobs` → worker → `pipeline_runner.generate_scripts`) still ran the per-slide ThreadPoolExecutor loop, so the user-visible "~2 min for a 30-slide deck" complaint was unresolved. PR-1 also fail-fast errored on decks with N > 40 to keep the 8K Haiku output cap honest — fine for the CLI, but a real user can upload a 60-slide deck so the worker needs a chunked-batch fallback.

## What changed
- `pipeline/narrator/script.py` — new `BATCH_CHUNK_SIZE = 40` constant; `generate_all_scripts` gains an optional `previous_context` kwarg used as a transition hint between chunks; new `generate_all_scripts_chunked(slides, png_paths, deck_summary, *, chunk_size=40, on_chunk_done=None)` splits decks larger than `chunk_size` into sequential batched calls, threading the previous chunk's last narration forward and telling each chunk its absolute index range so the model emits correct `<<<SLIDE N>>>` delimiters across chunk boundaries. Found-and-fixed bug along the way: without an explicit "this batch covers indices N..M" line in the chunk intro, the model defaulted to numbering the second chunk from 1, which then failed `_parse_batched_response`.
- `pipeline/narrator/script.py` — `_parse_batched_response` now flags *extra*/unexpected indices in addition to missing ones (per PR-1 reviewer note). Also moved the regex compile to module level.
- `pipeline/narrator/pipeline_runner.py` — `generate_scripts` now calls `generate_all_scripts_chunked`. The `parallel` kwarg and the per-slide `ThreadPoolExecutor` are gone. `on_slide_done` callbacks fire after each chunk in slide-index order (not completion order), so the worker's per-slide DB writes drive Realtime events smoothly across chunks. The `NARRATE_CONCURRENCY` constant was unused outside the deleted loop and is removed.
- `pipeline/narrator/cli.py` — drop the unused `scripts = [scripts_by_idx[s.index] for s in slides]` dead-code line at the end of the narrate phase (per PR-1 reviewer note). TTS keys directly off `scripts_by_idx[slide.index]`.
- The worker's single-slide regen path (`worker.py:561` calling `generate_slide_script`) is intentionally untouched — single-slide regen is a separate UI feature and doesn't benefit from batching.

## Test plan
- [x] `.claude/ci/run.sh` exits 0
- [x] manual smoke 1 — `_parse_batched_response` unit-style: feeding `<<<SLIDE 1>>> foo <<<SLIDE 99>>> bar` with `expected=[1,2]` raises with both `missing=[2]` and `extra=[99]` in the error string. Empty input fast-path returns `{}`.
- [x] manual smoke 2 — single-chunk regression on the 40-slide `prevention-effectiveness.pptx` (cached PNGs): chunked function with default chunk_size=40 produced 1 chunk, all 40 indices present, 42.6s. No regression vs PR-1.
- [x] manual smoke 3 — multi-chunk on the 40-slide deck with `chunk_size=20`: 2 chunks (indices 1..20 and 21..40), all 40 present, 50.7s. Slide 21 starts with "Beyond the direct costs we just covered..." referring back to slide 20's content — confirms the previous-context hint is wired up.
- [x] manual smoke 4 — real >40 deck: rasterized the 45-slide `introduction-to-public-health-laboratories.pptx` via LibreOffice, ran chunked narration with default chunk_size=40 → 2 chunks (40 + 5), 58.4s, all 45 indices present. Slide 41 (first of chunk 2) opens with "To continue your learning beyond this course, we've compiled..." after slide 40's course-summary close — natural continuity. Slide 45 references "the laboratory infrastructure and communication protocols we discussed earlier," confirming whole-deck context survives chunking.
- [x] manual smoke 5 — `pipeline_runner.generate_scripts(slides[:5], pngs[:5], on_slide_done=cb)` with a callback recording slide indices fired exactly `[1, 2, 3, 4, 5]` in slide-index order. Worker's existing call site at `worker.py:420` exercises this same path.
- [ ] qa regression: end-to-end through the worker (web upload → `render_jobs` → narrate phase) on a 30-slide and a 50+ slide deck — flagging for team-lead to dispatch.

## CI run
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## Notes for the reviewer
- The model occasionally needs explicit per-chunk "this batch covers indices N..M" guidance to avoid resetting the index counter to 1. Discovered while running smoke 4 on the 45-slide deck. The chunk intro now states the absolute range; both the >40 deck and the artificial chunk_size=20 case parse cleanly afterward.
- Logging: each chunk writes one `call_type="batched_slide_scripts"` row to `usage.csv`. There's no `chunk_index` column in the CSV today; left an inline comment so a follow-up can add one if per-chunk attribution is wanted.
- `on_chunk_done` swallows callback exceptions (matching the prior `on_slide_done` behavior in `pipeline_runner`). Worker's DB-write callback already has its own try/except + `_log` warning, so a failed write surfaces in worker logs.

## Reviews
<reviewer fills this in; verdict line at the bottom: APPROVED or CHANGES_REQUESTED>
