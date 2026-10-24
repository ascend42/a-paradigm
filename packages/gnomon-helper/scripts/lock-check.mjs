#!/usr/bin/env node
// Guided 1-second disarm check for the signed gnomon-helper 1.6.0 (T-2026-10-19-026).
// The automated form of the README "Manual oracle": open a voice arm (Touch ID), then lock,
// sleep and fast-user-switch, and check that the helper drops the arm and pushes `session`.
//
//   node packages/gnomon-helper/scripts/lock-check.mjs            (three rounds, three Touch ID prompts)
//   node packages/gnomon-helper/scripts/lock-check.mjs --no-arm   (handshake and session probe only)
//
// Latency method: the push carries no timestamp, and this script cannot see the keypress.
// It polls the console session (`/usr/sbin/ioreg -n Root -d1`, IOConsoleUsers: the same
// CGSession dictionary the helper polls) back to back, and brackets the moment the session
// flipped to locked / off console between two samples. Latency = push arrival minus that
// moment, shown as a range. Sleep suspends this process, so a sleep push is timed only if
// a lock flip was seen first. Result JSON: ~/.gnomon/lock-check-<date>.json.

import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER = resolve(HERE, '../bin/darwin/GnomonHelper.app/Contents/MacOS/gnomon-helper');
const UID = process.getuid();
const now = () => performance.now();

const ROUNDS = [
  { name: 'screen lock', todo: 'Lock your screen now (Ctrl-Cmd-Q), wait ~5 s, then unlock.', accept: ['screen-lock', 'screensaver'] },
  { name: 'sleep', todo: 'Close the lid (or Apple menu > Sleep), wait ~10 s, then wake and unlock.', accept: ['system-sleep', 'display-sleep', 'screen-lock'] },
  { name: 'user switch', todo: 'Fast user switch to the login window (menu bar user menu > Login Window...), then log back in.', accept: ['user-switch', 'screen-lock'] },
];

const say = (s = '') => process.stdout.write(s + '\n');
const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function fail(msg) {
  say(`\n${msg}`);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('This check runs on macOS only.');
if (!existsSync(HELPER)) fail(`No built helper at ${HELPER}\nBuild it first: node packages/gnomon-helper/scripts/build-darwin.mjs`);

// ---- console session probe (ioreg) ----------------------------------------------------------

function sessionSample() {
  const t0 = now();
  return new Promise((res) => {
    execFile('/usr/sbin/ioreg', ['-n', 'Root', '-d1'], { maxBuffer: 1 << 20 }, (err, out) => {
      const t1 = now();
      if (err) return res({ t0, t1, usable: false, known: false });
      const line = out.split('\n').find((l) => l.includes('"IOConsoleUsers"')) ?? '';
      const mine = (line.match(/\{[^{}]*\}/g) ?? []).find((d) => d.includes(`"kCGSSessionUserIDKey"=${UID}`));
      if (!mine) return res({ t0, t1, usable: false, known: true, locked: false, onConsole: false });
      const locked = /"CGSSessionScreenIsLocked"=Yes/.test(mine);
      const onConsole = /"kCGSSessionOnConsoleKey"=Yes/.test(mine);
      res({ t0, t1, usable: !locked && onConsole, known: true, locked, onConsole });
    });
  });
}

/** Polls the session back to back while `active`; remembers the first usable -> unusable flip. */
function startWatch() {
  const w = { active: true, last: null, flip: null, samples: 0, spanSum: 0 };
  (async () => {
    while (w.active) {
      const s = await sessionSample();
      w.samples++;
      w.spanSum += s.t1 - s.t0;
      if (!w.flip && w.last?.usable && !s.usable) {
        // the flip happened after the last usable sample started reading, before this one finished
        w.flip = { after: w.last.t0, before: s.t1, locked: s.locked, onConsole: s.onConsole };
      }
      w.last = s;
    }
  })();
  return w;
}

// ---- helper client --------------------------------------------------------------------------

const helper = spawn(HELPER, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
let helperExited = null;
const exitWaiters = [];
helper.on('exit', (code, signal) => {
  helperExited = { code, signal, t: now() };
  for (const r of exitWaiters) r();
  for (const [, p] of pending) p.reject(new Error('helper exited'));
  pending.clear();
});
helper.on('error', (e) => fail(`Could not start the helper: ${e.message}`));
let stderr = '';
helper.stderr.on('data', (d) => (stderr += d));

let nextId = 1;
const pending = new Map();
const pushes = [];
let pushWaiter = null;
let buf = '';
helper.stdout.on('data', (chunk) => {
  const t = now();
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.push === 'session') {
      const p = { ...msg, t, wall: new Date().toISOString() };
      pushes.push(p);
      pushWaiter?.(p);
    } else if (pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  }
});

function call(op, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    helper.stdin.write(JSON.stringify({ id, op, ...params }) + '\n');
  });
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newArmId() {
  const r = randomBytes(25);
  return 'arm:0' + Array.from(r, (b) => CROCKFORD[b & 31]).join('');
}

// The arm prompt's own message: a fresh approvals-domain decision for a card that does not exist
// (the README oracle's form), so the signature can never approve anything real.
function armMessage(n) {
  const body = `gnomon:approve:v1\ncard:lock-check-${n}\nallow\nsha256:00\nhuman`;
  return Buffer.from(body).toString('base64');
}

const REFUSALS = {
  'session-locked': 'The helper refused: this session is locked or not at the console. Stay logged in at this Mac and run the check again.',
  'arm-invalidated': 'The screen locked or slept while Touch ID was up, so the arm was not kept.',
  'arm-limit': 'The helper already holds the maximum number of arms.',
};

// ---- terminal input --------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin });
let lineWaiter = null;
rl.on('line', (l) => lineWaiter?.(l));
const nextLine = () => new Promise((r) => (lineWaiter = (l) => ((lineWaiter = null), r(l))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the check ---------------------------------------------------------------------------------

const result = {
  task: 'T-2026-10-19-026',
  date: new Date().toISOString(),
  helper: HELPER,
  latencyMethod:
    'push arrival in this process minus the moment /usr/sbin/ioreg (IOConsoleUsers, the CGSession dictionary) first showed the session locked or off console; reported as a range bracketing that flip between two back-to-back samples',
  info: null,
  rounds: [],
  exit: null,
};

function ms(x) {
  return `${Math.round(x)} ms`;
}

async function runRound(i, gen) {
  const r = ROUNDS[i];
  const rec = { round: r.name, status: 'skipped', accept: r.accept };
  result.rounds.push(rec);
  say(`\nRound ${i + 1} of 3: ${r.name}`);
  say('  Touch ID will appear: approve it. (Cancel skips this round.)');

  const armId = newArmId();
  rec.armId = armId;
  const open = await call('arm.open', {
    armId,
    gen,
    humanConnId: 'conn:lock-check-human',
    voiceConnId: 'conn:lock-check-voice',
    hardSeconds: 600,
    maxSignatures: 1,
    reason: `Gnomon lock check, round ${i + 1} (${r.name})`,
    messages: [armMessage(i + 1)],
  });
  if (!open.ok) {
    rec.status = 'arm-refused';
    rec.error = open.error;
    say(`  ${REFUSALS[open.error] ?? `The arm did not open (${open.error}${open.message ? `: ${open.message}` : ''}).`} Round skipped.`);
    return;
  }
  const before = await call('info');
  if (before.arms !== 1) {
    rec.status = 'fail';
    rec.note = `arm opened but info shows arms:${before.arms}`;
    say(`  Odd: the arm opened but the helper reports ${before.arms} arms.`);
    return;
  }

  say(`  Armed. ${r.todo}`);
  say(dim('  (Press Enter to skip this round.)'));

  const seen = pushes.length;
  const watch = startWatch();
  const dropPush = await new Promise((res) => {
    const timer = setTimeout(() => done(null), 5 * 60 * 1000);
    function done(v) {
      clearTimeout(timer);
      pushWaiter = null;
      lineWaiter = null;
      res(v);
    }
    const already = pushes.slice(seen).find((p) => p.arms.includes(armId));
    if (already) return done(already);
    pushWaiter = (p) => p.arms.includes(armId) && done(p);
    lineWaiter = () => done('skip');
  });

  if (dropPush === 'skip') {
    watch.active = false;
    await call('arm.close', { armId });
    rec.status = 'skipped';
    say('  Skipped.');
    return;
  }
  if (!dropPush) {
    watch.active = false;
    await call('arm.close', { armId });
    rec.status = 'fail';
    rec.note = 'no push dropped the arm within 5 minutes';
    say('  No push dropped the arm within 5 minutes.');
    return;
  }

  // wait for the founder to be back (session usable), then ask the helper what it holds
  say(dim('  Push received. Waiting for you to come back...'));
  while (!(await sessionSample()).usable) await sleep(250);
  watch.active = false;
  await sleep(300);
  const after = await call('info');

  const flip = watch.flip && watch.flip.after < dropPush.t + 5000 ? watch.flip : null;
  rec.cause = dropPush.cause;
  rec.pushSeq = dropPush.seq;
  rec.pushWall = dropPush.wall;
  rec.otherCauses = pushes.slice(seen).filter((p) => p !== dropPush).map((p) => p.cause);
  rec.armsAfter = after.arms;
  rec.pollSamples = watch.samples;
  rec.pollMeanMs = watch.samples ? Math.round(watch.spanSum / watch.samples) : null;
  if (flip) {
    rec.latencyMs = { min: Math.round(dropPush.t - flip.before), max: Math.round(dropPush.t - flip.after) };
    rec.flip = flip.onConsole === false ? 'off-console' : 'locked';
  } else {
    rec.latencyMs = null;
    rec.latencyNote =
      i === 1
        ? 'not measurable: the Mac slept before a lock flip was seen, and this process is suspended during sleep (the helper writes the push before it lets the system sleep)'
        : 'no session flip was seen by the poll';
  }
  const causeOk = r.accept.includes(dropPush.cause);
  rec.status = causeOk && after.arms === 0 ? 'pass' : 'fail';
  if (!causeOk) rec.note = `unexpected cause ${dropPush.cause}`;
  if (after.arms !== 0) rec.note = `info shows arms:${after.arms} after the push`;

  const lat = rec.latencyMs ? `push ${ms(rec.latencyMs.min)}..${ms(rec.latencyMs.max)} after the session ${rec.flip === 'off-console' ? 'left the console' : 'locked'}` : 'latency not measurable';
  say(`  ${rec.status === 'pass' ? 'PASS' : 'FAIL'}: dropped by ${dropPush.cause}, arms now ${after.arms}; ${lat}.`);
}

async function main() {
  say('Gnomon helper lock check: an open voice arm must drop within 1 s of a lock, sleep or user switch.');
  say('You only need Touch ID, plus the lock / sleep / switch steps it asks for.\n');

  const info = await call('info');
  result.info = info;
  if (!info.ok || info.protocol !== 'gnomon-helper:v2' || !['1.6.0', '1.7.0'].includes(info.version)) {
    fail(`The helper is not 1.6.0 / v2 (it reports ${info.version} / ${info.protocol}). Rebuild it: node packages/gnomon-helper/scripts/build-darwin.mjs`);
  }
  const signed = info.signing?.identifier === 'gnomon.helper' && info.signing?.team;
  say(`Helper ${info.version} (${info.protocol})${signed ? `, signed ${info.signing.identifier} / ${info.signing.team}` : ', NOT signed (no Secure Enclave keys)'}.`);

  const keys = await call('key.list');
  const gens = (keys.keys ?? []).filter((k) => k.key === 'approvals').map((k) => k.gen);
  if (gens.length === 0) fail('No approvals key on this Mac. Provision one first: node packages/gnomon/dist/cli/gnomon.js identity init --name <you>');
  const roots = new Set((keys.keys ?? []).filter((k) => k.key === 'root').map((k) => k.gen));
  const gen = gens.find((g) => roots.has(g)) ?? gens[0];
  result.gen = gen;

  if (!(await sessionSample()).usable) fail('This session looks locked or not at the console. Run the check while logged in at this Mac.');

  // --no-arm: handshake, key and session checks only (no Touch ID, no rounds)
  if (!process.argv.includes('--no-arm')) for (let i = 0; i < ROUNDS.length; i++) await runRound(i, gen);

  // close stdin: the helper must exit (every arm and unlock ends with it)
  const t0 = now();
  helper.stdin.end();
  if (!helperExited) await Promise.race([new Promise((r) => exitWaiters.push(r)), sleep(3000)]);
  result.exit = helperExited
    ? { exited: true, code: helperExited.code, afterMs: Math.round(helperExited.t - t0) }
    : { exited: false };
  if (!helperExited) helper.kill();

  // summary
  say('\nSummary');
  say('  Round         Result   Cause           Arms after  Latency (push after session flip)');
  for (const r of result.rounds) {
    const lat = r.latencyMs ? `${r.latencyMs.min}..${r.latencyMs.max} ms` : r.status === 'pass' || r.status === 'fail' ? 'n/a' : '';
    say(`  ${r.round.padEnd(13)} ${r.status.toUpperCase().padEnd(8)} ${(r.cause ?? '-').padEnd(15)} ${String(r.armsAfter ?? '-').padEnd(11)} ${lat}`);
  }
  say(`  Helper exit on stdin close: ${result.exit.exited ? `yes (code ${result.exit.code}, ${result.exit.afterMs} ms)` : 'NO (killed)'}`);
  const notes = result.rounds.filter((r) => r.note || r.latencyNote);
  for (const r of notes) say(dim(`  ${r.round}: ${r.note ?? r.latencyNote}`));
  say(dim('  Latency: push arrival minus the ioreg-observed session flip (a range; it cannot see the keypress itself).'));
  const over = result.rounds.filter((r) => r.latencyMs && r.latencyMs.min > 1000);
  if (over.length) say(`  Over 1 s: ${over.map((r) => r.round).join(', ')}.`);

  if (!process.argv.includes('--no-arm')) {
    const dir = join(homedir(), '.gnomon');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `lock-check-${result.date.slice(0, 10)}.json`);
    writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    say(`\nSaved: ${file}`);
  }
  rl.close();
  const ok = result.exit.exited && result.rounds.every((r) => r.status !== 'fail') && over.length === 0;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  say(`\nThe check stopped: ${e.message}${stderr ? `\n${stderr.trim()}` : ''}`);
  helper.kill();
  process.exit(1);
});
