/**
 * `_check_severity` must honour `paradigm enforcement resolve --json` whatever
 * its whitespace. The CLI pretty-prints (`"id": "value"`); the hook used to
 * grep only the compact form, so every configured severity was ignored.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const COMMON_SH = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts', 'paradigm-common.sh');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function severities(enforcementJson: string): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-sev-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-sev-bin-'));
  dirs.push(root, bin);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'enforcement.json'), enforcementJson);
  fs.writeFileSync(
    path.join(bin, 'paradigm'),
    `#!/bin/sh
case "$1" in
  enforcement) cat "${path.join(bin, 'enforcement.json')}" ;;
  compliance-check) echo '{"driftedCount":0}' ;;
  internal) echo '[]' ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
  const ids = ['purpose-exists', 'aspect-advisory', 'orchestration-required', 'purpose-coverage', 'not-configured'];
  const script = `cd "${root}"; MODIFIED=""; . "${COMMON_SH}" >/dev/null 2>&1
for id in ${ids.join(' ')}; do echo "$id=$(_check_severity "$id" dflt)"; done
echo "threshold=$ORCH_THRESHOLD"`;
  const r = spawnSync('sh', ['-c', script], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root }, encoding: 'utf8' });
  return Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=') as [string, string]));
}

const MAP = {
  'purpose-exists': 'warn',
  'aspect-advisory': 'off',
  'orchestration-required': 'block',
  'purpose-coverage': 'block',
  orchestrationThreshold: 5,
};
const EXPECTED = {
  'purpose-exists': 'warn',
  'aspect-advisory': 'off',
  'orchestration-required': 'block',
  'purpose-coverage': 'block',
  'not-configured': 'dflt',
  threshold: '5',
};

describe('_check_severity parses enforcement JSON robustly', () => {
  it('pretty-printed JSON (what the CLI emits)', () => {
    expect(severities(JSON.stringify(MAP, null, 2))).toEqual(EXPECTED);
  });
  it('compact JSON', () => {
    expect(severities(JSON.stringify(MAP))).toEqual(EXPECTED);
  });
  it('tabs, CRLF and odd spacing around colons', () => {
    const odd = '{\r\n\t"purpose-exists"  :\t"warn" ,\r\n "aspect-advisory":"off",\n"orchestration-required" : "block",\n"purpose-coverage":   "block",\n "orchestrationThreshold" :  5 }\r\n';
    expect(severities(odd)).toEqual(EXPECTED);
  });
  it('empty output falls back to defaults', () => {
    expect(severities('')).toMatchObject({ 'purpose-exists': 'dflt', threshold: '3' });
  });
});
