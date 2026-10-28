#!/bin/sh
# Paradigm Claude Code SessionStart hook — hook-health surfacing (#hook-health-warning)
# Reads the hook timing ring (.paradigm/events/hook-timings.jsonl, written by
# paradigm-hook-monitor.sh) and, when a Paradigm hook was killed (start with no
# end older than its timeout, or a recorded SIGTERM) or ran over its budget
# since the last warning, prints ONE line per hook to stdout — SessionStart
# stdout is added to the agent's context. Rate-limited to once per session
# (.paradigm/.hook-health-warned). Also trims the ring to its cap, and on a
# fresh clone (no generated scan-index.json / navigator.yaml) starts a detached
# `paradigm index` rebuild.
#
# Hook type: SessionStart. Contract: always exit 0; fail open.

case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin SessionStart 10000 3000

INPUT=$(cat)

[ -f "$_PM_DIR/paradigm-resolve.sh" ] && . "$_PM_DIR/paradigm-resolve.sh"
if command -v _pm_project_root >/dev/null 2>&1; then
  _pm_project_root "$PWD" || exit 0
  ROOT=$PM_ROOT
  # The session's start (mtime): without a ledger the Stop hook judges files
  # changed since then.
  _pm_session_id "$INPUT"
  _pm_session_started
else
  ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
  [ -d "$ROOT/.paradigm" ] || exit 0
fi

# Fresh clone: the generated indexes are gitignored (#session-markers-gitignore),
# so readers that load them from disk (loop-files, workspace-loader, protocol
# health, the lore timeline) find nothing until something rebuilds them. When
# scan-index.json or navigator.yaml is missing, run `paradigm index` (the
# project's own CLI, then PATH; paradigm-resolve.sh) FULLY detached: a
# background child holding this hook's pipes would stall the session start.
if [ ! -f "$ROOT/.paradigm/scan-index.json" ] || [ ! -f "$ROOT/.paradigm/navigator.yaml" ]; then
  if command -v _pm_resolve_paradigm >/dev/null 2>&1 && _pm_resolve_paradigm "$ROOT"; then
    ( cd "$ROOT" && $PARADIGM_BIN index --quiet ) </dev/null >/dev/null 2>&1 &
  fi
fi

RING="$ROOT/.paradigm/events/hook-timings.jsonl"
[ -f "$RING" ] || exit 0
MARK="$ROOT/.paradigm/.hook-health-warned"

SID=$(printf '%s' "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
SINCE=0
if [ -f "$MARK" ]; then
  read -r _m_sid _m_ts < "$MARK" 2>/dev/null
  # once per session
  [ -n "$SID" ] && [ "$_m_sid" = "$SID" ] && exit 0
  case "$_m_ts" in ''|*[!0-9]*) ;; *) SINCE=$_m_ts ;; esac
fi

_pm_now 2>/dev/null || _pm_t=$(( $(date +%s) * 1000 ))
NOW=$_pm_t

# The ring is a plain file any process in the project can write, and this hook's
# stdout goes into the NEXT session's context (possibly an unsandboxed one). So
# (Aegis M-A) no ring text reaches stdout except numbers printed with %d and
# hook names from this exact allowlist; a record with any other `hook` value
# is dropped whole. Keep in sync with HOOK_NAMES in doctor/hook-health.ts.
HOOK_ALLOW="SessionStart Stop PreToolUse-Bash PreToolUse-Glob PreToolUse-Write UserPromptSubmit PostToolUse-Write PostToolUse-Skill PostToolUse-Agent"

# One awk pass: per hook, killed and over-budget counts after SINCE, earliest time, total lines.
SUMMARY=$(awk -v now="$NOW" -v since="$SINCE" -v grace=5000 -v allow="$HOOK_ALLOW" '
  BEGIN { na = split(allow, al, " "); for (i = 1; i <= na; i++) OK[al[i]] = 1 }
  function f(k,   r, p) {
    p = "\"" k "\":"
    if (!match($0, p "\"?[^,\"}]*")) return ""
    r = substr($0, RSTART + length(p), RLENGTH - length(p)); sub(/^"/, "", r); return r
  }
  { n++ ; ev = f("ev"); id = f("id"); h = f("hook"); t = f("t") + 0; if (!(h in OK)) next }
  ev == "start" { S[id] = t; H[id] = h; TO[id] = f("timeoutMs") + 0; B[id] = f("budgetMs") + 0 }
  ev == "end" {
    E[id] = 1
    if (t <= since) next
    if (f("outcome") == "killed") { K[h]++; if (!(h in FK) || t < FK[h]) FK[h] = t }
    else if ((id in B) && B[id] > 0 && f("ms") + 0 > B[id]) { SL[h]++; BU[h] = B[id]; if (!(h in FSL) || t < FSL[h]) FSL[h] = t }
  }
  END {
    for (id in S) if (!(id in E) && S[id] > since && now - S[id] > TO[id] + grace) { h = H[id]; K[h]++; if (!(h in FK) || S[id] < FK[h]) FK[h] = S[id] }
    for (h in K) printf "killed\t%s\t%d\t%d\n", h, K[h], FK[h]
    for (h in SL) printf "slow\t%s\t%d\t%d\t%d\n", h, SL[h], FSL[h], BU[h]
    printf "lines\t%d\n", n
  }' "$RING" 2>/dev/null)

_fmt_date() { # epoch ms -> YYYY-MM-DD HH:MM (local)
  _s=$(( $1 / 1000 ))
  date -r "$_s" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$_s" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "$_s"
}

WARNED=false
_TAB=$(printf '\t')
while IFS="$_TAB" read -r kind hook count first budget; do
  # belt and braces (M-A): only allowlisted names and plain digits are ever printed
  case " $HOOK_ALLOW " in *" $hook "*) ;; *) [ "$kind" = lines ] || continue ;; esac
  case "${count:-0}${first:-0}${budget:-0}" in *[!0-9]*) [ "$kind" = lines ] || continue ;; esac
  case "$kind" in
    killed)
      case "$hook" in
        Stop) consequence="enforcement did not run" ;;
        *) consequence="its checks did not run" ;;
      esac
      printf '%s\n' "Paradigm $hook hook timed out $count time(s) since $(_fmt_date "$first"); $consequence. Run \`paradigm doctor\`."
      WARNED=true ;;
    slow)
      printf '%s\n' "Paradigm $hook hook exceeded its $(( budget / 1000 ))s budget $count time(s) since $(_fmt_date "$first"). Run \`paradigm doctor\`."
      WARNED=true ;;
    lines)
      case "${hook:-0}" in *[!0-9]*) continue ;; esac
      [ "${hook:-0}" -gt "${PARADIGM_HOOK_RING_MAX:-500}" ] 2>/dev/null && { _PM_RING_SAVE=$_PM_RING; _PM_RING=$RING; _pm_trim; _PM_RING=$_PM_RING_SAVE; } ;;
  esac
done <<EOF
$SUMMARY
EOF

if [ "$WARNED" = true ]; then
  { printf '%s %s\n' "${SID:-unknown}" "$NOW" > "$MARK"; } 2>/dev/null
fi
exit 0
