#!/bin/sh
# Paradigm Claude Code UserPromptSubmit — Team Invocation Gate (advisory tier)
# Fires on every user prompt. If the task looks orchestration-eligible and the
# session has neither orchestrated nor declared solo, injects a decision-time
# directive into the model's context (UserPromptSubmit stdout = context).
#
# Why decision-time: CLAUDE.md "always use the team" instructions sit far back
# in context and lose to the model's action bias. A directive injected at the
# moment of decision is deterministic — it fires 100% of the time.
#
# Hook type: UserPromptSubmit
# Exit 0 = always (advisory only — never blocks)
#
# Telemetry: every eligible prompt appends an `eligible` event to
# the machine-home team-funnel.jsonl (even when the directive is capped),
# so the classifier's false-positive rate and the team-invocation rate are
# measurable from day one. Loid calibrates the gate from this data.
#
# Escape hatches: PARADIGM_TEAM_GATE=off env var; `paradigm solo <reason>`
# declares a legible solo session; orchestrating clears the gate naturally.

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin UserPromptSubmit 5000 2000

INPUT=$(cat)

# Kill switch
if [ "$PARADIGM_TEAM_GATE" = "off" ]; then
  exit 0
fi

# Extract cwd from input
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$CWD" ]; then
  CWD="$(pwd)"
fi

# Project root + session (paradigm-resolve.sh): markers live at the root, so a
# delegation credited from a worktree counts here too. Not a paradigm project — pass.
[ -f "$_PM_DIR/paradigm-resolve.sh" ] && . "$_PM_DIR/paradigm-resolve.sh"
command -v _pm_project_root >/dev/null 2>&1 || exit 0
_pm_project_root "$CWD" || exit 0
CWD=$PM_ROOT
_pm_session_id "$INPUT"
_pm_session_started

# Markers are not cleared by the Stop hook (it fires per assistant turn, so
# clearing there would erase solo declarations mid-session and turn the
# once-per-session cap into once-per-turn nagging). A team-agent delegation
# lasts for the session; shared markers expire by age (TTL default 4h).
# Session already resolved the gate (team ran, or solo was declared) — pass
if _pm_gate_resolved; then
  exit 0
fi

# Extract the prompt text
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
else
  PROMPT=$(printf '%s' "$INPUT" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"prompt"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# Too short to be a task (confirmations, "yes", "continue") — pass
if [ "${#PROMPT}" -lt 24 ]; then
  exit 0
fi

# Eligibility: implementation-shaped verbs. Deliberately simple — the funnel
# telemetry measures this classifier's false-positive rate; tune from data.
# printf (not echo): a prompt starting with -n/-e must not be mangled.
MATCHED=$(printf '%s\n' "$PROMPT" | grep -ioE 'implement|build |fix |refactor|migrate|rewrite|integrate|add (a |an |the )?(feature|support|endpoint|command|tool|component)|create (a |an |the )?(feature|component|module|service)' | head -1)

if [ -z "$MATCHED" ]; then
  exit 0
fi

# Record the eligible event (telemetry fires every time, even when the
# directive itself is capped). Machine home, via _pm_learn_append.
MATCHED_CLEAN=$(printf '%s' "$MATCHED" | tr -cd 'a-zA-Z ' | head -c 40)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
_pm_learn_append team-funnel "{\"timestamp\":\"$TS\",\"type\":\"eligible\",\"source\":\"prompt-gate\",\"matched\":\"$MATCHED_CLEAN\"}" || true

# Inject the directive at most once per session (per TTL window without a
# session id)
_pm_once team-prompted || exit 0

# stdout on UserPromptSubmit = injected into the model's context
echo "[paradigm] This task looks orchestration-eligible (matched: \"$MATCHED_CLEAN\")."
echo "Standing opt-in for team orchestration exists in this project. Before editing source:"
echo "  - Delegate to a team agent with the Agent tool (a paradigm:* agent, or one in .claude/agents or ~/.claude/agents), OR"
echo "  - Declare solo explicitly: \`paradigm solo <trivial|hotfix|user-directed|exploratory> [note]\`"
echo "Solo work on eligible tasks without a declaration is recorded as a bypass at session end."

exit 0
