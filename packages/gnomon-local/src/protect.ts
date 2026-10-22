/**
 * @symbol #gnomon-local
 * @symbol #loop-act
 *
 * Protected goal inputs at the tool layer (docs/specs/gnomon-loops.md §3.4, Aegis H2; build plan step 10). A loop
 * act session's config names repo-relative globs (goal.inputs, the config closure, argv-named paths, the callees'
 * sets) plus node_modules anywhere; write_file refuses any target whose path relative to its root matches one,
 * with a result starting PROTECTED_PREFIX. No card: the kernel reads that tool result and the node fails (G-LOOP-22).
 * The glob dialect is the kernel's (kernel/loops/events.ts globToRegExp): `*`, `**`, `?`, `{a,b}`, and a pattern
 * with no wildcard also matches everything beneath it.
 */
export const PROTECTED_PREFIX = 'protected-input:';

export class ProtectedRefused extends Error {}

/** A repo-relative POSIX glob as a RegExp (the kernel's dialect, kept in step by a parity test). */
export function protectGlob(glob: string): RegExp {
  // case-INSENSITIVE always: APFS and NTFS fold case by default, so `TSCONFIG.json` is `tsconfig.json` on disk;
  // over-protecting a differently-cased path on a case-sensitive volume costs nothing
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  let re = '';
  let wild = false;
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      wild = true;
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') {
      wild = true;
      re += '[^/]';
    } else if (c === '{' && g.indexOf('}', i) > i) {
      wild = true;
      const end = g.indexOf('}', i);
      re += `(?:${g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(wild ? `^${re}$` : `^${re}(?:/.*)?$`, 'i');
}

/** Does a repo-relative path (POSIX) hit the protected set? node_modules anywhere always does. */
export function protectedHit(rel: string, globs: readonly RegExp[]): boolean {
  if (rel.split('/').some((c) => c.toLowerCase().replace(/[. ]+$/, '') === 'node_modules')) return true;
  return globs.some((re) => re.test(rel));
}
