import React from 'react';
import { useGitStore } from '../store/gitStore';

interface FileGroupProps {
  title: string;
  files: string[];
  type: 'staged' | 'unstaged' | 'untracked';
  selectedFile: string | null;
  onSelect: (path: string, staged: boolean) => void;
  onAction: (paths: string[]) => void;
  actionLabel: string;
}

function FileGroup({ title, files, type, selectedFile, onSelect, onAction, actionLabel }: FileGroupProps) {
  if (files.length === 0) return null;

  return (
    <div className="git-file-group">
      <div className="git-file-group__header">
        <span className="git-file-group__title">{title}</span>
        <span className="git-file-group__count">{files.length}</span>
      </div>
      {files.map(file => (
        <div
          key={file}
          className={`git-file-item ${selectedFile === file ? 'git-file-item--selected' : ''}`}
          onClick={() => onSelect(file, type === 'staged')}
        >
          <span className={`git-file-item__indicator git-file-item__indicator--${type}`} />
          <span className="git-file-item__name" title={file}>{file}</span>
          <button
            className="git-file-item__action"
            onClick={(e) => { e.stopPropagation(); onAction([file]); }}
            title={actionLabel}
          >
            {type === 'staged' ? '\u2212' : '+'}
          </button>
        </div>
      ))}
    </div>
  );
}

export function FileList() {
  const staged = useGitStore(s => s.staged);
  const unstaged = useGitStore(s => s.unstaged);
  const untracked = useGitStore(s => s.untracked);
  const selectedFile = useGitStore(s => s.selectedFile);
  const selectFile = useGitStore(s => s.selectFile);
  const stageFiles = useGitStore(s => s.stageFiles);
  const unstageFiles = useGitStore(s => s.unstageFiles);

  const isEmpty = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;

  return (
    <div className="git-file-list">
      {isEmpty && (
        <div className="git-file-list__empty">Working tree clean</div>
      )}
      <FileGroup
        title="Staged"
        files={staged}
        type="staged"
        selectedFile={selectedFile}
        onSelect={selectFile}
        onAction={unstageFiles}
        actionLabel="Unstage"
      />
      <FileGroup
        title="Modified"
        files={unstaged}
        type="unstaged"
        selectedFile={selectedFile}
        onSelect={selectFile}
        onAction={stageFiles}
        actionLabel="Stage"
      />
      <FileGroup
        title="Untracked"
        files={untracked}
        type="untracked"
        selectedFile={selectedFile}
        onSelect={selectFile}
        onAction={stageFiles}
        actionLabel="Stage"
      />
    </div>
  );
}
