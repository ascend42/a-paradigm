#!/bin/sh
# paradigm-resolve.sh — finds the paradigm CLI for the hooks (sourced, POSIX sh).
# Sourced by paradigm-common.sh (Stop hooks), claude-code-precommit.sh and
# cursor-precommit.sh, so every hook resolves the CLI the same way. The plugin's
# MCP launcher (plugins/paradigm/scripts/paradigm-mcp-launch.cjs) uses the same
# order for the paradigm-mcp server.
#
# Usage:
#   _pm_resolve_paradigm <project-root>   # 0 = found, 1 = not found
#   $PARADIGM_BIN <args...>
#
# Sets:
#   PARADIGM_BIN — one command word: _pm_paradigm_local, paradigm or
#                  _pm_paradigm_npx; empty when nothing resolves. A function name,
#                  so a project path with spaces survives unquoted expansion.
#
# Order:
#   1. The project's own @a-company/paradigm: <root>/node_modules/.bin/paradigm,
#      only when <root>/node_modules/@a-company/paradigm/package.json exists (a
#      bare .bin/paradigm from another package is never run). The project root
#      only, never a parent folder or a subdirectory the hook ran from. No npx:
#      npm 11 applies the project's devEngines to npx, so in a repo that requires
#      pnpm (onFail "error") npx exits EBADDEVENGINES.
#   2. `paradigm` on PATH (a global install).
#   3. npx --no-install --package=@a-company/paradigm paradigm, probed with
#      --version. --no-install: never a network fetch inside a hook; --package:
#      never the unrelated public "paradigm" package.
#
# paradigm-skill-used.sh deliberately does NOT use this: it stays PATH-only
# (Aegis L3).

_pm_paradigm_local() { "$_PM_LOCAL_PARADIGM" "$@"; }
_pm_paradigm_npx() { npx --no-install --package=@a-company/paradigm paradigm "$@"; }

_pm_resolve_paradigm() {
  PARADIGM_BIN=""
  _PM_LOCAL_PARADIGM="$1/node_modules/.bin/paradigm"
  if [ -n "$1" ] && [ -f "$1/node_modules/@a-company/paradigm/package.json" ] && [ -x "$_PM_LOCAL_PARADIGM" ]; then
    PARADIGM_BIN="_pm_paradigm_local"
  elif command -v paradigm >/dev/null 2>&1; then
    PARADIGM_BIN="paradigm"
  elif command -v npx >/dev/null 2>&1 && _pm_paradigm_npx --version >/dev/null 2>&1; then
    PARADIGM_BIN="_pm_paradigm_npx"
  fi
  [ -n "$PARADIGM_BIN" ]
}
