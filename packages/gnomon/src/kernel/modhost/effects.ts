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
 *   - `command.run`     → the mod's declared set (a user command, §12.3);
 *   - `view.render`     → `read` only (views are pure, §12.2);
 *   - idle / `event`    → `read` only.
 * A dev-mode mod is capped at `read` whatever it declares (§12.5).
 * `approve` is never proxied; a verb whose §5 mod cell is ✗ is refused.
 */
import { VERBS } from '@a-company/gnomon-contracts';
import type { ManifestV2, ToolEffect } from '../manifest/manifest.js';
import { ModRefusal } from './refusal.js';

export type CallContext = { kind: 'tool'; tool: string; hsid?: string } | { kind: 'command' } | { kind: 'view' } | { kind: 'idle' };

export function declaredEffects(m: ManifestV2): Set<ToolEffect> {
  const out = new Set<ToolEffect>();
  for (const t of m.provides?.tools ?? []) for (const e of t.effects) out.add(e);
  return out;
}

/** The effects in force for a call context (∩ the dev cap). */
export function effectsFor(m: ManifestV2, ctx: CallContext, dev: boolean): Set<ToolEffect> {
  let set: Set<ToolEffect>;
  if (ctx.kind === 'tool') set = new Set(m.provides?.tools?.find((t) => t.name === ctx.tool)?.effects ?? []);
  else if (ctx.kind === 'command') set = declaredEffects(m);
  else set = new Set<ToolEffect>(['read']);
  if (dev) set = new Set([...set].filter((e) => e === 'read'));
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
