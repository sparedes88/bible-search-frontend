import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion, arrayRemove, addDoc, writeBatch } from 'firebase/firestore';
import { toast } from 'react-toastify';
import Select from 'react-select';
import './MyTeam.css';

const MyTeam = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [editingSalary, setEditingSalary] = useState(null);
  const [newSalary, setNewSalary] = useState('');
  const [salaryNote, setSalaryNote] = useState('');
  const [showSalaryHistory, setShowSalaryHistory] = useState(null);
  const [newExpectedHours, setNewExpectedHours] = useState('');
  
  // Expenses tab state
  const [activeTab, setActiveTab] = useState('team'); // 'team' or 'expenses'
  const [expenses, setExpenses] = useState([]);
  const [viewPeriod, setViewPeriod] = useState('week'); // 'week', 'biweekly', 'month'
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [newExpense, setNewExpense] = useState({
    userId: '',
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    category: 'Other'
  });

  // Fetch all users in the church
  useEffect(() => {
    const fetchUsers = async () => {
      if (!id) return;

      try {
        setLoading(true);
        const usersRef = collection(db, 'users');
        const usersQuery = query(usersRef, where('churchId', '==', id));
        const usersSnap = await getDocs(usersQuery);

        const usersList = usersSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setUsers(usersList);
      } catch (error) {
        console.error('Error fetching users:', error);
        toast.error('Failed to load team members');
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [id]);

  // Fetch all projects in the church
  useEffect(() => {
    const fetchProjects = async () => {
      if (!id) return;

      try {
        const projectsRef = collection(db, `churches/${id}/projects`);
        const projectsSnap = await getDocs(projectsRef);

        const projectsList = projectsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setProjects(projectsList);
      } catch (error) {
        console.error('Error fetching projects:', error);
        toast.error('Failed to load projects');
      }
    };

    fetchProjects();
  }, [id]);

  // Fetch expenses
  useEffect(() => {
    const fetchExpenses = async () => {
      if (!id) return;

      try {
        const expensesRef = collection(db, `churches/${id}/employeeExpenses`);
        const expensesSnap = await getDocs(expensesRef);

        const expensesList = expensesSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setExpenses(expensesList);
      } catch (error) {
        console.error('Error fetching expenses:', error);
        toast.error('Failed to load expenses');
      }
    };

    if (activeTab === 'expenses') {
      fetchExpenses();
    }
  }, [id, activeTab]);

  // Helper functions for date calculations
  const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };

  const getWeekEnd = (date) => {
    const start = getWeekStart(date);
    return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  };

  const getBiWeeklyStart = (date) => {
    const weekStart = getWeekStart(date);
    const weekNumber = Math.floor((weekStart - getWeekStart(new Date(weekStart.getFullYear(), 0, 1))) / (7 * 24 * 60 * 60 * 1000));
    const isOddWeek = weekNumber % 2 === 1;
    if (isOddWeek) {
      return new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    return weekStart;
  };

  const getBiWeeklyEnd = (date) => {
    const start = getBiWeeklyStart(date);
    return new Date(start.getTime() + 13 * 24 * 60 * 60 * 1000);
  };

  const getMonthStart = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  };

  const getMonthEnd = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  };

  const getPeriodRange = () => {
    switch (viewPeriod) {
      case 'week':
        return {
          start: getWeekStart(selectedDate),
          end: getWeekEnd(selectedDate)
        };
      case 'biweekly':
        return {
          start: getBiWeeklyStart(selectedDate),
          end: getBiWeeklyEnd(selectedDate)
        };
      case 'month':
        return {
          start: getMonthStart(selectedDate),
          end: getMonthEnd(selectedDate)
        };
      default:
        return { start: new Date(), end: new Date() };
    }
  };

  const filterExpensesByPeriod = (expenses) => {
    const { start, end } = getPeriodRange();
    return expenses.filter(expense => {
      const expenseDate = new Date(expense.date);
      return expenseDate >= start && expenseDate <= end;
    });
  };

  const groupExpensesByUser = (expenses) => {
    const grouped = {};
    expenses.forEach(expense => {
      if (!grouped[expense.userId]) {
        grouped[expense.userId] = [];
      }
      grouped[expense.userId].push(expense);
    });
    return grouped;
  };

  const handleEditProjects = (userId) => {
    // Find all projects where this user is in assignedUsers array
    const userProjectIds = projects
      .filter(p => p.assignedUsers && p.assignedUsers.includes(userId))
      .map(p => p.id);
    
    setEditingUser(userId);
    setSelectedProjects(userProjectIds);
  };

  const handleEditSalary = (userId, currentSalary, currentHours) => {
    setEditingSalary(userId);
    setNewSalary(currentSalary || '');
    setNewExpectedHours(currentHours || '');
    setSalaryNote('');
  };

  const handleSaveSalary = async (userId) => {
    try {
      const salaryAmount = parseFloat(newSalary);
      const expectedHours = parseFloat(newExpectedHours);
      
      if (isNaN(salaryAmount) || salaryAmount < 0) {
        toast.error('Please enter a valid salary amount');
        return;
      }

      if (newExpectedHours && (isNaN(expectedHours) || expectedHours < 0)) {
        toast.error('Please enter valid expected hours');
        return;
      }

      const userRef = doc(db, 'users', userId);
      const currentUser = users.find(u => u.id === userId);
      
      // Create salary adjustment log entry
      const adjustment = {
        previousSalary: currentUser?.salary || 0,
        newSalary: salaryAmount,
        previousExpectedHours: currentUser?.expectedHoursPerWeek || 0,
        newExpectedHours: expectedHours || 0,
        adjustedBy: user.email,
        adjustedAt: new Date().toISOString(),
        note: salaryNote || 'Salary/Hours updated'
      };

      // Update user document with new salary, hours, and add to history
      const updateData = {
        salary: salaryAmount,
        salaryHistory: arrayUnion(adjustment)
      };
      
      if (newExpectedHours) {
        updateData.expectedHoursPerWeek = expectedHours;
      }

      await updateDoc(userRef, updateData);

      // Update local state
      setUsers(users.map(u => 
        u.id === userId 
          ? { 
              ...u, 
              salary: salaryAmount,
              expectedHoursPerWeek: expectedHours || u.expectedHoursPerWeek,
              salaryHistory: [...(u.salaryHistory || []), adjustment]
            }
          : u
      ));

      setEditingSalary(null);
      setNewSalary('');
      setNewExpectedHours('');
      setSalaryNote('');
      toast.success('Salary and hours updated successfully!');
    } catch (error) {
      console.error('Error updating salary:', error);
      toast.error('Failed to update salary');
    }
  };

  const handleSaveProjects = async (userId) => {
    try {
      // Get current projects for this user
      const userProjects = projects.filter(p => 
        p.assignedUsers && p.assignedUsers.includes(userId)
      ).map(p => p.id);

      // Find projects to add (in selectedProjects but not in userProjects)
      const projectsToAdd = selectedProjects.filter(pid => !userProjects.includes(pid));
      
      // Find projects to remove (in userProjects but not in selectedProjects)
      const projectsToRemove = userProjects.filter(pid => !selectedProjects.includes(pid));

      // Update each project's assignedUsers array
      const updatePromises = [];

      for (const projectId of projectsToAdd) {
        const projectRef = doc(db, `churches/${id}/projects`, projectId);
        updatePromises.push(
          updateDoc(projectRef, {
            assignedUsers: arrayUnion(userId)
          })
        );
      }

      for (const projectId of projectsToRemove) {
        const projectRef = doc(db, `churches/${id}/projects`, projectId);
        updatePromises.push(
          updateDoc(projectRef, {
            assignedUsers: arrayRemove(userId)
          })
        );
      }

      await Promise.all(updatePromises);

      // Refresh projects data
      const projectsRef = collection(db, `churches/${id}/projects`);
      const projectsSnap = await getDocs(projectsRef);
      const updatedProjects = projectsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setProjects(updatedProjects);

      setEditingUser(null);
      setSelectedProjects([]);
      toast.success('Project assignments updated successfully!');
    } catch (error) {
      console.error('Error updating projects:', error);
      toast.error('Failed to update project assignments');
    }
  };

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case 'global_admin':
        return 'role-badge global-admin';
      case 'admin':
        return 'role-badge admin';
      case 'member':
        return 'role-badge member';
      default:
        return 'role-badge';
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'global_admin':
        return 'Global Admin';
      case 'admin':
        return 'Admin';
      case 'member':
        return 'Member';
      default:
        return role || 'Unknown';
    }
  };

  // Expense handlers
  const handleAddExpense = async () => {
    try {
      if (!newExpense.userId || !newExpense.amount || !newExpense.description) {
        toast.error('Please fill in all required fields');
        return;
      }

      const expenseData = {
        ...newExpense,
        amount: parseFloat(newExpense.amount),
        isPaid: false,
        createdAt: new Date().toISOString(),
        createdBy: user.email
      };

      const expensesRef = collection(db, `churches/${id}/employeeExpenses`);
      const docRef = await addDoc(expensesRef, expenseData);

      setExpenses([...expenses, { id: docRef.id, ...expenseData }]);
      setShowAddExpense(false);
      setNewExpense({
        userId: '',
        amount: '',
        description: '',
        date: new Date().toISOString().split('T')[0],
        category: 'Other'
      });
      toast.success('Expense added successfully!');
    } catch (error) {
      console.error('Error adding expense:', error);
      toast.error('Failed to add expense');
    }
  };

  const handleMarkExpensePaid = async (expenseId, isPaid) => {
    try {
      const expenseRef = doc(db, `churches/${id}/employeeExpenses`, expenseId);
      await updateDoc(expenseRef, {
        isPaid: isPaid,
        paidAt: isPaid ? new Date().toISOString() : null,
        paidBy: isPaid ? user.email : null
      });

      setExpenses(expenses.map(exp =>
        exp.id === expenseId
          ? { ...exp, isPaid, paidAt: isPaid ? new Date().toISOString() : null, paidBy: isPaid ? user.email : null }
          : exp
      ));

      toast.success(`Expense marked as ${isPaid ? 'paid' : 'unpaid'}`);
    } catch (error) {
      console.error('Error updating expense:', error);
      toast.error('Failed to update expense');
    }
  };

  const handleBulkMarkPaid = async (userId) => {
    try {
      const { start, end } = getPeriodRange();
      const userExpenses = expenses.filter(expense => {
        const expenseDate = new Date(expense.date);
        return expense.userId === userId &&
          !expense.isPaid &&
          expenseDate >= start &&
          expenseDate <= end;
      });

      if (userExpenses.length === 0) {
        toast.info('No unpaid expenses for this period');
        return;
      }

      const batch = writeBatch(db);
      const paidAt = new Date().toISOString();
      const paidBy = user.email;

      userExpenses.forEach(expense => {
        const expenseRef = doc(db, `churches/${id}/employeeExpenses`, expense.id);
        batch.update(expenseRef, {
          isPaid: true,
          paidAt,
          paidBy
        });
      });

      await batch.commit();

      setExpenses(expenses.map(exp =>
        userExpenses.find(ue => ue.id === exp.id)
          ? { ...exp, isPaid: true, paidAt, paidBy }
          : exp
      ));

      toast.success(`Marked ${userExpenses.length} expense(s) as paid`);
    } catch (error) {
      console.error('Error marking expenses as paid:', error);
      toast.error('Failed to mark expenses as paid');
    }
  };

  const navigatePeriod = (direction) => {
    const newDate = new Date(selectedDate);
    switch (viewPeriod) {
      case 'week':
        newDate.setDate(newDate.getDate() + (direction * 7));
        break;
      case 'biweekly':
        newDate.setDate(newDate.getDate() + (direction * 14));
        break;
      case 'month':
        newDate.setMonth(newDate.getMonth() + direction);
        break;
    }
    setSelectedDate(newDate);
  };

  const formatPeriodLabel = () => {
    const { start, end } = getPeriodRange();
    const formatDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  if (loading) {
    return (
      <div className="my-team-container">
        <div className="loading">Loading team members...</div>
      </div>
    );
  }

  return (
    <div className="my-team-container">
      <div className="team-header">
        <h2>👥 My Team</h2>
        <p className="team-count">{users.length} team member{users.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'team' ? 'active' : ''}`}
          onClick={() => setActiveTab('team')}
        >
          👥 Team Members
        </button>
        <button
          className={`tab-button ${activeTab === 'expenses' ? 'active' : ''}`}
          onClick={() => setActiveTab('expenses')}
        >
          💰 Employee Expenses
        </button>
      </div>

      {/* Team Tab Content */}
      {activeTab === 'team' && (
        <div className="team-list">
        {users.length === 0 ? (
          <div className="no-users">No team members found</div>
        ) : (
          <div className="team-table">
            <div className="team-table-header">
              <div className="col-name">Name</div>
              <div className="col-email">Email</div>
              <div className="col-role">Role</div>
              <div className="col-salary">Salary</div>
              <div className="col-projects">Assigned Projects</div>
              <div className="col-actions">Actions</div>
            </div>

            {users.map(teamMember => (
              <div key={teamMember.id} className="team-row">
                <div className="col-name">
                  <div className="user-name">{teamMember.name} {teamMember.lastName}</div>
                  {teamMember.phone && <div className="user-phone">{teamMember.phone}</div>}
                </div>

                <div className="col-email">{teamMember.email}</div>

                <div className="col-role">
                  <span className={getRoleBadgeClass(teamMember.role)}>
                    {getRoleLabel(teamMember.role)}
                  </span>
                </div>

                <div className="col-salary">
                  {editingSalary === teamMember.id ? (
                    <div className="salary-edit-form">
                      <input
                        type="number"
                        value={newSalary}
                        onChange={(e) => setNewSalary(e.target.value)}
                        placeholder="Hourly rate ($)"
                        className="salary-input"
                        min="0"
                        step="0.01"
                      />
                      <input
                        type="number"
                        value={newExpectedHours}
                        onChange={(e) => setNewExpectedHours(e.target.value)}
                        placeholder="Expected hours/week"
                        className="salary-input"
                        min="0"
                        step="0.5"
                      />
                      <input
                        type="text"
                        value={salaryNote}
                        onChange={(e) => setSalaryNote(e.target.value)}
                        placeholder="Note (optional)"
                        className="salary-note-input"
                      />
                      <div className="salary-actions">
                        <button
                          className="btn btn-xs btn-success"
                          onClick={() => handleSaveSalary(teamMember.id)}
                        >
                          Save
                        </button>
                        <button
                          className="btn btn-xs btn-secondary"
                          onClick={() => {
                            setEditingSalary(null);
                            setNewSalary('');
                            setNewExpectedHours('');
                            setSalaryNote('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="salary-display">
                      <div className="salary-info-row">
                        {teamMember.salary && teamMember.expectedHoursPerWeek ? (
                          <>
                            <div className="hourly-rate">
                              ${parseFloat(teamMember.salary).toFixed(2)}/hr
                            </div>
                            <div className="expected-hours">
                              × {(teamMember.expectedHoursPerWeek * 4.33).toFixed(1)} hrs
                            </div>
                            <div className="monthly-total">
                              = ${(parseFloat(teamMember.salary) * teamMember.expectedHoursPerWeek * 4.33).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month
                            </div>
                          </>
                        ) : teamMember.salary ? (
                          <div className="hourly-rate">
                            ${parseFloat(teamMember.salary).toFixed(2)}/hr
                          </div>
                        ) : (
                          <div className="salary-amount">Not set</div>
                        )}
                      </div>
                      <div className="salary-buttons">
                        <button
                          className="btn btn-xs btn-primary"
                          onClick={() => handleEditSalary(teamMember.id, teamMember.salary, teamMember.expectedHoursPerWeek)}
                        >
                          {teamMember.salary ? '✏️' : '➕'}
                        </button>
                        {teamMember.salaryHistory && teamMember.salaryHistory.length > 0 && (
                          <button
                            className="btn btn-xs btn-info"
                            onClick={() => setShowSalaryHistory(teamMember.id)}
                          >
                            📋 History
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="col-projects">
                  {editingUser === teamMember.id ? (
                    <Select
                      isMulti
                      value={selectedProjects.map(projectId => {
                        const project = projects.find(p => p.id === projectId);
                        return project ? { value: project.id, label: project.name } : null;
                      }).filter(Boolean)}
                      options={projects.map(project => ({
                        value: project.id,
                        label: project.name
                      }))}
                      onChange={(selected) => setSelectedProjects(selected ? selected.map(s => s.value) : [])}
                      placeholder="Select projects..."
                      className="project-select"
                    />
                  ) : (
                    <div className="assigned-projects-list">
                      {(() => {
                        // Get projects where this user is assigned
                        const userProjects = projects.filter(p => 
                          p.assignedUsers && p.assignedUsers.includes(teamMember.id)
                        );
                        
                        return userProjects.length > 0 ? (
                          userProjects.map(project => (
                            <span key={project.id} className="project-tag">
                              {project.name}
                            </span>
                          ))
                        ) : (
                          <span className="no-projects">No projects assigned</span>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <div className="col-actions">
                  {editingUser === teamMember.id ? (
                    <div className="action-buttons">
                      <button
                        className="btn btn-sm btn-success"
                        onClick={() => handleSaveProjects(teamMember.id)}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          setEditingUser(null);
                          setSelectedProjects([]);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleEditProjects(teamMember.id)}
                    >
                      ✏️ Assign
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Expenses Tab Content */}
      {activeTab === 'expenses' && (
        <div className="expenses-container">
          {/* Period Controls */}
          <div className="expenses-controls">
            <div className="period-selector">
              <label>View by:</label>
              <select value={viewPeriod} onChange={(e) => setViewPeriod(e.target.value)} className="period-select">
                <option value="week">Week</option>
                <option value="biweekly">Bi-Weekly</option>
                <option value="month">Month</option>
              </select>
            </div>
            
            <div className="period-navigation">
              <button className="btn btn-sm btn-secondary" onClick={() => navigatePeriod(-1)}>
                ← Previous
              </button>
              <span className="period-label">{formatPeriodLabel()}</span>
              <button className="btn btn-sm btn-secondary" onClick={() => navigatePeriod(1)}>
                Next →
              </button>
            </div>

            <button className="btn btn-sm btn-success" onClick={() => setShowAddExpense(true)}>
              ➕ Add Expense
            </button>
          </div>

          {/* Summary Cards */}
          {(() => {
            const filteredExpenses = filterExpensesByPeriod(expenses);
            const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);
            const paidExpenses = filteredExpenses.filter(exp => exp.isPaid).reduce((sum, exp) => sum + exp.amount, 0);
            const pendingExpenses = filteredExpenses.filter(exp => !exp.isPaid).reduce((sum, exp) => sum + exp.amount, 0);

            return (
              <div className="expenses-summary">
                <div className="summary-card total">
                  <div className="summary-label">Total Expenses</div>
                  <div className="summary-amount">${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="summary-count">{filteredExpenses.length} expense(s)</div>
                </div>
                <div className="summary-card paid">
                  <div className="summary-label">Paid</div>
                  <div className="summary-amount">${paidExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="summary-count">{filteredExpenses.filter(exp => exp.isPaid).length} expense(s)</div>
                </div>
                <div className="summary-card pending">
                  <div className="summary-label">Pending</div>
                  <div className="summary-amount">${pendingExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="summary-count">{filteredExpenses.filter(exp => !exp.isPaid).length} expense(s)</div>
                </div>
              </div>
            );
          })()}

          {/* Expenses by Employee */}
          {(() => {
            const filteredExpenses = filterExpensesByPeriod(expenses);
            const groupedExpenses = groupExpensesByUser(filteredExpenses);

            return (
              <div className="expenses-by-employee">
                {Object.keys(groupedExpenses).length === 0 ? (
                  <div className="no-expenses">No expenses for this period</div>
                ) : (
                  Object.entries(groupedExpenses).map(([userId, userExpenses]) => {
                    const employee = users.find(u => u.id === userId);
                    if (!employee) return null;

                    const totalAmount = userExpenses.reduce((sum, exp) => sum + exp.amount, 0);
                    const paidAmount = userExpenses.filter(exp => exp.isPaid).reduce((sum, exp) => sum + exp.amount, 0);
                    const pendingAmount = userExpenses.filter(exp => !exp.isPaid).reduce((sum, exp) => sum + exp.amount, 0);
                    const hasPending = userExpenses.some(exp => !exp.isPaid);

                    return (
                      <div key={userId} className="employee-expense-card">
                        <div className="employee-expense-header">
                          <div className="employee-info">
                            <h3>{employee.name} {employee.lastName}</h3>
                            <span className="employee-email">{employee.email}</span>
                          </div>
                          <div className="employee-expense-summary">
                            <div className="expense-total">
                              <span className="label">Total:</span>
                              <span className="amount">${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="expense-paid">
                              <span className="label">Paid:</span>
                              <span className="amount paid">${paidAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="expense-pending">
                              <span className="label">Pending:</span>
                              <span className="amount pending">${pendingAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                            {hasPending && (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handleBulkMarkPaid(userId)}
                              >
                                ✓ Mark All as Paid
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="expenses-list">
                          {userExpenses
                            .sort((a, b) => new Date(b.date) - new Date(a.date))
                            .map(expense => (
                              <div key={expense.id} className={`expense-item ${expense.isPaid ? 'paid' : 'unpaid'}`}>
                                <div className="expense-date">
                                  {new Date(expense.date).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })}
                                </div>
                                <div className="expense-details">
                                  <div className="expense-description">{expense.description}</div>
                                  {expense.category && <div className="expense-category">{expense.category}</div>}
                                </div>
                                <div className="expense-amount">
                                  ${expense.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </div>
                                <div className="expense-status">
                                  {expense.isPaid ? (
                                    <>
                                      <span className="status-badge paid">✓ Paid</span>
                                      {expense.paidAt && (
                                        <div className="payment-info">
                                          {new Date(expense.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <span className="status-badge unpaid">⏳ Pending</span>
                                  )}
                                </div>
                                <div className="expense-actions">
                                  {expense.isPaid ? (
                                    <button
                                      className="btn btn-xs btn-secondary"
                                      onClick={() => handleMarkExpensePaid(expense.id, false)}
                                      title="Mark as unpaid"
                                    >
                                      ↩ Unpay
                                    </button>
                                  ) : (
                                    <button
                                      className="btn btn-xs btn-success"
                                      onClick={() => handleMarkExpensePaid(expense.id, true)}
                                      title="Mark as paid"
                                    >
                                      ✓ Pay
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="modal-overlay" onClick={() => setShowAddExpense(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>➕ Add Employee Expense</h3>
              <button className="modal-close" onClick={() => setShowAddExpense(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Employee *</label>
                <select
                  value={newExpense.userId}
                  onChange={(e) => setNewExpense({ ...newExpense, userId: e.target.value })}
                  className="form-control"
                >
                  <option value="">Select employee...</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.lastName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Amount *</label>
                <input
                  type="number"
                  value={newExpense.amount}
                  onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                  placeholder="0.00"
                  className="form-control"
                  min="0"
                  step="0.01"
                />
              </div>

              <div className="form-group">
                <label>Description *</label>
                <input
                  type="text"
                  value={newExpense.description}
                  onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                  placeholder="What is this expense for?"
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <select
                  value={newExpense.category}
                  onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                  className="form-control"
                >
                  <option value="Salary">Salary</option>
                  <option value="Bonus">Bonus</option>
                  <option value="Reimbursement">Reimbursement</option>
                  <option value="Travel">Travel</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Training">Training</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={newExpense.date}
                  onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                  className="form-control"
                />
              </div>

              <div className="modal-actions">
                <button className="btn btn-primary" onClick={handleAddExpense}>
                  Add Expense
                </button>
                <button className="btn btn-secondary" onClick={() => setShowAddExpense(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Salary History Modal */}
      {showSalaryHistory && (
        <div className="modal-overlay" onClick={() => setShowSalaryHistory(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>💰 Salary History</h3>
              <button className="modal-close" onClick={() => setShowSalaryHistory(null)}>×</button>
            </div>
            <div className="modal-body">
              {(() => {
                const member = users.find(u => u.id === showSalaryHistory);
                const history = member?.salaryHistory || [];
                
                if (history.length === 0) {
                  return <p className="no-history">No salary history available</p>;
                }

                return (
                  <div className="salary-history-list">
                    {history
                      .sort((a, b) => new Date(b.adjustedAt) - new Date(a.adjustedAt))
                      .map((adjustment, index) => (
                        <div key={index} className="history-item">
                          <div className="history-date">
                            {new Date(adjustment.adjustedAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                          <div className="history-details">
                            <div className="salary-change">
                              <span className="previous-salary">
                                ${parseFloat(adjustment.previousSalary || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                              <span className="arrow">→</span>
                              <span className="new-salary">
                                ${parseFloat(adjustment.newSalary).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                              <span className={`change-amount ${adjustment.newSalary > adjustment.previousSalary ? 'positive' : 'negative'}`}>
                                ({adjustment.newSalary > adjustment.previousSalary ? '+' : ''}
                                ${(adjustment.newSalary - (adjustment.previousSalary || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })})
                              </span>
                            </div>
                            {(adjustment.newExpectedHours !== undefined && adjustment.newExpectedHours !== adjustment.previousExpectedHours) && (
                              <div className="hours-change">
                                <span className="label">Expected Hours:</span>
                                <span className="previous-hours">
                                  {adjustment.previousExpectedHours || 0} hrs/wk
                                </span>
                                <span className="arrow">→</span>
                                <span className="new-hours">
                                  {adjustment.newExpectedHours} hrs/wk ({(adjustment.newExpectedHours * 4.33).toFixed(1)} hrs/month)
                                </span>
                              </div>
                            )}
                            {adjustment.note && (
                              <div className="history-note">{adjustment.note}</div>
                            )}
                            <div className="history-by">Adjusted by: {adjustment.adjustedBy}</div>
                          </div>
                        </div>
                      ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyTeam;
