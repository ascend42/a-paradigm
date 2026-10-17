#!/usr/bin/env node
// G-GUI-10 fixture check: node docs/specs/gnomon-fixtures/check-contrast.mjs
import { readFileSync } from 'node:fs';

const fx = JSON.parse(readFileSync(new URL('./contrast.json', import.meta.url), 'utf8'));
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let failures = 0;
const row = (ok, theme, what, fg, bg, r, min) => {
  if (!ok) failures++;
  process.stdout.write(`${ok ? '✓' : '✕'} ${theme.padEnd(5)} ${what.padEnd(30)} ${fg} on ${bg}  ${r.toFixed(2)}:1 (min ${min})\n`);
};
for (const [theme, t] of Object.entries(fx.themes)) {
  for (const [sname, bg] of Object.entries(t.surfaces)) {
    for (const [name, fg] of Object.entries(t.text)) { const r = ratio(fg, bg); row(r >= fx.thresholds.text, theme, `text ${name} / ${sname}`, fg, bg, r, fx.thresholds.text); }
    for (const [name, fg] of Object.entries(t.nonText)) { const r = ratio(fg, bg); row(r >= fx.thresholds.nonText, theme, `edge ${name} / ${sname}`, fg, bg, r, fx.thresholds.nonText); }
  }
  for (const p of t.pairs) { const min = fx.thresholds[p.kind === 'text' ? 'text' : 'nonText']; const r = ratio(p.fg, p.bg); row(r >= min, theme, p.what, p.fg, p.bg, r, min); }
}
process.stdout.write(failures ? `\n${failures} failing pair(s)\n` : '\nall pairs pass\n');
process.exit(failures ? 1 : 0);
