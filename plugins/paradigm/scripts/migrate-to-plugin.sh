#!/bin/bash
# migrate-to-plugin.sh — Remove per-project Claude Code overlap after plugin install
#
# Safe: keeps Cursor hooks, git hooks, CLAUDE.md, .paradigm/, portal.yaml
# Only removes Claude Code hooks and paradigm-mcp from .mcp.json
#
# Usage:
#   ./migrate-to-plugin.sh /path/to/project1 /path/to/project2 ...
#   ./migrate-to-plugin.sh  # (no args = current directory)

set -e

migrate_project() {
  local dir="$1"
  local name
  name=$(basename "$dir")

  if [ ! -d "$dir" ]; then
    echo "  SKIP: Directory not found: $dir"
    return
  fi

  echo "=== $name ==="

  # 1. Remove Claude Code hooks (plugin provides these now)
  local removed_hooks=0
  for hook_file in paradigm-stop.sh paradigm-precommit.sh paradigm-postwrite.sh; do
    if [ -f "$dir/.claude/hooks/$hook_file" ]; then
      rm -f "$dir/.claude/hooks/$hook_file"
      removed_hooks=$((removed_hooks + 1))
    fi
  done

  if [ "$removed_hooks" -gt 0 ]; then
    echo "  Removed $removed_hooks Claude Code hook(s) from .claude/hooks/"
  else
    echo "  No Claude Code hooks to remove"
  fi

  # 2. Remove paradigm-mcp from .mcp.json (keep atelier-mcp and others)
  if [ -f "$dir/.mcp.json" ]; then
    if command -v node >/dev/null 2>&1; then
      node -e "
        const fs = require('fs');
        const path = '$dir/.mcp.json';
        try {
          const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
          if (cfg.mcpServers && cfg.mcpServers['paradigm-mcp']) {
            delete cfg.mcpServers['paradigm-mcp'];
            const remaining = Object.keys(cfg.mcpServers).length;
            if (remaining === 0) {
              fs.unlinkSync(path);
              console.log('  Removed .mcp.json (was paradigm-only)');
            } else {
              fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
              console.log('  Removed paradigm-mcp from .mcp.json (kept ' + remaining + ' other server(s))');
            }
          } else {
            console.log('  No paradigm-mcp in .mcp.json');
          }
        } catch (e) {
          console.log('  WARN: Could not parse .mcp.json: ' + e.message);
        }
      "
    else
      echo "  WARN: Node.js not available, skipping .mcp.json cleanup"
      echo "  Manually remove 'paradigm-mcp' from $dir/.mcp.json"
    fi
  else
    echo "  No .mcp.json to update"
  fi

  # 3. Report what's kept
  local kept=""
  [ -f "$dir/CLAUDE.md" ] && kept="$kept CLAUDE.md"
  [ -d "$dir/.paradigm" ] && kept="$kept .paradigm/"
  [ -f "$dir/portal.yaml" ] && kept="$kept portal.yaml"
  [ -d "$dir/.cursor/hooks" ] && kept="$kept .cursor/hooks/"
  [ -d "$dir/.git/hooks" ] && kept="$kept .git/hooks/"

  if [ -n "$kept" ]; then
    echo "  Kept (unchanged):$kept"
  fi

  echo ""
}

# Main
echo "Paradigm Plugin Migration"
echo "========================="
echo "Removing Claude Code overlap (hooks + MCP) from projects."
echo "The plugin now provides these globally."
echo ""

if [ $# -eq 0 ]; then
  # No args — migrate current directory
  migrate_project "$(pwd)"
else
  # Migrate each provided directory
  for dir in "$@"; do
    migrate_project "$dir"
  done
fi

echo "Migration complete."
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to use plugin hooks + MCP server"
echo "  2. Verify with: /paradigm:doctor"
echo "  3. Cursor hooks (.cursor/hooks/) are unchanged — no action needed"
