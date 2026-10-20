// @gnomon-platform: darwin, linux
/**
 * #gnomon-voice V2e, Aegis M2: the kernel never runs the client from the (session-writable) workspace. It copies
 * dist/cli.js (+ the optional native engine packages) into <home>/bin/voice/client (0700 / 0600), pins a sha256 of
 * every copied file in memory, and re-verifies before every spawn: a changed, added or missing file refuses.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVoicePrepare, installVoiceClient, verifyVoiceClient, voiceClientDir, VoiceClientRefused } from '../src/kernel/voice/voice-install.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A fake source package: <root>/gnomon-voice/dist/cli.js, with sherpa-onnx-node + one platform package installed. */
function source() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-pin-'));
  dirs.push(root);
  const pkg = path.join(root, 'gnomon-voice');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@a-company/gnomon-voice', type: 'module' }));
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
  return { entry: path.join(pkg, 'dist', 'cli.js'), home };
}

describe('#gnomon-voice V2e (Aegis M2): the pinned client copy', () => {
  it('copies cli.js, a module package.json and the installed native packages; 0700 dirs, 0600 files; pins every file', () => {
    const { entry, home } = source();
    const pin = installVoiceClient({ home, entry });
    expect(pin.dir).toBe(voiceClientDir(home));
    expect(pin.entry).toBe(path.join(home, 'bin', 'voice', 'client', 'dist', 'cli.js'));
    expect(Object.keys(pin.files).sort()).toEqual(['dist/cli.js', 'node_modules/sherpa-onnx-darwin-arm64/package.json', 'node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node', 'node_modules/sherpa-onnx-node/index.js', 'node_modules/sherpa-onnx-node/package.json', 'package.json']);
    expect(JSON.parse(fs.readFileSync(path.join(pin.dir, 'package.json'), 'utf8'))).toMatchObject({ type: 'module' });
    expect(fs.statSync(pin.dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(pin.dir, 'dist')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(pin.entry).mode & 0o777).toBe(0o600);
    expect(() => verifyVoiceClient(pin)).not.toThrow();
  });

  it('a modified, added or missing copied file refuses (VoiceClientRefused); the workspace edit alone does not matter', () => {
    const { entry, home } = source();
    let pin = installVoiceClient({ home, entry });
    fs.writeFileSync(entry, 'console.log("evil, but never run");\n'); // the source changing after the copy is ignored
    expect(() => verifyVoiceClient(pin)).not.toThrow();
    fs.appendFileSync(pin.entry, 'process.exit(0);\n');
    expect(() => verifyVoiceClient(pin)).toThrow(VoiceClientRefused);
    expect(() => verifyVoiceClient(pin)).toThrow(/changed since the kernel copied it \(dist\/cli\.js\)/);
    pin = installVoiceClient({ home, entry });
    fs.writeFileSync(path.join(pin.dir, 'dist', 'extra.js'), 'x');
    expect(() => verifyVoiceClient(pin)).toThrow(/dist\/extra\.js/);
    pin = installVoiceClient({ home, entry });
    fs.rmSync(path.join(pin.dir, 'node_modules', 'sherpa-onnx-node', 'index.js'));
    expect(() => verifyVoiceClient(pin)).toThrow(/sherpa-onnx-node\/index\.js/);
    pin = installVoiceClient({ home, entry });
    fs.symlinkSync('/etc/hosts', path.join(pin.dir, 'dist', 'link.js'));
    expect(() => verifyVoiceClient(pin)).toThrow(/not a plain file/);
  });

  it("the daemon's prepare copies once, runs the models fetch with the COPY, returns the copy, and refuses a tampered copy", async () => {
    const { entry, home } = source();
    const fetched: string[] = [];
    const prepare = createVoicePrepare({
      home,
      entry,
      devUnsigned: true,
      installApp: () => ({ ioBinary: '/io', devUnsigned: true }),
      fetchModels: async (o) => void fetched.push(o.entry),
    });
    const phases: string[] = [];
    const first = await prepare((p) => phases.push(p));
    expect(first).toEqual({ ioBinary: '/io', devUnsigned: true, clientEntry: path.join(voiceClientDir(home), 'dist', 'cli.js') });
    expect(fetched).toEqual([first.clientEntry]);
    expect(phases[0]).toBe('installing');
    expect((await prepare(() => undefined)).clientEntry).toBe(first.clientEntry); // re-verified, not re-copied
    fs.writeFileSync(first.clientEntry!, 'tampered\n');
    await expect(prepare(() => undefined)).rejects.toMatchObject({ name: 'VoiceClientRefused' });
  });
});
