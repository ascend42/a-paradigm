/**
 * Paradigm University — first-party content pack (`id: paradigm`).
 *
 * 7.0.0: the standalone University UI + Express server were retired. The pack
 * content (notes, quizzes, learning paths, PLSAT) is read through
 * `@a-company/university-core` and shown in the Paradigm Platform's Academy
 * section. This module only locates the pack on disk.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

/** Absolute path to this package's root (where pack.yaml lives). */
export function universityPackRoot(): string {
  // dist/index.js and src/index.ts are both one level below the package root.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** Absolute path to the bundled content base (`src/content`). */
export function universityContentDir(): string {
  return path.join(universityPackRoot(), 'src', 'content');
}
