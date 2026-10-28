#!/bin/sh
# Paradigm Claude Code PostToolUse — Agent delegation credit (!delegation-recorded)
# Fires after the host `Agent` (formerly `Task`) tool runs. When the delegated
# subagent is a team agent — a `paradigm:*` plugin agent, a project agent in
# <root>/.claude/agents, or a user-global agent in ~/.claude/agents (by file
# name <type>.md or `name:` frontmatter) — and it returned a non-empty
# response, the orchestration gate is satisfied (TD-2026-10-28-956):
#   - <root>/.paradigm/.sessions/<session_id>.orchestrated lasts for the session;
#   - <root>/.paradigm/.orchestrated (same JSON payload shape as
#     recordOrchestrationCompletion in packages/paradigm-mcp/src/utils/
#     orchestration-marker.ts, source "delegation") is honoured by age
#     (PARADIGM_GATE_TTL_HOURS, default 4h) when a reader has no session id.
# The Stop hook (Check 13), the team gate and the prompt gate read both, at the
# project root (paradigm-resolve.sh). Every delegation, credited or not, is
# appended to .paradigm/events/team-funnel.jsonl for Loid's invocation-rate
# calibration.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PostToolUse (matcher: Agent|Task)
# Contract: NEVER fails loudly — always exit 0, no stdout/stderr output.

# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PostToolUse-Agent 10000 3000

INPUT=$(cat 2>/dev/null)
[ -n "$INPUT" ] || exit 0

# Extract cwd, subagent type and whether the tool returned anything.
if command -v jq >/dev/null 2>&1; then
  CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
  SUBAGENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)
  HAS_RESPONSE=$(printf '%s' "$INPUT" | jq -r '
    (.tool_response // null) as $r
    | if $r == null then "false"
      elif ($r | type) == "string" then (($r | gsub("^\\s+|\\s+$"; "")) | length > 0 | tostring)
      elif ($r | type) == "array" or ($r | type) == "object" then (($r | length) > 0 | tostring)
      else "true" end' 2>/dev/null)
else
  # (stderr muted: a missing or odd grep/sed must not leak output — fail open)
  exec 3>&2 2>/dev/null
  CWD=$(printf '%s' "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  SUBAGENT=$(printf '%s' "$INPUT" | grep -o '"subagent_type"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"subagent_type"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  HAS_RESPONSE=false
  if printf '%s' "$INPUT" | grep -q '"tool_response"[[:space:]]*:'; then
    if ! printf '%s' "$INPUT" | grep -q '"tool_response"[[:space:]]*:[[:space:]]*\(null\|""\|{[[:space:]]*}\|\[[[:space:]]*\]\)'; then
      HAS_RESPONSE=true
    fi
  fi
  exec 2>&3 3>&-
fi

[ -n "$CWD" ] || CWD="$(pwd)"

# Project root (paradigm-resolve.sh): markers are written there, never in a
# linked worktree. Not a paradigm project — pass.
[ -f "$_PM_DIR/paradigm-resolve.sh" ] && . "$_PM_DIR/paradigm-resolve.sh" 2>/dev/null
command -v _pm_project_root >/dev/null 2>&1 || exit 0
_pm_project_root "$CWD" 2>/dev/null || exit 0
CWD=$PM_ROOT
_pm_session_id "$INPUT" 2>/dev/null

# The ledger rows are hand-built JSON: keep the subagent string to a safe set.
SUBAGENT=$(printf '%s' "$SUBAGENT" | tr -cd 'a-zA-Z0-9:._-' | head -c 80)
[ -n "$SUBAGENT" ] || exit 0

# _agent_defined <dir> — <dir>/<type>.md exists, or an agent file there
# declares `name: <type>` in its frontmatter.
_agent_defined() {
  [ -d "$1" ] || return 1
  [ -f "$1/$SUBAGENT.md" ] && return 0
  grep -qE "^name:[[:space:]]*[\"']?$SUBAGENT[\"']?[[:space:]]*\$" "$1"/*.md 2>/dev/null
}

# Team agent? paradigm:* plugin agents, a project agent (<root>/.claude/agents)
# or a user-global agent (~/.claude/agents, e.g. atelier-mika).
IS_ROSTER=false
case "$SUBAGENT" in
  paradigm:?*) IS_ROSTER=true ;;
  .*|*:*) ;;
  *)
    if _agent_defined "$CWD/.claude/agents" || { [ -n "$HOME" ] && _agent_defined "$HOME/.claude/agents"; }; then
      IS_ROSTER=true
    fi
    ;;
esac

CREDITED=false
[ "$IS_ROSTER" = "true" ] && [ "$HAS_RESPONSE" = "true" ] && CREDITED=true

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ "$CREDITED" = "true" ]; then
  printf '{"timestamp":"%s","type":"orchestrated","verdicts":1,"source":"delegation","subagent":"%s"}\n' "$TS" "$SUBAGENT" > "$CWD/.paradigm/.orchestrated" 2>/dev/null || true
  if [ -n "$PM_SID" ]; then
    mkdir -p "$CWD/.paradigm/.sessions" 2>/dev/null
    printf '{"timestamp":"%s","type":"orchestrated","source":"delegation","subagent":"%s","session":"%s"}\n' "$TS" "$SUBAGENT" "$PM_SID" > "$CWD/.paradigm/.sessions/$PM_SID.orchestrated" 2>/dev/null || true
  fi
fi

mkdir -p "$CWD/.paradigm/events" 2>/dev/null
printf '{"timestamp":"%s","type":"delegation","source":"delegation-hook","subagent":"%s","credited":%s}\n' "$TS" "$SUBAGENT" "$CREDITED" >> "$CWD/.paradigm/events/team-funnel.jsonl" 2>/dev/null || true

exit 0
