/**
 * SymphonySection — Live agent-to-agent communication dashboard
 *
 * Sub-tabs: Threads | Network | Files
 * Uses useSymphonyWs() for real-time updates via Platform WS.
 * Polls: 3s for active thread, 10s for thread list + network.
 */

import { useEffect, useRef } from 'react';
import { useSymphonyWs } from './hooks/useSymphonyWs';
import { useSymphonyStore, type SymphonyTab } from './store/symphonyStore';
import { ThreadsTab } from './components/ThreadsTab';
import { NetworkTab } from './components/NetworkTab';
import { FilesTab } from './components/FilesTab';
import './styles/symphony.css';

const TABS: { id: SymphonyTab; label: string }[] = [
  { id: 'threads', label: 'Threads' },
  { id: 'network', label: 'Network' },
  { id: 'files', label: 'Files' },
];

export default function SymphonySection() {
  const activeTab = useSymphonyStore(s => s.activeTab);
  const setActiveTab = useSymphonyStore(s => s.setActiveTab);
  const refresh = useSymphonyStore(s => s.refresh);
  const fetchThread = useSymphonyStore(s => s.fetchThread);
  const fetchFileRequests = useSymphonyStore(s => s.fetchFileRequests);
  const activeThreadId = useSymphonyStore(s => s.activeThreadId);
  const status = useSymphonyStore(s => s.status);

  // Wire up symphony WS message forwarding
  useSymphonyWs();

  // Initial fetch
  useEffect(() => {
    refresh();
    useSymphonyStore.getState().fetchMyIdentity();
    useSymphonyStore.getState().fetchFileRequests();
  }, []);

  // Poll: 10s for thread list + network + status
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const interval = setInterval(() => refreshRef.current(), 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll: 3s for active thread
  const activeThreadRef = useRef(activeThreadId);
  activeThreadRef.current = activeThreadId;
  const fetchThreadRef = useRef(fetchThread);
  fetchThreadRef.current = fetchThread;
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeThreadRef.current) {
        fetchThreadRef.current(activeThreadRef.current);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll: 10s for file requests when on files tab
  useEffect(() => {
    if (activeTab !== 'files') return;
    const interval = setInterval(() => fetchFileRequests(), 10000);
    return () => clearInterval(interval);
  }, [activeTab, fetchFileRequests]);

  return (
    <div className="symphony-section">
      <div className="symphony-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`symphony-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'threads' && status && status.activeThreadCount > 0 && (
              <span className="tab-badge">{status.activeThreadCount}</span>
            )}
            {tab.id === 'files' && status && status.pendingFileRequests > 0 && (
              <span className="tab-badge">{status.pendingFileRequests}</span>
            )}
          </button>
        ))}
      </div>
      <div className="symphony-tab-content">
        {activeTab === 'threads' && <ThreadsTab />}
        {activeTab === 'network' && <NetworkTab />}
        {activeTab === 'files' && <FilesTab />}
      </div>
    </div>
  );
}
