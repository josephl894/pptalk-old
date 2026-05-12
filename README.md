# PPTalk-US

Pre-launch workspace for **PPTalk-US**: a 2C web tool that converts PPTX/PDF decks into narrated videos via TTS. Modeled on [aiorator.com](https://aiorator.com/) (validated traction in CN) — bringing it to the US.

Current phase: **demo-ready**, not released. Polished local app for SME demos.

For deep context (architecture, scope, hat personas, weekly logs) start at `STATUS.md` and `SCOPE-DEMO.md`. For the multi-agent SDLC and team conventions, see `CLAUDE.md`. For the shipped-log, see `CHANGELOG.md`.

## What you need on the host

System dependencies (one-time install):

**macOS**
```bash
brew install --cask libreoffice
brew install ffmpeg node@20 uv supabase/tap/supabase
# Optional: brew install --cask docker  # if running local Supabase via supabase CLI
```

**Ubuntu 22.04+**
```bash
sudo apt-get update && sudo apt-get install -y libreoffice ffmpeg
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
# uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
# Supabase CLI
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb -o /tmp/supabase.deb
sudo dpkg -i /tmp/supabase.deb
# Docker (required by `supabase start`)
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER && newgrp docker
```

Runtimes used: Node 20+, Python 3.11+, Docker (only for local Supabase), LibreOffice, ffmpeg.

## Setup (after cloning)

1. **Environment files** (these are NOT in the repo — copy them from the source machine):
   - `pipeline/.env` — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Supabase service-role key + URL for the pipeline.
   - `web/.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-side `SUPABASE_SERVICE_ROLE_KEY`, and the Supabase project URL.

   `pipeline/.env.example` lists the keys the pipeline expects.

2. **Pipeline (Python)**
   ```bash
   cd pipeline
   uv sync
   ```

3. **Web (Next.js)**
   ```bash
   cd web
   npm install
   ```

4. **Supabase** — pick one:
   - **Reuse existing cloud project** (point `.env` files at it). Migrations and Storage buckets are already there.
   - **Local stack** (Docker required):
     ```bash
     cd web
     supabase start                 # boots Postgres, Storage, Realtime, Studio
     supabase db push               # applies Drizzle-generated migrations
     ```
     Voice samples (per-voice MP3s in the `voice-samples` bucket) are not in the repo. To regenerate them: `cd pipeline && uv run python scripts/generate_voice_samples.py` (costs ~$0.004 on OpenAI).

## Run

Three processes, each in its own terminal:

```bash
# 1. Local Supabase (only if not using cloud)
cd web && supabase start

# 2. Pipeline worker — drains the render_jobs queue (long-lived)
cd pipeline && uv run narrator worker

# 3. Web dev server
cd web && npm run dev
```

Open http://localhost:3000.

One-shot CLI render (for local debugging, bypasses the worker):
```bash
cd pipeline
uv run narrator render path/to/deck.pptx --out out/deck.mp4
```

## Transporting to another machine

What lives outside the repo and must be copied separately:

| Item | Where on source | Where on target | Notes |
|------|----------|------------------|-------|
| `pipeline/.env` | source machine only | `pipeline/.env` | API keys, Supabase service role |
| `web/.env.local` | source machine only | `web/.env.local` | Supabase URL + anon + service role |
| Source decks for testing | `samples/` (in repo if committed) | git clone brings them | Or copy via scp if you want fresh samples |
| Render outputs | `out/`, `pipeline/runs.csv`, `pipeline/usage.csv` | not transported | These are gitignored work products; regenerate as needed |
| Supabase data (projects, slides, jobs) | hosted in your Supabase project | same Supabase project | If you point the target machine at the same cloud Supabase, data is shared; if you spin up a fresh local stack, the data is empty |
| Voice sample MP3s | Supabase Storage `voice-samples` bucket | same bucket if same Supabase | Regenerate via `pipeline/scripts/generate_voice_samples.py` if using a fresh Supabase |
| Claude / agent state | `.claude/teams/`, `~/.claude/` | `~/.claude/` | Only matters if you want the team / hooks setup on the new machine |

The cleanest transport recipe:

```bash
# On the source machine
cd /Users/joseph/Desktop/pptalk
tar czf /tmp/pptalk-env.tgz pipeline/.env web/.env.local

# On the target machine
git clone git@github.com:josephl894/pptalk.git
cd pptalk
# scp the tgz over, then:
tar xzf /tmp/pptalk-env.tgz
cd pipeline && uv sync
cd ../web && npm install
# Either point .env files at the existing cloud Supabase, or `supabase start` for a fresh local stack
```

If you're using cloud Supabase, that's the entire transport step. If you're using local Supabase, you also need to run `supabase db push` and (optionally) re-seed voice samples.

## Layout

- `pipeline/` — Python render pipeline (PPTX/PDF → narrated MP4), managed with `uv`.
- `web/` — Next.js 15 + Tailwind frontend, spawns the pipeline via the `render_jobs` queue + worker.
- `samples/` — input decks for testing.
- `out/` — render outputs (gitignored).
- `.claude/` — multi-agent SDLC: per-spec specs, PR files, role briefings, telemetry harness.

For the locked stack, conventions, and patterns see `CLAUDE.md` and `hats/engineering.md`.
