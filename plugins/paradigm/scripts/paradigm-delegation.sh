#!/bin/sh
# Paradigm Claude Code PostToolUse — Agent delegation credit (!delegation-recorded)
# Fires after the host `Agent` (formerly `Task`) tool runs. When the delegated
# subagent is a roster agent — a `paradigm:*` plugin agent, or a project agent
# defined at $CWD/.claude/agents/<type>.md — and it returned a non-empty
# response, writes .paradigm/.orchestrated (same JSON payload shape as
# recordOrchestrationCompletion in packages/paradigm-mcp/src/utils/
# orchestration-marker.ts, source "delegation"). The Stop hook (Check 13), the
# team gate and the prompt gate honour that marker by age
# (PARADIGM_GATE_TTL_HOURS, default 4h). Every delegation, credited or not, is
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

# Not a paradigm project — pass
[ -d "$CWD/.paradigm" ] || exit 0

# The ledger rows are hand-built JSON: keep the subagent string to a safe set.
SUBAGENT=$(printf '%s' "$SUBAGENT" | tr -cd 'a-zA-Z0-9:._-' | head -c 80)
[ -n "$SUBAGENT" ] || exit 0

# Roster agent? paradigm:* plugin agents, or a project-defined agent file.
IS_ROSTER=false
case "$SUBAGENT" in
  paradigm:?*) IS_ROSTER=true ;;
  .*) ;;
  *) [ -f "$CWD/.claude/agents/$SUBAGENT.md" ] && IS_ROSTER=true ;;
esac

CREDITED=false
[ "$IS_ROSTER" = "true" ] && [ "$HAS_RESPONSE" = "true" ] && CREDITED=true

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ "$CREDITED" = "true" ]; then
  printf '{"timestamp":"%s","type":"orchestrated","verdicts":1,"source":"delegation","subagent":"%s"}\n' "$TS" "$SUBAGENT" > "$CWD/.paradigm/.orchestrated" 2>/dev/null || true
fi

mkdir -p "$CWD/.paradigm/events" 2>/dev/null
printf '{"timestamp":"%s","type":"delegation","source":"delegation-hook","subagent":"%s","credited":%s}\n' "$TS" "$SUBAGENT" "$CREDITED" >> "$CWD/.paradigm/events/team-funnel.jsonl" 2>/dev/null || true

exit 0
