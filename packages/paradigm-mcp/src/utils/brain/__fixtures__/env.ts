/**
 * Test-only sandbox: temp dir + injected homedir. Also points HOME and
 * PARADIGM_BRAIN_HOME at the fake home so an accidental default homedir can
 * never touch the real one.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface BrainSandbox {
  tmp: string;
  home: string;
  opts: { homedir: string };
  cleanup(): void;
}

export function makeSandbox(prefix = 'brain-'): BrainSandbox {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  const prevHome = process.env.HOME;
  const prevBrainHome = process.env.PARADIGM_BRAIN_HOME;
  process.env.HOME = home;
  process.env.PARADIGM_BRAIN_HOME = home;
  return {
    tmp,
    home,
    opts: { homedir: home },
    cleanup() {
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
      if (prevBrainHome === undefined) delete process.env.PARADIGM_BRAIN_HOME; else process.env.PARADIGM_BRAIN_HOME = prevBrainHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** Recursive listing (lstat, no symlink follow) with size+mtime — for "never wrote inside root" checks. */
export function snapshotTree(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d).sort()) {
      const abs = path.join(d, n);
      const st = fs.lstatSync(abs);
      out.push(`${path.relative(root, abs)}|${st.isDirectory() ? 'd' : st.size}|${st.mtimeMs}`);
      if (st.isDirectory() && !st.isSymbolicLink()) walk(abs);
    }
  };
  walk(root);
  return out;
}
