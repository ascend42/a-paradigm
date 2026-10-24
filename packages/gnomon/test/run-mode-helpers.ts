/**
 * Shared rig of the run-mode tests (test/run-modes.test.ts, test/run-modes-session.test.ts): a REAL
 * #approval-broker with a software approvals key and a scripted presence provider, a RunModeBook folding the rig's
 * rows as kernel-signed, and the RunModeControl over them.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { expect } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, PresenceDenied, RunModeBook, RunModeControl, type PresenceProvider } from '../src/kernel/broker/index.js';
import { decisionMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { mintTestPresence } from '../src/kernel/testing.js';

export const HUMAN = 'p:abcdefgh/founder';
export const KP = 'p:abcdefgh/kernel';
const GUI = { connId: 'conn:gui', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' } as const;
export const ASK_GUI = { connId: 'conn:gui', principal: HUMAN, principalClass: 'human', credential: 'gui' } as const;
export const HSID_A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';

export const errOf = async (p: Promise<unknown>): Promise<RefusedError> => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  return e as RefusedError;
};

/** A broker + run-mode control rig with no session (pure half). */
export function controlRig(o: { level?: (repo: string) => 'L0' | 'L1' | 'L2' | 'L3' | null; sessions?: Array<{ hsid: string; repoKey: string; cwd: string }>; userHome?: string; configDefault?: () => 'manual' | 'ask' | 'auto-edits' | null } = {}) {
  const rows: Array<{ kind: string; payload: Record<string, unknown>; ids?: Record<string, unknown> }> = [];
  const book = new RunModeBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
  const log = async (kind: string, payload: Record<string, unknown>, ids?: Record<string, unknown>): Promise<void> => {
    rows.push({ kind, payload, ...(ids ? { ids } : {}) });
    book.fold({ seq: rows.length, kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(payload) });
  };
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const gate = { deny: false };
  const prompts: string[] = [];
  const presence: PresenceProvider = {
    prove: async (req) => {
      prompts.push(req.prompt.text);
      if (gate.deny) throw new PresenceDenied('declined at the prompt');
      return mintTestPresence(req.purpose, { bind: req.binding });
    },
  };
  const broker = new ApprovalBroker({ kernel, kernelPrincipal: KP, log, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence, guiSessions: () => 1 });
  const sessions = o.sessions ?? [];
  const changes = { n: 0 };
  const control = new RunModeControl({
    broker,
    book: () => book,
    sessions: { scope: (h) => sessions.find((s) => s.hsid === h) ?? null, live: () => sessions },
    ...(o.level ? { level: o.level } : {}),
    logRequest: (payload, ids) => log('request.mode.set', { ...payload }, ids),
    repoKeyOfPath: (abs) => repoKeyOf([abs]),
    userHome: o.userHome ?? '/nonexistent-home-for-tests',
    ...(o.configDefault ? { configDefault: o.configDefault } : {}),
    onChange: () => {
      changes.n++;
    },
  });
  const sig = (cardId: string, decision: string) => cryptoSign('sha256', signaturePreimage('approve', decisionMessage({ cardId, decision, cardContentHash: broker.card(cardId)!.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const approve = (cardId: string, decision: string, ctx: Record<string, unknown> = GUI) => broker.approve(ctx as never, { cardId, decision, decisionSig: sig(cardId, decision) });
  const kinds = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.payload);
  return { rows, book, broker, control, approve, kinds, gate, prompts, changes };
}

