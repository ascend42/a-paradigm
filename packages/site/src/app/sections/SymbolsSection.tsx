'use client';

import { motion } from 'framer-motion';
import { SymbolBadge } from '@/components/SymbolBadge';
import styles from './SymbolsSection.module.css';

const SYMBOLS = [
  {
    type: 'component' as const,
    prefix: '#',
    shape: '●',
    name: 'Component',
    description: 'The building blocks. Services, views, utilities, models. Every named piece of your system.',
    example: '#auth-middleware',
    color: 'var(--sym-component)',
  },
  {
    type: 'flow' as const,
    prefix: '$',
    shape: '◆',
    name: 'Flow',
    description: 'Multi-step processes that span components. Checkout, onboarding, deployment pipelines.',
    example: '$checkout-flow',
    color: 'var(--sym-flow)',
  },
  {
    type: 'gate' as const,
    prefix: '^',
    shape: '■',
    name: 'Gate',
    description: 'Authorization checkpoints. Who can do what. Authentication, roles, ownership.',
    example: '^authenticated',
    color: 'var(--sym-gate)',
  },
  {
    type: 'signal' as const,
    prefix: '!',
    shape: '▲',
    name: 'Signal',
    description: 'Events that ripple through the system. Notifications, webhooks, side effects.',
    example: '!payment-complete',
    color: 'var(--sym-signal)',
  },
  {
    type: 'aspect' as const,
    prefix: '~',
    shape: '◇',
    name: 'Aspect',
    description: 'Cross-cutting concerns anchored to code. Audit trails, logging policies, compliance.',
    example: '~audit-required',
    color: 'var(--sym-aspect)',
  },
] as const;

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export function SymbolsSection() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Five symbols. That's it.</h2>
          <p className={styles.subheading}>
            Every concept in your codebase maps to one of five symbols.
            Agents use them to navigate, reason, and make changes with full context.
          </p>
        </div>

        <motion.div
          className={styles.grid}
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-100px' }}
        >
          {SYMBOLS.map((sym) => (
            <motion.div
              key={sym.type}
              className={styles.card}
              variants={item}
            >
              <div className={styles.symbolHeader}>
                <span
                  className={styles.shape}
                  style={{ color: sym.color }}
                >
                  {sym.shape}
                </span>
                <span className={styles.prefix} style={{ color: sym.color }}>
                  {sym.prefix}
                </span>
                <span className={styles.symbolName}>{sym.name}</span>
              </div>
              <p className={styles.description}>{sym.description}</p>
              <div className={styles.example}>
                <SymbolBadge type={sym.type} name={sym.example.slice(1)} />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
