'use client';

import { motion } from 'framer-motion';
import { CodeBlock } from '@/components/CodeBlock';
import styles from './HowItWorksSection.module.css';

const STEPS = [
  {
    number: '01',
    title: 'Initialize',
    description: 'One command adds a .paradigm/ directory to your project with a config file and navigator.',
    code: `$ paradigm shift

✓ Created .paradigm/config.yaml
✓ Created .paradigm/navigator.yaml
✓ Scanned 47 source directories
✓ Ready — run \`paradigm scan\` to index`,
  },
  {
    number: '02',
    title: 'Describe',
    description: 'Add .purpose files to your directories. They tell agents what each part of your codebase does.',
    code: `# src/auth/.purpose
components:
  AuthMiddleware:
    description: JWT validation and session management
    type: middleware
    tags: [security, critical]

gates:
  authenticated:
    description: Requires valid JWT token
    check: req.headers.authorization

signals:
  !login-success:
    description: Emitted after successful authentication`,
  },
  {
    number: '03',
    title: 'Connect',
    description: 'Agents use Paradigm MCP tools to navigate, check impact, and validate changes before writing code.',
    code: `// Agent workflow (automatic via MCP)
paradigm_navigate({ intent: "context", task: "add OAuth" })
→ Found: #AuthMiddleware, ^authenticated, $login-flow

paradigm_ripple({ symbol: "#AuthMiddleware" })
→ Affects: 12 components, 3 flows, 2 gates

paradigm_gates_for_route({ route: "POST /api/oauth" })
→ Suggested: [^authenticated, ^oauth-configured]`,
  },
];

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
            Three steps from zero context to full AI awareness.
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
