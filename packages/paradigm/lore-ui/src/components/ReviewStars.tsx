import React from 'react';

export function ReviewStars({ rating }: { rating: number }) {
  return (
    <span className="review-stars">
      {'\u2605'.repeat(rating)}{'\u2606'.repeat(5 - rating)}
    </span>
  );
}
