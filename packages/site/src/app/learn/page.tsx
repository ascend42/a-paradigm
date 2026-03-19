import Link from 'next/link';
import { UniversitySeal } from '@/components/UniversitySeal';
import styles from './page.module.css';

const COURSES = [
  {
    id: 'para-101',
    title: 'PARA 101: Foundations',
    description: 'Core concepts, symbol system, .purpose files, and project setup.',
    lessons: 9,
    difficulty: 'Beginner',
    tags: ['paradigm', 'core'],
  },
  {
    id: 'para-201',
    title: 'PARA 201: Intermediate',
    description: 'Flows, gates, signals, and navigation. Building connected systems.',
    lessons: 11,
    difficulty: 'Intermediate',
    tags: ['paradigm', 'symbols'],
  },
  {
    id: 'para-301',
    title: 'PARA 301: Advanced',
    description: 'Aspects, ripple analysis, wisdom system, and multi-agent orchestration.',
    lessons: 11,
    difficulty: 'Advanced',
    tags: ['paradigm', 'advanced'],
  },
  {
    id: 'para-401',
    title: 'PARA 401: Operational',
    description: 'Sentinel observability, deployment, CI/CD integration, and production workflows.',
    lessons: 11,
    difficulty: 'Advanced',
    tags: ['paradigm', 'operations'],
  },
  {
    id: 'para-501',
    title: 'PARA 501: Advanced Systems',
    description: 'Lore system, session intelligence, hook enforcement, and platform mastery.',
    lessons: 14,
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
          <UniversitySeal size={80} />
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
            <h3>Paradigm Licensure Standardized Assessment Test</h3>
            <p>
              Demonstrate your mastery of context engineering. 99 randomized questions
              from the PARA 101-501 curriculum. 90 minutes. 90% to pass.
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

