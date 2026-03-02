import React from 'react';
import { useLoreStore } from '../store/loreStore';
import { LoreCard } from '../components/LoreCard';
import { DateSeparator } from '../components/DateSeparator';

export function ThreadView() {
  const entries = useLoreStore(s => s.entries);
  const authors = useLoreStore(s => s.authors);
  const leftAuthors = useLoreStore(s => s.leftAuthors);
  const toggleLeftAuthor = useLoreStore(s => s.toggleLeftAuthor);

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

  const hasLeftAuthors = leftAuthors.length > 0;

  // Group entries by date
  const grouped: Map<string, typeof entries> = new Map();
  for (const entry of entries) {
    const date = entry.timestamp.slice(0, 10);
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(entry);
  }

  const isLeft = (authorId: string) => leftAuthors.includes(authorId);

  return (
    <div className={`thread-view ${hasLeftAuthors ? '' : 'single-column'}`}>
      {hasLeftAuthors && <div className="timeline-spine" />}
      <div className="timeline-column-labels">
        {hasLeftAuthors ? (
          <>
            <div className="column-label-group left">
              {leftAuthors.map(a => (
                <button
                  key={a}
                  className="column-author-pill active"
                  onClick={() => toggleLeftAuthor(a)}
                  title="Remove from left column"
                >
                  {a} &times;
                </button>
              ))}
            </div>
            <div className="column-label-group right">
              <span className="column-label-text">EVERYONE ELSE</span>
            </div>
          </>
        ) : (
          <div className="column-author-selector">
            <span className="column-label-text">Pick an author for the left column:</span>
            {authors.map(a => (
              <button
                key={a.id}
                className="column-author-pill"
                onClick={() => toggleLeftAuthor(a.id)}
              >
                {a.id}
              </button>
            ))}
          </div>
        )}
      </div>
      {Array.from(grouped.entries()).map(([date, dayEntries]) => {
        const leftCount = dayEntries.filter(e => isLeft(e.author)).length;
        const rightCount = dayEntries.filter(e => !isLeft(e.author)).length;

        return (
          <React.Fragment key={date}>
            <DateSeparator
              date={date}
              humanCount={leftCount}
              agentCount={rightCount}
            />
            {dayEntries.map(entry => (
              <LoreCard
                key={entry.id}
                entry={entry}
                side={hasLeftAuthors ? (isLeft(entry.author) ? 'left' : 'right') : 'right'}
              />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
