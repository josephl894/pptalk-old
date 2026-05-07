# PR-4: Standardize per-agent worktrees to prevent branch-swap races
Author: eng-3
Branch: chore/worktree-conventions
Status: open

## Why
PR-1 and PR-2 qa smokes (2026-05-06) hit two distinct races caused by every agent sharing the primary tree at `/Users/joseph/Desktop/pptalk`: a peer's `git checkout` swapped files under qa's running render, and the shared `:3000` dev server changed branches mid-test. This PR codifies per-task git worktrees + an isolated qa dev server on `:3001`, so each agent's reads, imports, and processes are pinned to a stable file tree for the duration of the work.

## What changed
- `CLAUDE.md` — PR-loop section rewritten to require per-task worktrees on implement, per-review worktrees for CI, per-PR qa worktrees + isolated `:3001` dev server, and a transient `/tmp/pptalk-merge` worktree for team-lead's merges. Added an env-file symlink note because `pipeline/.env` and `web/.env.local` are git-ignored and won't be in a fresh worktree (CI's Python import smoke fails without them).
- `.claude/team/engineer.md` — new hard-rule entry; PR workflow steps 2 (worktree creation + env symlink + per-worktree `npm install` / `uv sync`), 4 (CI from inside worktree), 7 (iterate inside worktree), 9 (cleanup on merge).
- `.claude/team/qa.md` — new "Per-PR worktree" section before the regression procedure; process-health/API-smoke/pipeline-regression/UI-verification steps rewritten to use worktree paths and port `:3001`; new hard-rule.
- `.claude/team/reviewer.md` — diff/log reads from primary tree are explicitly safe; CI must run from `/tmp/pptalk-review-<id>` worktree; new hard-rule.

## Test plan
- [x] `.claude/ci/run.sh` exits 0 (run from inside `/tmp/pptalk-worktree-conventions` with env files symlinked).
- [ ] qa regression — not applicable; docs-only change with no runtime impact.
- [x] Self-validating: this PR was authored entirely inside `/tmp/pptalk-worktree-conventions` while the primary tree was on `fix/voice-card-polish` and `feat/batched-narration-worker` was active in another worktree, with no observed file-system races.

The task description includes a parallel-dispatch test plan (two engineers + qa concurrent on test branches). That validation belongs to the team-lead since it requires dispatching across multiple agents — flagged here, out of scope for an individual engineer to execute solo.

## CI run
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

## Reviews
