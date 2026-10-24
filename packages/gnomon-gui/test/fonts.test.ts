// #gui S1 (critique 2026-10-20 §2 S1.1): the bundled fonts are self-hosted, licensed, and carried byte-exact from
// static/ through scripts/build.mjs into the kernel's embed (gui-bundle.ts), never utf8-decoded or CRLF-stripped.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = path.join(ROOT, 'static', 'fonts');
const EMBED = path.resolve(ROOT, '..', 'gnomon', 'src', 'kernel', 'web', 'gui-bundle.ts');
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

// Fontsource 5.3.0 latin subsets, copied unmodified (@fontsource/jetbrains-mono, @fontsource-variable/fraunces opsz).
const PINNED: Record<string, string> = {
  'JetBrainsMono-Regular.woff2': '14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb',
  'JetBrainsMono-Medium.woff2': 'cb182feeed4d798ff6961d3c79f7026279448fca0676438aaecb21f3fc39553a',
  'JetBrainsMono-SemiBold.woff2': '400c6bfda18d5d14acad1c15d6dcb9f8e13c015e7286317e0b9a482539bef147',
  'Fraunces-opsz-wght.woff2': '7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783',
};

/** The embed's files, decoded from the generated source (the bytes the kernel materializes). */
function embedded(): Map<string, Buffer> {
  const src = readFileSync(EMBED, 'utf8');
  return new Map([...src.matchAll(/^ {2}("[^"]+"):\n {4}"([A-Za-z0-9+/=]*)",$/gm)].map((m) => [JSON.parse(m[1]!) as string, Buffer.from(m[2]!, 'base64')]));
}

describe('#gui bundled fonts (S1)', () => {
  it('ships exactly the comp weights as woff2, unmodified (pinned sha256, wOF2 magic)', () => {
    const woff = readdirSync(FONTS).filter((n) => n.endsWith('.woff2')).sort();
    expect(woff).toEqual(Object.keys(PINNED).sort());
    for (const n of woff) {
      const b = readFileSync(path.join(FONTS, n));
      expect(b.subarray(0, 4).toString('latin1'), n).toBe('wOF2');
      expect(sha(b), n).toBe(PINNED[n]);
    }
  });
  it('each family carries its OFL 1.1 licence next to it, with no Reserved Font Name declared', () => {
    for (const [f, owner] of [['OFL-JetBrainsMono.txt', 'The JetBrains Mono Project Authors'], ['OFL-Fraunces.txt', 'The Fraunces Project Authors']] as const) {
      const t = readFileSync(path.join(FONTS, f), 'utf8');
      expect(t).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(t).toContain(`Copyright 2020 ${owner}`);
      expect(t).not.toMatch(/with Reserved Font Name/i);
      expect(t).not.toContain('\r');
    }
  });
  it('styles.css declares @font-face for every font from fonts/ only (font-src self: no data:, no remote URL)', () => {
    const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
    const srcs = [...css.matchAll(/@font-face\s*\{[^}]*src:\s*url\("([^"]+)"\)\s*format\("woff2"\)/g)].map((m) => m[1]!);
    expect(srcs.sort()).toEqual(Object.keys(PINNED).map((n) => `fonts/${n}`).sort());
    expect(css).not.toMatch(/url\(\s*["']?(data:|https?:|\/\/)/);
    expect(css).toMatch(/--mono: "JetBrains Mono"/);
    expect(css).toMatch(/--title-font: "Fraunces", Georgia, serif;/);
  });
  it('the kernel embed carries every static file byte-exact (fonts raw, licences LF)', () => {
    const emb = embedded();
    for (const n of Object.keys(PINNED)) expect(sha(emb.get(`fonts/${n}`) ?? Buffer.alloc(0)), n).toBe(PINNED[n]);
    for (const f of ['OFL-JetBrainsMono.txt', 'OFL-Fraunces.txt']) expect(emb.get(`fonts/${f}`)?.equals(readFileSync(path.join(FONTS, f))), f).toBe(true);
    expect([...emb.keys()].filter((k) => k.startsWith('fonts/')).sort()).toEqual(readdirSync(FONTS).map((n) => `fonts/${n}`).sort());
  });
});

describe('#gui grain (S1): a bundled SVG file, never a data: URL', () => {
  const svg = readFileSync(path.join(ROOT, 'static', 'grain.svg'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
  it('grain.svg is the comp noise: feTurbulence .9 / 2 octaves, the warm matrix, nothing executable or remote', () => {
    expect(svg).toMatch(/<feTurbulence type="fractalNoise" baseFrequency="\.9" numOctaves="2"\/>/);
    expect(svg).toContain('values="0 0 0 0 .45  0 0 0 0 .4  0 0 0 0 .32  0 0 0 .22 0"');
    expect(svg).not.toMatch(/<script|foreignObject|\son[a-z]+=|href|<image|@import|url\((?!#n\))/i);
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:/);
  });
  it('day draws it under the content from --grain; night has none; the kernel embed carries it', () => {
    expect(css).toMatch(/--grain: url\("grain\.svg"\);/);
    expect(css).toMatch(/--grain: none;/);
    expect(css).toMatch(/\.shell::before \{[^}]*z-index: -1;[^}]*background: var\(--grain\);[^}]*opacity: var\(--grain-opacity\);[^}]*mix-blend-mode: multiply;/);
    expect(css).toMatch(/\.shell \{[^}]*isolation: isolate;/);
    expect(embedded().get('grain.svg')?.toString('utf8')).toBe(svg.replace(/\r\n/g, '\n'));
  });
});
