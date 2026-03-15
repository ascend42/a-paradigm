import React, { useEffect } from 'react';
import { useGitStore, type GitTab } from './store/gitStore';
import { BranchBar } from './components/BranchBar';
import { FileList } from './components/FileList';
import { DiffViewer } from './components/DiffViewer';
import { CommitComposer } from './components/CommitComposer';
import { CommitLog } from './components/CommitLog';
import './styles/git.css';

const TABS: { id: GitTab; label: string }[] = [
  { id: 'files', label: 'Changes' },
  { id: 'log', label: 'History' },
];

export default function GitSection() {
  const activeTab = useGitStore(s => s.activeTab);
  const setActiveTab = useGitStore(s => s.setActiveTab);
  const refresh = useGitStore(s => s.refresh);
  const fetchSymbols = useGitStore(s => s.fetchSymbols);

  useEffect(() => {
    refresh();
    fetchSymbols();
  }, []);

  return (
    <div className="git-section">
      <BranchBar />
      <div className="git-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`git-tabs__btn ${activeTab === tab.id ? 'git-tabs__btn--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'files' && (
        <div className="git-files-layout">
          <div className="git-files-layout__sidebar">
            <FileList />
            <CommitComposer />
          </div>
          <div className="git-files-layout__main">
            <DiffViewer />
          </div>
        </div>
      )}
      {activeTab === 'log' && (
        <div className="git-log-layout">
          <CommitLog />
        </div>
      )}
    </div>
  );
}
