#!/bin/sh
# paradigm-resolve.sh — finds the paradigm CLI, the project root and the
# session's state files for the hooks (sourced, POSIX sh). The root and session
# helpers (_pm_project_root, _pm_session_id, _pm_gate_resolved, _pm_once) are
# documented at the end of the file.
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
#      is never run). The project root only (normalised with cd -P / pwd -P,
#      CDPATH ignored), never a parent folder or the subdirectory the hook ran
#      from, and never a copy committed to git (`git ls-files` lists it; when
#      the root has a .git and git fails, it is not run either). No npx: npm 11 applies the
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
  # CDPATH= : a relative root must not be redirected by the user's CDPATH.
  _pm_root=$(CDPATH= cd -P -- "$1" 2>/dev/null && pwd -P) || return 1
  _pm_pkg="$_pm_root/node_modules/@a-company/paradigm/package.json"
  [ -f "$_pm_pkg" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  # Committed to git: never run it. With a .git at the root and git failing
  # (not installed, dubious ownership) it cannot be checked: not run either.
  # Outside a git repo: fine, quietly.
  if _pm_tracked=$(git -C "$_pm_root" ls-files -- node_modules/@a-company/paradigm node_modules/.bin/paradigm 2>/dev/null); then
    [ -z "$_pm_tracked" ] || return 1
  elif [ -e "$_pm_root/.git" ]; then
    return 1
  fi
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

# --- Project root and session state (shared by the Claude Code hooks) ---
#
# _pm_project_root [<cwd>]   # 0 = found, 1 = not a Paradigm project
#   Sets PM_ROOT to the Paradigm project the session belongs to:
#   1. $CLAUDE_PROJECT_DIR when it holds a .paradigm/ (the directory the
#      session started in, so a session started inside a worktree judges it);
#   2. the main checkout, the parent of `git rev-parse --git-common-dir`. A
#      linked worktree (e.g. .claude/worktrees/<agent>) carries the tracked part
#      of .paradigm/, but a session that did not start there is judged, and
#      keeps its gate markers, at the project root;
#   3. <cwd> itself when it holds a .paradigm/ (no git, or a nested project).
#   Paths stay logical (no pwd -P) so they compare with the paths Claude Code
#   sends in tool_input.file_path.
_pm_project_root() {
  PM_ROOT=""
  if [ -n "$CLAUDE_PROJECT_DIR" ] && [ -d "$CLAUDE_PROJECT_DIR/.paradigm" ]; then
    PM_ROOT=${CLAUDE_PROJECT_DIR%/}
    return 0
  fi
  _pm_c=${1:-$PWD}
  _pm_gcd=$(CDPATH= cd -- "$_pm_c" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null) || _pm_gcd=""
  if [ -n "$_pm_gcd" ]; then
    case "$_pm_gcd" in /*|[A-Za-z]:*) ;; *) _pm_gcd="$_pm_c/$_pm_gcd" ;; esac
    _pm_gcd=${_pm_gcd%/}
    case "$_pm_gcd" in
      */.git)
        _pm_r=$(CDPATH= cd -- "${_pm_gcd%/.git}" 2>/dev/null && pwd) || _pm_r=""
        if [ -n "$_pm_r" ] && [ -d "$_pm_r/.paradigm" ]; then
          PM_ROOT=$_pm_r
          return 0
        fi
        ;;
    esac
  fi
  if [ -d "$_pm_c/.paradigm" ]; then
    PM_ROOT=$(CDPATH= cd -- "$_pm_c" 2>/dev/null && pwd) || PM_ROOT=$_pm_c
    return 0
  fi
  return 1
}

# _pm_json_field <json> <field> — prints a top-level string field (jq, else grep).
_pm_json_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r --arg f "$2" '.[$f] // empty' 2>/dev/null
  else
    printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" 2>/dev/null | head -n 1 | sed "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//" 2>/dev/null
  fi
}

# _pm_session_id <json> — sets PM_SID to the input's session_id, reduced to
# [A-Za-z0-9_-] (it names files). Empty when the input carries none.
_pm_session_id() {
  PM_SID=$(_pm_json_field "$1" session_id | tr -cd 'A-Za-z0-9_-' | head -c 80)
}

# Session state lives in <root>/.paradigm/.sessions/<session_id>.<kind>
# (gitignored): .touched (the Write/Edit ledger), .orchestrated (a team agent
# was delegated to this session), .stop-fp (the last blocked violation set),
# .team-prompted / .team-reminded (once-per-session reminders). A session file
# lasts for the session. The shared .paradigm/.orchestrated and .solo-declared
# (written by the MCP server and `paradigm solo`, which have no session id)
# still expire by age: PARADIGM_GATE_TTL_HOURS, default 4h.
_pm_session_file() { # <kind> -> path; status 1 without a session id
  [ -n "$PM_SID" ] && [ -n "$PM_ROOT" ] || return 1
  printf '%s' "$PM_ROOT/.paradigm/.sessions/$PM_SID.$1"
}

_pm_marker_fresh() { # <path> — exists and is younger than the gate TTL
  [ -f "$1" ] || return 1
  _pm_ttl=$(( ${PARADIGM_GATE_TTL_HOURS:-4} * 60 ))
  [ -n "$(find "$1" -mmin "-$_pm_ttl" 2>/dev/null)" ]
}

# _pm_gate_resolved — the orchestration gate is satisfied: a team agent was
# delegated to in this session, or a fresh shared marker exists (MCP
# settlement/debrief, delegation from a session without an id, `paradigm solo`).
_pm_gate_resolved() {
  if _pm_sf=$(_pm_session_file orchestrated) && [ -f "$_pm_sf" ]; then return 0; fi
  _pm_marker_fresh "$PM_ROOT/.paradigm/.orchestrated" && return 0
  _pm_marker_fresh "$PM_ROOT/.paradigm/.solo-declared" && return 0
  return 1
}

# _pm_once <kind> — status 0 the first time per session (per TTL window when
# the input has no session id) and records it; 1 afterwards.
_pm_once() {
  if _pm_sf=$(_pm_session_file "$1"); then
    [ -f "$_pm_sf" ] && return 1
    mkdir -p "${_pm_sf%/*}" 2>/dev/null
    : > "$_pm_sf" 2>/dev/null
    return 0
  fi
  _pm_marker_fresh "$PM_ROOT/.paradigm/.$1" && return 1
  touch "$PM_ROOT/.paradigm/.$1" 2>/dev/null
  return 0
}
