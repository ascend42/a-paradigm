// @gnomon-platform: darwin, linux
/**
 * #app-bundle (T-2026-10-21-029, TD-2026-10-21-758; 8.0 M2): a kernel running from a release Gnomon.app finds the
 * helper, voice-io and voice client INSIDE its own bundle, resolved from its own location at run time, so a moved
 * app still works; outside a bundle nothing changes. Plus the child-spawn fence: no kernel child is spawned with a
 * PATH `node`; every node child runs process.execPath (the bundled node when the wrapper spawned the kernel with it).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { appBundleOf, appInstallDir, bundledHelperPath, helperPathFor } from '../src/kernel/lifecycle/app-bundle.js';
import { defaultHelperPath } from '../src/cli/identity-cli.js';
import { resolveVoiceClientEntry, voiceIoSourceApp } from '../src/kernel/voice/voice-install.js';
import { transportLaunchPlan } from '../src/kernel/sandbox/transport.js';
import { findFirstPartyRoot } from '../src/kernel/modhost/mods-admin.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-app-bundle-')));
  dirs.push(d);
  return d;
}

/** A release-shaped Gnomon.app under `parent`; returns the kernel's cli file inside it. */
function makeApp(parent: string, opts: { voice?: boolean } = {}): string {
  const c = path.join(parent, 'Gnomon.app', 'Contents');
  const write = (rel: string, body = 'x'): void => {
    mkdirSync(path.dirname(path.join(c, rel)), { recursive: true });
    writeFileSync(path.join(c, rel), body);
  };
  write('MacOS/gnomon-wrapper');
  write('Resources/node/bin/node');
  write('Resources/kernel/package.json', '{"type":"module"}\n');
  write('Resources/kernel/dist/cli/gnomon.js', '// kernel\n');
  write('Helpers/GnomonHelper.app/Contents/MacOS/gnomon-helper');
  write('Helpers/GnomonVoiceIO.app/Contents/MacOS/gnomon-voice-io');
  if (opts.voice !== false) {
    write('Resources/gnomon-voice/package.json', '{"name":"@a-company/gnomon-voice"}\n');
    write('Resources/gnomon-voice/dist/cli.js', '// voice\n');
  }
  return path.join(c, 'Resources', 'kernel', 'dist', 'cli', 'gnomon.js');
}

describe('#app-bundle layout', () => {
  it('resolves every sibling inside the app from any kernel file, and is null outside a bundle', () => {
    const d = tmp();
    const js = makeApp(d);
    const b = appBundleOf(js)!;
    const app = path.join(d, 'Gnomon.app');
    expect(b).toEqual({
      app,
      kernel: path.join(app, 'Contents/Resources/kernel'),
      node: path.join(app, 'Contents/Resources/node/bin/node'),
      voicePackage: path.join(app, 'Contents/Resources/gnomon-voice'),
      mods: path.join(app, 'Contents/Resources/gnomon-mods'),
      helperApp: path.join(app, 'Contents/Helpers/GnomonHelper.app'),
      helperExe: path.join(app, 'Contents/Helpers/GnomonHelper.app/Contents/MacOS/gnomon-helper'),
      voiceIoApp: path.join(app, 'Contents/Helpers/GnomonVoiceIO.app'),
    });
    // the kernel dir itself, and dist/index.js, identify the same bundle
    expect(appBundleOf(path.join(app, 'Contents/Resources/kernel'))?.app).toBe(app);
    // this source tree (a checkout) is not a bundle; nor is a lookalike without Contents/Resources/kernel
    expect(appBundleOf(fileURLToPath(import.meta.url))).toBeNull();
    expect(appBundleOf()).toBeNull();
    expect(appBundleOf(path.join(app, 'Contents/Resources/node/bin/node'))).toBeNull();
  });

  it('relocation: the same app moved to another directory resolves at its NEW location', () => {
    const d = tmp();
    makeApp(path.join(d, 'Downloads'));
    mkdirSync(path.join(d, 'Applications'));
    renameSync(path.join(d, 'Downloads', 'Gnomon.app'), path.join(d, 'Applications', 'Gnomon.app'));
    rmSync(path.join(d, 'Downloads'), { recursive: true });
    const js = path.join(d, 'Applications/Gnomon.app/Contents/Resources/kernel/dist/cli/gnomon.js');
    const b = appBundleOf(js)!;
    expect(b.helperExe).toBe(path.join(d, 'Applications/Gnomon.app/Contents/Helpers/GnomonHelper.app/Contents/MacOS/gnomon-helper'));
    expect(existsSync(b.helperExe) && existsSync(b.voiceIoApp) && existsSync(b.node)).toBe(true);
    // reached through a symlinked parent: the realpath decides (the real bundle, not the link's directory)
    symlinkSync(path.join(d, 'Applications'), path.join(d, 'apps-link'));
    expect(appBundleOf(path.join(d, 'apps-link/Gnomon.app/Contents/Resources/kernel/dist/cli/gnomon.js'))?.app).toBe(path.join(d, 'Applications/Gnomon.app'));
  });
});

describe('#app-bundle first-party mods (8.0 M4)', () => {
  it('a bundled kernel finds Contents/Resources/gnomon-mods, also after the app moves', () => {
    const parent = tmp();
    const cli = makeApp(parent);
    mkdirSync(path.join(parent, 'Gnomon.app/Contents/Resources/gnomon-mods/workshop'), { recursive: true });
    expect(findFirstPartyRoot(path.dirname(cli))).toBe(path.join(parent, 'Gnomon.app/Contents/Resources/gnomon-mods'));
    expect(appBundleOf(cli)!.mods).toBe(path.join(parent, 'Gnomon.app/Contents/Resources/gnomon-mods'));
    const moved = path.join(tmp(), 'Applications');
    mkdirSync(moved);
    renameSync(path.join(parent, 'Gnomon.app'), path.join(moved, 'Gnomon.app'));
    expect(findFirstPartyRoot(path.join(moved, 'Gnomon.app/Contents/Resources/kernel/dist/cli'))).toBe(path.join(moved, 'Gnomon.app/Contents/Resources/gnomon-mods'));
  });

  it('falsifier: a bundle without its mods never walks out of the app (a gnomon-mods planted beside it is not read)', () => {
    const parent = tmp();
    const cli = makeApp(parent);
    mkdirSync(path.join(parent, 'gnomon-mods', 'evil'), { recursive: true });
    mkdirSync(path.join(parent, 'Gnomon.app', 'Contents', 'gnomon-mods'), { recursive: true });
    expect(findFirstPartyRoot(path.dirname(cli))).toBeNull();
  });
});

describe('#app-bundle install location (M4)', () => {
  it('prefers /Applications when writable without sudo, else ~/Applications', () => {
    expect(appInstallDir({ home: '/Users/u', writable: (d) => d === '/Applications' })).toBe('/Applications');
    expect(appInstallDir({ home: '/Users/u', writable: () => false })).toBe('/Users/u/Applications');
    expect(['/Applications', path.join(os.homedir(), 'Applications')]).toContain(appInstallDir());
  });
});

describe('#app-bundle helper lookup', () => {
  it('a bundled kernel uses the app helper by default and over a stale recorded path', () => {
    const d = tmp();
    const js = makeApp(d);
    const helper = path.join(d, 'Gnomon.app/Contents/Helpers/GnomonHelper.app/Contents/MacOS/gnomon-helper');
    expect(defaultHelperPath(pathToFileURL(js).href)).toBe(helper);
    expect(bundledHelperPath(js)).toBe(helper);
    // identity.json recorded the app's OLD location (before M4 copied it to ~/Applications): the running app's wins
    expect(helperPathFor('/Volumes/Gnomon/Gnomon.app/Contents/Helpers/GnomonHelper.app/Contents/MacOS/gnomon-helper', js)).toBe(helper);
  });

  it('outside a bundle the recorded path and the monorepo lookup are unchanged', () => {
    expect(bundledHelperPath(fileURLToPath(import.meta.url))).toBeNull();
    expect(helperPathFor('/x/gnomon-helper', fileURLToPath(import.meta.url))).toBe('/x/gnomon-helper');
    expect(defaultHelperPath()).toMatch(/gnomon-helper[/\\]bin[/\\]darwin[/\\]GnomonHelper\.app[/\\]Contents[/\\]MacOS[/\\]gnomon-helper$/);
  });
});

describe('#app-bundle voice lookup', () => {
  it('a bundled kernel takes the voice client from Contents/Resources and voice-io from Contents/Helpers', () => {
    const d = tmp();
    const js = makeApp(d);
    const r = resolveVoiceClientEntry('darwin', js);
    expect(r).toEqual({ entry: path.join(d, 'Gnomon.app/Contents/Resources/gnomon-voice/dist/cli.js') });
    expect(voiceIoSourceApp(r.entry!, js)).toBe(path.join(d, 'Gnomon.app/Contents/Helpers/GnomonVoiceIO.app'));
  });

  it('a bundle without the voice client never walks out of the app (no ~/node_modules from above it)', () => {
    const d = tmp();
    const js = makeApp(d, { voice: false });
    // a planted package ABOVE the app: the non-bundle walk would find it
    mkdirSync(path.join(d, 'node_modules/@a-company/gnomon-voice/dist'), { recursive: true });
    writeFileSync(path.join(d, 'node_modules/@a-company/gnomon-voice/package.json'), '{"name":"@a-company/gnomon-voice"}');
    writeFileSync(path.join(d, 'node_modules/@a-company/gnomon-voice/dist/cli.js'), '// planted');
    expect(resolveVoiceClientEntry('darwin', js)).toEqual({ entry: null, reason: 'the voice client is not installed in this Gnomon.app' });
  });

  it('outside a bundle the voice-io source stays beside the client', () => {
    expect(voiceIoSourceApp('/w/packages/gnomon-voice/dist/cli.js', fileURLToPath(import.meta.url))).toBe(path.resolve('/w/packages/gnomon-voice/bin/darwin/GnomonVoiceIO.app'));
  });
});

describe('child spawns use the kernel\'s own node (process.execPath), never PATH node', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });

  it('falsifier: no source spawns a bare `node`, `which node` or `/usr/bin/env node`', () => {
    const bad: string[] = [];
    const patterns = [/\b(?:spawn|spawnSync|execFile|execFileSync|fork)\(\s*['"`]node['"`]/, /\bwhich['"`]?\s*,\s*\[\s*['"`]node['"`]/, /['"`]\/usr\/bin\/env['"`]\s*,\s*\[\s*['"`]node/, /\bcommand:\s*['"`]node['"`]/];
    for (const f of files(SRC)) {
      const text = readFileSync(f, 'utf8');
      for (const re of patterns) if (re.test(text)) bad.push(`${path.relative(SRC, f)} ${re}`);
    }
    expect(bad).toEqual([]);
  });

  it.runIf(process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'))('the gnomon-web transport plan execs the realpath of process.execPath', () => {
    const d = tmp();
    writeFileSync(path.join(d, 'gnomon-web.js'), '');
    mkdirSync(path.join(d, 'bundle'));
    const plan = transportLaunchPlan({ scriptPath: path.join(d, 'gnomon-web.js'), bundleDir: path.join(d, 'bundle') });
    expect(plan.command).toBe('/usr/bin/sandbox-exec');
    expect(plan.args[2]).toBe(realpathSync(process.execPath));
  });
});
