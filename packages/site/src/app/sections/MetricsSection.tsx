'use client';

import { motion } from 'framer-motion';
import styles from './MetricsSection.module.css';

const METRICS = [
  { value: '5', label: 'Symbols', detail: 'Cover every concept' },
  { value: '100+', label: 'MCP Tools', detail: 'For AI agents' },
  { value: '90%', label: 'Less context', detail: 'Tokens saved vs file reads' },
  { value: '<1min', label: 'Setup time', detail: 'paradigm shift' },
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
