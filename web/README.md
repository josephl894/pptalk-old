# pptalk-web

Local Next.js front-end for the demo version. Talks to Supabase (Postgres + Storage + Realtime) and enqueues render jobs for the Python worker.

## Setup

```bash
cd web
npm install
```

Make sure the Python pipeline at `../pipeline/` is set up (`uv sync`), `.env` has `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`, and LibreOffice is installed for PPTX rasterization.

Supabase (local):

```bash
supabase start                    # Postgres + Storage + Realtime + Studio
supabase db push                  # apply Drizzle-generated migrations
```

`web/.env.local` needs `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Bracket-notation env access (`process.env[name]`) does NOT inline `NEXT_PUBLIC_*` values into the client bundle — use literal property access in client code (see `hats/engineering.md` "Patterns and pitfalls").

## Run

```bash
npm run dev
```

In a second terminal, run the worker:

```bash
cd ../pipeline
uv run narrator worker
```

Open http://localhost:3000.

## Storage layout (Supabase Storage, bucket `pptalk-private`)

```
{user_id}/{project_id}/source/deck.{pptx|pdf}
{user_id}/{project_id}/slides/{NNN}.png
{user_id}/{project_id}/audio/{NNN}.mp3
{user_id}/{project_id}/renders/{render_id}.mp4
{user_id}/{project_id}/renders/{render_id}.srt
```

## Notes

- The legacy SSE-from-subprocess flow (`app/api/render/route.ts` → `lib/runner.ts` → `components/Studio.tsx`) is being replaced by the worker-and-Realtime path; see Phase 2 in `PLAN-DEMO.md`. Slated for removal in the Phase 2 cutover.
- The active path is: `POST /api/projects` (multipart upload) → write source to Storage + insert `projects` row + enqueue `parse_only` job → worker processes → realtime fires on `slides`/`projects`/`render_jobs` → editor reflects state.
