import Link from 'next/link';
import type { FlowEntry } from '@/lib/docs-data';
import { SymbolBadge } from '@/components/SymbolBadge';
import styles from './FlowPage.module.css';

interface FlowPageProps {
  flow: FlowEntry;
}

export function FlowPage({ flow }: FlowPageProps) {
  const id = flow.id.replace(/^\$/, '');
  const steps = Array.isArray(flow.steps) ? flow.steps : [];

  // Steps are meaningful if any has a real action description (not just "Step N")
  const hasDetailedSteps = steps.some(
    s => s.action && !/^Step \d+$/.test(s.action)
  );
  const involvedSymbols = uniqueSymbols(steps);

  return (
    <article className={styles.article}>
      <div className={styles.header}>
        <SymbolBadge type="flow" name={id} size="lg" />
        <h1 className={styles.title}>{formatFlowName(id)}</h1>
      </div>

      <p className={styles.description}>{flow.description}</p>

      {/* Defined in */}
      {flow.definedIn && (
        <div className={styles.definedIn}>
          <span className={styles.definedLabel}>Defined in</span>
          <code className={styles.definedPath}>{formatPath(flow.definedIn)}</code>
        </div>
      )}

      {/* Steps timeline — only show if steps have meaningful content */}
      {hasDetailedSteps && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Steps</h2>
          <div className={styles.timeline}>
            {steps.map((step, i) => (
              <div key={step.id || i} className={styles.step}>
                <div className={styles.stepTrack}>
                  <div className={styles.stepDot} />
                  {i < steps.length - 1 && <div className={styles.stepLine} />}
                </div>
                <div className={styles.stepBody}>
                  <div className={styles.stepHeader}>
                    <span className={styles.stepIndex}>Step {i + 1}</span>
                    {step.symbol && (
                      <StepSymbolLink symbol={step.symbol} />
                    )}
                  </div>
                  <p className={styles.stepAction}>{step.action}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Involved symbols */}
      {involvedSymbols.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Involved Symbols</h2>
          <div className={styles.symbolGrid}>
            {involvedSymbols.map(sym => (
              <StepSymbolLink key={sym} symbol={sym} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function StepSymbolLink({ symbol }: { symbol: string }) {
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
    return <code>{symbol}</code>;
  }

  return (
    <Link href={`/docs/${cat}/${name}`} className={styles.symbolLink}>
      <SymbolBadge type={symType} name={name} size="sm" />
    </Link>
  );
}

function formatPath(fullPath: string): string {
  const idx = fullPath.indexOf('packages/');
  if (idx !== -1) return fullPath.slice(idx);
  return fullPath;
}

function formatFlowName(id: string): string {
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function uniqueSymbols(steps: FlowEntry['steps']): string[] {
  const seen = new Set<string>();
  return steps
    .filter(s => s.symbol && !seen.has(s.symbol) && seen.add(s.symbol))
    .map(s => s.symbol!);
}
