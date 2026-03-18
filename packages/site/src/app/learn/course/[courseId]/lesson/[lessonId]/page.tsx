import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAllLessonParams, getLesson } from '@/lib/course-data';
import styles from './page.module.css';

export async function generateStaticParams() {
  return getAllLessonParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
}): Promise<Metadata> {
  const { courseId, lessonId } = await params;
  const data = getLesson(courseId, lessonId);
  if (!data) return { title: 'Lesson Not Found' };

  return {
    title: `${data.lesson.title} | ${data.course.title}`,
    description: data.lesson.keyConcepts?.join('. ') || data.course.description,
  };
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
}) {
  const { courseId, lessonId } = await params;
  const data = getLesson(courseId, lessonId);
  if (!data) notFound();

  const { course, lesson, lessonIndex } = data;
  const prevLesson = lessonIndex > 0 ? course.lessons[lessonIndex - 1] : null;
  const nextLesson = lessonIndex < course.lessons.length - 1 ? course.lessons[lessonIndex + 1] : null;
  const sections = parseMarkdownToSections(lesson.content);

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href="/learn">University</Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
        <Link href={`/learn/course/${courseId}`}>{course.title}</Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
        <span>Lesson {lessonIndex + 1}</span>
      </nav>

      <article className={styles.article}>
        <header className={styles.header}>
          <span className={styles.lessonMeta}>
            Lesson {lessonIndex + 1} of {course.lessons.length}
          </span>
          <h1 className={styles.title}>{lesson.title}</h1>
        </header>

        {/* Lesson content */}
        <div className={styles.body}>
          {sections.map((section, i) => (
            <MarkdownSection key={i} section={section} />
          ))}
        </div>

        {/* Key concepts */}
        {lesson.keyConcepts && lesson.keyConcepts.length > 0 && (
          <section className={styles.concepts}>
            <h2 className={styles.conceptsTitle}>Key Concepts</h2>
            <ul className={styles.conceptList}>
              {lesson.keyConcepts.map((concept, i) => (
                <li key={i} className={styles.conceptItem}>{concept}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Quiz questions */}
        {lesson.quiz && lesson.quiz.length > 0 && (
          <section className={styles.quiz}>
            <h2 className={styles.quizTitle}>Check Your Understanding</h2>
            <p className={styles.quizIntro}>
              Review these questions to test your knowledge. For graded assessment,
              use the University platform.
            </p>
            <div className={styles.questions}>
              {lesson.quiz.map((q, i) => (
                <div key={q.id} className={styles.question}>
                  <p className={styles.questionText}>
                    <span className={styles.questionNumber}>{i + 1}.</span>{' '}
                    {q.question}
                  </p>
                  <ul className={styles.choices}>
                    {Object.entries(q.choices).map(([label, text]) => (
                      <li key={label} className={styles.choice}>
                        <span className={styles.choiceLabel}>{label}.</span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </article>

      {/* Navigation */}
      <nav className={styles.lessonNav} aria-label="Lesson navigation">
        <div className={styles.navPrev}>
          {prevLesson && (
            <Link
              href={`/learn/course/${courseId}/lesson/${prevLesson.id}`}
              className={styles.navLink}
            >
              <span className={styles.navDirection}>&larr; Previous</span>
              <span className={styles.navTitle}>{prevLesson.title}</span>
            </Link>
          )}
        </div>
        <div className={styles.navNext}>
          {nextLesson ? (
            <Link
              href={`/learn/course/${courseId}/lesson/${nextLesson.id}`}
              className={styles.navLink}
              data-direction="next"
            >
              <span className={styles.navDirection}>Next &rarr;</span>
              <span className={styles.navTitle}>{nextLesson.title}</span>
            </Link>
          ) : (
            <Link
              href={`/learn/course/${courseId}`}
              className={styles.navLink}
              data-direction="next"
            >
              <span className={styles.navDirection}>Complete &rarr;</span>
              <span className={styles.navTitle}>Back to {course.title}</span>
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}

/* ── Markdown Parser (reused from ContentPage pattern) ──────────────────── */

type SectionNode =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

function parseMarkdownToSections(md: string): SectionNode[] {
  const lines = md.split('\n');
  const sections: SectionNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      sections.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Fenced code block
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const lang = codeMatch[1] || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      sections.push({ type: 'code', language: lang, content: codeLines.join('\n') });
      i++; // skip closing ```
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|[\s-:|]+\|$/)) {
      const headers = line.split('|').map(c => c.trim()).filter(Boolean);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        const row = lines[i].split('|').map(c => c.trim()).filter(Boolean);
        rows.push(row);
        i++;
      }
      sections.push({ type: 'table', headers, rows });
      continue;
    }

    // Ordered list item
    if (line.match(/^\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      sections.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Unordered list item
    if (line.match(/^[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      sections.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Paragraph (non-empty lines)
    if (line.trim()) {
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].match(/^#{1,4}\s/) &&
        !lines[i].startsWith('```') &&
        !lines[i].match(/^[-*]\s+/) &&
        !lines[i].match(/^\d+\.\s+/)
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      sections.push({ type: 'paragraph', text: paraLines.join(' ') });
      continue;
    }

    i++;
  }

  return sections;
}

function MarkdownSection({ section }: { section: SectionNode }) {
  switch (section.type) {
    case 'heading': {
      const Tag = `h${section.level}` as keyof JSX.IntrinsicElements;
      const cls =
        section.level === 2
          ? styles.h2
          : section.level === 3
            ? styles.h3
            : styles.h4;
      return <Tag className={cls}>{section.text}</Tag>;
    }

    case 'paragraph':
      return (
        <p className={styles.paragraph}>
          <InlineMarkdown text={section.text} />
        </p>
      );

    case 'code': {
      const hasLang = section.language && section.language !== 'text';
      return (
        <div className={hasLang ? styles.codeBlock : undefined}>
          {hasLang && (
            <div className={styles.codeHeader}>
              <span className={styles.codeLanguage}>{section.language}</span>
            </div>
          )}
          <pre className={styles.pre}>
            <code>{section.content}</code>
          </pre>
        </div>
      );
    }

    case 'list': {
      const ListTag = section.ordered ? 'ol' : 'ul';
      return (
        <ListTag className={styles.list}>
          {section.items.map((item, i) => (
            <li key={i} className={styles.listItem}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ListTag>
      );
    }

    case 'table':
      return (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {section.headers.map((h, i) => (
                  <th key={i} className={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={styles.td}>
                      <InlineMarkdown text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Renders inline markdown: `code`, **bold**, *italic*, [links](url). */
function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/);

  return (
    <>
      {parts.map((part, i) => {
        // Inline code
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className={styles.inlineCode}>
              {part.slice(1, -1)}
            </code>
          );
        }
        // Bold
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        // Italic (single asterisk)
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        // Link
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a key={i} href={linkMatch[2]} className={styles.link}>
              {linkMatch[1]}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
