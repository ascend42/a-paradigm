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
 * NEVER HANGS (round 2): the endpoint settles `done` exactly once — finish
 * (after a commit, a completion, or on an already-set-up home), or an abort:
 * the token expiring unused, an idle cap after auth with nothing running, the
 * page's socket closing, the transport stopping, a token reuse, stop(). A
 * refused purge, a failed begin or completion does NOT end setup: the page
 * returns to the checks (a failed begin's leftover generation is listed
 * there with its Delete button). Only one job runs at a time (#running is
 * cleared in a finally).
 *
 * At most ONE setup connection: the token is single use, and a second auth
 * while one is active is refused and closes. The page sends only `name`, a
 * leftover `gen` the server listed, and clicks (exact params key sets, the
 * hello's too): the #provisioner composes every row and digest, and the same
 * inputs give the same artifacts as `gnomon setup --cli` (G-SET-06). The
 * checks are read-only: the home directory is created only at begin.
 */
import { generateKeyPairSync, randomBytes, sign, timingSafeEqual, type KeyObject } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { authServerPreimage, SETUP_API, SETUP_API_ID, SETUP_TOKEN_BYTES, SETUP_TOKEN_TTL_MS, setupParamsProblem } from '@a-company/gnomon-contracts';
import { ed25519KeyId } from '../log/signer.js';
import type { KernelDispatcher } from '../socket/dispatch.js';
import { RpcRefusal } from '../socket/rpc.js';
import type { ConnectionContext } from '../socket/server.js';
import type { RpcRequestFrame } from '../socket/rpc.js';
import { WebEndpoint, type WebEndpointOptions } from '../web/endpoint.js';
import { appendIdentityJournal, identityJournalPath, identityPath, readIdentity, type IdentityRecord } from '../identity/provision.js';
import { deviceKeyPath } from '../identity/device-key.js';
import { HardwareRootAuthority } from '../identity/hardware.js';
import { readRegistry, registryPath } from '../identity/registry.js';
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

export type SetupOutcome = { ok: true; home: string; provisioned: boolean } | { ok: false; reason: string; message: string; leftoverGen?: string };

/** The idle cap after auth with nothing running (round 2: the server never hangs). */
export const SETUP_IDLE_MS = 10 * 60_000;
const HELLO_KEYS = ['client', 'clientApis', 'clientNonce', 'features'];

export interface SetupEndpointOptions {
  home: string;
  userHome: string;
  helperPath: string;
  host?: string;
  /** the prefilled name (sanitized $USER) */
  defaultName: string;
  env: Readonly<Record<string, string | undefined>>;
  unsafe: string | null;
  /** MEDIUM-2: homes whose live generation a purge must never delete (GNOMON_HOME), never used to choose the home */
  alsoCheckHomes?: readonly string[];
  verifier?: HelperVerifier;
  start?: (pin: PinnedHelper) => HelperTransport;
  once?: (pin: PinnedHelper) => (req: Record<string, unknown>) => Record<string, unknown>;
  exec?: (file: string, args: string[]) => string;
  platform?: NodeJS.Platform;
  now?: () => number;
  /** the presence / state events, for the terminal that started setup (Aegis: it prints each digest too) */
  onEvent?: (e: ProvisionEvent) => void;
  /** a refusal the page also shows (the terminal prints it) */
  onNotice?: (text: string) => void;
  /** tests: the #web-endpoint factory (default WebEndpoint.create, the platform's transport sandbox) */
  createWeb?: (o: WebEndpointOptions) => WebEndpoint;
  /** tests: the transport child entry (default: the built dist/transport/gnomon-web.js) */
  scriptPath?: string;
  /** tests: count the requests that reached a provisioner/helper path */
  onDispatch?: (method: string) => void;
  /** tests: the token TTL and the idle cap */
  ttlMs?: number;
  idleMs?: number;
}

const POLICY = (reason: string, message: string): RpcRefusal => new RpcRefusal('AUTH', reason, message, undefined, { closeAfter: true });

/** The device row of `rec` is in the registry (verified under its root). */
export function deviceRegistered(home: string, rec: IdentityRecord): boolean {
  try {
    const reg = readRegistry(home, new HardwareRootAuthority({ gen: rec.gen, rootPublicKeyPem: rec.rootPublicKeyPem }, {}));
    const row = reg.devices.get(rec.deviceId);
    return row !== undefined && row.principalKind === 'human' && row.principalId === rec.principalId;
  } catch {
    return false;
  }
}

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
  #registered = false;
  #name: string | null = null;
  #provisioned = false;
  #running: Promise<unknown> | null = null;
  #expiry: NodeJS.Timeout | null = null;
  #idle: NodeJS.Timeout | null = null;
  readonly #ac = new AbortController();
  #settle!: (o: SetupOutcome) => void;
  #settled = false;
  /** resolves once: setup.finish, or an abort (token expiry, idle, socket close, transport stop, token reuse, stop) */
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
  get settled(): boolean {
    return this.#settled;
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
      // the setup endpoint keeps no kernel log (there is no home log yet) and never logs the token;
      // the one row it acts on: the transport stopped (restart cap, failed respawn) ⇒ setup aborts
      log: async (kind, payload) => {
        if (kind === 'socket.web.stop' && payload.reason !== 'setup-done') this.#abort('transport-stopped', `the setup page's transport stopped (${String(payload.reason)})`);
      },
      kernelPublicKeyPem: this.#key.pubPem,
      // the setup endpoint owns its lifetime (token expiry, idle cap); the web linger never ends a live setup
      lingerMs: 60 * 60_000,
      maxConnections: 2,
      ...(this.#o.scriptPath ? { scriptPath: this.#o.scriptPath } : {}),
      ...(this.#o.now ? { now: this.#o.now } : {}),
      ...(this.#o.platform ? { platform: this.#o.platform } : {}),
    };
    this.#web = this.#o.createWeb ? this.#o.createWeb(opts) : WebEndpoint.create(opts);
    await this.#web.ensureListening();
    if (!this.#web.listening) throw new Error('the setup endpoint did not start');
    this.#token = randomBytes(SETUP_TOKEN_BYTES);
    const ttl = this.#o.ttlMs ?? SETUP_TOKEN_TTL_MS;
    this.#expiresAt = this.#now() + ttl;
    this.#expiry = setTimeout(() => {
      if (!this.#consumed) this.#abort('token-expired', 'the setup link expired unused (60 s)');
    }, ttl);
    this.#expiry.unref();
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

  #abort(reason: string, message: string, leftoverGen?: string): void {
    this.#ac.abort();
    this.#finish({ ok: false, reason, message, ...(leftoverGen ? { leftoverGen } : {}) });
  }

  #finish(o: SetupOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    if (this.#expiry) clearTimeout(this.#expiry);
    if (this.#idle) clearTimeout(this.#idle);
    // an abort waits for the provisioner to reach its step boundary and clean up
    void (this.#running ?? Promise.resolve()).catch(() => undefined).then(() => this.#settle(o));
  }

  /** The idle cap after auth: re-armed by every request, it fires only with nothing running. */
  #touch(): void {
    if (this.#idle) clearTimeout(this.#idle);
    const ms = this.#o.idleMs ?? SETUP_IDLE_MS;
    this.#idle = setTimeout(() => {
      if (this.#running) return this.#touch();
      this.#abort('idle', `nothing happened on the setup page for ${Math.round(ms / 60_000)} min`);
    }, ms);
    this.#idle.unref();
  }

  /** One job at a time; #running is cleared whatever happens (round 2 blocker a). */
  async #job<T>(f: () => Promise<T>): Promise<T> {
    if (this.#running) throw new RpcRefusal('FORBIDDEN', 'setup-busy', 'another setup step is still running');
    const p = f();
    this.#running = p;
    try {
      return await p;
    } finally {
      this.#running = null;
    }
  }

  #engine(helperPath: string = this.#o.helperPath): Provisioner {
    const o = this.#o;
    return new Provisioner({
      home: o.home,
      helperPath,
      ...(o.verifier ? { verifier: o.verifier } : {}),
      ...(o.start ? { start: o.start } : {}),
      ...(o.once ? { once: o.once } : {}),
      signal: this.#ac.signal,
    });
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
    this.#registered = this.#report.existing ? deviceRegistered(o.home, this.#report.existing) : false;
    return this.#report;
  }

  #reportView(r: PreflightReport): Record<string, unknown> {
    return {
      checks: r.checks.map((c) => ({ ...c })),
      leftover: [...r.leftover],
      existing: r.existing ? { rootKeyId: r.existing.rootKeyId, createdAt: r.existing.createdAt, registered: this.#registered } : null,
      ok: r.ok,
      defaultName: this.#o.defaultName,
    };
  }

  #resultView(rec: IdentityRecord): Record<string, unknown> {
    const h = this.#o.home;
    return { rootKeyId: rec.rootKeyId, principalId: rec.principalId, deviceId: rec.deviceId, files: [identityPath(h), registryPath(h), deviceKeyPath(h), identityJournalPath(h)] };
  }

  /** MEDIUM-2 (mirrors setup-cli): never purge a generation another home (GNOMON_HOME) lives on. */
  #purgeGuard(gen: string): void {
    for (const h of this.#o.alsoCheckHomes ?? []) {
      let other: IdentityRecord | null;
      try {
        other = readIdentity(h);
      } catch {
        throw new RpcRefusal('FORBIDDEN', 'identity-malformed', `the home GNOMON_HOME names (${h}) has an unreadable identity.json that may use generation ${gen}; not purging blind`);
      }
      if (other?.gen === gen) throw new RpcRefusal('FORBIDDEN', 'in-use', `generation ${gen} is the live identity of ${h} (GNOMON_HOME); setup will not delete it`);
    }
  }

  /** Created only at begin (the checks are read-only): owner-only, and never a symlink. */
  #ensureHome(): void {
    const h = this.#o.home;
    if (!fs.existsSync(h)) fs.mkdirSync(h, { mode: 0o700 });
    const st = fs.lstatSync(h);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new RpcRefusal('FORBIDDEN', 'unsafe-home', `${h} is not a plain directory`);
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
        const keys = typeof params === 'object' && params !== null ? Object.keys(params).sort() : [];
        const apis = params.clientApis;
        const cn = params.clientNonce;
        const okShape = keys.join(',') === HELLO_KEYS.join(',') && Array.isArray(params.features) && params.features.length === 0 && typeof params.client === 'object' && params.client !== null && !Array.isArray(params.client);
        if (!okShape || !Array.isArray(apis) || !apis.includes(SETUP_API) || typeof cn !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(cn)) throw POLICY('hello-params', `the setup endpoint speaks only ${SETUP_API}; hello is exactly {clientApis, features: [], clientNonce, client}`);
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
      if (this.#active !== ctx.connId || this.#settled) throw POLICY('unauthenticated', 'authenticate with the setup token first');
      this.#touch();
      this.#o.onDispatch?.(req.method);
      switch (req.method) {
        case 'setup.preflight':
          return this.#reportView(await this.#job(() => this.#preflight()));
        case 'setup.name':
          this.#name = String(params.name);
          return { name: this.#name };
        case 'setup.purge': {
          const gen = String(params.gen);
          if (this.#provisioned) throw new RpcRefusal('FORBIDDEN', 'setup-done', 'setup already committed; nothing to purge here');
          if (!this.#report?.leftover.includes(gen)) throw new RpcRefusal('BAD_REQUEST', 'not-leftover', 'only a leftover generation the checks listed can be purged');
          this.#purgeGuard(gen);
          const r = await this.#job(async () => {
            const p = this.#engine();
            p.on('event', relay(ctx));
            const alsoCheckHomes = this.#o.alsoCheckHomes ?? [];
            return p.purgeGeneration(gen, alsoCheckHomes.length ? { alsoCheckHomes } : {});
          });
          // a refused or cancelled purge does NOT end setup: the page stays on the checks
          if (!r.ok) throw new RpcRefusal('FORBIDDEN', r.reason, r.message);
          return this.#reportView(await this.#job(() => this.#preflight()));
        }
        case 'setup.begin': {
          const rep = this.#report;
          if (this.#provisioned) throw new RpcRefusal('FORBIDDEN', 'setup-done', 'setup already committed');
          if (!rep || !rep.ok || rep.existing || rep.leftover.length) throw new RpcRefusal('FORBIDDEN', 'preflight-failed', 'run the checks and fix every failing one first');
          if (!this.#name) throw new RpcRefusal('FORBIDDEN', 'no-name', 'choose your name first');
          const r = await this.#job(async () => {
            this.#ensureHome();
            const p = this.#engine();
            p.on('event', relay(ctx));
            return p.provision({ mode: 'init', existing: null, name: this.#name!, host: this.#o.host ?? hostOf() });
          });
          if (!r.ok) {
            const leftoverGen = typeof r.extra.leftoverGen === 'string' ? r.extra.leftoverGen : undefined;
            if (r.reason === 'interrupted') this.#abort(r.reason, r.message, leftoverGen);
            this.#o.onNotice?.(`setup stopped: ${r.message}${leftoverGen ? ` — keys of generation ${leftoverGen} were left in the Secure Enclave; delete them from the checks` : ' — nothing half-done was kept'}`);
            throw new RpcRefusal('FORBIDDEN', r.reason, r.message, leftoverGen ? { leftoverGen } : undefined);
          }
          this.#provisioned = true;
          return this.#resultView(r.record!);
        }
        case 'setup.complete': {
          const ex = this.#report?.existing;
          if (!ex || this.#registered || this.#provisioned) throw new RpcRefusal('FORBIDDEN', 'nothing-to-complete', 'this home has nothing to finish');
          // I5: the helper comes from identity.json; I10: the saved, root-signed row is appended (0 prompts)
          const r = await this.#job(() => this.#engine(ex.helperPath).completeDevice());
          if (!r.ok) {
            this.#o.onNotice?.(`finishing setup failed: ${r.message}`);
            throw new RpcRefusal('FORBIDDEN', r.reason, r.message);
          }
          this.#provisioned = true;
          this.#registered = true;
          return this.#resultView(r.record ?? ex);
        }
        case 'setup.finish':
          // a commit, a completion, or a home that was already fully set up: settle and continue into the launch
          if (!this.#provisioned && !(this.#report?.existing && this.#registered)) throw new RpcRefusal('FORBIDDEN', 'not-provisioned', 'setup has not finished');
          this.#finish({ ok: true, home: this.#o.home, provisioned: this.#provisioned });
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
        this.#abort('token-reuse', 'the setup link was used twice; setup was aborted');
      }
      throw POLICY('replayed-token', 'the setup token was already used');
    }
    if (!live || this.#settled) throw POLICY('token-expired', 'the setup token expired (60 s); start setup again');
    if (this.#active !== null) throw POLICY('setup-busy', 'another setup connection is active');
    this.#consumed = true;
    this.#active = ctx.connId;
    if (this.#expiry) clearTimeout(this.#expiry);
    ctx.authenticated();
    this.#touch();
    return { authenticated: true, setupApiId: SETUP_API_ID };
  }
}

function hostOf(): string {
  const h = os.hostname().replace(/\.local$/, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return (h || 'mac').slice(0, 64);
}
