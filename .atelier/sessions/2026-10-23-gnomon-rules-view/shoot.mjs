// Renders the Rules view fixtures (packages/gnomon-gui src/preview/fixtures.ts rules-*) with the installed Chrome's
// headless --screenshot, at 1024 and 1440, day and night. Output goes to refs/shots/ (refs/ is gitignored).
//   node .atelier/sessions/2026-10-23-gnomon-rules-view/shoot.mjs [only-substring]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureUrl, startPreview } from '../../../packages/gnomon-gui/scripts/preview.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'refs', 'shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const only = process.argv[2] ?? '';
mkdirSync(OUT, { recursive: true });
const run = (argv) => new Promise((res) => { const c = spawn(CHROME, argv, { stdio: 'ignore' }); const t = setTimeout(() => c.kill(), 60_000); c.on('exit', (code) => { clearTimeout(t); res(code); }); c.on('error', () => res(-1)); });
const p = await startPreview({ port: 0 });
try {
  const names = p.list.map((f) => f.name).filter((n) => n.startsWith('rules-') && n.includes(only));
  for (const name of names) {
    for (const theme of ['day', 'night']) {
      for (const [w, h] of [[1440, 900], [1024, 720]]) {
        const file = path.join(OUT, `${name}-${w}-${theme}.png`);
        const profile = mkdtempSync(path.join(os.tmpdir(), 'gnomon-rules-'));
        const code = await run(['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, `--window-size=${w},${h}`, '--hide-scrollbars', '--virtual-time-budget=10000', `--screenshot=${file}`, fixtureUrl(p.url, name, theme, 'off')]);
        rmSync(profile, { recursive: true, force: true });
        process.stdout.write(`${code === 0 && existsSync(file) ? '✓' : '✕'} ${path.basename(file)}\n`);
      }
    }
  }
} finally {
  await p.close();
}
