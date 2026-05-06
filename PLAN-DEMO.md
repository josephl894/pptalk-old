# PLAN-DEMO — ordered work to ship the demo version

Companion to `SCOPE-DEMO.md`. Items are **sequenced**, not time-boxed (per user policy: no time estimates). Each item names the hat that owns it and what blocks/unblocks it. Items in a phase can ship in the order listed; phases run strictly in sequence — phase N+1 work depends on phase N being settled.

The principle: **lay the foundation before any feature work**, because the foundation reshapes what every feature looks like (where files live, how state is tracked, how renders are triggered). Building features first and migrating later is the failure mode this plan exists to avoid.

---

## Phase 0 — Foundation (DONE 2026-05-06)

The whole point of locking the stack now. Nothing user-facing changes; everything downstream gets cleaner.

1. **Initialize Supabase locally** — `supabase init`, commit the generated config. Adds a `supabase/` directory with `config.toml` + a migrations folder.
2. **Add stack dependencies**
   - `web/`: `drizzle-orm`, `drizzle-kit`, `postgres`, `@supabase/supabase-js`, `@supabase/ssr`, `dnd-kit/core`, `dnd-kit/sortable`, `uuidv7`. Init shadcn/ui (`npx shadcn@latest init`) and pull in: button, dialog, input, textarea, select, dropdown-menu, separator, tooltip, toast, command (for cmd+k), skeleton.
   - `pipeline/`: `psycopg[binary]`, `psycopg-pool`, `supabase-py`, `python-uuid7`.
3. **Define the schema in Drizzle** (`web/lib/db/schema.ts`) — `users`, `projects`, `slides`, `render_jobs`, `renders`, `usage_events`. Per `SCOPE-DEMO.md` data-model section. UUIDv7 IDs, soft-delete columns.
4. **Generate and apply the first migration** — `drizzle-kit generate` + `supabase db push` (or run migration via Drizzle directly against local Supabase). Verify with `supabase studio`.
5. **DB clients**
   - `web/lib/db.ts` — Drizzle client.
   - `pipeline/narrator/db.py` — psycopg connection helper (reads `DATABASE_URL` from `pipeline/.env`).
   - `pipeline/narrator/queries.py` — first thin function: `claim_next_job(worker_id)`.
6. **Storage abstraction**
   - `web/lib/storage.ts` — `uploadDeck`, `signedUrl`, `putSlidePng`, `putAudioMp3`, `putRender`. Wraps `@supabase/supabase-js` storage client.
   - `pipeline/narrator/storage.py` — same surface, Python.
7. **Anonymous identity**
   - `web/lib/auth.ts` — read/set `pptalk_uid` cookie (HTTP-only, SameSite=Lax, 1-year expiry); upsert into `users`; expose `getCurrentUser()` for routes and server components.
8. **Seed sample decks** — Supabase migration that inserts a `system` user + 2 sample projects (1 corporate-skills + 1 technical from `samples/`). Each new user sees them in their project list as read-only. Render outputs (MP4s) for these samples are pre-uploaded to `pptalk-private/system/{project_id}/renders/seed.mp4` so they show finished without re-rendering.

**Phase 0 exits when:** `web` boots against local Supabase, anonymous cookie creates a user, `samples` show in the home page (UI for the home page comes in Phase 1), and the pipeline can read `DATABASE_URL` and successfully `claim_next_job` against an empty queue.

---

## Phase 1 — Pipeline correctness (DONE 2026-05-06)

The render path must be *correct* before we redesign the UI on top of it. Each item is a focused fix to existing code.

1. **Speaker-notes extraction** — extend `parse.py` to read `slide.notes_slide.notes_text_frame` per `python-pptx`; add `speaker_notes` to the `Slide` dataclass; write to `slides.speaker_notes` column.
2. **PDF input path** — new `parse_pdf.py` (PyMuPDF text per page) and `render_pdf.py` (PyMuPDF page-to-png, skip LibreOffice). `cli.py` and the worker dispatch on `source_kind`.
3. **LibreOffice path env** — `render.py` reads `LIBREOFFICE_PATH` (default `/Applications/LibreOffice.app/Contents/MacOS/soffice`).
4. **Native aspect ratio in encode** — `video.py` reads dimensions from the first PNG, picks a target resolution that preserves source aspect (e.g., 4:3 → 1440×1080, 16:9 → 1920×1080), drops the letterbox pad filter when source matches.
5. **Anthropic prompt caching** — wrap `SYSTEM_PROMPT` in a `cache_control: {type: "ephemeral"}` block. Verify in `usage.py` that `cache_read_tokens` is non-zero on the second slide of a deck. Cost-of-script section of `usage_events` should drop materially.
6. **TTS migration to `gpt-4o-mini-tts`** — change `_MODEL` in `tts.py`. Update `OPENAI_TTS_PER_MCHAR` to `{"gpt-4o-mini-tts": 15.0, "tts-1-hd": 30.0, "tts-1": 15.0}` (keep historical models for old runs.csv rows). The 6 voices are unchanged.
7. **Worker mode** — new `narrator worker` subcommand: poll-claim-process loop. Each job: read `render_jobs.payload`, dispatch to the existing render pipeline functions, write artifacts via `storage.py`, update `slides`/`renders`/`usage_events`, emit progress as DB updates (no SSE in worker mode — the web subscribes via Realtime). The existing `narrator render <pptx>` CLI stays for local one-shot debugging.
8. **Per-slide regen support** — refactor `cli.py`'s narrate/tts steps so a `regen_one_slide(slide_id)` path exists in the worker. Reads slide PNG from storage, calls `generate_slide_script`, writes back, optionally enqueues a `slide_tts` job.

**Phase 1 exits when:** the worker can pick up a `full_render` job inserted by hand into `render_jobs`, render it correctly with native aspect ratio + correct speaker-notes-driven script when present + cached system prompt, and write the MP4 to Supabase Storage with a row in `renders`. Both PPTX and PDF inputs work end-to-end.

---

## Phase 2 — Web foundation (DONE 2026-05-06)

Now that the pipeline is correct and the DB exists, build the web shell that uses it.

1. **Project lifecycle API** (`web/app/api/projects/`)
   - `POST /api/projects` — accept upload, write to storage, insert `projects` row, enqueue parse + rasterize via a `full_render` job (or split out a lighter `parse_only` job kind so the editor opens before TTS runs — recommended).
   - `GET /api/projects` — list current user's projects (plus seeded `system` samples).
   - `GET /api/projects/[id]` — project details including slides.
   - `PATCH /api/projects/[id]` — rename, soft-delete.
2. **Slide API** (`web/app/api/slides/`)
   - `PATCH /api/slides/[id]` — update `script` and/or `script_locked`. Auto-save endpoint.
   - `POST /api/slides/[id]/regen` — enqueue a `slide_script_regen` job.
   - `POST /api/slides/[id]/tts` — enqueue a `slide_tts` job.
   - `POST /api/slides/reorder` — accept ordered array of slide_ids, update `idx`.
3. **Render API** (`web/app/api/renders/`)
   - `POST /api/renders` — enqueue a `full_render` job (kicked from the export modal).
   - `GET /api/renders/[id]` — status. Or skip if Realtime covers it.
4. **Realtime wiring** — `lib/realtime.ts`: subscribe to `postgres_changes` on `render_jobs` and `slides` for the current project.
5. **Replace `route.ts` SSE-from-subprocess flow** — keep the file for now as a fallback/local-debug path, but the new flow is upload → API → worker → Realtime.

(Design hat owns the next phase; engineering hands off a working API surface here.)

**Phase 2 exits when:** a manual API client (curl / Postman) can: create a project from a PPTX, list projects, read slide scripts, edit a script, reorder slides, regen a slide, and trigger a full render that completes. No UI for any of this yet.

---

## Phase 3 — Home + editor + export UI (DONE 2026-05-06)

This is the surface a friend actually uses. UX references locked in `hats/design.md`.

1. **App shell** (`web/app/layout.tsx`) — Inter + JetBrains Mono fonts, color tokens, `<Toaster/>`, top-level `cmd+k` provider.
2. **Home page** (`web/app/page.tsx`) — Linear-style projects list. Sample row group at top (read-only "Samples" header), user's projects below. Top-right primary "New project" button (opens upload dialog). `/api/projects` for data.
3. **New-project dialog** — drag-drop / file picker, accepts PPTX + PDF. POSTs to `/api/projects`, listens to job status via Realtime, shows parsing/rasterizing progress, redirects to editor when slides exist.
4. **Editor** (`web/app/p/[id]/page.tsx`) — Descript-style three-pane:
   - Left rail: slide thumbnails (PNG via `signedUrl`), index + drag handle, dnd-kit sortable. Inline play button per thumbnail when audio exists.
   - Center: large preview of selected slide.
   - Right: script textarea (auto-save debounced 500ms), voice picker (collapsed), per-slide "Regenerate" button. Captions toggle is in export, not here.
   - Top bar: project name (rename inline), "Saved 2s ago" chip, top-right "Export" button.
5. **Voice picker component** — grouped (Authoritative / Warm-Narrative / Energetic-Neutral), friendly names from research, click-to-play sample audio (small cached MP3 per voice), default Alloy.
6. **Export modal** — Loom-style. Captions toggle, quality toggle (720/1080), "Render" button morphs into determinate progress bar, then resolves to "Copy link / Download MP4." Pulls progress from Realtime on the latest `render_jobs` row for the project.
7. **Cmd+K palette** — shadcn `command`. Actions: New project, Open sample (1, 2), Switch to project (fuzzy), Open editor for current project's slide N. Nav-only for now.
8. **Auto-save UX** — debounced PATCH on script change; chip in top bar reflects state (Saving… / Saved Xs ago / Save failed).
9. **Empty / loading / error states** — skeletons on home and editor; error toasts for API failures.

**Phase 3 exits when:** a friend can land on `localhost:3000`, click a sample, watch a finished video, click "New project," upload one of their PPTX/PDF files, edit a script line, reorder a slide, regenerate one, hit Export with captions on, and download the resulting MP4 — without touching the terminal.

---

## Phase 4 — Polish (in progress)

The pieces that turn "works" into "wow."

1. **Native-aspect render verification** — render each `samples/` deck with the new pipeline, confirm 16:9 vs 4:3 detected correctly; spot-check audio sync.
2. **Sample gallery curation** (content) — pick the best two finished outputs to ship as the seeded sample projects. Replace the seed MP4s in storage. Confirm rights for any deck whose output ends up visible in the demo (user said `samples/` are OK; flag if a corporate-skills deck lands later).
3. **Voice picker copy + sample audio** (content + design) — record a 10-second sample line for each voice (same line) and stash in `web/public/voices/{voice}.mp3`.
4. **Editor micro-interactions** (design) — drag-reorder hover affordance, regen button states (idle / queued / running / done), per-slide play button focus/playing states, accent-blue selection ring on the active thumbnail.
5. **Error boundaries + recovery** — long renders shouldn't strand the user; if a render fails, the export modal shows the error and a "Retry" button that enqueues a fresh `full_render`.
6. **End-to-end smoke** — full pass through `samples/` and at least one PDF input. Capture any visible jank in `weekly/<this-monday>.md` review.

**Phase 4 exits when:** the user runs through the full flow and says it's good enough to put in front of their first close friend.

---

## Phase 5 — On hold (skills, future work) (parked)

Deliberately not started. These are valuable when the product moves from demo → launch.

- Skills under `.claude/skills/`: `golden-deck-qa`, `prd`, `discovery`, `unit-economics`, `launch-readiness`, `weekly`.
- Cloud hosting (Vercel + Fly worker against the same Supabase project — should be a config swap, not a rewrite, by design).
- Auth (Supabase Auth flip — anonymous users carry over via `browser_id` → `email` association).
- Stripe + paywall + credit model.
- Voice cloning (re-evaluate the TTS provider when this becomes the next bet).
- Public landing page, marketing copy, SEO.
- ToS, privacy policy, Stripe Tax.

When the user says "we're going to launch," reopen `hats/growth.md` and `hats/ops.md` and re-plan.

---

## Hat ownership at a glance

| Phase | Eng | Design | Content | Growth | Ops |
|---|:-:|:-:|:-:|:-:|:-:|
| 0 Foundation | ◉ | | | | |
| 1 Pipeline correctness | ◉ | | | | |
| 2 Web API | ◉ | ○ | | | |
| 3 Home + editor + export | ◉ | ◉ | ○ | | |
| 4 Polish | ◉ | ◉ | ◉ | | |
| 5 On hold | | | | (parked) | (parked) |

◉ = primary owner. ○ = consulted.

---

## When this plan changes

- New scope item lands in `SCOPE-DEMO.md` → revisit which phase it belongs in.
- A phase's "exits when" condition turns out wrong → update the plan, don't paper over.
- A blocking dependency surfaces (e.g., Supabase Realtime can't carry the load) → swap the dependency, note in `hats/engineering.md`.
- The user pivots phase (e.g., "let's deploy now") → roll Phase 5 items forward.
