# Changelog

Append-only log of shipped work. Reverse chronological.

## 2026-05-06 — Voice card hotfix (PR-2)
- Fixed broken Voice card in editor: nested play sub-button was a dead control swallowing the parent overlay-open click. Un-nested both the ScriptPanel card and the VoiceLibraryOverlay cards into sibling `<button>` elements; play sub-button now actually attempts audio (toast on 404 since sample MP3s are Phase 4 content).
- Voice selection now persists: `PATCH /api/projects/[id]` accepts a `voice` field and bulk-updates `slides.voice` for the project (zod enum-validated against the six locked codenames; sample-project 403 gate intact). EditorShell PATCHes on commit and resolves initial voice from existing slides on reload.
- Headless smoke (qa) PASS on API + persistence + SSR. Visual click-through pending human verification.

## 2026-05-06 — Wave 1-3: Hi-Fi shell + Outline overlay
- Wave 1: ported Hi-Fi tokens (paper / ink / coral ramps, status colors, shadow ladder) into `web/app/globals.css` + `web/tailwind.config.ts`. Built shell components (Sidebar, SlideThumb, StatusTag, ProgressRing, icons). Replaced home with 3-col card grid. New `/new` full-page upload. Stub routes `/videos`, `/voices`, `/trash`.
- Wave 2: restyled editor (168px filmstrip, slide preview card, narration card, right rail with voice + settings + render). Trimmed `ExportModal` to 560px Loom shape with two toggles (Captions SRT + Quality 720/1080). Built `VoiceLibraryOverlay` (1080×720) with grouped 6-voice picker. `DelightCheckmark` stays the one designated delight moment.
- Wave 3: empty-script default for slides without speaker notes (`parse_only` writes `script = NULL`; opt-in generation). Editor Outline overlay (Surface 03 adapted) — row-wise list of slides, click-to-jump. "Draft all narrations" bulk action via new `POST /api/projects/[id]/draft-all`. Per-row "Draft this" sparkles + main editor "Draft this slide" inline hint. Reverted `/api/projects` to flat array.
- Six hotfixes captured in `hats/engineering.md` "Patterns and pitfalls" — postgres-js singleton + pool config, `process.env[...]` inlining, dnd-kit SSR via `next/dynamic`, CSS Grid `1fr` vs `minmax(0, 1fr)`, UUID-at-the-boundary, Next 15 RSC `frame.join` ghost.
- Phase 3 exit criteria met. Phase 4 polish next.

## 2026-05-05 — Stack lock + UX direction lock
- Locked stack: Supabase Postgres + Drizzle (TS) + psycopg (Python) + Supabase Storage. No SQLite, no Prisma, no SQLAlchemy, no Redis.
- Locked UX direction: restrained structure + warm brand layer (rejected vibrant Canva-style after multi-agent debate; aiorator's actual UX is restrained-professional).
- TTS migration target: `gpt-4o-mini-tts` (from `tts-1-hd`, half the price + better quality).
- Phase 0 foundation shipped: Supabase local, schema migrated, seed sample, anonymous cookie auth.
- Phase 1 pipeline correctness shipped: speaker notes, PDF input, native aspect, prompt caching, worker mode.

## 2026-05-04 — Wedge + ICP locked
- Wedge C: SMEs publishing training/course content.
- Customer discovery deferred — first 10 paying US users = validation gate.
