/**
 * @symbol #gnomon-guide
 *
 * The `gnomon guide` topics (spec §5 "gnomon guide" paragraph, §9.7;
 * TD-2026-10-19-648 item 10; T-2026-10-19-015). COMPILED IN: every topic is a
 * string built in this module from literals and from the frozen descriptors
 * of @a-company/gnomon-contracts (bundled by tsup), so the text ships inside
 * the built binary. There is no topic file on disk, in the home or in a repo,
 * and this module reads nothing at runtime (no node:fs, no env, no cwd): a
 * repo-supplied guide would be an injection vector (threat 11).
 *
 * PULL-ONLY: the text reaches a reader only through `gnomon guide <topic>`;
 * nothing here is injected into a session, a prompt, an envelope or a card,
 * and nothing here is a tool description.
 *
 * MARKUP (what the honesty check reads, test/honesty.ts scanGuides): every
 * verb, verb param, refusal code, refusal reason, gate, card kind, decision
 * or event kind a topic names is written in backticks, in one of the forms
 *   `verb`  `verb{param, param:value}`  `CODE`  `CODE{reason}`  `term`
 * and every one must exist in the frozen descriptors. A CLI `--flag` has no
 * frozen descriptor, so a topic never names one. Reserved-but-unbuilt names
 * (claim generations, their lost-CAS reasons) are not named until they land.
 * Durations are written as bounds (G-HON-07).
 */
import {
  CARD_DECISIONS,
  CARD_KINDS,
  CARD_STATES,
  REFUSAL_CODES,
  REFUSAL_V1_KEYS,
  RETRIABILITIES,
  VERBS,
  exitCodeFor,
  gateFor,
  refuse,
  retriabilityFor,
  type Retriability,
} from '@a-company/gnomon-contracts';
import { VERB_MILESTONES } from '../kernel/socket/dispatch.js';

export interface GuideTopic {
  /** The topic id: `gnomon guide <id>`. */
  id: string;
  /** One line for the topic listing. */
  summary: string;
  /** The text, wrapped for a terminal. */
  body: string;
}

const tick = (s: string): string => `\`${s}\``;
/** Ticked items joined with ", ", wrapped at 76 columns; continuation lines get `indent`. */
function list(xs: readonly string[], indent = ''): string {
  const lines: string[] = [];
  let cur = '';
  xs.forEach((x, i) => {
    const item = `${tick(x)}${i < xs.length - 1 ? ',' : ''}`;
    if (cur && cur.length + 1 + item.length > 76 - indent.length) {
      lines.push(cur);
      cur = item;
    } else cur = cur ? `${cur} ${item}` : item;
  });
  if (cur) lines.push(cur);
  return lines.join(`\n${indent}`);
}

/** The refusal codes a verb's frozen descriptor declares. */
function refusalsOf(verb: string, indent = '   '): string {
  const d = VERBS.find((v) => v.verb === verb);
  if (!d) throw new Error(`guide: no descriptor for ${verb}`); // a build-time error: the module would not load
  return list(d.refusals, indent);
}

/** The milestone a verb lands with, from the kernel's own table. */
function landsWith(verb: string): string {
  return VERB_MILESTONES[verb] ?? 'an unscheduled milestone';
}

const RETRIABLE_MEANING: Readonly<Record<Retriability, string>> = {
  'retry-identical': 'the same call may succeed later (an engine fault)',
  'retry-corrected': 'fix the call (params, permit, fresh state) and send it again',
  'retry-after-rebase': 'rebase onto the current base, then retry',
  'retry-after-resolve': 'a human resolves the conflict first, then retry',
  'retry-with-override': 'a human decides a card (an override); then retry',
  never: 'do not retry this call; change what you are doing',
};

function codeTable(): string {
  const rows = REFUSAL_CODES.map((code) => {
    const next = refuse({ code }).next.map((s) => `${tick(s.verb)} (${s.principal})`);
    return `  ${tick(code).padEnd(20)} gate ${tick(gateFor(code)).padEnd(12)} exit ${String(exitCodeFor(code)).padEnd(2)} ${tick(retriabilityFor(code))}${next.length ? `; next ${next.join(', ')}` : ''}`;
  });
  return rows.join('\n');
}

const SPAWN = `A session is a Claude Code (or local-model) child the kernel supervises.
Nothing starts without a permit, so spawning is two verbs, in order.

1. Reserve the spend.
   ${tick("permit.reserve{kind:'session.spawn', scope, backend, model}")}
   A refusal here means nothing else happens (law 1). Codes this verb
   declares: ${refusalsOf('permit.reserve')}.
   ${tick('BUDGET_DENIED')} points at a ${tick('budget')} card a human decides; ${tick('BILLING_REFUSED')}
   is never retriable.

2. Open the session with the permit.
   ${tick('session.open{model, cwd, attended, permitId}')}
   Optional params: ${tick('backend')}, ${tick('mode')}, ${tick('runMode')}, ${tick('as')}, ${tick('goal')}, ${tick('contract')},
   ${tick('alias')}, ${tick('systemPrompt')}, ${tick('brief')}. The result names the session by
   its ${tick('hsid')}. Codes this verb declares:
   ${refusalsOf('session.open')}.

3. What the kernel does, not you: it routes by ${tick('model')} (a local model or Claude
   under law 7), mints a session principal, runs preflight, writes the
   session's policy, and spawns the child inside the session sandbox profile.
   Each step lands in the log (${tick('session.routed')}, ${tick('session.spawned')}).

4. Talk to it, then stop it.
   ${tick('session.send{hsid, content, permitId}')}  each turn needs its own permit
   ${tick('session.stop{hsid, interrupt}')}           exit or stop expires every
                                            pending card into deny

Every tool the child asks to use becomes a ${tick('permission')} card a human decides
(see ${tick('gnomon guide cards')}). An agent or a session may only send to or stop its
own subtree.

This build serves the session verbs to human-class connections; the agent
and session rows of the matrix land with ${landsWith('session.open')}. Until then an agent's call
is refused: read the refusal's ${tick('code')} and ${tick('next')} (${tick('gnomon guide refusals')}).
Ask ${tick('status')} first: it names your principal and the verbs legal for you now.
`;

const CLAIMS = `A contract (from the spec compiler) is a set of nodes. A node is built by
whoever holds its claim; the claim is a compare-and-set, so two agents can
never both own a node.

1. Register (once per contract).
   ${tick('contract.register{contract}')}   codes: ${refusalsOf('contract.register')}

2. Claim a node, stating what you expect to find.
   ${tick("contract.claim{contractId, nodeId, op:'claim', ttl, expect}")}
   with expect naming the node's open status and the log seq you read it at.
   Success writes ${tick('contract.claimed')}. The claim lives at most its ${tick('ttl')}
   (at most 2 hours when unset); at expiry the kernel releases it with
   ${tick('contract.released')} unless the node was built first.

3. Report it built (the claimant only).
   ${tick("contract.claim{contractId, nodeId, op:'built', note, responses}")}
   writes ${tick('contract.built')}, which triggers the node's oracles
   (${tick('oracle.run{contractId, nodeId, oracle}')}). From Move 2 a change at medium
   risk or above, or in a repo at L1 or above, needs the change note, else ${tick('BAD_REQUEST{note-missing}')}.

4. Or let it go.
   ${tick("contract.claim{contractId, nodeId, op:'release'}")}  writes ${tick('contract.released')}

Losing the race: ${tick('CAS_LOST')} (gate ${tick(gateFor('CAS_LOST'))}, ${tick(retriabilityFor('CAS_LOST'))}, exit ${exitCodeFor('CAS_LOST')}).
Someone else's write landed between your read and your claim. Do not resend
the same call: re-read with ${tick('status')} or ${tick('log.read')}, then claim again with a
fresh expect, or pick another node. Codes ${tick('contract.claim')} declares:
${refusalsOf('contract.claim', '')}.

The contract rows (${tick('contract.claimed')}, ${tick('contract.built')}, ${tick('contract.released')}) are
kernel-written by the verb handlers; nobody appends them.
Milestones: ${tick('contract.register')} lands with ${landsWith('contract.register')}, ${tick('contract.claim')} with ${landsWith('contract.claim')},
${tick('oracle.run')} with ${landsWith('oracle.run')}; until then this kernel refuses them.
`;

const CARDS = `A card is a decision the kernel asks a human for. It is the gate: a permit
never means allow, and no agent, session or mod can decide a card.

What raises one: a tool use inside a session (${tick('permission')}), a budget
ceiling (${tick('budget')}), an oracle disagreement (${tick('knot')}), a plan (${tick('plan')}), a
question (${tick('ask-user')}), and the rest of the closed kinds:
  ${list(CARD_KINDS, '  ')}.

States: ${list(CARD_STATES)}.
A card in a state you do not know is not decidable.

Deciding: ${tick('approve{cardId, decision, note}')} is the only human-only verb
(codes: ${refusalsOf('approve', '')}). Decisions:
  ${list(CARD_DECISIONS, '  ')};
each kind offers only some of them.

A ${tick('permission')} card offers ${tick('allow')}, ${tick('deny')} and ${tick('always')}. ${tick('always')} learns a
standing rule (${tick('approval.rule.learned')}); later exact matches are answered with
no card (${tick('approval.auto')}). It needs fresh presence every time, so under a
cached unlock it is refused ${tick('FORBIDDEN{presence}')} and the presence prompt is
raised instead.

Deny-safe settlement: anything other than a decoded allow is deny. A cancel
from the session settles the card into deny, once. An ${tick('approve')} on a card
that is no longer pending is refused before any prompt, and a card the
broker never held is ${tick('NOT_FOUND')}.

As an agent: you never call ${tick('approve')}. Your tool call waits on the card; read
${tick('approval.request')} and ${tick('approval.decide')} rows with ${tick('log.read')} if you need to
know, and treat deny as an answer, not an error to route around.
`;

const REFUSALS = `Every refused call answers with one ${tick('refusal:v1')} object. Read it; do not
guess from the message text.

Fields:
  ${list(REFUSAL_V1_KEYS, '  ')}.
  ${tick('code')}       what went wrong (closed list below)
  ${tick('gate')}       which check refused it
  ${tick('retriable')}  what to do next:
${RETRIABILITIES.map((r) => `    ${tick(r).padEnd(23)} ${RETRIABLE_MEANING[r]}`).join('\n')}
  ${tick('next')}       the legal next steps: a verb, its required params, and
             whether an agent or a human takes it
  ${tick('data')}       extra detail; a named reason sits in it (an unknown reason
             is shown opaquely, never dropped)

The codes, their gate, the CLI exit code, and their default next step:
${codeTable()}

Habits that keep a run honest:
- ${tick('never')} means stop and change course; do not loop.
- A step whose principal is human is a card for the human, not for you.
- ${tick('PERMIT_REQUIRED')}: reserve with ${tick('permit.reserve')} first.
- ${tick('CAS_LOST')}: re-read state, then decide again (${tick('gnomon guide claims')}).
- ${tick('ENGINE{not-implemented}')}: the verb is in the frozen surface but this
  build does not serve it to your principal yet; ${tick('status')} lists what it does.
`;

/** The compiled-in topics, in listing order. */
export const GUIDE_TOPICS: readonly GuideTopic[] = Object.freeze([
  { id: 'spawn', summary: 'start, drive and stop a supervised session (permit first)', body: SPAWN },
  { id: 'claims', summary: 'claim, build and release a contract node; what CAS_LOST means', body: CLAIMS },
  { id: 'cards', summary: 'the decisions only a human makes, and how an agent waits on them', body: CARDS },
  { id: 'refusals', summary: 'read a refusal: code, gate, retriable, next', body: REFUSALS },
].map((t) => Object.freeze(t)));

export const GUIDE_TOPIC_IDS: readonly string[] = Object.freeze(GUIDE_TOPICS.map((t) => t.id));
