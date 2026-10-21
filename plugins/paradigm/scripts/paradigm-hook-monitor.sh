#!/bin/sh
# Paradigm hook self-monitoring (#hook-monitor) — sourced by every plugin hook.
#
#   case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
#   [ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin <Hook> <timeoutMs> <budgetMs>
#
# Appends a "start" record when the hook begins and an "end" record (wall ms
# + outcome ok|blocked|error|killed) when it exits, to the bounded ring
# .paradigm/events/hook-timings.jsonl. A hook killed with SIGKILL cannot write
# its end record; the next SessionStart (paradigm-session-start.sh) and
# `paradigm doctor` treat a start with no end, older than its timeout, as
# killed. Cost per run: two `date` calls and two appended lines through shell
# redirection — no CLI or node spawn. FAIL OPEN: nothing here may print to
# stdout, change the hook's exit code, or stop the hook; every write is
# best-effort (a read-only tree or sandbox just records nothing).

_pm_now() {
  _pm_t=$(date +%s%N 2>/dev/null)
  case "$_pm_t" in
    ''|*[!0-9]*) _pm_t=$(date +%s 2>/dev/null); _pm_t=$(( ${_pm_t:-0} * 1000 )) ;;
    *) _pm_t=${_pm_t%??????} ;;
  esac
}

_pm_trim() {
  _pm_max=${PARADIGM_HOOK_RING_MAX:-500}
  { tail -n "$_pm_max" "$_PM_RING" > "$_PM_RING.tmp.$$" && mv -f "$_PM_RING.tmp.$$" "$_PM_RING"; } 2>/dev/null || rm -f "$_PM_RING.tmp.$$" 2>/dev/null
}

_pm_end() {
  _pm_rc=$1
  [ -n "$_PM_RING" ] || return 0
  _pm_now
  _pm_ms=$(( _pm_t - _PM_T0 ))
  case "$_PM_OUTCOME:$_pm_rc" in
    killed:*) _pm_out=killed ;;
    *:0) _pm_out=ok ;;
    *:2) _pm_out=blocked ;;
    *) _pm_out=error ;;
  esac
  { printf '{"ev":"end","hook":"%s","id":"%s","t":%s,"ms":%s,"rc":%s,"outcome":"%s"}\n' "$_PM_HOOK" "$_PM_ID" "$_pm_t" "$_pm_ms" "$_pm_rc" "$_pm_out" >> "$_PM_RING"; } 2>/dev/null
  # Bounded ring: trim on ~1 in 64 runs (one tail+mv), deterministically in
  # SessionStart. PARADIGM_HOOK_RING_TRIM_EVERY=1 trims every run (tests).
  _pm_every=${PARADIGM_HOOK_RING_TRIM_EVERY:-64}
  [ "$_pm_every" -gt 0 ] 2>/dev/null || _pm_every=64
  [ $(( $$ % _pm_every )) -eq 0 ] && _pm_trim
  _PM_RING=
  return 0
}

_pm_begin() {
  _PM_HOOK=$1
  _PM_RING="${CLAUDE_PROJECT_DIR:-$PWD}/.paradigm/events/hook-timings.jsonl"
  [ -n "$PARADIGM_HOOK_MONITOR_OFF" ] && { _PM_RING=; return 0; }
  [ -d "${_PM_RING%/*}" ] || { _PM_RING=; return 0; }
  _PM_OUTCOME=
  _pm_now
  _PM_T0=$_pm_t
  _PM_ID="$$-$_pm_t"
  { printf '{"ev":"start","hook":"%s","id":"%s","t":%s,"timeoutMs":%s,"budgetMs":%s}\n' "$_PM_HOOK" "$_PM_ID" "$_pm_t" "${2:-30000}" "${3:-2000}" >> "$_PM_RING"; } 2>/dev/null || { _PM_RING=; return 0; }
  trap '_pm_end $?' EXIT
  trap '_PM_OUTCOME=killed; exit 143' TERM HUP INT
  return 0
}
