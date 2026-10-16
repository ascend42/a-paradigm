#!/bin/sh
# Paradigm Claude Code PostToolUse — Skill usage ledger (!skill-used)
# Fires after the host `Skill` tool runs. When the invoked skill is a Paradigm
# projection (`pdg-<id>`, optionally plugin-qualified `x:pdg-<id>`), appends a
# row to .paradigm/events/skill-usage.jsonl via the hidden
# `paradigm skill record-usage` verb (buildSkillUsageRow + appendSkillUsage).
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PostToolUse (matcher: Skill)
# Contract: NEVER fails loudly — always exit 0, no stdout/stderr output.

INPUT=$(cat)

# Cheap pre-filter: only Paradigm projections pay for a CLI spawn.
case "$INPUT" in
  *pdg-*) ;;
  *) exit 0 ;;
esac

# Only a `paradigm` already on PATH — no npx fallback (Aegis L3: never resolve
# an arbitrary package-local binary from an untrusted cwd). Absent → silent pass.
command -v paradigm >/dev/null 2>&1 || exit 0
printf '%s' "$INPUT" | paradigm skill record-usage >/dev/null 2>&1 || true

exit 0
