import Link from 'next/link';
import styles from './page.module.css';

const COURSES = [
  {
    id: 'para-101',
    title: 'PARA 101: Foundations',
    description: 'Core concepts, symbol system, .purpose files, and project setup.',
    lessons: 8,
    difficulty: 'Beginner',
    tags: ['paradigm', 'core'],
  },
  {
    id: 'para-201',
    title: 'PARA 201: Intermediate',
    description: 'Flows, gates, signals, and navigation. Building connected systems.',
    lessons: 8,
    difficulty: 'Intermediate',
    tags: ['paradigm', 'symbols'],
  },
  {
    id: 'para-301',
    title: 'PARA 301: Advanced',
    description: 'Aspects, ripple analysis, wisdom system, and multi-agent orchestration.',
    lessons: 8,
    difficulty: 'Advanced',
    tags: ['paradigm', 'advanced'],
  },
  {
    id: 'para-401',
    title: 'PARA 401: Operational',
    description: 'Sentinel observability, deployment, CI/CD integration, and production workflows.',
    lessons: 8,
    difficulty: 'Advanced',
    tags: ['paradigm', 'operations'],
  },
  {
    id: 'para-501',
    title: 'PARA 501: Advanced Systems',
    description: 'Lore system, session intelligence, hook enforcement, and platform mastery.',
    lessons: 8,
    difficulty: 'Expert',
    tags: ['paradigm', 'systems'],
  },
  {
    id: 'git-fundamentals',
    title: 'Git Fundamentals',
    description: 'Git for AI-native development. Branching, commits, recovery, and CI/CD.',
    lessons: 6,
    difficulty: 'Beginner',
    tags: ['git', 'fundamentals'],
    category: 'extracurricular',
  },
  {
    id: 'agile-development',
    title: 'Agile Development',
    description: 'Agile practices for AI-native teams. Stories, sprints, reviews, and multi-agent workflows.',
    lessons: 6,
    difficulty: 'Beginner',
    tags: ['agile', 'fundamentals'],
    category: 'extracurricular',
  },
];

export default function LearnPage() {
  const coreCourses = COURSES.filter((c) => c.category !== 'extracurricular');
  const extracurricularCourses = COURSES.filter((c) => c.category === 'extracurricular');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.seal}>
          <UniversitySeal />
        </div>
        <h1 className={styles.title}>Paradigm University</h1>
        <p className={styles.subtitle}>
          Master context engineering through structured courses, hands-on quizzes,
          and the PLSAT certification exam.
        </p>
      </header>

      <section className={styles.courses}>
        <h2 className={styles.sectionTitle}>Core Curriculum</h2>
        <div className={styles.grid}>
          {coreCourses.map((course) => (
            <Link
              key={course.id}
              href={`/learn/course/${course.id}`}
              className={styles.card}
            >
              <div className={styles.cardHeader}>
                <span className={styles.difficulty} data-level={course.difficulty.toLowerCase()}>
                  {course.difficulty}
                </span>
              </div>
              <h3 className={styles.cardTitle}>{course.title}</h3>
              <p className={styles.cardDescription}>{course.description}</p>
              <div className={styles.cardFooter}>
                <span>{course.lessons} lessons</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {extracurricularCourses.length > 0 && (
        <section className={styles.courses}>
          <h2 className={styles.sectionTitle}>Extracurricular</h2>
          <div className={styles.grid}>
            {extracurricularCourses.map((course) => (
              <Link
                key={course.id}
                href={`/learn/course/${course.id}`}
                className={styles.card}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.difficulty} data-level={course.difficulty.toLowerCase()}>
                    {course.difficulty}
                  </span>
                  <span className={styles.nonCredit}>Self-paced</span>
                </div>
                <h3 className={styles.cardTitle}>{course.title}</h3>
                <p className={styles.cardDescription}>{course.description}</p>
                <div className={styles.cardFooter}>
                  <span>{course.lessons} lessons</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className={styles.plsat}>
        <h2 className={styles.sectionTitle}>PLSAT Certification</h2>
        <div className={styles.plsatCard}>
          <div className={styles.plsatContent}>
            <h3>Paradigm Learning Standards Assessment Test</h3>
            <p>
              Demonstrate your mastery of context engineering. 50 randomized questions
              from the PARA 101-501 curriculum. 90 minutes. 70% to pass.
            </p>
            <Link href="/learn/plsat" className={styles.plsatCta}>
              Take the PLSAT
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function UniversitySeal() {
  return (
    <svg width="80" height="80" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="95" fill="none" stroke="var(--gold, var(--sym-signal))" strokeWidth="2" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="var(--gold, var(--sym-signal))" strokeWidth="1" />
      {/* Five symbol dots */}
      <circle cx="80" cy="80" r="4" fill="var(--sym-component)" />
      <circle cx="90" cy="80" r="4" fill="var(--sym-flow)" />
      <circle cx="100" cy="80" r="4" fill="var(--sym-gate)" />
      <circle cx="110" cy="80" r="4" fill="var(--sym-signal)" />
      <circle cx="120" cy="80" r="4" fill="var(--sym-aspect)" />
      {/* Book icon */}
      <path d="M85 95 L100 90 L115 95 L115 125 L100 120 L85 125 Z" fill="none" stroke="var(--burgundy, var(--sym-gate))" strokeWidth="2" />
      <line x1="100" y1="90" x2="100" y2="120" stroke="var(--burgundy, var(--sym-gate))" strokeWidth="1" />
    </svg>
  );
}
