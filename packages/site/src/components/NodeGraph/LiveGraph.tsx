'use client';

import { useEffect, useRef, useCallback } from 'react';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface Vec2 { x: number; y: number }

interface GraphNode {
  id: string;
  label: string;
  anchor: Vec2;
  pos: Vec2;
  type: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
  radius: number;
  phase: number;
  speed: number;
  hoverGlow: number;
  activeGlow: number;
  labelOpacity: number;
}

interface GraphEdge {
  from: number;
  to: number;
}

interface Agent {
  edgeIdx: number;
  t: number;
  speed: number;
  color: string;
  size: number;
  opacity: number;
  trail: Vec2[];
  hops: number;
  scenario: number;
}

interface FloatingMsg {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  speed: number;
}

export type ScenarioPhase = 'growing' | 'active' | 'dissolving';

export interface TerminalLine {
  text: string;
  style: 'command' | 'output' | 'thought' | 'success' | 'dimmed' | 'input';
  syncAt: number;
}

interface ScenarioDef {
  name: string;
  nodes: { x: number; y: number; type: GraphNode['type']; r: number; label: string }[];
  edges: [number, number][];
  growthOrder: number[];
  terminalLines: TerminalLine[];
  terminalLinesB?: TerminalLine[];
}

export interface LiveGraphProps {
  className?: string;
  onPhaseChange?: (phase: ScenarioPhase, progress: number, scenarioIndex: number) => void;
}

/* ── Constants ──────────────────────────────────────────────────────────── */

const PREFIXES: Record<GraphNode['type'], string> = {
  component: '#', flow: '$', gate: '^', signal: '!', aspect: '~',
};

const ARRIVAL_MESSAGES: Record<string, string[]> = {
  search: ['searching...', 'reading .purpose', 'checking context', 'scanning symbols'],
  found: ['found it!', 'match found', 'located source', 'symbol resolved'],
  ripple: ['ripple analysis...', 'checking impact', 'tracing dependencies', '3 flows affected'],
  fix: ['applying fix', 'updating .purpose', 'gate check passed', 'tests passing'],
  complete: ['done!', 'all clear', 'verified', 'committed'],
};

function getAgentMessage(hops: number): { text: string; category: string } {
  if (hops <= 1) {
    const msgs = ARRIVAL_MESSAGES.search;
    return { text: msgs[Math.floor(Math.random() * msgs.length)], category: 'search' };
  }
  if (hops === 2) {
    const msgs = ARRIVAL_MESSAGES.ripple;
    return { text: msgs[Math.floor(Math.random() * msgs.length)], category: 'ripple' };
  }
  if (hops === 3) {
    const msgs = ARRIVAL_MESSAGES.found;
    return { text: msgs[Math.floor(Math.random() * msgs.length)], category: 'found' };
  }
  if (hops === 4) {
    const msgs = ARRIVAL_MESSAGES.fix;
    return { text: msgs[Math.floor(Math.random() * msgs.length)], category: 'fix' };
  }
  const msgs = ARRIVAL_MESSAGES.complete;
  return { text: msgs[Math.floor(Math.random() * msgs.length)], category: 'complete' };
}

/* ── Timing ─────────────────────────────────────────────────────────────── */

const GROWTH_DURATION = 4.0;
const ACTIVE_DURATION = 14.0;
const DISSOLVE_DURATION = 1.5;
const NODE_STAGGER = 0.22;
const NODE_REVEAL_DURATION = 0.5;

/* ── Easing ─────────────────────────────────────────────────────────────── */

function backEaseOut(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* ── Scenarios ──────────────────────────────────────────────────────────── */

export const SCENARIOS: ScenarioDef[] = [
  /* ── Scenario 1: "New App" — Build from scratch ── */
  {
    name: 'New App',
    nodes: [
      { x: 0.50, y: 0.38, type: 'component', r: 7, label: 'RecipeService' },
      { x: 0.36, y: 0.52, type: 'component', r: 5.5, label: 'ImageUploader' },
      { x: 0.63, y: 0.48, type: 'component', r: 5.5, label: 'SearchIndex' },
      { x: 0.44, y: 0.26, type: 'component', r: 4.5, label: 'UserProfile' },
      { x: 0.56, y: 0.64, type: 'component', r: 4.5, label: 'PublishRouter' },
      { x: 0.22, y: 0.32, type: 'flow', r: 5, label: 'publish-flow' },
      { x: 0.78, y: 0.42, type: 'flow', r: 4.5, label: 'search-flow' },
      { x: 0.28, y: 0.72, type: 'flow', r: 4, label: 'upload-flow' },
      { x: 0.16, y: 0.50, type: 'gate', r: 4.5, label: 'authenticated' },
      { x: 0.82, y: 0.28, type: 'gate', r: 3.5, label: 'recipe-owner' },
      { x: 0.72, y: 0.70, type: 'signal', r: 4.5, label: 'recipe-published' },
      { x: 0.33, y: 0.16, type: 'signal', r: 3.5, label: 'image-uploaded' },
      { x: 0.88, y: 0.58, type: 'aspect', r: 3.5, label: 'content-moderated' },
      { x: 0.12, y: 0.66, type: 'aspect', r: 3.5, label: 'cdn-cached' },
      { x: 0.08, y: 0.22, type: 'component', r: 3, label: 'TagService' },
      { x: 0.92, y: 0.76, type: 'component', r: 3, label: 'FeedGenerator' },
      { x: 0.54, y: 0.12, type: 'flow', r: 3, label: 'ingest-flow' },
      { x: 0.40, y: 0.82, type: 'signal', r: 3, label: 'search-complete' },
    ],
    edges: [
      [0, 1], [0, 2], [0, 3], [0, 4], [1, 4],
      [5, 1], [5, 8], [6, 2], [7, 4],
      [8, 0], [9, 6],
      [2, 10], [3, 11],
      [12, 10], [13, 8],
      [14, 5], [15, 12],
      [16, 3], [17, 7],
      [11, 5], [1, 7], [2, 6],
    ],
    growthOrder: [0, 1, 2, 3, 4, 8, 5, 6, 11, 10, 9, 7, 16, 13, 14, 12, 15, 17],
    terminalLines: [
      { text: '> Build a recipe sharing app with', style: 'input', syncAt: 0.0 },
      { text: '  image uploads and search', style: 'input', syncAt: 0.05 },
      { text: '  Reading project structure...', style: 'output', syncAt: 0.1 },
      { text: '  > Planning: 5 components, 3 flows', style: 'thought', syncAt: 0.2 },
      { text: '$ mkdir src/services/recipes', style: 'command', syncAt: 0.3 },
      { text: '  Created RecipeService, SearchIndex', style: 'output', syncAt: 0.4 },
      { text: '$ Writing src/routes/publish.ts', style: 'command', syncAt: 0.5 },
      { text: '  ^authenticated \u2192 #RecipeService', style: 'output', syncAt: 0.6 },
      { text: '  Added $publish-flow with 4 steps', style: 'dimmed', syncAt: 0.7 },
      { text: '  \u2713 App scaffolded \u00b7 18 symbols', style: 'success', syncAt: 0.85 },
    ],
  },
  /* ── Scenario 2: "Resume Session" — Recover + triage ── */
  {
    name: 'Resume Session',
    nodes: [
      { x: 0.48, y: 0.42, type: 'component', r: 7, label: 'TaskEngine' },
      { x: 0.62, y: 0.32, type: 'component', r: 5.5, label: 'WebhookSvc' },
      { x: 0.38, y: 0.30, type: 'component', r: 5.5, label: 'QueueWorker' },
      { x: 0.55, y: 0.56, type: 'component', r: 5.5, label: 'NotifyService' },
      { x: 0.32, y: 0.58, type: 'component', r: 4.5, label: 'DashboardAPI' },
      { x: 0.76, y: 0.48, type: 'flow', r: 5, label: 'dispatch-flow' },
      { x: 0.20, y: 0.44, type: 'flow', r: 4.5, label: 'retry-flow' },
      { x: 0.68, y: 0.68, type: 'flow', r: 4, label: 'webhook-flow' },
      { x: 0.82, y: 0.30, type: 'gate', r: 4.5, label: 'api-key-valid' },
      { x: 0.24, y: 0.22, type: 'gate', r: 3.5, label: 'queue-ready' },
      { x: 0.42, y: 0.74, type: 'signal', r: 4.5, label: 'task-dispatched' },
      { x: 0.70, y: 0.18, type: 'signal', r: 3.5, label: 'webhook-fired' },
      { x: 0.10, y: 0.60, type: 'aspect', r: 3.5, label: 'idempotent' },
      { x: 0.88, y: 0.62, type: 'aspect', r: 3.5, label: 'timeout-enforced' },
      { x: 0.14, y: 0.18, type: 'component', r: 3, label: 'RetryScheduler' },
      { x: 0.86, y: 0.78, type: 'component', r: 3, label: 'MetricsCollector' },
      { x: 0.52, y: 0.14, type: 'flow', r: 3, label: 'escalate-flow' },
      { x: 0.58, y: 0.84, type: 'signal', r: 3, label: 'job-complete' },
    ],
    edges: [
      [0, 1], [0, 2], [0, 3], [0, 4], [1, 3],
      [5, 1], [5, 8], [6, 2], [7, 3],
      [8, 0], [9, 6],
      [1, 11], [2, 9],
      [13, 5], [12, 6],
      [14, 6], [15, 13],
      [16, 1], [17, 7],
      [11, 5], [4, 7], [3, 5],
    ],
    growthOrder: [0, 2, 1, 3, 4, 6, 5, 8, 9, 11, 7, 10, 16, 12, 14, 13, 15, 17],
    terminalLines: [
      { text: '> Pick up where I left off', style: 'input', syncAt: 0.0 },
      { text: '  Recovering session checkpoint...', style: 'output', syncAt: 0.05 },
      { text: '  Phase: implementing \u00b7 3 files open', style: 'dimmed', syncAt: 0.15 },
      { text: '  > Found 2 issues since last session', style: 'thought', syncAt: 0.25 },
      { text: '$ paradigm_ripple #QueueWorker', style: 'command', syncAt: 0.35 },
      { text: '  ~idempotent anchor drifted (L41\u219258)', style: 'output', syncAt: 0.45 },
      { text: '$ Auto-healing aspect drift...', style: 'command', syncAt: 0.55 },
      { text: '  Updated 1 anchor, verified hash', style: 'output', syncAt: 0.65 },
      { text: '  $retry-flow: ^queue-ready \u2713', style: 'dimmed', syncAt: 0.75 },
      { text: '  \u2713 Session restored \u00b7 ready to go', style: 'success', syncAt: 0.85 },
    ],
  },
  /* ── Scenario 3: "Symphony Collab" — Two agents ── */
  {
    name: 'Symphony Collab',
    nodes: [
      { x: 0.50, y: 0.36, type: 'component', r: 7, label: 'EventBridge' },
      { x: 0.38, y: 0.48, type: 'component', r: 5.5, label: 'NotifyPanel' },
      { x: 0.64, y: 0.46, type: 'component', r: 5.5, label: 'PushGateway' },
      { x: 0.44, y: 0.24, type: 'component', r: 4.5, label: 'ToastManager' },
      { x: 0.56, y: 0.62, type: 'component', r: 4.5, label: 'WebSocketSvc' },
      { x: 0.24, y: 0.30, type: 'flow', r: 5, label: 'notify-flow' },
      { x: 0.78, y: 0.38, type: 'flow', r: 4.5, label: 'subscribe-flow' },
      { x: 0.30, y: 0.72, type: 'flow', r: 4, label: 'delivery-flow' },
      { x: 0.16, y: 0.48, type: 'gate', r: 4.5, label: 'ws-connected' },
      { x: 0.84, y: 0.26, type: 'gate', r: 3.5, label: 'channel-auth' },
      { x: 0.74, y: 0.68, type: 'signal', r: 4.5, label: 'push-received' },
      { x: 0.30, y: 0.16, type: 'signal', r: 3.5, label: 'badge-updated' },
      { x: 0.90, y: 0.56, type: 'aspect', r: 3.5, label: 'dedup-enforced' },
      { x: 0.10, y: 0.64, type: 'aspect', r: 3.5, label: 'retry-on-fail' },
      { x: 0.06, y: 0.20, type: 'component', r: 3, label: 'InboxStore' },
      { x: 0.92, y: 0.74, type: 'component', r: 3, label: 'PresenceTracker' },
      { x: 0.56, y: 0.10, type: 'flow', r: 3, label: 'ack-flow' },
      { x: 0.44, y: 0.84, type: 'signal', r: 3, label: 'toast-shown' },
    ],
    edges: [
      [0, 1], [0, 2], [0, 3], [0, 4], [1, 4],
      [5, 1], [5, 8], [6, 2], [7, 1],
      [8, 0], [9, 6],
      [2, 10], [3, 11],
      [12, 10], [13, 8],
      [14, 5], [15, 12],
      [16, 3], [17, 7],
      [11, 5], [4, 7], [2, 6],
    ],
    growthOrder: [0, 3, 1, 2, 4, 5, 8, 6, 9, 11, 10, 7, 16, 13, 14, 12, 15, 17],
    terminalLines: [
      { text: '  frontend/notifications agent', style: 'dimmed', syncAt: 0.0 },
      { text: '> Implement ENG-142: notification UI', style: 'input', syncAt: 0.05 },
      { text: '  > Reading #NotifyPanel .purpose...', style: 'thought', syncAt: 0.15 },
      { text: '$ Writing NotifyPanel.tsx', style: 'command', syncAt: 0.25 },
      { text: '  Toast stack + badge counter done', style: 'output', syncAt: 0.35 },
      { text: '  \u2709 backend: "WS schema ready?"', style: 'thought', syncAt: 0.45 },
      { text: '  \u2709 from backend: "Typed. See -143"', style: 'output', syncAt: 0.55 },
      { text: '$ Wiring $subscribe-flow hooks', style: 'command', syncAt: 0.65 },
      { text: '  ^ws-connected gate integrated', style: 'output', syncAt: 0.75 },
      { text: '  \u2713 ENG-142 complete \u00b7 pushed', style: 'success', syncAt: 0.85 },
    ],
    terminalLinesB: [
      { text: '  backend/notifications agent', style: 'dimmed', syncAt: 0.0 },
      { text: '> Implement ENG-143: push gateway', style: 'input', syncAt: 0.05 },
      { text: '  > Checking $notify-flow steps...', style: 'thought', syncAt: 0.15 },
      { text: '$ Writing PushGateway.ts', style: 'command', syncAt: 0.25 },
      { text: '  WS channels + auth ^channel-auth', style: 'output', syncAt: 0.35 },
      { text: '  \u2709 from frontend: "WS schema?"', style: 'thought', syncAt: 0.45 },
      { text: '  \u2709 frontend: "Typed. See ENG-143"', style: 'output', syncAt: 0.55 },
      { text: '$ Adding ~dedup-enforced aspect', style: 'command', syncAt: 0.65 },
      { text: '  Anchor: push-gateway.ts:L24-L31', style: 'output', syncAt: 0.75 },
      { text: '  \u2713 ENG-143 complete \u00b7 pushed', style: 'success', syncAt: 0.85 },
    ],
  },
];

/* ── Color helpers ──────────────────────────────────────────────────────── */

const SYMBOL_CSS_VARS: Record<GraphNode['type'], string> = {
  component: '--sym-component',
  flow: '--sym-flow',
  gate: '--sym-gate',
  signal: '--sym-signal',
  aspect: '--sym-aspect',
};

function readColors(el: HTMLElement): Record<GraphNode['type'], string> {
  const cs = getComputedStyle(el);
  const result: Partial<Record<GraphNode['type'], string>> = {};
  for (const [type, varName] of Object.entries(SYMBOL_CSS_VARS)) {
    result[type as GraphNode['type']] = cs.getPropertyValue(varName).trim() || '#888';
  }
  return result as Record<GraphNode['type'], string>;
}

function hexToRgb(color: string): [number, number, number] {
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];
  const hex = color.replace('#', '');
  if (hex.length === 3) {
    return [parseInt(hex[0]+hex[0], 16), parseInt(hex[1]+hex[1], 16), parseInt(hex[2]+hex[2], 16)];
  }
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function readTextColor(el: HTMLElement): string {
  return getComputedStyle(el).getPropertyValue('--text-secondary').trim() || '#9ca3af';
}

/* ── State type ─────────────────────────────────────────────────────────── */

interface GState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  agents: Agent[];
  messages: FloatingMsg[];
  mouse: Vec2 | null;
  colors: Record<GraphNode['type'], string>;
  edgeColor: string;
  textColor: string;
  w: number;
  h: number;
  dpr: number;
  time: number;
  frameId: number;
  scenarioIdx: number;
  phase: ScenarioPhase;
  phaseTime: number;
  nodeReveal: number[];
  edgeReveal: number[];
}

/* ── Scenario helpers ───────────────────────────────────────────────────── */

function buildNodes(scenario: ScenarioDef, w: number, h: number, dpr: number): GraphNode[] {
  return scenario.nodes.map((def, i) => ({
    id: `n${i}`,
    label: `${PREFIXES[def.type]}${def.label}`,
    anchor: { x: def.x, y: def.y },
    pos: { x: def.x * w, y: def.y * h },
    type: def.type,
    radius: def.r * dpr,
    phase: Math.random() * Math.PI * 2,
    speed: 0.3 + Math.random() * 0.4,
    hoverGlow: 0,
    activeGlow: 0,
    labelOpacity: 0,
  }));
}

function buildEdges(scenario: ScenarioDef): GraphEdge[] {
  return scenario.edges.map(([from, to]) => ({ from, to }));
}

function loadNextScenario(s: GState): void {
  const nextIdx = (s.scenarioIdx + 1) % SCENARIOS.length;
  const scenario = SCENARIOS[nextIdx];
  s.scenarioIdx = nextIdx;
  s.phase = 'growing';
  s.phaseTime = 0;
  s.agents = [];
  s.messages = [];
  s.nodes = buildNodes(scenario, s.w, s.h, s.dpr);
  s.edges = buildEdges(scenario);
  s.nodeReveal = new Array(s.nodes.length).fill(0);
  s.edgeReveal = new Array(s.edges.length).fill(0);
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function LiveGraph({ className, onPhaseChange }: LiveGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GState | null>(null);
  const phaseCallbackRef = useRef(onPhaseChange);
  phaseCallbackRef.current = onPhaseChange;

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const colors = readColors(canvas);
    const cs = getComputedStyle(canvas);
    const edgeColor = cs.getPropertyValue('--surface-steel').trim() || '#3f3f4a';
    const textColor = readTextColor(canvas);

    const prev = stateRef.current;
    const scenarioIdx = prev?.scenarioIdx ?? 0;
    const scenario = SCENARIOS[scenarioIdx];
    const nodes = buildNodes(scenario, rect.width, rect.height, dpr);
    const edges = buildEdges(scenario);

    // Preserve node animation state across resizes
    if (prev && prev.nodes.length === nodes.length) {
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].phase = prev.nodes[i].phase;
        nodes[i].speed = prev.nodes[i].speed;
        nodes[i].hoverGlow = prev.nodes[i].hoverGlow;
        nodes[i].activeGlow = prev.nodes[i].activeGlow;
        nodes[i].labelOpacity = prev.nodes[i].labelOpacity;
      }
    }

    stateRef.current = {
      nodes,
      edges,
      agents: prev?.agents ?? [],
      messages: prev?.messages ?? [],
      mouse: prev?.mouse ?? null,
      colors,
      edgeColor,
      textColor,
      w: rect.width,
      h: rect.height,
      dpr,
      time: prev?.time ?? 0,
      frameId: prev?.frameId ?? 0,
      scenarioIdx,
      phase: prev?.phase ?? 'growing',
      phaseTime: prev?.phaseTime ?? 0,
      nodeReveal: prev?.nodeReveal ?? new Array(nodes.length).fill(0),
      edgeReveal: prev?.edgeReveal ?? new Array(edges.length).fill(0),
    };
  }, []);

  useEffect(() => {
    init();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    const canvasEl: HTMLCanvasElement = canvas;

    const onResize = () => init();

    const onMouseMove = (e: MouseEvent) => {
      const s = stateRef.current;
      if (!s) return;
      const rect = canvasEl.getBoundingClientRect();
      s.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onMouseLeave = () => {
      const s = stateRef.current;
      if (s) s.mouse = null;
    };

    const observer = new MutationObserver(() => {
      const s = stateRef.current;
      if (s) {
        s.colors = readColors(canvasEl);
        const cs = getComputedStyle(canvasEl);
        s.edgeColor = cs.getPropertyValue('--surface-steel').trim() || '#3f3f4a';
        s.textColor = readTextColor(canvasEl);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    function spawnAgent() {
      const s = stateRef.current;
      if (!s || s.agents.length >= 5) return;
      if (s.phase === 'dissolving') return;

      // Only spawn on visible edges
      const visibleEdges: number[] = [];
      for (let i = 0; i < s.edges.length; i++) {
        if (s.edgeReveal[i] > 0.5) visibleEdges.push(i);
      }
      if (visibleEdges.length < 3) return;

      const edgeIdx = visibleEdges[Math.floor(Math.random() * visibleEdges.length)];
      const edge = s.edges[edgeIdx];
      const nodeType = s.nodes[edge.from].type;

      s.agents.push({
        edgeIdx,
        t: 0,
        speed: 0.008 + Math.random() * 0.006,
        color: s.colors[nodeType],
        size: 3.5 * s.dpr,
        opacity: 0,
        trail: [],
        hops: 0,
        scenario: Math.floor(Math.random() * 3),
      });
    }

    function onAgentArrive(agent: Agent, nodeIdx: number) {
      const s = stateRef.current;
      if (!s) return;
      const node = s.nodes[nodeIdx];

      node.activeGlow = 1;
      node.labelOpacity = 1;

      if (Math.random() < 0.45) {
        const { text } = getAgentMessage(agent.hops);
        s.messages.push({
          x: node.pos.x,
          y: node.pos.y - node.radius / s.dpr - 12,
          text,
          color: agent.color,
          life: 1,
          speed: 0.008 + Math.random() * 0.004,
        });
      }
    }

    let lastTime = performance.now();

    function frame(now: number) {
      const s = stateRef.current;
      if (!s) return;
      s.frameId = requestAnimationFrame(frame);

      const dt = Math.min(now - lastTime, 32);
      lastTime = now;
      const dtSec = dt * 0.001;
      s.time += dtSec;
      s.phaseTime += dtSec;

      /* ── Phase state machine ── */
      const scenario = SCENARIOS[s.scenarioIdx];

      if (s.phase === 'growing') {
        for (let i = 0; i < s.nodes.length; i++) {
          const order = scenario.growthOrder.indexOf(i);
          const revealStart = order * NODE_STAGGER;
          const revealAge = Math.max(0, s.phaseTime - revealStart);
          s.nodeReveal[i] = revealAge > 0
            ? backEaseOut(Math.min(1, revealAge / NODE_REVEAL_DURATION))
            : 0;
        }
        if (s.phaseTime >= GROWTH_DURATION) {
          s.phase = 'active';
          s.phaseTime = 0;
          for (let i = 0; i < s.nodeReveal.length; i++) s.nodeReveal[i] = 1;
        }
      } else if (s.phase === 'active') {
        if (s.phaseTime >= ACTIVE_DURATION) {
          s.phase = 'dissolving';
          s.phaseTime = 0;
          s.agents.length = 0;
          s.messages.length = 0;
        }
      } else {
        const dissolveT = Math.min(1, s.phaseTime / DISSOLVE_DURATION);
        const scale = 1 - dissolveT * dissolveT;
        for (let i = 0; i < s.nodeReveal.length; i++) s.nodeReveal[i] = scale;
        if (s.phaseTime >= DISSOLVE_DURATION) {
          loadNextScenario(s);
        }
      }

      // Compute edge reveals from node reveals
      for (let j = 0; j < s.edges.length; j++) {
        const fr = s.nodeReveal[s.edges[j].from];
        const tr = s.nodeReveal[s.edges[j].to];
        s.edgeReveal[j] = Math.min(
          Math.max(0, fr - 0.3) / 0.7,
          Math.max(0, tr - 0.3) / 0.7,
        );
      }

      // Report phase to parent
      const phaseDur = s.phase === 'growing' ? GROWTH_DURATION
        : s.phase === 'active' ? ACTIVE_DURATION : DISSOLVE_DURATION;
      phaseCallbackRef.current?.(s.phase, Math.min(1, s.phaseTime / phaseDur), s.scenarioIdx);

      /* ── Destructure after state machine (safe after potential scenario load) ── */
      const { nodes, edges, agents, messages, w, h, dpr, time, colors, edgeColor, nodeReveal, edgeReveal } = s;

      /* ── Update nodes ── */
      for (let ni = 0; ni < nodes.length; ni++) {
        const node = nodes[ni];
        const reveal = nodeReveal[ni];
        if (reveal < 0.01) {
          node.hoverGlow = 0;
          node.activeGlow = 0;
          node.labelOpacity = 0;
          continue;
        }

        const driftX = Math.sin(time * node.speed + node.phase) * 8;
        const driftY = Math.cos(time * node.speed * 0.7 + node.phase + 1.5) * 6;
        node.pos.x = node.anchor.x * w + driftX;
        node.pos.y = node.anchor.y * h + driftY;

        if (s.mouse) {
          const dx = s.mouse.x - node.pos.x;
          const dy = s.mouse.y - node.pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const hoverRadius = node.radius / dpr * 4;
          const target = dist < hoverRadius ? 1 : 0;
          node.hoverGlow += (target - node.hoverGlow) * 0.1;
          if (target > 0.5) node.labelOpacity = 1;
        } else {
          node.hoverGlow *= 0.95;
        }

        node.activeGlow *= 0.97;
        if (node.hoverGlow < 0.1) {
          node.labelOpacity *= 0.985;
        }
      }

      /* ── Update agents ── */
      for (let i = agents.length - 1; i >= 0; i--) {
        const agent = agents[i];
        agent.t += agent.speed;
        if (agent.t < 0.1) agent.opacity = agent.t / 0.1;
        else if (agent.t > 0.85) agent.opacity = Math.max(0, (1 - agent.t) / 0.15);
        else agent.opacity = 1;

        const edge = edges[agent.edgeIdx];
        const from = nodes[edge.from].pos;
        const to = nodes[edge.to].pos;
        const eased = agent.t < 0.5
          ? 4 * agent.t * agent.t * agent.t
          : 1 - Math.pow(-2 * agent.t + 2, 3) / 2;
        const px = from.x + (to.x - from.x) * eased;
        const py = from.y + (to.y - from.y) * eased;
        agent.trail.push({ x: px, y: py });
        if (agent.trail.length > 14) agent.trail.shift();

        if (agent.t >= 1) {
          const arrivedAt = edge.to;
          agent.hops++;
          onAgentArrive(agent, arrivedAt);

          const nextEdges = edges
            .map((e, idx) => ({ e, idx }))
            .filter(({ e, idx }) => (e.from === arrivedAt || e.to === arrivedAt) && edgeReveal[idx] > 0.5);

          if (nextEdges.length > 0 && agent.hops < 6 && Math.random() < 0.7) {
            const pick = nextEdges[Math.floor(Math.random() * nextEdges.length)];
            agent.edgeIdx = pick.idx;
            agent.t = 0;
            agent.trail = [];
            const destIdx = pick.e.from === arrivedAt ? pick.e.to : pick.e.from;
            agent.color = colors[nodes[destIdx].type];
          } else {
            agents.splice(i, 1);
          }
        }
      }

      /* ── Update messages ── */
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        msg.life -= msg.speed;
        msg.y -= 0.3;
        if (msg.life <= 0) messages.splice(i, 1);
      }

      /* ── Draw ── */
      if (!ctx) return;
      ctx.clearRect(0, 0, w * dpr, h * dpr);
      ctx.save();
      ctx.scale(dpr, dpr);

      // Edges
      for (let ei = 0; ei < edges.length; ei++) {
        const edge = edges[ei];
        const reveal = edgeReveal[ei];
        if (reveal < 0.01) continue;

        const nFrom = nodes[edge.from];
        const nTo = nodes[edge.to];
        const isAspect = nFrom.type === 'aspect' || nTo.type === 'aspect';
        const glow = Math.max(nFrom.hoverGlow, nTo.hoverGlow, nFrom.activeGlow * 0.5, nTo.activeGlow * 0.5);
        const alpha = (0.12 + glow * 0.3) * reveal;

        ctx.beginPath();
        ctx.moveTo(nFrom.pos.x, nFrom.pos.y);
        ctx.lineTo(nTo.pos.x, nTo.pos.y);
        ctx.strokeStyle = edgeColor;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 0.8 + glow * 1;
        if (isAspect) ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      // Agent trails
      for (const agent of agents) {
        if (agent.trail.length < 2) continue;
        if (edgeReveal[agent.edgeIdx] < 0.3) continue;
        for (let j = 1; j < agent.trail.length; j++) {
          const trailAlpha = (j / agent.trail.length) * agent.opacity * 0.5;
          ctx.beginPath();
          ctx.moveTo(agent.trail[j - 1].x, agent.trail[j - 1].y);
          ctx.lineTo(agent.trail[j].x, agent.trail[j].y);
          ctx.strokeStyle = agent.color;
          ctx.globalAlpha = trailAlpha;
          ctx.lineWidth = agent.size / dpr * 0.7;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Agent dots
      for (const agent of agents) {
        if (edgeReveal[agent.edgeIdx] < 0.3) continue;
        const edge = edges[agent.edgeIdx];
        const aFrom = nodes[edge.from].pos;
        const aTo = nodes[edge.to].pos;
        const eased2 = agent.t < 0.5
          ? 4 * agent.t * agent.t * agent.t
          : 1 - Math.pow(-2 * agent.t + 2, 3) / 2;
        const px = aFrom.x + (aTo.x - aFrom.x) * eased2;
        const py = aFrom.y + (aTo.y - aFrom.y) * eased2;

        // Glow
        ctx.beginPath();
        ctx.arc(px, py, agent.size / dpr * 4, 0, Math.PI * 2);
        ctx.fillStyle = agent.color;
        ctx.globalAlpha = agent.opacity * 0.12;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(px, py, agent.size / dpr, 0, Math.PI * 2);
        ctx.fillStyle = agent.color;
        ctx.globalAlpha = agent.opacity * 0.95;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Nodes
      for (let ni = 0; ni < nodes.length; ni++) {
        const node = nodes[ni];
        const reveal = nodeReveal[ni];
        if (reveal < 0.01) continue;

        const color = colors[node.type];
        const r = (node.radius / dpr) * reveal;
        const hover = node.hoverGlow;
        const active = node.activeGlow;
        const combined = Math.max(hover, active);

        // Active/hover ring
        if (combined > 0.01 && reveal > 0.5) {
          const ringR = r + 8 * combined;
          ctx.beginPath();
          ctx.arc(node.pos.x, node.pos.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.globalAlpha = combined * 0.3 * reveal;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          if (combined > 0.3) {
            const ringR2 = r + 16 * combined;
            ctx.beginPath();
            ctx.arc(node.pos.x, node.pos.y, ringR2, 0, Math.PI * 2);
            ctx.globalAlpha = combined * 0.1 * reveal;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;

        // Radial glow
        const glowR = r * (2 + combined * 2.5);
        if (glowR > 0.1) {
          const grad = ctx.createRadialGradient(
            node.pos.x, node.pos.y, 0,
            node.pos.x, node.pos.y, glowR,
          );
          const [cr, cg, cb] = hexToRgb(color);
          grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${(0.2 + combined * 0.3) * reveal})`);
          grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
          ctx.beginPath();
          ctx.arc(node.pos.x, node.pos.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Node body
        const scale = 1 + combined * 0.3;
        const drawR = r * scale;
        if (drawR > 0.1) {
          ctx.beginPath();
          drawNodeShape(ctx, node.type, node.pos.x, node.pos.y, drawR);
          ctx.globalAlpha = reveal;
          if (node.type === 'aspect') {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          } else {
            ctx.fillStyle = color;
            ctx.fill();
          }
        }

        // Label with background pill
        if (node.labelOpacity > 0.02 && reveal > 0.8) {
          const fontSize = 11;
          const monoFont = getComputedStyle(canvasEl).getPropertyValue('--font-mono').trim() || 'monospace';
          ctx.font = `600 ${fontSize}px ${monoFont}`;
          ctx.textAlign = 'center';
          const labelY = node.pos.y - r - 12;
          const textWidth = ctx.measureText(node.label).width;
          const pillPad = 6;
          const pillH = fontSize + 6;

          const [lr, lg, lb] = hexToRgb(color);
          ctx.globalAlpha = node.labelOpacity * 0.6 * reveal;
          ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, 0.15)`;
          const pillX = node.pos.x - textWidth / 2 - pillPad;
          const pillY = labelY - fontSize + 1;
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, textWidth + pillPad * 2, pillH, 4);
          ctx.fill();

          ctx.fillStyle = color;
          ctx.globalAlpha = node.labelOpacity * 0.95 * reveal;
          ctx.fillText(node.label, node.pos.x, labelY);
          ctx.globalAlpha = 1;
        }
      }

      // Floating messages
      const monoFont2 = getComputedStyle(canvasEl).getPropertyValue('--font-mono').trim() || 'monospace';
      for (const msg of messages) {
        const alpha = msg.life < 0.3 ? msg.life / 0.3 : msg.life > 0.8 ? (1 - msg.life) / 0.2 : 1;
        const msgFontSize = 10;
        ctx.font = `500 ${msgFontSize}px ${monoFont2}`;
        ctx.textAlign = 'center';
        const msgW = ctx.measureText(msg.text).width;

        ctx.globalAlpha = alpha * 0.5;
        const [mr, mg, mb] = hexToRgb(msg.color);
        ctx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, 0.12)`;
        ctx.beginPath();
        ctx.roundRect(msg.x - msgW / 2 - 5, msg.y - msgFontSize + 1, msgW + 10, msgFontSize + 5, 3);
        ctx.fill();

        ctx.fillStyle = msg.color;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillText(msg.text, msg.x, msg.y);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    const spawnInterval = setInterval(spawnAgent, 700);

    window.addEventListener('resize', onResize);
    canvasEl.addEventListener('mousemove', onMouseMove);
    canvasEl.addEventListener('mouseleave', onMouseLeave);

    stateRef.current!.frameId = requestAnimationFrame(frame);

    return () => {
      const s = stateRef.current;
      if (s) cancelAnimationFrame(s.frameId);
      clearInterval(spawnInterval);
      window.removeEventListener('resize', onResize);
      canvasEl.removeEventListener('mousemove', onMouseMove);
      canvasEl.removeEventListener('mouseleave', onMouseLeave);
      observer.disconnect();
    };
  }, [init]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}

/* ── Shape drawing ──────────────────────────────────────────────────────── */

function drawNodeShape(
  ctx: CanvasRenderingContext2D,
  type: GraphNode['type'],
  x: number,
  y: number,
  r: number,
) {
  switch (type) {
    case 'component':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'flow': {
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    }
    case 'gate': {
      const s = r * 0.85;
      ctx.rect(x - s, y - s, s * 2, s * 2);
      break;
    }
    case 'signal': {
      const h = r * 1.2;
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h, y + h * 0.6);
      ctx.lineTo(x - h, y + h * 0.6);
      ctx.closePath();
      break;
    }
    case 'aspect': {
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    }
  }
}
