#!/bin/sh
# Paradigm Claude Code Pre-Commit Hook — retired (kept as a no-op).
# It used to rebuild the index on `git commit` and `git add` scan-index.json,
# navigator.yaml and flow-index.json. Those files carry a generatedAt stamp, so
# every commit picked up an index diff. They are now gitignored generated state
# (#session-markers-gitignore): the MCP server serves a live index, and
# SessionStart rebuilds the files when a fresh clone lacks them.
# The file stays because existing settings.json / hooks.json entries call it.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PreToolUse (matcher: Bash)
# Exit 0 = allow (never blocks), never stages anything.

# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PreToolUse-Bash 15000 5000

cat >/dev/null 2>&1
exit 0
