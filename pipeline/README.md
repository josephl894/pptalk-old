# narrator

Python pipeline: PPTX or PDF in → narrated MP4 out.

## Setup

```bash
cd pipeline
cp .env.example .env  # then paste your keys
uv sync
```

System dependencies:
- LibreOffice (`brew install --cask libreoffice`) — headless slide rasterization (PPTX only; PDFs skip LibreOffice)
- ffmpeg (`brew install ffmpeg`) — video stitching

## Usage

One-shot CLI render (local debugging):

```bash
uv run narrator render path/to/deck.pptx --out out/deck.mp4
```

Long-lived worker (claims `render_jobs` from Postgres):

```bash
uv run narrator worker
```

The worker is the production-shaped path. The web app inserts jobs into `render_jobs`; the worker polls with `FOR UPDATE SKIP LOCKED` and processes them. The CLI render path stays for local one-off debugging without the queue.

## Modules

- `parse.py` — PPTX → per-slide text (title, body, speaker notes)
- `parse_pdf.py` — PDF → per-page text via PyMuPDF
- `render.py` — PPTX → per-slide PNGs via LibreOffice + PyMuPDF
- `render_pdf.py` — PDF → per-page PNGs via PyMuPDF (skips LibreOffice)
- `script.py` — slide PNG + text → narration via Claude Haiku 4.5 (vision, prompt caching on the system prompt)
- `tts.py` — narration → audio via OpenAI `gpt-4o-mini-tts`
- `video.py` — PNGs + audio → MP4 via ffmpeg at the source deck's native aspect (16:9 or 4:3)
- `usage.py` — cost telemetry → `runs.csv`, `usage.csv`, and `usage_events` rows in Postgres
- `db.py` — psycopg connection helper (`DATABASE_URL` from `.env`)
- `queries.py` — thin SQL functions: `claim_next_job`, `set_slide_script`, `update_project_status`, etc.
- `storage.py` — Supabase Storage SDK wrapper for source decks, slide PNGs, audio MP3s, MP4s
- `pipeline_runner.py` — pure parse-and-rasterize utility shared by CLI and worker
- `worker.py` — long-lived job loop; dispatches on `kind` (`parse_only`, `full_render`, `slide_script_regen`, `slide_tts`)
- `cli.py` — orchestration; `narrator render` and `narrator worker` subcommands
- `config.py` — env loader (`pipeline/.env`)
