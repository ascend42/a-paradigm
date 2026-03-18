import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAllCourseIds, getCourseManifest } from '@/lib/course-data';
import styles from './page.module.css';

export async function generateStaticParams() {
  return getAllCourseIds().map(id => ({ courseId: id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string }>;
}): Promise<Metadata> {
  const { courseId } = await params;
  const manifest = getCourseManifest(courseId);
  if (!manifest) return { title: 'Course Not Found' };

  return {
    title: manifest.title,
    description: manifest.description,
  };
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const manifest = getCourseManifest(courseId);
  if (!manifest) notFound();

  const isCore = manifest.category !== 'extracurricular';

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href="/learn">University</Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
        <span>{manifest.title}</span>
      </nav>

      <header className={styles.header}>
        <div className={styles.meta}>
          {isCore ? (
            <span className={styles.badge} data-variant="core">Core Curriculum</span>
          ) : (
            <span className={styles.badge} data-variant="extra">Extracurricular</span>
          )}
          <span className={styles.lessonCount}>{manifest.lessons.length} lessons</span>
        </div>
        <h1 className={styles.title}>{manifest.title}</h1>
        <p className={styles.description}>{manifest.description}</p>
      </header>

      <section className={styles.syllabus}>
        <h2 className={styles.syllabusTitle}>Syllabus</h2>
        <ol className={styles.lessonList}>
          {manifest.lessons.map((lesson, index) => (
            <li key={lesson.id} className={styles.lessonItem}>
              <Link
                href={`/learn/course/${courseId}/lesson/${lesson.id}`}
                className={styles.lessonLink}
              >
                <span className={styles.lessonNumber}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.lessonTitle}>{lesson.title}</span>
                <span className={styles.lessonArrow} aria-hidden="true">&rarr;</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <footer className={styles.footer}>
        <Link href="/learn" className={styles.backLink}>
          &larr; All Courses
        </Link>
      </footer>
    </div>
  );
}
