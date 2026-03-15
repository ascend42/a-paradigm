import React from 'react';
import { useGitStore } from '../store/gitStore';

const SYMBOL_COLORS: Record<string, string> = {
  '#': 'var(--p-symbol-component)',
  '$': 'var(--p-symbol-flow)',
  '^': 'var(--p-symbol-gate)',
  '!': 'var(--p-symbol-signal)',
  '~': 'var(--p-symbol-aspect)',
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

export function CommitLog() {
  const commits = useGitStore(s => s.commits);
  const commitOffset = useGitStore(s => s.commitOffset);
  const commitTotal = useGitStore(s => s.commitTotal);
  const loadMore = useGitStore(s => s.loadMoreCommits);

  return (
    <div className="git-commit-log">
      {commits.length === 0 && (
        <div className="git-commit-log__empty">No commits found</div>
      )}
      {commits.map(c => (
        <div key={c.hash} className="git-commit-log__item">
          <div className="git-commit-log__header">
            <span className="git-commit-log__hash">{c.shortHash}</span>
            <span className="git-commit-log__message">{c.message.split('\n')[0]}</span>
          </div>
          <div className="git-commit-log__meta">
            <span className="git-commit-log__author">{c.author}</span>
            <span className="git-commit-log__date">{formatDate(c.date)}</span>
            {c.symbols.length > 0 && (
              <span className="git-commit-log__symbols">
                {c.symbols.map(s => (
                  <span
                    key={s}
                    className="git-commit-log__symbol-badge"
                    style={{ color: SYMBOL_COLORS[s[0]] || 'var(--p-text-muted)' }}
                  >
                    {s}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      ))}
      {commitOffset < commitTotal && (
        <button className="git-commit-log__load-more" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
