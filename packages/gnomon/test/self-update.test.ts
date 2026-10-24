/**
 * TD-2026-10-19-063 (self-update pickup, flow 2): #update-watch raises ONE upgrade card per new stamp, the kernel's
 * own card shares the daemon-stop slot with a launcher's daemon.stop{reason:'upgrade'}, the #gui-resume gate is
 * single use / TTL / principal-bound, and the successor argv asks for the old port.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeUpdate, parseBuildStamp, sameBuild, type BuildStamp } from '../src/kernel/lifecycle/build-stamp.js';
import { UpdateWatch, UPGRADE_CARD_COOLDOWN_MS } from '../src/kernel/lifecycle/update-watch.js';
import { DaemonStopCards, UPGRADE_CARD_TIMEOUT_MS } from '../src/kernel/broker/daemon-stop.js';
import { mintResumeToken, ResumeGate, resumeRecordOf, RESUME_MAX_MISSES, RESUME_TOKEN_TTL_MS } from '../src/kernel/web/resume.js';
import { parseHandoff, successorArgs } from '../src/kernel/lifecycle/successor.js';
import { parseDaemonArgs } from '../src/cli/daemon-cli.js';

const stamp = (n: string, version = '8.0.0'): BuildStamp => ({ schemaVersion: 'gnomon-build:v1', version, commit: `c${n}`, distHash: `sha256:${n.repeat(64).slice(0, 64)}`, guiBundleHash: null });
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gn-upd-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('build stamp', () => {
  it('a rebuilt voice client or GUI bundle alone is a different build (the kernel pins the client at boot)', () => {
    const base = parseBuildStamp({ schemaVersion: 'gnomon-build:v1', version: '8.0.0', commit: 'a', distHash: `sha256:${'1'.repeat(64)}`, guiBundleHash: `sha256:${'2'.repeat(64)}`, voiceClientManifest: `sha256:${'3'.repeat(64)}` });
    const voice = parseBuildStamp({ schemaVersion: 'gnomon-build:v1', version: '8.0.0', commit: 'b', distHash: `sha256:${'1'.repeat(64)}`, guiBundleHash: `sha256:${'2'.repeat(64)}`, voiceClientManifest: `sha256:${'4'.repeat(64)}` });
    const gui = parseBuildStamp({ schemaVersion: 'gnomon-build:v1', version: '8.0.0', commit: 'c', distHash: `sha256:${'1'.repeat(64)}`, guiBundleHash: `sha256:${'5'.repeat(64)}`, voiceClientManifest: `sha256:${'3'.repeat(64)}` });
    expect(sameBuild(base, base)).toBe(true);
    expect(sameBuild(base, voice)).toBe(false);
    expect(sameBuild(base, gui)).toBe(false);
  });

  it('parses only the closed shape; sameBuild compares distHash; the summary reads v→v′ (commit)', () => {
    expect(parseBuildStamp(stamp('a'))).toEqual(stamp('a'));
    expect(parseBuildStamp({ ...stamp('a'), distHash: 'nope' })).toBeNull();
    expect(parseBuildStamp(null)).toBeNull();
    // Aegis V2e M2: the voice client manifest hash rides the stamp (optional; malformed ⇒ the stamp is refused)
    const v = `sha256:${'b'.repeat(64)}`;
    expect(parseBuildStamp({ ...stamp('a'), voiceClientManifest: v })).toEqual({ ...stamp('a'), voiceClientManifest: v });
    expect(parseBuildStamp({ ...stamp('a'), voiceClientManifest: null })).toEqual(stamp('a'));
    expect(parseBuildStamp({ ...stamp('a'), voiceClientManifest: 'sha1:x' })).toBeNull();
    expect(sameBuild(stamp('a'), stamp('a', '9'))).toBe(true);
    expect(sameBuild(stamp('a'), null)).toBe(false);
    expect(describeUpdate(stamp('a'), stamp('b', '8.0.1'))).toBe('8.0.0→8.0.1 (cb)');
  });
});

describe('#update-watch', () => {
  it('a stamp change raises ONE card; the same stamp again raises nothing; a failed raise is retried', async () => {
    const d = tmp();
    const file = path.join(d, 'build-id.json');
    writeFileSync(file, JSON.stringify(stamp('a')));
    const seen: string[] = [];
    let failNext = false;
    const w = new UpdateWatch({
      stampPath: file,
      loaded: stamp('a'),
      cooldownMs: 0,
      onKernelUpdate: (n) => {
        if (failNext) {
          failNext = false;
          throw new Error('raise failed');
        }
        seen.push(n.distHash);
      },
    });
    await w.tick();
    expect(seen).toEqual([]);
    writeFileSync(file, JSON.stringify(stamp('b')));
    await w.tick();
    await w.tick();
    expect(seen).toEqual([stamp('b').distHash]);
    failNext = true;
    writeFileSync(file, JSON.stringify(stamp('c')));
    await w.tick();
    await w.tick();
    expect(seen).toEqual([stamp('b').distHash, stamp('c').distHash]);
  });

  it('Aegis L: at most one card per cooldown; a newer stamp inside it waits, then raises', async () => {
    const d = tmp();
    const file = path.join(d, 'build-id.json');
    let now = 0;
    const seen: string[] = [];
    const w = new UpdateWatch({ stampPath: file, loaded: stamp('a'), now: () => now, onKernelUpdate: (n) => void seen.push(n.distHash) });
    writeFileSync(file, JSON.stringify(stamp('b')));
    await w.tick();
    writeFileSync(file, JSON.stringify(stamp('c')));
    now = UPGRADE_CARD_COOLDOWN_MS - 1;
    await w.tick();
    expect(seen).toEqual([stamp('b').distHash]);
    now = UPGRADE_CARD_COOLDOWN_MS;
    await w.tick();
    expect(seen).toEqual([stamp('b').distHash, stamp('c').distHash]);
  });

  it('a kernel that loaded no stamp watches nothing; the helper check runs on every tick', async () => {
    const d = tmp();
    const file = path.join(d, 'build-id.json');
    writeFileSync(file, JSON.stringify(stamp('b')));
    let checks = 0;
    const seen: unknown[] = [];
    const w = new UpdateWatch({ stampPath: file, loaded: null, onKernelUpdate: (n) => void seen.push(n), helper: { check: () => void checks++ } });
    await w.tick();
    await w.tick();
    expect(seen).toEqual([]);
    expect(checks).toBe(2);
  });
});

/** A broker double: enough of ApprovalBroker for DaemonStopCards (raise / card). */
function fakeBroker() {
  const cards = new Map<string, { cardId: string; state: string; lines: string[]; requestedBy: string; timeoutMs?: number; effect?: (d: string, ctx: { connId: string }) => void }>();
  let n = 0;
  return {
    cards,
    raise: async (input: { lines: string[]; requestedBy: string; timeoutMs?: number; effect?: (d: string, ctx: { connId: string }) => void }) => {
      const cardId = `card:${++n}`;
      const c = { cardId, state: 'pending', lines: input.lines, requestedBy: input.requestedBy, ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}), ...(input.effect ? { effect: input.effect } : {}) };
      cards.set(cardId, c);
      return c;
    },
    card: (id: string) => cards.get(id),
  };
}

describe('the kernel upgrade card (daemon-stop{reason:upgrade})', () => {
  const human = { connId: 'c1', principal: 'p:local/founder', principalClass: 'human', credential: 'device' };

  it('raised by the kernel with the update line and a 24 h expiry; a second raise and a launcher request get the SAME card', async () => {
    const b = fakeBroker();
    const accepted: Array<{ reason: string; connId: string }> = [];
    const cards = new DaemonStopCards(b as never, (reason, ctx) => void accepted.push({ reason, connId: ctx.connId }));
    const c1 = await cards.raiseUpgrade('p:local/kernel', '8.0.0→8.0.1 (abc)');
    const c2 = await cards.raiseUpgrade('p:local/kernel', '8.0.0→8.0.1 (abc)');
    const c3 = await cards.request(human, 'upgrade');
    expect(b.cards.size).toBe(1);
    expect(c2?.cardId).toBe(c1?.cardId);
    expect(c3.cardId).toBe(c1?.cardId);
    const raised = b.cards.get(c1!.cardId)!;
    expect(raised.lines[0]).toBe('Gnomon was updated: 8.0.0→8.0.1 (abc)');
    expect(raised.requestedBy).toBe('p:local/kernel');
    expect(raised.timeoutMs).toBe(UPGRADE_CARD_TIMEOUT_MS);
    await expect(cards.request(human, 'stop')).rejects.toThrow(/already pending/);
    raised.effect!('accept', { connId: 'gui-7' });
    await new Promise((r) => setImmediate(r));
    expect(accepted).toEqual([{ reason: 'upgrade', connId: 'gui-7' }]);
  });

  it('a pending STOP card is left alone (no second prompt, no upgrade card)', async () => {
    const b = fakeBroker();
    const cards = new DaemonStopCards(b as never, () => undefined);
    await cards.request(human, 'stop');
    expect(await cards.raiseUpgrade('p:local/kernel', 'x')).toBeNull();
    expect(b.cards.size).toBe(1);
  });
});

describe('#gui-resume gate', () => {
  const binding = { principal: 'p:local/founder', deviceId: 'dev-1', ns: 'local' };
  const gate = (now: () => number, isHuman = (p: string, d: string) => p === binding.principal && d === binding.deviceId, ns = 'local') => {
    const token = mintResumeToken();
    const g = new ResumeGate({ record: resumeRecordOf(token, binding, 1_000), ns, isHumanDevice: isHuman, now });
    return { token, g };
  };

  it('fresh once, as the bound principal; the second use is a replay', () => {
    const { token, g } = gate(() => 2_000);
    expect(g.exchange(token)).toEqual({ kind: 'fresh', binding });
    expect(g.exchange(token)).toEqual({ kind: 'replay' });
  });

  it('after the TTL: expired (and burned)', () => {
    const { token, g } = gate(() => 1_000 + RESUME_TOKEN_TTL_MS + 1);
    expect(g.exchange(token).kind).toBe('expired');
    expect(g.exchange(token).kind).toBe('replay');
  });

  it('another principal (the device is not that principal\'s human device) or another root ns is refused', () => {
    expect(gate(() => 2_000, () => false).g.exchange(gate(() => 0).token).kind).toBe('unknown');
    const a = gate(() => 2_000, () => false);
    expect(a.g.exchange(a.token).kind).toBe('principal');
    const b = gate(() => 2_000, undefined, 'other-root');
    expect(b.g.exchange(b.token).kind).toBe('principal');
  });

  it('wrong tokens never succeed and burn the record after RESUME_MAX_MISSES', () => {
    const { token, g } = gate(() => 2_000);
    for (let i = 0; i < RESUME_MAX_MISSES; i++) expect(g.exchange(mintResumeToken()).kind).toBe('unknown');
    expect(g.exchange(token).kind).toBe('unknown');
    expect(g.exchange({ not: 'a string' }).kind).toBe('unknown');
  });

  it('the record (what the home hand-off holds) carries the digest, never the token', () => {
    const t = mintResumeToken();
    const rec = resumeRecordOf(t, binding, 5);
    expect(JSON.stringify(rec)).not.toContain(t);
    expect(rec.expiresAt - rec.mintedAt).toBe(RESUME_TOKEN_TTL_MS);
  });
});

describe('the successor', () => {
  it('argv: the clean re-exec argv, no ready channel, plus --prefer-port; the daemon parses it', () => {
    const a = successorArgs({ entry: path.resolve('gnomond.js'), home: path.resolve('h'), preferPort: 51234 });
    expect(a[0]).toBe('--disable-sigusr1');
    expect(a).toContain('--foreground');
    expect(a.slice(-2)).toEqual(['--prefer-port', '51234']);
    const b = successorArgs({ home: path.resolve('h'), preferPort: 51234, listenFd: 17, handoff: { kernelKeyPem: 'k', resume: null } });
    expect(b.slice(-5)).toEqual(['--prefer-port', '51234', '--web-listen-fd', '3', '--kernel-key-stdin']);
    const pb = parseDaemonArgs(b);
    expect(typeof pb === 'object' && [pb.webListenFd, pb.kernelKeyStdin]).toEqual([3, true]);
    expect(parseDaemonArgs(['--web-listen-fd', '9'])).toMatch(/is 3/);
    expect(parseHandoff('{"kernelKeyPem":"nope"}')).toBeNull();
    expect(parseHandoff('not json')).toBeNull();
    expect(a.some((x) => x.startsWith('--ready'))).toBe(false);
    expect(successorArgs({ home: path.resolve('h'), preferPort: null })).not.toContain('--prefer-port');
    const parsed = parseDaemonArgs(a.slice(2));
    expect(typeof parsed === 'object' && parsed.preferPort).toBe(51234);
    expect(parseDaemonArgs(['--prefer-port', '0'])).toMatch(/1\.\.65535/);
  });
});
