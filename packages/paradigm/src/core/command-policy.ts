/**
 * command-policy.ts — which CLI commands are read-only.
 *
 * The rule: a command declared here performs NO filesystem writes (project
 * tree and home directory alike) and NO network calls, in its own action AND
 * in every global hook that runs around it (preAction notices, migrations,
 * caches, telemetry). A global hook asks `isReadOnlyCommand()` before it does
 * anything that writes.
 *
 * Every entry is proven by `src/__tests__/readonly-commands.test.ts`, which
 * runs each one against a temp project and a temp HOME and asserts both trees
 * are byte-identical afterwards. A new entry needs a case there (the test
 * fails if one is missing). Tools that auto-approve shell commands (Gnomon's
 * auto-edits classifier) rely on this guarantee, so only add a command after
 * checking its whole path, imports included.
 *
 * A command not listed here is treated as a write command.
 *
 * Symbol: #command-policy
 */

import type { Command } from 'commander';

/**
 * Full command paths (space-separated, primary names, no aliases). Options
 * do not change the class: every option of a listed command must stay
 * read-only. A command whose options can write (`--fix`, `--output`) does
 * not belong here.
 */
export const READ_ONLY_COMMANDS: readonly string[] = Object.freeze([
  'status',
  'doctor',
  'ripple',
  'integrity',
  'purpose validate',
  'portal validate',
  'task ls',
  'task show',
  'lore list',
  'lore show',
  'notices',
]);

const READ_ONLY = new Set(READ_ONLY_COMMANDS);

/** `task ls` for the `ls` subcommand of `task`; aliases resolve to the primary name. */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c && c.parent; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

export function isReadOnlyCommand(pathOrCmd: string | Command): boolean {
  const p = typeof pathOrCmd === 'string' ? pathOrCmd : commandPath(pathOrCmd);
  return READ_ONLY.has(p);
}
