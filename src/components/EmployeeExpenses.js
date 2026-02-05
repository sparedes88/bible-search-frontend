import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc, addDoc, writeBatch, query, where, deleteDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import './EmployeeExpenses.css';

const EmployeeExpenses = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [salaryPayments, setSalaryPayments] = useState([]);
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
  const [expandedUsers, setExpandedUsers] = useState({});
  const [editingTimeEntry, setEditingTimeEntry] = useState(null);
  const [editTimeData, setEditTimeData] = useState({
    date: '',
    duration: ''
  });
  const [refreshTrigger, setRefreshTrigger] = useState(0); // Force re-render trigger
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Check if current user is an admin
  const isAdmin = () => user?.role === 'admin' || user?.role === 'global_admin';
  const currentUserId = user?.uid || user?.id;
  
  console.log('🔐 EmployeeExpenses - Current user:', { userId: currentUserId, role: user?.role, isAdmin: isAdmin() });

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

  // Fetch expenses
  useEffect(() => {
    const fetchExpenses = async () => {
      if (!id || !currentUserId) return;

      try {
        const expensesRef = collection(db, `churches/${id}/employeeExpenses`);
        // Members only fetch their own expenses, admins fetch all
        let expensesQuery = expensesRef;
        if (!isAdmin()) {
          expensesQuery = query(expensesRef, where('userId', '==', currentUserId));
        }
        const expensesSnap = await getDocs(expensesQuery);

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

    fetchExpenses();
  }, [id, currentUserId]);

  // Fetch time entries
  useEffect(() => {
    const fetchTimeEntries = async () => {
      if (!id) return;

      try {
        const timeEntriesRef = collection(db, `churches/${id}/timeEntries`);
        const timeEntriesSnap = await getDocs(timeEntriesRef);

        const timeEntriesList = timeEntriesSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        console.log('📊 Fetched time entries:', timeEntriesList.length, 'total entries');
        console.log('Sample entries:', timeEntriesList.slice(0, 3));
        
        setTimeEntries(timeEntriesList);
      } catch (error) {
        console.error('Error fetching time entries:', error);
        toast.error('Failed to load time entries');
      }
    };

    fetchTimeEntries();
  }, [id]);

  // Fetch projects
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
      }
    };

    fetchProjects();
  }, [id]);

  // Fetch salary payments
  useEffect(() => {
    const fetchSalaryPayments = async () => {
      if (!id || !currentUserId) return;

      try {
        const paymentsRef = collection(db, `churches/${id}/salaryPayments`);
        // Members only fetch their own payments, admins fetch all
        let paymentsQuery = paymentsRef;
        if (!isAdmin()) {
          paymentsQuery = query(paymentsRef, where('userId', '==', currentUserId));
        }
        const paymentsSnap = await getDocs(paymentsQuery);

        const paymentsList = paymentsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setSalaryPayments(paymentsList);
      } catch (error) {
        console.error('Error fetching salary payments:', error);
      }
    };

    fetchSalaryPayments();
  }, [id, currentUserId]);

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
    // If custom date range, use that
    if (viewPeriod === 'custom') {
      if (!customStartDate || !customEndDate) {
        return expenses; // No dates selected, show all
      }
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999); // Include entire end date
      return expenses.filter(expense => {
        const expenseDate = new Date(expense.date);
        return expenseDate >= start && expenseDate <= end;
      });
    }
    
    // Otherwise use period-based filtering
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

  // Calculate time-based expenses from time entries
  const calculateTimeBasedExpenses = () => {
    const { start, end } = getPeriodRange();
    const timeBasedExpenses = [];

    // Filter time entries for the period
    const periodTimeEntries = timeEntries.filter(entry => {
      const entryDate = new Date(entry.date);
      return entryDate >= start && entryDate <= end;
    });

    console.log('Period:', start, 'to', end);
    console.log('Total time entries in period:', periodTimeEntries.length);
    
    // Log all entries with details
    periodTimeEntries.forEach((entry, idx) => {
      const user = users.find(u => u.id === entry.userId);
      console.log(`Entry ${idx + 1}:`, {
        date: entry.date,
        user: user ? `${user.name} ${user.lastName}` : entry.userId,
        duration: entry.duration,
        project: entry.project
      });
    });
    
    // Group by user and calculate
    const userTimeMap = {};
    periodTimeEntries.forEach(entry => {
      if (!userTimeMap[entry.userId]) {
        userTimeMap[entry.userId] = {
          totalHours: 0,
          entries: [],
          timeEntries: [] // Store actual time entries
        };
      }
      
      // Parse duration - check what format it's in
      let duration = 0;
      
      if (typeof entry.duration === 'string' && entry.duration.includes('h')) {
        // Format like "10h 55m 12s" or "7h"
        const hours = parseFloat(entry.duration.match(/(\d+)h/)?.[1] || 0);
        const minutes = parseFloat(entry.duration.match(/(\d+)m/)?.[1] || 0);
        const seconds = parseFloat(entry.duration.match(/(\d+)s/)?.[1] || 0);
        duration = hours + (minutes / 60) + (seconds / 3600);
      } else {
        // Duration is stored as seconds in the database
        const durationValue = parseFloat(entry.duration) || 0;
        // Convert seconds to hours
        duration = durationValue / 3600;
      }
      
      console.log(`Entry for ${entry.userId}: duration=${entry.duration}, parsed=${duration.toFixed(2)} hours`);
      
      userTimeMap[entry.userId].totalHours += duration;
      userTimeMap[entry.userId].entries.push(entry);
      userTimeMap[entry.userId].timeEntries.push({
        ...entry,
        parsedHours: duration
      });
    });

    // Create expense objects for each user
    Object.entries(userTimeMap).forEach(([userId, data]) => {
      const user = users.find(u => u.id === userId);
      console.log(`User ${userId}: totalHours=${data.totalHours}, entries=${data.entries.length}`);
      
      if (user && user.salary && data.totalHours > 0) {
        const hourlyRate = parseFloat(user.salary) || 0;
        const amount = data.totalHours * hourlyRate;
        
        const periodStartStr = start.toISOString().split('T')[0];
        const periodEndStr = end.toISOString().split('T')[0];
        
        // Check if this period has been paid
        const paymentRecord = salaryPayments.find(payment => 
          payment.userId === userId &&
          payment.periodStart === periodStartStr &&
          payment.periodEnd === periodEndStr
        );
        
        console.log(`Payment check for ${userId}:`, {
          periodStart: periodStartStr,
          periodEnd: periodEndStr,
          found: !!paymentRecord,
          paymentRecord
        });
        
        timeBasedExpenses.push({
          id: `time-${userId}-${start.getTime()}`,
          userId: userId,
          amount: amount,
          description: `Hours worked: ${data.totalHours.toFixed(2)} hrs @ $${hourlyRate.toFixed(2)}/hr (${data.entries.length} entries)`,
          date: start.toISOString().split('T')[0],
          category: 'Salary',
          isTimeBased: true,
          hours: data.totalHours,
          hourlyRate: hourlyRate,
          isPaid: !!paymentRecord,
          paidAt: paymentRecord?.paidAt || null,
          paidBy: paymentRecord?.paidBy || null,
          paymentId: paymentRecord?.id || null,
          entryCount: data.entries.length,
          timeEntries: data.timeEntries // Include the actual time entries
        });
      }
    });

    return timeBasedExpenses;
  };

  // Get ALL expenses across all time (for summary cards)
  const getAllExpensesOverall = () => {
    // Get all time entries ever (not filtered by period)
    const userTimeMap = {};
    
    timeEntries.forEach(entry => {
      if (!entry.userId) return;
      
      if (!userTimeMap[entry.userId]) {
        userTimeMap[entry.userId] = {
          totalHours: 0,
          entries: [],
          timeEntries: []
        };
      }
      
      const durationInHours = (entry.duration || 0) / 3600;
      userTimeMap[entry.userId].totalHours += durationInHours;
      userTimeMap[entry.userId].entries.push(entry);
      userTimeMap[entry.userId].timeEntries.push({
        id: entry.id,
        projectId: entry.projectId,
        date: entry.date || entry.createdAt,
        duration: durationInHours,
        description: entry.description
      });
    });

    const allTimeBasedExpenses = [];
    
    // Create expense objects for each user across all time
    Object.entries(userTimeMap).forEach(([userId, data]) => {
      const user = users.find(u => u.id === userId);
      
      if (user && user.salary && data.totalHours > 0) {
        const hourlyRate = parseFloat(user.salary) || 0;
        const amount = data.totalHours * hourlyRate;
        
        // Check across ALL payment records
        const totalPaidAmount = salaryPayments
          .filter(payment => payment.userId === userId && payment.isPaid)
          .reduce((sum, payment) => sum + (payment.amount || 0), 0);
        
        allTimeBasedExpenses.push({
          id: `time-all-${userId}`,
          userId: userId,
          amount: amount,
          paidAmount: totalPaidAmount,
          pendingAmount: amount - totalPaidAmount,
          description: `Total hours worked: ${data.totalHours.toFixed(2)} hrs`,
          category: 'Salary',
          isTimeBased: true,
          isOverall: true
        });
      }
    });

    // Return all manual expenses plus overall time-based summary
    return [...allTimeBasedExpenses, ...expenses];
  };

  // Combine manual and time-based expenses (for current period)
  const getAllExpenses = () => {
    const timeBasedExpenses = calculateTimeBasedExpenses();
    const manualExpenses = filterExpensesByPeriod(expenses);
    
    // Merge both types
    return [...timeBasedExpenses, ...manualExpenses];
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
      console.log('=== PAYMENT PROCESSING START ===');
      console.log('Expense ID:', expenseId, 'Set Paid:', isPaid);
      
      // Handle time-based expenses differently (they're virtual, not in DB)
      if (expenseId.startsWith('time-')) {
        // Extract userId from the expense
        const expense = getAllExpenses().find(exp => exp.id === expenseId);
        if (!expense) {
          console.error('❌ Expense not found:', expenseId);
          return;
        }

        console.log('📋 Found expense:', expense);

        const { start, end } = getPeriodRange();
        const periodStart = start.toISOString().split('T')[0];
        const periodEnd = end.toISOString().split('T')[0];
        
        console.log('📅 Period dates:', { periodStart, periodEnd });
        console.log('💰 Current salaryPayments state:', salaryPayments);
        
        if (isPaid) {
          // Create a payment record
          const paymentData = {
            userId: expense.userId,
            periodStart: periodStart,
            periodEnd: periodEnd,
            amount: expense.amount,
            hours: expense.hours,
            hourlyRate: expense.hourlyRate,
            isPaid: true,
            paidAt: new Date().toISOString(),
            paidBy: user.email,
            createdAt: new Date().toISOString()
          };

          console.log('➕ Creating payment record:', paymentData);
          const paymentsRef = collection(db, `churches/${id}/salaryPayments`);
          const docRef = await addDoc(paymentsRef, paymentData);
          console.log('✅ Payment record created with ID:', docRef.id);
          
          const newPayment = { id: docRef.id, ...paymentData };
          console.log('📝 New payment object:', newPayment);
          
          setSalaryPayments(prev => {
            const updated = [...prev, newPayment];
            console.log('🔄 Previous salaryPayments:', prev.length, 'items');
            console.log('🔄 Updated salaryPayments:', updated.length, 'items');
            console.log('🔄 Updated array:', updated);
            return updated;
          });
          
          // Force component re-render
          setRefreshTrigger(prev => prev + 1);
          console.log('🔄 Triggered refresh');
          
          toast.success('Salary payment marked as paid');
        } else {
          // Remove the payment record
          if (expense.paymentId) {
            console.log('🗑️ Deleting payment record:', expense.paymentId);
            const paymentRef = doc(db, `churches/${id}/salaryPayments`, expense.paymentId);
            await deleteDoc(paymentRef);
            console.log('✅ Payment record deleted');
            
            setSalaryPayments(prev => {
              const updated = prev.filter(p => p.id !== expense.paymentId);
              console.log('🔄 Previous salaryPayments:', prev.length, 'items');
              console.log('🔄 Updated salaryPayments after delete:', updated.length, 'items');
              return updated;
            });
            
            // Force component re-render
            setRefreshTrigger(prev => prev + 1);
            console.log('🔄 Triggered refresh');
            
            toast.success('Payment status updated');
          } else {
            console.warn('⚠️ No payment ID found for expense');
          }
        }
        
        console.log('=== PAYMENT PROCESSING END ===');
        return;
      }

      console.log('💵 Processing manual expense:', expenseId);
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
      console.log('=== PAYMENT PROCESSING END ===');
    } catch (error) {
      console.error('❌ Error updating expense:', error);
      toast.error('Failed to update expense: ' + error.message);
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

  const toggleUserExpanded = (userId) => {
    setExpandedUsers(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  const handleEditTimeEntry = (entry) => {
    setEditingTimeEntry(entry.id);
    setEditTimeData({
      date: entry.date,
      duration: (entry.duration / 3600).toFixed(2) // Convert seconds to hours
    });
  };

  const handleSaveTimeEntry = async (entryId) => {
    try {
      const durationInSeconds = parseFloat(editTimeData.duration) * 3600; // Convert hours back to seconds
      const entryRef = doc(db, `churches/${id}/timeEntries`, entryId);
      await updateDoc(entryRef, {
        date: editTimeData.date,
        duration: durationInSeconds
      });

      // Update local state
      setTimeEntries(timeEntries.map(entry =>
        entry.id === entryId
          ? { ...entry, date: editTimeData.date, duration: durationInSeconds }
          : entry
      ));

      setEditingTimeEntry(null);
      toast.success('Time entry updated successfully!');
    } catch (error) {
      console.error('Error updating time entry:', error);
      toast.error('Failed to update time entry');
    }
  };

  const handleCancelEditTimeEntry = () => {
    setEditingTimeEntry(null);
    setEditTimeData({ date: '', duration: '' });
  };

  const getProjectName = (projectId) => {
    const project = projects.find(p => p.id === projectId);
    return project ? project.name : projectId;
  };

  if (loading) {
    return (
      <div className="employee-expenses-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  // Force re-calculation when salaryPayments or refreshTrigger changes
  const allExpenses = getAllExpenses(); // Period-filtered expenses for display
  const overallExpenses = getAllExpensesOverall(); // All-time expenses for summary
  console.log('🔄 Rendering with', allExpenses.length, 'expenses (refreshTrigger:', refreshTrigger, ')');
  console.log('💰 Current salaryPayments in render:', salaryPayments.length, 'items');
  
  // Calculate overall totals (all time)
  let totalExpensesOverall = 0;
  let paidExpensesOverall = 0;
  let pendingExpensesOverall = 0;
  
  overallExpenses.forEach(exp => {
    if (exp.isOverall) {
      // Time-based overall expense
      totalExpensesOverall += exp.amount;
      paidExpensesOverall += exp.paidAmount || 0;
      pendingExpensesOverall += exp.pendingAmount || 0;
    } else {
      // Regular expense
      totalExpensesOverall += exp.amount;
      if (exp.isPaid) {
        paidExpensesOverall += exp.amount;
      } else {
        pendingExpensesOverall += exp.amount;
      }
    }
  });
  
  // Calculate filtered totals (based on current period/date range)
  const totalExpensesFiltered = allExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const paidExpensesFiltered = allExpenses.filter(exp => exp.isPaid).reduce((sum, exp) => sum + exp.amount, 0);
  const pendingExpensesFiltered = allExpenses.filter(exp => !exp.isPaid).reduce((sum, exp) => sum + exp.amount, 0);
  
  // Group expenses by user
  const groupedExpenses = groupExpensesByUser(allExpenses);
  
  // Filter grouped expenses: admins see all, members see only their own
  let displayedGroupedExpenses = groupedExpenses;
  if (!isAdmin() && currentUserId) {
    // Non-admin: only show their own expenses
    displayedGroupedExpenses = {
      [currentUserId]: groupedExpenses[currentUserId] || []
    };
    console.log('📊 Filtered expenses for member:', {
      currentUserId,
      availableKeys: Object.keys(groupedExpenses),
      userExpenses: groupedExpenses[currentUserId]?.length || 0
    });
  }

  return (
    <div className="employee-expenses-container">
      <div className="expenses-header">
        <h2>💰 Employee Expenses</h2>
        {!isAdmin() && <div className="header-subtitle">Your Expenses</div>}
      </div>

      {/* Period Controls */}
      <div className="expenses-controls">
        <div className="period-selector">
          <label>View by:</label>
          <select value={viewPeriod} onChange={(e) => setViewPeriod(e.target.value)} className="period-select">
            <option value="week">Week</option>
            <option value="biweekly">Bi-Weekly</option>
            <option value="month">Month</option>
            <option value="custom">Custom Dates</option>
          </select>
        </div>
        
        {viewPeriod === 'custom' && (
          <div className="custom-date-picker">
            <div className="date-input-group">
              <label>From:</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="date-input"
              />
            </div>
            <div className="date-input-group">
              <label>To:</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="date-input"
              />
            </div>
          </div>
        )}
        
        {viewPeriod !== 'custom' && (
          <div className="period-navigation">
            <button className="btn btn-sm btn-secondary" onClick={() => navigatePeriod(-1)}>
              ← Previous
            </button>
            <span className="period-label">{formatPeriodLabel()}</span>
            <button className="btn btn-sm btn-secondary" onClick={() => navigatePeriod(1)}>
              Next →
            </button>
          </div>
        )}

        {isAdmin() && (
          <button className="btn btn-sm btn-success" onClick={() => setShowAddExpense(true)}>
            ➕ Add Expense
          </button>
        )}
      </div>

      {/* Summary Cards - Overall Totals */}
      <div className="expenses-summary">
        <div className="summary-card total">
          <div className="summary-label">Total Expenses (All Time)</div>
          <div className="summary-amount">${totalExpensesOverall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="summary-count">Overall totals</div>
        </div>
        <div className="summary-card paid">
          <div className="summary-label">Paid (All Time)</div>
          <div className="summary-amount">${paidExpensesOverall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="summary-count">Overall paid</div>
        </div>
        <div className="summary-card pending">
          <div className="summary-label">Pending (All Time)</div>
          <div className="summary-amount">${pendingExpensesOverall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="summary-count">Overall pending</div>
        </div>
      </div>

      {/* Summary Cards - Filtered by Period/Date Range */}
      <div className="expenses-summary filtered">
        <div className="summary-card total">
          <div className="summary-label">Total {viewPeriod === 'custom' ? `(${customStartDate} to ${customEndDate})` : `(${formatPeriodLabel()})`}</div>
          <div className="summary-amount">${totalExpensesFiltered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="summary-count">{allExpenses.length} expense(s)</div>
        </div>
        <div className="summary-card paid">
          <div className="summary-label">Paid {viewPeriod === 'custom' ? `(${customStartDate} to ${customEndDate})` : `(${formatPeriodLabel()})`}</div>
          <div className="summary-amount">${paidExpensesFiltered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="summary-count">{allExpenses.filter(exp => exp.isPaid).length} expense(s)</div>
        </div>
        <div className="summary-card pending">
          <div className="summary-label">Pending {viewPeriod === 'custom' ? `(${customStartDate} to ${customEndDate})` : `(${formatPeriodLabel()})`}</div>
          <div className="summary-amount">${pendingExpensesFiltered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="summary-count">{allExpenses.filter(exp => !exp.isPaid).length} expense(s)</div>
        </div>
      </div>

      {/* Expenses by Employee */}
      <div className="expenses-by-employee">
        {Object.keys(displayedGroupedExpenses).length === 0 ? (
          <div className="no-expenses">No expenses for this period</div>
        ) : (
          Object.entries(displayedGroupedExpenses).map(([userId, userExpenses]) => {
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
                  </div>
                </div>

                <div className="expenses-list">
                  {userExpenses
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                    .map(expense => (
                      <div key={expense.id}>
                        <div className={`expense-item ${expense.isPaid ? 'paid' : 'unpaid'} ${expense.isTimeBased ? 'time-based' : ''}`}>
                          <div className="expense-date">
                            {new Date(expense.date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </div>
                          <div className="expense-details">
                            <div className="expense-description">
                              {expense.isTimeBased && <span className="time-badge">⏱️ </span>}
                              {expense.description}
                            </div>
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
                            {isAdmin() && !expense.isTimeBased && (
                              expense.isPaid ? (
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
                              )
                            )}
                            {isAdmin() && expense.isTimeBased && (
                              expense.isPaid ? (
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
                              )
                            )}
                          </div>
                        </div>

                        {/* Time Entries Details */}
                        {expense.isTimeBased && expense.timeEntries && (
                          <div className="time-entries-details">
                            <div className="time-entries-header">
                              <div className="col-date">Date</div>
                              <div className="col-duration">Duration (hrs)</div>
                              <div className="col-project">Project</div>
                              <div className="col-cost">Cost</div>
                              <div className="col-actions">Actions</div>
                            </div>
                            {expense.timeEntries.map(entry => (
                              <div key={entry.id} className="time-entry-row">
                                {editingTimeEntry === entry.id ? (
                                  <>
                                    <div className="col-date">
                                      <input
                                        type="date"
                                        value={editTimeData.date}
                                        onChange={(e) => setEditTimeData({ ...editTimeData, date: e.target.value })}
                                        className="time-entry-input"
                                      />
                                    </div>
                                    <div className="col-duration">
                                      <input
                                        type="number"
                                        value={editTimeData.duration}
                                        onChange={(e) => setEditTimeData({ ...editTimeData, duration: e.target.value })}
                                        className="time-entry-input"
                                        step="1"
                                        placeholder="Seconds"
                                      />
                                    </div>
                                    <div className="col-project">{getProjectName(entry.project)}</div>
                                    <div className="col-cost">
                                      ${(entry.parsedHours * expense.hourlyRate).toFixed(2)}
                                    </div>
                                    <div className="col-actions">
                                      <button
                                        className="btn btn-xs btn-success"
                                        onClick={() => handleSaveTimeEntry(entry.id)}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="btn btn-xs btn-secondary"
                                        onClick={handleCancelEditTimeEntry}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="col-date">
                                      {new Date(entry.date).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric'
                                      })}
                                    </div>
                                    <div className="col-duration">
                                      {entry.parsedHours.toFixed(2)} hrs
                                    </div>
                                    <div className="col-project">{getProjectName(entry.project)}</div>
                                    <div className="col-cost">
                                      ${(entry.parsedHours * expense.hourlyRate).toFixed(2)}
                                    </div>
                                    <div className="col-actions">
                                      {isAdmin() && (
                                        <button
                                          className="btn btn-xs btn-primary"
                                          onClick={() => handleEditTimeEntry(entry)}
                                        >
                                          ✏️ Edit
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            );
          })
        )}
      </div>

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
    </div>
  );
};

export default EmployeeExpenses;
