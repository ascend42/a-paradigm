import { useEffect, useState } from 'react';
import type { ReferenceData } from '../types';

export function ReferenceView() {
  const [data, setData] = useState<ReferenceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/reference')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as Record<string, unknown>;
          setErrorMsg(typeof body.error === 'string' ? body.error : 'Could not load reference data.');
          setIsLoading(false);
          return;
        }
        const d: ReferenceData = await r.json();
        setData(d);
        setIsLoading(false);
      })
      .catch(() => {
        setErrorMsg('Could not load reference data.');
        setIsLoading(false);
      });
  }, []);

  if (isLoading) {
    return <div className="loading">Opening the reference library...</div>;
  }

  if (!data) {
    return (
      <div className="empty-state">
        <h3>Reference library unavailable</h3>
        <p>{errorMsg ?? 'Could not load reference data.'}</p>
      </div>
    );
  }

  return (
    <div className="reference-container">
      <h1 className="mb-lg">Reference Library</h1>

      {data.sections.map((section) => (
        <section key={section.id} className="reference-section">
          <h2>{section.title}</h2>
          <div className="reference-grid">
            {section.cards.map((card) => (
              <div key={card.id} className="ref-card">
                {card.symbol && <div className="ref-symbol">{card.symbol}</div>}
                <h4>{card.name}</h4>
                <p>{card.description}</p>

                {card.examples && card.examples.length > 0 && (
                  <div className="ref-examples">
                    {card.examples.map((ex) => (
                      <span key={ex} className="ref-example">{ex}</span>
                    ))}
                  </div>
                )}

                {card.logger && (
                  <p style={{ marginTop: '0.5rem' }}>
                    <code>{card.logger}</code>
                  </p>
                )}

                {card.when && (
                  <p className="text-muted" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                    <em>{card.when}</em>
                  </p>
                )}

                {card.command && (
                  <p style={{ marginTop: '0.5rem' }}>
                    <code>{card.command}</code>
                  </p>
                )}

                {card.steps && card.steps.length > 0 && (
                  <ol style={{ fontSize: '0.875rem', paddingLeft: '1.25rem', marginTop: '0.5rem' }}>
                    {card.steps.map((step, i) => (
                      <li key={i} style={{ marginBottom: '0.25rem' }}>{step}</li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
