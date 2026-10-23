// p01-claude-cli — Arky P01 (research 29 §2; spec §19.1 M1.0 P01, §3.3, OPEN 8).
// READ-ONLY and free: records `claude --version` and checks `claude --help` for
// the flags the #claude-adapter spawn line (§3.3) depends on. It never starts a
// session (no paid turn). The live items — hook stdin session_id, the
// stream-json control_request interrupt, --setting-sources semantics, the
// loopback-override refusal — are recorded as pending-manual.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const specRefs = ['§3.3 spawn line', '§3.3 FORBIDDEN_FLAGS', '§10 law 7', '§19.1 M1.0 P01', 'OPEN 8', 'G-SUB-01', 'research 29 §2 P01'];

const MIN_VERSION = [2, 1, 288]; // OPEN 8: "hook stdin session_id on 2.1.288+"

function findClaude() {
  const w = spawnSync('/usr/bin/which', ['claude'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return { path: w.stdout.trim(), via: 'PATH' };
  for (const p of [path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (existsSync(p)) return { path: p, via: 'known-location (not on PATH)' };
  }
  return null;
}

// ── win32 arm (W1, docs/plans/gnomon-windows.md) ─────────────────────────────
// The kernel never looks at PATH: it takes the first existing entry of the
// win32 `knownBinaries` row in src/platform/claude-code.ts. The probe reads that
// row from the source (no build step), resolves it the same way, and also
// surveys every other place a claude.exe or npm shim could live, so the
// location rule is decided on what is actually on disk.
const KERNEL_REGISTRY = fileURLToPath(new URL('../../src/platform/claude-code.ts', import.meta.url));

function kernelWin32Row() {
  const src = readFileSync(KERNEL_REGISTRY, 'utf8');
  const m = /win32:\s*\{[\s\S]*?knownBinaries:\s*\[([^\]]*)\]/.exec(src);
  if (!m) return { source: KERNEL_REGISTRY, knownBinaries: null };
  return { source: 'packages/gnomon/src/platform/claude-code.ts', knownBinaries: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
}

const expandHome = (p) => (p.startsWith('~/') ? path.join(os.homedir(), ...p.slice(2).split('/')) : p);
const tilde = (p) => (p.toLowerCase().startsWith(os.homedir().toLowerCase()) ? `~${p.slice(os.homedir().length).replace(/\\/g, '/')}` : p);
const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'x86' };

function describe(p) {
  const d = { path: tilde(p), exists: existsSync(p) };
  if (!d.exists) return d;
  const ls = lstatSync(p);
  d.symlink = ls.isSymbolicLink();
  if (d.symlink) {
    try { d.linkTarget = tilde(readlinkSync(p)); } catch (e) { d.linkTarget = `unreadable: ${e.code}`; }
  }
  const st = statSync(p);
  d.bytes = st.size;
  d.mtime = st.mtime.toISOString();
  const head = Buffer.alloc(512);
  const fd = openSync(p, 'r');
  try { readSync(fd, head, 0, 512, 0); } finally { closeSync(fd); }
  if (head[0] === 0x4d && head[1] === 0x5a) {
    d.kind = 'native-pe';
    const peOff = head.readUInt32LE(0x3c);
    if (peOff + 6 <= 512 && head.toString('latin1', peOff, peOff + 4) === 'PE\0\0') d.machine = PE_MACHINE[head.readUInt16LE(peOff + 4)] ?? `0x${head.readUInt16LE(peOff + 4).toString(16)}`;
  } else {
    const text = head.toString('utf8');
    d.kind = /node_modules[\\/]@anthropic-ai[\\/]claude-code/.test(text) || /\.(cmd|ps1)$/i.test(p) || text.startsWith('#!') ? 'npm-shim' : 'other';
  }
  if (d.kind === 'native-pe') {
    const v = spawnSync(p, ['--version'], { encoding: 'utf8', timeout: 20_000 });
    d.version = (v.stdout || '').trim() || null;
    if (v.error) d.versionError = v.error.code ?? v.error.message;
  }
  return d;
}

function win32Locate() {
  const row = kernelWin32Row();
  const kernel = (row.knownBinaries ?? []).map((k) => ({ entry: k, ...describe(expandHome(k)) }));
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  const pkgRoot = path.join(local, 'Microsoft', 'WinGet', 'Packages');
  const wingetPackages = existsSync(pkgRoot) ? readdirSync(pkgRoot).filter((n) => /^Anthropic\.ClaudeCode_/i.test(n)) : [];
  const survey = [
    ...wingetPackages.map((n) => path.join(pkgRoot, n, 'claude.exe')),
    path.join(local, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.claude', 'local', 'claude.exe'),
    path.join(roaming, 'npm', 'claude.cmd'),
    path.join(roaming, 'npm', 'claude.ps1'),
    path.join(roaming, 'npm', 'claude'),
  ].map(describe);
  const where = spawnSync('where.exe', ['claude'], { encoding: 'utf8' });
  const pathHits = where.status === 0 ? where.stdout.split(/\r?\n/).filter(Boolean) : [];
  const hit = kernel.find((k) => k.exists);
  const selected = hit ? { path: expandHome(hit.entry), via: `kernel knownBinaries[${kernel.indexOf(hit)}] (claude-code.ts win32 row; never PATH)` } : null;
  const parse = (s) => (/(\d+)\.(\d+)\.(\d+)/.exec(s ?? '') ?? []).slice(1, 4).map(Number);
  const found = [...kernel, ...survey].filter((d) => d.version);
  const newest = found.reduce((a, d) => (!a || cmp(parse(d.version), parse(a.version)) > 0 ? d : a), null);
  return {
    selected,
    evidence: {
      kernelRow: row,
      kernelCandidates: kernel,
      survey,
      wingetPackageDirs: wingetPackages,
      pathLookup: { firstOnPath: pathHits[0] ? tilde(pathHits[0]) : null, all: pathHits.map(tilde), usedByKernel: false },
      kernelPick: hit ? { path: hit.path, kind: hit.kind, machine: hit.machine, version: hit.version } : null,
      newestOnDisk: newest ? { path: newest.path, version: newest.version } : null,
      kernelPickIsNewest: !!hit && !!newest && hit.version === newest.version,
      kernelPickIsFirstOnPath: !!hit && !!pathHits[0] && path.resolve(pathHits[0]).toLowerCase() === path.resolve(expandHome(hit.entry)).toLowerCase(),
      npmShimPresent: survey.some((d) => d.exists && d.kind === 'npm-shim'),
    },
  };
}

const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// The help text wraps descriptions; collect each flag's block of lines.
function flagBlock(help, flag) {
  const lines = help.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^\\s*(-\\w, )?${flag.replace(/-/g, '\\-')}(\\W|$)`).test(l));
  if (i < 0) return null;
  const block = [lines[i]];
  for (let j = i + 1; j < lines.length && /^\s{20,}\S/.test(lines[j]); j++) block.push(lines[j]);
  return block.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
}

export default async function probe(ctx = {}) {
  const w32 = (ctx.platform ?? process.platform) === 'win32' ? win32Locate() : null;
  const found = w32 ? w32.selected : findClaude();
  if (!found) return { verdict: 'fail', evidence: { claudeFound: false, ...(w32 ? { win32: w32.evidence } : {}) } };
  const ver = spawnSync(found.path, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  const help = spawnSync(found.path, ['--help'], { encoding: 'utf8', timeout: 20_000 });
  const versionLine = (ver.stdout || '').trim();
  const v = (/(\d+)\.(\d+)\.(\d+)/.exec(versionLine) ?? []).slice(1, 4).map(Number);
  const versionOk = v.length === 3 && cmp(v, MIN_VERSION) >= 0;
  const text = help.stdout || '';

  const wanted = [
    '--print',
    '--setting-sources',
    '--resume',
    '--fork-session',
    '--output-format',
    '--input-format',
    '--include-partial-messages',
    '--replay-user-messages',
    '--verbose',
    '--mcp-config',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  const flags = Object.fromEntries(wanted.map((f) => [f, flagBlock(text, f)]));
  const present = Object.fromEntries(wanted.map((f) => [f, flags[f] !== null]));
  const streamJsonOut = /stream-json/.test(flags['--output-format'] ?? '');
  const streamJsonIn = /stream-json/.test(flags['--input-format'] ?? '');
  const settingSourcesValues = (/\(([^)]*)\)/.exec(flags['--setting-sources'] ?? '') ?? [])[1] ?? null;
  // §3.3 FORBIDDEN_FLAGS — still exist in this CLI (so the throw-check is meaningful).
  const forbidden = Object.fromEntries(['--dangerously-skip-permissions', '--allowedTools', '--bare'].map((f) => [f, flagBlock(text, f) !== null]));

  const allFlags = Object.values(present).every(Boolean) && streamJsonOut && streamJsonIn;
  return {
    verdict: !allFlags || !versionOk ? 'fail' : 'partial',
    evidence: {
      claude: { path: found.path.replace(os.homedir(), '~'), via: found.via, version: versionLine, minRequired: MIN_VERSION.join('.'), versionOk },
      flagsPresent: present,
      flagHelp: flags,
      streamJson: { output: streamJsonOut, input: streamJsonIn },
      settingSourcesDocumentedValues: settingSourcesValues,
      forbiddenFlagsStillExist: forbidden,
      ...(w32 ? { win32: w32.evidence } : {}),
      pendingManual: {
        hookStdinSessionId: 'Run one interactive/`-p` turn with a SessionStart/PreToolUse hook that dumps stdin; confirm `session_id` is present on 2.1.288+ (OPEN 8). Costs one turn.',
        controlRequestInterrupt: 'Spawn the §3.3 stream-json line, send {"type":"control_request","request_id":"…","request":{"subtype":"interrupt"}} mid-turn; record the control_response and that the turn stops (A23-4, G-RUN-03). Costs one turn.',
        settingSourcesSemantics: 'Verify which layers `--setting-sources user,project,local` (and an empty list) actually load, and whether managed settings and CLAUDE.md are unaffected (§3.3 layersHash). Help text lists only user, project, local.',
        loopbackOverrideRefusal: 'G-SUB-01 / law 7: confirm ANTHROPIC_BASE_URL pointing at loopback is refused by the adapter preflight (kernel-side; needs the adapter).',
        resumeForkAcrossMachines: 'research 31: transplant a transcript + `--resume`/`--fork-session` across machines/OS.',
        runInsideSessionProfile: 'p10m claudeCompat: a real `claude -p` Bash turn under the session sandbox profile.',
      },
    },
    toolVersions: { claude: versionLine },
  };
}
