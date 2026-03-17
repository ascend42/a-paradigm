import Link from 'next/link';
import type { SymbolEntry, FlowEntry, SymbolCategory } from '@/lib/docs-data';
import { SymbolBadge } from '@/components/SymbolBadge';
import styles from './SymbolPage.module.css';

const CATEGORY_PREFIX: Record<string, string> = {
  components: '#',
  flows: '$',
  gates: '^',
  signals: '!',
  aspects: '~',
};

const CATEGORY_TYPE: Record<string, 'component' | 'flow' | 'gate' | 'signal' | 'aspect'> = {
  components: 'component',
  flows: 'flow',
  gates: 'gate',
  signals: 'signal',
  aspects: 'aspect',
};

interface SymbolPageProps {
  entry: SymbolEntry;
  category: SymbolCategory;
  flow?: FlowEntry | null;
}

export function SymbolPage({ entry, category, flow }: SymbolPageProps) {
  const symType = CATEGORY_TYPE[category];
  const prefix = CATEGORY_PREFIX[category];

  // Parse related symbols into categorized groups
  const related = entry.related || [];
  const visualTags = entry.visualTags || [];
  const relatedGroups = groupRelated(related);

  return (
    <article className={styles.article}>
      {/* Header */}
      <div className={styles.header}>
        <SymbolBadge type={symType} name={entry.id} size="lg" />
        <h1 className={styles.title}>{entry.name}</h1>
      </div>

      <p className={styles.description}>{entry.description}</p>

      {/* Metadata row */}
      <div className={styles.meta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Category</span>
          <Link href={`/docs/${category}`} className={styles.metaValue}>
            {category}
          </Link>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Symbol</span>
          <code className={styles.metaCode}>{prefix}{entry.id}</code>
        </div>
        {visualTags.length > 0 && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Tags</span>
            <div className={styles.tags}>
              {visualTags.map(tag => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Flow steps visualization */}
      {flow && Array.isArray(flow.steps) && flow.steps.length > 0 && flow.steps.some(s => s.action && !/^Step \d+$/.test(s.action)) && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Flow Steps</h2>
          <div className={styles.flowSteps}>
            {flow.steps.map((step, i) => (
              <div key={step.id || i} className={styles.flowStep}>
                <div className={styles.stepNumber}>{i + 1}</div>
                <div className={styles.stepContent}>
                  <p className={styles.stepAction}>{step.action}</p>
                  {step.symbol && (
                    <SymbolRef symbol={step.symbol} />
                  )}
                </div>
                {i < flow.steps.length - 1 && (
                  <div className={styles.stepConnector} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Related symbols */}
      {related.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Related Symbols</h2>
          {relatedGroups.map(group => (
            <div key={group.label} className={styles.relatedGroup}>
              <h3 className={styles.relatedLabel}>{group.label}</h3>
              <div className={styles.relatedList}>
                {group.symbols.map(sym => (
                  <SymbolRef key={sym} symbol={sym} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Source */}
      {entry.path && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Defined In</h2>
          <code className={styles.sourcePath}>{formatPath(entry.path)}</code>
        </section>
      )}
    </article>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function SymbolRef({ symbol }: { symbol: string }) {
  const prefix = symbol.charAt(0);
  const name = symbol.slice(1);

  const prefixToCategory: Record<string, string> = {
    '#': 'components',
    '$': 'flows',
    '^': 'gates',
    '!': 'signals',
    '~': 'aspects',
  };

  const prefixToType: Record<string, 'component' | 'flow' | 'gate' | 'signal' | 'aspect'> = {
    '#': 'component',
    '$': 'flow',
    '^': 'gate',
    '!': 'signal',
    '~': 'aspect',
  };

  const cat = prefixToCategory[prefix];
  const symType = prefixToType[prefix];

  if (!cat || !symType) {
    return <code className={styles.metaCode}>{symbol}</code>;
  }

  return (
    <Link href={`/docs/${cat}/${name}`} className={styles.symbolRef}>
      <SymbolBadge type={symType} name={name} size="sm" />
    </Link>
  );
}

function groupRelated(related: string[]): Array<{ label: string; symbols: string[] }> {
  const groups: Record<string, string[]> = {
    Components: [],
    Flows: [],
    Gates: [],
    Signals: [],
    Aspects: [],
  };

  const prefixToGroup: Record<string, string> = {
    '#': 'Components',
    '$': 'Flows',
    '^': 'Gates',
    '!': 'Signals',
    '~': 'Aspects',
  };

  for (const sym of related) {
    const group = prefixToGroup[sym.charAt(0)];
    if (group) {
      groups[group].push(sym);
    }
  }

  return Object.entries(groups)
    .filter(([, symbols]) => symbols.length > 0)
    .map(([label, symbols]) => ({ label, symbols }));
}

function formatPath(fullPath: string): string {
  // Strip the repo root to show a relative path
  const idx = fullPath.indexOf('packages/');
  if (idx !== -1) return fullPath.slice(idx);
  const purposeIdx = fullPath.indexOf('.purpose');
  if (purposeIdx !== -1) {
    const before = fullPath.lastIndexOf('/', purposeIdx);
    return before !== -1 ? fullPath.slice(before + 1) : fullPath;
  }
  return fullPath;
}
