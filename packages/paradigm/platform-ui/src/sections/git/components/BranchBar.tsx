import React from 'react';
import { useGitStore } from '../store/gitStore';

export function BranchBar() {
  const branch = useGitStore(s => s.branch);
  const ahead = useGitStore(s => s.ahead);
  const behind = useGitStore(s => s.behind);
  const refresh = useGitStore(s => s.refresh);
  const loading = useGitStore(s => s.loading);

  return (
    <div className="git-branch-bar">
      <div className="git-branch-bar__left">
        <span className="git-branch-bar__icon">{'\u2387'}</span>
        <span className="git-branch-bar__name">{branch || '...'}</span>
        {ahead > 0 && (
          <span className="git-branch-bar__badge git-branch-bar__badge--ahead" title={`${ahead} ahead`}>
            {'\u2191'}{ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="git-branch-bar__badge git-branch-bar__badge--behind" title={`${behind} behind`}>
            {'\u2193'}{behind}
          </span>
        )}
      </div>
      <button className="git-branch-bar__refresh" onClick={refresh} disabled={loading} title="Refresh">
        {loading ? '\u23F3' : '\u21BB'}
      </button>
    </div>
  );
}
