// @gnomon-platform: darwin, linux
/**
 * #gnomon-voice V2e, Aegis M2: the kernel never runs the client from the (session-writable) workspace.
 *   - TOFU closed: the gnomon-voice build writes dist/voice-client.manifest.json (sha256 of every dist file and the
 *     runtime root files); the gnomon build stamp records that manifest's sha256. At DAEMON START the kernel refuses
 *     unless the workspace matches the manifest AND the manifest matches the stamp it loaded.
 *   - It then copies ALL of dist (+ the root files and the optional native engine packages) into
 *     <home>/bin/voice/client (0700 / 0600), pins every copied file in memory, and re-verifies before every spawn.
 *   - The COPIED client really runs (node <copy>/dist/cli.js status).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createVoicePrepare, installVoiceApp, installVoiceClient, verifyVoiceClient, voiceClientDir, VoiceClientRefused, VOICE_APP_NAME, VOICE_CLIENT_MANIFEST, VOICE_IO_IN_APP } from '../src/kernel/voice/voice-install.js';
import { DEV_PINS } from '../src/kernel/lifecycle/release-pins.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Write the build manifest the way scripts/voice-manifest.mjs does; returns the stamp's voiceClientManifest. */
function writeManifest(pkg: string): string {
  const files: Record<string, string> = {};
  for (const f of fs.readdirSync(path.join(pkg, 'dist')).sort()) if (f !== VOICE_CLIENT_MANIFEST) files[`dist/${f}`] = sha(fs.readFileSync(path.join(pkg, 'dist', f)));
  files['voice-models.manifest.json'] = sha(fs.readFileSync(path.join(pkg, 'voice-models.manifest.json')));
  const body = `${JSON.stringify({ schemaVersion: 'gnomon-voice-client:v1', files })}\n`;
  fs.writeFileSync(path.join(pkg, 'dist', VOICE_CLIENT_MANIFEST), body);
  return `sha256:${sha(body)}`;
}

/** A fake source package: <root>/gnomon-voice/dist/{cli,index}.js + manifest, with sherpa-onnx-node + one platform package. */
function source() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-pin-'));
  dirs.push(root);
  const pkg = path.join(root, 'gnomon-voice');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@a-company/gnomon-voice', type: 'module' }));
  fs.writeFileSync(path.join(pkg, 'voice-models.manifest.json'), '{}\n');
  fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), 'console.log("voice");\n');
  fs.writeFileSync(path.join(pkg, 'dist', 'index.js'), 'export {};\n');
  const nm = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(nm, 'sherpa-onnx-node'), { recursive: true });
  fs.writeFileSync(path.join(nm, 'sherpa-onnx-node', 'package.json'), JSON.stringify({ name: 'sherpa-onnx-node', optionalDependencies: { 'sherpa-onnx-darwin-arm64': '1', 'sherpa-onnx-win-x64': '1' } }));
  fs.writeFileSync(path.join(nm, 'sherpa-onnx-node', 'index.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(nm, 'sherpa-onnx-darwin-arm64'), { recursive: true });
  fs.writeFileSync(path.join(nm, 'sherpa-onnx-darwin-arm64', 'package.json'), JSON.stringify({ name: 'sherpa-onnx-darwin-arm64' }));
  fs.writeFileSync(path.join(nm, 'sherpa-onnx-darwin-arm64', 'sherpa-onnx.node'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const expected = writeManifest(pkg);
  return { pkg, entry: path.join(pkg, 'dist', 'cli.js'), home, expected };
}
const seams = { installApp: () => ({ ioBinary: '/io', devUnsigned: true }), fetchModels: async () => undefined };

describe('#gnomon-voice V2e (Aegis M2): the build-pinned client copy', () => {
  it('copies ALL of dist, the root runtime files and the native packages; 0700 dirs, 0600 files; pins every file', () => {
    const { entry, home, expected } = source();
    const pin = installVoiceClient({ home, entry, expectedManifest: expected });
    expect(pin.dir).toBe(voiceClientDir(home));
    expect(pin.entry).toBe(path.join(home, 'bin', 'voice', 'client', 'dist', 'cli.js'));
    expect(Object.keys(pin.files).sort()).toEqual([
      'dist/cli.js',
      'dist/index.js',
      `dist/${VOICE_CLIENT_MANIFEST}`,
      'node_modules/sherpa-onnx-darwin-arm64/package.json',
      'node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node',
      'node_modules/sherpa-onnx-node/index.js',
      'node_modules/sherpa-onnx-node/package.json',
      'package.json',
      'voice-models.manifest.json',
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(pin.dir, 'package.json'), 'utf8'))).toMatchObject({ type: 'module' });
    expect(fs.statSync(pin.dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(pin.dir, 'dist')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(pin.entry).mode & 0o777).toBe(0o600);
    expect(() => verifyVoiceClient(pin)).not.toThrow();
  });

  it('TOFU closed: a cli.js modified BEFORE daemon start is refused at daemon start (the stamp-pinned manifest)', async () => {
    const { entry, home, expected } = source();
    fs.appendFileSync(entry, 'process.exit(0);\n'); // a session edits the workspace before the kernel starts
    const prepare = createVoicePrepare({ home, entry, devUnsigned: true, expectedManifest: expected, ...seams });
    expect(fs.existsSync(voiceClientDir(home))).toBe(false); // nothing copied
    await expect(prepare(() => undefined)).rejects.toThrow(/does not match its build manifest \(dist\/cli\.js\)/);
    await expect(prepare(() => undefined)).rejects.toMatchObject({ name: 'VoiceClientRefused' });
  });

  it('a re-written manifest that matches the tampered dist still fails: it no longer matches the stamp', () => {
    const { pkg, entry, home, expected } = source();
    fs.appendFileSync(entry, 'process.exit(0);\n');
    writeManifest(pkg); // the attacker regenerates the manifest too
    expect(() => installVoiceClient({ home, entry, expectedManifest: expected })).toThrow(/not the one this Gnomon build was made with/);
    expect(() => installVoiceClient({ home, entry, expectedManifest: null })).toThrow(/does not pin a voice client/);
    fs.rmSync(path.join(pkg, 'dist', VOICE_CLIENT_MANIFEST));
    expect(() => installVoiceClient({ home, entry, expectedManifest: expected })).toThrow(/no build manifest/);
  });

  it('an added dist file or a changed runtime root file is refused too', () => {
    const a = source();
    fs.writeFileSync(path.join(a.pkg, 'dist', 'chunk-evil.js'), 'x');
    expect(() => installVoiceClient({ home: a.home, entry: a.entry, expectedManifest: a.expected })).toThrow(/dist\/chunk-evil\.js/);
    const b = source();
    fs.writeFileSync(path.join(b.pkg, 'voice-models.manifest.json'), '{"models":[]}\n');
    expect(() => installVoiceClient({ home: b.home, entry: b.entry, expectedManifest: b.expected })).toThrow(/voice-models\.manifest\.json/);
  });

  it('a modified, added or missing COPIED file refuses (VoiceClientRefused); a later workspace edit does not matter', () => {
    const { entry, home, expected } = source();
    let pin = installVoiceClient({ home, entry, expectedManifest: expected });
    fs.writeFileSync(entry, 'console.log("evil, but never run");\n');
    expect(() => verifyVoiceClient(pin)).not.toThrow();
    fs.appendFileSync(pin.entry, 'process.exit(0);\n');
    expect(() => verifyVoiceClient(pin)).toThrow(VoiceClientRefused);
    expect(() => verifyVoiceClient(pin)).toThrow(/changed since the kernel copied it \(dist\/cli\.js\)/);
    const s2 = source();
    pin = installVoiceClient({ home: s2.home, entry: s2.entry, expectedManifest: s2.expected });
    fs.writeFileSync(path.join(pin.dir, 'dist', 'extra.js'), 'x');
    expect(() => verifyVoiceClient(pin)).toThrow(/dist\/extra\.js/);
    pin = installVoiceClient({ home: s2.home, entry: s2.entry, expectedManifest: s2.expected });
    fs.rmSync(path.join(pin.dir, 'node_modules', 'sherpa-onnx-node', 'index.js'));
    expect(() => verifyVoiceClient(pin)).toThrow(/sherpa-onnx-node\/index\.js/);
    pin = installVoiceClient({ home: s2.home, entry: s2.entry, expectedManifest: s2.expected });
    fs.symlinkSync('/etc/hosts', path.join(pin.dir, 'dist', 'link.js'));
    expect(() => verifyVoiceClient(pin)).toThrow(/not a plain file/);
  });

  it("the daemon's prepare copies at construction, fetches models with the COPY, returns the copy, refuses a tampered copy", async () => {
    const { entry, home, expected } = source();
    const fetched: string[] = [];
    const prepare = createVoicePrepare({ home, entry, devUnsigned: true, expectedManifest: expected, installApp: seams.installApp, fetchModels: async (o) => void fetched.push(o.entry) });
    expect(fs.existsSync(path.join(voiceClientDir(home), 'dist', 'cli.js'))).toBe(true); // at daemon start, not first prepare
    const phases: string[] = [];
    const first = await prepare((p) => phases.push(p));
    expect(first).toEqual({ ioBinary: '/io', devUnsigned: true, clientEntry: path.join(voiceClientDir(home), 'dist', 'cli.js') });
    expect(fetched).toEqual([first.clientEntry]);
    expect(phases[0]).toBe('installing');
    expect((await prepare(() => undefined)).clientEntry).toBe(first.clientEntry);
    fs.writeFileSync(first.clientEntry!, 'tampered\n');
    await expect(prepare(() => undefined)).rejects.toMatchObject({ name: 'VoiceClientRefused' });
  });
});

/* ── the REAL built client, run from the copy ─────────────────────────────────────────────────────── */

const VOICE_PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'gnomon-voice');
const BUILT = fs.existsSync(path.join(VOICE_PKG, 'dist', VOICE_CLIENT_MANIFEST));

describe('#gnomon-voice T-2026-10-21-028 (Aegis M1 review): the io app is re-verified right before the spawn', () => {
  it('a voice-io swapped during the model fetch is refused (VoiceAppRefused changed); untouched, prepare returns it', async () => {
    const { home, entry, expected } = source();
    const app = path.join(path.dirname(home), 'src-app', VOICE_APP_NAME);
    fs.mkdirSync(path.join(app, path.dirname(VOICE_IO_IN_APP)), { recursive: true });
    fs.writeFileSync(path.join(app, VOICE_IO_IN_APP), '#!/bin/sh\necho "gnomon-voice-io 0.1.0"\n', { mode: 0o755 });
    const installApp = (o: { home: string; devUnsigned: boolean }) =>
      installVoiceApp({ home: o.home, sourceApp: app, devUnsigned: o.devUnsigned, check: () => ({ ok: true, detail: '' }), ditto: (a, b) => fs.cpSync(a, b, { recursive: true }), pins: DEV_PINS, readVersion: () => '0.1.0' });
    const ok = await createVoicePrepare({ home, entry, devUnsigned: false, expectedManifest: expected, installApp, fetchModels: async () => undefined })(() => undefined);
    expect(ok.ioBinary.endsWith(VOICE_IO_IN_APP)).toBe(true);
    const swap = createVoicePrepare({ home, entry, devUnsigned: false, expectedManifest: expected, installApp, fetchModels: async () => {
      const exe = path.join(home, 'bin', 'voice', VOICE_APP_NAME, VOICE_IO_IN_APP);
      fs.writeFileSync(`${exe}.evil`, '#!/bin/sh\necho "gnomon-voice-io 9.9.9"\n', { mode: 0o755 });
      fs.renameSync(`${exe}.evil`, exe);
    } });
    await expect(swap(() => undefined)).rejects.toMatchObject({ name: 'VoiceAppRefused', reason: 'changed' });
  });
});

describe.skipIf(!BUILT)('#gnomon-voice V2e (Aegis M2): the copied client runs (root build:gnomon builds gnomon-voice first)', () => {
  it('node <home>/bin/voice/client/dist/cli.js status runs from the copy, reading the copied models manifest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-run-'));
    dirs.push(root);
    const home = path.join(root, 'home');
    fs.mkdirSync(home, { mode: 0o700 });
    const expected = `sha256:${sha(fs.readFileSync(path.join(VOICE_PKG, 'dist', VOICE_CLIENT_MANIFEST)))}`;
    const prepare = createVoicePrepare({ home, entry: path.join(VOICE_PKG, 'dist', 'cli.js'), devUnsigned: true, expectedManifest: expected, ...seams });
    const { clientEntry } = await prepare(() => undefined);
    expect(clientEntry!.startsWith(voiceClientDir(home))).toBe(true);
    const r = spawnSync(process.execPath, [clientEntry!, 'status', '--home', home], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: root } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Voice home: ${path.join(home, 'voice')}`);
    expect(r.stdout).toMatch(/silero-vad/); // the models manifest came from the copy
    expect(r.stdout).toContain('Voiceprints: none');
  });
});
