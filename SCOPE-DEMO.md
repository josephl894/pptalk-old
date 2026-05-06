# SCOPE-DEMO — version we can demo to people

Locked 2026-05-05. The version this doc describes is what we're building toward. Anything not listed here is **out of scope for this version** by default; if you want it in, edit this doc first.

## Goal

A polished, internally hosted product that a close friend (subject-matter expert) can sit down with — drop a deck, pick a voice, get a narrated MP4. The bar is "clean enough that they say wow"; not "ready to charge for."

## In / Out

### In

**Inputs**
- PPTX upload
- PDF upload
- Speaker notes extracted when present (PPTX); slides without notes start with `script = NULL` after parse. Script generation is **opt-in**: per-slide regenerate, the overview overlay's "Draft all narrations" bulk action, or implicit fallback during `full_render`.

**Editor**
- Per-slide script edit (free-form text); empty by default for slides without speaker notes
- Per-slide regenerate (rebuild script from slide image, sub-5s p50)
- "Draft this slide" sparkle hint inline in `ScriptCard` when the textarea is empty and unlocked
- Global voice pick (one voice for the whole deck — see voice picker below; details in `hats/design.md` Locked references)
- Slide reorder (drag-and-drop in left rail)
- Captions toggle (on/off)
- Auto-save (no save button)
- **Outline overlay** (icon button in editor topbar): row-wise list of every slide with thumbnail + script preview. Empty rows show italic "No script yet." + outline `Empty` tag + ghost sparkle "Draft this". Clicking a row closes the overlay and selects that slide in the editor; Esc / X dismisses.
- **"Draft all narrations"** in the overlay header: enqueues a `slide_script_regen` job for every slide where `script_locked = false` AND script is empty. Button morphs into determinate progress (`Drafting N of M`) driven by realtime, then resolves to a terse `Drafted N narrations` for ~3s. No celebration animation — render-complete checkmark stays the only delight moment.

**Output**
- MP4 at the source deck's native aspect ratio (16:9 or 4:3, no letterbox unless a single PNG is non-conforming)
- SRT sidecar when captions are on (per-slide segments based on audio duration; word-level alignment is a v2 question)
- Download or shareable local URL

**Persistence**
- Projects survive across sessions and refreshes
- Each browser has an anonymous user identity (cookie); their projects are visible to them on the home page
- Edits to scripts and voices persist immediately

**App shell**
- Persistent left sidebar (224px): wordmark, primary "+ New project" button, nav (Homepage / My work / My videos / Voice library / Recycle bin), Samples section, anonymous-user footer
- Sidebar's "+ New project" is the **only** new-project entry point (no top-right duplicate, no modal)
- `/new` is a dedicated full-page upload surface (not a dialog) — clicking "+ New project" anywhere routes there

**Home page (`/work`, also default `/`)**
- 3-col card grid of the user's projects (16:9 thumbnail + title + meta + status pill)
- Dashed "+ New project" tile as the first cell — also routes to `/new`
- "Samples" section visible to all users until they create their own
- Cmd+K palette unchanged

**Stub routes (placeholders, full surfaces are post-Wave 1)**
- `/videos` — My videos (renders list)
- `/voices` — Voice library
- `/trash` — Recycle bin

**Sample gallery (within the product, not a marketing site)**
- 1 corporate-skills-training deck
- 1 technical deck (repurposed from `samples/` public-health content)
- Both finished and viewable from the home page

**Telemetry**
- Existing `runs.csv` and `usage.csv` — keep emitting, also write usage events to DB
- No external analytics

### Out

- Authentication (Google OAuth, email signup) — anonymous cookie identity is enough
- Credits, paywall, Stripe, pricing
- New-user onboarding (tutorial, tooltips, walkthroughs)
- Voice cloning (not supported by our TTS provider; on the v2+ list)
- Per-slide voice override (one voice per project for now)
- Multi-user / sharing / comments
- Public landing page, hero video, marketing copy
- SEO content
- Email capture / waitlist
- ToS, privacy policy
- Avatar / talking head
- 9:16 / Shorts aspect output
- Mobile editing (view-only is OK; primary surface is desktop)
- Background music
- Slide animations / transitions in output (slides held for audio duration, hard cuts only)
- Any cloud deployment — local-only until user explicitly opts to host
- Status page, customer support tooling

## Tech stack (locked, see `memory/project_stack.md`)

- **Frontend:** Next.js 15 (existing), Tailwind, **shadcn/ui** (Radix-based)
- **DB:** Postgres via **Supabase** (local dev: `supabase start`; same project local → cloud)
- **TS ORM:** **Drizzle**
- **Python pipeline DB:** **psycopg** + thin `queries.py` module
- **Object storage:** **Supabase Storage** (S3-compatible) for source decks, slide PNGs, audio MP3s, rendered MP4s
- **Auth slot:** Supabase Auth (not enabled yet; `user_id` column populated with anonymous cookie ID)
- **TTS:** OpenAI **`gpt-4o-mini-tts`** (migrate from `tts-1-hd` — half the price, better quality, same 6 voices, instructable prosody for lecture pacing; tts-1-hd is on Microsoft Foundry's 2026-06-18 shutdown list)
- **Script LLM:** Claude Haiku 4.5 with **prompt caching** on the system prompt (current code does not cache — leaves ~90% input-cost savings on the table on per-slide vision calls)
- **Render queue:** `render_jobs` table polled with `FOR UPDATE SKIP LOCKED`. Worker = the existing Python pipeline running as a long-lived process. Locally co-located; same code runs as a separate worker when we deploy.
- **IDs:** UUIDv7 (sortable, distributed-safe)
- **Schema convention:** every table has `created_at`, `updated_at`, `deleted_at`

Explicitly not in the stack: SQLite, Prisma, SQLAlchemy, Redis, Inngest, trigger.dev, Datadog, pgvector. Add only when a feature needs them.

## Voice picker

All 6 OpenAI voices surfaced. Grouped by tone, labeled by use case. Sample-play on click. Default = Alloy.

**Authoritative**
- Onyx — *Executive Male (Deep, Authoritative)* — finance, exec briefings
- Echo — *Technical Male (Calm, Precise)* — engineering, how-to

**Warm / Narrative**
- Fable — *British Male Narrator (Warm, Storyteller)* — case-based teaching
- Shimmer — *Mentor Female (Warm, Approachable)* — healthcare, coaching

**Energetic / Neutral**
- Nova — *Course Host Female (Bright, Engaging)* — course intros
- Alloy — *Neutral Narrator (Balanced, Default)* — generalist; pre-selected

Caveat: no SSML on the native OpenAI API. Pacing is controlled via punctuation and chunking inside the script generator. A pronunciation override / phonetic-spelling field is a known v2 feature (medical and engineering decks need it).

## UX references and design system

Direction (locked 2026-05-05 after multi-agent debate): **restrained structure + warm brand layer**. Linear/Descript/Loom for structure; warm palette and friendly copy on the brand layer; one designated delight moment (render-complete checkmark). Pure vibrant Canva-style was rejected — aiorator's own UX is restrained-professional (verified by direct fetch), and the ICP (Segment B SMEs charging $200-$5000/course) demonstrates higher WTP for restrained tools.

- **App shell:** persistent 224px left sidebar (Linear-modeled) with wordmark, primary "+ New project" coral button, nav (Homepage / My work / My videos / Voice library / Recycle bin), Samples section, anonymous footer. Sidebar is the only new-project entry point.
- **Home:** 3-col card grid of projects (16:9 thumbnail + title + meta + status pill). Dashed "+ New project" tile as first cell. "Samples" section above user projects. Cmd+K palette. One illustrated empty state.
- **New project:** full-page surface at `/new` (not a modal) — drag-drop or file picker; PPTX or PDF.
- **Editor:** Descript Storyboard — resizable ~140px left scene rail with drag-reorder, per-slide right script panel (voice/speed collapsed), sparkle-icon "Regenerate this slide," "Saved" / "Saving" chip in top bar, no timeline.
- **Export:** Loom-style modal — single ~480px centered modal, two toggles (captions, quality), CTA morphs into determinate progress bar then "Copy link / Download MP4." Subtle checkmark animation on completion.

Component library: **shadcn/ui** (copy-paste ownership, Radix primitives, accessible by default).

Design anchors:
- **Type:** Inter (UI) + JetBrains Mono (script editor only). Sizes 12 / 13 / 14 / 16 / 20 / 28. Weights ≤600.
- **Spacing:** Tailwind 4px base, only 4 / 8 / 12 / 16 / 24 / 32 / 48.
- **Color:** background near-warm-white `#FBFAF7` (light) / near-black `#101010` (dark). Single warm accent `#F97461` (warm coral) — primary CTAs and selection only. Greys carry 90% of UI. No gradients on chrome.
- **Chrome:** shadows only `shadow-sm` on floating panels, radius ≤8px, 1px hairlines at ~8% opacity.
- **Motion:** 150-200ms ease-out. No spring overshoots, no bounce.
- **Voice:** confident, terse, human.

## Data model (sketch — to be implemented in Drizzle)

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Anonymous and (later) authed users | id (uuidv7), browser_id, email?, created_at |
| `projects` | One per uploaded deck | id, user_id, name, source_kind (`pptx`\|`pdf`), source_path, aspect_w, aspect_h, num_slides, status, deleted_at |
| `slides` | Ordered slides per project | id, project_id, idx, original_idx, title, body_text, speaker_notes, png_path, script, script_locked, audio_path, audio_duration_s |
| `render_jobs` | Async work queue | id, project_id, kind (`full_render`\|`slide_tts`\|`slide_script_regen`), payload (jsonb), status, claimed_by, attempts |
| `renders` | Finished output history | id, project_id, mp4_path, srt_path?, captions, video_duration_s, video_bytes, cost_usd, created_at |
| `usage_events` | Cost telemetry, project-tagged | id, project_id?, slide_id?, run_id, provider, model, call_type, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, input_chars, output_bytes, cost_usd, duration_s, created_at |

Storage paths (Supabase Storage, bucket `pptalk-private`):
```
{user_id}/{project_id}/source/deck.{pptx|pdf}
{user_id}/{project_id}/slides/{NNN}.png
{user_id}/{project_id}/audio/{NNN}.mp3
{user_id}/{project_id}/renders/{render_id}.mp4
{user_id}/{project_id}/renders/{render_id}.srt
```

## Render pipeline (revised flow)

1. Web uploads source deck → Supabase Storage; inserts `projects` row.
2. Web inserts a `render_jobs` row with kind `full_render`.
3. Python worker claims the job (`FOR UPDATE SKIP LOCKED`).
4. Worker: parse → rasterize → summarize → narrate (per-slide LLM with prompt caching) → tts → encode. Writes artifacts to Storage; updates `slides` rows; emits progress as `usage_events` and a job heartbeat.
5. Web subscribes to job status (Supabase Realtime, or polling — Realtime is the path of least friction).
6. On success, worker writes `renders` row with the MP4 path.

Per-slide regenerate and per-slide TTS run as separate `render_jobs` rows (kind `slide_script_regen` or `slide_tts`) — keeps the queue uniform.

## Open items still to lock

- Anonymous-cookie ID format: opaque random or signed JWT? Lean opaque random + Supabase service-role lookup; revisit if abused.

## Resolved during build

- ~~SRT generation strategy for captions~~ — per-slide segments from audio duration is the demo bar; word-aligned via Whisper deferred to v2 (locked 2026-05-05).
- ~~Sample-deck preload mechanism~~ — Supabase migration that inserts under a `system` user; every new user sees them in their project list as read-only samples (locked 2026-05-05).

## What this version does NOT prove

- Whether SMEs will pay (no paywall, no signup gate).
- Whether the SEO / community / cold-outreach channels work (no marketing surface).
- Whether voice cloning is the killer feature (not supported by current TTS).
- Whether multi-user collaboration matters (no sharing).

Those are next-version questions. Not this one.
