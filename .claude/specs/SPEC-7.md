# SPEC-7: PDF upload from /new must not get stuck on "parsing"
Author: team-lead
Status: merged
Linked PR: PR-7
Linked impl branch: fix/pdf-parse
Linked test branch: test/pdf-parse
Created: 2026-05-07

## User request
> right now, when you upload new slides, the parsing (from homepage -> editor) isn't working at all. its stuck on parsing

Clarifying Q&A (team-lead → user, 2026-05-07):
- Q: Is the Python worker (`uv run narrator worker`) currently running in another terminal? — A: Unsure / not checked.
- Q: Which file format reproduces the stuck-on-parsing symptom? — A: PDF.

## Why
A friend dropping a PDF on `/new` should land in the editor with slides visible after parsing. Today that flow stalls indefinitely on the "parsing" UI for PDFs, blocking the demo before any narration or render work begins. Either the `parse_only` job isn't being claimed/completed end-to-end, or the editor isn't reflecting completion. Without a fix, Phase 4 polish is moot — the friend never gets past the upload screen.

## Acceptance criteria

1. **AC1 — happy path, PDF.** Given a fresh anonymous user (no `pptalk_uid` cookie) and a running worker, When the user uploads a valid multi-page PDF on `/new`, Then within 30 seconds of upload completion the user is at `/p/<project_id>` with one slide thumbnail per PDF page rendered in the filmstrip and the "parsing" UI is no longer visible.

2. **AC2 — DB end state after PDF parse.** Given AC1's flow completed successfully, Then the corresponding `render_jobs` row has `status = 'done'` (the schema enum's successful terminal state) and `kind = 'parse_only'`, the `slides` table has exactly N rows for that `project_id` (where N = PDF page count) with `idx` values 0..N-1, and every slide row has a non-null `png_path` whose object resolves via the Supabase Storage signed-URL helper.

3. **AC3 — worker-not-running visibility.** Given the worker is NOT running, When the user uploads a PDF on `/new` (or refreshes into the editor while the parse_only job is unclaimed past a bounded threshold), Then within 60 seconds the parsing UI surfaces a recoverable, non-blocking message indicating the render worker is not available (exact copy at engineer's discretion, but it must (a) name the worker, (b) suggest the user start it, and (c) not block other UI from rendering). The job row itself remains re-claimable — `render_jobs.status` MUST be the schema's queued/pending state (i.e., not `failed` and not `completed`) so a started worker still picks it up.

## Out of scope
- PPTX upload path. Engineer may fix shared root causes if any surface, but the test surface is PDF-only.
- Narration / TTS / full-render correctness — Phase 1 already covered, not re-tested here.
- Worker auto-start, supervision, restart-from-UI. AC3 is visibility only.
- Sample-project seeded behavior (pre-rendered MP4s, doesn't traverse parse path).
- Editor micro-interactions (Phase 4 item 4) — separate ticket.
- Realtime infrastructure rewrites. If Realtime isn't firing, fix the wiring; don't redesign the transport.

## Invariants in scope
- Locked stack: Supabase Postgres + Drizzle (TS) + psycopg (Python). No SQLite, no bypass clients.
- UUIDv7 IDs validated at the route boundary before any DB op (per `hats/engineering.md` "UUID-at-the-boundary" pitfall).
- `parse_only` is a distinct job kind from `full_render`; the editor opens after parse, before any TTS work.
- Realtime via Supabase `postgres_changes` on `render_jobs` + `slides` is the contract for worker→editor progress wiring. No SSE-from-subprocess in the new flow.
- postgres-js singleton pattern (`globalThis.__pptalk_pg`) — must not recreate pool per request.
- `NEXT_PUBLIC_*` env access requires literal `process.env.NEXT_PUBLIC_X` for inlining; non-public envs are server-only.
- Anonymous identity via `pptalk_uid` cookie (HTTP-only, SameSite=Lax, 1-year). Upserts a `users` row.
- Soft-delete columns + `created_at`/`updated_at` populated on all user-owned writes.
- No time/effort estimates appear in any artifact (commit messages, PR file, comments).

## Test surface
- AC1 → integration (Node, headless): with worker running locally, POST a PDF blob to `/api/projects`; poll `GET /api/projects/[id]` (or query DB directly) until `slides.length === pdf.pageCount`; assert ≤30s. Plus a manual smoke pass at `/new` with a samples/ PDF.
- AC2 → integration (Python or Node): after AC1's flow, query `render_jobs` for the project and assert `status='done'`, `kind='parse_only'`; query `slides` and assert row count + monotonic idx + `png_path` non-null; HEAD-fetch each `png_path` via signed URL and assert 200.
- AC3 → integration (Node): with worker stopped (or simulated by not consuming queued parse_only jobs), POST a PDF to `/api/projects`; load `/p/[id]`; assert that within 60s the page surfaces a "worker not available" affordance (probe via API JSON field OR DOM HTML — either is acceptable) AND `render_jobs.status` is still in the queued/pending state (NOT `failed`, NOT `completed`).

## Open questions (resolved before dispatch)
- Q: Worker state during repro? — A: User unsure. Engineer must verify worker is running as the first triage step. If "worker not running" is the entire root cause, AC1 is satisfied trivially with the worker started, and AC3 becomes the load-bearing requirement of this ticket.
- Q: File format scope? — A: PDF only.

## Spec amendments
- 2026-05-07 — qa flagged two drafting errors during test authoring: (a) AC2's "image_path" was wrong; the schema column is `png_path`. Fixed in AC2 + AC2 test surface. (b) AC3 said "pending" but the schema default is `queued`. Reworded AC3 + AC3 test surface to reference the schema's queued/pending state (not-failed, not-completed) so it's terminology-agnostic.
- 2026-05-07 — clarified AC3 visibility probe accepts either an API JSON field OR DOM HTML signal; either passing is sufficient.
- 2026-05-07 — qa flagged a third drafting error during the gate run: AC2 said `status='completed'` but the schema enum is `'queued' | 'running' | 'done' | 'failed'`. The successful terminal state across the whole codebase is `'done'`. Fixed in AC2 + AC2 test surface to match the schema. (Same shape of bug as the prior two — team-lead drafted enum/column names without checking the schema; corrected to the actual schema value rather than reshape the entire project's enum.)
