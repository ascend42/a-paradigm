/**
 * FlowsTab — Live flow visualization + flow composer
 *
 * Ported from sentinel/ui/src/views/FlowsView.tsx with:
 * - useSentinelLogsStore for flowEvents
 * - /api/sentinel/symbols for flow definitions
 * - No direct WS connection
 */

import { useEffect, useState, useCallback } from 'react';
import { useSentinelLogsStore, type FlowEvent } from '../store/sentinelLogsStore';

interface FlowDefinition {
  id: string;
  name: string;
  trigger?: string;
  steps: FlowStep[];
}

interface FlowStep {
  type: 'gate' | 'action' | 'signal';
  symbol: string;
  label?: string;
}

interface SymbolOption {
  symbol: string;
  type: string;
}

const STEP_COLORS: Record<string, string> = {
  gate: 'var(--p-symbol-gate)',
  action: 'var(--p-symbol-component)',
  signal: 'var(--p-symbol-signal)',
};

const STEP_ICONS: Record<string, string> = {
  gate: '^',
  action: '#',
  signal: '!',
};

function isRecentlyActive(symbol: string, flowEvents: FlowEvent[]): boolean {
  const now = Date.now();
  return flowEvents.some(
    (e) => e.nodeSymbol === symbol && (now - new Date(e.timestamp).getTime()) < 5000
  );
}

function FlowCard({
  flow,
  flowEvents,
  isSelected,
  onSelect,
}: {
  flow: FlowDefinition;
  flowEvents: FlowEvent[];
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={`flow-card ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="flow-card-header">
        <span className="flow-card-id">{flow.id}</span>
        {flow.trigger && <span className="flow-card-trigger">{flow.trigger}</span>}
      </div>
      <div className="flow-card-name">{flow.name}</div>
      <div className="flow-card-steps">
        {flow.steps.map((step, i) => {
          const active = isRecentlyActive(step.symbol, flowEvents);
          return (
            <div key={i} className="flow-step-mini">
              {i > 0 && <span className="flow-arrow">&rarr;</span>}
              <span
                className={`flow-step-dot ${active ? 'active pulse' : ''}`}
                style={{ backgroundColor: active ? STEP_COLORS[step.type] : 'var(--p-text-muted)' }}
                title={`${step.symbol} (${step.type})`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlowDiagram({
  flow,
  flowEvents,
}: {
  flow: FlowDefinition;
  flowEvents: FlowEvent[];
}) {
  return (
    <div className="flow-diagram">
      <h3>{flow.name}</h3>
      {flow.trigger && (
        <div className="flow-trigger-label">Trigger: <code>{flow.trigger}</code></div>
      )}
      <div className="flow-steps">
        {flow.steps.map((step, i) => {
          const active = isRecentlyActive(step.symbol, flowEvents);
          const recentEvent = flowEvents.find((e) => e.nodeSymbol === step.symbol);
          return (
            <div key={i} className="flow-step-container">
              {i > 0 && (
                <div className="flow-connector">
                  <div className={`flow-line ${active ? 'active' : ''}`} />
                </div>
              )}
              <div
                className={`flow-step-node ${active ? 'active' : ''}`}
                style={{ borderColor: STEP_COLORS[step.type] }}
              >
                <span className="flow-step-icon">{STEP_ICONS[step.type]}</span>
                <span className="flow-step-symbol">{step.symbol}</span>
                <span className="flow-step-type">{step.type}</span>
                {active && recentEvent && (
                  <span className="flow-step-live">
                    {recentEvent.service} &middot; {new Date(recentEvent.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlowComposer({
  symbols,
  onSave,
  onCancel,
}: {
  symbols: SymbolOption[];
  onSave: (flow: FlowDefinition) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('');
  const [steps, setSteps] = useState<FlowStep[]>([]);

  const addStep = useCallback((type: FlowStep['type']) => {
    setSteps((prev) => [...prev, { type, symbol: '' }]);
  }, []);

  const updateStep = useCallback((index: number, field: keyof FlowStep, value: string) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = () => {
    if (!name || steps.length === 0) return;
    const id = `$${name.toLowerCase().replace(/\s+/g, '-')}`;
    onSave({ id, name, trigger: trigger || undefined, steps });
  };

  const filteredSymbols = (type: string) => {
    if (type === 'gate') return symbols.filter((s) => s.type === 'gate');
    if (type === 'signal') return symbols.filter((s) => s.type === 'signal');
    return symbols.filter((s) => s.type === 'component');
  };

  return (
    <div className="flow-composer">
      <h3>New Flow</h3>

      <div className="composer-field">
        <label>Flow Name</label>
        <input
          type="text"
          placeholder="e.g. Checkout Flow"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="composer-field">
        <label>Trigger (optional)</label>
        <input
          type="text"
          placeholder="e.g. POST /api/checkout"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
        />
      </div>

      <div className="composer-steps">
        <label>Steps</label>
        {steps.map((step, i) => (
          <div key={i} className="composer-step">
            <select
              value={step.type}
              onChange={(e) => updateStep(i, 'type', e.target.value)}
            >
              <option value="gate">Gate (^)</option>
              <option value="action">Action (#)</option>
              <option value="signal">Signal (!)</option>
            </select>
            <select
              value={step.symbol}
              onChange={(e) => updateStep(i, 'symbol', e.target.value)}
            >
              <option value="">Select symbol...</option>
              {filteredSymbols(step.type).map((s) => (
                <option key={s.symbol} value={s.symbol}>{s.symbol}</option>
              ))}
            </select>
            <button className="composer-remove" onClick={() => removeStep(i)}>&times;</button>
          </div>
        ))}

        <div className="composer-add-buttons">
          <button onClick={() => addStep('gate')}>+ Gate</button>
          <button onClick={() => addStep('action')}>+ Action</button>
          <button onClick={() => addStep('signal')}>+ Signal</button>
        </div>
      </div>

      <div className="composer-actions">
        <button className="action-btn" onClick={handleSave} disabled={!name || steps.length === 0}>
          Save Flow
        </button>
        <button className="action-btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function FlowsTab() {
  const { flowEvents, isLive, setIsLive } = useSentinelLogsStore();
  const [flows, setFlows] = useState<FlowDefinition[]>([]);
  const [symbols, setSymbols] = useState<SymbolOption[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const selectedFlow = flows.find((f) => f.id === selectedFlowId);

  // Load flow definitions from API
  useEffect(() => {
    async function loadFlows() {
      try {
        const response = await fetch('/api/sentinel/symbols');
        if (!response.ok) {
          setIsLoading(false);
          return;
        }
        const data = await response.json();
        const allSymbols: SymbolOption[] = (data.symbols || []).map((s: any) => ({
          symbol: s.symbol,
          type: s.type,
        }));
        setSymbols(allSymbols);

        const flowSymbols = (data.symbols || []).filter((s: any) => s.type === 'flow');
        const defs: FlowDefinition[] = flowSymbols.map((s: any) => {
          const steps: FlowStep[] = [];
          if (s.data?.steps && Array.isArray(s.data.steps)) {
            for (const step of s.data.steps) {
              steps.push({
                type: step.type || 'action',
                symbol: step.symbol || '',
                label: step.label,
              });
            }
          }
          if (steps.length === 0 && s.references) {
            for (const ref of s.references) {
              if (ref.startsWith('^')) steps.push({ type: 'gate', symbol: ref });
              else if (ref.startsWith('!')) steps.push({ type: 'signal', symbol: ref });
              else if (ref.startsWith('#')) steps.push({ type: 'action', symbol: ref });
            }
          }
          return {
            id: s.symbol,
            name: s.data?.name || s.symbol.replace('$', ''),
            trigger: s.data?.trigger,
            steps,
          };
        });
        setFlows(defs);
        setIsLoading(false);
      } catch {
        setIsLoading(false);
      }
    }
    loadFlows();
  }, []);

  // Mark as live when mounted
  useEffect(() => {
    setIsLive(true);
    return () => setIsLive(false);
  }, []);

  const handleSaveFlow = (flow: FlowDefinition) => {
    setFlows((prev) => [...prev, flow]);
    setIsComposing(false);
    setSelectedFlowId(flow.id);
  };

  if (isLoading) {
    return (
      <div className="flows-view s-loading-state">
        <div className="s-loading-content">
          <div className="s-loading-spinner" />
          <p>Loading flows...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flows-view">
      {/* Toolbar */}
      <div className="flows-toolbar">
        <div className="flows-toolbar-left">
          <span className="flows-count">{flows.length} flow{flows.length !== 1 ? 's' : ''}</span>
          <button
            className={`logs-live-btn ${isLive ? 'active' : ''}`}
            onClick={() => setIsLive(!isLive)}
          >
            <span className={`live-dot ${isLive ? 'live' : ''}`} />
            {isLive ? 'Live' : 'Paused'}
          </button>
        </div>
        <div className="flows-toolbar-right">
          <button
            className="action-btn"
            onClick={() => { setIsComposing(true); setSelectedFlowId(null); }}
          >
            + New Flow
          </button>
        </div>
      </div>

      <div className="flows-content">
        {/* Flow List */}
        <div className="flows-list">
          {flows.length === 0 && !isComposing ? (
            <div className="flows-empty">
              <p>No flows defined.</p>
              <p className="hint">
                Define flows in <code>.purpose</code> files or use the composer to create one.
              </p>
            </div>
          ) : (
            flows.map((flow) => (
              <FlowCard
                key={flow.id}
                flow={flow}
                flowEvents={flowEvents}
                isSelected={selectedFlowId === flow.id}
                onSelect={() => { setSelectedFlowId(flow.id); setIsComposing(false); }}
              />
            ))
          )}
        </div>

        {/* Detail / Composer Panel */}
        <div className="flows-detail">
          {isComposing ? (
            <FlowComposer
              symbols={symbols}
              onSave={handleSaveFlow}
              onCancel={() => setIsComposing(false)}
            />
          ) : selectedFlow ? (
            <FlowDiagram flow={selectedFlow} flowEvents={flowEvents} />
          ) : (
            <div className="flows-empty-detail">
              <p>Select a flow to visualize or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
