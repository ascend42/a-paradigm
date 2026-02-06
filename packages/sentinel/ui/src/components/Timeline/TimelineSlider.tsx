/**
 * Timeline slider for navigating history snapshots
 * Now connected to real Git commit history
 */

import { useEffect, useState, useMemo } from 'react';
import { useTimelineStore } from '../../store/timelineStore';

export function TimelineSlider() {
  const { commits, selectedCommitHash, isLoading, loadCommits, selectCommit, getSelectedCommit } = useTimelineStore();
  const [sliderValue, setSliderValue] = useState(100);

  // Load commits on mount
  useEffect(() => {
    loadCommits();
  }, [loadCommits]);

  // Update slider when commit changes
  useEffect(() => {
    if (commits.length === 0) return;
    if (!selectedCommitHash) {
      setSliderValue(100);
      return;
    }
    const index = commits.findIndex((c) => c.hash === selectedCommitHash);
    if (index >= 0) {
      setSliderValue((index / (commits.length - 1)) * 100);
    }
  }, [selectedCommitHash, commits]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setSliderValue(value);

    if (commits.length === 0) return;

    if (value >= 100) {
      // Current state
      selectCommit(null);
    } else {
      const index = Math.round((value / 100) * (commits.length - 1));
      const commit = commits[index];
      if (commit) {
        selectCommit(commit.hash);
      }
    }
  };

  const selectedCommit = getSelectedCommit();
  const displayText = useMemo(() => {
    if (isLoading) return 'Loading...';
    if (commits.length === 0) return 'No history';
    if (!selectedCommit) return 'Current';
    return `${selectedCommit.shortHash} - ${selectedCommit.message.slice(0, 30)}${selectedCommit.message.length > 30 ? '...' : ''}`;
  }, [isLoading, commits.length, selectedCommit]);

  return (
    <div className="timeline-container">
      <span className="timeline-label">Timeline</span>
      <input
        type="range"
        className="timeline-slider"
        min={0}
        max={100}
        value={sliderValue}
        onChange={handleSliderChange}
        disabled={isLoading || commits.length === 0}
      />
      <span className="timeline-value" title={selectedCommit?.message}>
        {displayText}
      </span>
    </div>
  );
}
