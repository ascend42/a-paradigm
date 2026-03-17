import type { PortalData } from '@/lib/docs-data';
import { SymbolBadge } from '@/components/SymbolBadge';
import styles from './PortalPage.module.css';

interface PortalPageProps {
  data: PortalData;
}

export function PortalPage({ data }: PortalPageProps) {
  return (
    <article className={styles.article}>
      <h1 className={styles.title}>Portal Reference</h1>
      <p className={styles.description}>
        Authorization gates and protected routes defined in{' '}
        <code className={styles.inlineCode}>portal.yaml</code>.
        Gates are checkpoints that enforce access control at route boundaries.
      </p>

      {/* Gates */}
      {data.gates.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Gates</h2>
          <div className={styles.gateGrid}>
            {data.gates.map(gate => (
              <div key={gate.id} className={styles.gateCard}>
                <div className={styles.gateHeader}>
                  <SymbolBadge type="gate" name={gate.id} size="sm" />
                  {gate.type && (
                    <span className={styles.gateType}>{gate.type}</span>
                  )}
                </div>
                <p className={styles.gateDescription}>{gate.description}</p>
                {gate.check && (
                  <code className={styles.gateCheck}>{gate.check}</code>
                )}
                {gate.requires && gate.requires.length > 0 && (
                  <div className={styles.gateRequires}>
                    <span className={styles.requiresLabel}>Requires:</span>
                    {gate.requires.map(r => (
                      <SymbolBadge key={r} type="gate" name={r} size="sm" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Routes */}
      {data.routes.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Protected Routes</h2>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Method</th>
                  <th className={styles.th}>Route</th>
                  <th className={styles.th}>Gates</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.map((route, i) => (
                  <tr key={i} className={styles.tr}>
                    <td className={styles.td}>
                      <span className={`${styles.method} ${styles[`method${route.method}`] || ''}`}>
                        {route.method}
                      </span>
                    </td>
                    <td className={styles.td}>
                      <code className={styles.routePath}>{route.route}</code>
                    </td>
                    <td className={styles.td}>
                      <div className={styles.routeGates}>
                        {route.gates.map(g => (
                          <SymbolBadge key={g} type="gate" name={g} size="sm" />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.gates.length === 0 && data.routes.length === 0 && (
        <div className={styles.empty}>
          <p>No portal.yaml files found in this project.</p>
        </div>
      )}
    </article>
  );
}
