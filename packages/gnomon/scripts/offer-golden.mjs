// The offer golden of a Desk mod fixture (#neurons-mod, #constellation-mod): what a model reply with one ```offer
// block resolves to against the mod's own manifest. `offer` is offerBlockOf's parse (null: no offer at all, the reply
// renders as is); `shown` is what offer.shown would carry from the manifest's offer-spec:v1 (title, phase, contextIn
// and handoffTool copied from the manifest, the question the only model text), or null when the block names an
// offer this mod does not declare. Shared by scripts/repin-first-party.mjs (writes the goldens) and the mod tests
// (re-derive and compare), so a golden never drifts from the one parser.
import { offerBlockOf } from '@a-company/gnomon-contracts';

export function offerGolden(manifest, reply) {
  const r = offerBlockOf(reply);
  if (!r) return { offer: null, shown: null };
  // S0b: the block names the mod id <publisher>.<name>
  const id = `${manifest.publisher}.${manifest.name}`;
  const spec = r.offer.mod === id ? (manifest.provides?.offers ?? []).find((o) => o.kind === r.offer.kind) : undefined;
  return {
    offer: r.offer,
    body: r.body,
    shown: spec ? { mod: id, kind: spec.kind, phase: spec.phase, title: spec.title, contextIn: spec.contextIn, question: r.offer.question, handoffTool: spec.handoffTool } : null,
  };
}
