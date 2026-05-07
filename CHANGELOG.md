# Changelog

Append-only log of shipped work. Reverse chronological.

## 2026-05-07 — PDF upload no longer stuck on "parsing" (PR-7)
- Fixed two issues that surfaced when a PDF was uploaded on `/new` with the worker not running: (a) `/new` short-circuits its 90s poll and routes to the editor as soon as a parse stall is detected, instead of spinning forever; (b) `EditorShell` renders a non-blocking banner (`role="alert"`, `data-testid="worker-not-available"`) when a `parse_only` job has been queued >30s, naming the worker process and giving the start command. Job stays `queued` so a started worker still picks it up.
- Triage finding: the dominant root cause for the symptom was that the user's local Python worker (`uv run narrator worker`) wasn't running — the demo flow assumed it. The new visibility surface makes that obvious instead of silent.
- Bonus correctness fix: both `parse.py` (PPTX) and `parse_pdf.py` (PDF) used `enumerate(..., start=1)` for slide indices, but the schema, reorder route, and editor display all assume 0-based `idx`. Now 0-based for both formats.
- SPEC-7 went through three drafting amendments mid-flight (`image_path`→`png_path`, `pending`→`queued`, `completed`→`done`) — all schema/enum mismatches in the spec, none impl bugs. Workflow lesson: reference the schema while authoring specs, not from memory.

## 2026-05-06 — Voice samples shipped (PR-6)
- Voice card play button now produces actual audio. Six sample MP3s (one per OpenAI voice: alloy, echo, fable, nova, onyx, shimmer) live in a public-read `voice-samples` Supabase Storage bucket and are fetched client-side via `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/voice-samples/<codename>.mp3`.
- Generator at `pipeline/scripts/generate_voice_samples.py` is idempotent (bucket creation handles already-exists; uploads use upsert). Total cost to regenerate all 6 samples: ~$0.004.
- Same phrase per voice ("Hi, I'm <Name>. I'll narrate your slides.") so users can A/B compare voices.
- No MP3 binaries committed to the repo; assets live only in Supabase Storage.

## 2026-05-06 — Batched narration end-to-end (PR-1 + PR-3)
- Replaced per-slide parallel `ThreadPoolExecutor` narration loop with a single batched Haiku call that returns all narrations at once, parsed via `<<<SLIDE N>>>` delimiters. Preserves true continuity (model sees full deck) and eliminates round-trip stalls.
- Worker / `pipeline_runner.generate_scripts` migrated to the batched path with a chunked-batch fallback for >40-slide decks (chunks of 40 sequential, prior-chunk tail passed as `<previous_narration>` continuation hint for cross-chunk flow). Per-slide progress events fire after each chunk so UI fills mid-render.
- Single-slide regen path (`worker.py` `slide_script_regen` job kind, `generate_slide_script`) intentionally preserved unchanged — still the active code for one-slide rebuilds.
- Worker emits `narrate chunk i/N starting (slides X..Y)` log line for ops visibility on chunked runs.
- Measured speedup on the demo flow: 38-slide deck narrate phase **47s** (was ~2 min via observed UI), 61-slide chunked path **63s** end-to-end through the worker. qa PASS on both single-chunk and chunked.

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
