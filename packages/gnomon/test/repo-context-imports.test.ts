/**
 * P8-D97 (Aegis R2/R3): the kernel's re-derivation of Claude Code's `@` import resolver (repo-context.ts
 * importAudit), on POSIX path forms. The resolver must be RE-REVIEWED before Windows parity: drive-letter (`C:\`),
 * extended-length (`\\?\`) and UNC (`\\server\share`) forms, `~` on win32 and case-folded containment are not
 * covered here (G-WIN-05 row in test/platform-registry.ts).
 */
// @gnomon-platform: darwin, linux
import { describe, expect, it } from 'vitest';
import { importAudit, importTargets } from '../src/kernel/supervisor/repo-context.js';

describe('importAudit (POSIX forms)', () => {
  const f = '/r/sub/CLAUDE.md';
  it('Claude grammar: # cut, escaped spaces, ./ ~/ / and bare forms; @@, @#, @/ and punctuation ignored', () => {
    expect(importTargets('@a.md#frag x @./b.md @~/k @/abs/c.md @my\\ file.md @@x @#y @/ @(z)', f, '/h')).toEqual(['/r/sub/a.md', '/r/sub/b.md', '/h/k', '/abs/c.md', '/r/sub/my file.md']);
  });
  it('.. segments are resolved lexically (containment is checked by the caller)', () => {
    expect(importTargets('@../../etc/passwd @./x/../../y', f, '/h')).toEqual(['/etc/passwd', '/r/y']);
  });
  it('an import must follow start-of-text or whitespace (emails are not imports)', () => {
    expect(importTargets('mail me at a@b.c or (@d.md)', f, '/h')).toEqual([]);
  });
  it.each([
    ['%', '@a%2e%2e/x'],
    ['&#64;', '&#64;~/x'],
    ['&#x40; (zero-padded)', '&#x0040;~/x'],
    ['&commat; (any case)', '&COMMAT;~/x'],
  ])('%s ⇒ refuse', (_n, text) => {
    expect(importAudit(text, f, '/h').refuse).not.toBeNull();
  });
});
