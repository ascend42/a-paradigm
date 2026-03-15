/**
 * SentinelSection — Live observability dashboard with 4 sub-tabs
 *
 * Sub-tabs: Logs | Incidents | Events | Flows
 * Uses useSentinelWs() for real-time updates via Platform WS.
 */

import { useState } from 'react';
import { useSentinelWs } from './hooks/useSentinelWs';
import { LogsTab } from './components/LogsTab';
import { IncidentsTab } from './components/IncidentsTab';
import { EventsTab } from './components/EventsTab';
import { FlowsTab } from './components/FlowsTab';
import './styles/sentinel.css';

type SentinelTab = 'logs' | 'incidents' | 'events' | 'flows';

const TABS: { id: SentinelTab; label: string }[] = [
  { id: 'logs', label: 'Logs' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'events', label: 'Events' },
  { id: 'flows', label: 'Flows' },
];

export default function SentinelSection() {
  const [activeTab, setActiveTab] = useState<SentinelTab>('logs');

  // Wire up sentinel WS message forwarding
  useSentinelWs();

  return (
    <div className="sentinel-section">
      <div className="sentinel-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`sentinel-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="sentinel-tab-content">
        {activeTab === 'logs' && <LogsTab />}
        {activeTab === 'incidents' && <IncidentsTab />}
        {activeTab === 'events' && <EventsTab />}
        {activeTab === 'flows' && <FlowsTab />}
      </div>
    </div>
  );
}
