import React, { useState } from 'react';
import type { Dangle, Knot, OracleRecord } from '../types';
import {
  consequenceLine,
  gitChip,
  heroState,
  isCalm,
  isHeadlineDivergence,
  matrixCells,
  meaningChip,
  rawCounts,
  CALM_DIVERGENCE_COPY,
} from '../viewerState';

/**
 * OracleDivergenceViewer — THE screen where "git sees bytes, Warpline sees
 * meaning" is the whole page. Composes RunHeader · MeaningVsBytesSplit (hero) ·
 * ConfusionMatrix · VerdictCard · DivergencePanel, plus a DrillDown slide-over.
 *
 * Every value here is read from a real OracleRecord field via viewerState.ts —
 * no invented data. `convergence.verdict` drives the mood;
 * `convergence.divergeMeaningOnly.length>0` is the headline (lights the ★ cell +
 * pulses the seam).
 */
export function OracleDivergenceViewer({ record }: { record: OracleRecord | null }) {
  const [drill, setDrill] = useState<
    { kind: 'knot'; knot: Knot } | { kind: 'dangle'; dangle: Dangle } | null
  >(null);

  if (!record) {
    return (
      <div className="warpline__viewer">
        <div className="wl-empty-viewer">
          <div className="wl-empty-viewer__h">Select an Oracle run</div>
          <div>or pick two branches and Run / Preview to weave one.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="warpline__viewer">
      <RunHeader record={record} />
      <MeaningVsBytesSplit record={record} />
      <ConfusionMatrix record={record} />
      <VerdictCard record={record} />
      <DivergencePanel
        record={record}
        onOpenKnot={(knot) => setDrill({ kind: 'knot', knot })}
        onOpenDangle={(dangle) => setDrill({ kind: 'dangle', dangle })}
      />
      {drill && <DrillDown drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

// ── RunHeader ────────────────────────────────────────────────────────────────

function RunHeader({ record }: { record: OracleRecord }) {
  return (
    <div className="wl-runheader">
      <div className="wl-runheader__weave">
        <span className="wl-runheader__a">{record.branchA}</span>
        <span className="wl-runheader__verb">◀ weave ▶</span>
        <span className="wl-runheader__b">{record.branchB}</span>
      </div>
      <div className="wl-runheader__meta">base {short(record.mergeBase)}</div>
      <div className="wl-runheader__meta">{record.ts ? new Date(record.ts).toLocaleString() : ''}</div>
    </div>
  );
}

// ── MeaningVsBytesSplit (hero) ─────────────────────────────────────────────────

function MeaningVsBytesSplit({ record }: { record: OracleRecord }) {
  const state = heroState(record);
  const git = gitChip(record);
  const meaning = meaningChip(record);

  // The seam pulses ONLY on headline divergence; static-dim for both-caught; calm 25% otherwise.
  const seamClass =
    state === 'divergence'
      ? 'wl-seam wl-seam--divergence'
      : state === 'both-caught'
        ? 'wl-seam wl-seam--both-caught'
        : 'wl-seam';

  return (
    <div className="wl-split">
      {/* LEFT — bytes / git (monospace, muted; the unreliable narrator) */}
      <div className="wl-split__side wl-split__side--bytes">
        <div className="wl-split__title">git · bytes</div>
        <span className={`wl-chip ${git.clean ? 'wl-chip--clean' : 'wl-chip--conflict'}`}>
          {git.label}
        </span>
        <div className="wl-split__tally">
          {record.gitReality.conflictPaths.length} conflicted path
          {record.gitReality.conflictPaths.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* the seam */}
      <div className={seamClass} />

      {/* RIGHT — meaning / warp (serif; what git can't see) */}
      <div className="wl-split__side wl-split__side--meaning">
        <div className="wl-split__title">warpline · meaning</div>
        <span
          className={`wl-chip ${meaning.verdict === 'DIVERGENT' ? 'wl-chip--divergent' : 'wl-chip--weave-clean'}`}
        >
          {meaning.verdict === 'DIVERGENT' ? 'DIVERGENT' : 'CLEAN'}
        </span>
        <div className="wl-split__tally">
          {meaning.knots} knot{meaning.knots === 1 ? '' : 's'} ·{' '}
          {meaning.dangles} dangle{meaning.dangles === 1 ? '' : 's'}
          {isHeadlineDivergence(record) && (
            <>
              {' — '}
              <b>{record.convergence.divergeMeaningOnly.length} git-blind</b>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ConfusionMatrix (literal 2×2) ──────────────────────────────────────────────

function ConfusionMatrix({ record }: { record: OracleRecord }) {
  const cells = matrixCells(record.convergence);
  const [open, setOpen] = useState<string | null>(null);
  const headline = isHeadlineDivergence(record);

  // Build the literal 2×2 explicitly by axis so the ★ sits bottom-left
  // (git clean × meaning knot — git's false negative, the thesis).
  const grid: Record<string, (typeof cells)[number]> = {};
  for (const c of cells) grid[`${c.gitConflict}-${c.meaningKnot}`] = c;
  const cellGitCleanMeaningClean = grid['false-false']; // agreeClean
  const cellGitConflictMeaningClean = grid['true-false']; // divergeGitOnly (amber)
  const cellGitCleanMeaningKnot = grid['false-true']; // divergeMeaningOnly ★
  const cellGitConflictMeaningKnot = grid['true-true']; // agreeConflict

  const renderCell = (cell: (typeof cells)[number]) => {
    const lit = cell.star && headline;
    return (
      <button
        className={[
          'wl-cell',
          cell.id === 'divergeGitOnly' ? 'wl-cell--gitonly' : '',
          cell.star ? 'wl-cell--star' : '',
          lit ? 'wl-cell--lit' : '',
        ].join(' ')}
        onClick={() => setOpen(open === cell.id ? null : cell.id)}
        title={cell.label}
      >
        <div className="wl-cell__count">{cell.symbols.length}</div>
        <div className="wl-cell__label">{cell.label}</div>
        {open === cell.id && cell.symbols.length > 0 && (
          <div className="wl-cell__symbols">
            {cell.symbols.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="wl-matrix-wrap">
      <div className="wl-matrix-title">Confusion matrix — git × meaning</div>
      <div className="wl-matrix">
        <div className="wl-matrix__corner" />
        <div className="wl-matrix__axis">meaning · clean</div>
        <div className="wl-matrix__axis">meaning · knot</div>

        <div className="wl-matrix__axis">git · clean</div>
        {renderCell(cellGitCleanMeaningClean)}
        {renderCell(cellGitCleanMeaningKnot)}

        <div className="wl-matrix__axis">git · conflict</div>
        {renderCell(cellGitConflictMeaningClean)}
        {renderCell(cellGitConflictMeaningKnot)}
      </div>
    </div>
  );
}

// ── VerdictCard ────────────────────────────────────────────────────────────────

function VerdictCard({ record }: { record: OracleRecord }) {
  const c = record.convergence;
  const counts = rawCounts(c);
  const divergent = c.verdict === 'DIVERGENT';
  return (
    <div className="wl-verdict">
      <div className="wl-verdict__head">
        <span className={`wl-verdict__label ${divergent ? 'wl-verdict__label--divergent' : 'wl-verdict__label--convergent'}`}>
          {c.verdict}
        </span>
        {/* score ALWAYS sits beside the raw counts — never a lone vanity number */}
        <span className="wl-verdict__counts">
          score {c.score.toFixed(2)} · agree {counts.agree} / git-only{' '}
          {counts.divergeGitOnly} / meaning-only {counts.divergeMeaningOnly}
        </span>
      </div>
      <div className="wl-verdict__consequence">{consequenceLine(record)}</div>
    </div>
  );
}

// ── DivergencePanel ────────────────────────────────────────────────────────────

function DivergencePanel({
  record,
  onOpenKnot,
  onOpenDangle,
}: {
  record: OracleRecord;
  onOpenKnot: (knot: Knot) => void;
  onOpenDangle: (dangle: Dangle) => void;
}) {
  const { knots, dangling } = record.prediction;

  if (isCalm(record) || (knots.length === 0 && dangling.length === 0)) {
    return (
      <div className="wl-divpanel">
        <div className="wl-divpanel__title">The weave</div>
        <div className="wl-divpanel__empty">{CALM_DIVERGENCE_COPY}</div>
      </div>
    );
  }

  return (
    <div className="wl-divpanel">
      <div className="wl-divpanel__title">The break</div>
      {knots.map((knot, i) => (
        <KnotRender
          key={`k-${knot.stableKey}-${i}`}
          knot={knot}
          intentA={record.justifications.A.intent}
          intentB={record.justifications.B.intent}
          onClick={() => onOpenKnot(knot)}
        />
      ))}
      {/* MAX 1 dangle drifts per screen — only the first one animates (drift class
          is on every dangle's loose end, but reduce-motion keeps them static; the
          single-drift cap is honored by the spec's intent: one emotional core). */}
      {dangling.map((dangle, i) => (
        <DangleRender key={`d-${dangle.fromKey}-${i}`} dangle={dangle} animate={i === 0} onClick={() => onOpenDangle(dangle)} />
      ))}
    </div>
  );
}

function KnotRender({
  knot,
  intentA,
  intentB,
  onClick,
}: {
  knot: Knot;
  intentA: string;
  intentB: string;
  onClick: () => void;
}) {
  return (
    <div className="wl-render wl-knot" onClick={onClick}>
      <div className="wl-knot__intents">
        <span className="wl-knot__intent--a">A · {intentA || '—'}</span>
        <span className="wl-knot__intent--b">B · {intentB || '—'}</span>
      </div>
      <div className="wl-knot__threads">
        <div className="wl-knot__thread wl-knot__thread--a" />
        <div className="wl-knot__thread wl-knot__thread--b" />
        <div className="wl-knot__glyph" />
      </div>
      <div className="wl-knot__symbol">{knot.symbol}</div>
      <div>
        {knot.conflictingSlots.map((slot) => (
          <span key={slot} className={`wl-slot ${slot === 'body' ? 'wl-slot--body' : ''}`}>
            {slot}
          </span>
        ))}
      </div>
    </div>
  );
}

function DangleRender({ dangle, animate, onClick }: { dangle: Dangle; animate: boolean; onClick: () => void }) {
  return (
    <div className="wl-render wl-dangle" onClick={onClick}>
      <div className="wl-dangle__span">
        <span className="wl-dangle__edgekind">{dangle.edgeKind}</span>
        <div className="wl-dangle__live" />
        {/* the drift is the emotional core — one per screen (the first dangle only) */}
        <div className={`wl-dangle__loose${animate ? ' wl-dangle__loose--drift' : ''}`} />
        <div className="wl-dangle__void" />
      </div>
      <div className="wl-dangle__label">
        <span className="wl-knot__intent--a">{dangle.fromSymbol}</span> →{' '}
        <span className="wl-dangle__target">{dangle.danglingTargetSymbol}</span>
        {' · retired by '}
        {dangle.retiredBy}
      </div>
    </div>
  );
}

// ── DrillDown (slide-over) — basic this pass ────────────────────────────────────

function DrillDown({
  drill,
  onClose,
}: {
  drill: { kind: 'knot'; knot: Knot } | { kind: 'dangle'; dangle: Dangle };
  onClose: () => void;
}) {
  return (
    <div className="wl-drill__backdrop" onClick={onClose}>
      <div className="wl-drill" onClick={(e) => e.stopPropagation()}>
        <button className="wl-drill__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {drill.kind === 'knot' ? (
          <>
            <div className="wl-drill__title">Knot · {drill.knot.symbol}</div>
            <div className="wl-drill__row">
              <div className="wl-drill__k">essence A</div>
              <div className="wl-drill__v wl-drill__v--a">{drill.knot.essenceA ?? '∅'}</div>
            </div>
            <div className="wl-drill__row">
              <div className="wl-drill__k">essence B</div>
              <div className="wl-drill__v wl-drill__v--b">{drill.knot.essenceB ?? '∅'}</div>
            </div>
            <div className="wl-drill__row">
              <div className="wl-drill__k">conflicting slots</div>
              <div className="wl-drill__v">{drill.knot.conflictingSlots.join(', ') || '—'}</div>
            </div>
          </>
        ) : (
          <>
            <div className="wl-drill__title">Dangle · {drill.dangle.fromSymbol}</div>
            <div className="wl-drill__row">
              <div className="wl-drill__k">from</div>
              <div className="wl-drill__v wl-drill__v--a">{drill.dangle.fromSymbol}</div>
            </div>
            <div className="wl-drill__row">
              <div className="wl-drill__k">edge</div>
              <div className="wl-drill__v">{drill.dangle.edgeKind}</div>
            </div>
            <div className="wl-drill__row">
              <div className="wl-drill__k">severed target</div>
              <div className="wl-drill__v wl-drill__v--seam">{drill.dangle.danglingTargetSymbol}</div>
            </div>
            <div className="wl-drill__row">
              <div className="wl-drill__k">retired by</div>
              <div className="wl-drill__v">branch {drill.dangle.retiredBy}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function short(ref: string): string {
  return ref && ref.length > 12 ? ref.slice(0, 10) : ref;
}

export default OracleDivergenceViewer;
