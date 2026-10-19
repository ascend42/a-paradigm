/**
 * @symbol #mode-cli
 *
 * `gnomon mode [manual|ask|auto-edits] [--session <hsid>] [--repo [<abs>]] [--home <abs>] [--json]`
 * (spec §3.4 "Run modes (D87)", §11.4). Asks the RUNNING daemon of the home as
 * this home's human device — the same connection `gnomon rules revoke` makes:
 * the hello's key id is pinned from the home (root-signed registry, else
 * kernel-pub.jsonl — never from the server; an unpinned server is refused and
 * nothing is sent), then auth as device.key + its root-signed human row.
 *
 *   no mode     prints status.runModes: the default, whether strictness is
 *               built, every repo with a mode set and every live session's
 *               chosen / ceiling / effective mode.
 *   <mode>      `log.append{kind:'request.mode.set', payload:{to, hsid | repo}}`.
 *               Scope: `--session <hsid>` for one session; otherwise the repo
 *               (`--repo <abs>`, default the current folder). Tightening
 *               applies at once with no presence; loosening raises a signed
 *               `strictness` card the human allows in Gnomon with Touch ID
 *               (this command does not wait for it, like `gnomon daemon stop`).
 * The kernel's refusals (BAD_REQUEST, NOT_FOUND, FORBIDDEN{strictness-mode})
 * are printed as they come. Output: readout helpers only.
 */
import * as path from 'node:path';
import { RefusedError, refusalOf, RUN_MODES } from '@a-company/gnomon-contracts';
import { resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';
import { connectGnomon, ServerAuthError } from '../kernel/socket/index.js';
import { kernelPinOf } from './daemon-cli.js';
import { humanDeviceOf } from './rules-cli.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const MODE_EXIT_OK = 0;
export const MODE_EXIT_REFUSED = 1;
export const MODE_EXIT_USAGE = 64;

export const MODE_USAGE = `usage: gnomon mode [manual|ask|auto-edits] [--session <hsid>] [--repo [<abs path>]] [--home <abs>] [--json]

  Run modes (like Claude Code's permission modes, with no bypass mode):
    manual      writes and commands wait on an approved plan
    ask         every write and command raises a card (the default)
    auto-edits  file edits inside the session's own folder pass with no card
                (each logged approval.auto); Bash, network, edits outside the
                folder and gate-class paths (.claude, CLAUDE*.md, .git,
                package.json, lockfiles, test config, CI) still ask

  With no mode: show the modes of every repo and live session.
  With a mode: set it for one session (--session) or for a repo (--repo,
  default the current folder). A stricter mode applies at once; a looser one
  raises a card you allow in Gnomon with Touch ID.
`;

export async function runModeCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }, cwd: string = process.cwd()): Promise<number> {
  let to: string | undefined;
  let hsid: string | undefined;
  let repo: string | undefined;
  let home: string | undefined;
  let json = false;
  const usage = (msg: string): number => {
    refused(io.stderr, 'BAD_REQUEST', 'usage', msg, ['gnomon mode --help']);
    return MODE_EXIT_USAGE;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(`gnomon ${GNOMON_VERSION}\n${MODE_USAGE}`);
      return MODE_EXIT_OK;
    } else if (a === '--json') json = true;
    else if (a === '--session') {
      const h = argv[++i];
      if (h === undefined || h.startsWith('-')) return usage('--session takes a session id (hsid)');
      hsid = h;
    } else if (a === '--repo') {
      const r = argv[i + 1];
      if (r !== undefined && !r.startsWith('-') && path.isAbsolute(r)) {
        repo = r;
        i++;
      } else repo = cwd;
    } else if (a === '--home') {
      const h = argv[++i];
      if (h === undefined || !path.isAbsolute(h)) return usage('--home takes an absolute path');
      home = h;
    } else if (!a.startsWith('-') && to === undefined) to = a;
    else return usage(`unknown argument ${a}`);
  }
  if (to !== undefined && !(RUN_MODES as readonly string[]).includes(to)) return usage(`unknown mode ${to}: one of ${RUN_MODES.join(', ')}`);
  if (to === undefined && (hsid !== undefined || repo !== undefined)) return usage('name the mode to set (manual, ask or auto-edits)');
  if (hsid !== undefined && repo !== undefined) return usage('--session and --repo name different scopes: give one');
  home = path.resolve(home ?? resolveGnomonHome());
  const sock = selectSocketPath({ home });
  if (!sock.ok) {
    refused(io.stderr, 'ENGINE', 'no-endpoint', `no safe endpoint path for ${home}`, []);
    return MODE_EXIT_REFUSED;
  }
  const device = humanDeviceOf(home);
  if (typeof device === 'string') {
    refused(io.stderr, 'FORBIDDEN', 'no-human-device', device, ['gnomon setup']);
    return MODE_EXIT_REFUSED;
  }
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  try {
    const probe = await connectGnomon({ socketPath: sock.path, client });
    await probe.conn.close();
    const found = kernelPinOf(home, probe.hello.serverKeyId);
    if (!found) {
      refused(io.stderr, 'FORBIDDEN', 'unverified-server', 'the key this server names is not registered in the home: nothing was sent to it', ['gnomon daemon status']);
      return MODE_EXIT_REFUSED;
    }
    const s = await connectGnomon({ socketPath: sock.path, client, serverKey: found.pin, device });
    try {
      if (to === undefined) {
        const r = await s.conn.call('status', {});
        if ('error' in r) {
          const data = refusalOf(r);
          refused(io.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message, []);
          return MODE_EXIT_REFUSED;
        }
        const rm = ((r.result ?? {}) as { runModes?: Record<string, unknown> }).runModes;
        if (!rm) {
          refused(io.stderr, 'ENGINE', 'not-implemented', 'this kernel reports no run modes (an older gnomond?)', ['gnomon daemon status']);
          return MODE_EXIT_REFUSED;
        }
        if (json) {
          io.stdout.write(`${JSON.stringify(rm)}\n`);
          return MODE_EXIT_OK;
        }
        printStatus(io.stdout, rm);
        return MODE_EXIT_OK;
      }
      const payload = { to, ...(hsid ? { hsid } : { repo: path.resolve(repo ?? cwd) }) };
      const r = await s.conn.call('log.append', { kind: 'request.mode.set', payload });
      if ('error' in r) {
        const data = refusalOf(r);
        const reason = String(data?.data?.reason ?? 'refused');
        refused(io.stderr, data?.code ?? 'ENGINE', reason, r.error.message, reason === 'strictness-mode' ? ['gnomon mode (shows each ceiling)'] : data?.code === 'NOT_FOUND' ? ['gnomon mode (lists live sessions)'] : []);
        return MODE_EXIT_REFUSED;
      }
      const res = (r.result ?? {}) as Record<string, unknown>;
      if (json) {
        io.stdout.write(`${JSON.stringify(res)}\n`);
        return MODE_EXIT_OK;
      }
      const where = hsid ? `session ${hsid}` : `repo ${path.resolve(repo ?? cwd)}`;
      if (res.pending === true) {
        heading(io.stdout, 'mode', `${where}: ${String(res.from)} → ${String(res.to)} waits on your Touch ID`);
        readout(io.stdout, [['card', String(res.cardId)], ['kind', 'strictness (signed)'], ['next', 'allow it in Gnomon with Touch ID; deny or no answer keeps the current mode']]);
      } else if (res.changed === true) {
        heading(io.stdout, 'mode', `${where}: ${String(res.from)} → ${String(res.to)}`);
        readout(io.stdout, [['effective', String(res.effective)], ['logged', 'approval.mode.set (kernel-signed, no presence: tightening)']]);
      } else {
        heading(io.stdout, 'mode', `${where}: already ${String(res.mode)}`);
        readout(io.stdout, [['effective', String(res.effective)]]);
      }
      return MODE_EXIT_OK;
    } finally {
      await s.conn.close();
    }
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      refused(io.stderr, err instanceof RefusedError ? err.refusal.code : 'FORBIDDEN', err instanceof RefusedError ? String(err.refusal.data?.reason ?? 'refused') : 'server-auth', err.message, []);
      return MODE_EXIT_REFUSED;
    }
    refused(io.stderr, 'ENGINE', 'not-running', `no daemon answers on ${home}: ${(err as Error).message}`, ['gnomond --home <abs> (or gnomon up), then retry']);
    return MODE_EXIT_REFUSED;
  }
}

function printStatus(out: Out, rm: Record<string, unknown>): void {
  const st = (rm.strictness ?? {}) as { built?: unknown; note?: unknown };
  const sessions = Array.isArray(rm.sessions) ? (rm.sessions as Array<Record<string, unknown>>) : [];
  const repos = Array.isArray(rm.repos) ? (rm.repos as Array<Record<string, unknown>>) : [];
  heading(out, 'modes', `${sessions.length} live session(s) · ${repos.length} repo(s) with a mode set`);
  readout(out, [['default', String(rm.default ?? 'ask')], ['strictness', st.built === true ? 'built' : String(st.note ?? 'not built')]]);
  for (const r of repos) readout(out, [['repo', String(r.repo)], ['mode', String(r.mode)], ['ceiling', String(r.ceiling)], ['effective', String(r.effective)]]);
  for (const x of sessions) {
    readout(out, [
      ['session', String(x.hsid)],
      ['cwd', String(x.cwd)],
      ['chosen', `${String(x.chosen)} (${String(x.source)})`],
      ['ceiling', String(x.ceiling)],
      ['effective', String(x.effective)],
      ...(x.pendingCardId ? ([['pending', `loosening card ${String(x.pendingCardId)}`]] as Array<[string, string]>) : []),
    ]);
  }
}
