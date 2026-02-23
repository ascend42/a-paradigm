import React from 'react';
import { useLoreStore } from '../store/loreStore';
import { LoreCard } from '../components/LoreCard';
import { DateSeparator } from '../components/DateSeparator';

export function ThreadView() {
  const entries = useLoreStore(s => s.entries);

  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <h2>No lore entries yet</h2>
        <p>
          Record your first entry with <code>paradigm lore record</code> or via the MCP tool <code>paradigm_lore_record</code>.
        </p>
      </div>
    );
  }

  // Group entries by date
  const grouped: Map<string, typeof entries> = new Map();
  for (const entry of entries) {
    const date = entry.timestamp.slice(0, 10);
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(entry);
  }

  return (
    <div className="thread-view">
      <div className="timeline-spine" />
      <div className="timeline-column-labels">
        <span className="column-label human">HUMAN</span>
        <span className="column-label agent">AGENT</span>
      </div>
      {Array.from(grouped.entries()).map(([date, dayEntries]) => {
        const humanCount = dayEntries.filter(e => e.author.type === 'human').length;
        const agentCount = dayEntries.filter(e => e.author.type === 'agent').length;

        return (
          <React.Fragment key={date}>
            <DateSeparator date={date} humanCount={humanCount} agentCount={agentCount} />
            {dayEntries.map(entry => (
              <LoreCard key={entry.id} entry={entry} />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
