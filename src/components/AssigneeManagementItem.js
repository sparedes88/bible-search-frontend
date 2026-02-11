import React, { useState } from 'react';
import { FaTrash, FaUser, FaTasks } from 'react-icons/fa';

const AssigneeManagementItem = ({ assignee, allAssignees, tasks, onRemove, onReassign }) => {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [reassignMode, setReassignMode] = useState(false);
  const [selectedReassignTo, setSelectedReassignTo] = useState('');

  // Get tasks assigned to this assignee
  const assigneeTasks = tasks.filter(task =>
    task.assignee === assignee.name || task.assignee === assignee.id
  );

  const handleRemoveClick = () => {
    if (assigneeTasks.length > 0) {
      setShowConfirmDialog(true);
    } else {
      // No tasks to reassign, remove directly
      onRemove(assignee.id);
    }
  };

  const handleConfirmRemove = () => {
    if (reassignMode && selectedReassignTo) {
      onReassign(assignee.name || assignee.id, selectedReassignTo);
    } else {
      onRemove(assignee.name || assignee.id);
    }
    setShowConfirmDialog(false);
    setReassignMode(false);
    setSelectedReassignTo('');
  };

  const handleCancelRemove = () => {
    setShowConfirmDialog(false);
    setReassignMode(false);
    setSelectedReassignTo('');
  };

  // Filter out the current assignee from reassignment options
  const availableAssignees = allAssignees.filter(a => a.id !== assignee.id);

  const displayedTasks = assigneeTasks.slice(0, 5);
  const remainingTaskCount = assigneeTasks.length - displayedTasks.length;

  const badgeColors = [
    { bg: '#fee2e2', text: '#991b1b' },
    { bg: '#ffedd5', text: '#9a3412' },
    { bg: '#fef9c3', text: '#854d0e' },
    { bg: '#dcfce7', text: '#166534' },
    { bg: '#cffafe', text: '#155e75' },
    { bg: '#dbeafe', text: '#1e40af' },
    { bg: '#e0e7ff', text: '#3730a3' },
    { bg: '#f3e8ff', text: '#6b21a8' }
  ];

  const getBadgeColor = (key) => {
    if (!key) return badgeColors[0];
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % badgeColors.length;
    return badgeColors[index];
  };

  return (
    <>
      <div className="assignee-card">
        <div className="assignee-info">
          <div className="assignee-avatar">
            <FaUser />
          </div>
          <div className="assignee-details">
            <h3 className="assignee-name">{assignee.name}</h3>
            <p className="assignee-email">{assignee.email}</p>
            <div className="assignee-stats">
              <span className="task-count">
                <FaTasks /> {assigneeTasks.length} task{assigneeTasks.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
                Assigned tasks
              </div>
              {assigneeTasks.length === 0 ? (
                <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>None</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {displayedTasks.map(task => {
                    const colors = getBadgeColor(task.id || task.title);
                    return (
                    <li
                      key={task.id}
                      style={{
                        padding: '2px 8px',
                        backgroundColor: colors.bg,
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        color: colors.text
                      }}
                    >
                      {task.title}
                    </li>
                    );
                  })}
                  {remainingTaskCount > 0 && (
                    <li
                      style={{
                        padding: '2px 8px',
                        backgroundColor: '#e5e7eb',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        color: '#6b7280'
                      }}
                    >
                      +{remainingTaskCount} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
        <div className="assignee-actions">
          <button
            className="remove-assignee-btn"
            onClick={handleRemoveClick}
            title="Remove assignee"
          >
            <FaTrash />
          </button>
        </div>
      </div>

      {showConfirmDialog && (
        <div className="dialog-overlay">
          <div className="confirmation-dialog">
            <h3>Remove Assignee</h3>
            <p>
              {assignee.name} has {assigneeTasks.length} task{assigneeTasks.length !== 1 ? 's' : ''} assigned.
              {assigneeTasks.length > 0 && ' What would you like to do with these tasks?'}
            </p>

            {assigneeTasks.length > 0 && (
              <div className="reassign-options">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="reassign"
                    value="delete"
                    checked={!reassignMode}
                    onChange={() => {
                      setReassignMode(false);
                      setSelectedReassignTo('');
                    }}
                  />
                  <span>Delete all tasks</span>
                </label>

                {availableAssignees.length > 0 && (
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="reassign"
                      value="reassign"
                      checked={reassignMode}
                      onChange={() => setReassignMode(true)}
                    />
                    <span>Reassign to:</span>
                  </label>
                )}

                {reassignMode && availableAssignees.length > 0 && (
                  <select
                    className="reassign-select"
                    value={selectedReassignTo}
                    onChange={(e) => setSelectedReassignTo(e.target.value)}
                  >
                    <option value="" disabled>Select assignee...</option>
                    {availableAssignees.map(a => (
                      <option key={a.id} value={a.name}>{a.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="dialog-actions">
              <button
                className="cancel-btn"
                onClick={handleCancelRemove}
              >
                Cancel
              </button>
              <button
                className="confirm-btn"
                onClick={handleConfirmRemove}
                disabled={reassignMode && !selectedReassignTo}
              >
                {assigneeTasks.length === 0 ? 'Remove' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AssigneeManagementItem;