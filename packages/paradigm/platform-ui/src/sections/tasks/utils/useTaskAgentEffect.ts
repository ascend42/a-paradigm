import { useMemo } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import type { Task } from '../store/tasksStore';
import { deriveSymbols } from './board';

// useTaskAgentEffect — the SAME agent-effect protocol lore/graph consume, but
// matched the way agentStore matches: by SYMBOL, not by taskId.
//
// agentStore holds highlights[{ symbols[], color, pulse, label }] and
// annotations[{ symbol, type, message, severity }]. A card registers its derived
// symbols (utils/board.deriveSymbols) and checks for intersection. When an agent
// sends agent:highlight(symbol) the matching card pulses; agent:annotate(symbol)
// of type 'badge' stamps a badge on the card. Muting clears agentStore, so a
// muted session yields no matches — the existing mute affordance is honored for
// free.

export interface TaskAgentEffect {
  highlighted: boolean;
  /** Highlight color/label to apply when highlighted (first match wins). */
  color?: string;
  pulse: boolean;
  label?: string;
  /** Badge annotations targeting one of this card's symbols. */
  badges: { id: string; message: string; severity: string }[];
}

export function useTaskAgentEffect(task: Pick<Task, 'blurb' | 'tags'>): TaskAgentEffect {
  const highlights = useAgentStore((s) => s.highlights);
  const annotations = useAgentStore((s) => s.annotations);

  const symbols = useMemo(() => new Set(deriveSymbols(task)), [task]);

  return useMemo(() => {
    let highlighted = false;
    let color: string | undefined;
    let pulse = false;
    let label: string | undefined;

    for (const h of highlights) {
      if (h.symbols.some((sym) => symbols.has(sym))) {
        highlighted = true;
        color = h.color;
        pulse = h.pulse;
        label = h.label;
        break;
      }
    }

    const badges = annotations
      .filter((a) => a.type === 'badge' && a.symbol && symbols.has(a.symbol))
      .map((a) => ({ id: a.id, message: a.message, severity: a.severity }));

    return { highlighted, color, pulse, label, badges };
  }, [highlights, annotations, symbols]);
}
