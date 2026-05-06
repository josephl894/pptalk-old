# Design hat

## Persona
Productivity-tool designer. Trust and "wow in 60 seconds" matter. Brief is **restrained structure + warm brand layer** — neither austere/cold (Linear's tell) nor consumer-flashy (Canva's tell). Hide complexity, show progress, celebrate the output with one well-chosen moment of delight, not a confetti rain.

## Principles
1. **First-result fast.** A close friend opens the app, sees a sample project + a "new project" button, and is in the editor within two clicks.
2. **Show, don't configure.** Opinionated defaults. Voice picker shows audio sample on click, not labels alone.
3. **Trust signals everywhere.** Sample outputs visible on the home page; finished render visible in the editor itself.
4. **Progressive disclosure.** Editor surfaces only the active slide's controls; voice/quality settings live in the export modal.

## Locked references (2026-05-05, after multi-agent debate)

Direction: **restrained structure + warm brand layer.** Linear/Descript/Loom for structure; warm accent + friendly copy + selective delight on the brand layer. Pure vibrant Canva-style was rejected because the aiorator premise didn't hold (aiorator's own UX is restrained-professional, verified by direct fetch) and the ICP (Segment B — SMEs charging $200-$5000/course) demonstrates higher WTP for restrained tools.

- **App shell** (locked 2026-05-05) → persistent 224px left sidebar (Linear-modeled): wordmark + primary "+ New project" coral button + nav items (Homepage / My work / My videos / Voice library / Recycle bin) + Samples section + anonymous-user footer. Active item gets a 3px coral left bar. Sidebar is the only new-project entry — no top-right duplicate.
- **Home / projects page** (locked 2026-05-06) → **Linear**'s project list, expressed as a **3-col card grid**. Each card = 16:9 thumbnail + status pill + title + slides·edited meta. First cell is a dashed "+ New project" tile. Samples render in their own section above the user's projects. Cmd+K palette for navigation. **One illustrated empty state** when the user has no projects (warm, not stock).
- **New project** (locked 2026-05-06) → dedicated full-page surface at `/new` (was a modal). Centered illustration (deck → coral arrow → video tile + waveform), headline "Turn slides into spoken video," dashed drop zone, Browse-files primary CTA.
- **Editor canvas** (locked 2026-05-05) → **Descript**'s Storyboard. Resizable left scene rail (~140px) with drag-reorder, selected slide gets a 2px warm-accent border. Center slide preview. Right panel: editable script at top, voice/speed collapsed below, single "Regenerate this slide" CTA at the bottom (sparkle icon for AI). Auto-save chip in top bar — terse copy ("Saved" / "Saving"). No timeline.
- **Outline overlay** (locked 2026-05-06) → Hi-Fi Surface 03 (`EditorOverview`), repackaged as a Dialog rather than a mode-toggle. ~1080px wide, 78vh tall, opened from a small icon-button in the editor topbar (between AutoSaveChip and Render). Header = title "Outline" + slide-count meta + coral **"Draft all narrations"** CTA + close X. Body = scrollable column of cards, each pairing a 160px slide thumb with the slide's narration text. **Empty-row treatment**: italic "No script yet." + outline `Empty` tag in the row meta + ghost-style sparkle "Draft this" button. Locked rows render the script + a coral `Locked` tag. Clicking a row closes the overlay and selects the slide in the editor proper. Read-only — editing happens in the main editor's textarea.
- **Export modal** (locked 2026-05-05) → **Loom**'s share/export modal. Single ~480px centered modal with two toggles (captions, quality). The CTA button morphs into a determinate progress bar, then into "Copy link / Download MP4." **One delight moment** — a subtle checkmark animation on completion. No confetti. No social-share row. Bulk-draft completion lands as a terse text-only confirmation, never the checkmark — it stays scarce.

## Component library
**shadcn/ui** (copy-paste ownership, Radix primitives, accessible by default). No push-back.

## Design system anchors
- **Type:** Inter for UI, JetBrains Mono for the script editor only. Sizes 12 / 13 / 14 / 16 / 20 / 28. Weights ≤600 (no display weights).
- **Spacing:** Tailwind 4px base; only 4 / 8 / 12 / 16 / 24 / 32 / 48 (avoid 6, 10, 14, 20).
- **Color:** **warm**, not icy. Token ramps (set 2026-05-06 from Hi-Fi handoff):
  - Paper: `--paper #FBFAF7` / `--paper-2 #F5F2EB` / `--paper-3 #EFEBE0`
  - Ink: `--ink #101010` / `--ink-1 #1F1D17` / `--ink-2 #4A463C` / `--ink-3 #6B665A` / `--ink-4 #8E8979` / `--ink-5 #B8B2A0`
  - Accent: `--accent #F97461` / `--accent-2 #F45A45` / `--accent-soft #FDE5DF` / `--accent-tint #FCEFEA`
  - Hairlines: `rgba(20,18,12,0.08)` and `0.14`
  - Status (muted, never saturated): `--ok #2F8F5E` / `--warn #C77A2C` / `--bad #B2453A`
  Coral is reserved for primary CTAs, selection, and the one delight moment. Greys carry 90% of UI. No gradients on chrome.
- **Radius:** `--r-sm 4px` / `--r 6px` / `--r-md 8px`. Never above 8.
- **Chrome:** no gradients, shadows scale `--shadow-sm` (chrome) / `--shadow` (floating cards) / `--shadow-lg` (overlays). 1px hairlines at ~8% opacity.
- **Motion:** 150-200ms ease-out. Snappy, not bouncy. Spring overshoots and 400ms+ animations are out — they read as toy.
- **Delight:** exactly **one** designated moment — a subtle checkmark animation when a render completes. Empty-state on the home page may carry a small custom illustration. No mascots, no confetti.
- **Voice:** confident, terse, human. "Saved" not "Saved 2s ago." "Generating narration" not "Polishing your audio masterpiece." Short sentences, active verbs, no hype.

## Key flows (locked)
1. **Home / projects** — 3-col card grid. Sidebar's "+ New project" is the only new-project entry; the dashed first-cell tile and the empty-state CTA both route to `/new`. Samples are a separate section above user projects.
2. **New project** — dedicated full-page surface at `/new`. Drag-drop or file picker; PPTX or PDF. Shows parsing/rasterizing progress, then routes to the editor.
3. **Editor** — left scene rail, center slide preview, right script panel. Drag-and-drop reorder. Inline play button on each slide thumbnail (per-slide audio). Per-slide regenerate. Auto-save.
4. **Export** — single modal: captions toggle, quality toggle, render button. Progress in-place. Result = "Copy link / Download MP4." No redirect.

## Brand
- Name: **PPTalk** placeholder. Lock the name change when the demos are working — not before.
- Logo: simple wordmark in Inter Semibold for now.
- Voice: confident, terse, no hype.

## Locked copy
- Voice picker friendly names + groupings — see `hats/content.md`.
- Bulk-draft button: **"Draft all narrations"** (locked 2026-05-06). Single-slide variant: **"Draft this"** (overlay row) / **"Draft this slide"** (main editor). All paired with the sparkle icon.

## Open design questions
- [ ] Does the editor need a global "Render" button in the top bar in addition to the export modal trigger? Lean: one entry point only — top-right "Export" button opens the modal.
- [x] ~~Slide thumbnail width — 140px (Descript) is good for desktop; how does it hold at 1280px viewport?~~ — locked at 168px after Hi-Fi review (locked 2026-05-06).
- [x] ~~Pre-loaded sample decks — surface as their own row group ("Samples") above the user's projects, or interleaved?~~ — separate group above user projects (locked 2026-05-06).
- [x] ~~Cmd+K palette scope: just navigation, or also actions (e.g., "Regenerate slide," "Export")?~~ — nav-only for the demo (locked 2026-05-05).

## Out of scope for this version
- Public landing page, hero video, marketing copy
- Mobile editing (view-only on mobile is fine)
- Brand identity refresh
- Onboarding flows / tooltips / walkthroughs
- Sharing / comments / multi-user
