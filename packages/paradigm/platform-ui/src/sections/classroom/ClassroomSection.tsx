import React, { useEffect, useState } from 'react';
import './styles/classroom.css';

/* The Academy (Classroom) — wave-1 read-only MVP.
 *
 * Fetches /api/classroom/status on mount. If !bootstrapped → the Bootstrap
 * Doorway empty-state. If bootstrapped → the Term Board: the hero with the
 * ghosted-denominator repeat-failure bar (null-safe) and the three lifecycle
 * columns (Staged / On Trial / Settled), populated from /certifications and
 * /staged, with GATED vs LEGACY badges derived from the cert's `loop` field.
 *
 * Honesty rules (classroom-experience.md): a null repeat-failure rate reads
 * "no settled exams yet", never healthy. Empty data degrades gracefully —
 * every list is resilient to [].
 */

// ── Types (the read-only shapes the routes return) ───────────────────

interface SyllabusRow {
  agent: string;
  status: 'current' | 'stale' | 'broken' | 'expired';
  certified: number;
  provisional: number;
}

interface Rollup {
  total: number;
  pending: number;
  survived: number;
  overturned: number;
  resolved: number;
  repeatFailureRate: number | null;
}

interface Status {
  bootstrapped: boolean;
  syllabi: SyllabusRow[];
  rollup: Rollup;
}

interface CertRow {
  ts?: string;
  agent?: string;
  entryId?: string;
  concepts?: string[];
  certifiedBy?: 'gate' | 'peer' | 'quorum';
  outcome?: 'pending' | 'survived' | 'overturned';
  loop: 'gated' | 'legacy';
}

interface StagedRow {
  agent?: string;
  insight?: string;
  confidence?: number;
  trust?: string;
  source?: string;
  ts?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

function conceptLine(c: CertRow): string {
  if (c.concepts && c.concepts.length > 0) return c.concepts.join(', ');
  if (c.entryId) return c.entryId;
  return 'Unnamed learning';
}

function LoopBadge({ loop }: { loop: 'gated' | 'legacy' }) {
  return (
    <span className={`classroom__badge classroom__badge--${loop}`}>
      {loop === 'gated' ? 'GATED' : 'LEGACY'}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: CertRow['outcome'] }) {
  if (outcome === 'survived') return <span className="classroom__badge classroom__badge--survived">SURVIVED</span>;
  if (outcome === 'overturned') return <span className="classroom__badge classroom__badge--overturned">OVERTURNED</span>;
  return <span className="classroom__badge classroom__badge--pending">PENDING</span>;
}

function CertCard({ cert }: { cert: CertRow }) {
  const mod =
    cert.outcome === 'survived'
      ? ' classroom__card--survived'
      : cert.outcome === 'overturned'
        ? ' classroom__card--overturned'
        : '';
  return (
    <div className={`classroom__card${mod}`}>
      <div className="classroom__card-top">
        <span className="classroom__card-agent">
          <b>{cert.agent || 'unknown'}</b>
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <LoopBadge loop={cert.loop} />
          <OutcomeBadge outcome={cert.outcome} />
        </span>
      </div>
      <div className="classroom__card-line">{conceptLine(cert)}</div>
    </div>
  );
}

function StagedCard({ row }: { row: StagedRow }) {
  // A staged study-hall journal candidate. trust (e.g. 'provisional') reads as
  // the badge; source ('study-hall'/'expedition') as the role; insight as the
  // claim line.
  return (
    <div className="classroom__card">
      <div className="classroom__card-top">
        <span className="classroom__card-agent">
          <b>{row.agent || 'unknown'}</b>
          {row.source && <span className="classroom__card-role">{row.source}</span>}
        </span>
        {row.trust && (
          <span className="classroom__badge classroom__badge--pending">{row.trust}</span>
        )}
      </div>
      {row.insight && <div className="classroom__card-line">{row.insight}</div>}
      {typeof row.confidence === 'number' && (
        <div className="classroom__card-meta">confidence {row.confidence.toFixed(2)}</div>
      )}
    </div>
  );
}

// ── The ghosted-denominator repeat-failure bar ───────────────────────

function RepeatFailureBar({ rollup }: { rollup: Rollup }) {
  const { repeatFailureRate, resolved, overturned } = rollup;
  const hasData = repeatFailureRate !== null && resolved > 0;

  if (!hasData) {
    // 0 resolved → all-ghost track + the honest caption. A null scoreboard is
    // "not enough settled exams", NOT healthy.
    return (
      <>
        <div className="classroom__track classroom__track--ghost" />
        <div className="classroom__hero-caption">
          repeat-failure-rate — no settled exams yet · scoreboard not trustworthy until certs resolve
        </div>
      </>
    );
  }

  const pct = Math.round(repeatFailureRate * 100);
  return (
    <>
      <div className="classroom__track">
        <div className="classroom__track-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="classroom__hero-caption">
        repeat-failure-rate {pct}% — {overturned} of {resolved} resolved · scoreboard trustworthy once the survival window clears
      </div>
    </>
  );
}

function SyllabiStrip({ syllabi }: { syllabi: SyllabusRow[] }) {
  if (syllabi.length === 0) return null;
  return (
    <div className="classroom__syllabi">
      {syllabi.map((s) => (
        <span key={s.agent} className="classroom__syllabus-chip">
          <b>{s.agent}</b>
          <span className={`classroom__syllabus-status classroom__syllabus-status--${s.status}`}>
            {s.status}
          </span>
          <span>
            {s.certified} certified · {s.provisional} provisional
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Bootstrap Doorway (empty state) ──────────────────────────────────

function BootstrapDoorway() {
  return (
    <div className="classroom__doorway">
      <span className="classroom__doorway-cap">◈</span>
      <h2 className="classroom__doorway-h">Your team has been working — but never been to class.</h2>
      <p className="classroom__doorway-sub">
        No curriculum yet, so nothing has been vetted. A green checkmark that lies is the enemy —
        so there is nothing green here.
      </p>
      <div className="classroom__doorway-checklist">
        <div className="classroom__doorway-row">
          <span className="classroom__doorway-dot" />
          <span className="classroom__doorway-lbl">Seed a breaking scenario</span>
        </div>
        <div className="classroom__doorway-row">
          <span className="classroom__doorway-dot" />
          <span className="classroom__doorway-lbl">Author the process syllabus</span>
        </div>
        <div className="classroom__doorway-row">
          <span className="classroom__doorway-dot" />
          <span className="classroom__doorway-lbl">Run study-hall</span>
        </div>
      </div>
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────

export default function ClassroomSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getJson<Status>('/api/classroom/status', {
        bootstrapped: false,
        syllabi: [],
        rollup: { total: 0, pending: 0, survived: 0, overturned: 0, resolved: 0, repeatFailureRate: null },
      });
      if (cancelled) return;
      setStatus(s);

      // Only fetch board data once we know the Academy is bootstrapped.
      if (s.bootstrapped) {
        const [c, st] = await Promise.all([
          getJson<CertRow[]>('/api/classroom/certifications', []),
          getJson<StagedRow[]>('/api/classroom/staged', []),
        ]);
        if (cancelled) return;
        setCerts(c);
        setStaged(st);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !status) {
    return (
      <div className="classroom">
        <h1 className="classroom__title">The Academy</h1>
        <p style={{ color: 'var(--p-text-muted)' }}>Loading...</p>
      </div>
    );
  }

  if (!status.bootstrapped) {
    return (
      <div className="classroom">
        <h1 className="classroom__title">The Academy</h1>
        <p className="classroom__subtitle">gated learning · the field is the examiner</p>
        <BootstrapDoorway />
      </div>
    );
  }

  // Term Board. Lifecycle split:
  //   Staged   — study-hall journal candidates from enrolled agents (/staged).
  //   On Trial — pending certs (certified-pending, awaiting the field's veto).
  //   Settled  — resolved certs (survived OR overturned).
  const onTrial = certs.filter((c) => c.outcome === 'pending' || c.outcome === undefined);
  const settled = certs.filter((c) => c.outcome === 'survived' || c.outcome === 'overturned');

  return (
    <div className="classroom">
      <h1 className="classroom__title">The Academy</h1>
      <p className="classroom__subtitle">gated learning · the field is the examiner</p>

      <div className="classroom__hero">
        <div className="classroom__hero-id">
          <span className="classroom__hero-id-title">Term Board</span>
          <span className="classroom__hero-id-meta">
            {status.syllabi.length} agent{status.syllabi.length !== 1 ? 's' : ''} enrolled ·{' '}
            {status.rollup.total} certified · {status.rollup.pending} await sign-off
          </span>
        </div>
        <RepeatFailureBar rollup={status.rollup} />
        <SyllabiStrip syllabi={status.syllabi} />
      </div>

      <div className="classroom__cols">
        <div className="classroom__col">
          <div className="classroom__col-head">Staged · {staged.length}</div>
          {staged.length === 0 && (
            <div className="classroom__col-empty">Nothing staged yet — run study-hall or an expedition</div>
          )}
          {staged.map((row, i) => (
            <StagedCard key={`${row.agent}-${row.ts ?? i}`} row={row} />
          ))}
        </div>

        <div className="classroom__col">
          <div className="classroom__col-head">On Trial · {onTrial.length}</div>
          {onTrial.length === 0 && <div className="classroom__col-empty">Nothing on trial</div>}
          {onTrial.map((cert, i) => (
            <CertCard key={cert.entryId || `trial-${i}`} cert={cert} />
          ))}
        </div>

        <div className="classroom__col">
          <div className="classroom__col-head">Settled · {settled.length}</div>
          {settled.length === 0 && <div className="classroom__col-empty">Nothing settled yet</div>}
          {settled.map((cert, i) => (
            <CertCard key={cert.entryId || `settled-${i}`} cert={cert} />
          ))}
        </div>
      </div>
    </div>
  );
}
