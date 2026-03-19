'use client';

import { useEffect, useRef, useState } from 'react';
import type { ScenarioPhase, TerminalLine } from './LiveGraph';
import styles from './FauxTerminal.module.css';

interface ScenarioState {
  phase: ScenarioPhase;
  progress: number;
  scenarioIndex: number;
}

interface FauxTerminalProps {
  scenarioRef: { current: ScenarioState };
  terminalLines: TerminalLine[][];
}

interface DisplayLine {
  text: string;
  style: TerminalLine['style'];
  chars: number;
}

const MAX_VISIBLE = 8;
const POLL_MS = 100;
const CHARS_PER_TICK = 4;

export function FauxTerminal({ scenarioRef, terminalLines }: FauxTerminalProps) {
  const [display, setDisplay] = useState<{ lines: DisplayLine[]; phase: ScenarioPhase }>({
    lines: [],
    phase: 'growing',
  });

  const internalRef = useRef({ lastScenario: -1, revealed: 0, charPos: 0 });

  useEffect(() => {
    const tick = setInterval(() => {
      const snap = scenarioRef.current;
      if (!snap) return;

      const { phase, progress, scenarioIndex } = snap;
      const script = terminalLines[scenarioIndex] ?? [];
      const ir = internalRef.current;

      // Scenario changed — reset
      if (scenarioIndex !== ir.lastScenario) {
        ir.lastScenario = scenarioIndex;
        ir.revealed = 0;
        ir.charPos = 0;
        setDisplay({ lines: [], phase });
        return;
      }

      // During dissolve, just update phase for CSS fade
      if (phase === 'dissolving') {
        setDisplay(prev => prev.phase === 'dissolving' ? prev : { ...prev, phase });
        return;
      }

      // Target: how many lines should be fully revealed
      const target = phase === 'active'
        ? script.length
        : script.filter(l => l.syncAt <= progress).length;

      if (target <= 0) {
        setDisplay({ lines: [], phase });
        return;
      }

      // Fast-forward older lines if we're 2+ behind
      while (ir.revealed < target - 1 && ir.revealed < script.length) {
        ir.revealed++;
        ir.charPos = 0;
      }

      // Typewriter on current line
      if (ir.revealed < target && ir.revealed < script.length) {
        ir.charPos += CHARS_PER_TICK;
        if (ir.charPos >= script[ir.revealed].text.length) {
          ir.revealed++;
          ir.charPos = 0;
        }
      }

      // Build display lines
      const lines: DisplayLine[] = [];
      for (let i = 0; i < ir.revealed && i < script.length; i++) {
        lines.push({ text: script[i].text, style: script[i].style, chars: script[i].text.length });
      }
      if (ir.revealed < target && ir.revealed < script.length) {
        lines.push({
          text: script[ir.revealed].text,
          style: script[ir.revealed].style,
          chars: ir.charPos,
        });
      }

      setDisplay({ lines: lines.slice(-MAX_VISIBLE), phase });
    }, POLL_MS);

    return () => clearInterval(tick);
  }, [scenarioRef, terminalLines]);

  return (
    <div className={styles.terminal} data-phase={display.phase}>
      <div className={styles.chrome}>
        <span className={styles.dot} data-color="red" />
        <span className={styles.dot} data-color="yellow" />
        <span className={styles.dot} data-color="green" />
      </div>
      <div className={styles.body}>
        {display.lines.map((line, i) => (
          <div key={i} className={`${styles.line} ${styles[line.style]}`}>
            {line.text.slice(0, line.chars)}
            {line.chars < line.text.length && <span className={styles.cursor}>&#x2588;</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
