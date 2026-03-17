import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Updates, tutorials, and deep dives on context engineering and AI-native development.',
};

// Placeholder — will be replaced with MDX content loading
const POSTS = [
  {
    slug: 'introducing-paradigm-4',
    title: 'Introducing Paradigm 4.0: The Context Engineering Framework',
    excerpt: 'Five symbols. Structured context. AI agents that actually know your codebase. Paradigm 4.0 is the biggest release yet.',
    date: '2026-03-16',
    tags: ['release', 'announcement'],
  },
  {
    slug: 'what-is-context-engineering',
    title: 'What is Context Engineering?',
    excerpt: 'Context engineering is the discipline of structuring information so AI systems can effectively use it. Here is why it matters.',
    date: '2026-03-10',
    tags: ['philosophy', 'tutorial'],
  },
];

export default function BlogPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>The Voice</h1>
        <p className={styles.subtitle}>
          Updates, tutorials, and deep dives on context engineering.
        </p>
      </header>

      <div className={styles.posts}>
        {POSTS.map((post) => (
          <article key={post.slug} className={styles.postCard}>
            <time className={styles.date}>{post.date}</time>
            <h2 className={styles.postTitle}>
              <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            </h2>
            <p className={styles.excerpt}>{post.excerpt}</p>
            <div className={styles.tags}>
              {post.tags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
