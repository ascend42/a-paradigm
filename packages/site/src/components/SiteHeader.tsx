'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import styles from './SiteHeader.module.css';

const NAV_ITEMS = [
  { label: 'Docs', href: '/docs' },
  { label: 'Agents', href: '/agents' },
  { label: 'Learn', href: '/learn' },
  { label: 'Blog', href: '/blog' },
] as const;

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo} aria-label="Paradigm home">
          <ParadigmMark />
          <span className={styles.wordmark}>paradigm</span>
        </Link>

        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map(({ label, href }) => (
            <Link key={href} href={href} className={styles.navLink}>
              {label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <ThemeToggle />
          <a
            href="https://github.com/ascend42/a-paradigm"
            className={styles.githubLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
          >
            <GitHubIcon />
          </a>
          <Link href="/docs/getting-started" className={styles.cta}>
            Get Started
          </Link>
        </div>

        <button
          className={styles.mobileToggle}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          <span className={styles.hamburger} data-open={mobileOpen} />
        </button>
      </div>

      {mobileOpen && (
        <div className={styles.mobileNav}>
          {NAV_ITEMS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className={styles.mobileLink}
              onClick={() => setMobileOpen(false)}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/docs/getting-started"
            className={styles.mobileCta}
            onClick={() => setMobileOpen(false)}
          >
            Get Started
          </Link>
        </div>
      )}
    </header>
  );
}

function ParadigmMark() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {/* Node graph mark — 5 nodes connected */}
      <circle cx="12" cy="4" r="2.5" fill="var(--sym-component)" />
      <circle cx="4" cy="12" r="2" fill="var(--sym-flow)" />
      <circle cx="20" cy="10" r="2" fill="var(--sym-gate)" />
      <circle cx="8" cy="20" r="2" fill="var(--sym-signal)" />
      <circle cx="18" cy="18" r="1.5" fill="var(--sym-aspect)" />
      {/* Edges */}
      <line x1="12" y1="4" x2="4" y2="12" stroke="var(--surface-steel)" strokeWidth="1" />
      <line x1="12" y1="4" x2="20" y2="10" stroke="var(--surface-steel)" strokeWidth="1" />
      <line x1="4" y1="12" x2="8" y2="20" stroke="var(--surface-steel)" strokeWidth="1" />
      <line x1="20" y1="10" x2="18" y2="18" stroke="var(--surface-steel)" strokeWidth="1" />
      <line x1="8" y1="20" x2="18" y2="18" stroke="var(--surface-steel)" strokeWidth="1" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
