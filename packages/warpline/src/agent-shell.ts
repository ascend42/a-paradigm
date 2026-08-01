/**
 * #agent-shell — the CLI half of the human-class law (soundness audit
 * 2026-07-31 C-11; Aegis M-1; pre-freeze panel D-4).
 *
 * THE DEFECT. `HUMAN_ONLY_VERBS` and `HUMAN_ONLY_ADMIT_FLAGS` were enforced at
 * exactly one place — `daemon/server.ts`'s verb × principal matrix. The native
 * CLI has no token, no principal and no gate, so `warpline resolve` sailed past
 * authorization and failed only on a missing argument; `stake`, `stake recover`,
 * `backup`, `--accept-breach` and `--accept-risk` were likewise on the top-level
 * help with no credential. That is not tidiness: FG-1's ratified completion
 * criterion rests on `resolve` being the act the security law FORBIDS, and a law
 * that holds for an agent on MCP and evaporates for an agent with a shell — which
 * every coding agent has — is not a law the criterion can rest on.
 *
 * WHY THE NAIVE FIX IS INCOHERENT, AND WHAT REPLACES IT. Under the stage-1 trust
 * model (`daemon/tokens.ts`) the OS user IS the boundary: possession of the shell
 * is the human credential, so there is no CLI principal to gate on. But the
 * product already has a marker for "this shell is an agent's shell" and already
 * refuses an agent-attributed CLI write on the strength of it — `$WARPLINE_AGENT_ID`,
 * consumed by `cli.ts`'s `pick` attribution and enforced by #pick's R2 gate under
 * `gate.agentWrites:'real'`. This module applies the SAME shape to the human-class
 * surface. An unmarked shell is byte-identical to before; a marked one is refused
 * with a `refusal:v1` carrying the escalation ladder, never a bare Error.
 *
 * HONEST SCOPE, stated rather than implied:
 *   - `$WARPLINE_AGENT_ID` is UNSIGNED self-assertion, exactly as it is for pick
 *     attribution. An agent that unsets it is unmarked. This raises the cost of
 *     the violation from zero to deliberate; it is not authentication, and M3
 *     signatures are still what closes that gap.
 *   - The gated sets are BOUND to the daemon's own constants. Nothing here
 *     re-lists a verb or a flag, so a fourth divergent copy of the law cannot
 *     appear: adding a verb to HUMAN_ONLY_VERBS gates its CLI command in the
 *     same commit, and #agent-shell-totality fails if the command is missing.
 *
 * Library code: no console output — the CLI's `fail()` prints and exits.
 */

import { HUMAN_ONLY_VERBS, HUMAN_ONLY_ADMIT_FLAGS } from './daemon/protocol.js';
import { refuse, RefusedError } from './fabric/refusal.js';

/** The env var that marks a shell as an AGENT's (same one #pick attributes by). */
export const AGENT_ID_ENV = 'WARPLINE_AGENT_ID';

/**
 * The CLI command path for a daemon verb: dots are subcommand separators on the
 * CLI exactly as they are namespace separators on the wire (`stake.recover` →
 * `warpline stake recover`). DERIVED, so the mapping cannot drift — the same
 * discipline `toolNameOf` applies at the MCP boundary.
 */
export function cliPathOf(verb: string): string {
  return verb.split('.').join(' ');
}

/** CLI command path → the human-only daemon verb it is the CLI skin of. */
export const HUMAN_ONLY_CLI_PATHS: ReadonlyMap<string, string> = new Map(
  HUMAN_ONLY_VERBS.map((verb) => [cliPathOf(verb), verb]),
);

/** camelCase param → the CLI long flag commander registers for it. */
function longFlagOf(param: string): string {
  return '--' + param.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** CLI long flag → the human-only admit flag it is the CLI skin of. */
export const HUMAN_ONLY_CLI_FLAGS: ReadonlyMap<string, string> = new Map(
  HUMAN_ONLY_ADMIT_FLAGS.map((param) => [longFlagOf(param), param]),
);

/** The agent id this shell asserts, or null when the shell is unmarked (human). */
export function agentShellId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[AGENT_ID_ENV];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * The refusal an agent shell gets. FORBIDDEN with an EMPTY `next[]` — verbatim
 * what the daemon answers an agent-kind token on the same verb, because one
 * vocabulary across every skin (G3) is the whole point and an empty ladder means
 * exactly one thing in `refusal:v1`: no call recovers this, ESCALATE. Naming the
 * human verb in `next[]` would invite the retry that IS the violation.
 */
export function agentShellRefusal(): ReturnType<typeof refuse> {
  return refuse({ code: 'FORBIDDEN' });
}

/**
 * What the gate found, so the caller can RECORD the attempt before it refuses
 * (the MCP skin's D-2 ordering: an unrecorded violation is one the W3 rule
 * cannot see, which made "zero W3 marks" structurally unfailable).
 */
export interface AgentShellViolation {
  agentId: string;
  /** the human-class daemon verb attempted, when the whole verb is human-class. */
  verb: string | null;
  /** the human-class admit flags supplied (HUMAN_ONLY_ADMIT_FLAGS names). */
  flags: string[];
  /** the machine-readable refusal, ready to throw. */
  refusal: ReturnType<typeof refuse>;
  /** the human sentence — prose lives OUTSIDE the verdict (refusal.ts). */
  message: string;
}

export interface HumanClassCheck {
  /** the CLI command path being run (e.g. 'resolve', 'stake recover'). */
  cliPath: string;
  /** parsed options, keyed by the HUMAN_ONLY_ADMIT_FLAGS param names. */
  flags?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Inspect one CLI invocation. Returns null when it is allowed — an unmarked
 * (human) shell ALWAYS returns null, on every path, which is what keeps the
 * founder's own shell byte-identical to before this module existed.
 */
export function checkHumanClass(check: HumanClassCheck): AgentShellViolation | null {
  const agentId = agentShellId(check.env ?? process.env);
  if (agentId === null) return null; // possession of the shell is the credential
  const verb = HUMAN_ONLY_CLI_PATHS.get(check.cliPath) ?? null;
  const flags = check.flags
    ? HUMAN_ONLY_ADMIT_FLAGS.filter((param) => check.flags![param] === true)
    : [];
  if (verb === null && flags.length === 0) return null;
  const what =
    verb !== null
      ? `verb ${verb} is human-class only (Aegis §2.2)`
      : `${flags.map(longFlagOf).join(' and ')} ${flags.length === 1 ? 'is a human-class override' : 'are human-class overrides'} (an agent must never accept its own breach or risk; Aegis §2.2)`;
  return {
    agentId,
    verb,
    flags: [...flags],
    refusal: agentShellRefusal(),
    message:
      `warpline: ${what} — this shell is an AGENT shell (${AGENT_ID_ENV}=${JSON.stringify(agentId)}). ` +
      `Escalate to a human rather than retrying; a human shell does not export ${AGENT_ID_ENV}.`,
  };
}

/** The throwing form: `checkHumanClass`, but a violation becomes a RefusedError. */
export function assertHumanClass(check: HumanClassCheck): void {
  const v = checkHumanClass(check);
  if (v) throw new RefusedError(v.refusal, v.message);
}
