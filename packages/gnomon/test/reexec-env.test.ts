/**
 * $daemon-lifecycle clean re-exec env (spec §2.4 rule 2, §15.3, S-H3): only
 * PATH (fixed), HOME/USERPROFILE and locale survive; NODE_OPTIONS and every
 * GNOMON_* are dropped; home travels in argv.
 */
import { describe, expect, it } from 'vitest';
import { cleanReexecEnv, DEFAULT_REEXEC_PATH, isAllowlistedEnvKey, reexecArgs } from '../src/kernel/lifecycle/env.js';

describe('cleanReexecEnv', () => {
  const source = {
    HOME: '/Users/x',
    USERPROFILE: 'C:\\Users\\x',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'C',
    LC_CTYPE: 'UTF-8',
    PATH: '/evil/bin:/usr/bin',
    NODE_OPTIONS: '--require /evil.js',
    NODE_PATH: '/evil',
    GNOMON_HOME: '/elsewhere',
    GNOMON_DEBUG: '1',
    DYLD_INSERT_LIBRARIES: '/evil.dylib',
    LD_PRELOAD: '/evil.so',
    ANTHROPIC_API_KEY: 'sk-secret',
    SSH_AUTH_SOCK: '/agent',
    lc_all: 'lower',
    UNDEF: undefined,
  };

  it('keeps exactly the allowlist and fixes PATH', () => {
    expect(cleanReexecEnv(source)).toEqual({
      HOME: '/Users/x',
      USERPROFILE: 'C:\\Users\\x',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
      LC_CTYPE: 'UTF-8',
      PATH: DEFAULT_REEXEC_PATH,
    });
  });

  it('takes PATH from the caller (root-signed config, M1.1), never the activator', () => {
    expect(cleanReexecEnv(source, { path: '/opt/gnomon/bin' }).PATH).toBe('/opt/gnomon/bin');
  });

  it.each(['NODE_OPTIONS', 'GNOMON_HOME', 'GNOMON_ANYTHING', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'PATH', 'lc_all', 'LC_'])(
    'drops %s',
    (k) => {
      expect(isAllowlistedEnvKey(k)).toBe(false);
    },
  );

  it('carries home and idle in argv, with no node flags', () => {
    expect(reexecArgs({ entry: '/x/gnomond.js', home: '/h', idleMs: 5 })).toEqual([
      '/x/gnomond.js',
      '--foreground',
      '--home',
      '/h',
      '--idle-ms',
      '5',
    ]);
    expect(reexecArgs({ home: '/h' })).toEqual(['--foreground', '--home', '/h']);
  });
});
