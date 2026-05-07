#!/usr/bin/env bash
# SPEC-7 AC1: Given a fresh anonymous user (no pptalk_uid cookie) and a running
# worker, When the user uploads a valid multi-page PDF on /new, Then within 30
# seconds of upload completion the user is at /p/<project_id> with one slide
# thumbnail per PDF page rendered in the filmstrip and the "parsing" UI is no
# longer visible.
#
# Observable mapping: the editor at /p/[id] is fueled by GET /api/projects/[id],
# which returns {project, slides}. "Editor opens with slides" maps 1:1 to:
#   - HTTP 200 from GET /api/projects/[id]
#   - response.slides.length === pdf_page_count
#   - response.project.status !== 'parsing'  (the "parsing UI" is gated on this)
#
# Preconditions (caller responsibility):
#   - Next dev server running on :3001 in the gate worktree
#   - Supabase containers up
#   - Python worker running (cd pipeline && uv run narrator worker)
#
# Exit 0 on PASS, non-zero on FAIL.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIXTURE="$ROOT/.claude/qa/spec-7/fixtures/three_page.pdf"
EXPECTED_PAGES=3
TIMEOUT_S=30
HOST="${PPTALK_HOST:-http://localhost:3001}"

if [ ! -f "$FIXTURE" ]; then
  echo "FAIL: fixture missing at $FIXTURE — run build_fixture.py" >&2
  exit 2
fi

# Fresh cookie jar — AC1 starts from "no pptalk_uid cookie".
JAR="$(mktemp /tmp/pptalk-spec7-ac1.cookies.XXXXXX)"
trap 'rm -f "$JAR"' EXIT

# Bootstrap the anonymous identity. The pptalk_uid cookie is minted by the
# /api/projects routes (not the home page render path), so a quick GET there
# gives us a fresh cookie before the upload.
curl -s -c "$JAR" -b "$JAR" -o /dev/null "$HOST/api/projects" || {
  echo "FAIL: cannot reach $HOST/api/projects — is the dev server running on :3001?" >&2
  exit 1
}

if ! grep -q "pptalk_uid" "$JAR"; then
  echo "FAIL: pptalk_uid cookie was not set after GET /api/projects" >&2
  cat "$JAR" >&2
  exit 1
fi

# Upload the PDF. POST /api/projects is multipart with file + name fields per
# hats/engineering.md "API surface". Returns {project, job_id}.
UPLOAD_START=$(date +%s)
UPLOAD_RESP="$(curl -s -b "$JAR" -c "$JAR" \
  -F "file=@${FIXTURE};type=application/pdf" \
  -F "name=spec-7-ac1" \
  "$HOST/api/projects")"

PROJECT_ID="$(printf '%s' "$UPLOAD_RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("project",{}).get("id") or d.get("id") or "")' 2>/dev/null || true)"

if [ -z "$PROJECT_ID" ]; then
  echo "FAIL: POST /api/projects did not return a project id" >&2
  echo "response: $UPLOAD_RESP" >&2
  exit 1
fi
echo "AC1: uploaded, project_id=$PROJECT_ID"

# Poll GET /api/projects/[id] until slides resolve OR timeout.
DEADLINE=$(( UPLOAD_START + TIMEOUT_S ))
LAST_BODY=""
LAST_STATUS=""
LAST_SLIDES=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  BODY="$(curl -s -b "$JAR" "$HOST/api/projects/$PROJECT_ID")"
  LAST_BODY="$BODY"
  read -r STATUS SLIDES <<<"$(printf '%s' "$BODY" | python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("?", "?")
    sys.exit(0)
proj = d.get("project") or d
slides = d.get("slides") or proj.get("slides") or []
print(proj.get("status","?"), len(slides))
' 2>/dev/null || echo "? ?")"
  LAST_STATUS="$STATUS"
  LAST_SLIDES="$SLIDES"
  if [ "$STATUS" != "parsing" ] && [ "$STATUS" != "?" ] && [ "$SLIDES" = "$EXPECTED_PAGES" ]; then
    ELAPSED=$(( $(date +%s) - UPLOAD_START ))
    echo "AC1 PASS: status=$STATUS slides=$SLIDES elapsed=${ELAPSED}s (≤${TIMEOUT_S}s)"
    exit 0
  fi
  sleep 1
done

ELAPSED=$(( $(date +%s) - UPLOAD_START ))
echo "AC1 FAIL: did not become editor-ready within ${TIMEOUT_S}s (elapsed ${ELAPSED}s)" >&2
echo "  last project.status=$LAST_STATUS  last slides count=$LAST_SLIDES" >&2
echo "  last GET response: $LAST_BODY" >&2
exit 1
