# PR-2: Fix voice card play button + persist project voice across reload
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

### reviewer @ 2026-05-06T18:30:00Z

**API surface (`web/app/api/projects/[id]/route.ts`)**
- L124 — `VOICE_CODENAMES` matches the six locked codenames in `SCOPE-DEMO.md` (`onyx`, `echo`, `fable`, `shimmer`, `nova`, `alloy`). zod enum gives 400 on bogus codename. ✓
- L126-135 — `PatchBody` extension is additive: `voice` is optional alongside existing `name`/`deleted`. Refine still requires at least one field. Response shape (`{project: serializeProject(updated[0])}`) unchanged when only `voice` is sent — `setClause` always carries `updatedAt` so `projects.updatedAt` bumps even when only the bulk-slides update happens, which keeps the list-page sort consistent. ✓
- L162-188 — bulk update is properly scoped: `eq(slides.projectId, id)` AND `isNull(slides.deletedAt)`. Sample-403 short-circuits at L165 before any write. Owner check `project.userId !== user.id` at L168 closes the door for the (currently impossible) case where `getProjectForUser` returns a non-sample project belonging to someone else. Belt-and-braces. ✓
- L184-188 — bulk update sets both `voice` and `updatedAt: new Date()` on `slides`. Schema-convention compliant.
- Concern (non-blocking): the bulk update + `projects` update aren't wrapped in a transaction. If the slides update succeeds and the projects update fails, you get half-applied state (slides bumped, projects.updatedAt stale). Failure mode is benign (next PATCH heals it), but a `db.transaction(async (tx) => ...)` wrapper would be cleaner. Cheap follow-up.

**Editor wiring (`web/components/editor/EditorShell.tsx`)**
- L88-91 — `initialVoice` derives from `initialSlides.find((s) => s.voice)?.voice ?? DEFAULT_VOICE`. Reload picks up whichever slide has voice set first — works because the API bulk-writes all rows to the same value, so "first slide with voice" == the latest pick. ✓
- L93-117 — `handleVoiceChange` mirrors `handleRename`: optimistic local update + rollback on failure + toast.error. Memoized on `[voice, project.id]`. Identical PATCH content-type / error-handling shape as the rename path. ✓
- L194-197 — realtime `onSlideChange` will replay our own slides.voice update back via Supabase Realtime. Because the optimistic local state is already the same value the realtime payload carries, the merge is idempotent (the conditional sets `voice` to `newRow.voice`, which equals what we already optimistically set). No feedback loop. ✓

**Markup restructure (`ScriptPanel.tsx`, `VoiceLibraryOverlay.tsx`)**
- ScriptPanel L114-150 — un-nested correctly: `<div class="pp-card flex">` holding two sibling `<button>` elements. Both are real buttons with `aria-label` ("Open voice library", "Play sample"). Keyboard navigation **improved** vs main: the prior shape made the inner play control unreachable (`tabIndex={-1}`); now both controls are tabbable in DOM order. Visual layout preserved. ✓
- VoiceLibraryOverlay L186-249 — same pattern. `aria-pressed={selected}` correctly moved from the (former) outer button to the inner select-button where it semantically belongs. The waveform stays as the visual selected/preview indicator. ✓
- No hydration mismatch risk: pure structural rearrangement, no module-level counters / `Date.now` / `Math.random` / SSR-only branches introduced. Safe for SSR.

**Toast-on-404 strategy**
- ScriptPanel `playSample` (L44-65): both `audio.onerror` AND `audio.play().catch(...)` toast the same message. On a 404, both handlers can fire — sonner does deduplicate identical toasts within a short window, so users typically see one, but the double-fire is a minor smell. Compare to overlay `previewVoice` (which has the same shape but additional `setPreviewing` work in each branch, so the fork is justifiable there). Suggest a small `let toasted = false` guard or extracting the toast into a single helper to make double-fire impossible. Non-blocking.
- ScriptPanel `playSample` doesn't null-out `sampleAudioRef.current` on unmount. Minor leak, GC will reclaim. Non-blocking.
- Overall: surfacing the 404 as a toast ("Voice sample not available yet") is the right call — silent failure was the actual bug. Wording frames it as content-not-yet-shipped, not "broken." Not user-hostile.

**Static-analysis chain (a)-(d) sanity check**
- (a) Nested interactive content (`<button><span role="button">`) is invalid HTML and known to swallow inner clicks via event-bubbling quirks in some browsers. Plausible root cause of "voice button doesn't work."
- (b) Inner `onClick={(e) => e.stopPropagation()}` had no play handler. Confirmed in diff. Even if the click reached it, no audio would play.
- (c) `voice` not in the prior `PatchBody`. Confirmed in diff.
- (d) `/voices/<codename>.mp3` files don't ship in `web/public/voices/`. Confirmed: no `voices/` dir.

The chain is sound. Browser smoke is qa's call.

**RLS advisory**
- Confirmed pre-existing on main: no schema/migration diff in this PR (`git diff main...fix/voice-overlay -- web/supabase/ web/lib/db/` is empty). Not introduced by PR-2.

**CI**
- `.claude/ci/run.sh` exits 0 on the branch (re-run by reviewer).

**Locked-rules sweep — clean**
- No `/api/render/route.ts` (singular) extension; new flow goes through the existing `/api/projects/[id]` PATCH. ✓
- No design-token changes (`var(--accent)`, `var(--accent-soft)`, `var(--paper-2)`, `var(--ink-2)`, hairlines preserved). ✓
- Locked copy preserved — the locked phrases ("Draft all narrations", "Draft this", "Draft this slide") not touched, and the new toast strings don't collide. ✓
- No SQLite/Prisma/Redis/etc. additions; no `npm run build`. ✓
- Schema convention upheld: `slides.voice` already in schema, bulk update touches `updated_at`, `deleted_at` excluded. ✓
- Auth posture (`getCurrentUser` anon cookie) preserved. ✓
- Aspect ratio path untouched. ✓
- No time estimates anywhere. ✓

**Verdict: APPROVED**

Two non-blocking follow-ups worth tracking separately:
1. Wrap the slides+projects bulk update in `db.transaction(...)` for atomicity.
2. Guard `playSample` against double-toast on 404 (or extract a single helper).

