# PPTalk-US (working name)

PPT/PDF → narrated video. Solopreneur, US market. Modeled on [aiorator.com](https://aiorator.com/) (validated traction in China).

## Status
Demo-ready phase. Wedge + ICP locked (2026-05-04). Stack locked (2026-05-05). v0.5 working locally; building toward the demo version described in `SCOPE-DEMO.md`.

## Positioning
> Turn your training deck into a polished, narrated course video — without recording yourself.

Aimed at subject-matter experts, not videographers. The deck and the knowledge already exist; we eliminate the production step.

## ICP — Subject Matter Experts publishing training / course content
Examples: doctors teaching CME, engineers running corporate training, financial advisors recording client education, consultants productizing their workshops, professors releasing on Coursera/Udemy/Teachable, ex-corporate experts launching paid cohorts.

Profile:
- **Already have decks** from talks, internal training, or prior lectures.
- **Are not videographers** — hate setup, lighting, retakes, video editing. The production step is the bottleneck.
- **Charge premium** for their content ($200–$5000 per course or seat).
- **Want professional + clear**, not cinematic. Voice and slide pacing matter more than visual flourish.
- **Distribution:** Teachable, Kajabi, Thinkific, Skool, Podia, Coursera, Udemy, LinkedIn Learning, own websites.

**Validation source:** aiorator/PPTalk China sales data — this segment is their highest-paying cohort. Other segments exist with less distinct profiles.

**Open caveat:** aiorator validates *Chinese* SME demand. US distribution channels and English-voice quality tolerance are unverified. Treat the first 10 paying US users as validation; if they don't materialize, revisit.

## Why us
What's our defensible edge against:
- **Synthesia / HeyGen** — avatar-first, $30+/mo, B2B-heavy.
- **Pictory / InVideo** — general video AI, not slide-driven.
- **Tome / Gamma** — generate slides, don't narrate existing decks.
- **aiorator** — if/when they port to US.

Hypothesis: in the US, *"narrate my existing deck → polished video"* is underserved relative to *"generate slides for me"* and *"talking-head avatar."* Validate before committing.

## North-star metric
Likely candidates: weekly active creators, videos exported per week, paid conversions. Pick one once ICP is locked. (See open question below.)

## Current bet
See `SCOPE-DEMO.md` for the demo-version boundary, and the latest file in `weekly/` for the current week's work.

## Kill criteria
Example: "If we cannot get 50 waitlist signups in 4 weeks of paid + organic, kill or pivot." Pick real numbers once landing is up. (See open question below.)

## Constraints
- Solopreneur — AI is the team.
- US market — English-first, voice quality must match ElevenLabs-tier expectations.
- Bootstrapped — no fundraising; runway is personal.
- Speed — every week not shipping is a week aiorator-clones can land here first.

## Open questions (rolling)
- [x] ~~Which wedge?~~ — **C: SMEs publishing training/course content** (2026-05-04).
- [x] ~~MVP v0 scope~~ — done. v0 CLI + v0.5 local web both working as of 2026-05-05.
- [x] ~~TTS provider for v1~~ — OpenAI `gpt-4o-mini-tts` (locked 2026-05-05; migrating from `tts-1-hd`).
- [x] ~~Voice cloning in v1, or v2?~~ — out for the demo version (not supported by chosen TTS); v2+.
- [x] ~~Captions / subtitles~~ — in (per-slide segments from audio duration). Locked 2026-05-05.
- [ ] Brand name. Deferred again — PPTalk placeholder stays for the demo version (user call 2026-05-05).
- [ ] Avatar in v1, or never? SME ICP doesn't strictly need it. Likely never (or v3).
- [ ] Sample-deck rights for the in-product gallery (1 corporate-skills + 1 technical from `samples/`). Confirm before publishing renders externally.
- [ ] Why us — defensible edge vs Synthesia/HeyGen, Pictory/InVideo, Tome/Gamma, aiorator US port. Hypothesis logged above; validate before committing.
- [ ] North-star metric — weekly active creators vs videos exported/week vs paid conversions. Pick when paying users land.
- [ ] Kill criteria — pick real numbers when public landing is up (e.g., "<50 waitlist signups in 4 weeks of paid + organic → pivot").
