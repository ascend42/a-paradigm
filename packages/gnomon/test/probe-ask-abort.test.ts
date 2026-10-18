/**
 * #gnomon-probes — founder-run probes clean up when the human hits Ctrl-C AT A
 * PROMPT. On a TTY, readline turns Ctrl-C into a 'SIGINT' event on the
 * Interface (process 'SIGINT' never fires), so probes/_shared/signing.mjs
 * ask() must run the onAbort cleanups itself and exit 130. Runs in a child
 * process with a fake (non-TTY) input, so no terminal is needed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PKG_ROOT } from './helpers.js';

const shared = (f: string) => pathToFileURL(path.join(PKG_ROOT, 'probes', '_shared', f)).href;
const dir = mkdtempSync(path.join(os.tmpdir(), 'gnomon-ask-abort-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function script(marker: string, action: 'sigint' | 'eof') {
  return `
import { PassThrough } from 'node:stream';
import { writeFileSync } from 'node:fs';
import { onAbort } from ${JSON.stringify(shared('abort.mjs'))};
import { ask } from ${JSON.stringify(shared('signing.mjs'))};
onAbort(() => writeFileSync(${JSON.stringify(marker)}, 'cleaned'));
const input = new PassThrough();
ask('question?', {
  input,
  output: new PassThrough(),
  onInterface: (rl) => setImmediate(() => ${action === 'sigint' ? "rl.emit('SIGINT')" : 'input.end()'}),
}).then((a) => { console.log('resolved:' + a); }, (e) => { console.log('rejected:' + e.message); });
`;
}

const runScript = (src: string) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8', timeout: 20_000 });

describe('probes/_shared ask() abort handling', () => {
  it('Ctrl-C at a prompt runs the registered cleanups and exits 130', () => {
    const marker = path.join(dir, 'sigint.marker');
    const r = runScript(script(marker, 'sigint'));
    expect(r.status).toBe(130);
    expect(existsSync(marker)).toBe(true);
  });

  it('a prompt closed with no answer rejects instead of hanging', () => {
    const marker = path.join(dir, 'eof.marker');
    const r = runScript(script(marker, 'eof'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('rejected:prompt closed without an answer');
    expect(existsSync(marker)).toBe(false);
  });
});
