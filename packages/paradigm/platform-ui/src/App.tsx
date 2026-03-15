import React, { useEffect, lazy, Suspense } from 'react';
import { usePlatformStore } from './store/platformStore';
import { SidebarNav } from './components/SidebarNav';
import { PlatformHeader } from './components/PlatformHeader';
import { OverviewSection } from './sections/overview/OverviewSection';
import { AgentToastContainer } from './components/AgentToast';
import { AgentCalloutOverlay, AgentNavigationPrompt } from './components/AgentCallout';
import { useAgentEffects } from './hooks/useAgentEffects';
import { useActivityReporter } from './hooks/useActivityReporter';
import './styles/agent.css';

const LoreSection = lazy(() => import('./sections/lore/LoreSection'));
const GraphSection = lazy(() => import('./sections/graph/GraphSection'));
const GitSection = lazy(() => import('./sections/git/GitSection'));
const SentinelSection = lazy(() => import('./sections/sentinel/SentinelSection'));
const SymphonySection = lazy(() => import('./sections/symphony/SymphonySection'));

function SectionFallback() {
  return (
    <div style={{ padding: 24, color: 'var(--p-text-muted)' }}>
      Loading section...
    </div>
  );
}

function ComingSoonSection({ name, icon, description }: { name: string; icon: string; description: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'var(--p-text-muted)' }}>
      <span style={{ fontSize: 48 }}>{icon}</span>
      <h2 style={{ margin: 0, color: 'var(--p-text-primary)', fontSize: 24 }}>{name}</h2>
      <p style={{ margin: 0, maxWidth: 400, textAlign: 'center', lineHeight: 1.5 }}>{description}</p>
      <span style={{ fontSize: 13, opacity: 0.6 }}>Coming in Platform Phase 2</span>
    </div>
  );
}

export default function App() {
  const activeSection = usePlatformStore(s => s.activeSection);
  const theme = usePlatformStore(s => s.theme);
  const fetchPlatformInfo = usePlatformStore(s => s.fetchPlatformInfo);

  // Agent-driven UI: WebSocket connection + effect handling
  const wsRef = useAgentEffects();
  useActivityReporter(wsRef);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    fetchPlatformInfo();

    // Handle browser back/forward
    const handlePopState = () => {
      const path = window.location.pathname.slice(1) || 'overview';
      const validSections = ['overview', 'lore', 'graph', 'git', 'sentinel', 'university', 'symphony'];
      if (validSections.includes(path)) {
        usePlatformStore.getState().setActiveSection(path as any);
      }
    };

    // Set initial section from URL
    handlePopState();

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div className="shell">
      <SidebarNav />
      <div className="main">
        <PlatformHeader />
        <div className="content">
          <Suspense fallback={<SectionFallback />}>
            {activeSection === 'overview' && <OverviewSection />}
            {activeSection === 'lore' && <LoreSection />}
            {activeSection === 'graph' && <GraphSection />}
            {activeSection === 'git' && <GitSection />}
            {activeSection === 'sentinel' && <SentinelSection />}
            {activeSection === 'university' && <ComingSoonSection name="University" icon="▣" description="Courses, quizzes, learning paths, and PLSAT certification" />}
            {activeSection === 'symphony' && <SymphonySection />}
          </Suspense>
        </div>
      </div>
      {/* Agent-driven UI overlays */}
      <AgentNavigationPrompt />
      <AgentToastContainer />
      <AgentCalloutOverlay />
    </div>
  );
}
