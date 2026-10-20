// @gnomon-platform: darwin, linux
/**
 * #shell-readonly against a REAL filesystem (Aegis H2/H3/H4 re-check of TD-2026-10-20-294 part 1): symlinks out of
 * the repo, glob expansion at classification time, the deepest-existing-ancestor realpath, the realpath'd cd and the
 * founder's loop in its safe form. POSIX symlinks and shell-quoted posix paths, so darwin and linux; the pure
 * classifier table runs on every OS in shell-readonly.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifyReadOnly, MAX_EXPANSIONS } from '../src/kernel/supervisor/shell-readonly.js';

let base = '';
let repo = '';
let home = '';
let outside = '';
const ro = (c: string) => classifyReadOnly(c, { roots: [repo], home, gnomonHome: path.join(home, '.gnomon'), platform: process.platform, readRoots: [] });
/** The same with the default system read roots (/usr, /etc, /tmp, ...). */
const roSys = (c: string) => classifyReadOnly(c, { roots: [repo], home, gnomonHome: path.join(home, '.gnomon'), platform: process.platform });

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-ro-fs-'));
  repo = path.join(base, 'repo');
  home = path.join(base, 'home');
  outside = path.join(base, 'outside');
  for (const d of [repo, home, outside, path.join(home, '.ssh'), path.join(repo, 'src'), path.join(repo, 'entries'), path.join(repo, 'many'), path.join(repo, 'dash')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'KEY');
  fs.writeFileSync(path.join(outside, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'a');
  fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'b');
  for (const n of ['2026-10-01', '2026-10-02']) {
    fs.mkdirSync(path.join(repo, 'entries', n));
    fs.writeFileSync(path.join(repo, 'entries', n, 'meta.yaml'), 'status: open\n');
  }
  for (let i = 0; i <= MAX_EXPANSIONS; i++) fs.writeFileSync(path.join(repo, 'many', `f${i}.txt`), '');
  fs.writeFileSync(path.join(repo, 'dash', '-r'), '');
  fs.writeFileSync(path.join(repo, 'dash', 'ok.txt'), '');
  fs.symlinkSync(path.join(home, '.ssh'), path.join(repo, 'sshdir'));
  fs.symlinkSync(path.join(home, '.ssh', 'id_rsa'), path.join(repo, 'src', 'key.ts'));
  fs.symlinkSync(outside, path.join(repo, 'out'));
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('#shell-readonly on a real filesystem', () => {
  it("the founder's loop in its safe form (a literal glob, no $(…)) passes", () => {
    expect(ro(`cd '${path.join(repo, 'entries')}' && for f in 2026-10-*; do echo "$f: $(grep -m1 '^status:' $f/meta.yaml | awk '{print $2}')"; done`)).toEqual({ ok: true });
  });
  it('a literal glob loop is refused when one match is a symlink out of the roots', () => {
    fs.symlinkSync(path.join(home, '.ssh'), path.join(repo, 'entries', '2026-10-99'));
    try {
      expect(ro(`cd '${path.join(repo, 'entries')}' && for f in 2026-10-*; do cat $f/meta.yaml; done`)).toMatchObject({ ok: false, why: 'protected path' });
    } finally {
      fs.unlinkSync(path.join(repo, 'entries', '2026-10-99'));
    }
  });
  it('H2: a symlinked file, a symlinked dir and a missing path below one are checked at their realpath', () => {
    expect(ro(`cd '${repo}' && cat sshdir/id_rsa`)).toMatchObject({ ok: false, why: 'protected path' });
    expect(ro(`cd '${repo}' && cat sshdir/missing`)).toMatchObject({ ok: false, why: 'protected path' });
    expect(ro(`cd '${repo}' && cat src/key.ts`)).toMatchObject({ ok: false, why: 'protected path' });
    expect(ro(`cd '${repo}' && cat out/notes.txt`)).toMatchObject({ ok: false, why: 'outside the readable roots' });
    expect(ro(`cat '${path.join(repo, 'out', 'nope', 'deeper')}'`)).toMatchObject({ ok: false, why: 'outside the readable roots' });
    expect(ro(`cd '${repo}' && cat src/a.ts src/b.ts`)).toEqual({ ok: true });
  });
  it('H2: a glob is expanded now and every match checked; > MAX_EXPANSIONS matches is refused', () => {
    expect(ro(`cd '${repo}' && cat src/*`)).toMatchObject({ ok: false, why: 'protected path' });
    expect(ro(`cd '${repo}' && wc -l src/[ab].ts`)).toEqual({ ok: true });
    expect(ro(`cd '${repo}' && cat s?c/a.ts`)).toEqual({ ok: true });
    expect(ro(`cd '${repo}' && ls many/*.txt`)).toMatchObject({ ok: false, why: `glob: more than ${MAX_EXPANSIONS} matches` });
    expect((ro(`cd '${repo}' && cat .*`) as { why: string }).why).toMatch(/protected path|outside the readable roots/);
    expect(ro(`cd '${repo}' && cat **/a.ts`)).toMatchObject({ ok: false, why: 'glob: **' });
  });
  it('H2: a glob match that starts with - (a planted `-r`) is refused', () => {
    expect(ro(`cd '${path.join(repo, 'dash')}' && grep x *`)).toMatchObject({ ok: false, why: 'an expanded value starts with -' });
    expect(ro(`cd '${path.join(repo, 'dash')}' && grep x ./*`)).toEqual({ ok: true });
  });
  it('H2: diff never takes a directory operand (it would read the files inside, unchecked)', () => {
    expect(ro(`cd '${repo}' && diff src entries`)).toMatchObject({ ok: false, why: 'diff: a directory operand' });
    expect(ro(`cd '${repo}' && diff src/a.ts src`)).toMatchObject({ ok: false, why: 'diff: a directory operand' });
    expect(ro(`cd '${repo}' && diff src/a.ts src/b.ts`)).toEqual({ ok: true });
  });
  it('H4: the system read roots are readable by default, and readRoots can only narrow them', () => {
    expect(roSys('cat /etc/hosts')).toEqual({ ok: true });
    expect(roSys('ls /usr/bin')).toEqual({ ok: true });
    expect(ro('cat /etc/hosts')).toMatchObject({ ok: false, why: 'outside the readable roots' });
    expect(classifyReadOnly('ls /sbin', { roots: [repo], home, gnomonHome: path.join(home, '.gnomon'), readRoots: ['/sbin'] })).toMatchObject({ ok: false, why: 'outside the readable roots' });
  });
  it('H3: cd resolves to its realpath, so a symlinked dir out of the roots is refused', () => {
    expect(ro(`cd '${path.join(repo, 'out')}' && ls`)).toMatchObject({ ok: false, why: 'cd: outside the session roots' });
    expect(ro(`cd '${path.join(repo, 'src')}' && cat ../entries/2026-10-01/meta.yaml`)).toEqual({ ok: true });
  });
});
