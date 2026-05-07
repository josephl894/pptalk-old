# `.claude/telemetry/` — per-spec workflow telemetry

Lightweight workflow instrumentation, kept on a per-spec basis. Goal: directional cost/structure data for tuning the team workflow, not exact token accounting.

## Files

- `SPEC-<id>.jsonl` — append-only event log for one spec's full lifecycle. One JSON object per line. Created by team-lead at spec-write time, populated through merge.
- `SPEC-<id>.summary.md` — human-readable post-merge summary derived from the JSONL. Lives here AND is appended verbatim into `.claude/prs/PR-<id>.md`'s `## Telemetry` section.

## Event schema

Every line is a flat JSON object with at minimum `ts` (ISO-8601), `stage`, and stage-specific fields. Use whatever extra keys are useful — schema is loose by design.

### Stages

- **`spec_write`** — team-lead committed the spec.
  ```json
  {"ts":"2026-05-07T05:00:00Z","stage":"spec_write","spec":"SPEC-8","slug":"<slug>","ac_count":3,"chars":<spec file size>}
  ```
- **`spec_amend`** — team-lead amended the spec mid-flight.
  ```json
  {"ts":"...","stage":"spec_amend","spec":"SPEC-8","reason":"<short>","commit":"<sha>"}
  ```
- **`dispatch`** — team-lead sent a SendMessage instructing an agent to start work.
  ```json
  {"ts":"...","stage":"dispatch","from":"team-lead","to":"eng-1","spec":"SPEC-8","kind":"impl|test|gate|review|nit","prompt_chars":<int>}
  ```
- **`agent_return`** — an agent completed a turn and went idle. Self-report fields come from the agent's final SendMessage.
  ```json
  {"ts":"...","stage":"agent_return","from":"eng-1","kind":"impl|test|gate|review|nit","summary_chars":<int>,"self_report":{"tool_calls":<int>,"files_read":<int>,"files_read_kb":<int>,"sendmessages":<int>,"notes":"..."}}
  ```
- **`ci_run`** — `.claude/ci/run.sh` invocation by any role.
  ```json
  {"ts":"...","stage":"ci_run","by":"team-lead|eng-1|qa","result":"green|red","duration_s":<int>}
  ```
- **`merge`** — team-lead merged onto main.
  ```json
  {"ts":"...","stage":"merge","spec":"SPEC-8","branches":["fix/<slug>","test/<slug>"]}
  ```

## Team-lead workflow

1. **At spec write:** create `SPEC-<id>.jsonl`, append a `spec_write` event.
2. **At every dispatch:** include this closing instruction in the SendMessage prompt verbatim, then immediately append a `dispatch` event:
   > **Telemetry self-report (required, append to your final SendMessage on idle):** `TELEMETRY tool_calls=<int> files_read=<int> files_read_kb=<approx> sendmessages=<int> notes=<short>`
3. **On every agent return:** parse the `TELEMETRY` line out of their last SendMessage, append an `agent_return` event with the parsed fields.
4. **On CI/spec-amend/merge:** append the matching event.
5. **Post-merge:** roll the JSONL up into `SPEC-<id>.summary.md` with: total events, dispatches per stage, biggest dispatch (chars), biggest return (chars + tool_calls), CI run count + outcomes, spec amendments with reasons, total elapsed wall-clock. Copy that summary verbatim into `.claude/prs/PR-<id>.md`'s `## Telemetry` section.

## What the data is for

- Spotting bloated dispatches (the team-lead → eng-1 prompt was 4000 chars on a one-line bug fix → over-briefed).
- Spotting over-tooling (eng-1 ran 80 tool calls to add a banner → likely re-read-loop).
- Spotting spec-amendment frequency (3 amendments mid-flight on SPEC-7 → spec author should consult schema before drafting).
- Spotting which stages dominate elapsed time (gate took 12 min, review took 1 min → maybe gate has dead waits).

This is NOT a substitute for `/cost`. It's structure-and-shape data, not token accounting.

## Disabling

If you want to skip telemetry on a spec, just don't create `.claude/telemetry/SPEC-<id>.jsonl`. The dispatch self-report instruction can be omitted from messages too — it's not load-bearing on the SDLC.
