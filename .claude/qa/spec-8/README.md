# SPEC-8 test pack

Spec-derived tests for `SPEC-8: Batch bulk regenerate-all into a single LLM call`.

## Layout

- `pipeline/tests/spec_8/conftest.py` — shared fixtures: real psycopg DB,
  fixture project factory (controllable idx + locked), mocked
  `narrator.script._client.messages.create`, in-process worker drain,
  live-route base URL.
- `pipeline/tests/spec_8/test_bulk_regen_batch.py` — one test per AC.

The pytest harness is scaffolded on `test/bulk-regen-batch` (additions to
`pipeline/pyproject.toml`: `pytest`, `requests` in `[dependency-groups].dev`,
plus a `[tool.pytest.ini_options]` block).

## Mapping (spec AC → test)

- AC1 (one LLM call for the batch) → `test_ac1_one_llm_call_for_n_unlocked_slides`
- AC2 (per-slide narration mapping; non-monotonic ids) → `test_ac2_per_slide_mapping_with_non_monotonic_ids`
- AC3 (locked slides excluded) → `test_ac3_locked_slide_excluded_from_batch_and_unchanged`
- AC4 (all-or-nothing on failure) → `test_ac4_all_or_nothing_on_anthropic_5xx`
                                  + `test_ac4_all_or_nothing_on_malformed_response`
- AC5 (zero / single-slide edge cases) → `test_ac5_zero_in_scope_slides_makes_no_call`
                                       + `test_ac5_single_in_scope_slide_makes_one_call`
- AC6 (telemetry shape — one usage.csv row per batch) → `test_ac6_usage_csv_one_row_per_batch`
- AC7 (per-slide updated_at bumped → Realtime fires) → `test_ac7_per_slide_updated_at_bumped`

## Running the gate

Preconditions (mirrors the standard QA gate stack):

- Supabase local up: `supabase start` (Postgres reachable at the URL in
  `pipeline/.env`'s `DATABASE_URL`).
- Next.js dev server on `:3001` (from the gate worktree, NOT the primary
  tree). Override with `PPTALK_TEST_BASE_URL=http://localhost:3001`.
- The standalone Python worker subprocess MUST be stopped — the tests use
  an in-process worker so they can apply the Anthropic mock. A second
  worker would race on `claim_next_job` and steal jobs out from under the
  mock, producing flaky failures.

```
cd /tmp/pptalk-qa-gate-8/pipeline
uv sync --group dev
# kill any stray narrator worker:
pkill -f "narrator worker" 2>/dev/null || true
uv run pytest tests/spec_8/ -v
```

Each test maps to one AC; pytest's `-v` output names the AC in the
docstring of every test.

## Why this shape

- **Tests come from the spec, not the impl.** They drive the spec-named
  user surface (`POST /api/projects/[id]/draft-all`) and assert the spec's
  observables (call_count, DB end-state, usage.csv row count, updated_at
  bump). They do not assume which job kind the engineer chose, where the
  batched call lives in the code, or what the function is named.
- **Mocked Anthropic is the SPEC's named test boundary.** It is what
  makes `call_count == 1` (AC1, AC5, AC6) checkable, lets us synthesize
  multi-slide structured responses (AC2), inspect the prompt for locked
  slide leak (AC3), and simulate failures (AC4). The mock is applied to
  `narrator.script._client.messages.create`, the locked-stack module that
  owns the Haiku call site.
- **In-process worker drain.** `Worker._dispatch` is the public surface
  that processes whatever jobs the route enqueued. The test's
  `drain_worker` fixture claims and runs jobs in-process so the mock
  patch on `narrator.script._client` actually applies (it would not apply
  inside a separately-spawned worker subprocess).
