#!/bin/sh
# paradigm-resolve.sh — finds the paradigm CLI for the hooks (sourced, POSIX sh).
# Sourced by paradigm-common.sh (Stop hooks), claude-code-precommit.sh and
# cursor-precommit.sh, and embedded in the git post-commit / pre-push hooks
# `paradigm hooks install` writes, so every hook resolves the CLI the same way.
# The plugin's MCP launcher (plugins/paradigm/scripts/paradigm-mcp-launch.cjs)
# uses the same order for the paradigm-mcp server.
#
# Usage:
#   _pm_resolve_paradigm <project-root>   # 0 = found, 1 = not found
#   $PARADIGM_BIN <args...>
#
# Sets:
#   PARADIGM_BIN — one command word: _pm_paradigm_local or paradigm; empty when
#                  nothing resolves. A function name, so a project path with
#                  spaces survives unquoted expansion.
#
# Order:
#   1. The project's own @a-company/paradigm: node runs the package's own
#      `paradigm` bin entry, read from <root>/node_modules/@a-company/paradigm/
#      package.json (whatever another package put at node_modules/.bin/paradigm
#      is never run). The project root only (normalised with pwd -P), never a
#      parent folder or the subdirectory the hook ran from, and never a copy
#      committed to git (`git ls-files` lists it). No npx: npm 11 applies the
#      project's devEngines to npx, so in a repo that requires pnpm (onFail
#      "error") npx exits EBADDEVENGINES.
#   2. `paradigm` on PATH (a global install).
# Nothing else: no npx step. With the project copy first, npx could only reach
# its cache or apply the project's .npmrc, and never a network fetch in a hook.
#
# Trust (Aegis L3, narrowed): the hooks run only @a-company/paradigm at the
# project root, the same trust as the workspace itself and the plugin's MCP
# launch. paradigm-skill-used.sh stays PATH-only: it has no project root.

_pm_paradigm_local() { node "$_PM_LOCAL_PARADIGM" "$@"; }

# Sets _PM_LOCAL_PARADIGM to the project copy's paradigm entry; 1 when unusable.
_pm_local_paradigm_entry() {
  _PM_LOCAL_PARADIGM=""
  [ -n "$1" ] || return 1
  _pm_root=$(cd "$1" 2>/dev/null && pwd -P) || return 1
  _pm_pkg="$_pm_root/node_modules/@a-company/paradigm/package.json"
  [ -f "$_pm_pkg" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  [ -z "$(git -C "$_pm_root" ls-files -- node_modules/@a-company/paradigm node_modules/.bin/paradigm 2>/dev/null)" ] || return 1
  _PM_LOCAL_PARADIGM=$(node -e '
const fs = require("fs"), path = require("path");
const f = process.argv[1];
const p = JSON.parse(fs.readFileSync(f, "utf8"));
const b = typeof p.bin === "string" ? p.bin : p.bin && p.bin.paradigm;
if (p.name !== "@a-company/paradigm" || typeof b !== "string") process.exit(1);
process.stdout.write(path.resolve(path.dirname(f), b));
' "$_pm_pkg" 2>/dev/null) || { _PM_LOCAL_PARADIGM=""; return 1; }
  [ -f "$_PM_LOCAL_PARADIGM" ]
}

_pm_resolve_paradigm() {
  PARADIGM_BIN=""
  if _pm_local_paradigm_entry "$1"; then
    PARADIGM_BIN="_pm_paradigm_local"
  elif command -v paradigm >/dev/null 2>&1; then
    PARADIGM_BIN="paradigm"
  fi
  [ -n "$PARADIGM_BIN" ]
}
