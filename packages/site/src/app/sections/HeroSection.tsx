'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { NodeGraph } from '@/components/NodeGraph';
import styles from './HeroSection.module.css';

const EASE = [0.16, 1, 0.3, 1] as const;

export function HeroSection() {
  return (
    <section className={styles.hero}>
      <NodeGraph className={styles.graph} animated interactive={false} />

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
          Structure your codebase{' '}
          <span className={styles.gradient}>so AI agents understand it</span>
        </motion.h1>

        <motion.p
          className={styles.subtitle}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
        >
          Five symbols. Structured context. AI agents that actually know your codebase.
          Paradigm turns your project into a living map that every tool can read.
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
