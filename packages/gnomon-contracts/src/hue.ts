/**
 * @symbol #gnomon-contracts
 *
 * The ONE project-hue function (critique 2026-10-20 §2 S2.1): the GUI's sessions rail and the kernel's Workshop
 * feed (modhost/feed.ts) both colour a project with projectHue(cwd), so the same project never gets two hues.
 * 0..5 index the six pigments of design-system.yaml gnomon.colour (terracotta, sage, slate, ochre, rose-clay,
 * sea-grey); a project hue is identity only, never state. Pure (the in-house sha256), so it runs in the browser too.
 */
import { sha256 } from './internal.js';

export const PROJECT_HUES = 6;

/** sha256(utf8(key))[0] mod 6. key = the session's cwd (the kernel's session.open payload carries it). */
export function projectHue(key: string): number {
  return sha256(key)[0]! % PROJECT_HUES;
}
