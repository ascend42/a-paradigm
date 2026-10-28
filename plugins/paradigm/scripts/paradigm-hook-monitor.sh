#!/bin/sh
# Paradigm hook self-monitoring (#hook-monitor) — sourced by every plugin hook.
#
#   case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
#   [ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin <Hook> <timeoutMs> <budgetMs>
#
# Appends a "start" record when the hook begins and an "end" record (wall ms
# + outcome ok|blocked|error|killed) when it exits, to the bounded ring
# hook-timings.jsonl in the project's MACHINE home (scoped learning S2: the OS
# state dir, resolved by `_pm_learn_path hook-timings` in paradigm-resolve.sh
# and cached per root in .paradigm/.sessions/learn-paths; the legacy
# .paradigm/events/hook-timings.jsonl is no longer written). A hook killed with SIGKILL cannot write
# its end record; the next SessionStart (paradigm-session-start.sh) and
# `paradigm doctor` treat a start with no end, older than its timeout, as
# killed. Cost per run: two `date` calls, a cache read and two appended lines
# through shell redirection; one CLI spawn per root on a cache miss. FAIL OPEN: nothing here may print to
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
  _pm_sections_flush
  _PM_RING=
  return 0
}

# --- Per-section timing (Stop hook; #hook-monitor) ---
# _pm_mark <section> closes the open section (its ms since the previous mark)
# and opens <section>. At exit _pm_end writes ONE record per run to the bounded
# ring .paradigm/events/stop-timing.jsonl: total ms, outcome, the section that
# was still open when the hook ended ("inflight": names where a killed run was
# stuck), each section's ms, and the counters set with _pm_count. A slow run
# then explains itself. Cost: one `date` per mark. Fail open like the rest.
_PM_SECS=
_PM_SEC=
_PM_SEC_T=
_PM_COUNTS=
_pm_mark() {
  [ -n "$_PM_RING" ] || return 0
  _pm_now
  [ -n "$_PM_SEC" ] && _PM_SECS="$_PM_SECS${_PM_SECS:+,}\"$_PM_SEC\":$(( _pm_t - _PM_SEC_T ))"
  _PM_SEC=$1
  _PM_SEC_T=$_pm_t
  return 0
}
# _pm_count <name> <integer> — a counter recorded with the sections.
_pm_count() {
  [ -n "$_PM_RING" ] || return 0
  case "$2" in ''|*[!0-9]*) return 0 ;; esac
  _PM_COUNTS="$_PM_COUNTS${_PM_COUNTS:+,}\"$1\":$2"
  return 0
}
_pm_sections_flush() {
  [ -n "$_PM_SECS$_PM_SEC" ] || return 0
  _pm_sf="${_PM_RING%/*}/stop-timing.jsonl"
  _pm_inflight=
  if [ -n "$_PM_SEC" ]; then
    _PM_SECS="$_PM_SECS${_PM_SECS:+,}\"$_PM_SEC\":$(( _pm_t - _PM_SEC_T ))"
    _pm_inflight=$_PM_SEC
  fi
  { printf '{"hook":"%s","id":"%s","t":%s,"ms":%s,"rc":%s,"outcome":"%s","inflight":"%s","sections":{%s},"counts":{%s}}\n' "$_PM_HOOK" "$_PM_ID" "$_pm_t" "$_pm_ms" "$_pm_rc" "$_pm_out" "$_pm_inflight" "$_PM_SECS" "$_PM_COUNTS" >> "$_pm_sf"; } 2>/dev/null
  # Bounded: same 1-in-N cadence as the ring; PARADIGM_STOP_TIMING_MAX lines kept.
  if [ $(( $$ % _pm_every )) -eq 0 ]; then
    _pm_smax=${PARADIGM_STOP_TIMING_MAX:-200}
    { tail -n "$_pm_smax" "$_pm_sf" > "$_pm_sf.tmp.$$" && mv -f "$_pm_sf.tmp.$$" "$_pm_sf"; } 2>/dev/null || rm -f "$_pm_sf.tmp.$$" 2>/dev/null
  fi
  _PM_SECS=
  _PM_SEC=
  return 0
}

_pm_begin() {
  _PM_HOOK=$1
  _PM_RING=
  [ -n "$PARADIGM_HOOK_MONITOR_OFF" ] && return 0
  [ -d "${CLAUDE_PROJECT_DIR:-$PWD}/.paradigm" ] || return 0
  command -v _pm_learn_path >/dev/null 2>&1 || { [ -f "${_PM_DIR:-.}/paradigm-resolve.sh" ] && . "${_PM_DIR:-.}/paradigm-resolve.sh"; } 2>/dev/null
  command -v _pm_learn_path >/dev/null 2>&1 || return 0
  _PM_RING=$(_pm_learn_path hook-timings "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null) || { _PM_RING=; return 0; }
  mkdir -p "${_PM_RING%/*}" 2>/dev/null || { _PM_RING=; return 0; }
  _PM_OUTCOME=
  _pm_now
  _PM_T0=$_pm_t
  _PM_ID="$$-$_pm_t"
  { printf '{"ev":"start","hook":"%s","id":"%s","t":%s,"timeoutMs":%s,"budgetMs":%s}\n' "$_PM_HOOK" "$_PM_ID" "$_pm_t" "${2:-30000}" "${3:-2000}" >> "$_PM_RING"; } 2>/dev/null || { _PM_RING=; return 0; }
  trap '_pm_end $?' EXIT
  trap '_PM_OUTCOME=killed; exit 143' TERM HUP INT
  return 0
}
