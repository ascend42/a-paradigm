import type { Metadata } from 'next';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Agent Registry',
  description: 'Browse, discover, and install specialized AI agents built with Paradigm.',
};

// Placeholder agents — will be replaced with DB-backed ISR
const FEATURED_AGENTS = [
  {
    id: 'paradigm-reviewer',
    name: 'Paradigm Reviewer',
    description: 'Two-stage code review: spec compliance then code quality. Uses .purpose files for context.',
    author: 'paradigm',
    downloads: 1200,
    tags: ['review', 'quality'],
  },
  {
    id: 'paradigm-tester',
    name: 'Paradigm Tester',
    description: 'Writes and runs tests based on .purpose specifications. Validates gate implementations.',
    author: 'paradigm',
    downloads: 890,
    tags: ['testing', 'validation'],
  },
  {
    id: 'paradigm-architect',
    name: 'Paradigm Architect',
    description: 'Designs implementation plans for multi-file features. Reads .purpose files for architecture context.',
    author: 'paradigm',
    downloads: 750,
    tags: ['planning', 'architecture'],
  },
  {
    id: 'paradigm-security',
    name: 'Paradigm Security',
    description: 'Authorization, authentication, input validation analysis. Reads portal.yaml for gate verification.',
    author: 'paradigm',
    downloads: 620,
    tags: ['security', 'auth'],
  },
];

export default function AgentsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>The Armory</h1>
        <p className={styles.subtitle}>
          Specialized AI agents built for context-aware development.
        </p>
        <div className={styles.searchBar}>
          <input
            type="search"
            placeholder="Search agents..."
            className={styles.searchInput}
            disabled
          />
        </div>
      </header>

      <section className={styles.featured}>
        <h2 className={styles.sectionTitle}>Featured Agents</h2>
        <div className={styles.grid}>
          {FEATURED_AGENTS.map((agent) => (
            <div key={agent.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.agentName}>{agent.name}</h3>
                <span className={styles.author}>by {agent.author}</span>
              </div>
              <p className={styles.agentDescription}>{agent.description}</p>
              <div className={styles.cardFooter}>
                <div className={styles.tags}>
                  {agent.tags.map((tag) => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                </div>
                <span className={styles.downloads}>
                  {agent.downloads.toLocaleString()} installs
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
