import React, { useEffect, useState } from 'react';

interface OverviewStats {
  symbols: { total: number; byType?: Record<string, number> };
  lore: { total: number };
  health: { purposeCoverage?: number };
}

export function OverviewSection() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [symbolsRes, loreRes] = await Promise.all([
          fetch('/api/symbols'),
          fetch('/api/lore'),
        ]);

        const symbols = symbolsRes.ok ? await symbolsRes.json() : { symbols: [] };
        const lore = loreRes.ok ? await loreRes.json() : { entries: [] };

        const symbolList = symbols.symbols || symbols.index?.symbols || [];
        const entries = lore.entries || lore || [];

        setStats({
          symbols: { total: Array.isArray(symbolList) ? symbolList.length : 0 },
          lore: { total: Array.isArray(entries) ? entries.length : 0 },
          health: {},
        });
      } catch {
        setStats({ symbols: { total: 0 }, lore: { total: 0 }, health: {} });
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="overview">
        <h1 className="overview__title">Overview</h1>
        <p style={{ color: 'var(--p-text-muted)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="overview">
      <h1 className="overview__title">Overview</h1>

      <div className="overview__cards">
        <div className="stat-card">
          <div className="stat-card__value">{stats?.symbols.total ?? 0}</div>
          <div className="stat-card__label">Symbols</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{stats?.lore.total ?? 0}</div>
          <div className="stat-card__label">Lore Entries</div>
        </div>
      </div>

      <div className="overview__section-title">Quick Links</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <a href="/api/lore" target="_blank" rel="noopener" style={{ color: 'var(--p-accent-blue)', fontSize: 13 }}>/api/lore</a>
        <a href="/api/symbols" target="_blank" rel="noopener" style={{ color: 'var(--p-accent-blue)', fontSize: 13 }}>/api/symbols</a>
        <a href="/api/platform/health" target="_blank" rel="noopener" style={{ color: 'var(--p-accent-blue)', fontSize: 13 }}>/api/platform/health</a>
      </div>
    </div>
  );
}
