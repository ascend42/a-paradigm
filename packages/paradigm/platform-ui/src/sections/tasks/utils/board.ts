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
export const AGENT_COLORS: Record<string, string> = {
  architect: 'var(--p-accent-purple)',
  builder: 'var(--p-accent-blue)',
  tester: 'var(--p-accent-green)',
  reviewer: 'var(--p-accent-orange)',
  security: 'var(--p-accent-red)',
};

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function claimantColor(ref: string): string {
  return AGENT_COLORS[ref] || `hsl(${Math.abs(hashCode(ref)) % 360}, 60%, 50%)`;
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
