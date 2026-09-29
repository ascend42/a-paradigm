import React from 'react';
import type { PackSkill } from '../store/academyStore';

/**
 * Skills shipped by the pack. Read-only: pack skills are external and never
 * active until someone runs `paradigm skill import <pack>:<id>`.
 */
export function PackSkills({ packId, skills }: { packId: string; skills: PackSkill[] }) {
  if (skills.length === 0) return null;
  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--p-border)', textAlign: 'left', verticalAlign: 'top' };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--p-text-secondary)' }}>
        Skills in this pack <span style={{ color: 'var(--p-text-muted)', fontWeight: 400 }}>(external — not active)</span>
      </h3>
      <div style={{ fontSize: 12, color: 'var(--p-text-muted)' }}>
        These skills aren't used until you import one, e.g.{' '}
        <code>paradigm skill import {packId}:{skills[0].id}</code>
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, color: 'var(--p-text-primary)' }}>
        <thead>
          <tr style={{ color: 'var(--p-text-muted)' }}>
            <th style={cell}>Skill</th>
            <th style={cell}>Version</th>
            <th style={cell}>Status</th>
            <th style={cell}>Tools</th>
            <th style={cell}>Scripts</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.id}>
              <td style={cell}>
                <div style={{ fontWeight: 600 }}>{s.id}</div>
                <div style={{ color: 'var(--p-text-secondary)' }}>{s.description}</div>
              </td>
              <td style={cell}>{s.version}</td>
              <td style={cell}>
                external — not active
                {s.shadowedBy && <div style={{ color: 'var(--p-text-muted)' }}>your {s.shadowedBy} copy is used instead</div>}
              </td>
              <td style={cell}>{s.allowedTools || '—'}</td>
              <td style={cell}>{s.scriptCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
