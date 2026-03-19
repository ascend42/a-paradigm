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
  terminalLinesB?: (TerminalLine[] | undefined)[];
}

interface DisplayLine {
  text: string;
  style: TerminalLine['style'];
  chars: number;
}

const MAX_VISIBLE = 8;
const MAX_VISIBLE_SPLIT = 5;
const POLL_MS = 100;
const CHARS_PER_TICK = 4;

function advancePane(
  script: TerminalLine[],
  revealed: number,
  charPos: number,
  progress: number,
  phase: ScenarioPhase,
  maxVisible: number,
): { lines: DisplayLine[]; revealed: number; charPos: number } {
  const target = phase === 'active'
    ? script.length
    : script.filter(l => l.syncAt <= progress).length;

  if (target <= 0) return { lines: [], revealed, charPos };

  // Fast-forward older lines if we're 2+ behind
  while (revealed < target - 1 && revealed < script.length) {
    revealed++;
    charPos = 0;
  }

  // Typewriter on current line
  if (revealed < target && revealed < script.length) {
    charPos += CHARS_PER_TICK;
    if (charPos >= script[revealed].text.length) {
      revealed++;
      charPos = 0;
    }
  }

  // Build display lines
  const lines: DisplayLine[] = [];
  for (let i = 0; i < revealed && i < script.length; i++) {
    lines.push({ text: script[i].text, style: script[i].style, chars: script[i].text.length });
  }
  if (revealed < target && revealed < script.length) {
    lines.push({
      text: script[revealed].text,
      style: script[revealed].style,
      chars: charPos,
    });
  }

  return { lines: lines.slice(-maxVisible), revealed, charPos };
}

export function FauxTerminal({ scenarioRef, terminalLines, terminalLinesB }: FauxTerminalProps) {
  const [display, setDisplay] = useState<{
    linesA: DisplayLine[];
    linesB: DisplayLine[];
    phase: ScenarioPhase;
    isDual: boolean;
  }>({
    linesA: [],
    linesB: [],
    phase: 'growing',
    isDual: false,
  });

  const internalRef = useRef({
    lastScenario: -1,
    revealedA: 0, charPosA: 0,
    revealedB: 0, charPosB: 0,
  });

  useEffect(() => {
    const tick = setInterval(() => {
      const snap = scenarioRef.current;
      if (!snap) return;

      const { phase, progress, scenarioIndex } = snap;
      const scriptA = terminalLines[scenarioIndex] ?? [];
      const scriptB = terminalLinesB?.[scenarioIndex];
      const isDual = !!scriptB && scriptB.length > 0;
      const ir = internalRef.current;

      // Scenario changed — reset
      if (scenarioIndex !== ir.lastScenario) {
        ir.lastScenario = scenarioIndex;
        ir.revealedA = 0;
        ir.charPosA = 0;
        ir.revealedB = 0;
        ir.charPosB = 0;
        setDisplay({ linesA: [], linesB: [], phase, isDual });
        return;
      }

      // During dissolve, just update phase for CSS fade
      if (phase === 'dissolving') {
        setDisplay(prev => prev.phase === 'dissolving' ? prev : { ...prev, phase });
        return;
      }

      const maxVis = isDual ? MAX_VISIBLE_SPLIT : MAX_VISIBLE;

      // Advance pane A
      const resultA = advancePane(scriptA, ir.revealedA, ir.charPosA, progress, phase, maxVis);
      ir.revealedA = resultA.revealed;
      ir.charPosA = resultA.charPos;

      // Advance pane B (if dual)
      if (isDual && scriptB) {
        const resultB = advancePane(scriptB, ir.revealedB, ir.charPosB, progress, phase, maxVis);
        ir.revealedB = resultB.revealed;
        ir.charPosB = resultB.charPos;
        setDisplay({ linesA: resultA.lines, linesB: resultB.lines, phase, isDual: true });
      } else {
        setDisplay({ linesA: resultA.lines, linesB: [], phase, isDual: false });
      }
    }, POLL_MS);

    return () => clearInterval(tick);
  }, [scenarioRef, terminalLines, terminalLinesB]);

  const renderLines = (lines: DisplayLine[]) =>
    lines.map((line, i) => (
      <div key={i} className={`${styles.line} ${styles[line.style]}`}>
        {line.text.slice(0, line.chars)}
        {line.chars < line.text.length && <span className={styles.cursor}>&#x2588;</span>}
      </div>
    ));

  return (
    <div className={styles.terminal} data-phase={display.phase}>
      <div className={styles.chrome}>
        <span className={styles.dot} data-color="red" />
        <span className={styles.dot} data-color="yellow" />
        <span className={styles.dot} data-color="green" />
        {display.isDual && <span className={styles.chromeLabel}>symphony</span>}
      </div>
      {display.isDual ? (
        <>
          <div className={styles.pane}>
            {renderLines(display.linesA)}
          </div>
          <div className={styles.divider} />
          <div className={styles.pane}>
            {renderLines(display.linesB)}
          </div>
        </>
      ) : (
        <div className={styles.body}>
          {renderLines(display.linesA)}
        </div>
      )}
    </div>
  );
}
