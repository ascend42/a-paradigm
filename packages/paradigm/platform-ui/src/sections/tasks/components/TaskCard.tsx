import React from 'react';
import type { Task } from '../store/tasksStore';
import { CalibrationBlock } from './CalibrationBlock';

// AGENT_COLORS — reused verbatim from TeamSection so claimant coloring matches
// the rest of the platform. Deterministic by archetype role; falls back to a
// hashed hue for unknown refs.
const AGENT_COLORS: Record<string, string> = {
  architect: 'var(--p-accent-purple)',
  builder: 'var(--p-accent-blue)',
  tester: 'var(--p-accent-green)',
  reviewer: 'var(--p-accent-orange)',
  security: 'var(--p-accent-red)',
};

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function claimantColor(ref: string): string {
  return AGENT_COLORS[ref] || `hsl(${Math.abs(hashCode(ref)) % 360}, 60%, 50%)`;
}

function claimantGlyph(kind: string): string {
  if (kind === 'human') return '👤'; // 👤
  if (kind === 'peer') return '⚡'; // ⚡
  return '🤖'; // 🤖 (archetype / agent)
}

export function TaskCard({ task }: { task: Task }) {
  const isGithub = task.external_ref?.provider === 'github';

  return (
    <div className="task-card">
      <div className="task-card__header">
        <span className={`task-chip task-chip--prio task-chip--prio-${task.priority}`}>
          {task.priority}
        </span>
        <span className={`task-chip task-chip--status task-chip--status-${task.status}`}>
          {task.status}
        </span>
      </div>

      <div className="task-card__title">{task.blurb}</div>

      <CalibrationBlock estimate={task.estimate} />

      <div className="task-card__footer">
        {task.claimant && (
          <span
            className="task-claimant"
            style={{ color: claimantColor(task.claimant.ref) }}
          >
            {claimantGlyph(task.claimant.kind)} {task.claimant.ref}
          </span>
        )}

        {isGithub && task.external_ref && (
          <span className="task-github">
            {'⬢'} {task.external_ref.ref}
          </span>
        )}
      </div>

      {task.tags.length > 0 && (
        <div className="task-card__tags">
          {task.tags.map((t) => (
            <span
              key={t}
              className={`task-tag ${t === 'fragile' ? 'task-tag--fragile' : ''}`}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
