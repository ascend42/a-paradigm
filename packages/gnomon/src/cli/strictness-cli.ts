/**
 * @symbol #strictness-cli
 *
 * `gnomon strictness show [<repo>]` and `gnomon strictness set <repo> <L0|L1|L2|L3>` (spec §3.4 "Strictness and run
 * modes", M2.11-lite; build plan step 9). Asks the RUNNING daemon of the home as this home's human device, the same
 * pinned connection `gnomon mode` makes (the hello's key id is pinned from the home; an unpinned server is refused and
 * nothing is sent).
 *
 *   show   prints status.strictness: the default and every repo with a level (one repo when named).
 *   set    `log.append{kind:'request.strictness.set', payload:{repo, to}}`. A higher level (tightening) applies
 *          at once with no presence and pauses the repo's running loops; a lower one (one level per step) raises a
 *          signed `strictness` card the human allows in Gnomon with Touch ID (this command does not wait for it).
 * `<repo>` is a folder (absolute, or relative to the current folder) or a repo key (`sha256:…`). Output: readout
 * helpers only.
 */
import * as path from 'node:path';
import { RefusedError, refusalOf, STRICTNESS_LEVELS } from '@a-company/gnomon-contracts';
import { resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';
import { connectGnomon, ServerAuthError } from '../kernel/socket/index.js';
import { repoKeyOf } from '../kernel/supervisor/repo-hooks.js';
import { kernelPinOf } from './daemon-cli.js';
import { humanDeviceOf } from './rules-cli.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const STRICTNESS_EXIT_OK = 0;
export const STRICTNESS_EXIT_REFUSED = 1;
export const STRICTNESS_EXIT_USAGE = 64;

export const STRICTNESS_USAGE = `usage: gnomon strictness show [<repo>] [--home <abs>] [--json]
       gnomon strictness set <repo> <L0|L1|L2|L3> [--home <abs>] [--json]

  Strictness levels take autonomy away from agents and loops in one repo:
    L0  as declared (the default)
    L1  at most 2 loops at once; gate-class and high-risk loop lands only propose
    L2  loops propose and land nothing alone; sessions take the ask ceiling
    L3  no loop runs; sessions are manual

  A higher level applies at once and pauses the repo's running loops. A lower
  level goes one step at a time and raises a card you allow in Gnomon with
  Touch ID. <repo> is a folder (absolute or relative) or a repo key (sha256:…).
`;

const REPO_KEY = /^sha256:[0-9a-f]{64}$/;

/** A repo argument as the request names it: a repo key as is, a folder as its absolute path. */
export function repoArg(a: string, cwd: string): { repo: string } {
  return { repo: REPO_KEY.test(a) ? a : path.resolve(cwd, a) };
}

export async function runStrictnessCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }, cwd: string = process.cwd()): Promise<number> {
  let home: string | undefined;
  let json = false;
  const words: string[] = [];
  const usage = (msg: string): number => {
    refused(io.stderr, 'BAD_REQUEST', 'usage', msg, ['gnomon strictness --help']);
    return STRICTNESS_EXIT_USAGE;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(`gnomon ${GNOMON_VERSION}\n${STRICTNESS_USAGE}`);
      return STRICTNESS_EXIT_OK;
    } else if (a === '--json') json = true;
    else if (a === '--home') {
      const h = argv[++i];
      if (h === undefined || !path.isAbsolute(h)) return usage('--home takes an absolute path');
      home = h;
    } else if (a.startsWith('-')) return usage(`unknown flag ${a}`);
    else words.push(a);
  }
  const [verb, ...rest] = words;
  if (verb !== 'show' && verb !== 'set') return usage('name a verb: show or set');
  if (verb === 'show' && rest.length > 1) return usage('show takes at most one repo');
  if (verb === 'set') {
    if (rest.length !== 2) return usage('set takes a repo and a level: gnomon strictness set <repo> <L0|L1|L2|L3>');
    if (!(STRICTNESS_LEVELS as readonly string[]).includes(rest[1]!)) return usage(`unknown level ${rest[1]}: one of ${STRICTNESS_LEVELS.join(', ')}`);
  }
  home = path.resolve(home ?? resolveGnomonHome());
  const sock = selectSocketPath({ home });
  if (!sock.ok) {
    refused(io.stderr, 'ENGINE', 'no-endpoint', `no safe endpoint path for ${home}`, []);
    return STRICTNESS_EXIT_REFUSED;
  }
  const device = humanDeviceOf(home);
  if (typeof device === 'string') {
    refused(io.stderr, 'FORBIDDEN', 'no-human-device', device, ['gnomon setup']);
    return STRICTNESS_EXIT_REFUSED;
  }
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  try {
    const probe = await connectGnomon({ socketPath: sock.path, client });
    await probe.conn.close();
    const found = kernelPinOf(home, probe.hello.serverKeyId);
    if (!found) {
      refused(io.stderr, 'FORBIDDEN', 'unverified-server', 'the key this server names is not registered in the home: nothing was sent to it', ['gnomon daemon status']);
      return STRICTNESS_EXIT_REFUSED;
    }
    const s = await connectGnomon({ socketPath: sock.path, client, serverKey: found.pin, device });
    try {
      if (verb === 'show') {
        const r = await s.conn.call('status', {});
        if ('error' in r) {
          const data = refusalOf(r);
          refused(io.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message, []);
          return STRICTNESS_EXIT_REFUSED;
        }
        const st = ((r.result ?? {}) as { strictness?: Record<string, unknown> }).strictness;
        if (!st) {
          refused(io.stderr, 'ENGINE', 'not-implemented', 'this kernel reports no strictness levels (an older gnomond?)', ['gnomon daemon status']);
          return STRICTNESS_EXIT_REFUSED;
        }
        const repos = Array.isArray(st.repos) ? (st.repos as Array<Record<string, unknown>>) : [];
        const want = rest[0] !== undefined ? repoArg(rest[0], cwd) : null;
        const key = want ? (REPO_KEY.test(want.repo) ? want.repo : repoKeyOf([want.repo])) : null;
        const shown = key ? [repos.find((x) => x.repoKey === key) ?? { repoKey: key, level: String(st.default ?? 'L0'), default: true }] : repos;
        if (json) {
          io.stdout.write(`${JSON.stringify(key ? { ...st, repos: shown } : st)}\n`);
          return STRICTNESS_EXIT_OK;
        }
        heading(io.stdout, 'strictness', key ? `repo ${want ? want.repo : key}` : `${repos.length} repo(s) with a level set`);
        readout(io.stdout, [['default', String(st.default ?? 'L0')]]);
        for (const x of shown) {
          readout(io.stdout, [
            ['repo', String(x.repoKey)],
            ['level', `${String(x.level)}${x.default ? ' (default)' : ''}`],
            ...(x.pendingCardId ? ([['pending', `loosening to ${String(x.pendingTo)}: card ${String(x.pendingCardId)}`]] as Array<[string, string]>) : []),
          ]);
        }
        return STRICTNESS_EXIT_OK;
      }
      const target = repoArg(rest[0]!, cwd);
      const payload = { repo: target.repo, to: rest[1] };
      const r = await s.conn.call('log.append', { kind: 'request.strictness.set', payload });
      if ('error' in r) {
        const data = refusalOf(r);
        refused(io.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message, ['gnomon strictness show']);
        return STRICTNESS_EXIT_REFUSED;
      }
      const res = (r.result ?? {}) as Record<string, unknown>;
      if (json) {
        io.stdout.write(`${JSON.stringify(res)}\n`);
        return STRICTNESS_EXIT_OK;
      }
      const where = `repo ${target.repo}`;
      if (res.pending === true) {
        heading(io.stdout, 'strictness', `${where}: ${String(res.from)} → ${String(res.to)} waits on your Touch ID`);
        readout(io.stdout, [['card', String(res.cardId)], ['kind', 'strictness (signed)'], ['next', 'allow it in Gnomon with Touch ID; deny or no answer keeps the current level']]);
      } else if (res.changed === true) {
        heading(io.stdout, 'strictness', `${where}: ${String(res.from)} → ${String(res.to)}`);
        readout(io.stdout, [['logged', 'approval.strictness.raised (kernel-signed, no presence: tightening)'], ['loops', 'running loops in this repo are paused']]);
      } else {
        heading(io.stdout, 'strictness', `${where}: already ${String(res.level)}`);
      }
      return STRICTNESS_EXIT_OK;
    } finally {
      await s.conn.close();
    }
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      refused(io.stderr, err instanceof RefusedError ? err.refusal.code : 'FORBIDDEN', err instanceof RefusedError ? String(err.refusal.data?.reason ?? 'refused') : 'server-auth', err.message, []);
      return STRICTNESS_EXIT_REFUSED;
    }
    refused(io.stderr, 'ENGINE', 'not-running', `no daemon answers on ${home}: ${(err as Error).message}`, ['gnomond --home <abs> (or gnomon up), then retry']);
    return STRICTNESS_EXIT_REFUSED;
  }
}
