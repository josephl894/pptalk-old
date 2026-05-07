# SPEC-7 test pack

Three shell-smoke tests, one per acceptance criterion in `.claude/specs/SPEC-7.md`. Authored on `test/pdf-parse`, run by qa at the gate against a worktree off `feat/pdf-parse` (or whatever the engineer's impl branch is).

## Layout

- `fixtures/build_fixture.py` — regenerates `fixtures/three_page.pdf` (3-page text-only PDF). Idempotent. Run from any pipeline venv: `cd pipeline && uv run python ../.claude/qa/spec-7/fixtures/build_fixture.py`.
- `fixtures/three_page.pdf` — committed binary fixture; ~2KB.
- `ac1_happy_path.sh` — happy path: upload → editor-ready in ≤30s.
- `ac2_db_end_state.sh` — DB end state: render_jobs completed, slides idx contiguous, png_path resolves via signed URL.
- `ac3_worker_not_running.sh` — worker offline: visibility signal in ≤60s, job stays re-claimable, page still renders.

## Mapping

- AC1 → `ac1_happy_path.sh`
- AC2 → `ac2_db_end_state.sh`
- AC3 → `ac3_worker_not_running.sh`

## Running the gate

From the gate worktree, with Next dev on `:3001` and Supabase up:

```
# AC1 + AC2 share the worker-running precondition
cd pipeline && uv run narrator worker &  # background
WORKER_PID=$!
cd ..
bash .claude/qa/spec-7/ac1_happy_path.sh
bash .claude/qa/spec-7/ac2_db_end_state.sh

# Stop the worker for AC3
kill "$WORKER_PID" 2>/dev/null || true
sleep 2
bash .claude/qa/spec-7/ac3_worker_not_running.sh
```

Each script exits 0 on PASS, non-zero on FAIL. AC2 will self-bootstrap an upload if no project_id is passed; you can also chain it: `bash ac2_db_end_state.sh "$(...captured project_id from ac1...)"` — but the self-bootstrap form is the supported gate path.

## Spec-mapping decisions worth flagging

1. **`png_path` vs `image_path`.** The spec's AC2 names "image_path" as a concept; the only image-path column on `slides` is `png_path` (per the Drizzle schema). Tests assert `png_path`. If the engineer adds a separate `image_path` column, that's a SPEC change, not a test patch.
2. **`pending` vs `queued`.** The spec says the job is "left in `pending` (not failed)". The Drizzle schema's default `render_jobs.status` is `'queued'`. The strict observable is "non-terminal, re-claimable, not failed". AC3 accepts either `pending` or `queued`.
3. **DOM probe vs API status field.** AC3 spec test surface explicitly allows either. Test probes both surfaces and passes if either matches.
