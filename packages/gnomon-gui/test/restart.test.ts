/**
 * TD-2026-10-19-063 #gui restart: the banner names only the upgrade card, the marker is single use, a resume token
 * is stored only into an existing marker, and the origin poll gives up with guidance.
 */
import { describe, expect, it } from 'vitest';
import { isUpgradeCard, markRestarting, noteResume, restarting, RESTART_GUIDANCE, takeRestart, upgradeBannerOf, waitForOrigin, type StorageLike } from '../src/core/restart.js';

const mem = (): StorageLike & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const TOKEN = 'A'.repeat(43);
const KEY = 'MCowBQYDK2VwAyEA' + 'b'.repeat(43);

describe('#gui restart', () => {
  it('banner: only a daemon-stop card with reason upgrade', () => {
    expect(isUpgradeCard({ kind: 'daemon-stop', card: { detail: { reason: 'upgrade' } } })).toBe(true);
    expect(isUpgradeCard({ kind: 'daemon-stop', card: { detail: { reason: 'stop' } } })).toBe(false);
    expect(isUpgradeCard({ kind: 'permission', card: { detail: { reason: 'upgrade' } } })).toBe(false);
    expect(upgradeBannerOf([{ cardId: 'c1', kind: 'daemon-stop', card: { lines: ['x', 'reason: upgrade'] } }])).toEqual({ text: 'Gnomon was updated', cardId: 'c1' });
    expect(upgradeBannerOf([])).toBeNull();
  });

  it('gui.resume is kept only inside a marker this page set; the marker is taken once', () => {
    const s = mem();
    expect(noteResume(s, { resumeToken: TOKEN, kernelPublicKey: KEY })).toBe(false);
    expect(s.m.size).toBe(0);
    markRestarting(s, 'c1');
    expect(restarting(s)).toBe(true);
    expect(noteResume(s, { resumeToken: 'short', kernelPublicKey: KEY })).toBe(false);
    expect(noteResume(s, { resumeToken: TOKEN, kernelPublicKey: KEY })).toBe(true);
    expect(takeRestart(s)).toEqual({ resumeToken: TOKEN, kernelPublicKey: KEY });
    expect(takeRestart(s)).toBeNull();
    expect(restarting(s)).toBe(false);
  });

  it('a marker without a token reloads to a plain page (no resume form)', () => {
    const s = mem();
    markRestarting(s, 'c1');
    expect(takeRestart(s)).toBeNull();
  });

  it('origin poll: true once it answers; false after the tries (then guidance in plain words)', async () => {
    let n = 0;
    const sleep = async () => undefined;
    expect(await waitForOrigin(async () => ({ ok: ++n >= 3 }), 'http://127.0.0.1:1', { sleep, tries: 5 })).toBe(true);
    expect(await waitForOrigin(async () => { throw new Error('down'); }, 'http://127.0.0.1:1', { sleep, tries: 3 })).toBe(false);
    expect(RESTART_GUIDANCE).toMatch(/Gnomon\.app/);
  });
});
