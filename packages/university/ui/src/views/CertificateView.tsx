import { usePLSATStore } from '../store/plsatStore';
import { BrandLogo } from '../components/BrandLogo';
import { usePackConfigStore } from '../store/packConfigStore';
import { Link } from 'react-router-dom';

export function CertificateView() {
  const { certificates } = usePLSATStore();
  const config = usePackConfigStore((s) => s.config);

  const name = config?.branding.name ?? 'Paradigm University';
  const tagline = config?.branding.tagline ?? 'Lux in Codice';
  const isParadigm = !config || config.mode === 'paradigm';
  const certTitle = isParadigm ? `Universitas Paradigmatica — ${tagline}` : tagline;

  const passedCerts = certificates.filter((c) => c.passed);
  const latestPassed = passedCerts.length > 0
    ? passedCerts.reduce((latest, c) => new Date(c.date) > new Date(latest.date) ? c : latest)
    : null;

  if (!latestPassed) {
    return (
      <div className="certificate-container">
        <div className="empty-state">
          <BrandLogo size={80} />
          <h3 className="mt-lg">No Certificates Yet</h3>
          <p>Pass the PLSAT examination to earn your certification.</p>
          <Link to="/plsat" className="btn btn-primary mt-lg">
            Take the PLSAT
          </Link>
        </div>

        {certificates.length > 0 && (
          <div className="mt-xl">
            <h3 className="mb-md">Previous Attempts</h3>
            {certificates.map((cert, i) => (
              <div key={i} className="ref-card" style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    PLSAT v{cert.plsatVersion} — {cert.score}/{cert.total} ({cert.percentage}%)
                  </span>
                  <span className="text-muted">
                    {new Date(cert.date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="certificate-container">
      <div className="no-print text-center mb-lg">
        <button className="btn btn-gold" onClick={() => window.print()}>
          Print Certificate
        </button>
      </div>

      <div className="certificate">
        <BrandLogo size={100} className="cert-seal" />

        <h1>{name}</h1>
        <p className="cert-title">{certTitle}</p>

        <div className="gold-divider" />

        <p style={{ fontSize: '0.875rem', color: 'var(--ink-muted)', marginTop: 'var(--space-lg)' }}>
          This is to certify that
        </p>

        <div className="cert-name">{latestPassed.name}</div>

        <p className="cert-body">
          has successfully completed the<br />
          <strong>Paradigm Licensure Standardized Assessment Test</strong><br />
          and is hereby recognized as a certified Paradigm practitioner.
        </p>

        <p className="cert-score">
          Score: {latestPassed.score}/{latestPassed.total} ({latestPassed.percentage}%)
        </p>

        <div className="gold-divider" />

        <dl className="cert-meta">
          <div>
            <dt>PLSAT Version</dt>
            <dd>v{latestPassed.plsatVersion}</dd>
          </div>
          <div>
            <dt>Framework Version</dt>
            <dd>v{latestPassed.frameworkVersion}</dd>
          </div>
          <div>
            <dt>Date Issued</dt>
            <dd>{new Date(latestPassed.date).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric'
            })}</dd>
          </div>
        </dl>
      </div>

      {certificates.length > 1 && (
        <div className="no-print mt-xl">
          <h3 className="mb-md">All Attempts</h3>
          {[...certificates].reverse().map((cert, i) => (
            <div key={i} className="ref-card" style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  PLSAT v{cert.plsatVersion} — {cert.score}/{cert.total} ({cert.percentage}%)
                  {cert.passed ? ' ✓' : ''}
                </span>
                <span className="text-muted">
                  {new Date(cert.date).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
