/**
 * #warpline-orient — "where am I, and what may I do next?" on the CLI
 * (T-2026-11-12-001, founder decision D3).
 *
 * THE GAP IT CLOSES. #f4-trace (src/f4/cli-trace.ts) recorded it as a known
 * coverage gap on the CLI arm: the daemon's `status` (cycleStage 'orient') is
 * the state-aware self-description carrier, and nothing on the CLI answered
 * "what may I legally do next" — `warpline status` is the MEANING DIFF, a
 * different contract. An agent without the daemon/MCP had to guess. `orient`
 * projects the same answer onto the CLI, from the files on disk:
 *
 *   - MODE: native (no .git — Warpline is the version control) or git
 *     (git plus Warpline). Same rule `init` uses for the agent guide.
 *   - whether the project is initialized (a selvage exists) and the agent
 *     guide is present in AGENTS.md / CLAUDE.md.
 *   - the daemon's lifecycle state and whether an MCP entry is configured.
 *   - THIS AGENT's next legal verbs, from the SAME position reader the daemon
 *     uses (#warplined-position) and the SAME rule table (NEXT_LEGAL_VERBS in
 *     #warplined-descriptors), each with the exact CLI command to run. The agent
 *     is `--agent <id>`, else $WARPLINE_AGENT_ID, else unknown (then the answer
 *     is for an agent with no scratch yet, and says so).
 *   - the human-only verbs and flags, and the key limits a cold agent gets wrong.
 *
 * FG-3: CLI-ONLY. It adds no daemon verb and touches neither VERB_DESCRIPTORS,
 * NEXT_LEGAL_VERBS nor the tool-name map, so `descriptorsId` does not move
 * (test/descriptors-frozen.test.ts passes with its literal unchanged).
 *
 * IT WRITES NOTHING — no traceCli row (like `health`), no cache, no lock, and
 * it never runs git itself (the CLI's root resolution may ask git for the
 * toplevel, read-only; with git absent it falls back to the cwd). Pinned by a
 * before/after byte digest of the project in test/warpline-orient.test.ts.
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf, readSelvage } from './fabric/fabric.js';
import { readRef } from './fabric/refs.js';
import { scanAgentGuide, agentGuideModeOf, type AgentGuideMode } from './fabric/agent-guide.js';
import { cyclePositionOf } from './daemon/position.js';
import { nextLegalVerbsFor } from './daemon/descriptors.js';
import { daemonState } from './daemon/lifecycle.js';
import { readMcpTokens, mcpTokenPathOf } from './daemon/tokens.js';
import { HUMAN_ONLY_VERBS } from './daemon/protocol.js';
import { agentShellId, cliPathOf } from './agent-shell.js';

/** ADDITIVE ONLY within v1: fields are only added (enum sets only grow); a breaking change ships as orient:v2. */
export const ORIENT_SCHEMA = 'orient:v1' as const;

export interface OrientStep {
  /** the daemon verb (dotted, as on the wire), or a CLI-only command name. */
  verb: string;
  /** the exact CLI command to run, with `<placeholders>` for what you supply. */
  command: string;
}

export interface OrientReport {
  schema: typeof ORIENT_SCHEMA;
  root: string;
  mode: AgentGuideMode;
  /** a selvage exists — `warpline init` (or a first seal) has run. */
  initialized: boolean;
  selvage: string | null;
  /**
   * when THIS root has no `.warpline/` but an ancestor does: that ancestor (you
   * are in a subdirectory of a Warpline project — rerun with `--root <it>`).
   */
  enclosingRoot: string | null;
  /** is the agent guide block present? claudeMd null = no CLAUDE.md at all. */
  agentGuide: { agentsMd: boolean; claudeMd: boolean | null };
  daemon: {
    state: 'running' | 'stale' | 'stopped';
    /** an MCP server entry running `warpline mcp` exists in .mcp.json. */
    mcpConfigured: boolean;
    /** MCP agent tokens minted for this fabric (`daemon token mint --mcp`). */
    mcpTokens: number;
  };
  agent: { id: string | null; source: 'flag' | 'env' | null };
  /** this agent's position; null when no agent id is known. */
  position: {
    scratchPresent: boolean;
    proposalSealed: boolean;
    behindSelvage: boolean;
    knotOpen: boolean;
  } | null;
  next: OrientStep[];
  nextBecause: string;
  humanOnly: OrientStep[];
  limits: string[];
}

/** Quote a path for a shell command line only when it needs it. */
function quoteArg(p: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(p) ? p : `"${p.replace(/"/g, '\\"')}"`;
}

/** The CLI command for a daemon verb, with the agent's id (or a placeholder). */
function commandFor(verb: string, agent: string): string {
  switch (verb) {
    case 'fork':
      return `warpline fork ${agent}`;
    case 'propose':
      return `warpline propose --agent ${agent} --native -m "<why>"`;
    case 'admit':
      return `warpline admit ${agent} --native`;
    case 'abandon':
      return `warpline abandon ${agent}`;
    case 'knot.show':
      return 'warpline knot show <knotPayloadId>';
    case 'branch':
      return 'warpline branch <name>';
    case 'switch':
      return 'warpline switch <branch>';
    case 'resolve':
      return `warpline resolve ${agent} --native -m "<decision>"`;
    case 'stake':
      return 'warpline stake [selector]';
    case 'stake.recover':
      return 'warpline stake recover <commit>';
    case 'backup':
      return 'warpline backup <dest>';
    default:
      return `warpline ${cliPathOf(verb)}`;
  }
}

/** Does `file` hold a complete warpline block? null when the file is absent. */
function hasBlock(file: string): boolean | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // the SAME scan the writer uses: whole-line markers outside code fences
  return scanAgentGuide(text.replace(/^\uFEFF/, '')).kind === 'one';
}

/** The nearest ANCESTOR of `root` holding a `.warpline/` directory, or null. */
function enclosingWarplineRoot(root: string): string | null {
  let dir = path.dirname(path.resolve(root));
  for (;;) {
    try {
      if (fs.statSync(path.join(dir, '.warpline')).isDirectory()) return dir;
    } catch {
      /* not here */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Is `token` the warpline binary itself (bare, a .cmd/.exe shim, the package, or its dist/cli.js)? */
function isWarplineCommand(token: string): boolean {
  const base = path.basename(token.replace(/\\/g, '/'));
  return (
    /^warpline(\.cmd|\.exe|\.ps1)?$/i.test(base) ||
    /^@a-company\/warpline(@[^/]+)?$/.test(token) ||
    /(^|[\\/])warpline[\\/]dist[\\/]cli\.js$/.test(token)
  );
}

/** Is a `warpline mcp` server configured in the project's .mcp.json? */
function mcpConfigured(root: string): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    // The entry must actually RUN warpline with an `mcp` argument after it —
    // a server merely named "warpline", or one mentioning it in a path or an
    // env var, is not one.
    return Object.values(cfg.mcpServers ?? {}).some((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const e = entry as { command?: unknown; args?: unknown };
      const argv = [e.command, ...(Array.isArray(e.args) ? e.args : [])].filter((t): t is string => typeof t === 'string');
      const at = argv.findIndex(isWarplineCommand);
      return at !== -1 && argv.slice(at + 1).includes('mcp');
    });
  } catch {
    return false;
  }
}

const LIMITS: readonly string[] = Object.freeze([
  'A KNOT needs a human: stop and ask. Only a human runs `warpline resolve` (and the admit overrides --accept-breach / --accept-risk).',
  '"clean" is not "no change": `warpline status` can report 0 meaning changes while files changed on disk (byte-only). Read the on-disk line.',
  'Files meaning does not cover (config values, lockfiles, assets) are compared byte by byte; a merge meaning was blind to HOLDS for a human.',
  'Never edit `.warpline/` by hand. Diagnose with `warpline health`.',
]);

/**
 * Orient an agent. Read-only and total: a missing or damaged fabric yields a
 * report that says so; it never throws for a project that merely is not set up.
 */
export function orient(root: string, opts: { agentId?: string; env?: NodeJS.ProcessEnv } = {}): OrientReport {
  const wdir = warplineDirOf(root);
  const mode = agentGuideModeOf(root);

  let selvage: string | null = null;
  let initialized = false;
  try {
    selvage = readRef(wdir, 'selvage');
    initialized = selvage !== null || readSelvage(wdir) !== null;
  } catch {
    /* an unreadable tip reads as "not initialized" here; `health` reports why */
  }

  const flagId = opts.agentId?.trim() || null;
  const envId = flagId ? null : agentShellId(opts.env ?? process.env);
  const agentId = flagId ?? envId;
  const agent = { id: agentId, source: flagId ? ('flag' as const) : envId ? ('env' as const) : null };
  const who = agentId ?? '<you>';

  const ds = daemonState(root);
  let tokens = 0;
  try {
    // DISTINCT tokens: the legacy single file is usually also in the keyed map.
    const distinct = new Set(Object.values(readMcpTokens(root)));
    try {
      const legacy = fs.readFileSync(mcpTokenPathOf(root), 'utf8').trim();
      if (legacy) distinct.add(legacy);
    } catch {
      /* no legacy file */
    }
    tokens = distinct.size;
  } catch {
    tokens = 0;
  }

  let position: OrientReport['position'] = null;
  let next: OrientStep[];
  let nextBecause: string;
  const enclosingRoot = initialized || fs.existsSync(wdir) ? null : enclosingWarplineRoot(root);
  if (enclosingRoot !== null) {
    // a SUBDIRECTORY of a Warpline project — never tell it to init a second fabric.
    next = [{ verb: 'orient', command: `warpline --root ${quoteArg(enclosingRoot)} orient` }];
    nextBecause = `this directory is inside the Warpline project at ${enclosingRoot}; run Warpline there (pass --root, or cd to it) — do not \`warpline init\` here, that would start a second, separate history.`;
  } else if (!initialized) {
    next = [{ verb: 'init', command: 'warpline init' }];
    nextBecause = 'this project has no Warpline genesis yet: `warpline init` onboards it (idempotent).';
  } else {
    const pos = agentId
      ? cyclePositionOf(root, agentId)
      : { scratchPresent: false, proposalSealed: false, behindSelvage: false, knotOpen: false };
    if (agentId) {
      position = {
        scratchPresent: pos.scratchPresent,
        proposalSealed: pos.proposalSealed,
        behindSelvage: pos.behindSelvage,
        knotOpen: pos.knotOpen,
      };
    }
    const rule = nextLegalVerbsFor(pos);
    next = rule.verbs.map((verb) => ({ verb, command: commandFor(verb, who) }));
    nextBecause = agentId
      ? rule.because
      : `no agent id (pass --agent <you> or set WARPLINE_AGENT_ID to see your own position); for an agent with no scratch yet — ${rule.because}`;
  }

  const humanOnly: OrientStep[] = [
    ...HUMAN_ONLY_VERBS.map((verb) => ({ verb, command: commandFor(verb, who) })),
    { verb: 'admit --accept-breach', command: `warpline admit ${who} --native --accept-breach` },
    { verb: 'admit --accept-risk', command: `warpline admit ${who} --native --accept-risk` },
    { verb: 'branch --protect', command: 'warpline branch --protect <name>' },
    { verb: 'branch --unprotect', command: 'warpline branch --unprotect <name>' },
  ];

  return {
    schema: ORIENT_SCHEMA,
    root,
    mode,
    initialized,
    selvage,
    enclosingRoot,
    agentGuide: {
      agentsMd: hasBlock(path.join(root, 'AGENTS.md')) === true,
      claudeMd: hasBlock(path.join(root, 'CLAUDE.md')),
    },
    daemon: { state: ds.state, mcpConfigured: mcpConfigured(root), mcpTokens: tokens },
    agent,
    position,
    next,
    nextBecause,
    humanOnly,
    limits: [...LIMITS],
  };
}
