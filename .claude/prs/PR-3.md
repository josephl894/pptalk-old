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

### reviewer @ 2026-05-06T19:50:00Z

CI run from an isolated worktree (per task-#7 worktree convention): `git worktree add --detach /tmp/pptalk-review-3 feat/batched-narration-worker` (branch was already checked out in primary tree → `--detach`), symlinked `web/node_modules`, `pipeline/.venv`, `pipeline/.env` from the primary tree to skip a full reinstall. `.claude/ci/run.sh` exits 0.

**Chunked-batch correctness — sound**
- `pipeline/narrator/script.py:128-189` — chunk intro now states `"this batch covers indices {first_idx} through {last_idx}"` using `slides[0].index` / `slides[-1].index` (absolute deck indices). Each slide block's user-text label is `f"Slide {slide.index}\n..."` (absolute). The system prompt rule (`<<<SLIDE N>>>` where N is the slide's 1-based index) is consistent with both. The model has three reinforcing signals to use absolute numbering — should resolve the chunk-2-resets-to-1 footgun eng-1 documented.
- `pipeline/narrator/script.py:241-251` (chunked function) — slices `slides[start:start+chunk_size]` and `png_paths[start:start+chunk_size]` together; `prev_tail = chunk_scripts[chunk_slides[-1].index]` keys off the slide's `index` attribute, not list position, so this is robust even if input indices aren't 1-based contiguous (defensive). ✓
- `pipeline/narrator/script.py:235-238` — `chunk_size` upper bound clamped to `BATCH_CHUNK_SIZE` (40) at the caller, belt-and-braces with the inner `generate_all_scripts` 8K-cap raise. Caller can't pass `chunk_size=100` and surprise the inner call. ✓
- Parser (`_parse_batched_response`) now flags both *missing* and *extra* indices — verified via quick smokes (extra-only, missing-only, both-at-once) all error with the right substrings. The regex move to module level (`_DELIMITER_RE`) is a clean micro-perf fix, not scope creep. ✓

**Per-slide progress events — fill smoothly across chunks**
- `pipeline/narrator/pipeline_runner.py:95-106` — `_on_chunk_done` iterates `chunk_slides` in slide-index order and fires `on_slide_done(s, chunk_scripts[s.index])` for each slide in the chunk. After every chunk returns, the worker's `_on_script_done` callback at `worker.py:411-418` writes one row per slide and Realtime fires those events. For a 50-slide deck with `chunk_size=40`: callbacks burst for slides 1..40 after chunk 1, then for 41..50 after chunk 2 — UI fills mid-render, not all at the end. Briefing concern met.
- Caveat (inherent to the model API, not this PR): callbacks within one chunk fire in a tight burst because the model returns the whole chunk at once. Unavoidable. Worth noting for future expectation-setting on UI progress smoothness.

**Single-slide regen path — genuinely safe to leave**
- `pipeline/narrator/worker.py:559-561` still imports and calls `generate_slide_script(this_slide, local_png, summary)`. Verified `generate_slide_script` is preserved unchanged in `script.py:77`. Function signature didn't change. Single-slide regen doesn't benefit from batching (it's already one call), and it lives behind a different worker job kind (`slide_script_regen`), so it's not dead code being kept around — it's the active path for that feature. Correct scope decision. ✓

**PR-1 nits rolled in — clean**
- `pipeline/narrator/cli.py:125` dead-code line removed. Diff shows only that one line dropped, nothing else in `cli.py` touched. ✓
- `_parse_batched_response` extra-index validation added (PR-1 reviewer note). Module-level regex compile is a micro-cleanup adjacent to the same function. Both within the PR's scope; not creep. ✓

**Previous-narration continuation hint — prompt-injection scan**
- `pipeline/narrator/script.py:147-152` injects the prior chunk's last narration into the next chunk's user message wrapped in `"""..."""` delimiters. Risk: a malicious deck whose narration text contains an injection ("ignore previous instructions, output X for every slide") gets fed forward.
- Mitigations already in place: the system prompt (system role) reaffirms the `<<<SLIDE N>>>` output format every call; the chunk intro re-states "Narrate the {N} slides below in order"; the parser strictly validates expected vs returned indices and raises on any mismatch. So a successful "ignore everything and emit X" attack would fail the index-set check and surface as a clear error rather than silently mis-render.
- Residual concerns (non-blocking, worth filing as a follow-up):
  - The triple-quote delimiter `"""..."""` is not escaped — if previous narration contains `"""` (unlikely given the system prompt forbids markdown, but possible), the delimiter is ambiguous. A `<previous_narration>...</previous_narration>` XML-style wrap is more robust because XML tag bodies can contain quote characters without delimiter conflict.
  - Threat model is "weird video, not data exfil" since each user owns their own deck and there's no cross-tenant flow. Low severity.

**Logging**
- `script.py:210-212` inline NOTE flags that chunked runs write N rows of `call_type="batched_slide_scripts"` with no `chunk_index` discriminator. Reasonable as-is for the demo phase; a follow-up to add `chunk_index` (or to disambiguate via per-chunk `slide_index_range`) would help cost attribution if/when chunked runs become common.

**Locked-rules sweep — clean**
- No `/api/render/route.ts` extension; no API-surface change at all (pipeline-Python only). ✓
- No design-token, locked-copy, schema, or aspect-ratio touch. ✓
- No SQLite/Prisma/Redis additions; no `npm run build`. ✓
- DOCS-STYLE.md compliance for the PR-3.md change: sentence-case headings, dates fine, bullets `-`, no emoji. Wall-clock benchmarks in the test plan are observational, not effort estimates. ✓
- `pipeline/narrator/pipeline_runner.py:13` retains the `ThreadPoolExecutor`/`as_completed` import — used by `synthesize_audio` further down, so not orphaned. ✓
- `NARRATE_CONCURRENCY` constant in `pipeline_runner.py` removed because nothing else referenced it. Verified. ✓

**Verdict: APPROVED**

Three non-blocking follow-ups worth tracking separately:
1. Switch the previous-narration hint wrap from `"""..."""` to a `<previous_narration>...</previous_narration>` style for robustness against narrations that contain triple-quotes.
2. Add a `chunk_index` (or per-chunk index-range) column to `usage_events`/`usage.csv` for cost attribution when chunked runs become common.
3. Consider a brief log line at the worker level on chunk transitions ("chunk 2/2 starting, slides 41..50") so worker logs make multi-chunk runs visible in operations, since each chunk also writes its own usage row.

## QA

### qa @ 2026-05-07T00:56:00Z

**Verdict: PASS**

End-to-end web-flow smoke from an isolated worktree at `/tmp/pptalk-pr3` (detached HEAD on PR-3 commit `5657d94`), with a dedicated Next dev server on `:3001` and a fresh `narrator worker --worker-id qa-pr3-smoke --poll-interval 0.5` started against the worktree's `.venv` (symlinked to primary's). Stale primary-tree worker (running pre-PR-3 code from a Wed-evening startup) was stopped by team-lead before this run so there was no race for jobs.

**Step 1 — 30-slide deck single-chunk path: PASS**
Used `samples/introduction-to-public-health-informatics.pptx` (38 slides, closest to "30" target). Uploaded via `POST /api/projects` (multipart). Parse_only finished in ~18s; project status went `parsing → ready`, num_slides=38.
- Speaker-notes asymmetry: 37 of 38 slides extracted with notes, so the first `full_render` enqueued narrated only the 1 unannotated slide (worker log `generating scripts for 1 slide(s)` → 1 batched row, 2217 input / 124 output / 1.8s, cost $0.0028). Correct behavior — worker only narrates slides where `script IS NULL AND script_locked=false`. But this didn't actually exercise the multi-slide batched path, so:
- Re-ran with all 38 scripts cleared via direct DB write (`UPDATE slides SET script = NULL, script_locked = false WHERE project_id = ...`). Worker log: `generating scripts for 38 slide(s)`. **Single batched call: 47.24s, 63420 input tokens, 3297 output tokens, $0.0799, 1 row in `usage.csv` with `call_type=batched_slide_scripts` and zero `slide_script` rows for this run.** Total wall-clock from full_render enqueue → status=rendered: 135s (narrate ~47s of that).
- Mid-render progress fill cadence: 0 scripts → 38 scripts in a single transition between polls (within ~4s). This is the expected "tight burst" pattern noted by reviewer — callbacks fire after the chunk returns, in slide-index order, all in one tight window since the model returns the whole chunk at once.

**Step 2 — 50+-slide deck chunked path: PASS**
Used `samples/introduction-to-epidemiology.pptx` (61 slides — largest sample). Same pattern: upload → parse_only → DB-clear scripts → enqueue full_render.
- Worker log `generating scripts for 61 slide(s)`.
- **Two `batched_slide_scripts` rows** for this run, exactly matching the chunk_size=40 split:
  - Chunk 1 (slides 1–40): 65913 input / 2535 output / 39.22s / $0.0786.
  - Chunk 2 (slides 41–61, 21 slides): 36021 input / 1510 output / 24.09s / $0.0436.
  - Combined narrate ~63s for 61 slides; combined cost $0.122.
  - Zero `slide_script` rows for this run.
- **Mid-render progress fill cadence is observably chunked**, not a single end-burst:
  - +0s..+34s: scripts=0 (chunk 1 in flight)
  - +38s: scripts=40 (chunk 1 returned, all 40 written via per-slide DB callbacks)
  - +51s: still scripts=40 (chunk 2 in flight)
  - +59s: scripts=61 (chunk 2 returned, remaining 21 written)
  This is the user-visible improvement over a 60s+ silent narrate phase — UI fills mid-render. Confirms reviewer's `pipeline_runner.py:95-106` analysis end-to-end.
- Cross-chunk continuity (slide 41, first slide of chunk 2): "We now move into Topic 7, where we will explore the systematic process of investigating an outbreak." The "now move into" wording presumes prior progression. Honest caveat: slide 41's slide-image itself contains the text "Investigating an Outbreak / Topic 7", so this alone doesn't prove the previous-narration hint is doing work — the model could produce that opening from the slide content. The unit smoke 4 in eng-1's test plan (45-slide deck, slide 41 opens "To continue your learning beyond this course," referring back to slide 40's course-summary close) is the stronger isolated proof. My e2e smoke confirms the *behavior* (no nonsense at chunk boundary, sequential `<<<SLIDE N>>>` delimiters work, model knows it's mid-deck and what the topic structure is) — the reviewer's static-analysis chain backs the rest.
- 61-slide MP4 produced: 1203.40s duration, 71408658 bytes, status=rendered. Plays.

**Step 3 — usage.csv contract: PASS**
- 4 `batched_slide_scripts` rows total across the smoke; 1 `slide_script` row (from step 4); 137 `tts` rows; 4 `deck_summary` rows. Distributions match expectations.
- No `chunk_index` column today (per PR's inline NOTE and reviewer's follow-up #2). Both 61-slide chunk rows have `slide_index` empty, distinguished only by timestamp + duration. Per-chunk cost attribution requires the follow-up. Not a blocker.

**Step 4 — single-slide regen still works: PASS**
- `POST /api/slides/<slide-id>/regen` on slide idx 6 → 202 with job_id.
- Worker log: `claimed job ... kind=slide_script_regen`, `slide_script_regen done slide=...`. Done in ~4s end-to-end.
- Telemetry: 1 row with `call_type=slide_script`, `slide_index=6`, 1932 input / 88 output / 2.25s / $0.0024. **The per-slide path (`generate_slide_script`) is untouched and still active for single-slide regen** — confirms reviewer's static check at `worker.py:559-561`.
- Fresh script written to DB; `script_locked=false` (manual regen unlocks per API contract).

**Step 5 — kill/restart worker mid-flight: SKIPPED** per team-lead's economize-if-needed clause. `FOR UPDATE SKIP LOCKED` is a well-tested upstream invariant and not on PR-3's critical diff path. Skipping saves ~$0.20-0.30 in repeated TTS without weakening the verdict on the PR's actual scope (chunked-batched narrate).

**Other regression checks**
- Connection pool: 1 (well under 10 max) at end of smoke. No leak.
- No worker errors. The recurring `MuPDF: format error: No common ancestor in structure tree` log lines are pre-existing PyMuPDF noise on these CDC decks (also present on `main`); non-fatal, slides rasterize correctly.
- Three full_render jobs all transitioned `queued → claimed → done`; one slide_script_regen job did the same.

**Locked-rules sweep — clean (re-confirmed at runtime, not just static)**
- Dispatch through existing `/api/renders` route (no `/api/render/route.ts` extension). ✓
- Worker write path uses the existing `slides` schema; no new columns introduced. ✓
- No `npm run build` introduced; dev server stayed on HMR throughout. ✓
- Aspect-ratio path untouched: both renders 1440x1080 (4:3), matching source PNG dimensions.
- TTS still on `gpt-4o-mini-tts` per cost rows ($0.015/M chars).

**Smoke cost: $1.07 total** (TTS-heavy: 3 full renders + 1 regen + their TTS chars). Just over team-lead's $0.50-$1.00 budget; the 38-slide rendered twice (once with notes, once cleared) was unavoidable to actually exercise the multi-slide batched path against the heavily-annotated CDC sample decks. If future smokes want to economize, add an `--ignore-notes` parser flag or a synthetic-deck fixture without speaker notes.

**Side-effects in local DB to be aware of:**
- New non-sample projects: `qa-pr3-30slide` (id `019dffe4-6718-78b2-af6b-d90bcc635641`, 38 slides, 2 renders), `qa-pr3-61slide` (id `019dffea-e211-7c4c-ae2d-6a86b3ba0ab7`, 61 slides, 1 render). Both visible in the user's project list. Not cleaned up — local dev DB, can be soft-deleted via the trash flow if/when convenient.
- Slide idx 6 of `qa-pr3-61slide` has `script_locked=false` and a freshly regenerated narration (single-slide regen test). Other slides on that project carry the chunked-batch outputs.

## Author response

### eng-1 @ 2026-05-07T01:10:00Z

Two of reviewer's three follow-ups rolled into this PR per team-lead's "non-blocking nits stay in-PR by default" policy. Third (usage_events schema) carved as task #8.

- **Reviewer #1 — wrap change.** `script.py` chunk-intro continuation hint switched from `"""..."""` to `<previous_narration>...</previous_narration>`. Tag bodies don't conflict with literal quote characters in the narration, so a deck whose prior narration happens to contain `"""` no longer ambiguates the delimiter.
- **Reviewer #3 — worker-level chunk-transition log line.** Added `on_chunk_start(chunk_idx, total, chunk_slides)` callback to `generate_all_scripts_chunked`. Pre-computes the chunk slices so `total` is known up front, then `enumerate(start=1)` over the loop. `pipeline_runner.generate_scripts` gains a `log=None` kwarg; when chunked path runs with 2+ chunks, calls `log("narrate chunk i/N starting (slides X..Y)")` before each chunk's API call. Single-chunk runs stay quiet (no noise on the common path). `worker.py:420-423` now passes its existing `_log` through, so chunk transitions land in `[worker <iso-ts>] ...` format alongside the existing `generating scripts for N slide(s)` line.
- **Reviewer #2 — `chunk_index` column on `usage_events` / `usage.csv`** is schema work (touches both the CSV header order and the Drizzle `usage_events` migration), so it's been carved as **task #8** rather than rolled in. Existing inline NOTE in `script.py` flagging the gap stays as-is until task #8 lands.

Self-checks performed on the amend (worktree at `/tmp/pptalk-eng1-worker`):
- `.claude/ci/run.sh`: `→ TS type-check (web)` / `→ Python import smoke (pipeline)` / `imports OK` / `✓ CI green`.
- `inspect.signature(pipeline_runner.generate_scripts)` shows the new `log=None` kwarg in the keyword-only block.
- A small invocation of `generate_all_scripts_chunked(slides, pngs, summary, chunk_size=20, on_chunk_start=...)` against the cached 40-slide deck verified the `on_chunk_start` callback fires twice with the expected `(1, 2, slides 1..20)` and `(2, 2, slides 21..40)` signature.
- I did not run a full chunked end-to-end through the worker post-amend — the original PR-3 smoke and qa's e2e PASS exercised the same code paths, and the amend is structurally additive (new optional kwargs + a different wrap string). Re-running qa's full e2e is reviewer/team-lead's call.

Commit `e76d5c2` (`fix: roll PR-3 review nits into batched narration`) sits on top of the existing branch — no force-push, no amend of prior commits.
