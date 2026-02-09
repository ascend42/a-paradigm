import { useState, useEffect, useCallback } from 'react';

interface TimerProps {
  /** Total time in seconds */
  totalSeconds: number;
  /** Called when time runs out */
  onTimeUp: () => void;
  /** Whether the timer is running */
  running: boolean;
}

export function Timer({ totalSeconds, onTimeUp, running }: TimerProps) {
  const [remaining, setRemaining] = useState(totalSeconds);

  const handleTimeUp = useCallback(() => {
    onTimeUp();
  }, [onTimeUp]);

  useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [running, handleTimeUp]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const percentLeft = (remaining / totalSeconds) * 100;

  let timerClass = 'timer-display';
  if (percentLeft < 20) timerClass += ' critical';
  else if (percentLeft < 40) timerClass += ' warning';

  return (
    <span className={timerClass}>
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </span>
  );
}
