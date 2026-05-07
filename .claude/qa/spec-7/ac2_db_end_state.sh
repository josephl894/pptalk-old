#!/usr/bin/env bash
# SPEC-7 AC2: Given AC1's flow completed successfully, Then the corresponding
# render_jobs row has status = 'completed' and kind = 'parse_only', the slides
# table has exactly N rows for that project_id (where N = PDF page count) with
# idx values 0..N-1, and every slide row has a non-null image_path whose object
# resolves via the Supabase Storage signed-URL helper.
#
# Implementation note: the only image-path column on slides is png_path (per
# Drizzle schema). We assert against png_path; if a follow-up adds an
# image_path column, this test must be updated by the spec, not by patching.
#
# This test runs *after* AC1 against the same project — it accepts a project_id
# as $1, OR if not given, performs an AC1-style upload itself first.
#
# Preconditions: same as AC1 (web on :3001, Supabase up, worker running).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIXTURE="$ROOT/.claude/qa/spec-7/fixtures/three_page.pdf"
EXPECTED_PAGES=3
TIMEOUT_S=30
BUCKET="pptalk-private"
HOST="${PPTALK_HOST:-http://localhost:3001}"
DB_CONTAINER="${PPTALK_DB_CONTAINER:-supabase_db_web}"

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/web/.env.local"
  set +a
  : "${SUPABASE_URL:=${NEXT_PUBLIC_SUPABASE_URL:-}}"
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "FAIL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env" >&2
  exit 2
fi

PROJECT_ID="${1:-}"

# Self-bootstrap if no project id passed.
if [ -z "$PROJECT_ID" ]; then
  JAR="$(mktemp /tmp/pptalk-spec7-ac2.cookies.XXXXXX)"
  trap 'rm -f "$JAR"' EXIT
  curl -s -c "$JAR" -b "$JAR" -o /dev/null "$HOST/api/projects" || {
    echo "FAIL: cannot reach $HOST/api/projects" >&2; exit 1; }
  UPLOAD_RESP="$(curl -s -b "$JAR" -c "$JAR" \
    -F "file=@${FIXTURE};type=application/pdf" \
    -F "name=spec-7-ac2" \
    "$HOST/api/projects")"
  PROJECT_ID="$(printf '%s' "$UPLOAD_RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("project",{}).get("id") or d.get("id") or "")' 2>/dev/null || true)"
  [ -n "$PROJECT_ID" ] || { echo "FAIL: upload returned no id" >&2; exit 1; }

  # Wait for parse to finish (so render_jobs.status reaches 'completed').
  DEADLINE=$(( $(date +%s) + TIMEOUT_S ))
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    DONE="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAXc \
      "SELECT count(*) FROM render_jobs WHERE project_id='$PROJECT_ID' AND kind='parse_only' AND status='completed';")"
    [ "$DONE" = "1" ] && break
    sleep 1
  done
fi

echo "AC2: asserting against project $PROJECT_ID"

FAIL=0

# 2.1 — render_jobs row state
JOB_ROW="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAXc \
  "SELECT kind || '|' || status FROM render_jobs WHERE project_id='$PROJECT_ID' ORDER BY created_at LIMIT 1;")"
echo "  render_jobs first row (kind|status): $JOB_ROW"
case "$JOB_ROW" in
  "parse_only|completed") echo "  [OK] render_jobs.kind='parse_only' AND status='completed'" ;;
  *)
    echo "  [FAIL] expected 'parse_only|completed', got '$JOB_ROW'" >&2
    FAIL=1 ;;
esac

# 2.2 — slides count
SLIDES_COUNT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAXc \
  "SELECT count(*) FROM slides WHERE project_id='$PROJECT_ID' AND deleted_at IS NULL;")"
if [ "$SLIDES_COUNT" = "$EXPECTED_PAGES" ]; then
  echo "  [OK] slides row count = $EXPECTED_PAGES"
else
  echo "  [FAIL] expected $EXPECTED_PAGES slides rows, got $SLIDES_COUNT" >&2
  FAIL=1
fi

# 2.3 — idx values are exactly 0..N-1 (monotonic, contiguous from 0)
IDX_LIST="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAXc \
  "SELECT string_agg(idx::text, ',' ORDER BY idx) FROM slides WHERE project_id='$PROJECT_ID' AND deleted_at IS NULL;")"
EXPECTED_IDX="$(python3 -c "print(','.join(str(i) for i in range($EXPECTED_PAGES)))")"
if [ "$IDX_LIST" = "$EXPECTED_IDX" ]; then
  echo "  [OK] idx values = $EXPECTED_IDX"
else
  echo "  [FAIL] expected idx '$EXPECTED_IDX', got '$IDX_LIST'" >&2
  FAIL=1
fi

# 2.4 — every slide has non-null png_path (the schema's image-path column)
NULL_PATHS="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAXc \
  "SELECT count(*) FROM slides WHERE project_id='$PROJECT_ID' AND deleted_at IS NULL AND (png_path IS NULL OR png_path = '');")"
if [ "$NULL_PATHS" = "0" ]; then
  echo "  [OK] every slide row has a non-null png_path"
else
  echo "  [FAIL] $NULL_PATHS slide rows have null/empty png_path" >&2
  FAIL=1
fi

# 2.5 — each png_path resolves via Supabase Storage signed URL (HEAD 200)
PATHS="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAXc \
  "SELECT png_path FROM slides WHERE project_id='$PROJECT_ID' AND deleted_at IS NULL ORDER BY idx;")"

resolve_one() {
  local raw_path="$1"
  # Normalize: strip leading 'pptalk-private/' if engineer stored bucket-qualified.
  local p="${raw_path#${BUCKET}/}"
  # Mint a signed URL via Storage REST API.
  local sign_resp
  sign_resp="$(curl -s -X POST \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"expiresIn": 60}' \
    "$SUPABASE_URL/storage/v1/object/sign/$BUCKET/$p")"
  local signed_url
  signed_url="$(printf '%s' "$sign_resp" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); print(d.get("signedURL") or d.get("signedUrl") or "")
except Exception:
  print("")' 2>/dev/null || true)"
  if [ -z "$signed_url" ]; then
    echo "    [FAIL] could not sign $raw_path: $sign_resp" >&2
    return 1
  fi
  # Storage returns a path; prefix with the storage host.
  case "$signed_url" in
    http*) full="$signed_url" ;;
    /*)    full="${SUPABASE_URL}/storage/v1${signed_url}" ;;
    *)     full="${SUPABASE_URL}/storage/v1/${signed_url}" ;;
  esac
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -I "$full")"
  if [ "$code" = "200" ]; then
    echo "    [OK] $raw_path → 200"
    return 0
  fi
  echo "    [FAIL] $raw_path → HTTP $code (signed=$full)" >&2
  return 1
}

PATH_FAIL=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  resolve_one "$p" || PATH_FAIL=1
done <<<"$PATHS"

if [ "$PATH_FAIL" = "0" ]; then
  echo "  [OK] all png_path values resolve via signed URL"
else
  echo "  [FAIL] one or more png_path values did not resolve" >&2
  FAIL=1
fi

if [ "$FAIL" = "0" ]; then
  echo "AC2 PASS"
  exit 0
fi
echo "AC2 FAIL" >&2
exit 1
