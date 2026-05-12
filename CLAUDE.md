# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Doc style: see `DOCS-STYLE.md`. Current state pointer: see `STATUS.md`. Shipped log: see `CHANGELOG.md`.

## On session start (team-lead rehydrate)

If `.claude/team.json` exists, you are the team-lead. **Rehydrate the team before doing anything else.** Your full role is defined in `.claude/team/team-lead.md` (spec author + orchestrator + merger; see that file for the spec → dispatch → gate → review → merge loop and clarifying-question heuristics). Read `.claude/team.json` to get the member list, then for each member spawn an `Agent` in parallel (single message, multiple tool calls):

- `subagent_type` = the member's `subagent_type`.
- `name` = the member's `name` (so the user and you can address them via `SendMessage({to: name})`).
- `team_name = "pptalk"` (call `TeamCreate({team_name: "pptalk", agent_type: "team-lead"})` first if no team exists this session — it's idempotent enough; ignore "already exists" errors).
- `prompt` = a **bootstrap pointer**, not the briefing itself. Format: `"You are the \`<name>\` member of the pptalk team. Read your full briefing at \`/Users/joseph/Desktop/pptalk/<briefing_path>\` (absolute path) and follow its instructions exactly. Do not begin any work this turn — only ack and idle as the briefing directs."` **Do NOT `Read` the briefing into team-lead context** — the subagent reads it directly. This keeps each multi-KB briefing out of team-lead's context window.
- `run_in_background: true`.

Each member reads its briefing, sends a one-line ack via `SendMessage`, and goes idle. Only after they are idle should you accept new user work — though you don't need to wait synchronously; idle notifications surface in chat.

If `.claude/team.json` does NOT exist, this project doesn't use a persistent team — work as a single-session.

## Engineering workflow (spec-driven, blind parallel verification)

This project runs on **specification-driven development with blind parallel verification** — drawn from production multi-agent SDLC patterns (Anthropic research multi-agent, CrewAI, AutoGen) composed with Specification by Example / BDD with separate role authors. The five load-bearing properties:

1. **Specs come first.** Every user request becomes a written spec at `.claude/specs/SPEC-<id>.md` before any code is written.
2. **Clarify when ambiguous.** If team-lead can't write testable acceptance criteria without an answer, team-lead asks the user before dispatching.
3. **Engineer and qa interpret the spec independently.** Engineer writes code on `feat/<slug>`; qa writes tests on `test/<slug>`; neither sees the other's branch until the QA gate. Mismatches surface spec ambiguities, not impl bugs.
4. **Reviewer is spec-only adversarial.** Reads the spec + the PR file (engineer's structured handoff report). Never reads code.
5. **Team-lead is the only spec author and the only merger.** All branch protection runs through team-lead.

Full per-role procedures: `.claude/team/team-lead.md`, `.claude/team/engineer.md`, `.claude/team/qa.md`, `.claude/team/reviewer.md`. Spec template: `.claude/specs/TEMPLATE.md`. PR template: `.claude/prs/TEMPLATE.md`.

### The loop, step by step

- **Receive.** User makes a request to team-lead.
- **Clarify (when ambiguous).** Team-lead asks 1-3 numbered clarifying questions and blocks on user answers. Heuristic for ambiguity: cannot write Given/When/Then acceptance criteria, scope is unclear, locked rules might conflict, or test surface can't be named. For trivial-and-clearly-bounded changes (one-line copy fix, known-pitfall fix the user diagnosed), skip clarification.
- **Author the spec.** Team-lead copies `.claude/specs/TEMPLATE.md` to `.claude/specs/SPEC-<id>.md` (next-id = `max(existing integer ids in .claude/specs/SPEC-*.md AND .claude/prs/PR-*.md) + 1`; spec id and PR id advance together). Fills in User request (verbatim), Why, Acceptance criteria (numbered, observable, Given/When/Then), Out of scope, Invariants in scope, Test surface (per-AC), Open questions (must be empty before dispatch). Commits the spec on `main` in the primary tree.
- **Dispatch in parallel.** Team-lead SendMessages an engineer AND qa simultaneously, both with the spec id and a branch slug. Engineer goes to `feat/<slug>`; qa goes to `test/<slug>`. Both work from the spec.
- **Implement (engineer, parallel with qa).** Engineer creates `/tmp/pptalk-<slug>` worktree, implements to satisfy each acceptance criterion, runs `.claude/ci/run.sh` to green. Engineer does NOT read qa's `test/<slug>` branch.
- **Author tests (qa, parallel with engineer).** Qa creates `/tmp/pptalk-test-<slug>` worktree, writes one or more tests per acceptance criterion at `web/tests/spec-<id>/`, `pipeline/tests/spec_<id>/`, or `.claude/qa/spec-<id>/`. Qa does NOT read engineer's `feat/<slug>` branch. Tests come from spec, not from code.
- **Open PR (engineer).** Engineer copies `.claude/prs/TEMPLATE.md` to `.claude/prs/PR-<id>.md` (PR id = SPEC id), fills in Handoff report / What changed / Spec coverage (per-AC mapping) / Invariant defense / Decisions and risks / Self-verification / CI run. Commits the PR file on `feat/<slug>`. Notifies team-lead.
- **Notify ready (qa).** Qa commits tests on `test/<slug>`, notifies team-lead "tests ready for PR-<id>."
- **QA gate.** Once both engineer's PR and qa's tests are ready, team-lead dispatches qa to run the gate. Qa creates a fresh `/tmp/pptalk-qa-gate-<id>` worktree off `feat/<slug>`, merges in `test/<slug>`, runs all tests + the CI baseline, appends a `## QA gate` report to the PR file with PASS or FAIL per AC and an overall verdict. Notifies team-lead.
- **On gate FAIL.** Team-lead routes back to the authoring engineer with the QA report. Engineer addresses on `feat/<slug>` with new commits (no force-push), updates `## Handoff report` with an `## Author response` section, re-asks for QA re-run. If the test itself is wrong (asserts behavior the spec doesn't require), engineer flags to team-lead — that's a SPEC issue, fixed in the spec, not by patching the test.
- **On gate PASS.** Team-lead dispatches reviewer.
- **Review.** Reviewer is **adversarial and spec-only**: reads `.claude/specs/SPEC-<id>.md` + `.claude/prs/PR-<id>.md`, never the diff or source. Probes whether each acceptance criterion has a plausible defense in `## Spec coverage` and each in-scope invariant has a defense in `## Invariant defense`. Appends to `## Reviews` with verdict APPROVED or CHANGES_REQUESTED. No worktree, no CI run.
- **Iterate.** On CHANGES_REQUESTED, team-lead routes back to engineer. Engineer addresses inline; re-dispatches reviewer (and re-runs qa if behavior changed).
- **Merge.** Team-lead merges in the primary tree (already on `main`):
  ```
  cd /Users/joseph/Desktop/pptalk
  .claude/ci/run.sh                                      # final guard
  git merge --no-ff --no-edit feat/<slug>
  git merge --no-ff --no-edit test/<slug>                # bring qa's tests onto main as separable history
  git branch -d feat/<slug>
  git branch -d test/<slug>
  ```
  Notifies engineer to `git worktree remove /tmp/pptalk-<slug>`, qa to remove `/tmp/pptalk-test-<slug>` and `/tmp/pptalk-qa-gate-<id>`. Updates spec status to `merged`. Appends CHANGELOG entry + STATUS update if user-visible.
- **Branch protection (social, not enforced).** Only team-lead writes to `main`. The primary tree at `/Users/joseph/Desktop/pptalk` stays on `main` at all times — every other working surface is a `/tmp/pptalk-*` worktree owned by exactly one agent.

CI script lives at `.claude/ci/run.sh` (TS type-check + Python import smoke). Engineer runs it before opening the PR and pastes the last 5 lines into the PR file. Qa runs it as part of the gate baseline. Reviewer does not run CI. Team-lead re-runs it as a final guard before merge.

**Worktree env files.** `pipeline/.env` and `web/.env.local` are git-ignored, so they don't carry into a fresh worktree. Symlink them from the primary tree on creation: `ln -s /Users/joseph/Desktop/pptalk/pipeline/.env pipeline/.env` and `ln -s /Users/joseph/Desktop/pptalk/web/.env.local web/.env.local`.

## What this is
Pre-launch workspace for **PPTalk-US** (working name): a 2C web tool that converts PPTX/PDF decks into narrated videos via TTS. Solopreneur venture. Modeled on [aiorator.com](https://aiorator.com/), which has validated traction in China — we are bringing it to the US.

Current phase: **demo-ready**, not released. Goal is a polished local app a close friend can sit down with — not a launched SaaS. See `SCOPE-DEMO.md` for the in/out boundary.

## Doc system
- **`SCOPE-DEMO.md`** — what's in / out for the version we're building toward. Read this before any feature work.
- **`VENTURE.md`** — single source of truth for positioning, ICP, current bet, kill criteria, open questions.
- **`hats/`** — domain personas. Load the relevant one before doing work in that domain. Each holds persona + current priorities + open questions.
  - `engineering.md`, `design.md`, `growth.md` (parked), `content.md`, `ops.md` (parked until cloud)
- **`competitors.md`** — landscape and wedge hypothesis.
- **`weekly/`** — weekly plan/review log. Monday plan, Friday review. Filename = Monday's date (`YYYY-MM-DD.md`).
- **`.claude/specs/`** — per-ticket spec contracts authored by team-lead. Each `SPEC-<id>.md` defines acceptance criteria, out-of-scope, invariants in scope, and test surface. The contract that engineer + qa + reviewer all reference. Template at `.claude/specs/TEMPLATE.md`.
- **`.claude/prs/`** — engineer's structured handoff reports per ticket. Each `PR-<id>.md` includes Spec coverage (per-AC mapping), Invariant defense, Decisions and risks, CI run, QA gate (filled by qa), Reviews (filled by reviewer). Template at `.claude/prs/TEMPLATE.md`.
- **`.claude/team/`** — per-role briefings: `team-lead.md`, `engineer.md`, `qa.md`, `reviewer.md`. Each role's full procedure + hard rules.

## Code layout

- **`pipeline/`** — Python render pipeline (PPTX/PDF → narrated MP4). Managed with `uv`.
  - `narrator/cli.py` — orchestration: parse → rasterize → summarize → narrate → tts → encode
  - `narrator/parse.py` — PPTX → per-slide title/body (speaker-notes extraction + PDF path are TODO)
  - `narrator/render.py` — PPTX → PNGs via LibreOffice → PDF → PyMuPDF
  - `narrator/script.py` — slide PNG + text → narration via Claude Haiku 4.5 (vision)
  - `narrator/tts.py` — narration → audio via OpenAI `gpt-4o-mini-tts` (migrated from `tts-1-hd`)
  - `narrator/video.py` — PNGs + audio → MP4 via ffmpeg at the source deck's native aspect
  - `narrator/usage.py` — cost telemetry to `runs.csv` and `usage.csv`
  - `narrator/config.py` — env loader (`pipeline/.env`)
- **`web/`** — Next.js 15 + Tailwind frontend; spawns the Python pipeline for renders.
  - `app/page.tsx` — home — Linear-style projects card grid (3-col, sidebar shell)
  - `app/api/render/route.ts` — legacy SSE-from-subprocess flow (slated for removal in Phase 2 cutover)
  - `components/Studio.tsx` — legacy single-render UI (slated for removal in Phase 2 cutover)
  - `lib/runner.ts` — `spawn` wrapper for the Python CLI (legacy, paired with `route.ts`)
- **`samples/`** — input decks (5 public-health / CDC).
- **`out/`** — prior render outputs (gitignored work dirs + finished MP4s).

## Locked stack (see `SCOPE-DEMO.md`)
- **DB:** Postgres via Supabase (local: `supabase start`).
- **TS ORM:** Drizzle.
- **Python DB:** psycopg + thin `queries.py`.
- **Storage:** Supabase Storage (S3-compatible) for source decks, slide PNGs, audio MP3s, MP4s, SRTs.
- **Auth:** not enabled; `user_id` populated with anonymous browser cookie ID.
- **TTS:** OpenAI `gpt-4o-mini-tts`.
- **Script LLM:** Claude Haiku 4.5 with prompt caching on the system prompt.
- **Render queue:** `render_jobs` table polled with `FOR UPDATE SKIP LOCKED`. Worker = the Python pipeline as a long-lived process.
- **IDs:** UUIDv7. **Schema convention:** every user-owned table has `user_id`, `created_at`, `updated_at`, `deleted_at`.

Explicitly not in the stack: SQLite, Prisma, SQLAlchemy, Redis, Inngest, trigger.dev, Datadog, pgvector.

## Build / run

Pipeline:
```bash
cd pipeline
uv sync
cp .env.example .env  # ANTHROPIC_API_KEY, OPENAI_API_KEY
uv run narrator render path/to/deck.pptx --out out/deck.mp4
```
System deps: LibreOffice (`brew install --cask libreoffice`), ffmpeg (`brew install ffmpeg`).

Web (depends on pipeline + a running Supabase):
```bash
cd web
npm install
npm run dev
```
Open http://localhost:3000.

Supabase local:
```bash
cd web
supabase start                    # boots Postgres, Storage, Realtime, Studio
supabase db push                  # apply Drizzle-generated migrations
```

Drizzle:
```bash
cd web
npx drizzle-kit generate          # diff schema → SQL migration
npx drizzle-kit migrate           # or `supabase db push` against local
```

Worker (long-lived job poller):
```bash
cd pipeline
uv run narrator worker            # claims render_jobs via FOR UPDATE SKIP LOCKED
```

The one-shot `uv run narrator render <pptx>` CLI stays for local debugging.

## How to work in this repo

Entry order for fresh contexts (mirrors `DOCS-STYLE.md`):

1. `memory/MEMORY.md` (auto-loaded) — user / feedback / project memory.
2. `CLAUDE.md` (auto-loaded, this file).
3. `STATUS.md` — current state pointer (active phase, last shipped, open blockers).
4. `SCOPE-DEMO.md` — in/out boundary for the demo version.
5. `hats/<domain>.md` — domain context for the work at hand.
6. `weekly/<latest-monday>.md` — what just shipped + this week's plan.

`VENTURE.md` and `competitors.md` are strategic-context — load only for strategic decisions, not execution work.

When the user makes a decision, update the relevant doc — don't let docs drift. When the user asks an open question, check the doc's "Open questions" — close or refine it there, don't restart the conversation.
