#!/bin/sh
# Legacy afterFileEdit hook — replaced by paradigm-posttooluse.sh (postToolUse)
# Kept as a no-op because Claude Code expects the file to exist.
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PostToolUse-Write 10000 2000

exit 0
