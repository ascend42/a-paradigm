/**
 * An in-memory stand-in for the signed helper (`gnomon-helper:v1`): software
 * P-256 keys play the Secure Enclave, `touch` plays the human. Tests only —
 * it behaves like packages/gnomon-helper/darwin (domain allowlist per key,
 * DER signatures, per-connId cached unlocks, no-unlock, presence-denied).
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { HelperRefusal, HelperUnavailableError, type HelperReply, type HelperTransport } from '../src/kernel/identity/helper.js';

const DOMAINS: Record<string, string[]> = { root: ['gnomon:row-sig:v1\n', 'gnomon:presence:v1\n'], approvals: ['gnomon:approve:v1\n', 'gnomon:presence:v1\n'] };

export interface FakeHelperOptions {
  /** false = the human declines every prompt */
  touch?: boolean;
  /** sign with this key instead of the real one (an impostor / broken helper) */
  wrongKey?: boolean;
  /** corrupt the n-th signature of a sign reply (0-based) */
  corruptSig?: number;
}

export class FakeHelper implements HelperTransport {
  readonly keys = new Map<string, { priv: KeyObject; pub: KeyObject }>();
  readonly unlocks = new Set<string>();
  prompts: string[] = [];
  signs: Array<{ key: string; mode: string; connId?: string; n: number }> = [];
  #alive = true;
  readonly #exit: Array<() => void> = [];
  readonly #other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  opts: FakeHelperOptions;

  constructor(gen = 'test0001', opts: FakeHelperOptions = {}) {
    this.opts = opts;
    for (const k of ['root', 'approvals']) {
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
    if (!this.#alive) throw new HelperUnavailableError('exited', 'fake helper is down');
    const k = this.keys.get(`${String(req.gen)}.${String(req.key)}`);
    switch (req.op) {
      case 'key.public':
        if (!k) throw new HelperRefusal('not-found', 'no key');
        return { ok: true, publicKey: this.x963(req.key as 'root', String(req.gen)) };
      case 'unlock.drop':
        return { ok: true, dropped: this.unlocks.delete(String(req.connId)) };
      case 'sign': {
        if (!k) throw new HelperRefusal('not-found', 'no key');
        const msgs = (req.messages as string[]).map((m) => Buffer.from(m, 'base64'));
        for (const m of msgs) if (!DOMAINS[String(req.key)]!.some((d) => m.subarray(0, d.length).toString() === d)) throw new HelperRefusal('domain-refused', 'domain');
        const conn = typeof req.connId === 'string' ? req.connId : undefined;
        if (req.mode === 'cached') {
          if (req.key !== 'approvals' || !conn || !this.unlocks.has(conn)) throw new HelperRefusal('no-unlock', 'no unlock');
        } else {
          this.prompts.push(String(req.reason));
          if (this.opts.touch === false) throw new HelperRefusal('presence-denied', 'cancelled');
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
        return { ok: true, sigs, kept };
      }
      default:
        throw new HelperRefusal('bad-request', 'unknown op');
    }
  }
}
