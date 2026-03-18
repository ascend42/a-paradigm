import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'PLSAT — Paradigm Licensure Standardized Assessment Test',
  description:
    '99 randomized questions from the PARA 101-501 curriculum. 90 minutes. 80% to pass. Demonstrate your mastery of context engineering.',
};

export default function PlsatPage() {
  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href="/learn">University</Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
        <span>PLSAT</span>
      </nav>

      <header className={styles.header}>
        <div className={styles.seal}>
          <PlsatSeal />
        </div>
        <h1 className={styles.title}>PLSAT</h1>
        <p className={styles.subtitle}>Paradigm Licensure Standardized Assessment Test</p>
        <p className={styles.tagline}>
          99 randomized questions. 90 minutes. 80% to pass.
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What Is the PLSAT?</h2>
        <p className={styles.text}>
          The PLSAT is the certification exam for Paradigm practitioners. It tests your
          understanding of the entire PARA curriculum -- from foundational concepts like
          the five symbols and .purpose files to advanced topics like aspect graph internals,
          symphony networking, and automated review pipelines.
        </p>
        <p className={styles.text}>
          Questions are drawn from a bank of 112 scenario-based items across all five
          PARA courses. Each exam session randomly selects 99 questions, so no two
          attempts are identical.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What It Covers</h2>
        <div className={styles.coverageGrid}>
          <CoverageCard
            course="PARA 101"
            title="Foundations"
            topics="Symbols, .purpose files, tags, logger, portal.yaml, project structure"
          />
          <CoverageCard
            course="PARA 201"
            title="Intermediate"
            topics="Flows, gates, aspects, anchors, disciplines, signal patterns"
          />
          <CoverageCard
            course="PARA 301"
            title="Advanced"
            topics="History, fragility, wisdom, ripple analysis, navigation, protocols"
          />
          <CoverageCard
            course="PARA 401"
            title="Operational"
            topics="MCP tools, multi-agent coordination, orchestration, PM governance"
          />
          <CoverageCard
            course="PARA 501"
            title="Advanced Systems"
            topics="Lore, Sentinel, session intelligence, hook enforcement, symphony"
          />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Exam Details</h2>
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statValue}>99</span>
            <span className={styles.statLabel}>Questions</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>90</span>
            <span className={styles.statLabel}>Minutes</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>80%</span>
            <span className={styles.statLabel}>Pass Threshold</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>5</span>
            <span className={styles.statLabel}>Choices per Question</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How to Prepare</h2>
        <ol className={styles.prepList}>
          <li className={styles.prepItem}>
            <span className={styles.prepNumber}>1</span>
            <div>
              <strong>Complete the PARA courses.</strong> Work through PARA 101 through 501.
              Each lesson includes review questions that mirror PLSAT format.
            </div>
          </li>
          <li className={styles.prepItem}>
            <span className={styles.prepNumber}>2</span>
            <div>
              <strong>Practice with lesson quizzes.</strong> Every lesson ends with
              comprehension questions. Use them as flashcards.
            </div>
          </li>
          <li className={styles.prepItem}>
            <span className={styles.prepNumber}>3</span>
            <div>
              <strong>Review reference cards.</strong> The University platform includes
              reference cards for each PARA course that summarize key concepts.
            </div>
          </li>
          <li className={styles.prepItem}>
            <span className={styles.prepNumber}>4</span>
            <div>
              <strong>Build a real project.</strong> Nothing beats hands-on experience.
              Create a project with Paradigm, write .purpose files, define flows, and
              use the MCP tools.
            </div>
          </li>
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How to Take the PLSAT</h2>
        <p className={styles.text}>
          The PLSAT runs in the Paradigm University platform, a local web application
          served by the Paradigm CLI. The exam is timed and auto-graded. On passing, a
          diploma record is saved to your project&apos;s university directory.
        </p>
        <div className={styles.codeCard}>
          <div className={styles.codeHeader}>
            <span className={styles.codeLabel}>Terminal</span>
          </div>
          <pre className={styles.pre}>
            <code>{`# Interactive terminal quiz\nparadigm university quiz plsat\n\n# Or launch the full University platform\nparadigm university serve`}</code>
          </pre>
        </div>
      </section>

      <div className={styles.cta}>
        <Link href="/learn" className={styles.ctaSecondary}>
          &larr; Browse Courses
        </Link>
        <div className={styles.ctaPrimary}>
          <span className={styles.ctaLabel}>Ready to certify?</span>
          <code className={styles.ctaCode}>paradigm university serve</code>
        </div>
      </div>
    </div>
  );
}

function CoverageCard({
  course,
  title,
  topics,
}: {
  course: string;
  title: string;
  topics: string;
}) {
  return (
    <div className={styles.coverageCard}>
      <span className={styles.courseLabel}>{course}</span>
      <h3 className={styles.courseTitle}>{title}</h3>
      <p className={styles.courseTopics}>{topics}</p>
    </div>
  );
}

function PlsatSeal() {
  return (
    <svg width="100" height="100" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="95" fill="none" stroke="var(--gold, var(--sym-signal))" strokeWidth="2.5" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="var(--gold, var(--sym-signal))" strokeWidth="1" />
      <circle cx="100" cy="100" r="82" fill="none" stroke="var(--gold, var(--sym-signal))" strokeWidth="0.5" opacity="0.5" />
      {/* Five symbol dots in arc */}
      <circle cx="70" cy="70" r="5" fill="var(--sym-component)" />
      <circle cx="85" cy="62" r="5" fill="var(--sym-flow)" />
      <circle cx="100" cy="58" r="5" fill="var(--sym-gate)" />
      <circle cx="115" cy="62" r="5" fill="var(--sym-signal)" />
      <circle cx="130" cy="70" r="5" fill="var(--sym-aspect)" />
      {/* Shield / scroll icon */}
      <path
        d="M85 85 L100 80 L115 85 L115 120 C115 128 100 135 100 135 C100 135 85 128 85 120 Z"
        fill="none"
        stroke="var(--burgundy, var(--sym-gate))"
        strokeWidth="2"
      />
      {/* Check mark inside shield */}
      <path
        d="M93 105 L98 112 L108 98"
        fill="none"
        stroke="var(--gold, var(--sym-signal))"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
