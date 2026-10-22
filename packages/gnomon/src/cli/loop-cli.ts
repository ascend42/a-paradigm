/**
 * @symbol #loop-registry
 *
 * `gnomon loop list | show <id> | trust <id> | untrust <id> | trust-status [--personal] [--repo <abs>] [--all]
 * [--home <abs>] [--json]` (docs/specs/gnomon-loops.md §5 CLI; build plan LP2). Asks the RUNNING daemon of the home
 * as this home's human device (the same pinned connection as `gnomon mode`):
 *
 *   list          status.loops: every loop of this repo (the current folder, or --repo; --all for every repo and
 *                 the personal loops) with its state, content hash and who trusted it
 *   show <id>     the kernel's state and hash, then the definition as the trust card renders it (rendered here from
 *                 the same compiled file; the kernel's hash is the one a trust names)
 *   trust <id>    `log.append{kind:'request.loop.trust', payload:{loopId, scope, repo, contentHash}}` with the hash the
 *                 kernel shows now (no hash when the kernel has not seen the repo yet: the card itself shows it); raises a signed loop-trust card you allow in Gnomon with Touch ID (this command
 *                 does not wait for it)
 *   untrust <id>  `request.loop.untrust`: a tightening, applied at once with no presence
 *   trust-status  who trusted (or revoked, or deleted) which hash and when
 *
 * Output: readout helpers only.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { RefusedError, refusalOf } from '@a-company/gnomon-contracts';
import { resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';
import { connectGnomon, ServerAuthError } from '../kernel/socket/index.js';
import { LoopRegistry, repoRootOf, type LoopView, type TrustEvent } from '../kernel/loops/registry.js';
import { renderDefinition } from '../kernel/loops/trust.js';
import { kernelPinOf } from './daemon-cli.js';
import { humanDeviceOf } from './rules-cli.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const LOOP_EXIT_OK = 0;
export const LOOP_EXIT_REFUSED = 1;
export const LOOP_EXIT_USAGE = 64;

export const LOOP_USAGE = `usage: gnomon loop list | show <id> | trust <id> | untrust <id> | trust-status
                   [--personal] [--repo <abs path>] [--all] [--home <abs>] [--json]

  Loops are recurring checks and fix loops for your flows. Nothing runs until you
  trust a loop's exact content; any change to it, the scripts it runs or the
  config it reads pauses it until you trust it again.

    list          the loops of this repo (--all: every repo and your personal loops)
    show <id>     a loop's state and its full definition, as the trust card shows it
    trust <id>    raise the trust card; allow it in Gnomon with Touch ID
    untrust <id>  revoke trust now (no Touch ID: it only tightens)
    trust-status  who trusted which version, and when

  A repo loop is found in the current folder's repo (or --repo); --personal names
  a loop in ~/.gnomon/loops.
`;

type Verb = 'list' | 'show' | 'trust' | 'untrust' | 'trust-status';
const VERBS: readonly Verb[] = ['list', 'show', 'trust', 'untrust', 'trust-status'];

export async function runLoopCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }, cwd: string = process.cwd()): Promise<number> {
  let verb: Verb | undefined;
  let id: string | undefined;
  let repo: string | undefined;
  let home: string | undefined;
  let json = false;
  let all = false;
  let personal = false;
  const usage = (msg: string): number => {
    refused(io.stderr, 'BAD_REQUEST', 'usage', msg, ['gnomon loop --help']);
    return LOOP_EXIT_USAGE;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(`gnomon ${GNOMON_VERSION}\n${LOOP_USAGE}`);
      return LOOP_EXIT_OK;
    } else if (a === '--json') json = true;
    else if (a === '--all') all = true;
    else if (a === '--personal') personal = true;
    else if (a === '--repo') {
      const r = argv[++i];
      if (r === undefined || !path.isAbsolute(r)) return usage('--repo takes an absolute path');
      repo = r;
    } else if (a === '--home') {
      const h = argv[++i];
      if (h === undefined || !path.isAbsolute(h)) return usage('--home takes an absolute path');
      home = h;
    } else if (!a.startsWith('-') && verb === undefined) {
      if (!(VERBS as readonly string[]).includes(a)) return usage(`unknown verb ${a}: one of ${VERBS.join(', ')}`);
      verb = a as Verb;
    } else if (!a.startsWith('-') && id === undefined && (verb === 'show' || verb === 'trust' || verb === 'untrust')) id = a;
    else return usage(`unknown argument ${a}`);
  }
  if (verb === undefined) return usage('name a verb: list, show, trust, untrust or trust-status');
  if ((verb === 'show' || verb === 'trust' || verb === 'untrust') && id === undefined) return usage(`gnomon loop ${verb} takes a loop id`);
  if (personal && repo !== undefined) return usage('--personal and --repo name different scopes: give one');
  home = path.resolve(home ?? resolveGnomonHome());
  const root = repoRootOf(repo ?? cwd);
  const sock = selectSocketPath({ home });
  if (!sock.ok) {
    refused(io.stderr, 'ENGINE', 'no-endpoint', `no safe endpoint path for ${home}`, []);
    return LOOP_EXIT_REFUSED;
  }
  const device = humanDeviceOf(home);
  if (typeof device === 'string') {
    refused(io.stderr, 'FORBIDDEN', 'no-human-device', device, ['gnomon setup']);
    return LOOP_EXIT_REFUSED;
  }
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  try {
    const probe = await connectGnomon({ socketPath: sock.path, client });
    await probe.conn.close();
    const found = kernelPinOf(home, probe.hello.serverKeyId);
    if (!found) {
      refused(io.stderr, 'FORBIDDEN', 'unverified-server', 'the key this server names is not registered in the home: nothing was sent to it', ['gnomon daemon status']);
      return LOOP_EXIT_REFUSED;
    }
    const s = await connectGnomon({ socketPath: sock.path, client, serverKey: found.pin, device });
    try {
      const call = async (method: string, params: unknown): Promise<Record<string, unknown> | null> => {
        const r = await s.conn.call(method, params);
        if ('error' in r) {
          const data = refusalOf(r);
          refused(io.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message, []);
          return null;
        }
        return (r.result ?? {}) as Record<string, unknown>;
      };
      const status = async (): Promise<{ loops: LoopView[]; trustStatus: TrustEvent[]; waitingTrust: number } | null> => {
        const st = await call('status', {});
        if (!st) return null;
        const l = st.loops as { loops?: LoopView[]; trustStatus?: TrustEvent[]; waitingTrust?: { n?: number } } | undefined;
        if (!l) {
          refused(io.stderr, 'ENGINE', 'not-implemented', 'this kernel reports no loops (an older gnomond?)', ['gnomon daemon status']);
          return null;
        }
        return { loops: l.loops ?? [], trustStatus: l.trustStatus ?? [], waitingTrust: l.waitingTrust?.n ?? 0 };
      };
      const scope = personal ? 'personal' : 'repo';
      const mine = (v: LoopView): boolean => all || (personal ? v.scope === 'personal' : v.scope === 'repo' && samePath(v.repo, root));
      const st = await status();
      if (!st) return LOOP_EXIT_REFUSED;
      const unseen = !personal && !all && !st.loops.some((v) => v.scope === 'repo' && samePath(v.repo, root)) && hasLoopsDir(root);
      const unseenNote = (): void => readout(io.stdout, [['note', `the kernel has not seen ${root} yet (it learns a repo from a session opened there or a trust request naming it): gnomon loop trust <id> raises the card anyway`]]);
      if (verb === 'list') {
        const rows = st.loops.filter(mine);
        if (json) {
          io.stdout.write(`${JSON.stringify(rows)}\n`);
          return LOOP_EXIT_OK;
        }
        heading(io.stdout, 'loops', `${rows.length} loop(s)${all ? '' : personal ? ' (personal)' : ` in ${root}`} · ${st.waitingTrust} change(s) waiting for trust`);
        for (const v of rows) readout(io.stdout, viewRows(v));
        if (unseen) unseenNote();
        return LOOP_EXIT_OK;
      }
      if (verb === 'trust-status') {
        const rows = st.trustStatus.filter((e) => all || (personal ? e.scope === 'personal' : st!.loops.some((v) => v.loopId === e.loopId && v.repoKey === e.repoKey && mine(v))));
        if (json) {
          io.stdout.write(`${JSON.stringify(rows)}\n`);
          return LOOP_EXIT_OK;
        }
        heading(io.stdout, 'loop trust', `${rows.length} event(s)`);
        for (const e of rows) readout(io.stdout, [['loop', `${e.scope}/${e.loopId}`], ['event', e.event], ['hash', e.contentHash ?? '—'], ['by', e.by ?? '—'], ['when', e.at ?? '—'], ...(e.cardId ? ([['card', e.cardId]] as Array<[string, string]>) : [])]);
        return LOOP_EXIT_OK;
      }
      const v = st.loops.find((x) => x.loopId === id && x.scope === scope && mine(x));
      if (!v && verb === 'show' && unseen) {
        unseenNote();
        return LOOP_EXIT_REFUSED;
      }
      if (!v && verb !== 'untrust' && !(verb === 'trust' && unseen)) {
        refused(io.stderr, 'NOT_FOUND', 'not-found', `no ${scope} loop ${id}${personal ? '' : ` in ${root}`}`, ['gnomon loop list', 'paradigm loop validate (compiles .paradigm/loops/<id>.yaml)']);
        return LOOP_EXIT_REFUSED;
      }
      if (verb === 'show') {
        const local = renderLocal(home, v!);
        if (json) {
          io.stdout.write(`${JSON.stringify({ ...v, lines: local })}\n`);
          return LOOP_EXIT_OK;
        }
        heading(io.stdout, 'loop', `${v!.scope}/${v!.loopId}: ${v!.state}${v!.reason ? ` (${v!.reason})` : ''}`);
        readout(io.stdout, viewRows(v!));
        for (const l of local) io.stdout.write(`  ${l}\n`);
        return LOOP_EXIT_OK;
      }
      const payload = { loopId: id!, scope, ...(personal ? {} : { repo: root }), ...(verb === 'trust' && v?.contentHash ? { contentHash: v.contentHash } : {}) };
      const res = await call('log.append', { kind: verb === 'trust' ? 'request.loop.trust' : 'request.loop.untrust', payload });
      if (!res) return LOOP_EXIT_REFUSED;
      if (json) {
        io.stdout.write(`${JSON.stringify(res)}\n`);
        return LOOP_EXIT_OK;
      }
      if (verb === 'trust') {
        if (res.pending === true) {
          heading(io.stdout, 'loop', `${scope}/${id}: trust waits on your Touch ID`);
          readout(io.stdout, [['card', String(res.cardId)], ['kind', 'loop-trust (root-signed)'], ['hash', String(res.contentHash ?? v?.contentHash ?? '—')], ['next', 'review the card in Gnomon and allow it with Touch ID; deny or no answer trusts nothing']]);
        } else heading(io.stdout, 'loop', `${scope}/${id}: already trusted at ${String(res.contentHash)}`);
      } else {
        heading(io.stdout, 'loop', res.untrusted === true ? `${scope}/${id}: trust revoked (loop.untrusted, no presence: tightening)` : `${scope}/${id}: was not trusted`);
      }
      return LOOP_EXIT_OK;
    } finally {
      await s.conn.close();
    }
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      refused(io.stderr, err instanceof RefusedError ? err.refusal.code : 'FORBIDDEN', err instanceof RefusedError ? String(err.refusal.data?.reason ?? 'refused') : 'server-auth', err.message, []);
      return LOOP_EXIT_REFUSED;
    }
    refused(io.stderr, 'ENGINE', 'not-running', `no daemon answers on ${home}: ${(err as Error).message}`, ['gnomond --home <abs> (or gnomon up), then retry']);
    return LOOP_EXIT_REFUSED;
  }
}

function samePath(a: string, b: string): boolean {
  const real = (p: string): string => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

function hasLoopsDir(root: string): boolean {
  try {
    return fs.lstatSync(path.join(root, '.paradigm', 'loops')).isDirectory();
  } catch {
    return false;
  }
}

function viewRows(v: LoopView): Array<[string, string]> {
  return [
    ['loop', `${v.scope}/${v.loopId}${v.title ? ` — ${v.title}` : ''}`],
    ['state', `${v.state}${v.reason ? ` (${v.reason})` : ''}`],
    ['hash', v.contentHash ?? '—'],
    ...(v.trustedHash ? ([['trusted', `${v.trustedHash}${v.trustedBy ? ` by ${v.trustedBy}` : ''}${v.trustedAt ? ` at ${v.trustedAt}` : ''}`]] as Array<[string, string]>) : []),
    ...(v.errors.length ? ([['refused', v.errors.slice(0, 3).join('; ')]] as Array<[string, string]>) : []),
    ...(v.callIssues.length ? ([['calls', v.callIssues.join('; ')]] as Array<[string, string]>) : []),
    ['file', v.file],
  ];
}

/** The definition as the trust card renders it, computed here from the same file (no rows are written). */
function renderLocal(home: string, v: LoopView): string[] {
  const reg = new LoopRegistry({ home, kernelPrincipal: 'p:local/none', append: async () => undefined, watch: false, rescanMs: 0 });
  if (v.scope === 'repo') reg.addRepo(v.repo);
  reg.scan();
  const e = reg.find(v.loopId, v.scope, v.repoKey);
  reg.close();
  if (!e?.compiled || !e.hash) return [`(the definition cannot be rendered here: ${v.errors[0] ?? 'refused'})`];
  return renderDefinition(e.compiled, e.hash);
}
