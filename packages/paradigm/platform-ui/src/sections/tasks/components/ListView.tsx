import React from 'react';
import { useTasksStore, type TaskPriority } from '../store/tasksStore';
import { TaskCard } from './TaskCard';

// Priority rank for the vertical list ordering (high first).
const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function ListView() {
  const tasks = useTasksStore((s) => s.tasks);
  const loading = useTasksStore((s) => s.loading);
  const error = useTasksStore((s) => s.error);

  if (loading && tasks.length === 0) {
    return <p className="tasks__empty">Loading tasks…</p>;
  }

  if (error && tasks.length === 0) {
    return <p className="tasks__empty">Could not load tasks: {error}</p>;
  }

  if (tasks.length === 0) {
    return <p className="tasks__empty">No active tasks</p>;
  }

  const ranked = [...tasks].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  );

  return (
    <div className="tasks__list">
      {ranked.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
}
