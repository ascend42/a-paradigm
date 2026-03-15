import React, { useEffect } from 'react';
import { useOverviewStore } from './store/overviewStore';
import { StatCard } from './components/StatCard';
import { HealthBar } from './components/HealthBar';
import { ActivityFeed } from './components/ActivityFeed';
import { usePlatformStore } from '../../store/platformStore';
import './styles/overview.css';

const SYMBOL_TYPE_LABELS: Record<string, string> = {
  component: '#',
  flow: '$',
  gate: '^',
  signal: '!',
  aspect: '~',
};

function formatByType(byType: Record<string, number>): string {
  return Object.entries(byType)
    .map(([k, v]) => `${SYMBOL_TYPE_LABELS[k] || ''}${v}`)
    .join(' · ');
}

export function OverviewSection() {
  const { data, loading, fetchOverview } = useOverviewStore();
  const setActiveSection = usePlatformStore(s => s.setActiveSection);

  useEffect(() => {
    fetchOverview();
  }, []);

  if (loading && !data) {
    return (
      <div className="overview">
        <h1 className="overview__title">Overview</h1>
        <p style={{ color: 'var(--p-text-muted)' }}>Loading...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="overview">
        <h1 className="overview__title">Overview</h1>
        <p style={{ color: 'var(--p-text-muted)' }}>Could not load overview data.</p>
      </div>
    );
  }

  const overallHealth = (
    data.health.purposeCoverage +
    data.health.aspectAnchors +
    data.health.gateCompliance +
    data.health.calibration
  ) / 4;

  return (
    <div className="overview">
      <h1 className="overview__title">
        Overview
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--p-text-muted)', marginLeft: 12 }}>
          {data.project.branch}
        </span>
      </h1>

      <div className="overview__cards">
        <StatCard
          value={data.symbols.total}
          label="Symbols"
          detail={formatByType(data.symbols.byType)}
          accent="var(--p-accent-blue)"
          onClick={() => setActiveSection('graph')}
        />
        <StatCard
          value={data.lore.total}
          label="Lore Entries"
          detail={`${data.lore.thisWeek} this week`}
          accent="var(--p-accent-purple)"
          onClick={() => setActiveSection('lore')}
        />
        <StatCard
          value={data.calibration.score !== null ? `${Math.round(data.calibration.score * 100)}%` : '--'}
          label="Calibration"
          detail={`${data.calibration.assessed} assessed`}
          accent="var(--p-accent-orange)"
        />
        <StatCard
          value={data.tasks.total}
          label="Tasks"
          detail={`${data.tasks.inProgress} active · ${data.tasks.completed} done`}
          accent="var(--p-accent-green)"
        />
        <StatCard
          value={`${Math.round(overallHealth * 100)}%`}
          label="Health"
          detail="Overall project health"
        />
        <StatCard
          value={data.recentActivity.length}
          label="Recent Activity"
          detail="Commits + lore"
        />
      </div>

      <div className="overview__section-title">Project Health</div>
      <div className="overview__health">
        <HealthBar label="Purpose Coverage" value={data.health.purposeCoverage} />
        <HealthBar label="Aspect Anchors" value={data.health.aspectAnchors} />
        <HealthBar label="Gate Compliance" value={data.health.gateCompliance} />
        <HealthBar label="Calibration" value={data.health.calibration} />
        <HealthBar
          label="Lore Freshness"
          value={data.health.loreFreshnessDays <= 7 ? 1.0 : data.health.loreFreshnessDays <= 30 ? 0.5 : 0.2}
        />
      </div>

      <div className="overview__activity">
        <div className="overview__section-title">Recent Activity</div>
        <ActivityFeed items={data.recentActivity} />
      </div>
    </div>
  );
}
