/**
 * keys.test — M3-lite I1 (#keys, TD-2026-08-23-136): Ed25519 agent signing
 * keys, the domain-separated pickId signature primitive, the fail-closed key
 * loaders, and the append-only public registry with its PIN-ONCE signed-from
 * epoch boundary.
 *
 * The postures under test are the load-bearing ones:
 *   - verifyPickIdSig NEVER throws on malformed input — a garbled signature is
 *     `false`, not an exception a caller might soften;
 *   - a key file / registry row we cannot interpret NEVER resolves to a usable
 *     key (tokens.ts fail-closed posture, mirrored);
 *   - the signing-epoch boundary pins ONCE — a second signed-from row is
 *     ignored, because a movable boundary would un-sign history;
 *   - re-mint = append, LATEST row wins (token re-mint semantics);
 *   - private material is 0600 on disk.
 *
 * NEVER against the live fabric — scratch tmp roots only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash, createPrivateKey, sign as rawSign } from 'node:crypto';
import {
  AGENT_KEY_SCHEMA,
  KEY_REGISTRY_SCHEMA,
  KEY_ID_PREFIX,
  STRAND_SIG_DOMAIN,
  computeKeyId,
  generateAgentKey,
  signPickId,
  verifyPickIdSig,
  loadAgentKey,
  loadAgentKeyStrict,
  readKeyRegistry,
  registryKeyFor,
  signedFromOf,
  hasSignedFrom,
  mintAgentKey,
  listKeySummaries,
  agentKeyPathOf,
  keyRegistryPathOf,
  isPrincipalName,
} from '../src/fabric/keys.js';
import { writeRef } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-keys-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const PICK_A = 'pick:v3:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PICK_B = 'pick:v3:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/* ── sign / verify ───────────────────────────────────────────────────────────── */

describe('#keys — the domain-separated pickId signature', () => {
  it('round-trips: a signature by a key verifies under that key for that pickId', () => {
    const key = generateAgentKey();
    const sig = signPickId(key.privateKeyPem, PICK_A);
    expect(verifyPickIdSig(key.publicKeyPem, PICK_A, sig)).toBe(true);
  });

  it('a WRONG key does not verify', () => {
    const alice = generateAgentKey();
    const mallory = generateAgentKey();
    const sig = signPickId(alice.privateKeyPem, PICK_A);
    expect(verifyPickIdSig(mallory.publicKeyPem, PICK_A, sig)).toBe(false);
  });

  it('MALFORMED signatures return false — never throw', () => {
    const key = generateAgentKey();
    const good = signPickId(key.privateKeyPem, PICK_A);
    for (const bad of [
      '', // empty
      'not-base64-!!!', // garbage
      'AAAA', // too short to be an Ed25519 sig
      good.slice(0, -8), // truncated
      (good[10] === 'A' ? good.slice(0, 10) + 'B' : good.slice(0, 10) + 'A') + good.slice(11), // flipped byte
    ]) {
      expect(() => verifyPickIdSig(key.publicKeyPem, PICK_A, bad)).not.toThrow();
      expect(verifyPickIdSig(key.publicKeyPem, PICK_A, bad), JSON.stringify(bad)).toBe(false);
    }
    // …and a NON-KEY public PEM is also false, not a throw
    expect(verifyPickIdSig('not a pem at all', PICK_A, good)).toBe(false);
  });

  it('DOMAIN SEPARATION — a sig over pickId A never verifies for pickId B', () => {
    const key = generateAgentKey();
    const sig = signPickId(key.privateKeyPem, PICK_A);
    expect(verifyPickIdSig(key.publicKeyPem, PICK_B, sig)).toBe(false);
  });

  it('DOMAIN SEPARATION — a sig computed under a DIFFERENT domain prefix fails', () => {
    const key = generateAgentKey();
    // Same key, same pickId, WRONG protocol domain — must never verify: this is
    // what stops a signature over some other Warpline artifact being replayed
    // as a strand signature.
    const foreign = rawSign(
      null,
      Buffer.from('warpline:other-domain:v1\n' + PICK_A, 'utf8'),
      createPrivateKey(key.privateKeyPem),
    ).toString('base64');
    expect(verifyPickIdSig(key.publicKeyPem, PICK_A, foreign)).toBe(false);
    // and the exact preimage IS the documented one — a raw sign over it verifies
    const exact = rawSign(
      null,
      Buffer.from(STRAND_SIG_DOMAIN + PICK_A, 'utf8'),
      createPrivateKey(key.privateKeyPem),
    ).toString('base64');
    expect(verifyPickIdSig(key.publicKeyPem, PICK_A, exact)).toBe(true);
  });
});

/* ── keyId ───────────────────────────────────────────────────────────────────── */

describe('#keys — keyId determinism', () => {
  it('keyId = wlkey:v1: + sha256 over the trimmed PEM bytes, reproducible from the stored PEM', () => {
    const key = generateAgentKey();
    expect(key.keyId.startsWith(KEY_ID_PREFIX)).toBe(true);
    // same PEM → same keyId (the id is OVER the stored bytes, so any copy re-derives it)
    expect(computeKeyId(key.publicKeyPem)).toBe(key.keyId);
    // the documented preimage, verbatim
    const manual = KEY_ID_PREFIX + createHash('sha256').update(key.publicKeyPem.replace(/\n+$/, ''), 'utf8').digest('hex');
    expect(key.keyId).toBe(manual);
    // a trailing newline on a copied PEM does not change the id (normalization)
    expect(computeKeyId(key.publicKeyPem + '\n')).toBe(key.keyId);
  });

  it('different keypairs → different keyIds', () => {
    expect(generateAgentKey().keyId).not.toBe(generateAgentKey().keyId);
  });
});

/* ── fail-closed loaders ─────────────────────────────────────────────────────── */

describe('#keys — fail-closed key file loader (tokens.ts posture)', () => {
  it('missing file → null; strict loader throws a precise message', () => {
    expect(loadAgentKey(root, 'ghost')).toBeNull();
    expect(() => loadAgentKeyStrict(root, 'ghost')).toThrow(/no signing key for "ghost".*key mint ghost/s);
  });

  it('garbled JSON → null (never a throw into a caller that might soften it)', () => {
    mintAgentKey(root, 'alice');
    fs.writeFileSync(agentKeyPathOf(root, 'alice'), '{not json', 'utf8');
    expect(loadAgentKey(root, 'alice')).toBeNull();
    expect(() => loadAgentKeyStrict(root, 'alice')).toThrow(/not valid JSON/);
  });

  it('wrong schema → null; a swapped principal never resolves', () => {
    const minted = mintAgentKey(root, 'alice');
    // wrong schemaVersion
    fs.writeFileSync(
      agentKeyPathOf(root, 'alice'),
      JSON.stringify({ ...minted.key, schemaVersion: 'agentKey:v999' }) + '\n',
      'utf8',
    );
    expect(loadAgentKey(root, 'alice')).toBeNull();
    // valid shape but the WRONG principal inside (a copied file) never resolves
    fs.writeFileSync(
      agentKeyPathOf(root, 'alice'),
      JSON.stringify({ ...minted.key, principal: 'bob' }) + '\n',
      'utf8',
    );
    expect(loadAgentKey(root, 'alice')).toBeNull();
    expect(() => loadAgentKeyStrict(root, 'alice')).toThrow(/names principal "bob"/);
  });

  it('a traversal principal never resolves and never escapes the keys dir', () => {
    expect(isPrincipalName('../../etc/passwd')).toBe(false);
    expect(loadAgentKey(root, '../../etc/passwd')).toBeNull();
    expect(() => mintAgentKey(root, '../evil')).toThrow(/illegal principal name/);
  });

  it('a minted key file round-trips through the loader and is signable', () => {
    const minted = mintAgentKey(root, 'alice');
    const loaded = loadAgentKey(root, 'alice');
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(AGENT_KEY_SCHEMA);
    expect(loaded!.keyId).toBe(minted.key.keyId);
    const sig = signPickId(loaded!.privateKeyPem, PICK_A);
    expect(verifyPickIdSig(loaded!.publicKeyPem, PICK_A, sig)).toBe(true);
  });
});

/* ── registry ────────────────────────────────────────────────────────────────── */

describe('#keys — the append-only registry, fail-closed per row', () => {
  it('a garbled row is SKIPPED and SURFACED in diagnostics — never resolved', () => {
    mintAgentKey(root, 'alice');
    // splice a garbled row and a wrong-schema row into the middle of the file
    const p = keyRegistryPathOf(root);
    fs.appendFileSync(p, '{"schemaVersion":"keyRegistry:v1","kind":"agent-key","principal":"mallory"}\n', 'utf8'); // missing keyId/pub
    fs.appendFileSync(p, 'not json at all\n', 'utf8');
    fs.appendFileSync(p, '{"schemaVersion":"keyRegistry:v99","kind":"agent-key","principal":"mallory"}\n', 'utf8');
    const { rows, malformed } = readKeyRegistry(root);
    expect(malformed.length).toBe(3);
    expect(rows.some((r) => r.kind === 'agent-key' && r.principal === 'mallory')).toBe(false);
    expect(registryKeyFor(root, 'mallory')).toBeNull(); // a garbled row NEVER resolves
    expect(registryKeyFor(root, 'alice')).not.toBeNull(); // …and does not poison its neighbors
    // the listing surfaces the skip too
    expect(listKeySummaries(root).malformed.length).toBe(3);
  });

  it('an absent registry reads as empty, no diagnostics', () => {
    expect(readKeyRegistry(root)).toEqual({ rows: [], malformed: [] });
    expect(registryKeyFor(root, 'anyone')).toBeNull();
    expect(signedFromOf(root)).toBeNull();
    expect(hasSignedFrom(root)).toBe(false);
  });

  it('re-mint APPENDS and the LATEST row wins (token re-mint semantics)', () => {
    const first = mintAgentKey(root, 'alice');
    const second = mintAgentKey(root, 'alice');
    expect(second.key.keyId).not.toBe(first.key.keyId);
    const { rows } = readKeyRegistry(root);
    expect(rows.filter((r) => r.kind === 'agent-key' && r.principal === 'alice').length).toBe(2);
    expect(registryKeyFor(root, 'alice')!.keyId).toBe(second.key.keyId);
    // the key file now holds the SECOND key; the first row's private half is gone
    const summaries = listKeySummaries(root).keys;
    const firstRow = summaries.find((k) => k.keyId === first.key.keyId)!;
    const secondRow = summaries.find((k) => k.keyId === second.key.keyId)!;
    expect(firstRow.latest).toBe(false);
    expect(firstRow.keyFilePresent).toBe(false); // rotated away
    expect(secondRow.latest).toBe(true);
    expect(secondRow.keyFilePresent).toBe(true);
  });
});

/* ── mint + the signed-from epoch boundary ───────────────────────────────────── */

describe('#keys — mint pins the signing-epoch boundary ONCE', () => {
  it('the FIRST mint pins signed-from at the live fabric tip', () => {
    writeRef(warplineDirOf(root), 'selvage', PICK_A, null);
    const minted = mintAgentKey(root, 'alice');
    expect(minted.signedFrom).toEqual({ signedFromPickId: PICK_A });
    expect(signedFromOf(root)).toBe(PICK_A);
    expect(hasSignedFrom(root)).toBe(true);
  });

  it('a SECOND mint does not move the boundary; a hand-appended second signed-from row is IGNORED', () => {
    writeRef(warplineDirOf(root), 'selvage', PICK_A, null);
    mintAgentKey(root, 'alice');
    // tip moves…
    writeRef(warplineDirOf(root), 'selvage', PICK_B, PICK_A);
    const second = mintAgentKey(root, 'bob');
    expect(second.signedFrom).toBeNull(); // no re-pin
    expect(signedFromOf(root)).toBe(PICK_A); // the epoch did not move
    // even a hand-forged later signed-from row is ignored — FIRST row wins,
    // because a movable boundary would let anyone un-sign history.
    fs.appendFileSync(
      keyRegistryPathOf(root),
      JSON.stringify({ schemaVersion: KEY_REGISTRY_SCHEMA, kind: 'signed-from', signedFromPickId: PICK_B, createdAt: new Date().toISOString() }) + '\n',
      'utf8',
    );
    expect(signedFromOf(root)).toBe(PICK_A);
    expect(listKeySummaries(root).signedFrom!.signedFromPickId).toBe(PICK_A);
  });

  it('minting on an EMPTY fabric pins signed-from at genesis (null pickId, still pinned)', () => {
    const minted = mintAgentKey(root, 'alice');
    expect(minted.signedFrom).toEqual({ signedFromPickId: null });
    expect(hasSignedFrom(root)).toBe(true); // pinned — distinguishable from absent
    expect(signedFromOf(root)).toBeNull(); // …but the boundary is genesis
  });

  it('the key file is 0600 and the keys dirs are 0700 (private material custody)', () => {
    const minted = mintAgentKey(root, 'alice');
    expect(fs.statSync(minted.keyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(minted.keyPath)).mode & 0o777).toBe(0o700); // keys/agents
    expect(fs.statSync(path.dirname(path.dirname(minted.keyPath))).mode & 0o777).toBe(0o700); // keys
  });

  it('the registry row carries PUBLIC material only, and matches the key file', () => {
    const minted = mintAgentKey(root, 'alice');
    const row = registryKeyFor(root, 'alice')!;
    expect(row.keyId).toBe(minted.key.keyId);
    expect(row.publicKeyPem).toBe(minted.key.publicKeyPem);
    expect(JSON.stringify(row)).not.toContain('PRIVATE');
    // the registry's public key verifies what the key file signs
    const sig = signPickId(loadAgentKey(root, 'alice')!.privateKeyPem, PICK_A);
    expect(verifyPickIdSig(row.publicKeyPem, PICK_A, sig)).toBe(true);
  });
});
