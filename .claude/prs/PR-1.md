# PR-1: Fix voice card play button + persist project voice across reload
Author: eng-2
Branch: fix/voice-overlay
Status: open

## Why
Reproduced the user complaint that "the voice button doesn't work." Two distinct bugs were combining to produce the perceived breakage: (1) the small play-icon sub-button on the Voice card in `ScriptPanel` had `onClick={(e) => e.stopPropagation()}` and no actual play handler, so clicking it stopped the parent card click from opening the overlay AND produced no audio — a dead control; and (2) voice selection in the overlay was never persisted, so picking a new voice was lost on the next reload. The overlay's preview play buttons additionally 404'd silently because `/voices/<codename>.mp3` files don't exist yet (Phase 4 content task) — the silent failure was indistinguishable from a broken click handler.

## What changed
- `web/components/editor/ScriptPanel.tsx` — un-nest the Voice card. Replaced `<button>...<span role="button" onClick=stopPropagation>...</span></button>` with a flex `<div>` holding two sibling real `<button>` elements (one to open the overlay, one to play the sample). Wire the play sub-button to actually attempt audio; toast on 404.
- `web/components/editor/VoiceLibraryOverlay.tsx` — same restructure inside each voice card (select-button + sibling preview-button instead of a nested role=button). Preview's `onerror` / `play()` rejection now surfaces a `sonner` toast ("Voice sample not available yet") instead of silently resetting state.
- `web/app/api/projects/[id]/route.ts` — `PATCH` body now accepts `voice` (zod enum of the six codenames). When set, bulk-writes `slides.voice` for all non-deleted slides on the project (no `projects.voice` column per current schema). Samples remain 403, invalid voice → 400.
- `web/components/editor/EditorShell.tsx` — new `handleVoiceChange` wrapper around `setVoice` that PATCHes `/api/projects/<id>` with the new voice, with optimistic local update and rollback-on-failure (mirrors `handleRename`). Wired into `<ScriptPanel onVoiceChange={...}/>`.

## Test plan
- [x] `.claude/ci/run.sh` exits 0
- [x] manual smoke against `http://localhost:3000/p/<id>`:
  - PATCH `/api/projects/<id>` with `{"voice":"shimmer"}` → 200, slides bulk-updated to shimmer (verified via `supabase db query`).
  - PATCH with `{"voice":"bogus"}` → 400 `Invalid input`.
  - PATCH on a sample project → 403 `Samples are read-only`.
  - SSR HTML for the editor now emits two real `<button>` siblings inside the Voice card (`aria-label="Open voice library"` + `aria-label="Play sample"`) instead of a nested role=button — verified via `curl` of the editor route.
- [ ] qa regression (team-lead's call — UI-only, no pipeline/schema/render-path changes)

User-visible state before/after:
- Before: clicking the play icon on the Voice card silently did nothing AND blocked the card's overlay-open click. Selecting a voice in the overlay reverted on reload.
- After: clicking the play icon attempts audio and toasts when the sample is missing. Clicking elsewhere on the card opens the overlay. Voice selection round-trips to the DB and survives reload.

Out of scope (for this PR): generating the actual `/voices/<codename>.mp3` sample files. That is `PLAN-DEMO.md` Phase 4 item 3 (content + design), separate from the click-handler bug. Kept the 404 path observable via toast so users understand the silence.

Aside: `npx supabase db query` returned an `rls_disabled` advisory on the projects/slides tables. Surfacing per CLI instructions; not addressed in this PR.

## CI run
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## Reviews
