'use client';

import { motion } from 'framer-motion';
import styles from './MetricsSection.module.css';

const METRICS = [
  // Every figure here is counted from the repository. Sources:
  //  5   symbol kinds: # component, $ flow, ^ gate, ! signal, ~ aspect.
  //  32  default tools/list size and its ~7,800-token estimate (JSON length / 4),
  //  40  and the ceiling a test enforces (40 tools, 8,000 tokens):
  //      packages/paradigm-mcp/src/tools/tools-list-budget.test.ts
  //  68  ls packages/paradigm/templates/agents/*.agent | wc -l
  // Do not add a figure that has no command or test behind it.
  { value: '5', label: 'Symbols', detail: 'Components, flows, gates, signals, aspects' },
  { value: '32', label: 'MCP tools', detail: 'Listed by default, about 7,800 tokens' },
  { value: '40', label: 'Tool ceiling', detail: 'A test fails the build past 40 tools or 8,000 tokens' },
  { value: '68', label: 'Agent profiles', detail: 'Bundled with the CLI' },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
};

const item = {
  hidden: { opacity: 0, scale: 0.95 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export function MetricsSection() {
  return (
    <section className={styles.section}>
      <motion.div
        className={styles.grid}
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
      >
        {METRICS.map((metric) => (
          <motion.div key={metric.label} className={styles.card} variants={item}>
            <span className={styles.value}>{metric.value}</span>
            <span className={styles.label}>{metric.label}</span>
            <span className={styles.detail}>{metric.detail}</span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
