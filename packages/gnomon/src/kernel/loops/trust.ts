/**
 * @symbol #loop-registry
 *
 * #loop-registry, the trust card (docs/specs/gnomon-loops.md §3.1 "Trust card", "Trust record"; build plan LP2).
 * Serves the human's `request.loop.trust|untrust|delete` (the dispatcher routes them from a first-party gui or device
 * human connection ONLY; refused here again for any other asker):
 *
 *   - **trust{loopId, scope, repo | repoKey, contentHash?}.** The registry recomputes the loop; a named contentHash
 *     must be its current hash (the human trusts what they looked at); the card shows the hash it binds either way,
 *     and allow re-checks it inside the touch. Raises ONE `loop-trust` card: root class
 *     (fresh presence AND the root key, classes.ts), never `always`, never standing (NEVER_STANDING_KINDS), never by
 *     voice (handOnly + the contracts voice allowlist). Its lines render the whole definition (every node, argv with
 *     argv0's realpath and sha256 and its shebang interpreter, tools, model, triggers, budgets, goal and protected
 *     inputs, land paths, call pins, the config closure) and, when an earlier version was trusted, the diff against
 *     it. `allow` prepares ONE `loop.trusted{loopId, scope, repoKey, contentHash, coreHash, closureDigest, sourceHash,
 *     cardId, by}` row (re-checking the hash under the home's one in-flight root decision), the helper signs the
 *     decision and the row in one touch (decision-batch.ts row table `loop-trust`), and the effect appends it as a
 *     kernel row carrying the root signature, then stores the snapshot the next card diffs against.
 *   - **untrust{loopId, scope, repo | repoKey}.** A tightening: no presence, writes `loop.untrusted{…, by}` at once.
 *   - **delete{loopId, scope, repo | repoKey}.** Writes `loop.deleted{…, by}` (trust revoked; this content hash
 *     stays deleted). A personal loop's file is removed too (the kernel's own dir); a repo loop's files are the
 *     human's and stay.
 *   - pause, resume and run are #loop-runner's (runner.ts; wire.ts routes them there).
 *
 * Every row is a kernel row; the registry folds it back from the log (LL6).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintId, sanitizeDisplayText, type CardV1 } from '@a-company/gnomon-contracts';
import type { CompiledLoop } from '../../loops/index.js';
import type { RaiseInput } from '../broker/broker.js';
import { beginRootDecision } from '../manifest/grant-lock.js';
import { RpcRefusal } from '../socket/rpc.js';
import { repoKeyOf } from '../supervisor/repo-hooks.js';
import type { LoopHash } from './hash.js';
import { loopKeyOf, repoRootOf, type LoopEntry, type LoopRegistry, type LoopScopeName } from './registry.js';
import { envCardLines, LOOP_HOME_ENV_SHOWN, loopEnvNames, type EnvCardContext } from './loop-env.js';
import { hardenedGit } from '../git/scratch.js';
import { osUserHome } from '../runner/env.js';

export const LOOP_REQUEST_KINDS: readonly string[] = Object.freeze(['request.loop.trust', 'request.loop.untrust', 'request.loop.pause', 'request.loop.resume', 'request.loop.run', 'request.loop.delete', 'request.loop.budget']);
/** A loop-trust card waits this long for the human (then it expires; nothing is trusted). */
export const LOOP_TRUST_CARD_TTL_MS = 24 * 3600 * 1000;
/** Card lines are capped at 512 code points (card.ts MAX_LINE): longer ones wrap, never cut. */
const WRAP = 480;
const DIFF_MAX = 200;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REPO_KEY = /^sha256:[0-9a-f]{64}$/;

export interface LoopAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

export interface LoopTrustOptions {
  home: string;
  registry: LoopRegistry;
  broker: { raise(input: RaiseInput): Promise<CardV1>; card?(cardId: string): CardV1 | undefined };
  /** append a kernel row (as the kernel principal) */
  append: (kind: string, payload: Record<string, unknown>, ids: { connId: string }) => Promise<void>;
  /** #loop-runner: an untrust or delete stops the loop's run in flight before its next step */
  onRevoke?: (key: string, reason: 'untrusted') => void;
  clock?: () => number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (msg: string, data?: Record<string, unknown>): RpcRefusal => new RpcRefusal('BAD_REQUEST', 'bad-params', msg, data);
const short = (h: string | undefined): string => (h ? h.slice(0, 19) : '—');

// ── Rendering (the card's lines) ───────────────────────────────────────────────

/** Sanitize (the one §4.5 sanitizer) THEN wrap, so a wrap never splits an escape the sanitizer would remove. */
function wrap(raw: string, indent = '    '): string[] {
  const line = sanitizeDisplayText(String(raw)).text;
  const cps = Array.from(line);
  if (cps.length <= WRAP) return [line];
  const out: string[] = [cps.slice(0, WRAP).join('')];
  for (let i = WRAP; i < cps.length; i += WRAP - indent.length) out.push(`${indent}${cps.slice(i, i + WRAP - indent.length).join('')}`);
  return out;
}

const edges = (on: Record<string, string>): string => Object.entries(on).map(([k, v]) => `${k}→${v}`).join(' ');
const list = (xs: readonly string[] | undefined, none = 'none'): string => (xs && xs.length ? xs.join(', ') : none);

export { loopEnvNames };

/** What a call node's callee hands its children (Aegis F6): env names, env files, network. */
export interface CalleeEnvView {
  names: string[];
  envFiles: string[];
  network: boolean;
}

/** The kernel's card context: the repo, the OS home, the Gnomon home and a git-tracked check (hardened git). */
export function envCardContext(repoRoot: string, gnomonHome: string): EnvCardContext {
  return {
    repoRoot, gnomonHome, userHome: osUserHome(),
    tracked: (rel) => {
      try {
        return hardenedGit(['ls-files', '--error-unmatch', '--', rel], { cwd: repoRoot, allowFail: true }).status === 0;
      } catch {
        return false;
      }
    },
  };
}

/** The definition as the card shows it (no hash header: these lines are the diff base). */
export function renderDefinition(c: CompiledLoop, h: LoopHash, calleeEnv?: (nodeId: string) => CalleeEnvView | null, envCtx?: EnvCardContext): string[] {
  const out: string[] = [];
  const push = (l: string): void => void out.push(...wrap(l));
  push(`Title: ${c.title ?? '(none)'}`);
  if (c.repo) push(`Repo: ${c.repo}`);
  push(`Flows: ${list(c.flows)}${c.flowPaths ? ` (paths: ${Object.entries(c.flowPaths).map(([f, g]) => `${f} → ${g.join(', ') || 'none'}`).join('; ')})` : c.flows.length ? ' (unresolved: no flow index at compile)' : ''}`);
  push(`Source hash (what a caller's pin names): ${c.compiled.sourceHash ?? 'none (compiled without one: no loop can call it)'}`);
  push(`Autonomy: ${c.autonomy}; decide: ${c.decide}; notify on ${list(c.notify.on)} as ${c.notify.as}`);
  push('Model: local only (Claude in loops lands in 8.1)');
  const trig = c.triggers.map((t) => {
    if (t.type === 'schedule') return `schedule ${t.every !== undefined ? `every ${t.every}s` : t.daily !== undefined ? `daily ${t.daily}` : `weekly ${t.weekly?.day} ${t.weekly?.at}`} (catch up: ${t.catchUp})`;
    if (t.type === 'event') return `event ${t.kind}${t.flow ? ` ${t.flow}` : ''}${t.paths ? ` [${t.paths.join(', ')}]` : ''}${t.loop ? ` ${t.loop}.${t.node}` : ''} (debounce ${t.debounceSec}s)`;
    return `continuous (cooldown ${t.cooldownSec}s)`;
  });
  push(`Triggers: ${[...trig, 'manual'].join('; ')}`);
  const b = c.budgets;
  push(`Budgets: run ${b.run.rounds} rounds, ${b.run.wallMin} min, ${b.run.tokens} tokens, ${b.run.computeSec}s compute; day ${b.day.runs} runs, ${b.day.tokens} tokens, ${b.day.computeSec}s compute; escalations ${b.escalations.perRun}/run, ${b.escalations.perDay}/day`);
  push(c.goal ? `Goal: ${c.goal.node} = ${c.goal.verdict}; goal inputs: ${list(c.goal.inputs)}` : 'Goal: none');
  push(`Protected (act nodes may not edit): ${list(c.protected)}`);
  push(c.land ? `Land paths: ${list(c.land.paths)}; message "${c.land.message}"; max wait ${c.land.maxWaitMin} min (gate-class paths never land without a card)` : 'Land: none (nothing lands)');
  // 8.0 approve-to-land (founder decision, build plan step 11; Aegis M6): said plainly on the card that trusts it
  if (c.land && c.nodes.some((n) => n.type === 'model' && n.role === 'act')) push('Proposes changes to your current branch; nothing lands until you accept the card.');
  // TD-2026-10-23-268: the human's variables this loop's children get (names, never values) and whether check output
  // is scrubbed; both are in the hash, so a change to either takes a new trust
  const envNames = loopEnvNames(c);
  if (envNames.length) push(`uses your env: ${envNames.join(', ')}`);
  // Aegis M3/M4: every source with its real path and place, and each name's source (the context is the kernel's)
  if (envCtx) for (const l of envCardLines(c, envCtx)) push(l);
  else if (c.envFiles?.length) push(`reads env from: ${LOOP_HOME_ENV_SHOWN} (read first), then ${c.envFiles.join(', then ')}`);
  if (c.redact === 'off') push('shows check output unredacted');
  if (c.network === 'on') push('checks can reach the network');
  push(`Start: ${c.start}`);
  const argvOf = new Map(h.argv.map((a) => [a.node, a]));
  const callOf = new Map(h.calls.map((x) => [x.node, x]));
  for (const n of c.nodes) {
    const exit = n.exit ? `; exit ${Object.entries(n.exit).map(([k, v]) => `${k} ${v}`).join(', ')}` : '';
    if (n.type === 'check') {
      const what = n.run ? `run ${n.run.join(' ')}` : `builtin ${n.builtin} ${JSON.stringify(n.args ?? {})}`;
      push(`Node ${n.id} (check, ${n.effect}): ${what}; pass ${JSON.stringify(n.pass)}; timeout ${n.timeoutSec}s${exit}; on ${edges(n.on)}`);
      const a = argvOf.get(n.id);
      if (a) {
        const a0 = a.argv0;
        push(`  argv0 ${a0.argv0} → ${a0.resolved === null ? 'NOT FOUND' : `${a0.real ?? a0.resolved} ${a0.sha256 ? `sha256:${a0.sha256.slice(0, 16)}` : 'unreadable'}`}`);
        if (a0.interpreter) {
          const i = a0.interpreter;
          push(`  interpreter #!${i.shebang} → ${i.via === 'unresolved' ? 'UNRESOLVED' : `${i.via} ${i.real} sha256:${(i.sha256 ?? '').slice(0, 16)}`}`);
        }
        for (const f of a.files) push(`  file ${f.word}: ${f.kind}${f.real ? ` ${f.real}` : ''}${f.sha256 ? ` sha256:${f.sha256.slice(0, 16)}` : ''}`);
      }
      if (n.env?.length) push(`  uses your env: ${n.env.join(', ')}`);
    } else if (n.type === 'model') {
      push(`Node ${n.id} (model, ${n.role}): local${n.model.profile ? ` profile ${n.model.profile}` : ''}, min confidence ${n.model.minConfidence}; tools ${n.tools.length ? n.tools.map((t) => (typeof t === 'string' ? t : `paradigm:${t.paradigm.join('|')}`)).join(', ') : 'none'}; inputs ${list(n.inputs)}${n.verdict ? `; classes ${n.verdict.classes.join(', ')}` : ''}; limits ${n.limits.turns} turns, ${n.limits.tokens} tokens${exit}; on ${edges(n.on)}`);
      if (n.env?.length) push(`  uses your env: ${n.env.join(', ')}`);
      if (n.prompt !== undefined) push(`  prompt: ${n.prompt}`);
    } else if (n.type === 'notify') {
      push(`Node ${n.id} (notify, ${n.as}): ${n.text !== undefined ? `"${n.text}"` : '(no text)'}${n.choices ? `; choices ${n.choices.join(', ')}` : ''}${n.attach.length ? `; attach ${n.attach.join(', ')}` : ''}${exit}; on ${edges(n.on)}`);
    } else {
      const x = callOf.get(n.id);
      push(`Node ${n.id} (call): ${n.loop} → callee hash ${x?.calleeHash ? short(x.calleeHash) : 'UNRESOLVED'}${exit}; on ${edges(n.on)}`);
      // Aegis F6: what the callee hands its children is part of what this card trusts
      const ce = calleeEnv?.(n.id);
      if (ce?.names.length) push(`  callee uses your env: ${ce.names.join(', ')}`);
      if (ce?.envFiles.length) push(`  callee reads env from: ${ce.envFiles.join(', ')}`);
      if (ce?.network) push('  callee checks can reach the network');
    }
  }
  push(`Config closure (${h.closure.all.length} file${h.closure.all.length === 1 ? '' : 's'}${h.closure.truncated ? `, ${h.closure.truncated} more not listed` : ''}): ${h.closure.files.map((f) => `${f.rel} sha256:${f.sha256.slice(0, 12)}`).join(', ') || 'none'}`);
  return out;
}

/** A line diff (LCS) of two renderings: `- old` / `+ new` lines only, capped. */
export function diffLines(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) out.push(`+ ${b[j++]}`);
    else out.push(`- ${a[i++]}`);
  }
  return out.length > DIFF_MAX ? [...out.slice(0, DIFF_MAX), `… ${out.length - DIFF_MAX} more changed lines`] : out;
}

// ── The request handler ────────────────────────────────────────────────────────

export interface LoopTarget {
  loopId: string;
  scope: LoopScopeName;
  repoKey: string | undefined;
  contentHash: string | undefined;
}

export function parseLoopTarget(registry: LoopRegistry, kind: string, payload: unknown, extraKeys: readonly string[] = []): LoopTarget {
  const shape = `${kind} takes {loopId, scope, repo | repoKey${extraKeys.length ? `, ${extraKeys.join(', ')}` : ''}}`;
  if (!isObj(payload)) throw bad(shape);
  const allowed = ['loopId', 'scope', 'repo', 'repoKey', ...extraKeys];
  const extra = Object.keys(payload).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`${shape} (unknown: ${extra.slice(0, 4).join(', ')})`);
  const { loopId, scope, repo, repoKey, contentHash } = payload;
  if (typeof loopId !== 'string' || !KEBAB.test(loopId) || loopId.length > 64) throw bad('loopId is a kebab-case loop id', { field: 'loopId' });
  if (scope !== 'repo' && scope !== 'personal') throw bad("scope is 'repo' or 'personal'", { field: 'scope' });
  let key: string | undefined;
  if (repoKey !== undefined) {
    if (typeof repoKey !== 'string' || !REPO_KEY.test(repoKey)) throw bad('repoKey is sha256:<64 hex>', { field: 'repoKey' });
    key = repoKey;
  }
  if (repo !== undefined) {
    if (typeof repo !== 'string' || !path.isAbsolute(repo) || repo.length > 4096 || repo.includes('\u0000')) throw bad('repo is an absolute path', { field: 'repo' });
    // a human naming a repo makes it known (the registry scans it from now on)
    const k = scope === 'repo' ? registry.addRepo(repoRootOf(repo)) : (() => {
      try {
        return repoKeyOf([fs.realpathSync.native(repoRootOf(repo))]);
      } catch {
        return null;
      }
    })();
    if (!k) throw new RpcRefusal('NOT_FOUND', 'not-found', `no repo at ${repo}`);
    if (key !== undefined && key !== k) throw bad('repo and repoKey name different repos');
    key = k;
  }
  if (scope === 'repo' && key === undefined) throw bad('a repo loop names its repo (repo or repoKey)', { field: 'repo' });
  if (contentHash !== undefined && (typeof contentHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(contentHash))) throw bad('contentHash is sha256:<64 hex>', { field: 'contentHash' });
  return { loopId, scope, repoKey: key, contentHash: contentHash as string | undefined };
}

export class LoopTrust {
  readonly #o: LoopTrustOptions;
  /** open cards: loop key + hash → cardId (one card per version) */
  readonly #open = new Map<string, string>();

  constructor(o: LoopTrustOptions) {
    this.#o = o;
  }

  async request(asker: LoopAsker, kind: string, payload: unknown): Promise<unknown> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || !asker.principal) {
      throw new RpcRefusal('FORBIDDEN', 'matrix', `${kind} is the human's, on a gui or device connection`);
    }
    if (kind === 'request.loop.pause' || kind === 'request.loop.resume' || kind === 'request.loop.run') {
      // wire.ts routes these to #loop-runner; reaching here means no runner is wired
      throw new RpcRefusal('ENGINE', 'not-implemented', `${kind} is served by the loop runner, which is not wired`, { verb: kind });
    }
    if (!LOOP_REQUEST_KINDS.includes(kind)) throw bad(`unknown loop request ${kind.slice(0, 64)}`);
    const t = this.#target(kind, payload);
    if (kind === 'request.loop.trust') return this.#trust(asker, t);
    if (kind === 'request.loop.untrust') return this.#untrust(asker, t);
    return this.#delete(asker, t);
  }

  /**
   * Step 12 (§3.1, §10 D2; G-LOOP-03): an agent created or changed this loop. Raise its ONE `loop-trust` card (one
   * per version: a repeat finds the open card), requested by the agent and decided only by the human (root key,
   * fresh presence). It never trusts anything by itself; with no envelope (8.0) an agent loop always takes the card.
   */
  async raiseForAgent(asker: LoopAsker, key: string): Promise<unknown> {
    if (asker.principalClass !== 'agent' || !asker.principal) throw new RpcRefusal('FORBIDDEN', 'matrix', 'an agent-authored trust card is raised for an agent principal only');
    const e = this.#o.registry.entry(key);
    if (!e) throw new RpcRefusal('NOT_FOUND', 'not-found', `no loop ${key.split('/').pop()}`);
    return this.#trust(asker, { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: undefined }, asker.principal);
  }

  #target(kind: string, payload: unknown): LoopTarget {
    return parseLoopTarget(this.#o.registry, kind, payload, kind === 'request.loop.trust' ? ['contentHash'] : []);
  }

  #entry(t: LoopTarget): LoopEntry {
    this.#o.registry.scan();
    const e = this.#o.registry.find(t.loopId, t.scope, t.repoKey);
    if (!e) throw new RpcRefusal('NOT_FOUND', 'not-found', `no ${t.scope} loop ${t.loopId}${t.scope === 'repo' ? ' in that repo (is its .loop.json compiled? paradigm loop validate)' : ''}`);
    return e;
  }

  async #trust(asker: LoopAsker, t: LoopTarget, agent?: string): Promise<unknown> {
    const e = this.#entry(t);
    if (!e.compiled || !e.hash) throw bad(`loop ${t.loopId} is refused: ${e.errors.map((x) => `${x.code}: ${x.message}`).slice(0, 3).join('; ')}`, { field: 'loopId' });
    const h = e.hash;
    if (t.contentHash !== undefined && h.contentHash !== t.contentHash) throw bad(`loop ${t.loopId} changed since you looked (now ${short(h.contentHash)}): review it again`, { field: 'contentHash', current: h.contentHash });
    const state = this.#o.registry.stateOf(e);
    if (state.state === 'trusted') return { trusted: true, changed: false, contentHash: h.contentHash };
    const openKey = `${e.key}#${h.contentHash}`;
    const open = this.#open.get(openKey);
    if (open) {
      const c = this.#o.broker.card?.(open);
      if (!c || c.state === 'pending') return { pending: true, cardId: open };
      this.#open.delete(openKey); // decided or expired: a new card
    }
    const reg = this.#o.registry;
    const prior = reg.trustOf(e.key) ?? null;
    const lastTrusted = prior?.contentHash ?? [...reg.history()].reverse().find((x) => x.event === 'trusted' && loopKeyOf(x.scope, x.repoKey, x.loopId) === e.key)?.contentHash;
    const body = renderDefinition(e.compiled, h, (nodeId) => reg.calleeEnv(e.key, nodeId), envCardContext(e.repoRoot, this.#o.home));
    const base = lastTrusted ? reg.snapshots.read(lastTrusted) : null;
    // Aegis LP2 #1: a closure-only change (definition, argv and callees as trusted) takes a short re-render: just the
    // closure diff, still the root-class card with fresh presence
    const closureOnly = !!prior && prior.coreHash === h.coreHash && prior.contentHash !== h.contentHash;
    if (closureOnly) {
      const was = new Map((base?.closure ?? []).map((f) => [f.rel, f.sha256]));
      const now = new Map(h.closure.all.map((f) => [f.rel, f.sha256]));
      const changed = [...new Set([...was.keys(), ...now.keys()])].filter((k) => was.get(k) !== now.get(k)).sort();
      const lines = [
        `Accept the config change for loop ${e.loopId} (${e.scope} loop in ${e.repoRoot})`,
        `Content hash ${h.contentHash}; the definition, argv files and callees are the trusted ones (core ${short(h.coreHash)})`,
        'Only the config files its checks read changed. The loop stays paused until you allow this',
        ...(base ? changed.map((k) => `  ${k}: ${was.has(k) ? `sha256:${was.get(k)!.slice(0, 12)}` : 'new'} → ${now.has(k) ? `sha256:${now.get(k)!.slice(0, 12)}` : 'removed'}`) : [`  closure now: ${h.closure.all.map((f) => `${f.rel} sha256:${f.sha256.slice(0, 12)}`).join(', ')} (the trusted listing is not on this Mac)`]),
        'Allow needs Touch ID and the root key; deny or no answer keeps the loop paused',
      ].flatMap((l) => wrap(l));
      return this.#raise(asker, e, h, lines, body, prior, openKey, true, agent);
    }
    const lines = [
      `Trust loop ${e.loopId} (${e.scope} loop in ${e.repoRoot})`,
      `Content hash ${h.contentHash} (definition ${short(h.defHash)}, closure ${short(h.closure.digest)})`,
      'Trusting lets this exact version run unattended on its triggers; any change to it, its argv files or its config closure pauses it until you trust again',
      ...(e.callIssues.length ? [`Calls that cannot run now: ${e.callIssues.join('; ')}`] : []),
      ...body,
      ...(agent ? [`Claimed by agent key: ${agent.split('/').pop()}: an agent's loop runs only after you trust it here`] : []),
      ...(lastTrusted
        ? base
          ? [`Changes since the trusted version ${short(lastTrusted)}:`, ...diffLines(base.lines, body)]
          : [`Changed since the trusted version ${short(lastTrusted)} (its definition is not on this Mac to diff against)`]
        : ['First trust of this loop']),
      'Allow needs Touch ID and the root key; deny or no answer trusts nothing',
    ].flatMap((l) => wrap(l));
    return this.#raise(asker, e, h, lines, body, prior, openKey, false, agent);
  }

  async #raise(asker: LoopAsker, e: LoopEntry, h: LoopHash, lines: string[], body: string[], prior: { contentHash: string } | null, openKey: string, closureOnly: boolean, agent?: string): Promise<unknown> {
    const reg = this.#o.registry;
    const cardId = mintId('card');
    const row = {
      kind: 'loop.trusted',
      loopId: e.loopId,
      scope: e.scope,
      repoKey: e.repoKey,
      contentHash: h.contentHash,
      coreHash: h.coreHash,
      closureDigest: h.closure.digest,
      ...(e.compiled?.compiled.sourceHash ? { sourceHash: e.compiled.compiled.sourceHash } : {}),
      cardId,
      // step 12: an agent-raised card is still decided by the human with the root key; the agent only asked
      by: agent ? 'root' : asker.principal!,
      ...(agent ? { requestedBy: agent } : {}),
    };
    const key = e.key;
    const closure = h.closure.all;
    this.#open.set(openKey, cardId);
    const now = this.#o.clock ?? Date.now;
    try {
      const card = await this.#o.broker.raise({
        kind: 'loop-trust',
        cardId,
        requestedBy: asker.principal!,
        attended: true,
        detail: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, repo: e.repoRoot, loopHash: h.contentHash, lines: body, ...(closureOnly ? { closureOnly: true } : {}), ...(prior ? { previousHash: prior.contentHash } : {}), rootRows: [row] },
        lines,
        decisions: ['allow', 'deny'],
        handOnly: true,
        timeoutMs: LOOP_TRUST_CARD_TTL_MS,
        prepare: (decision: string) => {
          if (decision !== 'allow') return null;
          const release = beginRootDecision(this.#o.home);
          try {
            // the loop must still be the version the card shows (TOCTOU: checked again inside the one touch)
            const again = reg.verify(key);
            if (!again?.hash || again.hash.contentHash !== row.contentHash) throw bad(`loop ${row.loopId} changed while the card was open: trust the new version`, { field: 'contentHash' });
            const rows: Record<string, unknown>[] = [{ ...row, createdAt: new Date(now()).toISOString() }];
            return { rows, release };
          } catch (err) {
            release();
            throw err;
          }
        },
        effect: async (decision, ctx) => {
          this.#open.delete(openKey);
          if (decision !== 'allow') return;
          const signed = ctx.prepared?.rows[0];
          const rootSig = ctx.rowSigs?.[0];
          if (!signed || !rootSig) throw new Error('#loop-registry: a loop trust commits only its prepared, root-signed row');
          const { kind: _k, ...payload } = signed;
          await this.#o.append('loop.trusted', { ...payload, rootSig: { signer: rootSig.signer, sig: rootSig.sig } }, { connId: ctx.connId ?? asker.connId });
          try {
            reg.snapshots.write({ loopId: row.loopId, scope: row.scope, repoKey: row.repoKey, contentHash: row.contentHash, closure, lines: body });
          } catch {
            /* the next card cannot diff against this version; trust stands */
          }
        },
      });
      return { pending: true, cardId: card.cardId, contentHash: h.contentHash, ...(closureOnly ? { closureOnly: true } : {}), ...(prior ? { previousHash: prior.contentHash } : {}) };
    } catch (err) {
      this.#open.delete(openKey);
      throw err;
    }
  }

  async #untrust(asker: LoopAsker, t: LoopTarget): Promise<unknown> {
    const key = this.#keyOf(t);
    const trusted = this.#o.registry.trustOf(key);
    if (!trusted) return { untrusted: false, changed: false };
    const [, repoKey] = key.split('/');
    await this.#o.append('loop.untrusted', { loopId: t.loopId, scope: t.scope, repoKey: repoKey!, contentHash: trusted.contentHash, by: asker.principal! }, { connId: asker.connId });
    this.#o.onRevoke?.(key, 'untrusted');
    return { untrusted: true, changed: true, contentHash: trusted.contentHash };
  }

  async #delete(asker: LoopAsker, t: LoopTarget): Promise<unknown> {
    const key = this.#keyOf(t);
    const e = this.#o.registry.entry(key);
    const [, repoKey] = key.split('/');
    await this.#o.append('loop.deleted', { loopId: t.loopId, scope: t.scope, repoKey: repoKey!, ...(e?.hash ? { contentHash: e.hash.contentHash } : {}), by: asker.principal! }, { connId: asker.connId });
    this.#o.onRevoke?.(key, 'untrusted');
    let removedFile = false;
    if (t.scope === 'personal' && e && path.dirname(e.file) === this.#o.registry.personalDir) {
      try {
        if (fs.lstatSync(e.file).isFile()) {
          fs.unlinkSync(e.file);
          removedFile = true;
        }
      } catch {
        /* already gone */
      }
    }
    this.#o.registry.scan();
    return { deleted: true, removedFile };
  }

  /** The loop's key: from the scanned entry when present, else from the request (a gone file can still be untrusted). */
  #keyOf(t: LoopTarget): string {
    this.#o.registry.scan();
    const e = this.#o.registry.find(t.loopId, t.scope, t.repoKey);
    if (e) return e.key;
    if (t.repoKey) return loopKeyOf(t.scope, t.repoKey, t.loopId);
    throw new RpcRefusal('NOT_FOUND', 'not-found', `no ${t.scope} loop ${t.loopId}`);
  }
}
