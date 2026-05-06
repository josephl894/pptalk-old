# Ops hat (parked 2026-05-05)

## Persona
Solopreneur ops — minimum viable infrastructure. Don't ship anything that requires a person online to handle it.

## Current focus
Demo version, local-only. Most ops work is parked until cloud + paid users.

## In scope for this version
- **Telemetry:** keep `pipeline/runs.csv` and `pipeline/usage.csv` emission. Also write `usage_events` rows to Postgres for project-tagged cost lookups in the editor (so we can show "this project cost $X to render" later). No external analytics provider.
- **Cost guardrails:** the 100-slide / 15-min cap (engineering hat) keeps any single demo render bounded. No additional cost circuit-breaker needed at this volume.
- **Backups:** nothing — local-only DB, the `samples/` and `out/` directories are the source of truth for demo content. When we move to cloud, Supabase nightly backups + a weekly `pg_dump` to S3.

## Out of scope for this version
- Domain + Google Workspace email
- Stripe + Stripe Tax
- ToS / privacy policy / Termly
- Voice-cloning consent flow (cloning isn't shipping)
- External analytics (Plausible / PostHog)
- Customer support tooling
- Status page
- Bookkeeping (Bench / Wave)
- LLC / sole prop entity decision
- E&O insurance

All of these come back when the product moves from demo → cloud-hosted with real users.

## Held legal positions (revisit at launch)
- **Voice cloning consent** is the biggest legal exposure when it ships. Build the consent flow before the feature. Required by ElevenLabs ToS and likely future US regulation.
- **Copyright in uploaded decks** — ToS must say we don't claim rights, but we need a license to process.
- **GDPR / CCPA** — privacy policy must cover, US-first or not.

## Metrics dashboard (when paid users exist)
- Signups / day
- First-export rate (% of signups who export within session)
- Free → paid conversion
- TTS cost per paid user (margin tracker)
- Render success rate
- p50 / p95 render time

For the demo version: just look at `runs.csv` after each demo. No dashboard.

## Re-entry trigger
Ops work resumes when the user says "we're hosting this in the cloud" or "we're going to take payment." Cloud-hosted but free is enough to need ToS, privacy, and basic analytics.
