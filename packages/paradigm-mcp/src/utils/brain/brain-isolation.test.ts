/**
 * vitest.setup.ts isolation: with no sandbox, the brain home is an EMPTY temp
 * dir — never the real ~/.paradigm/brains.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { anyBrainAgentEnabled, brainsHome, listBrains, resolveHomedir } from './config.js';

describe('brain test isolation', () => {
  it('PARADIGM_BRAIN_HOME points at an empty temp dir, not the real home', () => {
    const env = process.env.PARADIGM_BRAIN_HOME;
    expect(env).toBeTruthy();
    expect(path.resolve(env!).startsWith(fs.realpathSync(os.tmpdir())) || path.resolve(env!).startsWith(os.tmpdir())).toBe(true);
    expect(resolveHomedir()).toBe(path.resolve(env!));
    expect(brainsHome()).not.toBe(path.join(os.userInfo().homedir, '.paradigm', 'brains'));
    expect(listBrains()).toEqual([]);
    expect(anyBrainAgentEnabled()).toBe(false);
  });
});
