import React from 'react';
import { useGitStore } from '../store/gitStore';

interface DiffLine {
  type: 'add' | 'remove' | 'hunk' | 'context';
  content: string;
  lineNum?: string;
}

function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split('\n').slice(0, 2000); // truncate at 2000 lines
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -old,count +new,count @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[2]);
      }
      result.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line, lineNum: String(newLine) });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line, lineNum: String(oldLine) });
      oldLine++;
    } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'context', content: line });
    } else {
      result.push({ type: 'context', content: line, lineNum: String(newLine) });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

export function DiffViewer() {
  const selectedFile = useGitStore(s => s.selectedFile);
  const diffContent = useGitStore(s => s.diffContent);

  if (!selectedFile) {
    return (
      <div className="git-diff-empty">
        Select a file to view its diff
      </div>
    );
  }

  const lines = parseDiff(diffContent);

  return (
    <div className="git-diff">
      <div className="git-diff__header">{selectedFile}</div>
      <pre className="git-diff__content">
        {lines.map((line, i) => (
          <div key={i} className={`git-diff__line git-diff__line--${line.type}`}>
            <span className="git-diff__gutter">{line.lineNum || ''}</span>
            <span className="git-diff__text">{line.content}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
