/**
 * @symbol #local-config-request
 * @symbol $local-config-flow
 *
 * `gnomon local set|status|remove` (TD-2026-10-22-769): the raw form of Settings → Local model (the guided GUI is a
 * separate design track). Asks the RUNNING daemon of the home as this home's human device, over the same pinned
 * connection `gnomon strictness` makes (an unpinned server is refused and nothing is sent).
 *
 *   set     `log.append{kind:'request.local.config', payload:{op:'set', endpoint:{model, base?, compat?, id?, loops?},
 *           runner?}}`: the kernel checks it (loopback only in 8.0) and raises a root-class card you allow in Gnomon
 *           with your password and the root key. This command does not wait for it; the kernel applies the config
 *           without a restart once you allow it.
 *   status  status.local: the applied config, the default runner and a pending card.
 *   remove  `{op:'remove'}`: no card (removing narrows): the file is deleted and the lane has no local model at once.
 * Output: readout helpers only.
 */
import * as path from 'node:path';
import { RefusedError, refusalOf } from '@a-company/gnomon-contracts';
import { resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';
import { connectGnomon, ServerAuthError } from '../kernel/socket/index.js';
import { LOCAL_CONFIG_REQUEST } from '../kernel/local/config-request.js';
import { kernelPinOf } from './daemon-cli.js';
import { humanDeviceOf } from './rules-cli.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const LOCAL_EXIT_OK = 0;
export const LOCAL_EXIT_REFUSED = 1;
export const LOCAL_EXIT_USAGE = 64;

export const LOCAL_USAGE = `usage: gnomon local set --model <id> [--base <url>] [--compat <name>] [--id <name>] [--loops]
                       [--runner <abs dir>] [--home <abs>] [--json]
       gnomon local status [--home <abs>] [--json]
       gnomon local remove [--home <abs>] [--json]

  set     ask Gnomon to use a local model (Ollama, llama.cpp, LM Studio, vLLM or
          mlx-lm) for model: local sessions and, with --loops, for trusted loops.
          The endpoint is loopback only (default http://127.0.0.1:11434,
          compat ollama); LAN endpoints are not supported yet. The runner is the one that
          ships with Gnomon unless --runner names another absolute directory.
          This raises a card you allow in Gnomon with your password and the root
          key; once allowed it applies without a restart.
  status  show the applied local-model config and any card waiting for you.
  remove  stop using a local model (no card: removing narrows). Afterwards
          model: local sessions raise a fallback card, model: any sessions go
          to Claude, and loops with a model node refuse to start.

  The guided form is Settings → Local model in Gnomon.
`;

const VALUE_FLAGS = ['--model', '--base', '--compat', '--id', '--runner', '--home'];

export async function runLocalCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  let json = false;
  let loops = false;
  const flags: Record<string, string> = {};
  const words: string[] = [];
  const usage = (msg: string): number => {
    refused(io.stderr, 'BAD_REQUEST', 'usage', msg, ['gnomon local --help']);
    return LOCAL_EXIT_USAGE;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(`gnomon ${GNOMON_VERSION}\n${LOCAL_USAGE}`);
      return LOCAL_EXIT_OK;
    } else if (a === '--json') json = true;
    else if (a === '--loops') loops = true;
    else if (VALUE_FLAGS.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return usage(`${a} needs a value`);
      flags[a.slice(2)] = v;
    } else if (a.startsWith('-')) return usage(`unknown flag ${a}`);
    else words.push(a);
  }
  const [verb, ...rest] = words;
  if (verb !== 'set' && verb !== 'status' && verb !== 'remove') return usage('name a verb: set, status or remove');
  if (rest.length) return usage(`unexpected argument ${rest[0]}`);
  if (verb !== 'set' && (loops || Object.keys(flags).some((k) => k !== 'home'))) return usage(`${verb} takes only --home and --json`);
  if (verb === 'set' && !flags.model) return usage('--model is required (the model id the endpoint serves, e.g. qwen3.5:9b)');
  for (const k of ['home', 'runner']) if (flags[k] !== undefined && !path.isAbsolute(flags[k]!)) return usage(`--${k} takes an absolute path`);
  const home = path.resolve(flags.home ?? resolveGnomonHome());
  const sock = selectSocketPath({ home });
  if (!sock.ok) {
    refused(io.stderr, 'ENGINE', 'no-endpoint', `no safe endpoint path for ${home}`, []);
    return LOCAL_EXIT_REFUSED;
  }
  const device = humanDeviceOf(home);
  if (typeof device === 'string') {
    refused(io.stderr, 'FORBIDDEN', 'no-human-device', device, ['gnomon setup']);
    return LOCAL_EXIT_REFUSED;
  }
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  try {
    const probe = await connectGnomon({ socketPath: sock.path, client });
    await probe.conn.close();
    const found = kernelPinOf(home, probe.hello.serverKeyId);
    if (!found) {
      refused(io.stderr, 'FORBIDDEN', 'unverified-server', 'the key this server names is not registered in the home: nothing was sent to it', ['gnomon daemon status']);
      return LOCAL_EXIT_REFUSED;
    }
    const s = await connectGnomon({ socketPath: sock.path, client, serverKey: found.pin, device });
    try {
      if (verb === 'status') {
        const r = await s.conn.call('status', {});
        if ('error' in r) {
          const data = refusalOf(r);
          refused(io.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message, []);
          return LOCAL_EXIT_REFUSED;
        }
        const st = ((r.result ?? {}) as { local?: Record<string, unknown> }).local;
        if (!st) {
          refused(io.stderr, 'ENGINE', 'not-implemented', 'this kernel reports no local-model status (an older gnomond?)', ['gnomon daemon status']);
          return LOCAL_EXIT_REFUSED;
        }
        if (json) {
          io.stdout.write(`${JSON.stringify(st)}\n`);
          return LOCAL_EXIT_OK;
        }
        return printStatus(io.stdout, st);
      }
      const payload =
        verb === 'remove'
          ? { op: 'remove' }
          : {
              op: 'set',
              endpoint: { model: flags.model, ...(flags.base !== undefined ? { base: flags.base } : {}), ...(flags.compat !== undefined ? { compat: flags.compat } : {}), ...(flags.id !== undefined ? { id: flags.id } : {}), ...(loops ? { loops: true } : {}) },
              ...(flags.runner !== undefined ? { runner: flags.runner } : {}),
            };
      const r = await s.conn.call('log.append', { kind: LOCAL_CONFIG_REQUEST, payload });
      if ('error' in r) {
        const data = refusalOf(r);
        const reason = String(data?.data?.reason ?? 'refused');
        const next = data?.data?.why === 'helper-too-old' ? ['update the Gnomon app, then ask again'] : process.platform === 'win32' ? ['on Windows a root-class card cannot be allowed yet (the Windows root key is not built)'] : ['gnomon local --help'];
        refused(io.stderr, data?.code ?? 'ENGINE', reason, r.error.message, next);
        return LOCAL_EXIT_REFUSED;
      }
      const res = (r.result ?? {}) as Record<string, unknown>;
      if (json) {
        io.stdout.write(`${JSON.stringify(res)}\n`);
        return LOCAL_EXIT_OK;
      }
      if (verb === 'remove') {
        heading(io.stdout, 'local', res.existed === true ? 'local model removed' : 'no local model was set');
        // Aegis L9: what changes for sessions as well as loops
        readout(io.stdout, [['now', 'model: local sessions raise a fallback card; model: any sessions go to Claude; loops with a model node refuse to start'], ['undo', 'gnomon local set --model <id> (a new card; the removed config never applies again)']]);
        return LOCAL_EXIT_OK;
      }
      const runner = (res.runner ?? {}) as Record<string, unknown>;
      heading(io.stdout, 'local', `endpoint ${String(res.endpoint)} waits on your approval`);
      readout(io.stdout, [
        ['card', String(res.cardId)],
        ['version', res.previous === null || res.previous === undefined ? `${String(res.version)} (first config)` : `${String(res.version)} (replaces ${String(res.previous)})`],
        ['runner', `${String(runner.dir)} (${String(runner.source)}, tree ${String(runner.treeSha256).slice(0, 12)}…)`],
        ['next', process.platform === 'win32' ? 'on Windows this card cannot be allowed yet: a root-class decision needs the Windows root key (not built)' : 'allow it in Gnomon with your password and the root key; deny or no answer changes nothing'],
      ]);
      return LOCAL_EXIT_OK;
    } finally {
      await s.conn.close();
    }
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      refused(io.stderr, err instanceof RefusedError ? err.refusal.code : 'FORBIDDEN', err instanceof RefusedError ? String(err.refusal.data?.reason ?? 'refused') : 'server-auth', err.message, []);
      return LOCAL_EXIT_REFUSED;
    }
    refused(io.stderr, 'ENGINE', 'not-running', `no daemon answers on ${home}: ${(err as Error).message}`, ['gnomon up (or open Gnomon), then retry']);
    return LOCAL_EXIT_REFUSED;
  }
}

/** status.local as readout rows. */
export function printStatus(out: Out, st: Record<string, unknown>): number {
  const eps = Array.isArray(st.endpoints) ? (st.endpoints as Array<Record<string, unknown>>) : [];
  const runner = st.runner as Record<string, unknown> | null | undefined;
  const d = (st.defaultRunner ?? {}) as Record<string, unknown>;
  heading(out, 'local', st.configured === true ? `version ${String(st.version)} applied` : 'no local model is set');
  readout(out, [
    ...eps.map((e): [string, string] => ['endpoint', `${String(e.id)} ${String(e.base)} model ${String(e.model)} (${String(e.compat)})${e.loops === true ? ', trusted loops may use it' : ''}`]),
    ...(runner ? ([['runner', `${String(runner.dir)} (tree ${String(runner.treeSha256).slice(0, 12)}…)`]] as Array<[string, string]>) : []),
    ['default runner', d.source ? `${String(d.dir)} (${String(d.source)})` : `none: ${String(d.why ?? 'unknown')}`],
    ...(st.pendingCardId ? ([['pending', `card ${String(st.pendingCardId)} waits on your approval`]] as Array<[string, string]>) : []),
    ['endpoints', 'loopback only; LAN endpoints are not supported yet'],
    ...(st.configured === true ? [] : ([['next', 'gnomon local set --model <id> (or Settings → Local model in Gnomon)']] as Array<[string, string]>)),
  ]);
  return LOCAL_EXIT_OK;
}
