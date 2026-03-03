import React, { useMemo, useState } from 'react';
import './TaskGantt.css';

const DEFAULT_STATUS_OPTIONS = ['all', 'todo', 'in-progress', 'review', 'completed'];
const DEFAULT_ACTUAL_START_STATUSES = ['in-progress', 'review', 'completed'];
const DEFAULT_COMPLETED_STATUSES = ['completed'];

const toDateValue = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatShortDate = (date) => {
  if (!date) return '—';
  return date.toLocaleDateString();
};

const getPersonLabel = (task, users, resolver) => {
  if (resolver) return resolver(task, users);
  if (task.assignedTo) return task.assignedTo;
  const matchedUser = users.find(user => user.id === task.userId);
  return matchedUser?.name || matchedUser?.email || 'Unassigned';
};

const getActualDates = (task, actualStartStatuses, completedStatuses) => {
  const logEntries = Array.isArray(task.statusChangeLog) ? task.statusChangeLog : [];
  const normalized = logEntries
    .map(entry => ({
      ...entry,
      changedAt: toDateValue(entry.changedAt)
    }))
    .filter(entry => entry.changedAt);

  const progressStart = normalized
    .filter(entry => actualStartStatuses.includes(entry.newStatus))
    .sort((a, b) => a.changedAt - b.changedAt)[0]?.changedAt || null;

  const completedEntry = normalized
    .filter(entry => completedStatuses.includes(entry.newStatus))
    .sort((a, b) => a.changedAt - b.changedAt)[0]?.changedAt || null;

  const fallbackUpdatedAt = toDateValue(task.updatedAt);
  const actualStart = progressStart
    || (actualStartStatuses.includes(task.status) ? fallbackUpdatedAt : null);
  const isCompleted = completedStatuses.includes(task.status);
  const isInProgress = actualStartStatuses.includes(task.status) && !isCompleted;
  const actualEnd = completedEntry
    || (isCompleted ? fallbackUpdatedAt : null)
    || (isInProgress && actualStart ? new Date() : null);

  return { actualStart, actualEnd };
};

const TaskGantt = ({
  tasks,
  users = [],
  statusOptions = DEFAULT_STATUS_OPTIONS,
  actualStartStatuses = DEFAULT_ACTUAL_START_STATUSES,
  completedStatuses = DEFAULT_COMPLETED_STATUSES,
  personLabelResolver
}) => {
  const [statusFilter, setStatusFilter] = useState('all');
  const [personFilter, setPersonFilter] = useState('all');
  const normalizedStatusOptions = statusOptions.includes('all')
    ? statusOptions
    : ['all', ...statusOptions];

  const rows = useMemo(() => {
    return tasks.map(task => {
      const plannedStart = toDateValue(task.startDate) || toDateValue(task.createdAt) || null;
      const plannedEnd = toDateValue(task.dueDate) || plannedStart || null;
      const { actualStart, actualEnd } = getActualDates(
        task,
        actualStartStatuses,
        completedStatuses
      );
      const person = getPersonLabel(task, users, personLabelResolver);

      return {
        id: task.id,
        title: task.title || 'Untitled Task',
        status: task.status || 'todo',
        person,
        plannedStart,
        plannedEnd,
        actualStart,
        actualEnd
      };
    });
  }, [tasks, users]);

  const personOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.map(row => row.person))).filter(Boolean);
    return ['all', ...unique];
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter(row => {
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }
      if (personFilter !== 'all' && row.person !== personFilter) {
        return false;
      }
      return true;
    });
  }, [rows, statusFilter, personFilter]);

  const { chartStart, chartEnd } = useMemo(() => {
    const dates = [];
    visibleRows.forEach(row => {
      if (row.plannedStart) dates.push(row.plannedStart);
      if (row.plannedEnd) dates.push(row.plannedEnd);
      if (row.actualStart) dates.push(row.actualStart);
      if (row.actualEnd) dates.push(row.actualEnd);
    });

    if (dates.length === 0) {
      const today = new Date();
      const end = new Date(today);
      end.setDate(end.getDate() + 14);
      return { chartStart: today, chartEnd: end };
    }

    const minDate = new Date(Math.min(...dates.map(date => date.getTime())));
    const maxDate = new Date(Math.max(...dates.map(date => date.getTime())));
    const paddedEnd = new Date(maxDate);
    paddedEnd.setDate(paddedEnd.getDate() + 2);
    const paddedStart = new Date(minDate);
    paddedStart.setDate(paddedStart.getDate() - 2);

    return { chartStart: paddedStart, chartEnd: paddedEnd };
  }, [visibleRows]);

  const statusOrder = useMemo(() => {
    return statusOptions.filter(option => option && option !== 'all');
  }, [statusOptions]);

  const formatStatusLabel = (value) => {
    if (!value) return '';
    return String(value)
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  };

  const getRemainingStatuses = (status) => {
    if (!statusOrder.length) return [];
    const completedIndex = statusOrder.indexOf('completed');
    const endIndex = completedIndex === -1 ? statusOrder.length : completedIndex;
    if (status === 'show-stoppers') {
      return statusOrder.slice(0, endIndex);
    }
    const currentIndex = statusOrder.indexOf(status);
    if (currentIndex === -1 || endIndex <= currentIndex) {
      return [];
    }
    return statusOrder.slice(currentIndex + 1, endIndex);
  };

  const getTotalDays = (start, end) => {
    if (!start || !end) return '—';
    const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    if (Number.isNaN(startUtc) || Number.isNaN(endUtc) || endUtc < startUtc) {
      return '—';
    }

    let workDays = 0;
    let cursor = new Date(startUtc);
    const endDate = new Date(endUtc);
    while (cursor <= endDate) {
      const dayOfWeek = cursor.getUTCDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workDays += 1;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return `${workDays}d`;
  };

  return (
    <div className="gantt-container">
      <div className="gantt-header">
        <div>
          <h2>Gantt Schedule</h2>
          <div className="gantt-range">
            {formatShortDate(chartStart)} - {formatShortDate(chartEnd)}
          </div>
        </div>
        <div className="gantt-filters">
          <label>
            Person
            <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
              {personOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {normalizedStatusOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="gantt-legend">
        <span className="legend-item">
          <span className="legend-swatch planned"></span>
          Remaining statuses before completed
        </span>
        <span className="legend-item">
          <span className="legend-swatch actual"></span>
          Show stopper
        </span>
      </div>

      {visibleRows.length === 0 ? (
        <div className="gantt-empty">No tasks match the selected filters.</div>
      ) : (
        <div className="gantt-table">
          <div className="gantt-row gantt-header-row">
            <div className="gantt-col task">Task</div>
            <div className="gantt-col person">Person</div>
            <div className="gantt-col status">Status</div>
            <div className="gantt-col dates">Planned</div>
            <div className="gantt-col days">Days</div>
            <div className="gantt-col timeline">Remaining</div>
          </div>

          {visibleRows.map(row => {
            const remainingStatuses = getRemainingStatuses(row.status);
            const showStopper = row.status === 'show-stoppers';
            return (
              <div key={row.id} className="gantt-row">
                <div className="gantt-col task">
                  <div className="task-title">{row.title}</div>
                </div>
                <div className="gantt-col person">{row.person}</div>
                <div className="gantt-col status">
                  <span className={`status-pill ${row.status}`}>{row.status}</span>
                </div>
                <div className="gantt-col dates">
                  <div>{formatShortDate(row.plannedStart)}</div>
                  <div className="secondary">{formatShortDate(row.plannedEnd)}</div>
                </div>
                <div className="gantt-col days">
                  {getTotalDays(row.plannedStart, row.plannedEnd)}
                </div>
                <div className="gantt-col timeline">
                  <div className="gantt-status-track">
                    {remainingStatuses.length === 0 ? (
                      <div className={`status-empty ${showStopper ? 'show-stopper' : ''}`}>
                        {showStopper ? 'Show stopper' : 'Completed'}
                      </div>
                    ) : (
                      remainingStatuses.map((statusValue) => (
                        <span
                          key={statusValue}
                          className={`status-segment ${showStopper ? 'show-stopper' : ''}`}
                          title={formatStatusLabel(statusValue)}
                        >
                          {formatStatusLabel(statusValue)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TaskGantt;
