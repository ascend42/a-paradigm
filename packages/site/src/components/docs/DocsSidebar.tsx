'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SidebarSection } from '@/lib/docs-data';
import styles from './DocsSidebar.module.css';

const SYMBOL_SHAPES: Record<string, string> = {
  component: '#',
  flow: '$',
  gate: '^',
  signal: '!',
  aspect: '~',
};

interface DocsSidebarProps {
  sections: SidebarSection[];
}

export function DocsSidebar({ sections }: DocsSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');

  function toggle(title: string) {
    setCollapsed(prev => ({ ...prev, [title]: !prev[title] }));
  }

  const lowerFilter = filter.toLowerCase();

  return (
    <nav className={styles.nav} aria-label="Documentation navigation">
      <div className={styles.searchBox}>
        <div className={styles.searchWrap}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Filter docs..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            aria-label="Filter documentation"
          />
          {filter && (
            <button
              className={styles.searchClear}
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              type="button"
            >
              &times;
            </button>
          )}
        </div>
      </div>
      {sections.map(section => {
        const filteredItems = lowerFilter
          ? section.items.filter(item => item.label.toLowerCase().includes(lowerFilter))
          : section.items;

        if (filteredItems.length === 0) return null;

        const isCollapsed = !lowerFilter && (collapsed[section.title] ?? false);
        const hasActive = filteredItems.some(item => pathname === item.href);

        return (
          <div key={section.title} className={styles.section}>
            <button
              className={styles.sectionToggle}
              onClick={() => toggle(section.title)}
              aria-expanded={!isCollapsed}
            >
              <span className={styles.sectionTitle}>{section.title}</span>
              <span className={`${styles.chevron} ${isCollapsed ? styles.chevronCollapsed : ''}`}>
                <ChevronIcon />
              </span>
            </button>
            {!isCollapsed && (
              <ul className={styles.links}>
                {filteredItems.map(item => {
                  const isActive = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`${styles.link} ${isActive ? styles.linkActive : ''}`}
                      >
                        {item.symbolType && (
                          <span className={`${styles.prefix} ${styles[item.symbolType]}`}>
                            {SYMBOL_SHAPES[item.symbolType]}
                          </span>
                        )}
                        <span className={styles.linkLabel}>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
