import React, { useEffect } from 'react';
import { useTasksStore, type TaskView } from './store/tasksStore';
import { usePlatformStore } from '../../store/platformStore';
import { ListView } from './components/ListView';
import './styles/tasks.css';

const VIEWS: { mode: TaskView; label: string }[] = [
  { mode: 'board', label: 'Board' },
  { mode: 'list', label: 'List' },
  { mode: 'inbox', label: 'Inbox' },
];

function ComingNext({ label }: { label: string }) {
  return (
    <div className="tasks__placeholder">
      <span className="tasks__placeholder-title">{label}</span>
      <span className="tasks__placeholder-sub">coming next</span>
    </div>
  );
}

export default function TasksSection() {
  const view = useTasksStore((s) => s.view);
  const setView = useTasksStore((s) => s.setView);
  const tasks = useTasksStore((s) => s.tasks);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(() => {
      if (usePlatformStore.getState().activeSection === 'tasks') {
        fetchTasks();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const openCount = tasks.filter((t) => t.status === 'open').length;
  const inFlightCount = tasks.filter((t) => t.status === 'in-progress').length;

  return (
    <div className="tasks">
      <div className="tasks__header">
        <div>
          <span className="tasks__title">Tasks</span>
          <span className="tasks__stat">
            {openCount} open &middot; {inFlightCount} in-flight
          </span>
        </div>
        <div className="view-switcher">
          {VIEWS.map((v) => (
            <button
              key={v.mode}
              className={`view-tab ${view === v.mode ? 'active' : ''}`}
              onClick={() => setView(v.mode)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <main className="tasks__main">
        {view === 'list' && <ListView />}
        {view === 'board' && <ComingNext label="Board" />}
        {view === 'inbox' && <ComingNext label="Inbox" />}
      </main>
    </div>
  );
}
