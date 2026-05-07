# PR-6: Voice samples in Supabase Storage so editor play button actually plays
Author: eng-2
Branch: feat/voice-samples
Status: open

## Why
PR-2 wired the play buttons in the Voice card and Voice library overlay to `/voices/<codename>.mp3`, but the actual sample files were never created — every click produced the "Voice sample not available yet" toast. User flagged it again on 2026-05-06 (`localhost:3000/voices/nova.mp3` 404). This PR delivers the samples server-side so the play button actually plays. Initial implementation committed the MP3s to `web/public/voices/`; user course-corrected to put them in Supabase Storage instead, aligning with the rest of the audio in this stack (slide MP3s already live there). Reset and reimplemented.

## What changed
- `pipeline/scripts/generate_voice_samples.py` — idempotent generator. Renders one ~2-second MP3 per OpenAI voice (`alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`) through `gpt-4o-mini-tts` (the locked TTS model) with the phrase `"Hi, I'm <Name>. I'll narrate your slides."` for A/B compare. Ensures a public-read `voice-samples` bucket exists, upserts each MP3 at `voice-samples/<codename>.mp3`. Re-runs are safe (bucket-creation swallows the "already exists" path; uploads upsert).
- `web/components/editor/VoiceLibraryOverlay.tsx` — exports a new `voiceSampleUrl(codename)` helper that composes `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/voice-samples/<codename>.mp3` client-side. `previewVoice` now uses it. No extra round-trip; the env var is literal `process.env.NEXT_PUBLIC_*` per `hats/engineering.md` pitfall #2 so webpack inlines it into the client bundle.
- `web/components/editor/ScriptPanel.tsx` — imports `voiceSampleUrl` and uses it in `playSample`. Same toast-on-error path remains.

No MP3 binaries committed to the repo.

## Bucket choice
**New dedicated `voice-samples` bucket, public-read.** Reasons:
- The existing `pptalk-private` bucket is tied to per-user paths (`{user_id}/{project_id}/...`) and routes everything through signed URLs. Voice samples are global, non-user assets — putting them in `pptalk-private/voice-samples/<voice>.mp3` would either need ACL exceptions or a parallel signed-URL path, both more code than just isolating them.
- A dedicated bucket lets us flip the public flag once at the bucket level instead of per-object, and keeps RLS on `pptalk-private` unambiguous.
- Public-read is fine here: samples are not user-specific; surfacing them does not leak any private data.

## Test plan
- [x] `.claude/ci/run.sh` exits 0 (run from inside `/tmp/pptalk-voice-samples`).
- [x] generator first run: `uv run python scripts/generate_voice_samples.py` from `pipeline/` creates the bucket, uploads 6 MP3s. Bucket created public via `client.storage.create_bucket(BUCKET, options={"public": True})`.
- [x] generator second run: idempotent — bucket-exists path swallows the duplicate error, upload upserts. Verified.
- [x] direct curl smoke (local Supabase): `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:54321/storage/v1/object/public/voice-samples/{alloy,echo,fable,nova,onyx,shimmer}.mp3` → all six return `200 audio/mpeg`.
- [x] cost smoke: 12 rows appended to `pipeline/usage.csv` across two runs, total ~$0.0072 (about $0.0036/run; well under the $0.05 ceiling).
- [ ] live browser smoke (deferred to post-merge or qa): primary tree's :3000 dev server is on `main` and won't have the helper or bucket URL until merge. After merge: hard-reload the editor, click play on each voice card → DevTools Network panel shows `127.0.0.1:54321/storage/v1/object/public/voice-samples/<codename>.mp3` returning 200/audio/mpeg, audio plays, no toast.
- [ ] qa regression (team-lead's call — UI data plumbing only).

## CI run
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## Notes
- Sample-generation rows append to `pipeline/usage.csv` without a `run_id` / `pptx` field (free-standing, not part of any project run). Matches the prior behavior of `synthesize` when called outside a render run.
- Previous version of this PR shipped the MP3s under `web/public/voices/` and bumped the repo by ~340 KB. That commit was reset before any merge; nothing stale remains on the branch.

## Reviews

### reviewer @ 2026-05-07T03:30:00Z

CI run from a per-review worktree (`git worktree add --detach /tmp/pptalk-pr6-review feat/voice-samples` since the branch was already in eng-2's worktree; symlinked `web/node_modules`, `pipeline/.venv`, `pipeline/.env`, `web/.env.local`). `.claude/ci/run.sh` exits 0.

**Bucket choice — sound, idempotency verified empirically**
- `pipeline/scripts/generate_voice_samples.py:31` uses dedicated `voice-samples` bucket. Rationale in PR file is correct: the existing `pptalk-private` bucket is keyed on per-user paths and routed through signed URLs; mixing global non-user samples in there would either need ACL exceptions or a parallel signed-URL path. Cleaner to isolate. ✓
- `ensure_bucket` (L51-63): swallows "exists" / "duplicate" / "already" substrings; re-raises everything else. I ran it twice in a row from the worktree just now — "bucket 'voice-samples' already exists" both times, no exceptions thrown. ✓
- Bucket flagged `public=True` confirmed via `client.storage.list_buckets()` from the worktree. Direct curl smoke from the review worktree against the local Supabase: `alloy.mp3 → 200 audio/mpeg 51456`, `nova.mp3 → 200 audio/mpeg 59520`, `shimmer.mp3 → 200 audio/mpeg 61056`. eng-2's curl smoke independently reproduced. ✓
- Uploads use `file_options={"upsert": "true"}` (L78-82) — re-runs overwrite cleanly. Verified API shape matches `supabase-py`'s `from_().upload(path, file, file_options=...)` signature. ✓

**`NEXT_PUBLIC_SUPABASE_URL` inlining — correct literal access**
- `web/components/editor/VoiceLibraryOverlay.tsx:68`: `const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';` — literal property access, eligible for webpack inlining per `hats/engineering.md` patterns and pitfalls #2. ✓
- The doc-comment above the helper (L57-66) explicitly cites pitfall #2 — good context-survival.
- `?? ''` fallback when env is missing returns `/storage/v1/object/public/voice-samples/<x>.mp3` which `new Audio(...)` resolves against current origin (e.g. `localhost:3000/...`) and 404s into the existing toast path. Safe failure mode (user gets the "Voice sample not available yet" toast they already understand from PR-2/PR-4). Non-blocking.

**No MP3 binaries — confirmed**
- `git diff main...feat/voice-samples --numstat | awk` for binary diffs (`-` width/height) returns "no binary diffs". ✓
- `web/public/voices/` does not exist on the branch (`ls` reports no such directory). ✓
- `git ls-files --error-unmatch web/public/voices/` returns "did not match any file(s) known to git". ✓
- Diff stat: 4 files, +150/-3, all source. ✓

**Toast-on-error path preserved (PR-4 single-toast rule)**
- ScriptPanel `playSample` (L50-65 of file post-change): `new Audio(voiceSampleUrl(codename))` → still goes through `play().catch(toast)` only. The PR-4 `onerror` removal stays. ✓
- VoiceLibraryOverlay `previewVoice` (L106-116): same — `play().catch(toast)` only. ✓
- The unmount-cleanup `useEffect` from PR-4 in ScriptPanel is preserved. ✓

**History — clean**
- `git log main..feat/voice-samples` shows exactly two commits: `f7f5974 feat: voice samples in Supabase Storage public bucket`, `62b502a docs: rewrite PR-6 for storage-backed voice samples`. Matches team-lead's claim. The prior MP3-in-repo commits are gone, and as noted in the PR file the repo has no remote so this is local-only history adjustment, not a force-push violation. ✓

**Subtle observations (non-blocking)**
1. `ensure_bucket` exception filter is string-match-based (`"exists"`/`"duplicate"`/`"already"`). A future supabase-py version that changes the wording would re-raise on what should be idempotent. Conventional approach — fine for now; worth a small comment for context-survival if/when this breaks.
2. `usage.csv` rows from sample generation will have empty `run_id`/`pptx`. eng-2 flagged this — matches existing `synthesize` behavior when called outside a render run. Worth a tiny `--run-id voice-samples-yyyymmdd` flag eventually so cost attribution is searchable, but not blocking.
3. The generator lives at `pipeline/scripts/generate_voice_samples.py` (outside `pipeline/narrator/`), so it isn't on CI's import-smoke path. Intentional and correct — this is an admin one-shot, not part of the runtime tree.

**Locked-rules sweep — clean**
- No `/api/render/route.ts` extension; no API surface change at all (web change is the addition of one client-side helper). ✓
- No SQLite/Prisma/Redis additions, no `npm run build`. ✓
- Sample 403 / `is_sample` not relevant — public bucket, not user data. Auth posture (anonymous cookie) untouched. ✓
- Locked design tokens / locked copy / locked stack untouched. ✓
- DOCS-STYLE.md compliance for PR-6.md: sentence-case headings, dates fine, bullets `-`, no emoji in docs, no time estimates (cost figures aren't effort estimates). ✓

**Verdict: APPROVED**

Live browser smoke deferred to post-merge per team-lead — Joseph clicks play in the editor, DevTools should show `127.0.0.1:54321/storage/v1/object/public/voice-samples/<codename>.mp3 → 200 audio/mpeg`. The reviewer-side empirical curl smokes against the same endpoint already returned 200/audio/mpeg, so the only thing the browser pass adds is the user-facing audio playback experience.
