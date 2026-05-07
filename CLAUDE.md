# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Doc style: see `DOCS-STYLE.md`. Current state pointer: see `STATUS.md`. Shipped log: see `CHANGELOG.md`.

## On session start (team-lead rehydrate)

If `.claude/team.json` exists, you are the team-lead. **Rehydrate the team before doing anything else.** Read `.claude/team.json` to get the member list, then for each member spawn an `Agent` in parallel (single message, multiple tool calls):

- `subagent_type` = the member's `subagent_type`.
- `name` = the member's `name` (so the user and you can address them via `SendMessage({to: name})`).
- `team_name = "pptalk"` (call `TeamCreate({team_name: "pptalk", agent_type: "team-lead"})` first if no team exists this session — it's idempotent enough; ignore "already exists" errors).
- `prompt` = a **bootstrap pointer**, not the briefing itself. Format: `"You are the \`<name>\` member of the pptalk team. Read your full briefing at \`/Users/joseph/Desktop/pptalk/<briefing_path>\` (absolute path) and follow its instructions exactly. Do not begin any work this turn — only ack and idle as the briefing directs."` **Do NOT `Read` the briefing into team-lead context** — the subagent reads it directly. This keeps each ~6KB briefing out of team-lead's context window.
- `run_in_background: true`.

Each member reads its briefing, sends a one-line ack via `SendMessage`, and goes idle. Only after both are idle should you accept new user work — though you don't need to wait synchronously; idle notifications surface in chat.

If `.claude/team.json` does NOT exist, this project doesn't use a persistent team — work as a single-session.

## Engineering workflow (PR loop)

All implementation work flows through `eng-1`, `eng-2`, `eng-3`. Each works on a short-lived branch off `main`. Team-lead is the only one who merges. Reviewer reads diffs and sets a verdict; qa runs regression smokes when dispatched.

- **Dispatch.** Team-lead picks an engineer and dispatches a ticket via `SendMessage` + `TaskUpdate({owner: "<eng-name>"})`. The engineer claims the task and sets it to `in_progress`.
- **Implement.** Engineer creates a per-task git worktree off `main` and works entirely inside it: `git worktree add /tmp/pptalk-<slug> -b <feat|fix>/<slug> main`, then `cd /tmp/pptalk-<slug>`. Commits on the branch with Conventional Commits, runs `.claude/ci/run.sh` to green from inside the worktree. The primary tree at `/Users/joseph/Desktop/pptalk` is reserved for the team-lead on `main`; never `git checkout` a feature branch in it.
- **Open PR.** Engineer copies `.claude/prs/TEMPLATE.md` to `.claude/prs/PR-<id>.md` (next-id = max existing integer + 1), fills in Why / What changed / Test plan / CI-run output, commits the PR file on the branch, sets task to `in_review`, SendMessages team-lead.
- **Review.** Team-lead dispatches `reviewer`. Reviewer reads the diff (`git diff main...<branch>` is read-only and safe from the primary tree), but if running CI or any command that imports project code, does so in a per-review worktree (`git worktree add /tmp/pptalk-review-<id> <branch>`). Checks against the locked rules in `hats/engineering.md` and `DOCS-STYLE.md`, appends to the PR file's `## Reviews` section with a verdict (`APPROVED` or `CHANGES_REQUESTED`), and SendMessages team-lead.
- **Iterate.** On `CHANGES_REQUESTED`, team-lead routes back to the authoring engineer. Engineer addresses comments by amending the branch with new commits (no force-push), updates the PR file with an `## Author response` section, re-runs CI, and pings `reviewer` (cc team-lead).
- **Regression (optional).** On `APPROVED`, team-lead dispatches `qa` for a regression smoke. qa works in its own per-PR worktree (`git worktree add /tmp/pptalk-qa-<id> <branch>`); for UI smokes, qa starts its own dev server inside the worktree on a non-default port (`cd /tmp/pptalk-qa-<id>/web && npm install && npm run dev -- -p 3001`) so the primary :3000 dev server is never coupled to qa's branch state. Mandatory for changes touching the pipeline, schema, migrations, or render path. Skippable for UI copy and docs-only changes.
- **Merge.** Team-lead merges from a transient worktree, never the primary tree: `git worktree add /tmp/pptalk-merge main && cd /tmp/pptalk-merge && git merge --no-ff --no-edit <branch> && git branch -d <branch> && cd - && git worktree remove /tmp/pptalk-merge`. Then notifies the authoring engineer to `git worktree remove /tmp/pptalk-<slug>`. Sets the task to `merged`. Appends a CHANGELOG entry and updates STATUS only if the merged change is a user-visible feature or hotfix bundle, not a process tweak.
- **Branch protection (social, not enforced).** Only team-lead writes to `main`. Engineers never `git checkout main && edit`. No force-pushes anywhere. The primary tree at `/Users/joseph/Desktop/pptalk` stays on `main` at all times — every other working surface is a `/tmp/pptalk-*` worktree owned by exactly one agent.

CI script lives at `.claude/ci/run.sh` (TS type-check + Python import smoke). Engineer, reviewer, and team-lead all run it on the branch before respective handoffs, each from their own worktree so a peer's `git checkout` cannot swap files mid-run.

**Worktree env files.** `pipeline/.env` and `web/.env.local` are git-ignored, so they don't carry into a fresh worktree. Symlink them from the primary tree on creation: `ln -s /Users/joseph/Desktop/pptalk/pipeline/.env pipeline/.env` and `ln -s /Users/joseph/Desktop/pptalk/web/.env.local web/.env.local` (the Python import smoke in CI fails with `ANTHROPIC_API_KEY is not set` otherwise).

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
