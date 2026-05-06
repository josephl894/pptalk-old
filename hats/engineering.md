# Engineering hat

## Persona
Pragmatic full-stack solo dev. Ship boring tech that works. Optimize for time-to-first-customer, not architecture. Lay foundations once when the cost of migrating later is clearly higher than the cost of building right now.

## Current focus
Building the **demo version** described in `/SCOPE-DEMO.md`. Goal: a polished local app that close friends can sit down with and react to. The full in/out boundary lives in that doc.

## Locked stack
- **Frontend:** Next.js 15, Tailwind, shadcn/ui (Radix-based)
- **DB:** Postgres via Supabase (`supabase start` for local; same project local → cloud)
- **TS ORM:** Drizzle (schema-typed, lightweight, raw-SQL-ish syntax)
- **Python pipeline DB:** psycopg + thin `queries.py` module
- **Object storage:** Supabase Storage for source decks, slide PNGs, audio MP3s, MP4s, SRTs
- **Auth:** not enabled now; `user_id` populated with anonymous browser cookie ID; Supabase Auth slot ready
- **TTS:** OpenAI `gpt-4o-mini-tts` (migrated from `tts-1-hd` because tts-1-hd is on Microsoft Foundry's 2026-06-18 shutdown list and 4o-mini is half the price with better quality + instructable prosody)
- **Script LLM:** Claude Haiku 4.5 with prompt caching on the system prompt
- **Render queue:** `render_jobs` table polled with `FOR UPDATE SKIP LOCKED`. Worker = the existing Python pipeline as a long-lived process
- **IDs:** UUIDv7 everywhere
- **Schema convention:** every user-owned table has `user_id`, `created_at`, `updated_at`, `deleted_at`

Explicitly not in the stack: SQLite, Prisma, SQLAlchemy, Redis, Inngest, trigger.dev, Datadog, pgvector. Add only when a feature needs them.

## ICP-driven design choices
SMEs publishing training/course content already have **speaker notes** in their decks — but the main case for the demo version is decks **without** notes (PDFs, screenshare exports, older slides). Therefore:
- **Speaker notes are first-class input when present** (PPTX), but the script generator must work fluently from slide content alone.
- **Lecture pacing default** (~140 wpm). Faster for sales decks, slower for technical material.
- **Captions** ship in this version — accessibility + watch-without-sound is non-negotiable for course platforms.
- **Voice cloning is OUT** — `gpt-4o-mini-tts` doesn't support it (custom voices are a sales-gated OpenAI feature). Listed as v2+.

## Audit findings (existing pipeline + web)

Carries forward unchanged: orchestration in `cli.py`, parallel narrate (3) + TTS (8), JSON event emission to stderr, cost telemetry shape in `usage.py`, ffmpeg single-pass encode. The SSE wiring in `web/app/api/render/route.ts` and runner subprocess pattern in `web/lib/runner.ts` are legacy, slated for removal in Phase 2 cutover — superseded by the `render_jobs` + worker + Realtime path.

Gaps to close (closed 2026-05-06):
- ~~`parse.py` does not extract speaker notes — required for PPTX with notes.~~ (closed 2026-05-06)
- ~~No PDF input path — `parse.py` is PPTX-only; needs a PDF text extractor (PyMuPDF text per page) and `render.py` should skip LibreOffice for PDF input.~~ (closed 2026-05-06)
- ~~`render.py` hardcodes `/Applications/LibreOffice.app/...` — must become `LIBREOFFICE_PATH` env with sensible defaults.~~ (closed 2026-05-06)
- ~~`video.py` hardcodes 1920×1080 letterboxing — must detect source aspect (PNG dimensions) and render native.~~ (closed 2026-05-06)
- ~~`script.py` does not use Anthropic prompt caching — adding `cache_control` on the system prompt unlocks ~90% input-cost savings on per-slide vision calls.~~ (closed 2026-05-06; Haiku 4.5 4096-token cache floor still applies — see `memory/project_haiku_cache_floor.md`)
- ~~TTS migration: `tts-1-hd` → `gpt-4o-mini-tts`. Voice list is the same 6.~~ (closed 2026-05-06)
- ~~DB layer: zero. Need `pipeline/narrator/queries.py` (psycopg) + a `db.py` connection helper.~~ (closed 2026-05-06)
- ~~Storage abstraction: zero. Pipeline currently writes to local paths; needs `storage.py` that writes via Supabase Storage SDK (Python).~~ (closed 2026-05-06)
- ~~Long-running worker mode: pipeline is one-shot CLI. Need a `narrator worker` command that polls `render_jobs` until killed.~~ (closed 2026-05-06)
- ~~Web persistence: zero. Need a Drizzle schema + migrations, `lib/db.ts`, `lib/storage.ts`, `lib/auth.ts` (anonymous cookie), and routes/components for projects + editor.~~ (closed 2026-05-06)

## Open technical questions (after lock)
- [x] ~~Captions implementation: per-slide segments from audio duration is the demo bar. Word-aligned via Whisper is a v2 question.~~ — per-slide segments locked; word-aligned deferred to v2 (locked 2026-05-05).
- [ ] Anonymous user cookie format: opaque random vs signed. Lean opaque random + Supabase service-role lookup.
- [x] ~~Sample deck seeding: Supabase migration that inserts under a `system` user, surfaced in every user's project list as read-only "samples."~~ — confirmed (locked 2026-05-05).
- [x] ~~Project status streaming: Supabase Realtime (postgres_changes) vs SSE polling.~~ — Realtime (locked 2026-05-06; wired in Wave 2).
- [x] ~~Slide reorder semantics: does reorder re-render the whole video on next export, or just renumber (audio per slide is unchanged)?~~ — renumber, no re-render (set 2026-05-06).

## API surface (current)

Locked routes (web → DB):
- `GET /api/projects` → flat array of the user's projects + visible samples (latest_render attached when status=rendered). **Flat array, not wrapped** — Phase 2 contract.
- `POST /api/projects` → multipart upload (file + name); returns `{project, job_id}`. Inserts project + enqueues `parse_only`.
- `GET /api/projects/[id]` / `PATCH /api/projects/[id]` — read project + slides; rename / soft-delete.
- `POST /api/projects/[id]/draft-all` → backs the editor's **Outline overlay** "Draft all narrations" bulk action. Enqueues a `slide_script_regen` job for every slide in the project where `script_locked=false` AND `(script IS NULL OR script = '')` AND `deleted_at IS NULL`. Returns `{job_ids, slide_ids}`. Single transaction (insert N jobs + bump `slides.updated_at` so realtime fires for clients viewing the overview overlay). 403 on samples; 404 on bad UUID; 200 with empty arrays when nothing to draft.
- `PATCH /api/slides/[id]` — update `script` / `script_locked`. Auto-save endpoint.
- `POST /api/slides/[id]/regen` — single-slide `slide_script_regen`. Clears `script_locked` (manual edit locks; manual regen unlocks).
- `POST /api/slides/[id]/tts` — single-slide `slide_tts`.
- `POST /api/slides/reorder` — bulk reorder.
- `POST /api/renders` — enqueue `full_render`.

## Patterns and pitfalls (captured 2026-05-06)

Wave 1-3 hotfix lessons, problem → why → fix per `DOCS-STYLE.md` rule 13.

1. **postgres-js client must be a `globalThis` singleton across HMR.** Next dev re-evaluates server modules on every save; without a cache the pool leaks one client per HMR cycle until Postgres exhausts. Cache on `globalThis.__pptalk_pg` in non-production. Pool config: `max: 10, idle_timeout: 20, max_lifetime: 60 * 30, prepare: false` (Supabase transaction-pool mode rejects PREPARE).
2. **`process.env[varName]` doesn't inline `NEXT_PUBLIC_*` into the client bundle.** Webpack only static-replaces literal property access (`process.env.NEXT_PUBLIC_FOO`). Bracket notation is opaque to the replacement pass and silently resolves to `undefined` in the browser. Server-only vars (no `NEXT_PUBLIC_` prefix) can use bracket notation safely — Node has the actual env at runtime.
3. **dnd-kit auto-numbers `DndDescribedBy-N` ids and breaks SSR hydration.** The module-level counter advances at SSR but resets on the client, so `aria-describedby` mismatches. Render `SceneRail` (or any `DndContext` consumer) via `next/dynamic` with `ssr: false`. Reserve layout space with a placeholder `loading` component (matches the rail's 168px column so layout doesn't shift on hydration).
4. **CSS Grid `1fr` is `minmax(auto, 1fr)`.** The `auto` min-track-size respects the row's min-content height. With a 1080px slide image inside a `1fr` row, the row inflates past viewport. Use `minmax(0, 1fr)` whenever the row's height must equal the parent's available space, not the content's intrinsic minimum. Same principle for flex items: add `min-h-0` (or `min-w-0`) to any flex/grid item where default `min-content auto` would push the parent.
5. **UUID validation at the route boundary.** `getProjectForUser` and `getSlideWithProject` short-circuit on non-UUID input via a `UUID_RE` regex. Prevents Postgres `22P02 invalid input syntax for type uuid` from surfacing as 500 on user-supplied path params.
6. **Next 15 dev-mode RSC `frame.join is not a function` / `chunk.reason.enqueueModel is not a function`.** Non-deterministic, surfaces under aggressive parallel HMR-driven render. Recovers on the next request. Not actionable; documented so future probes don't chase ghosts.

## Risks
- **PPTX rendering fidelity** — fonts, animations, embedded media will break edge cases. Holding LibreOffice → PDF → PNG; we lose animation but gain reliability. Known.
- **Cost drift** — even at half the TTS price under `gpt-4o-mini-tts`, a 15-min cap × $0.015/min = $0.23 per render. Tens of demo renders per week is fine. Will be re-examined when paid users land.
- **Render time** — current single-pass ffmpeg is fast on small decks; 100-slide 15-min cap may push past the impatience threshold. Async + visible progress mandatory (already wired). Will benchmark on the largest sample deck.

## Build vs buy
- TTS: **buy** (OpenAI for now; reassess against ElevenLabs / Cartesia after demos).
- Voice cloning: **buy** when we add it (out of this version).
- Slide parsing: **build** (thin wrapper around LibreOffice + python-pptx + PyMuPDF).
- Avatar: **buy** if we ever do (HeyGen / D-ID API). Out of this version.
- Video render: **build** (ffmpeg) — core differentiator.
- Auth: **buy** (Supabase Auth) when we add it.
- Payments: **buy** (Stripe) when we add it.
