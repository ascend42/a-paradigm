import React, { useEffect } from 'react';
import { useTasksStore, type TaskView } from './store/tasksStore';
import { usePlatformStore } from '../../store/platformStore';
import { ListView } from './components/ListView';
import { BoardView } from './components/BoardView';
import { CalibrationStrip } from './components/CalibrationStrip';
import { FilterBar } from './components/FilterBar';
import { InboxView } from './components/InboxView';
import { GitHubSyncStrip } from './components/GitHubSyncStrip';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import './styles/tasks.css';

const VIEWS: { mode: TaskView; label: string }[] = [
  { mode: 'board', label: 'Board' },
  { mode: 'list', label: 'List' },
  { mode: 'inbox', label: 'Inbox' },
];

export default function TasksSection() {
  const view = useTasksStore((s) => s.view);
  const setView = useTasksStore((s) => s.setView);
  const board = useTasksStore((s) => s.board);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const fetchBoard = useTasksStore((s) => s.fetchBoard);
  const fetchCalibration = useTasksStore((s) => s.fetchCalibration);
  const fetchWhoami = useTasksStore((s) => s.fetchWhoami);

  useEffect(() => {
    fetchTasks();
    fetchBoard();
    fetchCalibration();
    fetchWhoami();
    const interval = setInterval(() => {
      if (usePlatformStore.getState().activeSection === 'tasks') {
        fetchTasks();
        fetchBoard();
        fetchCalibration();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Board summary leads the header stat when available; else fall back to list.
  const tasks = useTasksStore((s) => s.tasks);
  const openCount = board?.summary.open ?? tasks.filter((t) => t.status === 'open').length;
  const inFlightCount =
    board?.summary.inFlight ?? tasks.filter((t) => t.status === 'in-progress').length;
  const unclaimedCount = board?.summary.unclaimed ?? 0;

  return (
    <div className="tasks">
      <div className="tasks__header">
        <div>
          <span className="tasks__title">Tasks</span>
          <span className="tasks__stat">
            {openCount} open &middot; {inFlightCount} in-flight &middot; {unclaimedCount} unclaimed
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

      {view === 'board' && (
        <div className="tasks__board-controls">
          <CalibrationStrip />
          <FilterBar />
        </div>
      )}

      <main className={`tasks__main ${view === 'board' ? 'tasks__main--board' : ''}`}>
        {view === 'list' && <ListView />}
        {view === 'board' && <BoardView />}
        {view === 'inbox' && <InboxView />}
      </main>

      {view === 'board' && <GitHubSyncStrip />}

      <TaskDetailPanel />
    </div>
  );
}
