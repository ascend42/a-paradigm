import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useGitStore } from '../store/gitStore';

const TRIGGER_CHARS = '#$^!~';

export function CommitComposer() {
  const commitMessage = useGitStore(s => s.commitMessage);
  const setCommitMessage = useGitStore(s => s.setCommitMessage);
  const commitFn = useGitStore(s => s.commit);
  const push = useGitStore(s => s.push);
  const committing = useGitStore(s => s.committing);
  const pushing = useGitStore(s => s.pushing);
  const staged = useGitStore(s => s.staged);
  const symbols = useGitStore(s => s.symbols);
  const ahead = useGitStore(s => s.ahead);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [triggerStart, setTriggerStart] = useState(-1);

  const updateSuggestions = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const text = ta.value.substring(0, pos);

    // Scan backwards for trigger char
    let start = -1;
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === ' ' || ch === '\n') break;
      if (TRIGGER_CHARS.includes(ch)) {
        start = i;
        break;
      }
    }

    if (start >= 0) {
      const query = text.substring(start).toLowerCase();
      const filtered = symbols.filter(s => s.toLowerCase().startsWith(query)).slice(0, 8);
      setSuggestions(filtered);
      setSuggestionIndex(0);
      setTriggerStart(start);
    } else {
      setSuggestions([]);
      setTriggerStart(-1);
    }
  }, [symbols]);

  const insertSuggestion = useCallback((suggestion: string) => {
    const ta = textareaRef.current;
    if (!ta || triggerStart < 0) return;
    const before = commitMessage.substring(0, triggerStart);
    const after = commitMessage.substring(ta.selectionStart);
    const newMsg = before + suggestion + ' ' + after;
    setCommitMessage(newMsg);
    setSuggestions([]);
    setTriggerStart(-1);
    // Focus back
    setTimeout(() => {
      if (ta) {
        const newPos = triggerStart + suggestion.length + 1;
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
      }
    }, 0);
  }, [commitMessage, triggerStart, setCommitMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(i => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSuggestion(suggestions[suggestionIndex]);
      } else if (e.key === 'Escape') {
        setSuggestions([]);
      }
    }
  }, [suggestions, suggestionIndex, insertSuggestion]);

  // Close suggestions on blur
  useEffect(() => {
    const handleClick = () => setSuggestions([]);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="git-commit-composer">
      <div className="git-commit-composer__input-wrap">
        <textarea
          ref={textareaRef}
          className="git-commit-composer__textarea"
          placeholder={staged.length > 0 ? 'Commit message...' : 'No staged files to commit'}
          value={commitMessage}
          onChange={(e) => { setCommitMessage(e.target.value); updateSuggestions(); }}
          onKeyUp={updateSuggestions}
          onKeyDown={handleKeyDown}
          disabled={staged.length === 0}
          rows={3}
        />
        {suggestions.length > 0 && (
          <div className="git-commit-composer__suggestions" onClick={e => e.stopPropagation()}>
            {suggestions.map((s, i) => (
              <div
                key={s}
                className={`git-commit-composer__suggestion ${i === suggestionIndex ? 'git-commit-composer__suggestion--active' : ''}`}
                onClick={() => insertSuggestion(s)}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="git-commit-composer__actions">
        <button
          className="git-commit-composer__btn git-commit-composer__btn--commit"
          onClick={commitFn}
          disabled={committing || staged.length === 0 || !commitMessage.trim()}
        >
          {committing ? 'Committing...' : `Commit (${staged.length})`}
        </button>
        <button
          className="git-commit-composer__btn git-commit-composer__btn--push"
          onClick={push}
          disabled={pushing || ahead === 0}
        >
          {pushing ? 'Pushing...' : `Push${ahead > 0 ? ` (${ahead})` : ''}`}
        </button>
      </div>
    </div>
  );
}
