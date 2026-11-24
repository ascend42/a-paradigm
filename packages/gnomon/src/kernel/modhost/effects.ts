/**
 * @symbol #mod-host
 *
 * Declared-effect enforcement at the RPC boundary (spec §3.8, §12.3; G-MOD-02).
 *
 * Effects: `read` (kernel reads, state.get, view inputs) · `write`
 * (state.set, `log.append` of `modns.<name>.*`) · `network` (only with an
 * egress grant, through the kernel's loopback proxy) · `spend` (drawn from the
 * calling session's permit). The DECLARED set of a mod is the union of its
 * tools' `effects` (manifest:v1 declares effects per tool; views and commands
 * carry none). The set in force for a mod → host call is the set of the
 * host → mod call it is BOUND to by its echoed `callId` (M1.11 slice 2): a
 * request naming the call in force gets that call's set; one carrying no
 * `callId` is idle (read, which only narrows); one naming any other call —
 * ended, foreign or guessed — is refused (host.ts, FORBIDDEN `CALL`):
 *   - `tool.call{name}` → that tool's effects;
 *   - `command.run`     → the mod's declared set for a human on the GUI and a
 *                         `gnomon`-published mod; `read` only for every other
 *                         command context (commandCap, S1.3, G-MOD-17);
 *   - `view.render`     → `read` only (views are pure, §12.2);
 *   - idle / `event`    → `read` only.
 * A dev-mode mod is capped at `read` whatever it declares (§12.5).
 * `approve` is never proxied; a verb whose §5 mod cell is ✗ is refused.
 */
import { VERBS } from '@a-company/gnomon-contracts';
import type { ManifestV2, ToolEffect } from '../manifest/manifest.js';
import { ModRefusal } from './refusal.js';

/**
 * What the HOST knows about the call a mod request is bound to (S1.2 C1, G-MOD-12): the `relayedFor` it sent the
 * mod (built by `pickRelayedFor`, so the row holds exactly what the mod was told) and, for an entitled tool call,
 * the turn that caused it. The bridge writes these onto every row the mod appends inside the call. Never mod input.
 */
export interface CallStamp {
  relayedFor: Record<string, string>;
  causes?: string[];
  /**
   * S1.3 (Aegis A4): the repo scope (`repo:<16 hex>`) of the session a first-party command was focused on, joined
   * by the host (host.ts #composeRelayedArgs). The bridge writes it on the ENVELOPE `scope` of every row appended
   * inside the call, so "listed by repo" is a read filter. Never mod input: `scope` is not in MOD_APPEND_FIELDS.
   */
  scope?: { repo: string };
}

export type CallContext = { kind: 'tool'; tool: string; hsid?: string; stamp?: CallStamp } | { kind: 'command'; stamp?: CallStamp } | { kind: 'view' } | { kind: 'idle' };

export function declaredEffects(m: ManifestV2): Set<ToolEffect> {
  const out = new Set<ToolEffect>();
  for (const t of m.provides?.tools ?? []) for (const e of t.effects) out.add(e);
  return out;
}

/**
 * The command READ CAP (S1.3, Aegis A2 and B1; G-MOD-17), generic to every mod. A command runs with its mod's
 * declared set only when BOTH hold:
 *   - the stamp the host built for the call (the `pickRelayedFor` output, never the request) has an own
 *     `surface: 'gui'`: the caller is a human on the GUI credential (socket/dispatch.ts relaySurfaceOf);
 *   - the mod's publisher is `gnomon` (the loader keeps publisher gnomon ⇔ the first-party tier).
 * Everything else is capped at `read`, and it fails CLOSED because the full set is the exception here, not the
 * default: a command context with no stamp (a direct `runCommand` with no `relayedFor`), a stamp without a surface
 * (an agent, session, voice or mod caller), `surface: 'cli'` (a human on a device key) and a third-party mod on any
 * surface can never `state.set` or `log.append` through a command.
 */
export function commandCap(m: ManifestV2, ctx: Extract<CallContext, { kind: 'command' }>): 'read' | null {
  const rf = ctx.stamp?.relayedFor;
  const gui = rf !== undefined && rf !== null && Object.hasOwn(rf, 'surface') && rf.surface === 'gui';
  return gui && m.publisher === 'gnomon' ? null : 'read';
}

/** The effects in force for a call context (∩ the command read cap ∩ the dev cap). */
export function effectsFor(m: ManifestV2, ctx: CallContext, dev: boolean): Set<ToolEffect> {
  let set: Set<ToolEffect>;
  if (ctx.kind === 'tool') set = new Set(m.provides?.tools?.find((t) => t.name === ctx.tool)?.effects ?? []);
  else if (ctx.kind === 'command') set = declaredEffects(m);
  else set = new Set<ToolEffect>(['read']);
  if (dev || (ctx.kind === 'command' && commandCap(m, ctx) === 'read')) set = new Set([...set].filter((e) => e === 'read'));
  return set;
}

/**
 * The effect a kernel verb draws for a mod — an EXPLICIT table (Aegis C3):
 * a verb not listed is refused, whatever the §5 descriptor says, so a new
 * verb never reaches mods by default.
 */
export const MOD_VERB_EFFECTS: Readonly<Record<string, ToolEffect>> = Object.freeze({
  status: 'read',
  'log.read': 'read',
  'ref.resolve': 'read',
  'log.append': 'write',
  'session.send': 'spend', // drawn from the caller's permit
});

export function verbEffect(verb: string): ToolEffect {
  if (verb === 'approve') throw new ModRefusal('APPROVE', '`approve` is never proxied for a mod (§12.3)', { verb });
  const e = Object.hasOwn(MOD_VERB_EFFECTS, verb) ? MOD_VERB_EFFECTS[verb] : undefined;
  const d = VERBS.find((v) => v.verb === verb);
  if (!e || !d || d.access.mod === false) throw new ModRefusal('VERB', `a mod cannot call ${verb} (§5 mod column)`, { verb });
  return e;
}

/** The effect a mod → host method draws. */
export function methodEffect(method: string, params: Record<string, unknown>): ToolEffect {
  if (method === 'state.get') return 'read';
  if (method === 'state.set') return 'write';
  if (method === 'kernel.call') return verbEffect(String(params.verb));
  throw new ModRefusal('VERB', `unknown mod → host method ${method}`, { method });
}
