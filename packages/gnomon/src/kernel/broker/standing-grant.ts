/**
 * @symbol #standing-grant
 *
 * #standing-grant: the daily standing grant (TD-2026-10-20-086 F6; spec §3.4 "Standing grant"). The founder's
 * Touch ID fails, so every presence proof is a typed password; the bar is never to prompt more than native Claude
 * Code. ONE `grant` card, raised with RaiseInput.standingGrant so its allow is FRESH class (one presence, no root
 * signature; every other `grant` card keeps classes.ts's root class; Aegis open point 1), mints
 * `grant.standing{grantId, cardId, tuples, repos, device, expiresAt, by}`; while it stands, a human decision on the
 * SAME GUI device that one of its tuples covers takes no presence prompt: the broker writes
 * `approval.decide{presence:'standing:<grantId>'}` (the decisionSig is still the approvals key's, signed by the
 * helper under the device's cached unlock, which the grant's own touch keeps) and then the notify row
 * `grant.standing.used{grantId, cardId, tuple, decision, repo, hsid}`, which the GUI shows as a toast and in a feed
 * with Revoke. Revoke writes `grant.standing.revoked{grantId, by, reason:'human'}`: a tighten, no presence.
 *
 *   tuples   STANDING_TUPLES (contracts, closed): mode.loosen:auto-edits, permission:always, voice.widen,
 *            voice-arm:allow and daemon-stop:restart (a daemon-stop card the KERNEL marked binaryUnchanged by
 *            hashing the running binary against the one on disk; never a request field). Not reconsider.extend
 *            (Aegis M2).
 *   repos    the repo keys a repo-scoped tuple (mode loosen, always) may use it in; voice, arm and
 *            restart carry no repo and are covered by the grant itself (it is bound to one device and one day).
 *   ends     expiresAt (at most STANDING_GRANT_MAX_MS = 12 h after it was minted), the next screen lock, sleep or
 *            user switch, a helper exit (endAll writes grant.standing.revoked with that reason), or Revoke.
 *
 * NEVER standing (standingTupleOf answers null; the broker also refuses root-class and hand-only cards before it
 * asks): root/install/repin (any binary or publisher change), gate-class, fallback-cloud, declassify, and every
 * peer-raised (peer-flagged) or irreversible card. A non-human connection, a CLI (device credential) and another
 * device can neither mint nor use one.
 *
 * The grants are FOLDED from kernel-signed rows only (StandingGrantBook, like #always-rules' RuleBook and
 * RunModeBook): a row from any other principal or key is ignored, so a forged grant.standing never covers anything
 * and a forged revoke never ends one.
 */
import { STANDING_GRANT_MAX_MS, STANDING_PRESENCE_PREFIX, STANDING_REPO_TUPLES, STANDING_REVOKE_REASONS, STANDING_TUPLES, type CardV1, type StandingRevokeReason, type StandingTuple } from '@a-company/gnomon-contracts';
import type { KernelLog } from '../log/index.js';
import type { RuleRow, RuleSource } from '../supervisor/rules.js';
import { fail, unlockKeyOf, type ApprovalBroker, type BrokerLog, type DecideContext, type StandingMatch, type StandingSeam } from './broker.js';

export { STANDING_GRANT_MAX_MS, STANDING_PRESENCE_PREFIX, STANDING_TUPLES };
export const STANDING_KINDS = Object.freeze(['grant.standing', 'grant.standing.used', 'grant.standing.revoked'] as const);
/** A grant card nobody decides expires into deny after this long. */
export const STANDING_CARD_TIMEOUT_MS = 2 * 60_000;
export const MAX_STANDING_REPOS = 64;
const MAX_TRACKED = 256;
const REPO_KEY = /^sha256:[0-9a-f]{64}$/;
const CARD_ID = /^card:[0-9A-HJKMNP-TV-Z]{26}$/;
const DEVICE_KEY = /^udev:[0-9a-f]{40}$/;
/** Card kinds a standing grant never covers (defence in depth: no tuple names them either). */
export const NEVER_STANDING_KINDS: ReadonlySet<string> = new Set(['install', 'gate-class', 'fallback', 'declassify', 'peer-pair', 'api-token', 'grant', 'handoff']);

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const isTuple = (v: unknown): v is StandingTuple => (STANDING_TUPLES as readonly unknown[]).includes(v);

export interface StandingGrant {
  grantId: string;
  tuples: StandingTuple[];
  repos: string[];
  /** the GUI device's unlock key (broker unlockKeyOf) */
  device: string;
  /** epoch ms */
  expiresAt: number;
  by: string | null;
  revoked: string | null;
  uses: number;
}

export interface KernelTrustLike {
  principal: string;
  isKernelKey: (keyId: string) => boolean;
}

/**
 * The standing grants, DERIVED from kernel-signed rows (never stored elsewhere). Unknown tuples in a row fold away
 * (a newer kernel's tuple never widens this one); a malformed row covers nothing.
 */
export class StandingGrantBook {
  readonly #trust: KernelTrustLike;
  readonly #grants = new Map<string, StandingGrant>();
  lastSeq = 0;

  constructor(trust: KernelTrustLike) {
    this.#trust = trust;
  }

  fold(r: RuleRow): void {
    if (typeof r.seq === 'number' && r.seq > this.lastSeq) this.lastSeq = r.seq;
    if (r.principal !== this.#trust.principal || typeof r.keyId !== 'string' || !this.#trust.isKernelKey(r.keyId)) return;
    const p = obj(r.payload);
    if (!p || typeof p.grantId !== 'string' || !CARD_ID.test(p.grantId)) return;
    if (r.kind === 'grant.standing') {
      const tuples = Array.isArray(p.tuples) ? [...new Set(p.tuples.filter(isTuple))] : [];
      const repos = Array.isArray(p.repos) ? p.repos.filter((x): x is string => typeof x === 'string' && REPO_KEY.test(x)).slice(0, MAX_STANDING_REPOS) : [];
      const exp = typeof p.expiresAt === 'string' ? Date.parse(p.expiresAt) : NaN;
      if (!tuples.length || typeof p.device !== 'string' || !DEVICE_KEY.test(p.device) || !Number.isFinite(exp)) return;
      this.apply({ grantId: p.grantId, tuples, repos, device: p.device, expiresAt: exp, by: typeof p.by === 'string' ? p.by : null, revoked: null, uses: 0 });
    } else if (r.kind === 'grant.standing.revoked') {
      this.revoke(p.grantId, typeof p.reason === 'string' ? p.reason : 'human');
    } else if (r.kind === 'grant.standing.used') {
      const g = this.#grants.get(p.grantId);
      if (g) g.uses++;
    }
  }

  apply(g: StandingGrant): void {
    this.#grants.delete(g.grantId);
    this.#grants.set(g.grantId, { ...g, tuples: [...g.tuples], repos: [...g.repos] });
    while (this.#grants.size > MAX_TRACKED) this.#grants.delete(this.#grants.keys().next().value!);
  }

  revoke(grantId: string, reason: string): void {
    const g = this.#grants.get(grantId);
    if (g && !g.revoked) g.revoked = reason;
  }

  noteUse(grantId: string): void {
    const g = this.#grants.get(grantId);
    if (g) g.uses++;
  }

  get(grantId: string): StandingGrant | null {
    const g = this.#grants.get(grantId);
    return g ? { ...g, tuples: [...g.tuples], repos: [...g.repos] } : null;
  }

  /** Grants not revoked and not past expiresAt. */
  active(now: number): StandingGrant[] {
    return [...this.#grants.values()].filter((g) => !g.revoked && g.expiresAt > now).map((g) => ({ ...g, tuples: [...g.tuples], repos: [...g.repos] }));
  }

  advanceTo(seq: number): void {
    if (seq > this.lastSeq) this.lastSeq = seq;
  }
}

/** The kernel log as a source of the standing rows (released head, full view), like run-mode.ts modeSourceOf. */
export function standingSourceOf(log: Pick<KernelLog, 'releasedHead' | 'read'>): RuleSource {
  return {
    head: () => log.releasedHead(),
    read: function* (fromSeq, toSeq) {
      for (const v of log.read({ reader: { class: 'human' }, fromSeq, toSeq, kinds: STANDING_KINDS })) {
        if (v.view === 'full') yield { seq: v.event.seq, kind: v.event.kind, principal: v.event.principal, keyId: v.event.keyId, payload: v.event.payload };
      }
    },
  };
}

/**
 * Which tuple a decision on a card is, and the repo it is scoped to (null: a repo-less tuple), or null when no
 * standing grant may ever cover it. `detail` is the kernel's raise detail (inside the contentHash); `ruleRepo` the
 * permission card's rule scope.
 */
export function standingTupleOf(card: Pick<CardV1, 'kind' | 'flags'>, decision: string, detail: Record<string, unknown>, ruleRepo: string | null): { tuple: StandingTuple; repo: string | null } | null {
  const kind = String(card.kind);
  const flags = (card.flags ?? []) as string[];
  if (NEVER_STANDING_KINDS.has(kind) || flags.includes('peer') || flags.includes('irreversible')) return null;
  if (kind === 'permission' && decision === 'always') return ruleRepo ? { tuple: 'permission:always', repo: ruleRepo } : null;
  if (kind === 'strictness' && decision === 'allow') {
    if (detail.op === 'mode.loosen' && detail.to === 'auto-edits') {
      const sc = obj(detail.scope);
      return sc && typeof sc.repo === 'string' ? { tuple: 'mode.loosen:auto-edits', repo: sc.repo } : null;
    }
    if (detail.op === 'voice.widen') return { tuple: 'voice.widen', repo: null };
    return null;
  }
  if (kind === 'voice-arm' && decision === 'allow') return { tuple: 'voice-arm:allow', repo: null };
  // a restart with NO binary change only: an upgrade card (detail.update) names a new build and is never standing
  if (kind === 'daemon-stop' && decision === 'accept' && detail.binaryUnchanged === true && detail.update === undefined) return { tuple: 'daemon-stop:restart', repo: null };
  return null; // reconsider.extend is never standing (Aegis M2)
}

export interface StandingAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
  deviceId?: string;
}

export interface StandingDeps {
  broker: Pick<ApprovalBroker, 'raise' | 'card'>;
  book: () => StandingGrantBook;
  /** writes a kernel-signed row (must reject if it was not written) */
  log: BrokerLog;
  clock?: () => number;
  /** an absolute path to its repo key (repo-hooks.ts repoKeyOf); absent ⇒ only repo keys are accepted */
  repoKeyOfPath?: (abs: string) => string;
  timeoutMs?: number;
  /** told after a grant is minted, used or revoked (the GUI re-reads status on the rows anyway) */
  onChange?: () => void;
}

const SHORT = (s: string): string => (s.length > 16 ? `…${s.slice(-10)}` : s);
const TUPLE_TEXT: Readonly<Record<StandingTuple, string>> = Object.freeze({
  'mode.loosen:auto-edits': 'loosen a folder or session to auto-edits',
  'permission:always': 'make an "always" rule',
  'voice.widen': 'widen voice to ambient listening',
  'voice-arm:allow': 'arm voice approvals',
  'daemon-stop:restart': 'restart Gnomon when its binary did not change',
});

/** The human's first-party GUI connection only: a CLI, an agent, a mod, voice or a peer never mints or uses one. */
function guiHuman(a: { principalClass: string; credential: string | undefined; principal?: string | undefined; deviceId?: string | undefined }): boolean {
  return a.principalClass === 'human' && a.credential === 'gui' && typeof a.deviceId === 'string' && a.deviceId.length > 0;
}

export class StandingGrants implements StandingSeam {
  readonly #d: StandingDeps;
  #pending: { cardId: string; device: string } | null = null;

  constructor(d: StandingDeps) {
    this.#d = d;
  }

  #now(): number {
    return (this.#d.clock ?? Date.now)();
  }

  #changed(): void {
    try {
      this.#d.onChange?.();
    } catch {
      /* the row is written */
    }
  }

  /** request.grant.standing{tuples, repos} from the human on the GUI: one root-class `grant` card (one presence). */
  async request(asker: StandingAsker, payload: unknown): Promise<{ pending: true; cardId: string; tuples: StandingTuple[]; repos: string[] }> {
    if (!guiHuman(asker) || typeof asker.principal !== 'string') throw fail('FORBIDDEN', 'matrix', 'a standing grant is minted only by the human on the GUI (a launch-token session of this device)', { verb: 'log.append' });
    const p = obj(payload);
    if (!p) throw fail('BAD_REQUEST', 'bad-params', 'request.grant.standing takes payload {tuples, repos}');
    const extra = Object.keys(p).filter((k) => k !== 'tuples' && k !== 'repos');
    if (extra.length) throw fail('BAD_REQUEST', 'bad-params', `request.grant.standing takes only {tuples, repos} (unknown: ${extra.slice(0, 4).join(', ')})`);
    if (!Array.isArray(p.tuples) || p.tuples.length === 0 || p.tuples.length > STANDING_TUPLES.length || !p.tuples.every(isTuple)) throw fail('BAD_REQUEST', 'bad-params', `tuples is a non-empty list of ${STANDING_TUPLES.join(', ')}`);
    const tuples = [...new Set(p.tuples as StandingTuple[])].sort();
    const rawRepos = p.repos === undefined ? [] : p.repos;
    if (!Array.isArray(rawRepos) || rawRepos.length > MAX_STANDING_REPOS) throw fail('BAD_REQUEST', 'bad-params', `repos is a list of at most ${MAX_STANDING_REPOS} repo keys or absolute paths`);
    const repos: string[] = [];
    for (const r of rawRepos) {
      if (typeof r === 'string' && REPO_KEY.test(r)) repos.push(r);
      else if (typeof r === 'string' && this.#d.repoKeyOfPath && r.startsWith('/') && r.length <= 4096 && !r.includes('\u0000')) repos.push(this.#d.repoKeyOfPath(r));
      else throw fail('BAD_REQUEST', 'bad-params', 'each repo is a repo key (sha256:<hex>) or an absolute path');
    }
    const repoSet = [...new Set(repos)].sort();
    const device = unlockKeyOf({ connId: asker.connId, credential: 'gui', deviceId: asker.deviceId! });
    const still = this.#pending ? this.#d.broker.card(this.#pending.cardId) : undefined;
    if (this.#pending && still?.state === 'pending') {
      if (this.#pending.device === device) return { pending: true, cardId: this.#pending.cardId, tuples, repos: repoSet };
      throw fail('BAD_REQUEST', 'bad-params', 'a standing grant card is pending; decide it first', { cardId: this.#pending.cardId });
    }
    this.#pending = null;
    await this.#d.log('request.grant.standing', { tuples, repos: repoSet }, { connId: asker.connId });
    const principal = asker.principal;
    const card = await this.#d.broker.raise({
      kind: 'grant',
      requestedBy: principal,
      attended: true,
      detail: { op: 'standing', tuples, repos: repoSet, device, maxMs: STANDING_GRANT_MAX_MS },
      lines: [
        'Let Gnomon handle these today, with no password each time:',
        ...tuples.map((t) => `· ${TUPLE_TEXT[t]}`),
        `in ${repoSet.length ? repoSet.map(SHORT).join(', ') : 'no repo (repo-scoped items stay off)'} · this device only`,
        'Each use is shown to you with Revoke. Ends at the next screen lock, sleep or user switch, or after 12 h',
        'Never covered: installs, re-pins, gate-class, cloud fallback, declassify, anything a peer raised',
      ],
      decisions: ['allow', 'deny'],
      // Aegis open point 1: one presence (fresh class), no root signature; every other grant card stays root
      standingGrant: true,
      timeoutMs: this.#d.timeoutMs ?? STANDING_CARD_TIMEOUT_MS,
      effect: async (decision, ctx) => {
        if (decision !== 'allow') return;
        const expiresAt = this.#now() + STANDING_GRANT_MAX_MS;
        await this.#d.log('grant.standing', { grantId: card.cardId, cardId: card.cardId, tuples, repos: repoSet, device, expiresAt: new Date(expiresAt).toISOString(), by: principal }, { connId: ctx.connId });
        this.#d.book().apply({ grantId: card.cardId, tuples, repos: repoSet, device, expiresAt, by: principal, revoked: null, uses: 0 });
        this.#changed();
      },
    });
    this.#pending = { cardId: card.cardId, device };
    return { pending: true, cardId: card.cardId, tuples, repos: repoSet };
  }

  /** request.grant.standing.revoke{grantId}: a tighten, no presence; the human on the GUI or this home's device. */
  async revoke(asker: StandingAsker, payload: unknown): Promise<{ revoked: boolean; grantId: string }> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || typeof asker.principal !== 'string') throw fail('FORBIDDEN', 'matrix', 'a standing grant is revoked only by the human on a first-party connection', { verb: 'log.append' });
    const p = obj(payload);
    if (!p || typeof p.grantId !== 'string' || !CARD_ID.test(p.grantId) || Object.keys(p).length !== 1) throw fail('BAD_REQUEST', 'bad-params', 'request.grant.standing.revoke takes payload {grantId}');
    const g = this.#d.book().get(p.grantId);
    if (!g) throw fail('NOT_FOUND', 'not-found', `no standing grant ${p.grantId}`);
    if (g.revoked || g.expiresAt <= this.#now()) return { revoked: false, grantId: p.grantId };
    await this.#d.log('request.grant.standing.revoke', { grantId: p.grantId }, { connId: asker.connId });
    await this.#end(p.grantId, asker.principal, 'human', asker.connId);
    return { revoked: true, grantId: p.grantId };
  }

  async #end(grantId: string, by: string | null, reason: StandingRevokeReason, connId?: string): Promise<void> {
    await this.#d.log('grant.standing.revoked', { grantId, by, reason }, connId ? { connId } : {});
    this.#d.book().revoke(grantId, reason);
    this.#changed();
  }

  /** The session ended (lock, sleep, user switch) or the helper exited: every live grant ends with it. */
  async endAll(reason: StandingRevokeReason): Promise<string[]> {
    if (!(STANDING_REVOKE_REASONS as readonly string[]).includes(reason)) return [];
    const out: string[] = [];
    for (const g of this.#d.book().active(this.#now())) {
      await this.#end(g.grantId, null, reason).catch(() => undefined);
      out.push(g.grantId);
    }
    return out;
  }

  /** StandingSeam.match: the live grant of THIS GUI device that covers (card, decision), or null. */
  match(ctx: DecideContext, card: CardV1, decision: string, detail: Record<string, unknown>, ruleRepo: string | null): StandingMatch | null {
    if (!guiHuman(ctx)) return null;
    const t = standingTupleOf(card, decision, detail, ruleRepo);
    if (!t) return null;
    const device = unlockKeyOf(ctx);
    for (const g of this.#d.book().active(this.#now())) {
      if (g.device !== device || !g.tuples.includes(t.tuple)) continue;
      // Aegis M2: a repo-scoped tuple needs a non-null repo that the grant names
      if ((STANDING_REPO_TUPLES as readonly string[]).includes(t.tuple) && (t.repo === null || !g.repos.includes(t.repo))) continue;
      if (t.repo !== null && !g.repos.includes(t.repo)) continue;
      return { grantId: g.grantId, tuple: t.tuple, repo: t.repo };
    }
    return null;
  }

  /** StandingSeam.used: the notify row, after approval.decide{presence:'standing:<id>'}. */
  async used(m: StandingMatch, d: { cardId: string; decision: string; hsid: string | null; connId: string }): Promise<void> {
    await this.#d.log('grant.standing.used', { grantId: m.grantId, cardId: d.cardId, tuple: m.tuple, decision: d.decision, repo: m.repo, hsid: d.hsid }, { connId: d.connId, ...(d.hsid ? { session: d.hsid } : {}) });
    this.#d.book().noteUse(m.grantId);
    this.#changed();
  }

  /** status.standing (human class): the live grants and the closed tuple list. */
  status(): Record<string, unknown> {
    const now = this.#now();
    const pending = this.#pending && this.#d.broker.card(this.#pending.cardId)?.state === 'pending' ? this.#pending.cardId : null;
    return {
      built: true,
      tuples: [...STANDING_TUPLES],
      maxMs: STANDING_GRANT_MAX_MS,
      ...(pending ? { pendingCardId: pending } : {}),
      active: this.#d.book().active(now).map((g) => ({ grantId: g.grantId, tuples: g.tuples, repos: g.repos, expiresAt: new Date(g.expiresAt).toISOString(), uses: g.uses })),
    };
  }
}
