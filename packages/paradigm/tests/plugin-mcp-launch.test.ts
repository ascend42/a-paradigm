/**
 * The Claude Code plugin's MCP launch must start in a project whose devEngines require pnpm.
 *
 * npm 11 applies the nearest package.json's devEngines to npx. The plugin ran `npx paradigm-mcp` from the project,
 * so a repo with devEngines.packageManager pnpm and onFail "error" (e.g. a-atelier) made npx exit EBADDEVENGINES
 * and the plugin server showed as CONNECTION_CLOSED. `--prefix` was rejected: it also moves npm's global prefix and
 * globalconfig. plugins/paradigm/scripts/paradigm-mcp-launch.cjs uses an installed paradigm-mcp and runs npx only
 * from the plugin folder; these tests run it against stub binaries (POSIX only: the stubs are sh scripts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const PLUGIN = path.join(REPO, 'plugins', 'paradigm');
const LAUNCHER = path.join(PLUGIN, 'scripts', 'paradigm-mcp-launch.cjs');

interface Seen { who: string; cwd: string; arg: string; init: string }

let tmp: string;
let project: string;

const write = (file: string, body: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
};
/** A paradigm-mcp stand-in that reports who it is, where it runs, its argument and INIT_CWD. */
const stubServer = (dir: string, who: string): void =>
  write(path.join(dir, 'paradigm-mcp'), `#!/bin/sh\nprintf '{"who":"${who}","cwd":"%s","arg":"%s","init":"%s"}' "$(pwd -P)" "$1" "\${INIT_CWD-}"\n`);

function launch(pathDirs: string[], args: string[] = [project]) {
  const env: Record<string, string> = { PATH: [...pathDirs, '/usr/bin', '/bin'].join(path.delimiter), HOME: tmp };
  const r = spawnSync(process.execPath, [LAUNCHER, ...args], { cwd: tmp, env, encoding: 'utf8' });
  const seen = r.stdout ? (JSON.parse(r.stdout) as Seen) : null;
  return { status: r.status, stderr: r.stderr, seen };
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-launch-')));
  project = path.join(tmp, 'pnpm only');
  write(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'p', devEngines: { packageManager: { name: 'pnpm', onFail: 'error' } } }),
  );
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('plugin MCP launch', () => {
  it('.mcp.json starts the launcher with node and passes the project', () => {
    const { command, args } = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers.paradigm;
    expect(command).toBe('node');
    expect(args).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/paradigm-mcp-launch.cjs', '${CLAUDE_PROJECT_DIR}']);
    expect(fs.existsSync(LAUNCHER)).toBe(true);
  });

  it('the plugin folder has no package.json for npm to apply devEngines from', () => {
    expect(fs.existsSync(path.join(PLUGIN, 'package.json'))).toBe(false);
  });

  describe.skipIf(process.platform === 'win32')('resolution (stub binaries)', () => {
    it("prefers the project's own node_modules/.bin, run in the project", () => {
      stubServer(path.join(project, 'node_modules', '.bin'), 'local');
      stubServer(path.join(tmp, 'global'), 'global');
      const { status, seen } = launch([path.join(tmp, 'global')]);
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'local', cwd: project, arg: project, init: '' });
    });

    it('falls back to paradigm-mcp on PATH, run in the project', () => {
      stubServer(path.join(tmp, 'global'), 'global');
      const { status, seen } = launch([path.join(tmp, 'global')]);
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'global', cwd: project, arg: project, init: '' });
    });

    it('otherwise runs npx from the plugin folder, and the fetched server still runs in the project', () => {
      const bin = path.join(tmp, 'bin');
      const fetched = path.join(tmp, 'npx-cache-bin');
      const log = path.join(tmp, 'npx.log');
      stubServer(fetched, 'fetched');
      // Like npm exec: put the package's bins on PATH, set INIT_CWD and local_prefix to where npx ran, run after `--`.
      write(
        path.join(bin, 'npx'),
        `#!/bin/sh\nprintf '%s|%s' "$(pwd -P)" "$*" > '${log}'\nwhile [ "$1" != "--" ]; do shift; done; shift\n` +
          `PATH='${fetched}':$PATH INIT_CWD="$(pwd -P)" npm_config_local_prefix="$(pwd -P)" exec "$@"\n`,
      );
      const { status, seen } = launch([bin]);
      expect(status).toBe(0);
      const [npxCwd, npxArgs] = fs.readFileSync(log, 'utf8').split('|');
      expect(npxCwd).toBe(fs.realpathSync(PLUGIN));
      expect(npxArgs).toContain('--package=@a-company/paradigm');
      expect(npxArgs).not.toContain('--prefix');
      expect(seen).toEqual({ who: 'fetched', cwd: project, arg: project, init: '' });
    });

    it('--resolved without paradigm-mcp on PATH fails instead of running npx again', () => {
      const bin = path.join(tmp, 'bin');
      write(path.join(bin, 'npx'), `#!/bin/sh\necho npx-ran\n`);
      const { status, stderr, seen } = launch([bin], ['--resolved', project]);
      expect(status).toBe(1);
      expect(seen).toBeNull();
      expect(stderr).toContain('did not put paradigm-mcp on PATH');
    });
  });
});
