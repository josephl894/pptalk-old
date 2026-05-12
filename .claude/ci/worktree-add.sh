#!/usr/bin/env bash
# Wrapper around `git worktree add` that follows the team's per-agent worktree
# convention (see CLAUDE.md "Engineering workflow (PR loop)" + the team
# briefings). Creates /tmp/pptalk-<slug>, branches off main, and symlinks the
# git-ignored env files (pipeline/.env, web/.env.local) from the primary tree
# so CI's Python import smoke does not fail with `ANTHROPIC_API_KEY is not set`.
#
# Usage:
#   .claude/ci/worktree-add.sh <slug> [<base-branch>]
#     slug         short-kebab-case, ≤4 words (e.g. draft-all-toast). The
#                  branch will be named `<feat|fix|chore>/<slug>` — the prefix
#                  is your responsibility, slug stays as you typed it.
#     base-branch  defaults to main. Pass an existing branch to share its tip.
#
# Examples:
#   .claude/ci/worktree-add.sh feat/draft-all-toast
#   .claude/ci/worktree-add.sh fix/uuid-guard         # off main
#   .claude/ci/worktree-add.sh chore/worktree-cleanup main
#
# After this script:
#   cd /tmp/pptalk-<slug>
#   # if web is needed: (cd web && npm install)
#   # if pipeline is needed: (cd pipeline && uv sync)

set -euo pipefail

PRIMARY_TREE="/Users/joseph/Desktop/pptalk"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <branch> [<base>]" >&2
  echo "  branch must include a prefix (feat/, fix/, chore/, docs/, refactor/)" >&2
  exit 2
fi

BRANCH="$1"
BASE="${2:-main}"

case "$BRANCH" in
  feat/*|fix/*|chore/*|docs/*|refactor/*|test/*) ;;
  *)
    echo "error: branch must be prefixed with feat/ fix/ chore/ docs/ refactor/ test/ (got '$BRANCH')" >&2
    exit 2
    ;;
esac

PREFIX="${BRANCH%%/*}"
SLUG="${BRANCH#*/}"
# qa's test/ branches pair with engineer's feat/ branches on the same slug —
# differentiate the worktree path to avoid collision when both run in parallel.
if [ "$PREFIX" = "test" ]; then
  WORKTREE="/tmp/pptalk-test-${SLUG}"
else
  WORKTREE="/tmp/pptalk-${SLUG}"
fi

if [ -e "$WORKTREE" ]; then
  echo "error: $WORKTREE already exists. Pick a different slug, or run: git -C $PRIMARY_TREE worktree remove $WORKTREE" >&2
  exit 1
fi

git -C "$PRIMARY_TREE" worktree add "$WORKTREE" -b "$BRANCH" "$BASE"

# Symlink env files from the primary tree (git-ignored, won't carry over).
# Fail loudly if the source file is missing — silently skipping would just
# defer the error to CI, where it surfaces as `ANTHROPIC_API_KEY is not set`.
# A pre-existing target in the new worktree is fine (re-run / racy creation).
link_env() {
  local src="$1" dst="$2"
  if [ ! -e "$src" ]; then
    echo "error: source env file missing: $src" >&2
    echo "       restore it in the primary tree before running this helper." >&2
    exit 1
  fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    return 0
  fi
  ln -s "$src" "$dst"
}
link_env "$PRIMARY_TREE/pipeline/.env"  "$WORKTREE/pipeline/.env"
link_env "$PRIMARY_TREE/web/.env.local" "$WORKTREE/web/.env.local"

echo
echo "✓ Worktree ready: $WORKTREE  (branch $BRANCH off $BASE)"
echo "  cd $WORKTREE"
echo "  # web work:      (cd web && npm install)"
echo "  # pipeline work: (cd pipeline && uv sync)"
echo "  # CI:            .claude/ci/run.sh"
echo "  # cleanup later: git -C $PRIMARY_TREE worktree remove $WORKTREE"
