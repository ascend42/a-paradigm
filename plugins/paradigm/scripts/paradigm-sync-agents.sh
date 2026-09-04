#!/bin/bash
# paradigm-sync-agents.sh — mirrors this plugin's agents/*.md into ~/.claude/agents/.
#
# Claude Code's subagent loader only scans .claude/agents/ (project) and
# ~/.claude/agents/ (global) — it does not read a plugin's own agents/
# directory. Without this, architect/builder/reviewer/security/tester never
# appear as Agent tool subagent_type options, no matter how many times the
# plugin or session is reinstalled/restarted. Runs on SessionStart; cheap
# no-op once files are in sync.
set -euo pipefail

SRC="${CLAUDE_PLUGIN_ROOT}/agents"
DEST="$HOME/.claude/agents"

[ -d "$SRC" ] || exit 0
mkdir -p "$DEST"

for f in "$SRC"/*.md; do
  name="$(basename "$f")"
  if ! cmp -s "$f" "$DEST/$name" 2>/dev/null; then
    cp "$f" "$DEST/$name"
  fi
done
