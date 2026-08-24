/**
 * #reserved-names — the ONE normalizer behind every reserved-path-component
 * decision (C-3, CVE-2014-9390 class).
 *
 * `restore` writes tree bytes to disk, and a tree entry named `.git` would
 * overwrite a real git repo — `.git/hooks/post-commit` is arbitrary code
 * execution on the victim's next commit. The guard used to be an exact-match,
 * case-SENSITIVE Set, which is the 2013 version of git's: on a case-insensitive
 * filesystem (macOS by default, Windows always) `.GIT` IS `.git`, and the
 * demonstrated attack wrote a hook into the real `.git` and watched it fire.
 * `.WARPLINE` likewise overwrote a live ledger.
 *
 * Git fixed this in 2014 with `is_hfs_dotgit()` / `is_ntfs_dotgit()` and the
 * `core.protectHFS` / `core.protectNTFS` defaults. This module is the equivalent:
 * a name is folded to a CANONICAL form before it is ever looked up, so every
 * filesystem-equivalent spelling collapses onto the reserved name.
 *
 * Folding, in order:
 *   1. NFC — a decomposed spelling must not slip past a composed lookup.
 *   2. Drop HFS+-IGNORABLE codepoints. HFS+ ignores these entirely when comparing
 *      filenames, so `.gi<U+200C>t` genuinely opens `.git` (git's `next_hfs_char`).
 *   3. Strip trailing dots and spaces — Win32 strips them when RESOLVING a path,
 *      so `.git ` and `.git.` both reach `.git`.
 *   4. Case-fold.
 *   5. Recognize `~N` 8.3 SHORTNAMES: Windows derives one by taking the long name
 *      minus leading dots, truncating to 6 chars, and appending `~N` — so `.git`
 *      is reachable as `GIT~1` and `.warpline` as `WARPLI~1`.
 *
 * Deliberately NOT over-broad: `.gitignore`, `.gitattributes`, `git-notes.md` and
 * `g~1` are ordinary files and must keep working. Over-blocking is its own defect
 * here — these same predicates decide what a SNAPSHOT ingests, so a false positive
 * silently drops a real file from the tree.
 *
 * KNOWN GAP (matches this fix's scope): NTFS *hashed* shortnames (`GI7EBA~1`,
 * emitted only on an 8.3 basis collision) are not modeled.
 *
 * Library code: pure predicates, no I/O, no console output.
 */

/**
 * Codepoints HFS+ ignores when comparing filenames — git's `next_hfs_char` list
 * (zero-width joiners, bidi controls, and the BOM).
 */
const HFS_IGNORABLE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g;

/** `<basis>~<n>` — the Win32 8.3 shortname shape. */
const SHORTNAME = /^(.*)~\d+$/;

/**
 * Names already in canonical form: pure lowercase ASCII from a safe subset, with
 * no trailing dot. For these the fold below is provably the identity, so the
 * lookup can skip it. PURE OPTIMIZATION — the slow path is authoritative, and
 * this covers essentially every real filename.
 */
const ALREADY_CANONICAL = /^[a-z0-9._-]*$/;

/**
 * Fold a single path COMPONENT to the form reserved-name lookups compare against.
 * Never used to write a path — only ever to decide whether one is reserved.
 */
export function normalizeReservedName(name: string): string {
  return name
    .normalize('NFC')
    .replace(HFS_IGNORABLE, '')
    .replace(/[. ]+$/, '')
    .toLowerCase();
}

/**
 * Does this path component resolve to one of `reserved` on ANY filesystem we may
 * be restored onto? `reserved` entries must already be lowercase.
 */
export function matchesReservedName(name: string, reserved: ReadonlySet<string>): boolean {
  if (ALREADY_CANONICAL.test(name) && !name.endsWith('.')) return reserved.has(name);

  const folded = normalizeReservedName(name);
  if (folded.length === 0) return false;
  if (reserved.has(folded)) return true;

  // 8.3 shortname: `GIT~1` → basis `git`, which is `.git`'s 6-char basis.
  const m = SHORTNAME.exec(folded);
  if (m !== null) {
    const basis = m[1];
    // A basis under 3 chars is never Win32-generated; refusing it would block
    // ordinary names like `g~1` for nothing.
    if (basis.length >= 3) {
      for (const r of reserved) {
        if (r.replace(/^\.+/, '').startsWith(basis)) return true;
      }
    }
  }
  return false;
}

/**
 * Component names a restored tree must NEVER contain — restoring one would
 * overwrite a real git repo (`.git`) or Warpline's own store (`.warpline`). A
 * tree entry carrying such a name is a forged/corrupt tree, not a restorable state.
 */
export const RESTORE_FORBIDDEN: ReadonlySet<string> = new Set(['.git', '.warpline']);

/** Is this path component forbidden in a restored tree (any spelling)? */
export function isRestoreForbiddenName(name: string): boolean {
  return matchesReservedName(name, RESTORE_FORBIDDEN);
}

/** Does any component of this posix path resolve to a restore-forbidden name? */
export function pathHasRestoreForbiddenName(relPath: string): boolean {
  return relPath.split('/').some(isRestoreForbiddenName);
}
