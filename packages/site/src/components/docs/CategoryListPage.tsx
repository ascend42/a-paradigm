import Link from 'next/link';
import type { SymbolEntry, SymbolCategory } from '@/lib/docs-data';
import { SymbolBadge } from '@/components/SymbolBadge';
import styles from './CategoryListPage.module.css';

const CATEGORY_META: Record<SymbolCategory, {
  title: string;
  prefix: string;
  symType: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
  description: string;
}> = {
  components: {
    title: 'Components',
    prefix: '#',
    symType: 'component',
    description: 'Code units — services, views, commands, utilities, stores, and more.',
  },
  flows: {
    title: 'Flows',
    prefix: '$',
    symType: 'flow',
    description: 'Multi-step processes that span multiple components.',
  },
  gates: {
    title: 'Gates',
    prefix: '^',
    symType: 'gate',
    description: 'Authorization checkpoints that enforce access control.',
  },
  signals: {
    title: 'Signals',
    prefix: '!',
    symType: 'signal',
    description: 'Events emitted by components, consumed by other parts of the system.',
  },
  aspects: {
    title: 'Aspects',
    prefix: '~',
    symType: 'aspect',
    description: 'Cross-cutting concerns anchored to specific code locations.',
  },
};

interface CategoryListPageProps {
  category: SymbolCategory;
  entries: SymbolEntry[];
}

export function CategoryListPage({ category, entries }: CategoryListPageProps) {
  const meta = CATEGORY_META[category];

  return (
    <article className={styles.article}>
      <div className={styles.header}>
        <h1 className={styles.title}>{meta.title}</h1>
        <span className={styles.count}>{entries.length}</span>
      </div>
      <p className={styles.description}>{meta.description}</p>

      <div className={styles.grid}>
        {entries.map(entry => (
          <Link
            key={entry.id}
            href={`/docs/${category}/${entry.id}`}
            className={styles.card}
          >
            <div className={styles.cardHeader}>
              <SymbolBadge type={meta.symType} name={entry.id} size="sm" />
            </div>
            <p className={styles.cardDescription}>{entry.description || 'No description'}</p>
            {(entry.related?.length ?? 0) > 0 && (
              <span className={styles.cardRelated}>
                {entry.related.length} related
              </span>
            )}
          </Link>
        ))}
      </div>
    </article>
  );
}
