/**
 * check-gnomon-published (prepublishOnly guard) against a stub `npm` on PATH.
 *
 * 8.0.2: changesets runs `npm publish --json`, npm hands npm_config_json=true to lifecycle scripts, and a plain
 * `npm view … version` then printed "8.0.2" with quotes, so the guard refused a Gnomon that was on npm.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'check-gnomon-published.mjs');
const WANT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).dependencies['@a-company/gnomon'] as string;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A fake npm: prints `body` (JSON form when --json or npm_config_json is set), or fails with `stderr`. */
function stubNpm(mode: { published?: string; e404?: boolean; broken?: boolean }): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-npm-stub-'));
  dirs.push(bin);
  const body = mode.e404
    ? `echo "npm error code E404" 1>&2; exit 1`
    : mode.broken
      ? `echo "npm error code ECONNREFUSED" 1>&2; exit 1`
      : `case " $* " in *" --json "*) echo '"${mode.published}"' ;; *) if [ "$npm_config_json" = "true" ]; then echo '"${mode.published}"'; else echo '${mode.published}'; fi ;; esac`;
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return bin;
}

function run(bin: string, extraEnv: Record<string, string> = {}): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: os.tmpdir(), ...extraEnv },
  });
  return { status: r.status, stderr: r.stderr };
}

describe.skipIf(process.platform === 'win32')('check-gnomon-published', () => {
  it('passes when gnomon is on npm', () => {
    expect(run(stubNpm({ published: WANT })).status).toBe(0);
  });
  it('passes inside `npm publish --json` (npm_config_json=true), the changesets case', () => {
    expect(run(stubNpm({ published: WANT }), { npm_config_json: 'true' }).status).toBe(0);
  });
  it('refuses when the version is not on npm (E404)', () => {
    const r = run(stubNpm({ e404: true }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is not on npm/);
  });
  it('fails closed with npm\'s own error on anything else', () => {
    const r = run(stubNpm({ broken: true }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cannot confirm.*ECONNREFUSED/);
  });
});
