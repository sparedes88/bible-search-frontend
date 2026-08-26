import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../firebase';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, serverTimestamp, getDoc
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import ChurchHeader from './ChurchHeader';

const TABS = { TASKS: 'tasks', SCANNER: 'scanner', LOGS: 'logs', DATA: 'data', COMMITMENT: 'commitment' };

const TrackMe = () => {
  const { id: organizationId } = useParams();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState(TABS.TASKS);
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [scanLogs, setScanLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [allLogs, setAllLogs] = useState([]);
  const [loadingAllLogs, setLoadingAllLogs] = useState(false);
  const [dataFilter, setDataFilter] = useState({ task: 'all', search: '' });
  const [commitmentTaskId, setCommitmentTaskId] = useState('');

  // Task form state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', status: 'active' });
  const [savingTask, setSavingTask] = useState(false);

  // Scanner state
  const [scannerTask, setScannerTask] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [processingScans, setProcessingScans] = useState(new Set());
  const [lastScanConfirmation, setLastScanConfirmation] = useState(null);
  const scannerRef = useRef(null);
  const scannerInstanceRef = useRef(null);
  const lastScannedCodeRef = useRef(null);

  // ─── Firestore helpers ────────────────────────────────────────────────────

  const tasksCollection = useCallback(
    () => collection(db, 'churches', organizationId, 'trackMeTasks'),
    [organizationId]
  );

  const scansCollection = useCallback(
    (taskId) => collection(db, 'churches', organizationId, 'trackMeTasks', taskId, 'scans'),
    [organizationId]
  );

  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const snap = await getDocs(query(tasksCollection(), orderBy('createdAt', 'desc')));
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch {
      toast.error('Failed to load tasks.');
    } finally {
      setLoadingTasks(false);
    }
  }, [tasksCollection]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Default the commitment tab's task selector to the first task once tasks load
  useEffect(() => {
    if (!commitmentTaskId && tasks.length > 0) setCommitmentTaskId(tasks[0].id);
  }, [tasks, commitmentTaskId]);

  const fetchLogs = useCallback(async (taskId) => {
    setLoadingLogs(true);
    try {
      const snap = await getDocs(query(scansCollection(taskId), orderBy('scannedAt', 'desc')));
      setScanLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch {
      toast.error('Failed to load scan logs.');
    } finally {
      setLoadingLogs(false);
    }
  }, [scansCollection]);

  // Resolve a userId to a display name from the users collection
  const resolveUserName = async (userId) => {
    if (!userId) return userId;
    try {
      const snap = await getDoc(doc(db, 'users', userId));
      if (snap.exists()) {
        const d = snap.data();
        return [d.name, d.lastName].filter(Boolean).join(' ') || d.email || userId;
      }
    } catch {}
    return userId;
  };

  // Fetch all scans across every task and attach task title + resolved user name
  const fetchAllLogs = useCallback(async (taskList) => {
    setLoadingAllLogs(true);
    try {
      const results = await Promise.all(
        taskList.map(async (task) => {
          const snap = await getDocs(query(scansCollection(task.id), orderBy('scannedAt', 'desc')));
          return snap.docs.map((d) => ({ id: d.id, taskId: task.id, taskTitle: task.title, ...d.data() }));
        })
      );
      const flat = results.flat();

      // Resolve unique user names in parallel
      const uniqueIds = [...new Set(flat.map((l) => l.userId).filter(Boolean))];
      const nameMap = {};
      await Promise.all(uniqueIds.map(async (uid) => { nameMap[uid] = await resolveUserName(uid); }));

      const enriched = flat
        .map((l) => ({ ...l, userName: nameMap[l.userId] || l.userId }))
        .sort((a, b) => {
          const ta = a.scannedAt?.toDate?.()?.getTime() || 0;
          const tb = b.scannedAt?.toDate?.()?.getTime() || 0;
          return tb - ta;
        });

      setAllLogs(enriched);
    } catch {
      toast.error('Failed to load data log.');
    } finally {
      setLoadingAllLogs(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scansCollection]);

  // ─── Commitment analysis ──────────────────────────────────────────────────
  // Classifies each person's faithfulness for a task by comparing how many of the
  // task's distinct scan dates ("sessions") they showed up for, plus their most
  // recent consecutive-attendance streak — someone who shows up almost every time
  // is "Faithful"; someone who only shows up now and then is "Occasional".
  const computeCommitmentStats = (taskId) => {
    const taskLogs = allLogs.filter((log) => log.taskId === taskId);
    const sessionDates = [...new Set(taskLogs.map((log) => log.date).filter(Boolean))].sort();

    const byUser = new Map();
    taskLogs.forEach((log) => {
      if (!log.userId) return;
      if (!byUser.has(log.userId)) {
        byUser.set(log.userId, { userId: log.userId, userName: log.userName || log.userId, dates: new Set() });
      }
      byUser.get(log.userId).dates.add(log.date);
    });

    const totalSessions = sessionDates.length;

    const stats = Array.from(byUser.values()).map((person) => {
      const attendedCount = person.dates.size;
      const attendanceRate = totalSessions > 0 ? attendedCount / totalSessions : 0;

      // Count the current streak by walking sessions from most recent backwards.
      let currentStreak = 0;
      for (let i = sessionDates.length - 1; i >= 0; i--) {
        if (person.dates.has(sessionDates[i])) currentStreak++;
        else break;
      }

      let level = 'Occasional';
      if (attendanceRate >= 0.75 || currentStreak >= 4) level = 'Faithful';
      else if (attendanceRate >= 0.4) level = 'Consistent';

      return { ...person, attendedCount, totalSessions, attendanceRate, currentStreak, level };
    });

    return stats.sort((a, b) => b.attendanceRate - a.attendanceRate || b.currentStreak - a.currentStreak);
  };

  // ─── Task CRUD ────────────────────────────────────────────────────────────

  const openAddTask = () => {
    setEditingTask(null);
    setTaskForm({ title: '', description: '', status: 'active' });
    setShowTaskForm(true);
  };

  const openEditTask = (task) => {
    setEditingTask(task);
    setTaskForm({ title: task.title, description: task.description || '', status: task.status || 'active' });
    setShowTaskForm(true);
  };

  const saveTask = async () => {
    if (!taskForm.title.trim()) { toast.error('Task title is required.'); return; }
    setSavingTask(true);
    try {
      if (editingTask) {
        await updateDoc(doc(db, 'churches', organizationId, 'trackMeTasks', editingTask.id), {
          title: taskForm.title.trim(),
          description: taskForm.description.trim(),
          status: taskForm.status,
          updatedAt: serverTimestamp(),
        });
        toast.success('Task updated.');
      } else {
        await addDoc(tasksCollection(), {
          title: taskForm.title.trim(),
          description: taskForm.description.trim(),
          status: taskForm.status,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || '',
        });
        toast.success('Task created.');
      }
      setShowTaskForm(false);
      fetchTasks();
    } catch {
      toast.error('Failed to save task.');
    } finally {
      setSavingTask(false);
    }
  };

  const deleteTask = async (task) => {
    if (!window.confirm(`Delete task "${task.title}"? All scan logs will also be deleted.`)) return;
    try {
      // Delete all scans first
      const scansSnap = await getDocs(scansCollection(task.id));
      await Promise.all(scansSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'churches', organizationId, 'trackMeTasks', task.id));
      toast.success('Task deleted.');
      if (selectedTask?.id === task.id) setSelectedTask(null);
      fetchTasks();
    } catch {
      toast.error('Failed to delete task.');
    }
  };

  // ─── QR Scanner ───────────────────────────────────────────────────────────

  const getLocation = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 5000 }
      );
    });

  const recordScan = async (userId, task) => {
    if (processingScans.has(userId)) return;
    setProcessingScans((prev) => new Set(prev).add(userId));

    try {
      const location = await getLocation();
      const now = new Date();
      const resolvedName = await resolveUserName(userId);
      await addDoc(scansCollection(task.id), {
        userId,
        userName: resolvedName,
        scannedAt: serverTimestamp(),
        date: now.toISOString().split('T')[0],
        time: now.toLocaleTimeString(),
        location: location || null,
        scannedBy: user?.uid || '',
        scannedByName: user?.name || user?.email || '',
      });
      toast.success(`✅ Scan recorded for task: ${task.title}`);
      setLastScanConfirmation({ userName: resolvedName, userId, time: now.toLocaleTimeString() });
      // Refresh data log if currently viewing it
      if (activeTab === TABS.DATA) fetchAllLogs(tasks);
    } catch {
      toast.error('Failed to record scan.');
    } finally {
      setProcessingScans((prev) => { const next = new Set(prev); next.delete(userId); return next; });
    }
  };

  const startScanner = useCallback((task) => {
    if (scannerInstanceRef.current) {
      scannerInstanceRef.current.clear().catch(() => {});
      scannerInstanceRef.current = null;
    }
    lastScannedCodeRef.current = null;
    setLastScanConfirmation(null);
    setScannerTask(task);
    setScannerActive(true);
  }, []);

  useEffect(() => {
    if (!scannerActive || !scannerTask || !scannerRef.current) return;

    const scanner = new Html5QrcodeScanner(
      'track-me-qr-reader',
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      },
      false
    );

    scanner.render(
      (decodedText) => {
        const userId = decodedText.trim();
        if (!userId) return;
        // Ignore repeated detections of the same QR code while it stays in view
        if (lastScannedCodeRef.current === userId) return;
        lastScannedCodeRef.current = userId;
        recordScan(userId, scannerTask);
      },
      () => {}
    );

    scannerInstanceRef.current = scanner;

    return () => {
      scanner.clear().catch(() => {});
      scannerInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerActive, scannerTask]);

  const stopScanner = () => {
    if (scannerInstanceRef.current) {
      scannerInstanceRef.current.clear().catch(() => {});
      scannerInstanceRef.current = null;
    }
    lastScannedCodeRef.current = null;
    setLastScanConfirmation(null);
    setScannerActive(false);
    setScannerTask(null);
  };

  // ─── View Logs ────────────────────────────────────────────────────────────

  const viewLogs = async (task) => {
    setSelectedTask(task);
    await fetchLogs(task.id);
    setActiveTab(TABS.LOGS);
  };

  // ─── Styles ───────────────────────────────────────────────────────────────

  const styles = {
    container: { maxWidth: 900, margin: '0 auto', padding: '24px 16px' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    title: { fontSize: 26, fontWeight: 700, color: '#1f2937', margin: 0 },
    tabBar: { display: 'flex', gap: 8, marginBottom: 24, borderBottom: '2px solid #e5e7eb', paddingBottom: 0 },
    tab: (active) => ({
      padding: '10px 20px',
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      fontWeight: active ? 700 : 400,
      color: active ? '#4f46e5' : '#6b7280',
      borderBottom: active ? '2px solid #4f46e5' : '2px solid transparent',
      marginBottom: -2,
      fontSize: 15,
    }),
    btn: (variant = 'primary') => ({
      padding: '8px 16px',
      borderRadius: 6,
      border: 'none',
      cursor: 'pointer',
      fontSize: 14,
      fontWeight: 600,
      background: variant === 'primary' ? '#4f46e5' : variant === 'danger' ? '#dc2626' : variant === 'success' ? '#16a34a' : '#e5e7eb',
      color: variant === 'ghost' ? '#374151' : 'white',
    }),
    card: {
      background: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    },
    input: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #d1d5db',
      borderRadius: 6,
      fontSize: 14,
      marginBottom: 12,
      boxSizing: 'border-box',
    },
    label: { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' },
    badge: (status) => ({
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      background: status === 'active' ? '#dcfce7' : '#f3f4f6',
      color: status === 'active' ? '#16a34a' : '#6b7280',
    }),
    commitmentBadge: (level) => ({
      display: 'inline-block',
      padding: '3px 12px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 700,
      background: level === 'Faithful' ? '#dcfce7' : level === 'Consistent' ? '#fef3c7' : '#fee2e2',
      color: level === 'Faithful' ? '#16a34a' : level === 'Consistent' ? '#b45309' : '#dc2626',
    }),
    commitmentRow: {
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
      gap: 8,
      padding: '10px 0',
      borderBottom: '1px solid #f3f4f6',
      fontSize: 13,
      alignItems: 'center',
    },
    commitmentHeader: {
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
      gap: 8,
      padding: '8px 0',
      borderBottom: '2px solid #e5e7eb',
      fontSize: 12,
      fontWeight: 700,
      color: '#6b7280',
      textTransform: 'uppercase',
    },
    logRow: {
      display: 'grid',
      gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1.2fr',
      gap: 8,
      padding: '10px 0',
      borderBottom: '1px solid #f3f4f6',
      fontSize: 13,
      alignItems: 'center',
    },
    logHeader: {
      display: 'grid',
      gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1.2fr',
      gap: 8,
      padding: '8px 0',
      borderBottom: '2px solid #e5e7eb',
      fontSize: 12,
      fontWeight: 700,
      color: '#6b7280',
      textTransform: 'uppercase',
    },
    taskLogRow: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr 1fr',
      gap: 8,
      padding: '10px 0',
      borderBottom: '1px solid #f3f4f6',
      fontSize: 13,
      alignItems: 'center',
    },
    taskLogHeader: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr 1fr',
      gap: 8,
      padding: '8px 0',
      borderBottom: '2px solid #e5e7eb',
      fontSize: 12,
      fontWeight: 700,
      color: '#6b7280',
      textTransform: 'uppercase',
    },
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ background: '#f9fafb', minHeight: '100vh' }}>
      <ChurchHeader churchId={organizationId} />
      <div style={styles.container}>
        {/* Page header */}
        <div style={styles.header}>
          <h1 style={styles.title}>📍 Track Me</h1>
          {activeTab === TABS.TASKS && (
            <button style={styles.btn('primary')} onClick={openAddTask}>+ New Task</button>
          )}
          {activeTab === TABS.SCANNER && scannerActive && (
            <button style={styles.btn('danger')} onClick={stopScanner}>Stop Scanner</button>
          )}
          {activeTab === TABS.LOGS && selectedTask && (
            <button style={styles.btn('ghost')} onClick={() => setActiveTab(TABS.TASKS)}>← Back to Tasks</button>
          )}
          {activeTab === TABS.DATA && (
            <button style={styles.btn('ghost')} onClick={() => fetchAllLogs(tasks)}>↻ Refresh</button>
          )}
          {activeTab === TABS.COMMITMENT && (
            <button style={styles.btn('ghost')} onClick={() => fetchAllLogs(tasks)}>↻ Refresh</button>
          )}
        </div>

        {/* Tab bar */}
        <div style={styles.tabBar}>
          <button style={styles.tab(activeTab === TABS.TASKS)} onClick={() => setActiveTab(TABS.TASKS)}>Tasks</button>
          <button style={styles.tab(activeTab === TABS.SCANNER)} onClick={() => setActiveTab(TABS.SCANNER)}>QR Scanner</button>
          <button
            style={styles.tab(activeTab === TABS.DATA)}
            onClick={() => { setActiveTab(TABS.DATA); fetchAllLogs(tasks); }}
          >
            Data Log
          </button>
          <button
            style={styles.tab(activeTab === TABS.COMMITMENT)}
            onClick={() => { setActiveTab(TABS.COMMITMENT); fetchAllLogs(tasks); }}
          >
            Commitment
          </button>
          {selectedTask && (
            <button style={styles.tab(activeTab === TABS.LOGS)} onClick={() => viewLogs(selectedTask)}>
              {selectedTask.title}
            </button>
          )}
        </div>

        {/* ── TASKS TAB ── */}
        {activeTab === TABS.TASKS && (
          <>
            {/* Task form modal inline */}
            {showTaskForm && (
              <div style={{
                background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
                padding: 24, marginBottom: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>
                  {editingTask ? 'Edit Task' : 'New Task'}
                </h3>
                <label style={styles.label}>Title *</label>
                <input
                  style={styles.input}
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Task name"
                />
                <label style={styles.label}>Description</label>
                <textarea
                  style={{ ...styles.input, height: 80, resize: 'vertical' }}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                />
                <label style={styles.label}>Status</label>
                <select
                  style={styles.input}
                  value={taskForm.status}
                  onChange={(e) => setTaskForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={styles.btn('primary')} onClick={saveTask} disabled={savingTask}>
                    {savingTask ? 'Saving…' : 'Save'}
                  </button>
                  <button style={styles.btn('ghost')} onClick={() => setShowTaskForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {loadingTasks ? (
              <p style={{ color: '#6b7280' }}>Loading tasks…</p>
            ) : tasks.length === 0 ? (
              <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No tasks yet. Click <strong>+ New Task</strong> to get started.
              </div>
            ) : (
              tasks.map((task) => (
                <div key={task.id} style={styles.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{task.title}</span>
                        <span style={styles.badge(task.status)}>{task.status}</span>
                      </div>
                      {task.description && (
                        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{task.description}</p>
                      )}
                      {task.createdAt && (
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>
                          Created: {task.createdAt?.toDate?.()?.toLocaleDateString() || '—'}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                      <button
                        style={styles.btn('success')}
                        onClick={() => { stopScanner(); setScannerTask(task); setActiveTab(TABS.SCANNER); startScanner(task); }}
                      >
                        📷 Scan
                      </button>
                      <button style={styles.btn('ghost')} onClick={() => viewLogs(task)}>📋 Logs</button>
                      <button style={styles.btn('ghost')} onClick={() => openEditTask(task)}>✏️ Edit</button>
                      <button style={styles.btn('danger')} onClick={() => deleteTask(task)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ── SCANNER TAB ── */}
        {activeTab === TABS.SCANNER && (
          <div>
            {!scannerTask ? (
              <div>
                <p style={{ color: '#374151', marginBottom: 16 }}>Select a task to start scanning user QR codes:</p>
                {loadingTasks ? (
                  <p style={{ color: '#6b7280' }}>Loading tasks…</p>
                ) : tasks.filter((t) => t.status === 'active').length === 0 ? (
                  <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                    No active tasks. Create one in the Tasks tab first.
                  </div>
                ) : (
                  tasks.filter((t) => t.status === 'active').map((task) => (
                    <div key={task.id} style={{ ...styles.card, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{task.title}</span>
                        {task.description && (
                          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>{task.description}</p>
                        )}
                      </div>
                      <button style={styles.btn('primary')} onClick={() => startScanner(task)}>
                        Start Scanning
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div>
                <div style={{ ...styles.card, background: '#eef2ff', borderColor: '#c7d2fe', marginBottom: 20 }}>
                  <p style={{ margin: 0, fontWeight: 700, color: '#3730a3' }}>
                    Scanning for task: <em>{scannerTask.title}</em>
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#4f46e5' }}>
                    Point the camera at a user's QR code from their profile. Each scan is automatically recorded with timestamp and location.
                  </p>
                </div>
                {lastScanConfirmation && (
                  <div style={{ ...styles.card, background: '#f0fdf4', borderColor: '#86efac', marginBottom: 20, textAlign: 'center' }}>
                    <p style={{ margin: 0, fontWeight: 700, color: '#166534', fontSize: 16 }}>
                      ✅ Scanned: {lastScanConfirmation.userName || lastScanConfirmation.userId}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#16a34a' }}>
                      Recorded at {lastScanConfirmation.time}. Scan a different QR code to continue.
                    </p>
                  </div>
                )}
                <div
                  id="track-me-qr-reader"
                  ref={scannerRef}
                  style={{ maxWidth: 400, margin: '0 auto' }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── LOGS TAB (per-task) ── */}
        {activeTab === TABS.LOGS && selectedTask && (
          <div>
            <div style={{ ...styles.card, background: '#f0fdf4', borderColor: '#bbf7d0', marginBottom: 20 }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#166534' }}>
                Scan logs for: <em>{selectedTask.title}</em>
              </p>
            </div>

            {loadingLogs ? (
              <p style={{ color: '#6b7280' }}>Loading logs…</p>
            ) : scanLogs.length === 0 ? (
              <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No scans recorded yet for this task.
              </div>
            ) : (
              <div style={styles.card}>
                <div style={styles.taskLogHeader}>
                  <span>User</span>
                  <span>Date</span>
                  <span>Time</span>
                  <span>Location</span>
                </div>
                {scanLogs.map((log) => (
                  <div key={log.id} style={styles.taskLogRow}>
                    <span style={{ fontWeight: 500, color: '#111827' }}>
                      {log.userName || log.userId || '—'}
                      {log.userName && log.userId && log.userName !== log.userId && (
                        <span style={{ display: 'block', fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
                          {log.userId}
                        </span>
                      )}
                    </span>
                    <span>{log.date || (log.scannedAt?.toDate?.()?.toLocaleDateString()) || '—'}</span>
                    <span>{log.time || (log.scannedAt?.toDate?.()?.toLocaleTimeString()) || '—'}</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>
                      {log.location
                        ? `${log.location.lat.toFixed(4)}, ${log.location.lng.toFixed(4)}`
                        : 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DATA LOG TAB (all tasks) ── */}
        {activeTab === TABS.DATA && (
          <div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <input
                style={{ ...styles.input, margin: 0, flex: '1 1 200px', minWidth: 160 }}
                placeholder="Search by user name or ID…"
                value={dataFilter.search}
                onChange={(e) => setDataFilter((f) => ({ ...f, search: e.target.value }))}
              />
              <select
                style={{ ...styles.input, margin: 0, flex: '0 0 200px' }}
                value={dataFilter.task}
                onChange={(e) => setDataFilter((f) => ({ ...f, task: e.target.value }))}
              >
                <option value="all">All Tasks</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>

            {loadingAllLogs ? (
              <p style={{ color: '#6b7280' }}>Loading data log…</p>
            ) : (() => {
              const filtered = allLogs.filter((log) => {
                const matchTask = dataFilter.task === 'all' || log.taskId === dataFilter.task;
                const q = dataFilter.search.toLowerCase();
                const matchSearch = !q ||
                  (log.userName || '').toLowerCase().includes(q) ||
                  (log.userId || '').toLowerCase().includes(q);
                return matchTask && matchSearch;
              });

              if (filtered.length === 0) return (
                <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                  {allLogs.length === 0 ? 'No scan data yet. Start scanning to see records here.' : 'No results match your filters.'}
                </div>
              );

              return (
                <div style={styles.card}>
                  <div style={{ marginBottom: 10, fontSize: 12, color: '#6b7280' }}>
                    {filtered.length} record{filtered.length !== 1 ? 's' : ''}
                    {dataFilter.task !== 'all' || dataFilter.search ? ' (filtered)' : ''}
                  </div>
                  <div style={styles.logHeader}>
                    <span>User</span>
                    <span>Task</span>
                    <span>Date</span>
                    <span>Time</span>
                    <span>Location</span>
                  </div>
                  {filtered.map((log) => (
                    <div key={`${log.taskId}-${log.id}`} style={styles.logRow}>
                      <span style={{ fontWeight: 500, color: '#111827' }}>
                        {log.userName || log.userId || '—'}
                        {log.userName && log.userId && log.userName !== log.userId && (
                          <span style={{ display: 'block', fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
                            {log.userId}
                          </span>
                        )}
                      </span>
                      <span style={{ color: '#4f46e5', fontWeight: 500 }}>{log.taskTitle || '—'}</span>
                      <span>{log.date || (log.scannedAt?.toDate?.()?.toLocaleDateString()) || '—'}</span>
                      <span>{log.time || (log.scannedAt?.toDate?.()?.toLocaleTimeString()) || '—'}</span>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>
                        {log.location
                          ? `${log.location.lat.toFixed(4)}, ${log.location.lng.toFixed(4)}`
                          : 'N/A'}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── COMMITMENT TAB ── */}
        {activeTab === TABS.COMMITMENT && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                style={{ ...styles.input, margin: 0, flex: '0 0 240px' }}
                value={commitmentTaskId}
                onChange={(e) => setCommitmentTaskId(e.target.value)}
              >
                {tasks.length === 0 && <option value="">No tasks yet</option>}
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                Faithful: attends ~75%+ of sessions or a 4+ session streak · Consistent: 40–74% · Occasional: under 40%
              </span>
            </div>

            {loadingAllLogs ? (
              <p style={{ color: '#6b7280' }}>Loading commitment data…</p>
            ) : !commitmentTaskId ? (
              <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                Create a task first to track commitment.
              </div>
            ) : (() => {
              const stats = computeCommitmentStats(commitmentTaskId);
              const task = tasks.find((t) => t.id === commitmentTaskId);
              const totalSessions = stats[0]?.totalSessions ?? 0;

              if (stats.length === 0) return (
                <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                  No scans recorded yet for "{task?.title}".
                </div>
              );

              return (
                <div style={styles.card}>
                  <div style={{ marginBottom: 10, fontSize: 12, color: '#6b7280' }}>
                    {stats.length} {stats.length !== 1 ? 'people' : 'person'} tracked across {totalSessions} session{totalSessions !== 1 ? 's' : ''} for "{task?.title}"
                  </div>
                  <div style={styles.commitmentHeader}>
                    <span>User</span>
                    <span>Sessions Attended</span>
                    <span>Attendance</span>
                    <span>Current Streak</span>
                    <span>Commitment</span>
                  </div>
                  {stats.map((person) => (
                    <div key={person.userId} style={styles.commitmentRow}>
                      <span style={{ fontWeight: 500, color: '#111827' }}>{person.userName}</span>
                      <span>{person.attendedCount} / {person.totalSessions}</span>
                      <span>{Math.round(person.attendanceRate * 100)}%</span>
                      <span>{person.currentStreak}</span>
                      <span><span style={styles.commitmentBadge(person.level)}>{person.level}</span></span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackMe;
