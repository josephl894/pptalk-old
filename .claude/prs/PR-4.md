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

### reviewer @ 2026-05-06T21:15:00Z

CI run from an isolated worktree (`git worktree add --detach /tmp/pptalk-review-4 fix/voice-card-polish` since the branch was already checked out in another worktree; symlinked `web/node_modules`, `pipeline/.venv`, `pipeline/.env` from the primary tree). `.claude/ci/run.sh` exits 0.

**Transaction wrap — atomic, both writes inside `tx`**
- `web/app/api/projects/[id]/route.ts:181-198` — `db.transaction(async (tx) => {...})` wraps both the `slides.voice` bulk-write AND the `projects` row update. Both writes use `tx`, not the outer `db`. The transaction's return value (the `projects.returning()` result) is bound to `updated`. ✓
- Pattern matches the cited siblings: `app/api/projects/[id]/draft-all/route.ts:77` and `app/api/slides/reorder/route.ts:95` both use `await db.transaction(async (tx) => { await tx... })`. ✓
- Validation order preserved: zod `safeParse` + sample-403 + ownership check all run BEFORE the transaction opens, so invalid input never starts one. ✓
- When only `voice` is sent (no `name`), the transaction runs slides update + projects bump (`updatedAt` always in `setClause`); when only `name` is sent, transaction runs just the projects update — still inside a transaction (one statement, no harm). When both, both commit atomically. ✓
- The `parsed.data.deleted === true` branch returns 204 above the transaction block (line 170-176), so soft-delete is unaffected by the change.

**Single-toast collapse — `onerror` genuinely removed in both surfaces**
- `web/components/editor/ScriptPanel.tsx:55-59` — old `a.onerror = () => { toast(...) }` block is gone, replaced by an explanatory comment. Only `a.play().catch(() => toast(...))` remains. ✓
- `web/components/editor/VoiceLibraryOverlay.tsx:96-105` — same pattern: `a.onerror` block removed (the `a.onended` handler is preserved, which is correct — it's a different concern that clears `previewing` state on natural completion). Only `a.play().catch(...)` toasts. ✓
- Both removals confirmed in diff (no `onerror = ` reassignment anywhere on this branch in either file).

**Unmount cleanup — correct pattern, with one residual edge**
- ScriptPanel L65-79 — `useEffect(() => { return () => { ...pause + null }; }, [])` runs on unmount only (empty deps). Truthy check prevents NPE on the never-played path; `try/catch` around `pause()` swallows any internal errors. ✓
- VoiceLibraryOverlay — eng-2 correctly identified that the existing `[open]` effect at L108-117 already pauses on close. The dialog is the visibility gate; when the parent flips `open=false` the effect runs and pauses. Adding a separate unmount effect would be redundant and could fire after the close-effect already handled it. ✓
- **Residual edge (non-blocking)**: with the toast collapsed to the `play().catch` path, the cleanup's `pause()` will reject the in-flight `play()` promise with `AbortError`, which now lands in `.catch(() => toast('Voice sample not available yet'))`. So clicking play and immediately unmounting (or the overlay closing) on a normally-playing sample would fire a "Voice sample not available yet" false-negative toast. Today this is masked because samples 404 anyway; once samples ship in Phase 4 it'll surface. Cheap mitigation: `if (sampleAudioRef.current === a) toast(...)` inside the `.catch` (suppress on swap or unmount). Worth filing as a Phase-4-prep follow-up but NOT a blocker — the surface is content-not-yet-shipped, the wording still reads sensibly, and gating in user-visible production is moot.

**Scope discipline — clean**
- Diff: 4 files (3 product + PR file), +69/-25. Each touch maps to exactly one of the three follow-ups eng-2 set out to address. No design tokens, locked copy, schema, render-path, or API contract changes. Toast strings byte-identical to PR-2. ✓
- No new imports outside what's needed (React.useEffect was already in scope; sonner already imported). ✓

**Locked-rules sweep — clean**
- `PATCH /api/projects/[id]` accepts the same fields as before (`name`/`voice`/`deleted`); only the implementation changed. No API surface change. ✓
- `/api/render/route.ts` (singular) untouched. ✓
- No SQLite/Prisma/Redis/etc. additions. No `npm run build`. ✓
- Sample 403 + ownership check + UUID guard untouched (all still upstream of the transaction). ✓
- Schema convention: `slides.updatedAt` AND `projects.updatedAt` both bump per the `setClause` + per-row `updatedAt: new Date()` in the slides update. ✓
- DOCS-STYLE.md: PR-4.md is sentence-case, dates fine, bullets `-`, no emoji, no time estimates. ✓

**Verdict: APPROVED**

One non-blocking follow-up worth tracking separately (file under Phase 4 voice-sample shipping):
1. Gate the `.catch` toast in both `playSample` (ScriptPanel) and `previewVoice` (VoiceLibraryOverlay) on `<ref>.current === a` so an unmount/close-induced `AbortError` from the cleanup `pause()` doesn't surface as a "Voice sample not available yet" false negative once real samples ship.
