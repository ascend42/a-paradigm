/**
 * @symbol #socket
 *
 * #socket `log.append` — the namespace-ownership gate (spec §5 verb 5 and
 * "Namespace ownership", A17-3/A23-1; M1.4 slice 3, G-SOCK-04).
 *
 * The rule is checked BEFORE anything else could append, for every class the
 * matrix lets reach the verb (human, agent, mod, voice — session, read token
 * and peer are FORBIDDEN by the matrix in dispatch.ts):
 *
 *   1. Default: every kind not in a userland namespace is KERNEL-OWNED and
 *      appendable by no principal ⇒ FORBIDDEN{kernel-owned}. An unknown kind
 *      is kernel-owned (contracts kindOwner: undefined ⇒ not userland).
 *   2. The one named exception (A26-08): the `request.*` kinds of §5 by the
 *      human ON A FIRST-PARTY human-class connection, and `request.voice.arm`
 *      by the human or the voice principal. No connection can prove it is
 *      first-party yet (the GUI launch token / wrapper arrive with
 *      #web-endpoint), so the human's request.* stays FORBIDDEN{kernel-owned,
 *      needs: first-party human-class connection}; the voice cell (arms,
 *      voice slice V7) refuses ENGINE{not-implemented}; every other class is
 *      FORBIDDEN{kernel-owned}.
 *   3. Userland namespaces (`paradigm.* inject.* … modns.<name>.*`):
 *      human/agent need a `grant.bind` listing the kind; no grant row can
 *      exist before signed grants (M1.3) bind a loaded manifest (M1.5) ⇒
 *      FORBIDDEN{ungranted}.
 *      A mod appends only its own `modns.<name>.*` (labels from its manifest,
 *      written by the mod host) ⇒ ENGINE{not-implemented, M1.11} for its own,
 *      FORBIDDEN{modns-not-own} for anything else. Voice appends only
 *      `voice.*` ⇒ served by #gnomon-voice before this gate (voice slice V1; without
 *      the port ENGINE{not-implemented}); anything else FORBIDDEN.
 *
 * P8-D86/D87: ONE request kind is served — `request.mode.set` from the human
 * on a first-party connection (credential `gui`, the launch-token GUI session,
 * or `device`, this home's human device) goes to the run-mode control BEFORE
 * this gate (dispatch.ts `requests`; broker/run-mode.ts), which validates it
 * and writes the KERNEL-signed request row itself. `request.session.model`
 * (8.0:model-switch) from the same human on the same connections goes to the
 * session port (SessionPort.model), which writes its request row. `request.offer.decide` and
 * `request.offer.mute` (TD-2026-10-20-812) from the same human on the same connections go to
 * #offer-router (requests.offer), which writes the request rows. Every other caller and
 * kind still lands here.
 *
 * So in M1.4 NO principal can append through the socket: every outcome is a
 * refusal, and no path reaches KernelLog.append (falsifier: a client-chosen
 * kernel kind on the chain). The kind is validated (contracts KIND_PATTERN /
 * MODNS_KIND_PATTERN, ≤ 128 chars); the payload is never read.
 */
import { KIND_PATTERN as EVENT_KIND_PATTERN, MODNS_KIND_PATTERN, kindOwner } from '@a-company/gnomon-contracts';
import { RpcRefusal } from './rpc.js';
import { modNameOf } from './log-read.js';

/** §5's `request.*` append exception, human on a first-party human-class connection. */
export const HUMAN_REQUEST_KINDS: readonly string[] = Object.freeze([
  'request.grant',
  'request.voice.narrow',
  'request.brief.send',
  'request.cowork.allow',
  'request.link.revoke',
  'request.strictness.set',
  'request.mode.set',
  'request.incident',
  'request.voice.arm',
  'request.session.model',
  'request.offer.decide',
  'request.offer.mute',
]);
/** `request.voice.arm` is the only request kind the voice principal may append. */
export const VOICE_REQUEST_KINDS: readonly string[] = Object.freeze(['request.voice.arm']);

export type AppendClass = 'human' | 'agent' | 'mod' | 'voice';

/** The appendable kinds are decided here; in M1.4 every branch refuses. */
export function refuseAppend(cls: AppendClass, principal: string | undefined, params: unknown): never {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'log.append params must be an object {kind, payload?, …}');
  const kind = (params as Record<string, unknown>).kind;
  if (typeof kind !== 'string' || kind.length > 128 || !(EVENT_KIND_PATTERN.test(kind) || MODNS_KIND_PATTERN.test(kind))) {
    throw new RpcRefusal('BAD_REQUEST', 'bad-kind', 'kind must be a dotted event kind (≤ 128 chars)');
  }
  const data = { verb: 'log.append', kind, principalClass: cls };
  const kernelOwned = (): never => {
    throw new RpcRefusal('FORBIDDEN', 'kernel-owned', `${kind} is kernel-owned: no principal appends it (§5 namespace ownership)`, data);
  };

  if (kind.startsWith('request.')) {
    if (cls === 'human' && HUMAN_REQUEST_KINDS.includes(kind)) {
      // §5: only on a first-party human-class connection — none can prove it yet (#web-endpoint); then the broker answers (M1.6)
      throw new RpcRefusal('FORBIDDEN', 'kernel-owned', `${kind} is appendable only by the human on a first-party human-class connection; this connection is not one`, {
        ...data,
        needs: 'first-party human-class connection',
      });
    }
    if (cls === 'voice' && VOICE_REQUEST_KINDS.includes(kind)) {
      // voice slice V1 is talk-only: arms (and so request.voice.arm) land in voice slice V7 (T-2026-10-19-026)
      throw new RpcRefusal('ENGINE', 'not-implemented', `${kind} needs voice arms; Gnomon voice is talk-only until voice slice V7`, { ...data, milestone: 'voice V7' });
    }
    return kernelOwned();
  }
  if (kindOwner(kind) !== 'userland') return kernelOwned();

  const isModns = MODNS_KIND_PATTERN.test(kind);
  switch (cls) {
    case 'mod': {
      const name = modNameOf(principal);
      if (name && isModns && kind.startsWith(`modns.${name}.`)) {
        throw new RpcRefusal('ENGINE', 'not-implemented', 'a mod appends its own modns kinds with its manifest labels through the mod host; it lands with M1.11', { ...data, milestone: 'M1.11' });
      }
      throw new RpcRefusal('FORBIDDEN', 'modns-not-own', 'a mod appends only its own modns.<name>.* kinds (§5)', data);
    }
    case 'voice':
      // served by #gnomon-voice (dispatch.ts `voice` port) BEFORE this gate; without the port it stays refused
      if (kind.startsWith('voice.')) throw new RpcRefusal('ENGINE', 'not-implemented', 'voice kinds need the kernel voice port (voice slice V1)', { ...data, milestone: 'voice V1' });
      throw new RpcRefusal('FORBIDDEN', 'ungranted', 'the voice principal appends only voice.* and request.voice.arm (§5)', data);
    default:
      throw new RpcRefusal('FORBIDDEN', 'ungranted', `${kind} needs a grant.bind listing it; signed grants (M1.3) over a loaded manifest (M1.5)`, { ...data, needs: 'grant.bind', milestone: 'M1.5' });
  }
}
