import Link from 'next/link';
import styles from './SiteFooter.module.css';

const FOOTER_LINKS = {
  Product: [
    { label: 'Getting Started', href: '/docs/getting-started' },
    { label: 'Documentation', href: '/docs' },
    { label: 'Changelog', href: '/changelog' },
    { label: 'Pricing', href: '/pricing' },
  ],
  Community: [
    { label: 'GitHub', href: 'https://github.com/ascend42/a-paradigm' },
    { label: 'Agent Registry', href: '/agents' },
    { label: 'Blog', href: '/blog' },
  ],
  Learn: [
    { label: 'University', href: '/learn' },
    { label: 'Courses', href: '/learn/courses' },
    { label: 'PLSAT Certification', href: '/learn/plsat' },
    { label: 'Reference Cards', href: '/learn/reference' },
  ],
} as const;

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>paradigm</span>
          <p className={styles.tagline}>
            The context engineering framework
          </p>
          <p className={styles.copyright}>
            Built by A Company
          </p>
        </div>

        <div className={styles.links}>
          {Object.entries(FOOTER_LINKS).map(([heading, items]) => (
            <div key={heading} className={styles.column}>
              <h4 className={styles.columnHeading}>{heading}</h4>
              <ul className={styles.columnList}>
                {items.map(({ label, href }) => (
                  <li key={href}>
                    {href.startsWith('http') ? (
                      <a
                        href={href}
                        className={styles.link}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {label}
                      </a>
                    ) : (
                      <Link href={href} className={styles.link}>
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={styles.symbols}>
          <span style={{ color: 'var(--sym-component)' }}>●</span>
          <span style={{ color: 'var(--sym-flow)' }}>◆</span>
          <span style={{ color: 'var(--sym-gate)' }}>■</span>
          <span style={{ color: 'var(--sym-signal)' }}>▲</span>
          <span style={{ color: 'var(--sym-aspect)' }}>◇</span>
        </div>
      </div>
    </footer>
  );
}
