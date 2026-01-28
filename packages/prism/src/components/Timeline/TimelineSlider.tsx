/**
 * Timeline slider for navigating history snapshots
 */

import { useState } from 'react';

export function TimelineSlider() {
  const [value, setValue] = useState(100);

  // TODO: Connect to actual snapshots from premise file
  const currentSnapshot = 'Current';

  return (
    <div className="timeline-container">
      <span className="timeline-label">Timeline</span>
      <input
        type="range"
        className="timeline-slider"
        min={0}
        max={100}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <span className="timeline-value">{currentSnapshot}</span>
    </div>
  );
}
