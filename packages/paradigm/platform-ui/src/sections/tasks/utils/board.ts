import type {
  Task,
  TaskPriority,
  TaskStatus,
  BoardNode,
  BoardUnclaimed,
  TaskFilter,
} from '../store/tasksStore';
import { tokenBandToPoints } from './storyPoints';

// ── AGENT_COLORS ─────────────────────────────────────
// Reused VERBATIM from TeamSection so a claimant's lane color matches their
// Team color across the platform. Deterministic by archetype role; falls back
// to a hashed hue for unknown refs.
//
// NOTE: TeamSection keys AGENT_COLORS by the agent's *role* word
// (architect/builder/…) and also calls agentColor(agent.id) — so id and role
// both flow through the same lookup. Claimant refs on the task board, however,
// are archetype IDS (cid/forge/compliance + human emails), which are NOT role
// words and would otherwise fall through to a hashed hue. CLAIMANT_ALIAS below
// resolves a claimant ref to the role word Team colors by, so a claimant's lane
// color === their Team color.
export const AGENT_COLORS: Record<string, string> = {
  architect: 'var(--p-accent-purple)',
  builder: 'var(--p-accent-blue)',
  tester: 'var(--p-accent-green)',
  reviewer: 'var(--p-accent-orange)',
  security: 'var(--p-accent-red)',
};

// Claimant ref → the AGENT_COLORS key (role/archetype word) Team colors by.
// cid = Cid (captain/navigation), forge = Loid (intelligence/forge),
// compliance = Rune (compliance). Role words map to themselves so existing
// role-keyed refs keep working.
const CLAIMANT_ALIAS: Record<string, string> = {
  cid: 'architect',
  forge: 'builder',
  compliance: 'security',
};

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// Widened hashed fallback: jitter S and L (not just H) so unknown refs stay
// mutually distinct, and bias the hue away from the reserved accent band
// (~210–360 covers the blue/purple/red/orange accents) so a hashed lane never
// reads as a named-agent color.
function hashedColor(ref: string): string {
  const h = Math.abs(hashCode(ref));
  const hue = h % 360;
  const sat = 45 + (h % 25); // 45–70%
  const light = 42 + (Math.floor(h / 360) % 18); // 42–60%
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

export function claimantColor(ref: string): string {
  const key = CLAIMANT_ALIAS[ref.toLowerCase()] ?? ref;
  return AGENT_COLORS[key] || hashedColor(ref);
}

// Resolve a claimant ref to the calibration-grid archetype key. The grid is
// keyed by role words (builder/architect/…); claimant refs are archetype IDs
// (cid/forge/compliance). Lets a card map back to its calibration cell.
export function claimantArchetype(ref: string): string {
  return CLAIMANT_ALIAS[ref.toLowerCase()] ?? ref.toLowerCase();
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

// ── Symbol derivation ────────────────────────────────
// The board route ships fragileSymbols:[] in this project (no ProjectContext),
// so we derive a card's symbols from its tags + #symbols parsed from the blurb.
// Used for Symbol/Flow lane grouping.
const SYMBOL_RE = /[#$^!~][a-z0-9][a-z0-9-]*/gi;

export function deriveSymbols(task: Pick<Task, 'blurb' | 'tags'>): string[] {
  const out = new Set<string>();
  for (const t of task.tags || []) {
    if (/^[#$^!~]/.test(t)) out.add(t);
  }
  const matches = task.blurb?.match(SYMBOL_RE);
  if (matches) for (const m of matches) out.add(m);
  return [...out];
}

export function firstSymbol(task: Pick<Task, 'blurb' | 'tags'>): string | null {
  const syms = deriveSymbols(task);
  return syms.length > 0 ? syms[0] : null;
}

// ── Normalizers — BoardNode / BoardUnclaimed → Task ──
// Lets us render TaskCard (Round B) verbatim on the board.

export function nodeToTask(node: BoardNode): Task {
  return {
    id: node.taskId,
    blurb: node.blurb,
    priority: node.priority || 'medium',
    status: node.status,
    tags: node.tags || [],
    created: '',
    claimant: node.claimant,
    dependsOn: node.dependsOn,
    estimate: node.estimate,
    taskType: node.taskType,
  };
}

export function unclaimedToTask(u: BoardUnclaimed): Task {
  return {
    id: u.taskId,
    blurb: u.blurb,
    priority: u.priority,
    status: 'open',
    tags: u.tags || [],
    created: '',
    claimant: u.proposedClaimant,
    estimate: u.estimate,
    taskType: u.taskType,
  };
}

// ── Sorting + filtering ──────────────────────────────
// Cards sort priority-desc, in-progress first.
export function sortCards(a: Task, b: Task): number {
  const aInProg = a.status === 'in-progress' ? 0 : 1;
  const bInProg = b.status === 'in-progress' ? 0 : 1;
  if (aInProg !== bInProg) return aInProg - bInProg;
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter.status && task.status !== filter.status) return false;
  if (filter.priority && task.priority !== filter.priority) return false;
  if (filter.search) {
    const q = filter.search.toLowerCase();
    const hay = `${task.blurb} ${task.tags.join(' ')} ${task.claimant?.ref ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// Summed story points across a set of cards (lane header total).
export function sumPoints(cards: Task[]): number {
  return cards.reduce((acc, t) => acc + tokenBandToPoints(t.estimate), 0);
}

export type { TaskStatus };
