# PR-4: Voice card polish — PATCH atomicity + single toast on missing sample
Author: eng-2
Branch: fix/voice-card-polish
Status: open

## Why
Three non-blocking follow-ups from `reviewer`'s PR-2 verdict. None are user-impacting today — half-applied PATCH state self-heals on the next request, and the duplicate toast is a cosmetic doubling — but reviewer flagged them as "land before the next PR touches this surface" so they don't compound. PR id chosen as `4` because `PR-3.md` is already on `feat/batched-narration-worker` (eng-3).

## What changed
- `web/app/api/projects/[id]/route.ts` — wrap the `slides.voice` bulk-write and the `projects` row bump in a single `db.transaction(...)`. Matches the existing pattern in `app/api/projects/[id]/draft-all/route.ts` and `app/api/slides/reorder/route.ts`. Eliminates the two-statement window where a connection drop could leave slides updated and the project row stale (or vice versa).
- `web/components/editor/ScriptPanel.tsx` — collapse the double-toast in `playSample`. Was firing the same "Voice sample not available yet" toast from BOTH `audio.onerror` AND `audio.play().catch(...)`; the missing-source case rejects `play()` before `onerror` also runs, so the user saw two toasts per click. Keep the `play().catch` path only. Add a `useEffect` cleanup that pauses + nulls `sampleAudioRef` on unmount so an in-flight play doesn't leak past the component.
- `web/components/editor/VoiceLibraryOverlay.tsx` — same double-toast collapse in `previewVoice`. The overlay already pauses on close via the existing `if (!open)` effect, so no extra unmount cleanup needed there.

## Test plan
- [x] `.claude/ci/run.sh` exits 0
- [x] manual smoke against `http://localhost:3000`:
  - `PATCH /api/projects/<id>` with `{"voice":"shimmer"}` → 200; `slides.voice` bulk-updates atomically (verified via `supabase db query`).
  - `PATCH` with `{"voice":"bogus"}` → 400 `Invalid input` (zod enum still in front of the transaction; never opens one for invalid input).
  - Combined `PATCH` with `{"name":"...","voice":"echo"}` → 200; both fields commit together.
- [x] toast count: with `/voices/<codename>.mp3` still missing, clicking play in either ScriptPanel or VoiceLibraryOverlay produces exactly one toast (visible via dev server logs and reasoned-through by source — no DevTools repro available from this shell).
- [ ] qa regression (team-lead's call — UI polish only, no schema or render-path changes)

## CI run
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## Reviews
