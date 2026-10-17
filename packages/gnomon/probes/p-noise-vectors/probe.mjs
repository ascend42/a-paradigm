// p-noise-vectors — Arky A31-06 / G-LNK-11 probe (research 31 §A31-06, "Probes
// to add to M1.0"; research 32). Can Noise_IK / Noise_XX / Noise_XXpsk3 over
// 25519 + ChaChaPoly + SHA256 be built from node:crypto alone (zero deps) and
// pass the PUBLISHED test vectors?
//
// vectors.json is a verbatim subset of cacophony.txt and snow.txt (URLs and
// sha256 of the full source files recorded inside). This is a probe-local,
// minimal Noise implementation — not product code.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const specRefs = ['research 31 A31-06', 'G-LNK-11', 'research 32 (Noise XX/IK via node:crypto)', 'G-SEC-01 zero deps'];

const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const EMPTY = Buffer.alloc(0);
const hex = (h) => Buffer.from(h ?? '', 'hex');

function keyPair(priv) {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8, priv]), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, pub: Buffer.from(pub) };
}
function dh(kp, pub) {
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI, pub]), format: 'der', type: 'spki' });
  return crypto.diffieHellman({ privateKey: kp.privateKey, publicKey });
}
const sha256 = (...b) => crypto.createHash('sha256').update(Buffer.concat(b)).digest();
// Noise HKDF == RFC 5869 with salt = ck, info = '' (node:crypto hkdfSync).
function hkdf(ck, ikm, n) {
  const out = Buffer.from(crypto.hkdfSync('sha256', ikm, ck, EMPTY, 32 * n));
  return Array.from({ length: n }, (_, i) => out.subarray(32 * i, 32 * (i + 1)));
}
function nonce(n) {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(BigInt(n), 4);
  return b;
}
function encrypt(k, n, ad, pt) {
  const c = crypto.createCipheriv('chacha20-poly1305', k, nonce(n), { authTagLength: 16 });
  c.setAAD(ad, { plaintextLength: pt.length });
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}
function decrypt(k, n, ad, ct) {
  const d = crypto.createDecipheriv('chacha20-poly1305', k, nonce(n), { authTagLength: 16 });
  d.setAAD(ad, { plaintextLength: ct.length - 16 });
  d.setAuthTag(ct.subarray(ct.length - 16));
  return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
}

class CipherState {
  constructor(k = null) {
    this.k = k;
    this.n = 0;
  }
  enc(ad, pt) {
    if (!this.k) return Buffer.from(pt);
    return encrypt(this.k, this.n++, ad, pt);
  }
  dec(ad, ct) {
    if (!this.k) return Buffer.from(ct);
    return decrypt(this.k, this.n++, ad, ct);
  }
}

const PATTERNS = {
  XX: { pre: { i: [], r: [] }, msgs: [['e'], ['e', 'ee', 's', 'es'], ['s', 'se']] },
  IK: { pre: { i: [], r: ['s'] }, msgs: [['e', 'es', 's', 'ss'], ['e', 'ee', 'se']] },
  XXpsk3: { pre: { i: [], r: [] }, msgs: [['e'], ['e', 'ee', 's', 'es'], ['s', 'se', 'psk']] },
};

class HandshakeState {
  constructor({ protocol, pattern, initiator, prologue, s, e, rs, psks }) {
    const name = Buffer.from(protocol);
    this.h = name.length <= 32 ? Buffer.concat([name, Buffer.alloc(32 - name.length)]) : sha256(name);
    this.ck = Buffer.from(this.h);
    this.cs = new CipherState();
    this.p = PATTERNS[pattern];
    this.psk = pattern.includes('psk');
    this.psks = psks ?? [];
    this.initiator = initiator;
    this.s = s;
    this.e = e;
    this.rs = rs ?? null;
    this.re = null;
    this.idx = 0;
    this.mixHash(prologue);
    for (const t of this.p.pre.i) if (t === 's') this.mixHash(initiator ? s.pub : this.rs);
    for (const t of this.p.pre.r) if (t === 's') this.mixHash(initiator ? this.rs : s.pub);
  }
  mixHash(d) {
    this.h = sha256(this.h, d);
  }
  mixKey(ikm) {
    const [ck, k] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.cs = new CipherState(k);
  }
  mixKeyAndHash(ikm) {
    const [ck, th, k] = hkdf(this.ck, ikm, 3);
    this.ck = ck;
    this.mixHash(th);
    this.cs = new CipherState(k);
  }
  encryptAndHash(pt) {
    const ct = this.cs.enc(this.h, pt);
    this.mixHash(ct);
    return ct;
  }
  decryptAndHash(ct) {
    const pt = this.cs.dec(this.h, ct);
    this.mixHash(ct);
    return pt;
  }
  dhToken(t) {
    const I = this.initiator;
    if (t === 'ee') return dh(this.e, this.re);
    if (t === 'ss') return dh(this.s, this.rs);
    if (t === 'es') return I ? dh(this.e, this.rs) : dh(this.s, this.re);
    if (t === 'se') return I ? dh(this.s, this.re) : dh(this.e, this.rs);
    throw new Error(t);
  }
  write(payload) {
    const out = [];
    for (const t of this.p.msgs[this.idx]) {
      if (t === 'e') {
        out.push(this.e.pub);
        this.mixHash(this.e.pub);
        if (this.psk) this.mixKey(this.e.pub);
      } else if (t === 's') out.push(this.encryptAndHash(this.s.pub));
      else if (t === 'psk') this.mixKeyAndHash(this.psks.shift());
      else this.mixKey(this.dhToken(t));
    }
    out.push(this.encryptAndHash(payload));
    this.idx++;
    return Buffer.concat(out);
  }
  read(msg) {
    let off = 0;
    for (const t of this.p.msgs[this.idx]) {
      if (t === 'e') {
        this.re = msg.subarray(off, off + 32);
        off += 32;
        this.mixHash(this.re);
        if (this.psk) this.mixKey(this.re);
      } else if (t === 's') {
        const len = this.cs.k ? 48 : 32;
        this.rs = this.decryptAndHash(msg.subarray(off, off + len));
        off += len;
      } else if (t === 'psk') this.mixKeyAndHash(this.psks.shift());
      else this.mixKey(this.dhToken(t));
    }
    const pt = this.decryptAndHash(msg.subarray(off));
    this.idx++;
    return pt;
  }
  get done() {
    return this.idx >= this.p.msgs.length;
  }
  split() {
    const [k1, k2] = hkdf(this.ck, EMPTY, 2);
    return [new CipherState(k1), new CipherState(k2)];
  }
}

function runVector(v) {
  const pattern = /^Noise_([A-Za-z0-9]+)_/.exec(v.protocol_name)[1];
  const iS = v.init_static ? keyPair(hex(v.init_static)) : null;
  const rS = v.resp_static ? keyPair(hex(v.resp_static)) : null;
  const I = new HandshakeState({
    protocol: v.protocol_name, pattern, initiator: true, prologue: hex(v.init_prologue),
    s: iS, e: keyPair(hex(v.init_ephemeral)), rs: v.init_remote_static ? hex(v.init_remote_static) : null,
    psks: (v.init_psks ?? []).map(hex),
  });
  const R = new HandshakeState({
    protocol: v.protocol_name, pattern, initiator: false, prologue: hex(v.resp_prologue),
    s: rS, e: keyPair(hex(v.resp_ephemeral)), rs: v.resp_remote_static ? hex(v.resp_remote_static) : null,
    psks: (v.resp_psks ?? []).map(hex),
  });
  const results = [];
  let iSend; let iRecv; let rSend; let rRecv;
  for (const [i, m] of v.messages.entries()) {
    const fromInit = i % 2 === 0;
    const payload = hex(m.payload);
    let ct;
    let pt;
    if (!I.done) {
      const [w, r] = fromInit ? [I, R] : [R, I];
      ct = w.write(payload);
      pt = r.read(ct);
      if (I.done) {
        [iSend, iRecv] = I.split();
        [rRecv, rSend] = R.split();
      }
    } else {
      const [enc, dec] = fromInit ? [iSend, rRecv] : [rSend, iRecv];
      ct = enc.enc(EMPTY, payload);
      pt = dec.dec(EMPTY, ct);
    }
    results.push({ i, phase: i < I.p.msgs.length ? 'handshake' : 'transport', ciphertextMatch: ct.equals(hex(m.ciphertext)), payloadMatch: pt.equals(payload) });
  }
  const hh = v.handshake_hash
    ? { expected: v.handshake_hash, initiatorMatch: I.h.equals(hex(v.handshake_hash)), responderMatch: R.h.equals(hex(v.handshake_hash)) }
    : { expected: null };
  const pass = results.every((r) => r.ciphertextMatch && r.payloadMatch) && (hh.expected === null || (hh.initiatorMatch && hh.responderMatch));
  return { source: v.source, protocol: v.protocol_name, messages: v.messages.length, pass, handshakeHash: hh, failures: results.filter((r) => !r.ciphertextMatch || !r.payloadMatch) };
}

export default async function probe(ctx) {
  const fixture = JSON.parse(readFileSync(path.join(ctx.probeDir, 'vectors.json'), 'utf8'));
  const runs = fixture.vectors.map((v) => {
    try {
      return runVector(v);
    } catch (err) {
      return { source: v.source, protocol: v.protocol_name, pass: false, error: err.message };
    }
  });
  // Negative control: a flipped ciphertext bit must fail authentication.
  let tamperRejected = false;
  try {
    const k = crypto.randomBytes(32);
    const ct = encrypt(k, 0, EMPTY, Buffer.from('x'));
    ct[0] ^= 1;
    decrypt(k, 0, EMPTY, ct);
  } catch {
    tamperRejected = true;
  }
  const covered = [...new Set(runs.filter((r) => r.pass).map((r) => r.protocol))];
  const allPass = runs.length > 0 && runs.every((r) => r.pass) && tamperRejected;
  return {
    verdict: allPass ? 'pass' : runs.some((r) => r.pass) ? 'partial' : 'fail',
    evidence: {
      vectorSources: fixture.sources,
      vectorCount: runs.length,
      protocolsPassing: covered,
      runs,
      tamperRejected,
      primitives: 'node:crypto only — X25519 KeyObjects + crypto.diffieHellman, chacha20-poly1305 (12-byte nonce = 4 zero bytes || LE64 counter), sha256, hkdfSync(salt=ck, info="") as Noise HKDF',
      notIncluded: 'Noise_XXpsk3 has one vector (cacophony); snow ships none for it. Rekey and >2^64 nonce paths are untested.',
    },
    toolVersions: { openssl: process.versions.openssl },
  };
}
