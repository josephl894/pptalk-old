#!/usr/bin/env bash
# CI script — runs on every PR before review and before merge.
# Fast checks only (no full render). Engineer/reviewer/team-lead all run this.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "→ TS type-check (web)"
cd "$REPO_ROOT/web" && npx tsc --noEmit

echo "→ Python import smoke (pipeline)"
cd "$REPO_ROOT/pipeline" && uv run python -c "
from narrator import cli, parse, parse_pdf, render, render_pdf, script, tts, video, usage, db, queries, storage, pipeline_runner, worker
print('imports OK')
"

echo "✓ CI green"
