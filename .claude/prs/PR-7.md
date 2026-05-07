# PR-7: PDF upload from /new must not get stuck on "parsing"
Author: eng-1
Branch: fix/pdf-parse
Spec: SPEC-7
Status: open

## Handoff report

**Outcome:** done.

**Author response — spec amendment 2026-05-07.** Team-lead amended SPEC-7 after qa flagged two drafting errors (commit 7891dc3 on `main`): AC2's column name `image_path` → `png_path`, and AC3's "pending" → schema's queued/pending state (terminology-agnostic). My impl was already aligned with the amended spec semantically — slides write to the schema's actual `png_path` column, and the queued parse_only job is left in `render_jobs.status === 'queued'` so a started worker picks it up. The Spec coverage and Decisions sections below have been updated to cite the amended wording. No code changes were required from the amendment.

**Approach:** Triage of the dispatched code path (upload → enqueue → worker claim → parse → DB → editor) revealed two distinct root causes for the user's symptom and one missing surface required by AC3.

1. The Python worker (`uv run narrator worker`) was not running on the user's machine at repro time. The web side enqueued the `parse_only` job correctly, but with no consumer the project status stayed `parsing` forever; `NewProjectForm`'s 90-second poll either timed out into an empty editor or kept the user on the "Parsing slides…" spinner the whole time.
2. Both `parse.py` (PPTX) and `parse_pdf.py` (PDF) wrote slide indices as `1..N` (`enumerate(..., start=1)`), but the Drizzle schema annotates `slides.idx` as 0-indexed, the reorder route writes 0..N-1, and the editor renders `Slide {idx + 1}` assuming 0-base. AC2 explicitly mandates `idx` values 0..N-1, so the parse path produced wire-shape data that violated AC2 every time and caused a one-off display in the editor.
3. There was no worker-not-available affordance in either the `/new` flow or the editor — AC3 was unsatisfied independent of any other fix.

This PR ships (a) the 0-base parse fix shared between PPTX and PDF (load-bearing for AC2 on the dispatched PDF path; PPTX gets the fix for free since the bug was identical), and (b) a non-blocking, recoverable banner on the editor plus an early route-out from `/new` once a `parse_only` job has been queued (un-claimed) for >30 seconds.

## What changed
- `pipeline/narrator/parse.py` — slide indices now 0-based (`enumerate(prs.slides)` without `start=1`).
- `pipeline/narrator/parse_pdf.py` — slide indices now 0-based (`enumerate(doc.pages())` without `start=1`).
- `web/components/editor/EditorShell.tsx` — adds a derived `workerStalled` flag (parse_only job in `queued` for >30s on the wall clock), renders a non-blocking inline banner above the rail/center/right grid that names the worker, suggests the start command, and explains the queued job will be picked up. Also a softer "Parsing your deck…" notice during normal in-flight parses (`status === 'parsing'` and not yet stalled). The grid grows a third row only while a banner is visible. A 5-second client-side ticker re-evaluates the stall window so the banner appears on time without needing a Realtime kick.
- `web/components/new/NewProjectForm.tsx` — `pollUntilReady` now inspects the project's `active_jobs` and short-circuits with `worker-stalled` once a `parse_only` job has been queued for >30s; the form briefly swaps the spinner copy and routes to the editor where the persistent banner takes over. The job row stays in `queued` so a started worker still picks it up.

## Spec coverage

**AC1 — happy path, PDF.** Given a fresh anonymous user and a running worker, `POST /api/projects` (already in place pre-PR) creates the project row with `status = 'parsing'`, uploads the deck, and enqueues a `parse_only` row in `render_jobs`. The worker (unchanged in this PR) claims the row via `claim_next_job`, calls `pipeline_runner.parse_and_rasterize`, uploads PNGs to Storage at `slide_png_path(user_id, project_id, idx)` with the now-0-based `slide.index`, upserts `slides` rows via `queries.upsert_slide`, and finally `update_project_status(..., status='ready', num_slides=N, aspect_w, aspect_h)`. `NewProjectForm`'s poll observes `status==='ready'` and routes to `/p/{id}`, where the editor's server component reads N slide rows and renders thumbnails. All of this is well under 30 seconds for a typical demo PDF on the locked stack — no change required from this PR beyond the index base. Slide thumbnails appear in the filmstrip (the SceneRail consumes `slides.idx` and `png_signed_url`); the parsing UI hides because `status !== 'parsing'` flips both `parsing` and `workerStalled` derived flags to false.

**AC2 — DB end state after PDF parse.** After AC1's flow:
- `render_jobs` row: `status` is set to `'done'` by `queries.mark_job_done` after dispatch returns; `kind` is whatever the route inserted, which is `'parse_only'`. (The schema enum is `'queued' | 'running' | 'done' | 'failed'` — `'done'` is the schema-side spelling of AC2's "completed." The 2026-05-07 amendment corrected this terminology for AC3 but left AC2 reading "completed"; flagging here so qa knows to assert `status === 'done'`.)
- `slides` row count: `_parse_and_upload` upserts one row per parsed slide, then reads them back via `_get_slides`. The PDF parser produces N entries (one per page) and the rasterizer produces N PNGs; `pipeline_runner.parse_and_rasterize` raises if those counts disagree. So the table has exactly N rows.
- `idx` values 0..N-1: this PR's fix to `parse_pdf.py` makes `slide.index` 0-based, so `upsert_slide` writes `idx = 0..N-1`. The unique index `slides_project_idx_unique` enforces no gaps or dupes for a single insert pass.
- Non-null `png_path`: `set_slide_png` runs immediately after upload inside the same transaction as `upsert_slide`. The path written is `slide_png_path(user_id, project_id, slide.index)` = `{user_id}/{project_id}/slides/{idx:03d}.png`, which `getPublicSignedUrl` resolves into the "Supabase Storage signed-URL helper" the spec names. (Spec amendment 2026-05-07 corrected `image_path` → `png_path` in AC2; impl already wrote to `png_path` since that's the schema column.)

**AC3 — worker-not-running visibility.** Two surfaces:
- `NewProjectForm` polls `GET /api/projects/{id}` every 1.5s. If the response has a `parse_only` `active_job` whose `status === 'queued'` and whose `created_at` is older than 30 seconds, the poll returns the `worker-stalled` outcome, the form swaps to "Render worker is not running — opening editor…", and `router.push` lands the user in `/p/{id}`. The 30s threshold + 1.5s poll cadence guarantees detection ≤32s after the queued window opens, well under AC3's 60s envelope.
- `EditorShell` re-derives the same flag from its `activeJobs` state. When `workerStalled` is true, it renders an inline banner spanning all three columns above the rail/center/right grid. The banner names the worker ("Render worker is not running"), gives the exact start command (`uv run narrator worker`), and reassures the user the queued job will be picked up. The banner is non-blocking: rail, center, and right panels still render and are interactive (rename, voice change, navigation back to home all work). The same `EditorShell` is used whether the user arrives from `/new` or refreshes into the editor while a parse is queued, so AC3's "or refreshes into the editor" branch is covered by the same code path.
- Realtime keeps the banner accurate: when the worker eventually starts and claims the job, the `render_jobs` UPDATE fires `onJobChange` with `status === 'running'`, the `parseJob` derivation flips, and `workerStalled` becomes false on the next render. Banner clears; no manual refresh needed.
- The job row stays in the schema's queued/pending state (`render_jobs.status === 'queued'`) in all cases — nothing in this PR transitions it to `failed` or `done`, which is what the amended AC3 mandates ("re-claimable — `render_jobs.status` MUST be the schema's queued/pending state, i.e. not `failed` and not `completed`"). The visibility surface is purely client-side; the DB state is the contract for "started worker still picks it up." `claim_next_job` filters on `status = 'queued'`, so a worker started later sees and claims the same row unchanged.
- AC3 visibility probe: the amended test surface accepts either an API JSON field OR a DOM HTML signal. This PR exposes the DOM signal — `EditorShell` renders the banner with `role="alert"` and `data-testid="worker-not-available"` (and `data-testid="parse-in-progress"` for the softer parsing variant). Either selector is enough for qa to assert; no API field added.

## Invariant defense

- **Locked stack (Postgres + Drizzle + psycopg + Supabase Storage).** No change. The TS code in this PR uses Drizzle types (`EditorActiveJob`, `EditorSlide`) and the existing fetch-to-API pattern; the Python code in this PR is two index-base edits inside parsers that already use the standard module structure. No SQLite, ORM, Redis, or new transport added.
- **UUIDv7 IDs validated at the route boundary.** No new routes; the existing `/api/projects/[id]` GET handler already runs `getProjectForUser` which calls `isUuid()` before any DB op. The poll loop in `NewProjectForm` uses the project id returned by `POST /api/projects`, which is generated by `uuidv7()` server-side, so it is well-formed by construction.
- **`parse_only` is a distinct job kind from `full_render`; the editor opens after parse, before any TTS work.** Unchanged. The banner detector explicitly filters on `kind === 'parse_only'` so a queued `full_render` (which has its own UI in ExportModal) doesn't trigger the worker banner.
- **Realtime via Supabase `postgres_changes` is the contract for worker→editor progress wiring.** Unchanged. The banner subscribes to nothing new; it derives its state from the same `activeJobs` list that's already maintained by the existing `useProjectRealtime` hook. No SSE, no polling-from-the-editor for state.
- **postgres-js singleton pattern.** Unchanged. No new DB clients added.
- **`NEXT_PUBLIC_*` env literal access.** Unchanged. No new envs touched.
- **Anonymous identity via `pptalk_uid` cookie.** Unchanged. Both edited components use the existing `getCurrentUser` chain via fetch.
- **Soft-delete + timestamps on user-owned writes.** Unchanged — no new writes in this PR.
- **No time/effort estimates.** This PR file, the commit messages, and the in-code comments contain no week budgets, day estimates, or "by Friday."

## Decisions and risks

- **30-second stall threshold.** Tuned so AC3's 60-second envelope is comfortably met (32s worst case at the 1.5s poll cadence). Shorter would risk false positives on a cold-start worker that takes a few seconds to spin up; longer would scrape AC3's ceiling. If qa or reviewer wants a different number, it's a single constant (`WORKER_STALL_MS` in `NewProjectForm.tsx` and the inline `30_000` literal in `EditorShell.tsx`).
- **Banner copy.** AC3 leaves wording "at engineer's discretion" but mandates that it (a) names the worker, (b) suggests starting it, and (c) doesn't block other UI. Current copy: "Render worker is not running" + "From the pipeline directory, run `uv run narrator worker`. Your upload is safe — the queued job will be picked up automatically." Names the worker, gives the exact command, keeps the rest of the editor interactive. Visual: a small accent-tinted info icon, no animation, no dismiss button (the banner clears itself when the job moves to `running`).
- **PPTX gets the 0-base fix for free.** The bug was symmetric across `parse.py` and `parse_pdf.py`. The spec scopes the test surface to PDF-only, but it would be wrong to leave PPTX 1-based — that would mean re-uploading a PPTX produces `idx 1..N`, breaks the editor's display, and writes storage paths at `001..N` while a reordered project ends up at `000..N-1`. Same fix applied to both. Flagged here since it's outside the AC2 letter.
- **Editor's `getCurrentUser` cookie write in a server component.** The auth helper warns that cookie writes from server components are silently dropped. If a user's first-ever request is to `/p/{id}` (no prior `/new` interaction, no cookie), `getCurrentUser` mints a new id but can't persist it; the next request mints a new one again, never finding the project. Out of scope for SPEC-7 (the SPEC-7 flow always lands on `/new` first, where `POST /api/projects` is a route handler that *can* set the cookie). Flagging for future work.
- **No new test fixtures shipped from engineer.** The spec's test surface enumerates integration tests for AC1/AC2/AC3 and a manual smoke. Per the blind-parallel-verification protocol, `qa` writes those on `test/pdf-parse`. I have not read that branch.
- **Banner's 5-second re-tick interval.** Cheap (one `setInterval` only while a queued parse_only job is present, cleared otherwise). The alternative would be a single `setTimeout` that wakes once at the 30s mark, but that misses the case where the user lands in the editor with a job already queued for, say, 28 seconds — the timer would need to be primed correctly per-mount. The 5s ticker is simpler and bounded.
- **Wall-clock skew on the 30s threshold.** The "queued for >30s" check compares the *client's* `Date.now()` against the job's DB-side `created_at` (Postgres `now()` on the Supabase host, serialized into the API response as ISO and re-parsed in the browser). If the user's machine clock drifts ahead of the DB host, the banner can fire early; if behind, late. Within a few seconds either way, AC3's 60s envelope still holds — but a future debugger seeing the banner appear off-cadence should compare the client clock to the DB host (`select now()`) and to the `created_at` in the API response. That client-vs-DB comparison is the only wall-clock arithmetic in the path.
- **No fallback if `active_jobs` is missing from the API response.** Older API responses (pre-Wave-3) didn't include `active_jobs`. Current `/api/projects/[id]` always emits it (line 94 of the route file before this PR). If a future change drops the field, the optional chaining `data.active_jobs?.find(...)` simply means we never detect a stall; the 90s timeout still fires. Acceptable degradation.
- **Schema enum vs spec wording: "completed" vs "done."** Confirmed in the schema (`render_jobs.status` enum is `'queued' | 'running' | 'done' | 'failed'`). The 2026-05-07 spec amendment fixed AC3's "pending" → schema's queued/pending state (terminology-agnostic) but left AC2's "completed" word in place; the schema spelling is `'done'`. No schema migration in this PR — the enum names were chosen during Phase 1C and changing them now would ripple through the worker, queries, and Realtime subscriptions for a wording-only delta. Qa should assert `status === 'done'` for the post-parse `render_jobs` row.

## Self-verification

- Ran `.claude/ci/run.sh` from `/tmp/pptalk-pdf-parse` after `npm install` (web) and `uv sync` (pipeline). Exits 0 with both checks green.
- Did not start a dev server for a manual UI smoke (the team-lead's primary tree owns `npm run dev`); the banner wiring was verified by reading the type-checked surface and tracing the data path: `parseJob` derived from `activeJobs.find(j => j.kind === 'parse_only')`; `workerStalled` predicated on `parseJob.status === 'queued'` and elapsed-since-`created_at` > 30s; banner conditional on `workerStalled` (worker variant) or `parsing && !workerStalled` (parsing variant). Realtime updates feed `activeJobs` in `onJobChange`, so banner clears automatically when the worker claims the job.
- Did not read `test/pdf-parse` (qa branch), per the spec-driven loop.

## CI run

```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## QA gate

### qa @ 2026-05-07T03:35:00Z

**Gate worktree:** /tmp/pptalk-qa-gate-7 (created --detach off fix/pdf-parse @ 1775db5, merged test/pdf-parse @ cc4d346)

**Pre-run subprocesses (gate worktree only):**
- `next dev --port 3001` (pid 32769) — :3001, served all three ACs
- `uv run narrator worker` (pid 33174) — covered AC1's "running worker" precondition; killed (-9) before AC3
- AC3 verified worker-not-running precondition via `pgrep -fl "narrator worker"` returning empty

**Test results**

- AC1 (Given a fresh anonymous user (no `pptalk_uid` cookie) and a running worker, When the user uploads a valid multi-page PDF on /new, Then within 30 seconds of upload completion the user is at `/p/<project_id>` with one slide thumbnail per PDF page rendered in the filmstrip and the "parsing" UI is no longer visible.) — **PASS**:
  - `bash .claude/qa/spec-7/ac1_happy_path.sh` exit 0.
  - Uploaded `fixtures/three_page.pdf`, project_id=`019e007a-83be-7b8f-8e03-e4134137a532`.
  - GET `/api/projects/{id}` returned `project.status='ready'` and `slides.length=3` after **1s**, well under the 30s envelope.
  - 0-based idx fix from `parse_pdf.py` confirmed by AC2's idx check below.

- AC2 (Given AC1's flow completed successfully, Then the corresponding `render_jobs` row has `status = 'completed'` and `kind = 'parse_only'`, the `slides` table has exactly N rows for that `project_id` (where N = PDF page count) with `idx` values 0..N-1, and every slide row has a non-null `image_path` whose object resolves via the Supabase Storage signed-URL helper.) — **FAIL** (single literal-text mismatch; all other AC2 sub-checks PASS):
  - `bash .claude/qa/spec-7/ac2_db_end_state.sh 019e007a-83be-7b8f-8e03-e4134137a532` exit 1.
  - Sub-results:
    - `render_jobs.kind='parse_only'` AND `status='done'`. **Expected `status='completed'`** — the schema enum is `'queued' | 'running' | 'done' | 'failed'` (per engineer's `## Decisions and risks` final bullet). All 81 successful jobs in the DB across all kinds use `'done'`, predating SPEC-7. This is the same literal-vs-schema shape as AC3's `pending`/`queued` ambiguity that team-lead amended on commit `7891dc3` — recommend the same amendment for AC2 (`'completed'` → `'done'/'completed'` or "schema's successful terminal state"). Engineer flagged this in the PR file before the run; my test asserted the literal spec text and FAILed accordingly.
    - slides row count = 3 ✓
    - slides idx values = 0,1,2 ✓ (the 0-based fix in `parse_pdf.py` works as the engineer claimed)
    - every slide row has non-null `png_path` ✓
    - all three `png_path` values resolved via `POST /storage/v1/object/sign/pptalk-private/...` with HTTP 200 on the signed HEAD ✓
  - Verdict: PASS on the substantive contract (engineer satisfied the spec's intent); FAIL on the literal text. Routing recommendation: SPEC amendment, not engineer rework.

- AC3 (Given the worker is NOT running, When the user uploads a PDF on `/new` (or refreshes into the editor while the parse_only job is unclaimed past a bounded threshold), Then within 60 seconds the parsing UI surfaces a recoverable, non-blocking message indicating the render worker is not available — must (a) name the worker, (b) suggest starting it, and (c) not block other UI from rendering. The job row stays `pending`/`queued` (not `failed`) so a started worker still picks it up.) — **PASS**:
  - `bash .claude/qa/spec-7/ac3_worker_not_running.sh` exit 0.
  - Uploaded `fixtures/three_page.pdf`, project_id=`019e007b-a72e-7499-b963-988d2828d8f0`, worker confirmed offline.
  - DOM signal matched within **30s** (≤60s envelope) — `/p/{id}` HTML body contains both `/worker/i` and one of `/start|run|launch/i`, satisfying the "names the worker + suggests starting it" requirement.
  - `render_jobs.status='queued'` (re-claimable, not `failed` and not `done`), satisfying the "started worker still picks it up" requirement.
  - `GET /p/{id}` → HTTP 200, 42820 bytes — UI is rendering, not blocked.

**CI baseline:** `.claude/ci/run.sh` — green:
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

**Test-mechanics fix applied during the run.** The three smokes' anonymous-cookie bootstrap step originally hit `GET /` to mint `pptalk_uid`. The actual cookie is set by the `/api/projects` route, not the home page render path; the smokes now bootstrap via `GET /api/projects`. Mechanics-only — does not change what is asserted. The fix has been re-applied to the gate worktree's copy of the smokes; recommend backporting to `test/pdf-parse` so future re-runs and the eventual merge to `main` carry the corrected bootstrap.

**Verdict: FAIL** (AC2 literal-text mismatch only)

**For team-lead:** AC1 and AC3 fully pass. AC2 fails only on the spec's literal `'completed'` vs the schema's `'done'`. This is the same shape as the `pending`/`queued` amendment already accepted in commit `7891dc3`. Recommended path: amend SPEC-7 AC2 to accept `'done'` (schema enum) as the spec's "completed" semantic, then re-gate trivially without engineer rework — every other AC2 sub-check already passes against the engineer's branch. If you decline the amendment, route to engineer and the rework would touch the project-wide `render_jobs.status` enum + worker + queries + Realtime subscribers (engineer flagged this scope in `## Decisions and risks`).

### qa @ 2026-05-07T03:50:00Z — re-verdict against amended spec

**Trigger:** team-lead accepted the AC2 amendment in commit `89102d9` on `main` — AC2 now reads `status='done'` to match the actual schema enum. Same drafting-error shape as the prior `image_path → png_path` and `pending → queued/pending` amendments.

**No re-run needed.** The original gate run already captured the observed value. Re-evaluating the same evidence against the amended AC2:

- AC2 (amended: `render_jobs.status='done'` AND `kind='parse_only'`; slides count == N; idx 0..N-1; `png_path` non-null; signed URL HEAD 200) — **PASS**:
  - `render_jobs.kind='parse_only'` AND `status='done'` ✓ (matches the amended literal)
  - slides row count = 3 ✓
  - slides idx values = 0,1,2 ✓
  - every slide row has non-null `png_path` ✓
  - all three `png_path` values resolved with HTTP 200 on the signed HEAD ✓

- AC1 — PASS (unchanged from initial run).
- AC3 — PASS (unchanged from initial run).

**Verdict: PASS** (overall — all three ACs satisfy the amended spec)

**For team-lead:** ready for reviewer.

## Reviews

### reviewer @ 2026-05-07T04:10:00Z

**Method:** spec-only adversarial review against `SPEC-7.md` (post all three amendments) + `hats/engineering.md` Hard rules / patterns / pitfalls + `SCOPE-DEMO.md` in/out boundary + `DOCS-STYLE.md` for the PR-file prose. No code read, no diff, no worktree exposure to product files.

**Spec well-formed**

- Acceptance criteria observable and unambiguous after the three amendments (AC2 `image_path → png_path`, AC2 `'completed' → 'done'`, AC3 `'pending'` → schema's queued/pending state). All three amendments are documented under `## Spec amendments` with rationale.
- Out-of-scope tight; in-scope invariants enumerate the locked-stack rules + the postgres-js / NEXT_PUBLIC / UUID-at-the-boundary pitfalls plausibly relevant to the dispatched code path.
- No unresolved Open questions — both questions in the spec resolved before dispatch.

**Spec coverage probes**

- AC1 (happy-path PDF, ≤30s, slides visible, parsing UI hidden) — defended; `## Spec coverage` traces upload → enqueue → claim → `pipeline_runner.parse_and_rasterize` → `update_project_status(status='ready')` → editor flips `parsing` to false. QA gate measured 1s end-to-end on a 3-page PDF, well under the 30s envelope.
- AC2 (`render_jobs.status='done'`, `kind='parse_only'`, exactly N slides with idx 0..N-1, non-null `png_path` resolving via signed URL) — defended after the 2026-05-07 amendment; the 0-based-idx fix in `parse_pdf.py` is load-bearing and qa confirmed all four sub-checks pass against the amended literal text.
- AC3 (worker-not-running visibility, ≤60s, names worker + suggests start + non-blocking, job stays queued) — defended; two surfaces (NewProjectForm 30s short-circuit, EditorShell banner derived from `parseJob.status==='queued'` + 30s elapsed). QA gate observed DOM signal in 30s, `render_jobs.status='queued'`, and `GET /p/{id}` 200 with non-trivial body indicating UI rendered. `data-testid="worker-not-available"` + `role="alert"` is consistent with the spec's "name worker / suggest start / not block UI" mandate.

**Invariant defenses probed**

- Locked stack — defended (no SQLite, ORM, Redis, new transport).
- UUID-at-the-boundary (pitfall #5) — defended; existing `isUuid()` short-circuit on `getProjectForUser` retained, no new routes.
- `parse_only` distinct from `full_render` — defended; banner detector explicitly filters `kind === 'parse_only'`.
- Realtime via `postgres_changes` — defended; banner subscribes to nothing new, derives from `useProjectRealtime`'s `activeJobs`.
- postgres-js singleton (pitfall #1) — defended; no new DB clients added.
- `NEXT_PUBLIC_*` literal access (pitfall #2) — defended; no new envs touched.
- `pptalk_uid` cookie identity — defended (unchanged).
- Soft-delete + timestamps — defended (no new writes).
- No time/effort estimates — confirmed across PR file, commit messages, and quoted banner copy.

**Spec-amendment alignment in PR file**

- AC2 defense cites the amended `'done'` literal and explicitly notes the schema-vs-original mismatch in `## Decisions and risks`.
- AC3 defense cites the amended "queued/pending state" wording and the Realtime contract for clearance.
- QA gate carries an explicit re-verdict block dated 2026-05-07T03:50:00Z against the amended AC2 — same evidence, re-evaluated after team-lead's commit `89102d9`. PR file is consistent with the amended spec; no residual original-wording artifacts in the load-bearing sections.

**Sanity-check on engineer's flagged out-of-scope item**

- `## Decisions and risks` flags an "editor server-component cookie-write race": if a user's first-ever request lands on `/p/{id}` with no prior `/new` interaction, the cookie can't be persisted from a server component. AC1's Given specifies the user uploads on `/new`, where `POST /api/projects` is a route handler that *can* set the cookie before `router.push('/p/{id}')`. AC3's "refreshes into the editor" branch presumes the user already uploaded via `/new`. Neither AC traverses the broken path. The flag is correctly out of scope for SPEC-7.

**Scope-creep check**

- `parse_pdf.py` 0-base — load-bearing for AC2.
- `parse.py` 0-base — explicitly permitted by SPEC-7's Out-of-scope clause "Engineer may fix shared root causes if any surface, but the test surface is PDF-only." Engineer flagged transparently in `## Decisions and risks`. Not creep.
- `EditorShell.tsx` banner + grid row — load-bearing for AC3.
- `NewProjectForm.tsx` `worker-stalled` short-circuit — load-bearing for AC3.

No file in `## What changed` is untraced.

**CI attestation**

- Engineer's `## CI run` block shows the four-line success marker (`→ TS type-check`, `→ Python import smoke`, `imports OK`, `✓ CI green`). QA gate re-ran the same baseline in the gate worktree, also green. Plausibly green; not re-verified by reviewer.

**Open adversarial questions for the engineer (non-blocking)**

- The 30s threshold uses `parseJob.created_at` wall-clock (server-emitted) compared against the client's `Date.now()`. If the client clock is skewed by tens of seconds, the banner could trigger early or late. Worth a one-line note in `## Decisions and risks` for future debuggers; doesn't break AC3's 60s envelope at any plausible skew.
- QA flagged a test-mechanics fix (smokes' bootstrap from `GET /` → `GET /api/projects`) re-applied to the gate worktree; recommended backporting to `test/pdf-parse` so a future re-run carries the corrected bootstrap. Tracking note for team-lead at merge time, not a defense gap.

**Verdict: APPROVED**
