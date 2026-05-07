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
