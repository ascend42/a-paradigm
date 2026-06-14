import React from 'react';
import type { Task } from '../store/tasksStore';
import { useTasksStore } from '../store/tasksStore';
import { CalibrationBlock } from './CalibrationBlock';
import { useTaskAgentEffect } from '../utils/useTaskAgentEffect';

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

export function TaskCard({ task, elevated }: { task: Task; elevated?: boolean }) {
  const isGithub = task.external_ref?.provider === 'github';
  const openDetail = useTasksStore((s) => s.openDetail);

  // LIVE AGENTS — register this card by its derived symbols. An
  // agent:highlight(symbol) pulses the matching card; agent:annotate(symbol)
  // badge stamps a badge. Mute clears agentStore, so this no-ops when muted.
  const fx = useTaskAgentEffect(task);

  const cls = [
    'task-card',
    elevated ? 'task-card--hero' : '',
    fx.highlighted ? 'task-card--agent' : '',
    fx.highlighted && fx.pulse ? 'task-card--agent-pulse' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const style = fx.highlighted && fx.color
    ? ({ ['--agent-color' as string]: fx.color })
    : undefined;

  return (
    <div
      className={cls}
      style={style}
      role="button"
      tabIndex={0}
      onClick={() => openDetail(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(task.id);
        }
      }}
    >
      {fx.badges.length > 0 && (
        <div className="task-card__agent-badges">
          {fx.badges.map((b) => (
            <span
              key={b.id}
              className={`task-agent-badge task-agent-badge--${b.severity}`}
              title={b.message}
            >
              {b.message}
            </span>
          ))}
        </div>
      )}
      {fx.highlighted && fx.label && (
        <div className="task-card__agent-label">{fx.label}</div>
      )}

      <div className="task-card__header">
        <span className={`task-chip task-chip--prio task-chip--prio-${task.priority}`}>
          {task.priority}
        </span>
        <span className={`task-chip task-chip--status task-chip--status-${task.status}`}>
          {task.status}
        </span>
      </div>

      <div className="task-card__title">{task.blurb}</div>

      <CalibrationBlock
        estimate={task.estimate}
        claimant={task.claimant}
        taskType={task.taskType}
      />

      <div className="task-card__footer">
        {task.claimant && (
          <span
            className="task-claimant"
            style={{ color: claimantColor(task.claimant.ref) }}
          >
            {claimantGlyph(task.claimant.kind)} {task.claimant.ref}
          </span>
        )}

        {/* Cid's suggested owner for an unclaimed task — a hint, in the
            suggested claimant's color, distinct from an actual claim. */}
        {!task.claimant && task.proposedClaimant && (
          <span
            className="task-proposed-claimant"
            style={{ color: claimantColor(task.proposedClaimant.ref) }}
            title={`suggested owner — ${task.proposedClaimant.kind} · ${task.proposedClaimant.ref}`}
          >
            → {task.proposedClaimant.ref}
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
