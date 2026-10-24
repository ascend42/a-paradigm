import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GNOMON_VERSION, KERNEL_MODULES } from '../src/index.js';
import { PKG_ROOT } from './helpers.js';

const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));

describe('kernel scaffold', () => {
  it('GNOMON_VERSION matches package.json', () => {
    expect(GNOMON_VERSION).toBe(pkg.version);
  });

  it('has the thirteen §18 kernel module directories', () => {
    expect(KERNEL_MODULES).toHaveLength(13);
    for (const m of KERNEL_MODULES) {
      expect(existsSync(path.join(PKG_ROOT, 'src', 'kernel', m)), m).toBe(true);
    }
  });

  it.each(Object.entries(pkg.bin as Record<string, string>))('bin %s prints its version', (name, file) => {
    const out = execFileSync(process.execPath, [path.join(PKG_ROOT, file), '--version'], { encoding: 'utf8' });
    expect(out.trim()).toBe(`${name} ${GNOMON_VERSION}`);
  });
});
