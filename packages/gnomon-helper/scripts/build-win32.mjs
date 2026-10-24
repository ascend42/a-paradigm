#!/usr/bin/env node
// Build the Windows helper (P8-D71): cargo build --release --locked in win32/, copy the exe to
// bin/win32/gnomon-helper.exe (gitignored) and record its sha256 in checksums.json (advisory; G-HLP-01 is wired
// through the release manifest, as on darwin).
//
//   node packages/gnomon-helper/scripts/build-win32.mjs            unsigned (dev; the dev kernel pins it by sha256)
//
// Signing (Authenticode via Azure Trusted Signing) is W7 (docs/plans/gnomon-windows.md); a release kernel refuses
// an unsigned helper.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = join(ROOT, 'win32');
if (process.platform !== 'win32') {
  console.error('build-win32: run this on Windows (x64, MSVC toolchain)');
  process.exit(64);
}
execFileSync('cargo', ['build', '--release', '--locked'], { cwd: CRATE, stdio: 'inherit' });
const built = join(CRATE, 'target', 'release', 'gnomon-helper.exe');
const outDir = join(ROOT, 'bin', 'win32');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'gnomon-helper.exe');
copyFileSync(built, out);
const sha256 = createHash('sha256').update(readFileSync(out)).digest('hex');
const version = execFileSync(out, ['--version'], { encoding: 'utf8' }).trim();
const sumsPath = join(ROOT, 'checksums.json');
const sums = existsSync(sumsPath) ? JSON.parse(readFileSync(sumsPath, 'utf8')) : { schema: 'gnomon-helper-checksums:v1', binaries: {} };
sums.binaries ??= {};
sums.binaries['bin/win32/gnomon-helper.exe'] = { sha256, version: version.split(' ')[1], signed: false };
writeFileSync(sumsPath, `${JSON.stringify(sums, null, 2)}\n`);
console.log(`${version}\n${out}\nsha256 ${sha256} (unsigned)`);
