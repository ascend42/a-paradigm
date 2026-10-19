/**
 * An in-memory stand-in for the signed helper (`gnomon-helper:v1`): software
 * P-256 keys play the Secure Enclave, `touch` plays the human. Tests only —
 * it behaves like packages/gnomon-helper/darwin (domain allowlist per key,
 * DER signatures, per-connId cached unlocks, no-unlock, presence-denied;
 * round 2: root signs rows only, a cached unlock signs decisions only,
 * key.list, key.create refuses another generation without a root-signed
 * rotate statement, key.delete takes presence unless this instance created
 * the gen, the helper's own prompt line).
 */
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { HelperRefusal, HelperUnavailableError, type HelperReply, type HelperTransport } from '../src/kernel/identity/helper.js';

const DOMAINS: Record<string, string[]> = { root: ['gnomon:row-sig:v1\n'], approvals: ['gnomon:approve:v1\n', 'gnomon:presence:v1\n'] };
const CACHED_DOMAINS = ['gnomon:approve:v1\n'];
const d12 = (m: Buffer): string => createHash('sha256').update(m).digest('hex').slice(0, 12);

export interface FakeHelperOptions {
  /** false = the human declines every prompt */
  touch?: boolean;
  /** sign with this key instead of the real one (an impostor / broken helper) */
  wrongKey?: boolean;
  /** corrupt the n-th signature of a sign reply (0-based) */
  corruptSig?: number;
  /** the human approves this many prompts, then declines */
  touchesAllowed?: number;
  /** the helper process dies when it receives this op (e.g. 'key.create:approvals') */
  crashOn?: string;
}

export class FakeHelper implements HelperTransport {
  readonly keys = new Map<string, { priv: KeyObject; pub: KeyObject }>();
  readonly unlocks = new Set<string>();
  prompts: string[] = [];
  signs: Array<{ key: string; mode: string; connId?: string; n: number }> = [];
  #alive = true;
  readonly #exit: Array<() => void> = [];
  readonly #other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly createdHere = new Set<string>();
  /** every prompt as the helper would show it (caller text + the helper's own line) */
  shown: string[] = [];
  opts: FakeHelperOptions;

  /** `gen` = keys that already exist in this fake SE; null = an empty SE. */
  constructor(gen: string | null = 'test0001', opts: FakeHelperOptions = {}) {
    this.opts = opts;
    if (gen !== null) for (const k of ['root', 'approvals']) {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      this.keys.set(`${gen}.${k}`, { priv: privateKey, pub: publicKey });
    }
  }

  get alive(): boolean {
    return this.#alive;
  }

  onExit(cb: () => void): void {
    this.#exit.push(cb);
  }

  /** A fresh helper process over the same Secure Enclave: alive again, no unlocks, nothing created by it. */
  revive(): void {
    this.#alive = true;
    this.unlocks.clear();
    this.createdHere.clear();
  }

  #touch(): boolean {
    if (this.opts.touch === false) return false;
    if (this.opts.touchesAllowed !== undefined) {
      if (this.opts.touchesAllowed <= 0) return false;
      this.opts.touchesAllowed--;
    }
    return true;
  }

  /** The helper process dies: unlocks gone, listeners told. */
  crash(): void {
    this.#alive = false;
    this.unlocks.clear();
    for (const cb of this.#exit) cb();
  }

  async close(): Promise<void> {
    if (this.#alive) this.crash();
  }

  publicPem(key: 'root' | 'approvals', gen = 'test0001'): string {
    return this.keys.get(`${gen}.${key}`)!.pub.export({ type: 'spki', format: 'pem' }).toString();
  }

  x963(key: 'root' | 'approvals', gen = 'test0001'): string {
    const jwk = this.keys.get(`${gen}.${key}`)!.pub.export({ format: 'jwk' });
    return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64');
  }

  async request(req: Record<string, unknown>): Promise<HelperReply> {
    return this.handle(req);
  }

  /** Synchronous form (stands in for `gnomon-helper once`). */
  handle(req: Record<string, unknown>): HelperReply {
    if (!this.#alive) throw new HelperUnavailableError('exited', 'fake helper is down');
    if (this.opts.crashOn && this.opts.crashOn === `${String(req.op)}:${String(req.key)}`) {
      this.opts = { ...this.opts, crashOn: undefined }; // it dies once
      this.crash();
      throw new HelperUnavailableError('exited', 'fake helper died');
    }
    const k = this.keys.get(`${String(req.gen)}.${String(req.key)}`);
    switch (req.op) {
      case 'key.list':
        return { ok: true, keys: [...this.keys.keys()].map((t) => ({ gen: t.split('.')[0], key: t.split('.')[1] })) };
      case 'key.create': {
        if (k) throw new HelperRefusal('exists', 'exists');
        const gen = String(req.gen);
        if ([...this.keys.keys()].some((t) => t.split('.')[0] !== gen)) this.#checkRotate(req, gen);
        this.createdHere.add(`${String(req.key)}.${gen}`); // round 3: the exact (key, gen) pair
        const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        this.keys.set(`${String(req.gen)}.${String(req.key)}`, { priv: privateKey, pub: publicKey });
        return { ok: true, publicKey: this.x963(req.key as 'root', String(req.gen)) };
      }
      case 'key.delete': {
        if (!this.createdHere.has(`${String(req.key)}.${String(req.gen)}`)) {
          this.prompts.push(String(req.reason));
          this.shown.push(`${String(req.reason)}\nGnomon Helper: DELETE the ${String(req.key)} key of generation ${String(req.gen)}`);
          if (!this.#touch()) throw new HelperRefusal('presence-denied', 'cancelled');
        }
        return { ok: true, deleted: this.keys.delete(`${String(req.gen)}.${String(req.key)}`), statement: 'eA==' };
      }
      case 'key.public':
        if (!k) throw new HelperRefusal('not-found', 'no key');
        return { ok: true, publicKey: this.x963(req.key as 'root', String(req.gen)) };
      case 'unlock.drop':
        return { ok: true, dropped: this.unlocks.delete(String(req.connId)) };
      case 'unlock.drop-all': {
        const n = this.unlocks.size;
        this.unlocks.clear();
        return { ok: true, dropped: n };
      }
      case 'sign': {
        if (!k) throw new HelperRefusal('not-found', 'no key');
        const msgs = (req.messages as string[]).map((m) => Buffer.from(m, 'base64'));
        if (req.keep !== undefined && typeof req.keep !== 'boolean') throw new HelperRefusal('bad-request', 'keep must be a boolean');
        const allowed = req.mode === 'cached' ? CACHED_DOMAINS : DOMAINS[String(req.key)]!;
        for (const m of msgs) if (!allowed.some((d) => m.subarray(0, d.length).toString() === d)) throw new HelperRefusal('domain-refused', 'domain');
        const line = `Gnomon Helper: ${String(req.key)} key signs ${msgs.length}: ${msgs.map(d12).join(' ')}`;
        const conn = typeof req.connId === 'string' ? req.connId : undefined;
        if (req.mode === 'cached') {
          if (req.key !== 'approvals' || !conn || !this.unlocks.has(conn)) throw new HelperRefusal('no-unlock', 'no unlock');
        } else {
          this.prompts.push(String(req.reason));
          this.shown.push(`${String(req.reason)}\n${line}`);
          if (!this.#touch()) throw new HelperRefusal('presence-denied', 'cancelled');
        }
        let kept = req.mode === 'cached';
        if (req.mode === 'fresh' && req.keep === true && conn) {
          this.unlocks.add(conn);
          kept = true;
        }
        this.signs.push({ key: String(req.key), mode: String(req.mode), ...(conn ? { connId: conn } : {}), n: msgs.length });
        const priv = this.opts.wrongKey ? this.#other.privateKey : k.priv;
        const sigs = msgs.map((m, i) => {
          const s = cryptoSign('sha256', i === this.opts.corruptSig ? Buffer.concat([m, Buffer.from('x')]) : m, { key: priv, dsaEncoding: 'der' });
          return s.toString('base64');
        });
        return { ok: true, sigs, kept, shown: line };
      }
      default:
        throw new HelperRefusal('bad-request', 'unknown op');
    }
  }

  #checkRotate(req: Record<string, unknown>, toGen: string): void {
    const r = req.rotate as { fromGen?: unknown; statement?: unknown; sig?: unknown } | undefined;
    if (!r) throw new HelperRefusal('other-generation', 'keys of another generation exist');
    const root = this.keys.get(`${String(r.fromGen)}.root`);
    const st = Buffer.from(String(r.statement), 'base64');
    const prefix = 'gnomon:row-sig:v1\n';
    let obj: Record<string, unknown> = {};
    try {
      obj = JSON.parse(st.subarray(prefix.length).toString());
    } catch {
      /* refused below */
    }
    if (!st.subarray(0, prefix.length).equals(Buffer.from(prefix)) || obj.schemaVersion !== 'gnomon-root-rotate:v1' || obj.fromGen !== r.fromGen || obj.toGen !== toGen) throw new HelperRefusal('rotate-refused', 'statement');
    if (!root || !cryptoVerify('sha256', st, { key: root.pub, dsaEncoding: 'der' }, Buffer.from(String(r.sig), 'base64'))) throw new HelperRefusal('rotate-refused', 'signature');
  }
}
