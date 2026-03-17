import type { Metadata } from 'next';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Philosophy',
  description: 'Context engineering as a discipline. Why structured codebase context is the missing layer in AI-native development.',
};

export default function PhilosophyPage() {
  return (
    <article className={styles.article}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>The Manifesto</p>
        <h1 className={styles.title}>Context engineering is a discipline</h1>
        <p className={styles.subtitle}>
          AI agents are only as good as the context they receive.
          Paradigm makes that context structured, discoverable, and alive.
        </p>
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <h2>The problem</h2>
          <p>
            Every AI coding tool faces the same wall: your codebase is a maze of files,
            and the AI has no map. It guesses which files to read, burns tokens scanning
            irrelevant code, and still misses the architectural intent behind your decisions.
          </p>
          <p>
            This isn't an AI problem. It's a context problem. The information exists — in
            your head, in scattered comments, in tribal knowledge passed between teammates.
            But none of it is in a format that machines can reliably consume.
          </p>
        </section>

        <section className={styles.section}>
          <h2>The insight</h2>
          <p>
            What if you could describe your entire codebase with just five concepts?
            Not a new language. Not a new framework. Just five symbols that map to
            universal software patterns:
          </p>
          <div className={styles.symbolList}>
            <div className={styles.symbolRow}>
              <span className={styles.symbolMark} style={{ color: 'var(--sym-component)' }}>●</span>
              <div>
                <strong>#Components</strong> — the things you build
              </div>
            </div>
            <div className={styles.symbolRow}>
              <span className={styles.symbolMark} style={{ color: 'var(--sym-flow)' }}>◆</span>
              <div>
                <strong>$Flows</strong> — the paths data takes
              </div>
            </div>
            <div className={styles.symbolRow}>
              <span className={styles.symbolMark} style={{ color: 'var(--sym-gate)' }}>■</span>
              <div>
                <strong>^Gates</strong> — the rules that protect
              </div>
            </div>
            <div className={styles.symbolRow}>
              <span className={styles.symbolMark} style={{ color: 'var(--sym-signal)' }}>▲</span>
              <div>
                <strong>!Signals</strong> — the events that ripple
              </div>
            </div>
            <div className={styles.symbolRow}>
              <span className={styles.symbolMark} style={{ color: 'var(--sym-aspect)' }}>◇</span>
              <div>
                <strong>~Aspects</strong> — the rules that cut across
              </div>
            </div>
          </div>
          <p>
            These five symbols can describe any software system. A microservice, a monolith,
            a mobile app, a CLI tool. The vocabulary is universal because the patterns are universal.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Context as infrastructure</h2>
          <p>
            We treat logging as infrastructure. We treat testing as infrastructure. We treat
            CI/CD as infrastructure. But we treat codebase context — the single most important
            input to AI-assisted development — as an afterthought.
          </p>
          <p>
            Paradigm treats context as infrastructure. <code>.purpose</code> files sit alongside
            your code, describing what each directory contains and how it connects to the rest
            of the system. They're version-controlled, diff-friendly, and machine-readable.
          </p>
          <p>
            When an AI agent needs to understand your authentication layer, it doesn't grep
            through a thousand files. It reads one <code>.purpose</code> file and gets a complete
            map: the components, the gates, the flows, the signals.
          </p>
        </section>

        <section className={styles.section}>
          <h2>The compounding effect</h2>
          <p>
            Every <code>.purpose</code> file you write makes every future AI interaction better.
            Not just for you — for every agent, every tool, every teammate that touches that code.
          </p>
          <p>
            Context compounds. A well-described codebase gets better AI suggestions, which leads
            to better code, which leads to better descriptions. This is the flywheel that
            Paradigm creates.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Not just for AI</h2>
          <p>
            A codebase described with Paradigm symbols is easier for humans to navigate too.
            New team members onboard faster. Architecture decisions are documented where they
            matter. Security gates are explicit, not implicit.
          </p>
          <p>
            The best developer tools make both humans and machines more effective.
            That's what context engineering is about.
          </p>
        </section>

        <section className={styles.section}>
          <h2>An invitation</h2>
          <p>
            Paradigm is open source. It's free for individual developers, forever.
            We believe that structured context should be a commons — something every
            project benefits from, something no one should have to pay to create.
          </p>
          <p>
            If you believe that AI-native development needs better foundations,
            we invite you to try it. One command. Five symbols. A codebase your
            AI agents can finally understand.
          </p>
        </section>
      </div>
    </article>
  );
}
