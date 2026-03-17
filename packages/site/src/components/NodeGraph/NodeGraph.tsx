'use client';

import { useEffect, useRef, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import styles from './NodeGraph.module.css';

interface Node {
  id: string;
  x: number;
  y: number;
  type: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
  radius: number;
  label?: string;
}

interface Edge {
  from: string;
  to: string;
}

interface NodeGraphProps {
  className?: string;
  density?: 'sparse' | 'medium' | 'dense';
  animated?: boolean;
  interactive?: boolean;
}

const SYMBOL_COLORS = {
  component: 'var(--sym-component)',
  flow: 'var(--sym-flow)',
  gate: 'var(--sym-gate)',
  signal: 'var(--sym-signal)',
  aspect: 'var(--sym-aspect)',
};

const GLOW_COLORS = {
  component: 'var(--glow-component)',
  flow: 'var(--glow-flow)',
  gate: 'var(--glow-gate)',
  signal: 'var(--glow-signal)',
  aspect: 'var(--glow-aspect)',
};

const NODE_SHAPES = {
  component: 'circle',
  flow: 'diamond',
  gate: 'square',
  signal: 'triangle',
  aspect: 'hollowDiamond',
} as const;

// Generate deterministic node positions for the hero
function generateHeroNodes(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    // Center cluster — Components
    { id: 'c1', x: 50, y: 40, type: 'component', radius: 6, label: '#auth' },
    { id: 'c2', x: 38, y: 55, type: 'component', radius: 5 },
    { id: 'c3', x: 62, y: 52, type: 'component', radius: 5 },
    { id: 'c4', x: 45, y: 30, type: 'component', radius: 4 },
    { id: 'c5', x: 55, y: 65, type: 'component', radius: 4 },

    // Flow nodes
    { id: 'f1', x: 25, y: 35, type: 'flow', radius: 5, label: '$checkout' },
    { id: 'f2', x: 75, y: 45, type: 'flow', radius: 4 },
    { id: 'f3', x: 30, y: 70, type: 'flow', radius: 4 },

    // Gate nodes
    { id: 'g1', x: 20, y: 50, type: 'gate', radius: 4, label: '^authenticated' },
    { id: 'g2', x: 80, y: 30, type: 'gate', radius: 3 },

    // Signal nodes
    { id: 's1', x: 70, y: 70, type: 'signal', radius: 4, label: '!deployed' },
    { id: 's2', x: 35, y: 20, type: 'signal', radius: 3 },

    // Aspect nodes
    { id: 'a1', x: 85, y: 60, type: 'aspect', radius: 3, label: '~audit' },
    { id: 'a2', x: 15, y: 65, type: 'aspect', radius: 3 },

    // Peripheral
    { id: 'p1', x: 10, y: 25, type: 'component', radius: 3 },
    { id: 'p2', x: 90, y: 75, type: 'component', radius: 3 },
    { id: 'p3', x: 55, y: 15, type: 'flow', radius: 3 },
    { id: 'p4', x: 42, y: 80, type: 'signal', radius: 3 },
  ];

  const edges: Edge[] = [
    // Core connections
    { from: 'c1', to: 'c2' }, { from: 'c1', to: 'c3' },
    { from: 'c1', to: 'c4' }, { from: 'c1', to: 'c5' },
    { from: 'c2', to: 'c5' },
    // Flow connections
    { from: 'f1', to: 'c2' }, { from: 'f1', to: 'g1' },
    { from: 'f2', to: 'c3' }, { from: 'f3', to: 'c5' },
    // Gate connections
    { from: 'g1', to: 'c1' }, { from: 'g2', to: 'f2' },
    // Signal connections
    { from: 'c3', to: 's1' }, { from: 'c4', to: 's2' },
    // Aspect connections (dashed)
    { from: 'a1', to: 's1' }, { from: 'a2', to: 'g1' },
    // Peripheral
    { from: 'p1', to: 'f1' }, { from: 'p2', to: 'a1' },
    { from: 'p3', to: 'c4' }, { from: 'p4', to: 'f3' },
    { from: 's2', to: 'f1' },
  ];

  return { nodes, edges };
}

export function NodeGraph({
  className,
  animated = true,
  interactive = false,
}: NodeGraphProps) {
  const prefersReducedMotion = useReducedMotion();
  const shouldAnimate = animated && !prefersReducedMotion;
  const { nodes, edges } = useMemo(generateHeroNodes, []);

  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>();
    nodes.forEach(n => map.set(n.id, n));
    return map;
  }, [nodes]);

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        className={styles.svg}
      >
        <defs>
          {/* Glow filters for each symbol type */}
          {Object.entries(GLOW_COLORS).map(([type, color]) => (
            <filter key={type} id={`glow-${type}`}>
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
        </defs>

        {/* Edges */}
        <g className={styles.edges}>
          {edges.map(({ from, to }, i) => {
            const source = nodeMap.get(from)!;
            const target = nodeMap.get(to)!;
            const isAspect = source.type === 'aspect' || target.type === 'aspect';

            return (
              <motion.line
                key={`${from}-${to}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="var(--surface-steel)"
                strokeWidth="0.3"
                strokeDasharray={isAspect ? '1 1' : undefined}
                opacity={0.4}
                initial={shouldAnimate ? { pathLength: 0, opacity: 0 } : undefined}
                animate={shouldAnimate ? { pathLength: 1, opacity: 0.4 } : undefined}
                transition={shouldAnimate ? { delay: 0.5 + i * 0.05, duration: 0.4 } : undefined}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g className={styles.nodes}>
          {nodes.map((node, i) => (
            <motion.g
              key={node.id}
              initial={shouldAnimate ? { scale: 0, opacity: 0 } : undefined}
              animate={shouldAnimate ? { scale: 1, opacity: 1 } : undefined}
              transition={shouldAnimate ? {
                delay: i * 0.06,
                duration: 0.5,
                type: 'spring',
                stiffness: 200,
                damping: 15,
              } : undefined}
            >
              <NodeShape
                node={node}
                interactive={interactive}
                shouldAnimate={shouldAnimate}
              />
            </motion.g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function NodeShape({
  node,
  interactive,
  shouldAnimate,
}: {
  node: Node;
  interactive: boolean;
  shouldAnimate: boolean;
}) {
  const color = SYMBOL_COLORS[node.type];
  const r = node.radius * 0.12; // Scale to viewBox

  const pulseAnimation = shouldAnimate ? {
    scale: [1, 1.15, 1],
    transition: {
      repeat: Infinity,
      duration: 3 + Math.random() * 2,
      delay: Math.random() * 3,
      ease: 'easeInOut',
    },
  } : undefined;

  switch (NODE_SHAPES[node.type]) {
    case 'circle':
      return (
        <motion.circle
          cx={node.x}
          cy={node.y}
          r={r}
          fill={color}
          filter={`url(#glow-${node.type})`}
          className={interactive ? styles.interactive : undefined}
          animate={pulseAnimation}
        />
      );
    case 'diamond':
      return (
        <motion.rect
          x={node.x - r}
          y={node.y - r}
          width={r * 2}
          height={r * 2}
          fill={color}
          transform={`rotate(45 ${node.x} ${node.y})`}
          filter={`url(#glow-${node.type})`}
          className={interactive ? styles.interactive : undefined}
          animate={pulseAnimation}
        />
      );
    case 'square':
      return (
        <motion.rect
          x={node.x - r * 0.85}
          y={node.y - r * 0.85}
          width={r * 1.7}
          height={r * 1.7}
          fill={color}
          filter={`url(#glow-${node.type})`}
          className={interactive ? styles.interactive : undefined}
          animate={pulseAnimation}
        />
      );
    case 'triangle': {
      const h = r * 1.2;
      const points = `${node.x},${node.y - h} ${node.x - h},${node.y + h * 0.6} ${node.x + h},${node.y + h * 0.6}`;
      return (
        <motion.polygon
          points={points}
          fill={color}
          filter={`url(#glow-${node.type})`}
          className={interactive ? styles.interactive : undefined}
          animate={pulseAnimation}
        />
      );
    }
    case 'hollowDiamond':
      return (
        <motion.rect
          x={node.x - r}
          y={node.y - r}
          width={r * 2}
          height={r * 2}
          fill="none"
          stroke={color}
          strokeWidth="0.2"
          transform={`rotate(45 ${node.x} ${node.y})`}
          filter={`url(#glow-${node.type})`}
          className={interactive ? styles.interactive : undefined}
          animate={pulseAnimation}
        />
      );
  }
}

export default NodeGraph;
