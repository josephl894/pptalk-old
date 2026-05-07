#!/usr/bin/env bash
# SPEC-7 AC3: Given the worker is NOT running, When the user uploads a PDF on
# /new (or refreshes into the editor while parse_only is unclaimed past a
# bounded threshold), Then within 60 seconds the parsing UI surfaces a
# recoverable, non-blocking message indicating the render worker is not
# available — the message must (a) name the worker, (b) suggest starting it,
# (c) not block other UI from rendering. The job row stays 'pending'
# (not 'failed') so a started worker still picks it up.
#
# Implementation note on "pending":
#   render_jobs.status default in the Drizzle schema is 'queued'. The spec
#   contrasts 'pending' with 'failed', so the strict observable is "not
#   failed and not completed" — i.e. the row remains in a non-terminal,
#   re-claimable state. We assert that, accepting either 'queued' or
#   'pending' as concrete representations.
#
# Implementation note on "names the worker / suggests start":
#   Spec allows DOM probe OR API status field. We accept either:
#     - GET /p/[id] HTML body contains a string matching /worker/i AND
#       (/start/i OR /run/i)
#     - GET /api/projects/[id] response has a field anywhere in its JSON
#       containing such text (e.g. project.warning, project.worker_status,
#       etc.)
#
# Preconditions (caller responsibility):
#   - Next dev server running on :3001
#   - Supabase containers up
#   - Python worker NOT running (this script verifies and aborts if it sees one)
#
# Exit 0 on PASS, non-zero on FAIL.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIXTURE="$ROOT/.claude/qa/spec-7/fixtures/three_page.pdf"
TIMEOUT_S=60
HOST="${PPTALK_HOST:-http://localhost:3001}"
DB_CONTAINER="${PPTALK_DB_CONTAINER:-supabase_db_web}"

# Verify worker is NOT running. AC3 precondition.
if pgrep -f "narrator worker" >/dev/null 2>&1; then
  echo "FAIL: narrator worker is currently running — AC3 requires it stopped" >&2
  echo "  pids: $(pgrep -f 'narrator worker' | tr '\n' ' ')" >&2
  exit 2
fi

if [ ! -f "$FIXTURE" ]; then
  echo "FAIL: fixture missing at $FIXTURE" >&2
  exit 2
fi

JAR="$(mktemp /tmp/pptalk-spec7-ac3.cookies.XXXXXX)"
trap 'rm -f "$JAR"' EXIT

curl -s -c "$JAR" -b "$JAR" -o /dev/null "$HOST/" || {
  echo "FAIL: cannot reach $HOST/" >&2; exit 1; }

UPLOAD_START=$(date +%s)
UPLOAD_RESP="$(curl -s -b "$JAR" -c "$JAR" \
  -F "file=@${FIXTURE};type=application/pdf" \
  -F "name=spec-7-ac3" \
  "$HOST/api/projects")"

PROJECT_ID="$(printf '%s' "$UPLOAD_RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("project",{}).get("id") or d.get("id") or "")' 2>/dev/null || true)"
if [ -z "$PROJECT_ID" ]; then
  echo "FAIL: upload returned no project id" >&2
  echo "response: $UPLOAD_RESP" >&2
  exit 1
fi
echo "AC3: uploaded, project_id=$PROJECT_ID (worker offline)"

probe_signal() {
  # Returns 0 if worker-not-available signal is detected via API or DOM.
  local body
  # API surface
  body="$(curl -s -b "$JAR" "$HOST/api/projects/$PROJECT_ID" || true)"
  if printf '%s' "$body" | python3 -c '
import json,sys,re
try:
  d=json.load(sys.stdin)
except Exception:
  sys.exit(2)
def walk(x):
  if isinstance(x,dict):
    for v in x.values(): yield from walk(v)
  elif isinstance(x,list):
    for v in x: yield from walk(v)
  elif isinstance(x,str):
    yield x
texts=list(walk(d))
joined=" \n".join(texts)
ok = re.search(r"worker", joined, re.I) and re.search(r"\b(start|run|launch)\b", joined, re.I)
sys.exit(0 if ok else 1)
' 2>/dev/null; then
    echo "    api-signal: matched"
    return 0
  fi
  # DOM surface
  body="$(curl -s -b "$JAR" "$HOST/p/$PROJECT_ID" || true)"
  if printf '%s' "$body" | python3 -c '
import sys,re
t=sys.stdin.read()
ok = re.search(r"worker", t, re.I) and re.search(r"\b(start|run|launch)\b", t, re.I)
sys.exit(0 if ok else 1)
' 2>/dev/null; then
    echo "    dom-signal: matched"
    return 0
  fi
  return 1
}

# Poll for the worker-not-available affordance up to 60s.
DEADLINE=$(( UPLOAD_START + TIMEOUT_S ))
SIGNAL_FOUND=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if probe_signal; then
    SIGNAL_FOUND=1
    break
  fi
  sleep 2
done

ELAPSED=$(( $(date +%s) - UPLOAD_START ))

FAIL=0

# 3.1 — visibility within 60s
if [ "$SIGNAL_FOUND" = "1" ]; then
  echo "  [OK] worker-not-available signal surfaced within ${ELAPSED}s (≤${TIMEOUT_S}s)"
else
  echo "  [FAIL] no worker-not-available signal surfaced within ${TIMEOUT_S}s" >&2
  FAIL=1
fi

# 3.2 — render_jobs row stays in a non-terminal, re-claimable state
JOB_STATUS="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAXc \
  "SELECT status FROM render_jobs WHERE project_id='$PROJECT_ID' AND kind='parse_only' ORDER BY created_at LIMIT 1;")"
case "$JOB_STATUS" in
  pending|queued)
    echo "  [OK] render_jobs.status='$JOB_STATUS' (re-claimable, not failed)"
    ;;
  failed|completed|"")
    echo "  [FAIL] render_jobs.status='$JOB_STATUS' — must be re-claimable (pending|queued), not failed/completed" >&2
    FAIL=1
    ;;
  *)
    echo "  [FAIL] render_jobs.status='$JOB_STATUS' is unexpected; expected pending or queued" >&2
    FAIL=1
    ;;
esac

# 3.3 — other UI not blocked: /p/[id] returns HTTP 200 with HTML
HTTP_CODE_AND_LEN="$(curl -s -b "$JAR" -o /tmp/pptalk-spec7-ac3.body -w '%{http_code} %{size_download}' "$HOST/p/$PROJECT_ID")"
read -r CODE LEN <<<"$HTTP_CODE_AND_LEN"
if [ "$CODE" = "200" ] && [ "${LEN:-0}" -gt 100 ]; then
  echo "  [OK] /p/$PROJECT_ID returns 200 ($LEN bytes) — UI not blocked"
else
  echo "  [FAIL] /p/$PROJECT_ID returned HTTP $CODE ($LEN bytes) — UI may be blocked" >&2
  FAIL=1
fi
rm -f /tmp/pptalk-spec7-ac3.body

if [ "$FAIL" = "0" ]; then
  echo "AC3 PASS"
  exit 0
fi
echo "AC3 FAIL" >&2
exit 1
