'use client';

import { motion } from 'framer-motion';
import { CodeBlock } from '@/components/CodeBlock';
import styles from './HowItWorksSection.module.css';

const STEPS = [
  {
    number: '01',
    title: 'Initialize',
    description: 'One command adds a .paradigm/ directory to your project, with a config file and a navigator, and writes the instruction files and hooks your agents read.',
    code: `# Example run, 2026-11-23, in a new sample project (excerpt)
$ paradigm shift
  ...
  Created/Updated:
  ✓ .paradigm/config.yaml       Project configuration
  ✓ .paradigm/navigator.yaml    Symbol navigation map
  ✓ .paradigm/agents.yaml       Team agent configuration
  ✓ .purpose                    Root feature definitions
  ✓ portal.yaml                 Authorization gates
  ✓ CLAUDE.md                   Claude Code AI instructions
  ✓ AGENTS.md                   Universal AI agent instructions
  ✓ .claude/hooks/              Claude Code enforcement hooks`,
  },
  {
    number: '02',
    title: 'Describe',
    description: 'Add .purpose files to your directories. Each one declares the components, gates, signals and flows that live there. This is one of the two files in the sample project.',
    code: `# src/auth/.purpose
description: Authentication for the demo app

components:
  auth-middleware:
    description: Validates the session token on every request
    type: middleware
    tags: [security, critical]

gates:
  authenticated:
    description: Requires a valid session token

signals:
  login-success:
    description: Emitted after a successful login

flows:
  login-flow:
    description: Sign a user in
    components: ['#auth-middleware']
    signals: ['!login-success']`,
  },
  {
    number: '03',
    title: 'Connect',
    description: 'A script builds the symbol index from those files. Ask it what a change would touch before you make it. Agents ask the same questions through the MCP server, with tools such as paradigm_ripple and paradigm_navigate.',
    code: `# Example run, 2026-11-23, same sample project (excerpts).
# The second file, src/checkout/.purpose, declares
# #pay-handler and $checkout-flow.
$ paradigm reindex
✓ Symbol index rebuilt: 6 symbols
  Symbols: 2 component, 1 gate, 2 flow, 1 signal

$ paradigm ripple "#auth-middleware"
  ...
⬇️  Downstream (What would be affected)
  Components:  #pay-handler
  Other:       $login-flow, $checkout-flow
  ...
  Direct dependents: 3`,
  },
];

// The code blocks above are real. Steps 01 and 03 are excerpts of output
// captured on 2026-11-23 from a sample project holding the step 02 file and a
// second .purpose file; "..." marks lines left out. Step 02 passes
// \`paradigm lint\`. If you change one, re-run the commands and paste what they
// print; do not write output by hand.

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

export function HowItWorksSection() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <h2 className={styles.heading}>How it works</h2>
          <p className={styles.subheading}>
            Three steps: set up, describe, query.
          </p>
        </div>

        <div className={styles.steps}>
          {STEPS.map((step, i) => (
            <motion.div
              key={step.number}
              className={styles.step}
              variants={item}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: '-80px' }}
            >
              <div className={styles.stepText}>
                <span className={styles.stepNumber}>{step.number}</span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepDescription}>{step.description}</p>
              </div>
              <div className={styles.stepCode}>
                <CodeBlock
                  code={step.code}
                  language={i === 1 ? 'yaml' : 'bash'}
                  highlightSymbols
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
