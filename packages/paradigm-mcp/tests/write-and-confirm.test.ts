/**
 * write-and-confirm.test.ts — tests for the v5.38.0 atomic-write wrapper.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  writeAndConfirm,
  computeHashHint,
  WriteVerificationError,
} from '../src/utils/write-and-confirm.js';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-wac-'));
}

describe('writeAndConfirm', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it('writes content atomically and returns an envelope with hashHint + bytes', async () => {
    tmpDir = mktemp();
    const filePath = path.join(tmpDir, 'out.yaml');
    const content = 'hello: world\n';

    const envelope = await writeAndConfirm(filePath, content, (readBack) => readBack === content);
    expect(envelope.written).toBe(true);
    expect(envelope.path).toBe(filePath);
    expect(envelope.bytes).toBe(Buffer.byteLength(content, 'utf-8'));
    expect(envelope.hashHint).toMatch(/^[0-9a-f]{12}$/);

    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
  });

  it('throws WriteVerificationError when verify returns false', async () => {
    tmpDir = mktemp();
    const filePath = path.join(tmpDir, 'out.yaml');
    await expect(
      writeAndConfirm(filePath, 'x: 1\n', () => false),
    ).rejects.toBeInstanceOf(WriteVerificationError);
    // File still written on disk — the wrapper does NOT roll back. Caller is
    // expected to surface the error; subsequent repair can reconcile state.
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('throws WriteVerificationError when verify callback throws', async () => {
    tmpDir = mktemp();
    const filePath = path.join(tmpDir, 'out.yaml');
    await expect(
      writeAndConfirm(filePath, 'x: 1\n', () => {
        throw new Error('verify threw');
      }),
    ).rejects.toBeInstanceOf(WriteVerificationError);
  });

  it('produces different hashHint values for different content', async () => {
    tmpDir = mktemp();
    const a = path.join(tmpDir, 'a.yaml');
    const b = path.join(tmpDir, 'b.yaml');
    const envA = await writeAndConfirm(a, 'a: 1\n', () => true);
    const envB = await writeAndConfirm(b, 'b: 2\n', () => true);
    expect(envA.hashHint).not.toBe(envB.hashHint);
  });

  it('produces the same hashHint for identical content', async () => {
    tmpDir = mktemp();
    const a = path.join(tmpDir, 'a.yaml');
    const b = path.join(tmpDir, 'b.yaml');
    const same = 'same: content\n';
    const envA = await writeAndConfirm(a, same, () => true);
    const envB = await writeAndConfirm(b, same, () => true);
    // HashHint is deterministic for a given content + per-install key
    expect(envA.hashHint).toBe(envB.hashHint);
  });

  it('hashHint is 12 hex characters (truncated HMAC-SHA256)', () => {
    const hint = computeHashHint('any content');
    expect(hint).toMatch(/^[0-9a-f]{12}$/);
    expect(hint.length).toBe(12);
  });

  it('SECURITY: thrown error does not include file path or content', async () => {
    tmpDir = mktemp();
    const secretName = 'super-secret-route-name-that-should-not-leak';
    const filePath = path.join(tmpDir, `${secretName}.yaml`);
    const secretContent = `gate: ${secretName}\n`;
    try {
      await writeAndConfirm(filePath, secretContent, () => false);
      expect.fail('expected throw');
    } catch (err) {
      const msg = String((err as Error).message);
      expect(msg).not.toContain(secretName);
      expect(msg).not.toContain(secretContent);
      expect(msg).not.toContain(filePath);
    }
  });

  it('overwrites existing file atomically', async () => {
    tmpDir = mktemp();
    const filePath = path.join(tmpDir, 'out.yaml');
    fs.writeFileSync(filePath, 'before\n');
    const env = await writeAndConfirm(filePath, 'after\n', () => true);
    expect(env.written).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('after\n');
  });
});
