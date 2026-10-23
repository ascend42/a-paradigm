/**
 * @symbol #gui-preview
 *
 * DEV ONLY (#gui-preview): a fake kernel for the fixture preview. It is the
 * GUI client's `Transport` (core/client.ts): the real GnomonClient, the real
 * app.ts and the real core run over it unchanged, so the preview renders the
 * GUI the kernel serves. No kernel, no sessions, no Touch ID.
 *
 * It answers the gnomon-rpc:v1 methods app.ts calls (PREVIEW_METHODS) from a
 * fixture: `hello` with a real Ed25519 serverSig made by a key generated in
 * the page (WebCrypto, never stored), `auth`, `status`, `log.read` (one
 * backlog page, then the follow subscription), `approve` (the card leaves as
 * an approval.decide row), and `log.append` / `session.send` (accepted, no
 * effect), `mod.view` for the Paradigm Context mod (paradigm-context.ts). `session.open` is refused in plain words. NOT part of the
 * kernel-served bundle (test/preview.test.ts).
 */
import { checkCap } from '@a-company/gnomon-contracts';
import { workshopBlock } from './workshop.js';
import { CLIENT_API_ID, authServerPreimage, utf8, type HelloResult, type LogRow } from '@a-company/gnomon-contracts';
import { GUI_FEATURES, RPC, type Transport } from '../core/client.js';
import { bytesToBase64Url, CARD_ACTION_DOMAIN, keyIdOfSpki } from '../core/server-sig.js';
import { HUMAN_PRINCIPAL, KERNEL_PRINCIPAL, PREVIEW_LOG_ID, type Fixture } from './fixtures.js';
import { PARADIGM_CONTEXT_MOD, PARADIGM_CONTEXT_VIEW, paradigmContextView } from './paradigm-context.js';

/** A marker the bundle-exclusion test looks for in the embedded bundle (it must never be there). */
export const PREVIEW_MARKER = 'gnomon-preview:fake-kernel:v1';

/** Every method the preview kernel answers (test/preview.test.ts checks app.ts calls nothing else). */
export const PREVIEW_METHODS: readonly string[] = Object.freeze(['hello', 'auth', 'status', 'log.read', 'approve', 'log.append', 'session.send', 'session.open', 'mod.view']);

export interface PreviewKey {
  subtle: SubtleCrypto;
  privateKey: CryptoKey;
  /** base64url SPKI DER: the launch fragment's `k` */
  spki: string;
  keyId: string;
}

const b64 = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

/** A fresh Ed25519 key for this page only (non-extractable private half). */
export async function previewKey(subtle: SubtleCrypto): Promise<PreviewKey> {
  const kp = (await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array(await subtle.exportKey('spki', kp.publicKey));
  return { subtle, privateKey: kp.privateKey, spki: bytesToBase64Url(der), keyId: keyIdOfSpki(der) };
}

async function sign(key: PreviewKey, msg: string): Promise<string> {
  return b64(new Uint8Array(await key.subtle.sign({ name: 'Ed25519' }, key.privateKey, utf8(msg).slice().buffer as ArrayBuffer)));
}

/** The fixture rows with every card action signed by `key`, as the broker signs them (gnomon:card-action:v1). */
export async function signRows(rows: readonly LogRow[], key: PreviewKey): Promise<LogRow[]> {
  const out = structuredClone(rows) as LogRow[];
  for (const r of out) {
    if (r.view !== 'full' || r.event.kind !== 'approval.request') continue;
    const card = (r.event.payload as { card?: { cardId: string; contentHash: string; actions: Array<Record<string, unknown>> } } | undefined)?.card;
    if (!card) continue;
    card.actions = await Promise.all(card.actions.map(async (a) => ({ decision: a.decision, keyId: key.keyId, sig: await sign(key, `${CARD_ACTION_DOMAIN}\n${card.cardId}\n${String(a.decision)}\n${card.contentHash}`) })));
  }
  return out;
}

/** Every `cap` on a Text node of a block (bounded depth). */
function capsOf(n: unknown, depth = 0, out: unknown[] = []): unknown[] {
  if (depth > 32 || !n || typeof n !== 'object') return out;
  const o = n as Record<string, unknown>;
  if (o.type === 'Text' && o.cap !== undefined) out.push(o.cap);
  if (Array.isArray(o.children)) for (const c of o.children) capsOf(c, depth + 1, out);
  return out;
}

const refusal = (code: string, reason: string, message: string): { code: number; message: string; data: Record<string, unknown> } => ({ code: -32000, message, data: { schemaVersion: 'refusal:v1', code, message, data: { reason }, next: [] } });

export class FakeKernel implements Transport {
  onMessage: ((text: string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  readonly rows: LogRow[];
  readonly #status: Record<string, unknown>;
  /** #paradigm-context-mod slices by hsid (the fixture stands in for the host's K3 join), null: the mod is not installed */
  readonly #paradigm: Readonly<Record<string, unknown>> | null;
  readonly #key: PreviewKey;
  readonly #endpointPath: string;
  #open = true;
  #nonce = '';
  #following = false;
  readonly #rowListeners = new Set<(r: LogRow) => void>();
  /** Resolves once the page subscribed (log.read follow): the backlog is in the store. */
  readonly followed: Promise<void>;
  #resolveFollowed!: () => void;

  constructor(fx: Pick<Fixture, 'status'> & Partial<Pick<Fixture, 'paradigm'>>, signedRows: readonly LogRow[], key: PreviewKey, endpointPath: string) {
    this.rows = [...signedRows];
    this.#status = fx.status;
    this.#paradigm = fx.paradigm ?? null;
    this.#key = key;
    this.#endpointPath = endpointPath;
    this.followed = new Promise((r) => (this.#resolveFollowed = r));
  }

  isOpen(): boolean {
    return this.#open;
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    queueMicrotask(() => this.onClose?.(1000));
  }

  /** Rows appended after load (a decided card), for the Workshop strip. */
  onRow(fn: (r: LogRow) => void): void {
    this.#rowListeners.add(fn);
  }

  send(text: string): void {
    let f: { id?: number; method?: string; params?: Record<string, unknown> };
    try {
      f = JSON.parse(text) as typeof f;
    } catch {
      return;
    }
    if (typeof f.method !== 'string' || typeof f.id !== 'number') return;
    const id = f.id;
    void this.#answer(f.method, f.params ?? {}).then(
      (result) => this.#emit({ jsonrpc: '2.0', rpc: RPC, id, result }),
      (error: unknown) => this.#emit({ jsonrpc: '2.0', rpc: RPC, id, error }),
    );
  }

  #emit(frame: Record<string, unknown>): void {
    if (this.#open) setTimeout(() => this.onMessage?.(JSON.stringify(frame)), 0);
  }

  /** Append a row as the kernel would and deliver it to the follow subscription. */
  append(kind: string, payload: Record<string, unknown>, session?: string): void {
    const head = this.rows.length ? this.rows[this.rows.length - 1]!.seq : 0;
    const row: LogRow = { seq: head + 1, view: 'full', event: { schemaVersion: 'event:v1', log: PREVIEW_LOG_ID, seq: head + 1, at: new Date().toISOString(), principal: KERNEL_PRINCIPAL, kind, payload, ...(session ? { session } : {}) } };
    this.rows.push(row);
    for (const fn of this.#rowListeners) fn(row);
    if (this.#following) this.#emit({ jsonrpc: '2.0', rpc: RPC, method: 'event', params: { row } });
  }

  async #answer(method: string, p: Record<string, unknown>): Promise<unknown> {
    const head = this.rows.length ? this.rows[this.rows.length - 1]!.seq : 0;
    switch (method) {
      case 'hello': {
        const clientNonce = String(p.clientNonce ?? '');
        const offered = Array.isArray(p.features) ? p.features.filter((x): x is string => typeof x === 'string') : [];
        const features = offered.filter((x) => GUI_FEATURES.includes(x));
        this.#nonce = bytesToBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
        const serverSig = await sign(this.#key, authServerPreimage(this.#nonce, clientNonce, this.#endpointPath, { clientApi: RPC, features }));
        const hello: HelloResult = { clientApi: RPC, features, nonce: this.#nonce, clientNonce, serverKeyId: this.#key.keyId, serverSig, clientApiId: CLIENT_API_ID, kitId: 'kit:v1' };
        return hello;
      }
      case 'auth':
        return { guiToken: 'preview-gui-token', principal: HUMAN_PRINCIPAL, connId: 'conn:01JAPREVX4K7Q2M9FBH3N8RTWC' };
      case 'status':
        // #gui-folder-field: the kernel opens the chooser (a shot sets __ffPreview.chooser false for no-chooser)
        return { ...structuredClone(this.#status), folders: { chooser: previewFolders().chooser !== false }, ...(previewFolders().mods ? { mods: previewFolders().mods } : {}), ...(previewFolders().local ? { local: previewFolders().local } : {}) };
      case 'log.read': {
        if (p.follow === true) {
          this.#following = true;
          queueMicrotask(() => this.#resolveFollowed());
          return { subscription: 'sub:preview', since: head, logId: PREVIEW_LOG_ID, head };
        }
        return { rows: this.rows, next: head, cursor: { logId: PREVIEW_LOG_ID, seq: head }, head, caughtUp: true, logId: PREVIEW_LOG_ID };
      }
      case 'approve': {
        const cardId = String(p.cardId ?? '');
        const req = this.rows.find((r) => r.view === 'full' && r.event.kind === 'approval.request' && (r.event.payload as { card?: { cardId?: string } }).card?.cardId === cardId);
        if (!req || req.view !== 'full') throw refusal('NOT_FOUND', 'unknown-card', 'no pending card with that id (preview)');
        this.append('approval.decide', { cardId, decision: String(p.decision ?? ''), presence: 'fresh', via: 'gui' }, req.event.session);
        return { cardId, decided: true };
      }
      case 'log.append': {
        // #gui-folder-field: request.folder.* answered from the preview set (a shot may override it: __ffPreview)
        if (typeof p.kind === 'string' && p.kind.startsWith('request.folder.')) return previewFolderAnswer(p.kind, (p.payload ?? {}) as Record<string, unknown>);
        // #gui-offer-slip: the kernel decides the offer (offer.decided on the offer's own conversation)
        const pl = (p.payload ?? {}) as { offerId?: unknown; decision?: unknown };
        if (p.kind === 'request.offer.decide' && typeof pl.offerId === 'string') {
          const shown = this.rows.find((r) => r.view === 'full' && r.event.kind === 'offer.shown' && (r.event.payload as { offerId?: string }).offerId === pl.offerId);
          if (shown && shown.view === 'full') this.append('offer.decided', { offerId: pl.offerId, hsid: shown.event.session, decision: String(pl.decision) }, shown.event.session);
        }
        return { ok: true };
      }
      case 'session.send':
        return { ok: true };
      case 'mod.view': {
        if (this.#paradigm && p.name === PARADIGM_CONTEXT_MOD && p.viewId === PARADIGM_CONTEXT_VIEW) return paradigmContextView(this.#paradigm, p);
        // S5: the Workshop strip from the REAL mod model over these rows; every cap must pass the contracts check the
        // kernel gate runs (modhost/block.ts), else the preview refuses like the kernel would
        const views = ((this.#status.mods as { views?: Array<{ name: string; viewId: string }> } | undefined)?.views ?? []);
        if (!views.some((v) => v.name === p.name && v.viewId === p.viewId) || p.name !== 'gnomon.workshop') throw refusal('NOT_FOUND', 'not-running', `mod ${String(p.name)} is not running (preview)`);
        const block = workshopBlock(this.rows, { motion: 'full', theme: 'day' });
        const bad = capsOf(block).map(checkCap).find((c) => !c.ok);
        if (bad && !bad.ok) throw refusal('BAD_REQUEST', 'block', bad.why);
        return { label: 'mod:workshop', dev: false, block };
      }
      case 'session.open':
        throw refusal('UNAVAILABLE', 'preview', 'this is the GUI fixture preview: there is no kernel, so no session was opened');
      default:
        throw refusal('NOT_FOUND', 'unknown-method', `the preview kernel does not answer ${method}`);
    }
  }
}

/**
 * A WebSocket stand-in over a FakeKernel: the shape core/client.ts webSocketTransport uses (readyState, send,
 * close, onopen/onmessage/onclose/onerror). The page installs it as globalThis.WebSocket before app.ts connects.
 */
export function fakeWebSocketClass(make: (url: string) => FakeKernel): new (url: string) => unknown {
  return class FakeWebSocket {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    readonly #k: FakeKernel;
    constructor(url: string) {
      this.#k = make(url);
      this.#k.onMessage = (data) => this.onmessage?.({ data });
      this.#k.onClose = (code) => {
        this.readyState = 3;
        this.onclose?.({ code });
      };
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 0);
    }
    send(s: string): void {
      this.#k.send(s);
    }
    close(): void {
      this.#k.close();
    }
  };
}

/* ── #gui-folder-field (DEV ONLY): the folder requests over a preview set of folders ─────────────────────────────── */
interface FolderPreview {
  chooser?: boolean;
  recent?: Array<{ real: string; display: string; repoName: string; lastUsedAt: string }>;
  /** path → check answer (anything else: ok inside the home) */
  check?: Record<string, Record<string, unknown>>;
  /** the chooser's answer; 'hold' keeps it open */
  choose?: Record<string, unknown> | 'hold';
  /** a status.mods to show (Mods › Configure needs a configurable mod) */
  mods?: Record<string, unknown>;
  /** a status.local to show (Settings › Local model, for the runner field) */
  local?: Record<string, unknown>;
}
const PREVIEW_HOME = '/Users/you';
function previewFolders(): FolderPreview {
  return ((globalThis as { __ffPreview?: FolderPreview }).__ffPreview ?? {}) as FolderPreview;
}
const day = (d: number, hm: string): string => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  const [h, m] = hm.split(':').map(Number);
  t.setHours(h!, m!, 0, 0);
  return t.toISOString();
};
export const PREVIEW_RECENTS = [
  { real: `${PREVIEW_HOME}/Documents/GitHub/a-paradigm`, display: '~/Documents/GitHub/a-paradigm', repoName: 'a-paradigm', lastUsedAt: day(0, '14:06') },
  { real: `${PREVIEW_HOME}/Documents/GitHub/a-atelier`, display: '~/Documents/GitHub/a-atelier', repoName: 'a-atelier', lastUsedAt: day(0, '11:40') },
  { real: `${PREVIEW_HOME}/Documents/GitHub/clients/northwind/billing-reconciliation-service-for-the-eu-subsidiaries-2026`, display: '~/Documents/GitHub/clients/northwind/billing-reconciliation-service-for-the-eu-subsidiaries-2026', repoName: 'billing-reconciliation-service-for-the-eu-subsidiaries-2026', lastUsedAt: day(1, '09:12') },
  { real: `${PREVIEW_HOME}/neurons`, display: '~/neurons', repoName: 'neurons', lastUsedAt: day(4, '10:00') },
  { real: '/Volumes/Work/client-site', display: '/Volumes/Work/client-site', repoName: 'client-site', lastUsedAt: day(6, '10:00') },
  { real: `${PREVIEW_HOME}/Documents/GitHub/warpline`, display: '~/Documents/GitHub/warpline', repoName: 'warpline', lastUsedAt: day(11, '10:00') },
];
function previewCheck(path: string): Record<string, unknown> {
  const over = previewFolders().check?.[path];
  if (over) return over;
  const real = path.startsWith('~/') ? `${PREVIEW_HOME}${path.slice(1)}` : path;
  const display = real.startsWith(`${PREVIEW_HOME}/`) ? `~${real.slice(PREVIEW_HOME.length)}` : real;
  const inside = real.startsWith(`${PREVIEW_HOME}/`);
  return { ok: true, why: inside ? 'ok' : 'outside-home', real, display, name: real.split('/').pop() ?? real, home: inside ? 'inside' : 'outside' };
}
function previewFolderAnswer(kind: string, payload: Record<string, unknown>): unknown {
  const f = previewFolders();
  if (kind === 'request.folder.recent') return { recent: f.recent ?? PREVIEW_RECENTS };
  if (kind === 'request.folder.check') return previewCheck(String(payload.path ?? ''));
  if (payload.cancel === true) return { cancelled: true, closed: true };
  if (f.choose === 'hold') return new Promise(() => undefined);
  return f.choose ?? { cancelled: true };
}
