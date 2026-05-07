# PR-5: Standardize per-agent worktrees to prevent branch-swap races
Author: eng-3
Branch: chore/worktree-conventions
Status: open (revised after CHANGES_REQUESTED)

## Why
PR-1 and PR-2 qa smokes (2026-05-06) hit two distinct races caused by every agent sharing the primary tree at `/Users/joseph/Desktop/pptalk`: a peer's `git checkout` swapped files under qa's running render, and the shared `:3000` dev server changed branches mid-test. This PR codifies per-task git worktrees + an isolated qa dev server on `:3001`, so each agent's reads, imports, and processes are pinned to a stable file tree for the duration of the work.

## What changed
- `CLAUDE.md` — PR-loop section rewritten to require per-task worktrees on implement, per-review worktrees for CI, per-PR qa worktrees + isolated `:3001` dev server, and a transient `/tmp/pptalk-merge` worktree for team-lead's merges. Added an env-file symlink note because `pipeline/.env` and `web/.env.local` are git-ignored and won't be in a fresh worktree (CI's Python import smoke fails without them).
- `.claude/team/engineer.md` — new hard-rule entry; PR workflow steps 2 (worktree creation via helper or manual + env symlink + per-worktree `npm install` / `uv sync`), 4 (CI from inside worktree), 7 (iterate inside worktree), 9 (cleanup on merge).
- `.claude/team/qa.md` — new "Per-PR worktree" section before the regression procedure; process-health/API-smoke/pipeline-regression/UI-verification steps rewritten to use worktree paths and port `:3001`; new hard-rule.
- `.claude/team/reviewer.md` — diff/log reads from primary tree are explicitly safe; CI must run from `/tmp/pptalk-review-<id>` worktree; new hard-rule.
- `.claude/ci/worktree-add.sh` — new helper that wraps `git worktree add` for engineers: validates branch prefix (feat/fix/chore/docs/refactor), creates `/tmp/pptalk-<slug>`, symlinks `pipeline/.env` + `web/.env.local`, prints the next-step reminders. qa and reviewer use the manual `git worktree add` form because their worktree paths (`/tmp/pptalk-qa-<pr-id>`, `/tmp/pptalk-review-<pr-id>`) need PR-id disambiguation that the slug-based helper would not provide.

## Test plan
- [x] `.claude/ci/run.sh` exits 0 (run from inside `/tmp/pptalk-worktree-conventions` with env files symlinked).
- [x] `worktree-add.sh chore/wt-script-smoke` smoke: helper created `/tmp/pptalk-wt-script-smoke`, symlinked both env files, `uv sync` + `python -c "from narrator import script"` returned `imports OK`. Cleanup via `git -C /Users/joseph/Desktop/pptalk worktree remove` was clean.
- [x] `worktree-add.sh` rejects bad input: missing arg → exit 2 + usage; missing prefix (`badname`) → exit 2 + clear error; pre-existing target → exit 1 + suggested cleanup command.
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

### reviewer @ 2026-05-06T22:30:00Z

CI run from a per-review worktree following the very convention being introduced: `git worktree add /tmp/pptalk-pr5-review chore/worktree-conventions`, symlinked `pipeline/.env` + `web/.env.local` + dep dirs from the primary tree. `.claude/ci/run.sh` exits 0.

**Helper script smoke — passes the basic shapes**
- Missing arg → `usage:...` to stderr, **exit 2**. ✓
- Bad prefix `badname` → clear `error: branch must be prefixed...` to stderr, **exit 2**. ✓
- Valid `feat/wt-helper-smoke` → worktree created at `/tmp/pptalk-wt-helper-smoke`, branch created. ✓
- Re-run with same slug → `error: ... already exists. Pick a different slug, or run: ...`, **exit 1**. ✓
- Env files in the new worktree are **symlinks**, not copies (`lrwxr-xr-x ... pipeline/.env -> /Users/joseph/Desktop/pptalk/pipeline/.env`). ✓

**Briefing internal consistency — mostly aligned, two drifts to flag**
- Per-agent worktree paths: engineer `/tmp/pptalk-<slug>`, qa `/tmp/pptalk-qa-<pr-id>`, reviewer `/tmp/pptalk-review-<pr-id>` — consistent across CLAUDE.md, engineer.md, qa.md, reviewer.md.
- The qa `:3001` isolation is properly documented in qa.md (initial worktree section, process-health, dev-server-health, API smoke, UUID guard, UI verification all updated to `:3001` and `/tmp/qa-nextdev-<pr-id>.log`). ✓
- Cleanup discipline is paired in every role: engineer.md step 9, reviewer.md after step 3, qa.md "Cleanup at the end of the smoke." Consistent. ✓
- **Drift 1 (non-blocking)**: CLAUDE.md uses `<id>` for reviewer/qa worktrees (lines 28, 30), while reviewer.md and qa.md use `<pr-id>`. Same concept, different placeholder string. A fresh agent reading both will pause to figure out if it's the same thing. Suggest aligning on `<pr-id>` everywhere.
- **Drift 2 (non-blocking)**: CLAUDE.md "Implement" step (line 26) shows the manual `git worktree add /tmp/pptalk-<slug> -b <feat|fix>/<slug> main` form and never references the new helper. engineer.md step 2 leads with the helper. A fresh engineer reading only CLAUDE.md won't know the helper exists. Either move the helper as the canonical CLAUDE.md form or add a "(or use `.claude/ci/worktree-add.sh`)" pointer.

**Team-lead merge clause — DOES NOT RUN UNDER THE CONVENTION'S OWN STEADY STATE**

This is a real bug that I think should block:

CLAUDE.md line 31:
```
git worktree add /tmp/pptalk-merge main && cd /tmp/pptalk-merge && ...
```

Adjacent CLAUDE.md branch-protection clause:
```
The primary tree at `/Users/joseph/Desktop/pptalk` stays on `main` at all times — every other working surface is a `/tmp/pptalk-*` worktree owned by exactly one agent.
```

These two rules are mutually exclusive. Verified empirically:
```
$ git -C /Users/joseph/Desktop/pptalk worktree add /tmp/pptalk-merge-test main
fatal: 'main' is already used by worktree at '/private/tmp/pptalk-worktree-conventions'
exit 128
```
Git refuses to check the same branch out in two worktrees. As soon as this PR merges and the convention's "primary tree stays on main" rule takes effect, the documented merge command **stops working** — and this is the headline incident the PR cites in its `## Why` ("cause of my mis-commit incident earlier").

The PR's "self-validating" test plan at line 21 doesn't catch this because at authoring time the primary tree was on `fix/voice-card-polish`, so `main` was free to be checked out elsewhere. After this PR merges, the steady state inverts and the command breaks.

**Recommended fix (cleanest):** drop the merge-worktree pattern. Under "primary tree stays on main", merging from the primary tree is race-free *because* no other agent reads from main during the merge — they're all in `/tmp/pptalk-*`. The merge step in CLAUDE.md should just be:
```
cd /Users/joseph/Desktop/pptalk    # already on main per the branch-protection rule
git merge --no-ff --no-edit <branch>
git branch -d <branch>
```
The "never the primary tree" phrase in CLAUDE.md line 31 should be deleted; the primary tree is *exactly* where merges belong under this convention. Then notify the authoring engineer to `git worktree remove /tmp/pptalk-<slug>`.

If a transient merge worktree is genuinely wanted (e.g. to keep `main` in the primary tree pristine during pre-merge sanity), the documented incantation needs to use `--detach` or another pattern that doesn't fight git's "one branch, one worktree" invariant — and that needs to be tested under steady state, not at authoring time.

**Helper script — small foot-gun in the env-symlink line (non-blocking)**
- `worktree-add.sh:57-58`:
  ```
  ln -s "$PRIMARY_TREE/pipeline/.env"  "$WORKTREE/pipeline/.env"  2>/dev/null || true
  ```
  The `|| true` swallows ALL failures, including "source file does not exist." If the primary tree is ever missing `pipeline/.env` (fresh checkout, accidental delete, etc.), the helper silently succeeds and CI then fails downstream with the exact `ANTHROPIC_API_KEY is not set` error the helper exists to prevent.
- Cheaper, more honest: check the source file exists before symlinking; if a target already exists in the worktree (re-run case), skip; if source is missing, fail with a clear message.

**Helper coverage scope — eng-1's call is reasonable, with one suggestion**
- Engineer-only helper: rationale (qa/reviewer paths need PR-id disambiguation that the slug-based helper doesn't provide) is sound on its face.
- That said, the qa/reviewer manual form is mostly the same shape as the engineer form plus PR-id; a 4-line addition (`-q <pr-id>` / `-r <pr-id>` flags that pick `pptalk-qa-<id>` / `pptalk-review-<id>` paths) would close the gap and let qa/reviewer benefit from the same env-symlink convenience without touching the manual path. Worth a follow-up; not necessary for this PR.

**Cleanup discipline — verified paired across all roles**
- engineer.md step 9 → "remove your worktree" after merge confirmation.
- reviewer.md after step 3 → "Clean up" with the explicit `git worktree remove /tmp/pptalk-review-<pr-id>`.
- qa.md "Cleanup at the end of the smoke" → kills `:3001` dev process, returns to primary, removes worktree.
- CLAUDE.md "Merge" step → notifies authoring engineer to remove the per-task worktree.
✓ pairing complete.

**DOCS-STYLE.md sweep — clean**
- Headings sentence case, dates `YYYY-MM-DD`, bullets `-`, no emoji in docs (the `✓` in the helper's runtime echo output is shell output, not a doc rule violation), no time estimates. ✓

**Locked-rules sweep — clean**
- No code paths, no API surface, no schema, no design tokens, no locked copy touch. Pure process/docs change with one auxiliary shell helper. ✓

**Verdict: CHANGES_REQUESTED**

Blocker:
1. **Merge clause is broken under the convention's steady state.** `git worktree add /tmp/pptalk-merge main` cannot succeed when `main` is checked out in the primary tree, which the same convention requires. Recommend dropping the merge-worktree pattern entirely (the primary tree on `main` is exactly the right place to merge — no race because peers are in `/tmp/pptalk-*`); or replace with a tested-under-steady-state alternative.

Once that's addressed, the rest are non-blocking polish items but worth folding into the same iteration:
- `<id>` vs `<pr-id>` placeholder drift between CLAUDE.md and the briefings.
- CLAUDE.md "Implement" step doesn't mention the `worktree-add.sh` helper.
- Helper's env-symlink lines should fail loudly on missing source rather than `|| true`-swallowing.
- (Suggestion only, not iterate-required) extend the helper with `-q <pr-id>` / `-r <pr-id>` flags to cover qa/reviewer paths — or document why deliberately not.

## Author response

### eng-3 @ 2026-05-07T01:25:00Z

All four points addressed in this iteration. Empirical aside — while idle for review, my worktree itself got swapped to `main` by some peer process (`git status` reported `On branch main` from inside `/tmp/pptalk-worktree-conventions`, files gone). Restored with `git checkout chore/worktree-conventions`, which is itself another data point for why the convention matters. Not a regression in the PR; just noting it.

**1. Merge clause (blocker).** Dropped the `/tmp/pptalk-merge` worktree pattern entirely. CLAUDE.md "Merge" step now reads:
```
cd /Users/joseph/Desktop/pptalk
git merge --no-ff --no-edit <branch>
git branch -d <branch>
```
The primary tree is already on `main` per the branch-protection rule, so the merge is race-free without an extra worktree — every other agent is in `/tmp/pptalk-*`. Phrase "never the primary tree" deleted. The branch-protection bullet now also captures the rationale + the empirical reason a separate merge worktree fails (git refuses to check out the same branch in two worktrees).

**2. `<id>` vs `<pr-id>` drift.** Aligned on `<pr-id>` everywhere in CLAUDE.md (engineer's own worktree stays as `<slug>`; reviewer/qa worktrees use `<pr-id>`). Briefings already used `<pr-id>` so no change there.

**3. Helper visibility in CLAUDE.md.** "Implement" step now leads with the helper as the recommended path (`.claude/ci/worktree-add.sh <feat|fix|chore>/<slug>`) and shows the manual `git worktree add` form as the equivalent fallback. engineer.md step 2 already had this shape; CLAUDE.md now matches.

**4. Helper env-symlink foot-gun.** Replaced `ln -s ... 2>/dev/null || true` with a `link_env()` helper that:
- Fails loudly with a clear error + non-zero exit if the source file is missing in the primary tree (the exact case `|| true` was swallowing).
- No-ops when the destination already exists or is already a symlink (for re-run / racy creation cases).
- Otherwise creates the symlink without redirecting stderr, so any genuine `ln` error surfaces.

Smoke-tested: missing-source path exits 1 with "source env file missing: ..."; idempotent re-run on an existing symlink returns 0 cleanly; happy path symlinks both env files. All previous helper smokes (bad-prefix, missing-arg, pre-existing-target) still pass.

**(Suggestion, deferred.)** The `-q <pr-id>` / `-r <pr-id>` flags for qa/reviewer paths are a clean follow-up but not required for this iteration. Filing as a follow-up rather than expanding scope here.

### CI (revised)
```
→ TS type-check (web)
→ Python import smoke (pipeline)
imports OK
✓ CI green
```

### reviewer @ 2026-05-07T02:10:00Z (re-review)

Re-reviewed `f497040..b9d02ec` from a fresh per-review worktree. CI green on the revised tip.

**Blocker fix — merge clause is now correct.** `cd /Users/joseph/Desktop/pptalk && git merge --no-ff --no-edit <branch> && git branch -d <branch>` — exact recommended snippet, "never the primary tree" phrase deleted, rationale added inline to the branch-protection bullet (calling out the empirical "git refuses to check out the same branch in two worktrees" reason). This is now a self-consistent set of rules: primary tree on main + merge from primary tree + worktrees for everyone else. ✓

**Polish 1 — `<id>` → `<pr-id>` aligned across CLAUDE.md.** Engineer's per-task path correctly stays as `<slug>` (it's keyed off the branch slug, not the PR id), reviewer/qa/cleanup paths all use `<pr-id>` consistently. The two pre-existing `<id>` references in reviewer.md (lines 26, 84) refer to the PR *file name* (`PR-<id>.md`), which is a different concept than the worktree path placeholder and was not introduced by this PR — out of scope, leaving as-is. ✓

**Polish 2 — helper visibility in CLAUDE.md.** "Implement" step now leads with the recommended `.claude/ci/worktree-add.sh <feat|fix|chore>/<slug>` and shows the manual `git worktree add` form as the equivalent fallback. Matches the shape in engineer.md step 2. ✓

**Polish 3 — helper env-symlink loud-fail.** Replaced `ln -s ... 2>/dev/null || true` with a `link_env()` function. Smoke-tested all three paths from the review worktree:
- Happy path (both env files present in primary): worktree created, both env files are symlinks (`lrwxr-xr-x` confirmed, not copies), exit 0.
- Idempotent re-link with existing symlink as `dst`: returns 0 cleanly (`[ -L "$dst" ]` short-circuit) — verified by direct `link_env` invocation since the outer `worktree add` failure short-circuits before reaching the link step on a true re-run.
- Missing source: exits 1 with `error: source env file missing: ...` to stderr — verified by direct `link_env` invocation against a non-existent path.

The fix is exactly the right shape: silently swallowing only the cases that don't matter (re-run / race), surfacing the case that does (missing source, which is the original foot-gun). ✓

**Aside on eng-3's note**: their `## Author response` mentions their own worktree got swapped to `main` mid-iteration. I observed the same state independently (`/private/tmp/pptalk-worktree-conventions` is on main now, not the PR branch). Doesn't affect this PR — the branch ref `chore/worktree-conventions` is intact at `b9d02ec`. Just another data point for the convention's necessity.

**Locked-rules sweep — clean** (pure process/docs change; no code path / API / schema / design / copy touch).
**DOCS-STYLE.md sweep — clean** (sentence-case headings, dates fine, bullets `-`, no emoji in docs, no time estimates).

**Verdict: APPROVED**

Once merged, the convention takes effect immediately: every subsequent PR will be authored, CI'd, reviewed, qa'd, and merged through the new pattern. Worth flagging to the team in the merge notification so any agent currently mid-task knows to migrate any in-flight work into a per-task worktree.
