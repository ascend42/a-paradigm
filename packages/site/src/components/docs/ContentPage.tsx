import type { ContentPage as ContentPageData } from '@/lib/docs-data';
import styles from './ContentPage.module.css';

interface ContentPageProps {
  page: ContentPageData;
}

/**
 * Renders a handwritten markdown content page.
 * Parses markdown to HTML-like React elements without a heavy MDX dependency.
 */
export function ContentPage({ page }: ContentPageProps) {
  const sections = parseMarkdownToSections(page.body);

  return (
    <article className={styles.article}>
      <h1 className={styles.title}>{page.title}</h1>
      {page.description && (
        <p className={styles.description}>{page.description}</p>
      )}
      <div className={styles.body}>
        {sections.map((section, i) => (
          <MarkdownSection key={i} section={section} />
        ))}
      </div>
    </article>
  );
}

/* ── Markdown Parser ─────────────────────────────────────────────────────── */

type SectionNode =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'list'; items: string[] }
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

    // List item
    if (line.match(/^[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      sections.push({ type: 'list', items });
      continue;
    }

    // Paragraph (non-empty lines)
    if (line.trim()) {
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() && !lines[i].match(/^#{1,4}\s/) && !lines[i].startsWith('```') && !lines[i].match(/^[-*]\s+/)) {
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
      const cls = section.level === 2 ? styles.h2 : section.level === 3 ? styles.h3 : styles.h4;
      return <Tag className={cls}>{section.text}</Tag>;
    }

    case 'paragraph':
      return <p className={styles.paragraph}><InlineMarkdown text={section.text} /></p>;

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

    case 'list':
      return (
        <ul className={styles.list}>
          {section.items.map((item, i) => (
            <li key={i} className={styles.listItem}><InlineMarkdown text={item} /></li>
          ))}
        </ul>
      );

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

/** Renders inline markdown: `code`, **bold**, [links](url), and symbol references. */
function InlineMarkdown({ text }: { text: string }) {
  // Split by inline patterns
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/);

  return (
    <>
      {parts.map((part, i) => {
        // Inline code
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className={styles.inlineCode}>{part.slice(1, -1)}</code>;
        }
        // Bold
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        // Link
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return <a key={i} href={linkMatch[2]} className={styles.link}>{linkMatch[1]}</a>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
