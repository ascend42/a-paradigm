import type { Metadata } from 'next';
import { getDocsManifest } from '@/lib/docs-data';
import { DocsSidebar } from '@/components/docs';
import styles from './layout.module.css';

export const metadata: Metadata = {
  title: {
    default: 'Documentation',
    template: '%s | Paradigm Docs',
  },
  description: 'Paradigm documentation — auto-generated symbol reference, guides, flows, and portal.',
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const manifest = getDocsManifest();

  return (
    <div className={styles.docsLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Documentation</span>
          <span className={styles.sidebarStats}>
            {manifest.stats.components + manifest.stats.flows + manifest.stats.gates + manifest.stats.signals + manifest.stats.aspects} symbols
          </span>
        </div>
        <DocsSidebar sections={manifest.sections} />
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
