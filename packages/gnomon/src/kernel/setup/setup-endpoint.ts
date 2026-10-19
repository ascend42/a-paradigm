/**
 * @symbol #setup-endpoint
 *
 * #setup-endpoint (spec §11.2 rule 11, §2.4 rule 9; T-2026-10-19-005 MVP-b) —
 * the SETUP MODE loopback endpoint: the first run on screens (the browser or
 * Gnomon.app's window) instead of terminal prompts. It is a #web-endpoint
 * (same `gnomon-web` transport child, same rules.ts — 127.0.0.1 only,
 * Origin/Host, CSP, rate limits, hello-then-auth within 5 s — and the SAME
 * pinned #gui bundle) whose dispatcher is NOT the gnomon-rpc dispatcher: a
 * closed `gnomon-setup:v1` dispatcher (gnomon-contracts setup.ts). No
 * gnomon-rpc verb is reachable from it, and clientApiId does not move.
 *
 * ^setup-token: one 32-byte token, 60 s TTL, single use, carried ONLY in the
 * URL fragment `#setup=<tok>&k=<spki>[&cwd=…]` on the user's own launch
 * surface (the TTY line, or the wrapper's channel pipe) — never argv, env,
 * a file or a log. A reuse inside the TTL ABORTS the provisioning and writes
 * an identity-journal line (`setup.token-reuse`, no token in it). An
 * EPHEMERAL Ed25519 setup key signs serverSig; the page verifies it against
 * `k` and never stores it as the kernel pin.
 *
 * At most ONE setup connection: the token is single use, and a second auth
 * while one is active is refused and closes. That connection closing aborts
 * the #provisioner at its next step boundary (it cleans up what it created).
 * The page sends only `name`, a leftover `gen` the server listed, and clicks
 * (exact params key sets): the #provisioner composes every row and digest,
 * and the same inputs give the same artifacts as `gnomon setup --cli` (G-SET-06).
 */
import { generateKeyPairSync, randomBytes, sign, timingSafeEqual, type KeyObject } from 'node:crypto';
import * as os from 'node:os';
import { authServerPreimage, SETUP_API, SETUP_API_ID, SETUP_TOKEN_BYTES, SETUP_TOKEN_TTL_MS, setupParamsProblem } from '@a-company/gnomon-contracts';
import { ed25519KeyId } from '../log/signer.js';
import type { KernelDispatcher } from '../socket/dispatch.js';
import { RpcRefusal } from '../socket/rpc.js';
import type { ConnectionContext } from '../socket/server.js';
import type { RpcRequestFrame } from '../socket/rpc.js';
import { WebEndpoint, type WebEndpointOptions } from '../web/endpoint.js';
import { appendIdentityJournal, identityJournalPath, identityPath } from '../identity/provision.js';
import { deviceKeyPath } from '../identity/device-key.js';
import { registryPath } from '../identity/registry.js';
import { Provisioner, type ProvisionEvent } from '../identity/provisioner.js';
import type { HelperTransport, HelperVerifier, PinnedHelper } from '../identity/helper.js';
import { runPreflight, type PreflightReport } from './preflight.js';

export interface SetupGrant {
  port: number;
  setupToken: string;
  /** base64url SPKI DER of the ephemeral setup key */
  setupPublicKey: string;
  bundleHash: string;
  expiresAt: number;
  /** `http://127.0.0.1:<port>/#setup=<tok>&k=<spki>` (the caller may append `&cwd=…`) */
  url: string;
}

export type SetupOutcome = { ok: true; home: string } | { ok: false; reason: string; message: string };

export interface SetupEndpointOptions {
  home: string;
  userHome: string;
  helperPath: string;
  host?: string;
  /** the prefilled name (sanitized $USER) */
  defaultName: string;
  env: Readonly<Record<string, string | undefined>>;
  unsafe: string | null;
  verifier?: HelperVerifier;
  start?: (pin: PinnedHelper) => HelperTransport;
  once?: (pin: PinnedHelper) => (req: Record<string, unknown>) => Record<string, unknown>;
  exec?: (file: string, args: string[]) => string;
  platform?: NodeJS.Platform;
  now?: () => number;
  /** the presence / state events, for the terminal that started setup (Aegis: it prints each digest too) */
  onEvent?: (e: ProvisionEvent) => void;
  /** tests: the #web-endpoint factory (default WebEndpoint.create, the platform's transport sandbox) */
  createWeb?: (o: WebEndpointOptions) => WebEndpoint;
  /** tests: the transport child entry (default: the built dist/transport/gnomon-web.js) */
  scriptPath?: string;
  /** tests: count the requests that reached a provisioner/helper path */
  onDispatch?: (method: string) => void;
}

const POLICY = (reason: string, message: string): RpcRefusal => new RpcRefusal('AUTH', reason, message, undefined, { closeAfter: true });

export class SetupEndpoint {
  readonly #o: SetupEndpointOptions;
  readonly #now: () => number;
  readonly #key: { priv: KeyObject; pubPem: string; spki: string; keyId: string };
  #web: WebEndpoint | null = null;
  #token: Buffer | null = null;
  #expiresAt = 0;
  #consumed = false;
  #active: string | null = null;
  #hello = new Map<string, { nonce: string; clientNonce: string }>();
  #report: PreflightReport | null = null;
  #name: string | null = null;
  #provisioned = false;
  #running: Promise<unknown> | null = null;
  readonly #ac = new AbortController();
  #settle!: (o: SetupOutcome) => void;
  #settled = false;
  /** resolves once: setup.finish after success, or an abort (socket close, token reuse, stop) */
  readonly done: Promise<SetupOutcome>;

  constructor(o: SetupEndpointOptions) {
    this.#o = o;
    this.#now = o.now ?? Date.now;
    const kp = generateKeyPairSync('ed25519');
    const pubPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    this.#key = { priv: kp.privateKey, pubPem, spki: kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), keyId: ed25519KeyId(pubPem) };
    this.done = new Promise((r) => (this.#settle = r));
  }

  get port(): number {
    return this.#web?.port ?? 0;
  }

  /** The transport child's argv / env (G-WEB-05 falsifier: the token is on neither). */
  childArgv(): string[] | null {
    return this.#web?.childArgv() ?? null;
  }
  childEnv(): Record<string, string> | null {
    return this.#web?.childEnv() ?? null;
  }
  listenAddress(): { address: string; port: number } | null {
    return this.#web?.listenAddress() ?? null;
  }

  /** Start listening and mint THE setup token (once per endpoint). */
  async start(): Promise<SetupGrant> {
    if (this.#token) throw new Error('the setup endpoint mints exactly one token');
    const opts: WebEndpointOptions = {
      home: this.#o.home,
      dispatcher: (endpointPath) => this.#dispatcher(endpointPath),
      log: async () => undefined, // the setup endpoint keeps no kernel log (there is no home log yet); never the token
      kernelPublicKeyPem: this.#key.pubPem,
      lingerMs: 30 * 60_000,
      maxConnections: 4,
      ...(this.#o.scriptPath ? { scriptPath: this.#o.scriptPath } : {}),
      ...(this.#o.now ? { now: this.#o.now } : {}),
      ...(this.#o.platform ? { platform: this.#o.platform } : {}),
    };
    this.#web = this.#o.createWeb ? this.#o.createWeb(opts) : WebEndpoint.create(opts);
    await this.#web.ensureListening();
    if (!this.#web.listening) throw new Error('the setup endpoint did not start');
    this.#token = randomBytes(SETUP_TOKEN_BYTES);
    this.#expiresAt = this.#now() + SETUP_TOKEN_TTL_MS;
    const setupToken = this.#token.toString('base64url');
    const bundleHash = String(this.#web.status().bundleHash ?? '');
    const port = this.#web.port;
    return { port, setupToken, setupPublicKey: this.#key.spki, bundleHash, expiresAt: this.#expiresAt, url: `http://127.0.0.1:${port}/#setup=${setupToken}&k=${this.#key.spki}` };
  }

  async stop(): Promise<void> {
    this.#abort('stopped', 'the setup endpoint stopped');
    await this.#running?.catch(() => undefined);
    await this.#web?.stop('setup-done').catch(() => undefined);
  }

  #abort(reason: string, message: string): void {
    this.#ac.abort();
    this.#finish({ ok: false, reason, message });
  }

  #finish(o: SetupOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    // an abort waits for the provisioner to reach its step boundary and clean up
    void (this.#running ?? Promise.resolve()).catch(() => undefined).then(() => this.#settle(o));
  }

  #engine(): Provisioner {
    const o = this.#o;
    const p = new Provisioner({
      home: o.home,
      helperPath: o.helperPath,
      ...(o.verifier ? { verifier: o.verifier } : {}),
      ...(o.start ? { start: o.start } : {}),
      ...(o.once ? { once: o.once } : {}),
      signal: this.#ac.signal,
    });
    return p;
  }

  async #preflight(): Promise<PreflightReport> {
    const o = this.#o;
    this.#report = await runPreflight({
      home: o.home,
      userHome: o.userHome,
      helperPath: o.helperPath,
      ...(o.verifier ? { verifier: o.verifier } : {}),
      ...(o.start ? { start: o.start } : {}),
      env: o.env,
      unsafe: o.unsafe,
      ...(o.platform ? { platform: o.platform } : {}),
      ...(o.exec ? { exec: o.exec } : {}),
    });
    return this.#report;
  }

  #reportView(r: PreflightReport): Record<string, unknown> {
    return { checks: r.checks.map((c) => ({ ...c })), leftover: [...r.leftover], existing: r.existing ? { rootKeyId: r.existing.rootKeyId, createdAt: r.existing.createdAt } : null, ok: r.ok, defaultName: this.#o.defaultName };
  }

  #dispatcher(endpointPath: string): KernelDispatcher {
    const relay = (ctx: ConnectionContext) => (e: ProvisionEvent) => {
      this.#o.onEvent?.(e);
      if (e.type === 'presence') ctx.notify('setup.presence', { n: e.n, of: e.of, purpose: e.purpose, digest12: e.digest12, ...(e.key ? { key: e.key } : {}), ...(e.gen ? { gen: e.gen } : {}) });
      else if (e.type === 'step') ctx.notify('setup.state', { phase: 'identity', step: e.step });
    };
    const handle = async (req: RpcRequestFrame, ctx: ConnectionContext): Promise<unknown> => {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (req.method === 'hello') {
        const apis = params.clientApis;
        const cn = params.clientNonce;
        if (!Array.isArray(apis) || !apis.includes(SETUP_API) || typeof cn !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(cn)) throw POLICY('hello-params', `the setup endpoint speaks only ${SETUP_API}`);
        const nonce = randomBytes(32).toString('base64url');
        this.#hello.set(ctx.connId, { nonce, clientNonce: cn });
        const serverSig = sign(null, Buffer.from(authServerPreimage(nonce, cn, endpointPath, { clientApi: SETUP_API, features: [] }), 'utf8'), this.#key.priv).toString('base64');
        return { clientApi: SETUP_API, features: [], nonce, clientNonce: cn, serverKeyId: this.#key.keyId, serverSig, setupApiId: SETUP_API_ID };
      }
      const bad = setupParamsProblem(req.method, params);
      if (bad) {
        if (this.#active !== ctx.connId) throw POLICY('bad-request', bad);
        throw new RpcRefusal('BAD_REQUEST', 'setup-params', bad);
      }
      if (req.method === 'auth') return this.#auth(String(params.setupToken), ctx);
      if (this.#active !== ctx.connId) throw POLICY('unauthenticated', 'authenticate with the setup token first');
      this.#o.onDispatch?.(req.method);
      switch (req.method) {
        case 'setup.preflight':
          return this.#reportView(await this.#preflight());
        case 'setup.name':
          this.#name = String(params.name);
          return { name: this.#name };
        case 'setup.purge': {
          const gen = String(params.gen);
          if (!this.#report?.leftover.includes(gen)) throw new RpcRefusal('BAD_REQUEST', 'not-leftover', 'only a leftover generation the preflight listed can be purged');
          const p = this.#engine();
          p.on('event', relay(ctx));
          const job = p.purgeGeneration(gen);
          this.#running = job;
          const r = await job;
          if (!r.ok) throw new RpcRefusal('FORBIDDEN', r.reason, r.message);
          return this.#reportView(await this.#preflight());
        }
        case 'setup.begin': {
          const rep = this.#report;
          if (this.#provisioned || this.#running) throw new RpcRefusal('FORBIDDEN', 'setup-busy', 'setup already ran on this connection');
          if (!rep || !rep.ok || rep.existing || rep.leftover.length) throw new RpcRefusal('FORBIDDEN', 'preflight-failed', 'run the checks and fix every failing one first');
          if (!this.#name) throw new RpcRefusal('FORBIDDEN', 'no-name', 'choose your name first');
          const p = this.#engine();
          p.on('event', relay(ctx));
          const job = p.provision({ mode: 'init', existing: null, name: this.#name, host: this.#o.host ?? hostOf() });
          this.#running = job;
          const r = await job;
          this.#running = null;
          if (!r.ok) {
            this.#abort(r.reason, r.message);
            throw new RpcRefusal('FORBIDDEN', r.reason, r.message, typeof r.extra.leftoverGen === 'string' ? { leftoverGen: r.extra.leftoverGen } : undefined);
          }
          this.#provisioned = true;
          const rec = r.record!;
          const h = this.#o.home;
          return { rootKeyId: rec.rootKeyId, principalId: rec.principalId, deviceId: rec.deviceId, files: [identityPath(h), registryPath(h), deviceKeyPath(h), identityJournalPath(h)] };
        }
        case 'setup.finish':
          if (!this.#provisioned) throw new RpcRefusal('FORBIDDEN', 'not-provisioned', 'setup has not finished');
          this.#finish({ ok: true, home: this.#o.home });
          return { finished: true };
      }
      throw POLICY('unknown-method', `not a ${SETUP_API} method`);
    };
    return {
      handle,
      callAs: () => Promise.reject(new Error('the setup endpoint has no mod calls')),
      onConnect: () => undefined,
      onDisconnect: (ctx: ConnectionContext) => {
        this.#hello.delete(ctx.connId);
        // a closed socket aborts at the next step boundary; the provisioner cleans up what it created
        if (this.#active === ctx.connId && !this.#settled) this.#abort('socket-closed', 'the setup page closed before setup finished');
      },
      clients: () => [],
    } as unknown as KernelDispatcher;
  }

  #auth(tok: string, ctx: ConnectionContext): unknown {
    if (!this.#hello.has(ctx.connId)) throw POLICY('unauthenticated', 'hello first');
    const given = Buffer.from(tok, 'base64url');
    const match = this.#token !== null && given.length === this.#token.length && timingSafeEqual(given, this.#token);
    if (!match) throw POLICY('unknown-token', 'not the setup token this run issued');
    const live = this.#now() < this.#expiresAt;
    if (this.#consumed) {
      if (live) {
        // ^setup-token: a reuse inside the TTL is theft — abort the provisioning, journal it (never the token)
        try {
          appendIdentityJournal(this.#o.home, { op: 'setup.token-reuse', at: new Date(this.#now()).toISOString(), aborted: true });
        } catch {
          /* the abort still happens */
        }
        this.#abort('token-reuse', 'the setup token was used twice; setup was aborted');
      }
      throw POLICY('replayed-token', 'the setup token was already used');
    }
    if (!live) throw POLICY('token-expired', 'the setup token expired (60 s); start setup again');
    if (this.#active !== null || this.#settled) throw POLICY('setup-busy', 'another setup connection is active');
    this.#consumed = true;
    this.#active = ctx.connId;
    ctx.authenticated();
    return { authenticated: true, setupApiId: SETUP_API_ID };
  }
}

function hostOf(): string {
  const h = os.hostname().replace(/\.local$/, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return (h || 'mac').slice(0, 64);
}
