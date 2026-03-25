import React from 'react';
import type { LoreEntry } from '../../store/loreStore';
import { VerificationBadge } from '../VerificationBadge';
import { ReviewStars } from '../ReviewStars';

interface DetailReviewProps {
  entry: LoreEntry;
}

export function DetailReview({ entry }: DetailReviewProps) {
  const hasVerification = !!entry.verification;
  const hasReview = !!entry.review;

  if (!hasVerification && !hasReview) return null;

  return (
    <>
      {/* Verification */}
      {entry.verification && (
        <div className="detail-section">
          <h3>Verification</h3>
          <VerificationBadge status={entry.verification.status} />
          {entry.verification.details && (
            <dl className="detail-meta" style={{ marginTop: 8 }}>
              {Object.entries(entry.verification.details).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>{k}</dt>
                  <dd style={{ color: v === 'pass' ? 'var(--p-accent-green)' : 'var(--p-accent-red)' }}>{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* Review */}
      {entry.review ? (
        <div className="detail-section">
          <h3>Review</h3>
          <dl className="detail-meta">
            <dt>Reviewer</dt>
            <dd>{entry.review.reviewer}</dd>
            <dt>Completeness</dt>
            <dd><ReviewStars rating={entry.review.completeness} /></dd>
            <dt>Quality</dt>
            <dd><ReviewStars rating={entry.review.quality} /></dd>
            {entry.review.notes && <>
              <dt>Notes</dt>
              <dd>{entry.review.notes}</dd>
            </>}
          </dl>
        </div>
      ) : (
        <div className="detail-section">
          <h3>Review</h3>
          <p style={{ color: 'var(--p-text-muted)', fontSize: 13 }}>
            No review yet. Run <code style={{ background: 'var(--p-bg-card)', padding: '2px 4px', borderRadius: 3 }}>paradigm lore review {entry.id}</code>
          </p>
        </div>
      )}
    </>
  );
}
