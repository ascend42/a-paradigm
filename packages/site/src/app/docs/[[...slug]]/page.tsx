import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  resolveDocsSlug,
  getAllDocsParams,
  getDocsManifest,
  type SymbolEntry,
  type SymbolCategory,
  type FlowEntry,
  type PortalData,
  type ContentPage as ContentPageData,
} from '@/lib/docs-data';
import { SymbolPage } from '@/components/docs/SymbolPage';
import { FlowPage } from '@/components/docs/FlowPage';
import { PortalPage } from '@/components/docs/PortalPage';
import { ContentPage } from '@/components/docs/ContentPage';
import { CategoryListPage } from '@/components/docs/CategoryListPage';
import styles from './page.module.css';

export async function generateStaticParams() {
  const allParams = getAllDocsParams();
  return allParams.map(slugParts => ({
    slug: slugParts.length === 0 ? undefined : slugParts,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug: slugParts } = await params;
  const resolved = resolveDocsSlug(slugParts || []);

  switch (resolved.type) {
    case 'index':
      return { title: 'Documentation' };
    case 'content': {
      const page = resolved.data as ContentPageData;
      return { title: page.title, description: page.description };
    }
    case 'category-list': {
      const { category } = resolved.data as { category: SymbolCategory };
      const labels: Record<SymbolCategory, string> = {
        components: 'Components', flows: 'Flows', gates: 'Gates',
        signals: 'Signals', aspects: 'Aspects',
      };
      return { title: labels[category] };
    }
    case 'symbol-detail': {
      const { entry } = resolved.data as { entry: SymbolEntry };
      return { title: entry.name, description: entry.description };
    }
    case 'portal':
      return { title: 'Portal Reference' };
    default:
      return { title: 'Not Found' };
  }
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug: slugParts } = await params;
  const resolved = resolveDocsSlug(slugParts || []);

  const breadcrumbs = buildBreadcrumbs(slugParts || []);

  switch (resolved.type) {
    case 'index':
      return <DocsIndex />;

    case 'content':
      return (
        <>
          <Breadcrumbs items={breadcrumbs} />
          <ContentPage page={resolved.data as ContentPageData} />
        </>
      );

    case 'category-list': {
      const { category, entries } = resolved.data as {
        category: SymbolCategory;
        entries: SymbolEntry[];
      };
      return (
        <>
          <Breadcrumbs items={breadcrumbs} />
          <CategoryListPage category={category} entries={entries} />
        </>
      );
    }

    case 'symbol-detail': {
      const { entry, flow, category } = resolved.data as {
        entry: SymbolEntry;
        flow: FlowEntry | null;
        category: SymbolCategory;
      };
      return (
        <>
          <Breadcrumbs items={breadcrumbs} />
          {category === 'flows' && flow
            ? <FlowPage flow={flow} />
            : <SymbolPage entry={entry} category={category} flow={flow} />
          }
        </>
      );
    }

    case 'portal':
      return (
        <>
          <Breadcrumbs items={breadcrumbs} />
          <PortalPage data={resolved.data as PortalData} />
        </>
      );

    default:
      notFound();
  }
}

/* ── Breadcrumbs ─────────────────────────────────────────────────────────── */

interface BreadcrumbItem {
  label: string;
  href?: string;
}

function formatSegment(segment: string): string {
  // Capitalize first letter and replace hyphens with spaces
  return segment
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildBreadcrumbs(slugParts: string[]): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [{ label: 'Docs', href: '/docs' }];

  for (let i = 0; i < slugParts.length; i++) {
    const isLast = i === slugParts.length - 1;
    const href = '/docs/' + slugParts.slice(0, i + 1).join('/');
    items.push({
      label: formatSegment(slugParts[i]),
      href: isLast ? undefined : href,
    });
  }

  return items;
}

function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length <= 1) return null;

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className={styles.breadcrumbSep} aria-hidden="true">/</span>}
          {item.href ? (
            <Link href={item.href}>{item.label}</Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ── Docs Index Page ─────────────────────────────────────────────────────── */

function DocsIndex() {
  const manifest = getDocsManifest();
  const { stats } = manifest;

  const categories = [
    { label: 'Components', count: stats.components, href: '/docs/components', color: 'component' as const },
    { label: 'Flows', count: stats.flows, href: '/docs/flows', color: 'flow' as const },
    { label: 'Gates', count: stats.gates, href: '/docs/gates', color: 'gate' as const },
    { label: 'Signals', count: stats.signals, href: '/docs/signals', color: 'signal' as const },
    { label: 'Aspects', count: stats.aspects, href: '/docs/aspects', color: 'aspect' as const },
  ];

  return (
    <article className={styles.article}>
      <h1 className={styles.title}>Documentation</h1>
      <p className={styles.intro}>
        Auto-generated reference for {stats.components + stats.flows + stats.gates + stats.signals + stats.aspects} symbols
        across {stats.purposeFiles} purpose files.
      </p>

      {/* Quick links */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Getting Started</h2>
        <div className={styles.quickLinks}>
          <Link href="/docs/getting-started" className={styles.quickLink}>
            <span className={styles.quickIcon}>&#9654;</span>
            <div>
              <span className={styles.quickTitle}>Installation</span>
              <span className={styles.quickDesc}>Install Paradigm and create your first project</span>
            </div>
          </Link>
          <Link href="/docs/concepts" className={styles.quickLink}>
            <span className={styles.quickIcon}>&#9733;</span>
            <div>
              <span className={styles.quickTitle}>The Five Symbols</span>
              <span className={styles.quickDesc}>Components, Flows, Gates, Signals, and Aspects</span>
            </div>
          </Link>
          <Link href="/docs/purpose-files" className={styles.quickLink}>
            <span className={styles.quickIcon}>&#9998;</span>
            <div>
              <span className={styles.quickTitle}>Purpose Files</span>
              <span className={styles.quickDesc}>Write and maintain .purpose files</span>
            </div>
          </Link>
        </div>
      </section>

      {/* Symbol stats */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Symbol Reference</h2>
        <div className={styles.statsGrid}>
          {categories.map(cat => (
            <Link key={cat.label} href={cat.href} className={`${styles.statCard} ${styles[cat.color]}`}>
              <span className={styles.statCount}>{cat.count}</span>
              <span className={styles.statLabel}>{cat.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Portal link */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Authorization</h2>
        <Link href="/docs/portal" className={styles.portalLink}>
          <span className={styles.portalIcon}>^</span>
          <div>
            <span className={styles.quickTitle}>Portal Reference</span>
            <span className={styles.quickDesc}>View all gates and protected routes</span>
          </div>
        </Link>
      </section>
    </article>
  );
}
