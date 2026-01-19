import React, { useState } from 'react';
import { FaTrash, FaUser, FaTasks } from 'react-icons/fa';

const AssigneeManagementItem = ({ assignee, allAssignees, tasks, onRemove, onReassign }) => {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedReassignTo, setSelectedReassignTo] = useState('');

  // Get tasks assigned to this assignee
  const assigneeTasks = tasks.filter(task => task.assignee === assignee.id);

  const handleRemoveClick = () => {
    if (assigneeTasks.length > 0) {
      setShowConfirmDialog(true);
    } else {
      // No tasks to reassign, remove directly
      onRemove(assignee.id);
    }
  };

  const handleConfirmRemove = () => {
    if (selectedReassignTo) {
      onReassign(assignee.id, selectedReassignTo);
    } else {
      onRemove(assignee.id);
    }
    setShowConfirmDialog(false);
    setSelectedReassignTo('');
  };

  const handleCancelRemove = () => {
    setShowConfirmDialog(false);
    setSelectedReassignTo('');
  };

  // Filter out the current assignee from reassignment options
  const availableAssignees = allAssignees.filter(a => a.id !== assignee.id);

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
                    value=""
                    checked={selectedReassignTo === ''}
                    onChange={(e) => setSelectedReassignTo(e.target.value)}
                  />
                  <span>Delete all tasks</span>
                </label>

                {availableAssignees.length > 0 && (
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="reassign"
                      value="reassign"
                      checked={selectedReassignTo === 'reassign'}
                      onChange={(e) => setSelectedReassignTo('reassign')}
                    />
                    <span>Reassign to:</span>
                  </label>
                )}

                {selectedReassignTo === 'reassign' && availableAssignees.length > 0 && (
                  <select
                    className="reassign-select"
                    value={selectedReassignTo}
                    onChange={(e) => setSelectedReassignTo(e.target.value)}
                  >
                    <option value="reassign" disabled>Select assignee...</option>
                    {availableAssignees.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
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
                disabled={selectedReassignTo === 'reassign' && !availableAssignees.some(a => a.id === selectedReassignTo)}
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