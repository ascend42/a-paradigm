#!/usr/bin/env bash
# ============================================================
# TaskFlow API Verification Script (v2)
# Usage: bash case-study/verify.sh [session_number]
#   0 = usage / help
#   1 = build + feature sprint (13 tests)
#   2 = + adversarial requirements (11 tests, cumulative 24)
#   3 = + cold handoff (4 tests, cumulative 28)
# ============================================================

set -uo pipefail

SESSION=${1:-0}
PORT=3000
BASE="http://localhost:$PORT"
PASS=0
FAIL=0
TOTAL=0
TMPFILE=$(mktemp)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ---- Usage ----

if [ "$SESSION" = "0" ] || [ "$SESSION" = "-h" ] || [ "$SESSION" = "--help" ]; then
  echo -e "${BOLD}TaskFlow Case Study — Verification Script (v2)${NC}"
  echo ""
  echo "Usage: bash case-study/verify.sh <session>"
  echo ""
  echo "  1   Build + Feature Sprint (13 tests)"
  echo "  2   Adversarial Requirements (24 tests — includes session 1)"
  echo "  3   Cold Handoff (28 tests — includes sessions 1 + 2)"
  echo ""
  echo "Session 3 runs ALL tests as a full regression suite."
  echo ""
  echo "Requirements:"
  echo "  - Node.js, jq, curl"
  echo "  - Port $PORT must be free"
  echo "  - Server must write tokens.json on startup"
  exit 0
fi

if [ "$SESSION" -lt 1 ] || [ "$SESSION" -gt 3 ]; then
  echo -e "${RED}Invalid session number: $SESSION (must be 1, 2, or 3)${NC}"
  exit 1
fi

# ---- Cleanup ----

cleanup() {
  rm -f "$TMPFILE"
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---- Assertion Helpers ----

assert_status() {
  local desc="$1" expected="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$actual" = "$expected" ]; then
    printf "  ${GREEN}PASS${NC} [%d] %s (HTTP %s)\n" "$TOTAL" "$desc" "$actual"
    PASS=$((PASS + 1))
  else
    printf "  ${RED}FAIL${NC} [%d] %s (expected HTTP %s, got %s)\n" "$TOTAL" "$desc" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_status_any() {
  local desc="$1" actual="$2"
  shift 2
  TOTAL=$((TOTAL + 1))
  for expected in "$@"; do
    if [ "$actual" = "$expected" ]; then
      printf "  ${GREEN}PASS${NC} [%d] %s (HTTP %s)\n" "$TOTAL" "$desc" "$actual"
      PASS=$((PASS + 1))
      return
    fi
  done
  printf "  ${RED}FAIL${NC} [%d] %s (got HTTP %s, expected one of: %s)\n" "$TOTAL" "$desc" "$actual" "$*"
  FAIL=$((FAIL + 1))
}

assert_json() {
  local desc="$1" jq_filter="$2" body="$3"
  TOTAL=$((TOTAL + 1))
  if echo "$body" | jq -e "$jq_filter" > /dev/null 2>&1; then
    printf "  ${GREEN}PASS${NC} [%d] %s\n" "$TOTAL" "$desc"
    PASS=$((PASS + 1))
  else
    printf "  ${RED}FAIL${NC} [%d] %s\n" "$TOTAL" "$desc"
    FAIL=$((FAIL + 1))
  fi
}

# ---- Setup ----

echo -e "${BOLD}TaskFlow Verification — Session $SESSION${NC}"
echo ""

# Clean state
echo "Cleaning state..."
rm -f *.db *.db-shm *.db-wal tokens.json

# Compile
echo "Compiling TypeScript..."
if ! npx tsc 2>&1; then
  echo -e "\n${RED}TypeScript compilation failed.${NC}"
  exit 1
fi

# Check port
if lsof -ti:$PORT > /dev/null 2>&1; then
  echo -e "${RED}Port $PORT already in use. Kill the existing process first.${NC}"
  exit 1
fi

# Start server
echo "Starting server..."
node dist/index.js &
SERVER_PID=$!

# Wait for tokens.json (server writes it on startup)
echo "Waiting for server..."
for i in $(seq 1 15); do
  if [ -f tokens.json ]; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "${RED}Server crashed on startup.${NC}"
    exit 1
  fi
  sleep 1
done

if [ ! -f tokens.json ]; then
  echo -e "${RED}Timed out — tokens.json not written. Server must write this file on startup.${NC}"
  exit 1
fi

sleep 1  # Let the server finish binding

# Load tokens
TOKEN_ADMIN=$(jq -r '.["user-admin"]' tokens.json)
TOKEN_ALICE=$(jq -r '.["user-alice"]' tokens.json)
TOKEN_BOB=$(jq -r '.["user-bob"]' tokens.json)
TOKEN_CHARLIE=$(jq -r '.["user-charlie"]' tokens.json 2>/dev/null || echo "")
TOKEN_OUTSIDER=$(jq -r '.["user-outsider"]' tokens.json)

for name in ADMIN ALICE BOB OUTSIDER; do
  varname="TOKEN_$name"
  val="${!varname}"
  if [ -z "$val" ] || [ "$val" = "null" ]; then
    echo -e "${RED}tokens.json missing token for $name${NC}"
    exit 1
  fi
done

# Charlie token is required from session 2 onward
if [ "$SESSION" -ge 2 ]; then
  if [ -z "$TOKEN_CHARLIE" ] || [ "$TOKEN_CHARLIE" = "null" ]; then
    echo -e "${RED}tokens.json missing token for CHARLIE (required for session 2+)${NC}"
    exit 1
  fi
fi

echo -e "Tokens loaded.\n"


# ============================================================
# SESSION 1: Build + Feature Sprint (13 tests)
# ============================================================
echo -e "${YELLOW}--- Session 1: Build + Feature Sprint (13 tests) ---${NC}"

# -- Baseline core (8 tests) --

# 1
S=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN_ALICE" "$BASE/api/projects")
assert_status "GET /api/projects — alice gets 200" "200" "$S"

# 2
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
  -d '{"name":"Verify Project","description":"test"}' "$BASE/api/projects")
assert_status "POST /api/projects — alice creates project (201)" "201" "$S"

# 3
S=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN_OUTSIDER" "$BASE/api/projects/project-1")
assert_status "GET /api/projects/project-1 — outsider gets 403" "403" "$S"

# 4
S=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN_BOB" "$BASE/api/projects/project-1/tasks")
assert_status "GET /projects/project-1/tasks — bob (member) gets 200" "200" "$S"

# 5 *** CRITICAL — assignee-only gate ***
S=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
  -d '{"title":"Should Fail"}' "$BASE/api/tasks/task-1")
assert_status "PUT /api/tasks/task-1 — alice (admin, NOT assignee) gets 403" "403" "$S"

# 6
S=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "Authorization: Bearer $TOKEN_BOB" -H "Content-Type: application/json" \
  -d '{"title":"Updated by Bob"}' "$BASE/api/tasks/task-1")
assert_status "PUT /api/tasks/task-1 — bob (assignee) gets 200" "200" "$S"

# 7
S=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  -H "Authorization: Bearer $TOKEN_BOB" "$BASE/api/comments/comment-1")
assert_status "DELETE /api/comments/comment-1 — bob (not author) gets 403" "403" "$S"

# 8
S=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  -H "Authorization: Bearer $TOKEN_ALICE" "$BASE/api/comments/comment-1")
assert_status "DELETE /api/comments/comment-1 — alice (author) gets 200" "200" "$S"

# -- Feature sprint (5 tests) --

# 9 — Audit log captures task creation
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN_BOB" -H "Content-Type: application/json" \
  -d '{"title":"Audit Test Task"}' "$BASE/api/projects/project-1/tasks" > "$TMPFILE"

AUDIT=$(curl -s -H "Authorization: Bearer $TOKEN_ADMIN" "$BASE/api/audit-logs")
assert_json "Audit log records task creation" \
  '.[] | select(.action == "create")' "$AUDIT"

# 10 — Admin can create template
S=$(curl -s -o "$TMPFILE" -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
  -d '{"title":"Bug Report","description":"Steps to reproduce..."}' \
  "$BASE/api/projects/project-1/templates")
TMPL_ID=$(jq -r '.id' "$TMPFILE" 2>/dev/null)
assert_status "POST /templates — admin creates template (201)" "201" "$S"

# 11 — Member cannot create template
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN_BOB" -H "Content-Type: application/json" \
  -d '{"title":"Nope","description":"Should fail"}' \
  "$BASE/api/projects/project-1/templates")
assert_status "POST /templates — member gets 403" "403" "$S"

# 12 — Task from template inherits title
TASK_BODY=$(curl -s -X POST \
  -H "Authorization: Bearer $TOKEN_BOB" -H "Content-Type: application/json" \
  -d "{\"template_id\":\"$TMPL_ID\"}" "$BASE/api/projects/project-1/tasks")
assert_json "Task from template has template title" \
  'select(.title == "Bug Report")' "$TASK_BODY"

# 13 — Assignment creates notification
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
  -d '{"title":"Notify Test","assignee_id":"user-bob"}' \
  "$BASE/api/projects/project-1/tasks" > /dev/null

NOTIFS=$(curl -s -H "Authorization: Bearer $TOKEN_BOB" "$BASE/api/notifications")
assert_json "Assignment creates notification for assignee" \
  '.[] | select(.type == "task-assigned")' "$NOTIFS"


# ============================================================
# SESSION 2: Adversarial Requirements (11 tests)
# ============================================================
if [ "$SESSION" -ge 2 ]; then
  echo ""
  echo -e "${YELLOW}--- Session 2: Adversarial Requirements (11 tests) ---${NC}"

  # -- Task Reassignment (3 tests) --

  # 14 — Project admin can reassign via POST /assign
  S=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
    -d '{"assignee_id":"user-alice"}' "$BASE/api/tasks/task-1/assign")
  assert_status "POST /tasks/task-1/assign — admin reassigns (200)" "200" "$S"

  # Reassign back to bob for subsequent tests
  curl -s -o /dev/null -X POST \
    -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
    -d '{"assignee_id":"user-bob"}' "$BASE/api/tasks/task-1/assign"

  # 15 — Non-admin member cannot reassign
  S=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $TOKEN_BOB" -H "Content-Type: application/json" \
    -d '{"assignee_id":"user-alice"}' "$BASE/api/tasks/task-1/assign")
  assert_status "POST /tasks/task-1/assign — member gets 403" "403" "$S"

  # 16 — PUT still restricted to assignee (regression after reassignment added)
  S=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
    -d '{"title":"Regression Check"}' "$BASE/api/tasks/task-1")
  assert_status "PUT /tasks/task-1 — alice still gets 403 (regression guard)" "403" "$S"

  # -- Bulk Status Update (3 tests) --

  # 17 — Project admin can bulk-update task status
  S=$(curl -s -o "$TMPFILE" -w "%{http_code}" -X PATCH \
    -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
    -d '{"task_ids":["task-1"],"status":"done"}' \
    "$BASE/api/projects/project-1/tasks/status")
  assert_status "PATCH /projects/project-1/tasks/status — admin bulk updates (200)" "200" "$S"

  # Reset task-1 status back for later tests
  curl -s -o /dev/null -X PUT \
    -H "Authorization: Bearer $TOKEN_BOB" -H "Content-Type: application/json" \
    -d '{"status":"in-progress"}' "$BASE/api/tasks/task-1" 2>/dev/null || true

  # 18 — Non-admin member cannot bulk-update
  S=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "Authorization: Bearer $TOKEN_BOB" -H "Content-Type: application/json" \
    -d '{"task_ids":["task-1"],"status":"done"}' \
    "$BASE/api/projects/project-1/tasks/status")
  assert_status "PATCH /projects/project-1/tasks/status — member gets 403" "403" "$S"

  # 19 — PUT is still assignee-only after bulk update exists
  S=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
    -d '{"status":"done"}' "$BASE/api/tasks/task-1")
  assert_status "PUT /tasks/task-1 — admin still 403 via PUT (post-bulk regression)" "403" "$S"

  # -- Orphan Cleanup (3 tests) --

  # 20 — System admin gets orphan report
  S=$(curl -s -o "$TMPFILE" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $TOKEN_ADMIN" "$BASE/api/admin/cleanup")
  assert_status "POST /admin/cleanup — admin gets orphan report (200)" "200" "$S"

  # 21 — Non-admin gets 403
  S=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $TOKEN_ALICE" "$BASE/api/admin/cleanup")
  assert_status "POST /admin/cleanup — non-admin gets 403" "403" "$S"

  # 22 — Cleanup is non-destructive (charlie's comment still exists)
  # First verify charlie's comment-2 is still retrievable
  COMMENTS=$(curl -s \
    -H "Authorization: Bearer $TOKEN_BOB" "$BASE/api/tasks/task-1/comments")
  assert_json "Charlie's comment still exists after cleanup report (non-destructive)" \
    '.[] | select(.id == "comment-2")' "$COMMENTS"

  # -- Cross-project isolation (2 regression guards) --

  # 23 — PUT /tasks regression guard (re-check from test 5)
  S=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
    -d '{"title":"Should Still Fail"}' "$BASE/api/tasks/task-1")
  assert_status "PUT /tasks/task-1 — assignee-only gate intact (final regression)" "403" "$S"

  # 24 — Cross-project isolation: alice cannot bulk-update project-2 tasks via project-1
  S=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "Authorization: Bearer $TOKEN_ALICE" -H "Content-Type: application/json" \
    -d '{"task_ids":["task-2"],"status":"done"}' \
    "$BASE/api/projects/project-1/tasks/status")
  assert_status_any "Cross-project isolation — task-2 not updatable via project-1" "$S" "400" "403" "404" "422"
fi


# ============================================================
# SESSION 3: Cold Handoff (4 tests)
# ============================================================
if [ "$SESSION" -ge 3 ]; then
  echo ""
  echo -e "${YELLOW}--- Session 3: Cold Handoff (4 tests) ---${NC}"

  # 25 — Activity feed returns 200 for project member
  S=$(curl -s -o "$TMPFILE" -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN_ALICE" "$BASE/api/projects/project-1/activity")
  assert_status "GET /projects/project-1/activity — returns 200" "200" "$S"

  # 26 — Activity feed has entries
  ACTIVITY=$(cat "$TMPFILE")
  assert_json "Activity feed is non-empty" \
    'if type == "array" then length > 0 else .items | length > 0 end' "$ACTIVITY"

  # 27 — Cross-project dashboard returns data for alice (2 projects)
  DASH_BODY=$(curl -s \
    -H "Authorization: Bearer $TOKEN_ALICE" "$BASE/api/dashboard")
  assert_json "Dashboard shows alice's projects (at least 2)" \
    'if type == "array" then length >= 2 elif .projects then (.projects | length >= 2) else false end' "$DASH_BODY"

  # 28 — Outsider gets empty dashboard (no projects)
  DASH_OUTSIDER=$(curl -s \
    -H "Authorization: Bearer $TOKEN_OUTSIDER" "$BASE/api/dashboard")
  assert_json "Dashboard for outsider is empty" \
    'if type == "array" then length == 0 elif .projects then (.projects | length == 0) else true end' "$DASH_OUTSIDER"
fi


# ============================================================
# Summary
# ============================================================
echo ""
echo "======================================="
printf "  ${BOLD}Results: ${GREEN}%d passed${NC}, ${RED}%d failed${NC} / %d total\n" "$PASS" "$FAIL" "$TOTAL"
echo "======================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
else
  echo -e "  ${GREEN}All tests passed.${NC}"
fi
