import Link from 'next/link';
import styles from './CTASection.module.css';

export function CTASection() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <h2 className={styles.heading}>Ready to give your AI agents real context?</h2>
        <p className={styles.subtitle}>
          Install Paradigm in under two minutes. Open source. Free forever for individual developers.
        </p>
        <div className={styles.actions}>
          <Link href="/docs/getting-started" className={styles.primaryCta}>
            Get Started
          </Link>
          <Link href="/learn" className={styles.secondaryCta}>
            Take the University Tour
          </Link>
        </div>
      </div>
    </section>
  );
}
