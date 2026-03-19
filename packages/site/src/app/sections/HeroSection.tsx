'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { LiveGraph, SCENARIOS } from '@/components/NodeGraph/LiveGraph';
import type { ScenarioPhase } from '@/components/NodeGraph/LiveGraph';
import { FauxTerminal } from '@/components/NodeGraph/FauxTerminal';
import styles from './HeroSection.module.css';

const EASE = [0.16, 1, 0.3, 1] as const;
const TERMINAL_LINES = SCENARIOS.map(s => s.terminalLines);

export function HeroSection() {
  const scenarioRef = useRef({ phase: 'growing' as ScenarioPhase, progress: 0, scenarioIndex: 0 });

  return (
    <section className={styles.hero}>
      <div className={styles.graph}>
        <LiveGraph
          onPhaseChange={(phase, progress, scenarioIndex) => {
            scenarioRef.current = { phase, progress, scenarioIndex };
          }}
        />
      </div>

      <FauxTerminal scenarioRef={scenarioRef} terminalLines={TERMINAL_LINES} />

      <div className={styles.content}>
        <motion.p
          className={styles.eyebrow}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          The Context Engineering Framework
        </motion.p>

        <motion.h1
          className={styles.headline}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
        >
          Structure your codebase so{' '}
          <span className={styles.gradient}>AI&nbsp;agents understand&nbsp;it</span>
        </motion.h1>

        <motion.p
          className={styles.subtitle}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
        >
          Five symbols. Structured context. AI&nbsp;agents that actually know
          your codebase. Paradigm turns your project into a&nbsp;living map
          that every tool can&nbsp;read.
        </motion.p>

        <motion.div
          className={styles.actions}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
        >
          <Link href="/docs/getting-started" className={styles.primaryCta}>
            Get Started
          </Link>
          <a
            href="https://github.com/ascend42/a-paradigm"
            className={styles.secondaryCta}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </motion.div>

        <motion.div
          className={styles.install}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <code className={styles.installCode}>
            npm install -g @a-company/paradigm
          </code>
        </motion.div>
      </div>
    </section>
  );
}
