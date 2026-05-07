# PR-<ID>: <one-line title>
Author: <eng-N>
Branch: <feat|fix>/<slug>
Spec: SPEC-<ID>           # same id as this PR
Status: open | qa-gate | in-review | changes-requested | approved | merged | closed

## Handoff report
**Outcome:** done | partial | blocked
**Approach:** <2-3 sentences on the implementation strategy. Not "what changed" — the diff is what changed. The strategy is the *why this approach* and the load-bearing decisions.>

## What changed
- <file> — <one-line summary>
- <file> — <one-line summary>

## Spec coverage
<For each acceptance criterion in SPEC-<id>.md, state how the implementation satisfies it. The reviewer never reads code; this mapping is the contract. The qa runs tests against the same acceptance criteria. Silence on an AC is a guaranteed CHANGES_REQUESTED from reviewer.>

- **AC1** (<verbatim or paraphrased criterion from spec>) — <how this PR satisfies it; cite the file/route/component as a claim>
- **AC2** — <how this PR satisfies it>
- **AC3** — <how this PR satisfies it>

## Invariant defense
<For each invariant the spec lists in `Invariants in scope`, state how this PR preserves it. Engineer's silence on an in-scope invariant is reviewer's automatic CHANGES_REQUESTED.>

- <invariant from spec> — <preserved because <reason>>
- <invariant from spec> — <preserved because <reason>>

## Decisions and risks
<Non-obvious choices the spec didn't mandate (e.g. "chose X over Y because..."). Open questions or risks for QA/reviewer. Known-fragile interactions. The "why this and not that" section. If the spec was silent on a load-bearing call, you must own the choice here.>

- <decision> — <reasoning>
- <risk> — <mitigation, or flag for downstream attention>

## Self-verification
- [ ] `.claude/ci/run.sh` exits 0 (run from inside your worktree)
- [ ] manual smoke (if UI): <route or command tied to an acceptance criterion>
- [ ] <other deterministic check the AC implies>

<For each item, one line on what you observed. The reviewer trusts this paste — keep it honest and complete.>

## CI run
```
<paste last 5 lines of .claude/ci/run.sh output, ending with the success marker>
```

## QA gate
<Filled by qa after merging test/<slug> onto feat/<slug> in their gate worktree and running the spec-derived tests. Format: per-AC PASS/FAIL with evidence; CI baseline status; verdict PASS or FAIL. Engineer leaves this empty when opening the PR.>

## Reviews
<Filled by reviewer after qa gate is PASS. Reviewer reads spec + this PR file, NEVER code. Format: spec-coverage probes, open adversarial questions, verdict APPROVED or CHANGES_REQUESTED. Engineer leaves this empty when opening the PR.>

## Telemetry
<Filled by team-lead post-merge from `.claude/telemetry/SPEC-<id>.summary.md` (which is itself derived from the per-event JSONL log at `.claude/telemetry/SPEC-<id>.jsonl`). Format: stage rollup, biggest-dispatch / biggest-return, ci runs, spec amendments, elapsed wall-clock. Optional — see `.claude/telemetry/README.md` for schema and disable mechanics. Engineer / qa / reviewer leave this empty.>
