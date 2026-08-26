import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { db, storage } from '../firebase';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, where, serverTimestamp, Timestamp, getDoc, writeBatch
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import ChurchHeader from './ChurchHeader';

const TABS = { TASKS: 'tasks', SCANNER: 'scanner', LOGS: 'logs', DATA: 'data', COMMITMENT: 'commitment' };

// Maps a recurrence answer to the number of days between expected occurrences.
const RECURRENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };
const RECURRENCE_LABELS = { weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', custom: 'Custom' };

const TrackMe = () => {
  const { id: organizationId } = useParams();
  const { user, isAdmin, isGlobalAdmin } = useAuth();
  const canManageManualLogs = isAdmin() || isGlobalAdmin();

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

  // Manual log entry state (admin / global_admin only)
  const [manualLogTask, setManualLogTask] = useState(null);
  const [orgUsers, setOrgUsers] = useState([]);
  const [loadingOrgUsers, setLoadingOrgUsers] = useState(false);
  const [manualLogSearch, setManualLogSearch] = useState('');
  const [manualLogSelectedUser, setManualLogSelectedUser] = useState(null);
  const [manualLogDate, setManualLogDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [savingManualLog, setSavingManualLog] = useState(false);

  // Task form state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm, setTaskForm] = useState({
    title: '', description: '', status: 'active',
    expectedRecurrence: '', expectedRecurrenceDays: '', minCommitmentPercent: '', minCheckInsForEvaluation: '',
    imageUrl: '',
  });
  const [savingTask, setSavingTask] = useState(false);
  const [taskImageFile, setTaskImageFile] = useState(null);
  const [taskImagePreview, setTaskImagePreview] = useState('');
  const [uploadingTaskImage, setUploadingTaskImage] = useState(false);

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
      const loadedTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Respect the staff-defined sortOrder when present; tasks without one
      // (never manually reordered) keep their original createdAt-desc position.
      loadedTasks.sort((a, b) => {
        const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
        const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
        return aOrder - bOrder;
      });
      setTasks(loadedTasks);
    } catch {
      toast.error('Failed to load tasks.');
    } finally {
      setLoadingTasks(false);
    }
  }, [tasksCollection]);

  // Reorders tasks and persists the new order so it's reflected on the member-facing QR page.
  const moveTask = async (taskId, direction) => {
    const currentIndex = tasks.findIndex((t) => t.id === taskId);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= tasks.length) return;

    const reordered = [...tasks];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    setTasks(reordered);

    try {
      const batch = writeBatch(db);
      reordered.forEach((task, index) => {
        batch.update(doc(db, 'churches', organizationId, 'trackMeTasks', task.id), { sortOrder: index });
      });
      await batch.commit();
    } catch {
      toast.error('Failed to save the new order.');
      fetchTasks();
    }
  };

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
  // Each task answers three setup questions: how often it's expected to recur
  // (defines the expected number of sessions since the task was created, and
  // the "on-time" gap between check-ins), the minimum attendance percentage
  // required to be "Faithful", and the minimum total check-ins needed before
  // that evaluation is considered reliable (too few check-ins yet = "Too Early
  // to Evaluate" rather than a potentially misleading Faithful/Committed label).
  // Someone can hit the attendance percentage while still checking in in
  // sporadic bursts (e.g. weekly expected, but only every 3 weeks) — that gap
  // pattern is checked separately and also caps them at "Committed".
  const GAP_TOLERANCE_MULTIPLIER = 1.5;

  const taskHasCommitmentConfig = (task) =>
    !!task && !!(task.recurrenceDays) && !!(task.minCommitmentPercent) && !!(task.minCheckInsForEvaluation);

  const computeCommitmentStats = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!taskHasCommitmentConfig(task)) return null;

    const taskLogs = allLogs.filter((log) => log.taskId === taskId);
    const sessionDates = [...new Set(taskLogs.map((log) => log.date).filter(Boolean))].sort();

    const createdAt = task.createdAt?.toDate?.() || (sessionDates[0] ? new Date(sessionDates[0]) : new Date());
    const daysSinceCreated = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
    const expectedSessions = Math.max(1, Math.floor(daysSinceCreated / task.recurrenceDays) + 1, sessionDates.length);
    const threshold = task.minCommitmentPercent / 100;
    const maxAllowedGapDays = task.recurrenceDays * GAP_TOLERANCE_MULTIPLIER;
    const minCheckInsForEvaluation = task.minCheckInsForEvaluation;

    const byUser = new Map();
    taskLogs.forEach((log) => {
      if (!log.userId) return;
      if (!byUser.has(log.userId)) {
        byUser.set(log.userId, { userId: log.userId, userName: log.userName || log.userId, dates: new Set() });
      }
      byUser.get(log.userId).dates.add(log.date);
    });

    const stats = Array.from(byUser.values()).map((person) => {
      const attendedCount = person.dates.size;
      const attendanceRate = Math.min(1, attendedCount / expectedSessions);

      // Gaps between this person's own consecutive check-ins, compared to the
      // expected recurrence interval — catches sporadic-burst attendance that
      // a raw attendance rate alone can miss.
      const sortedDates = Array.from(person.dates).sort();
      const gapsDays = [];
      for (let i = 1; i < sortedDates.length; i++) {
        const days = Math.round((new Date(sortedDates[i]) - new Date(sortedDates[i - 1])) / 86400000);
        gapsDays.push(days);
      }
      const avgGapDays = gapsDays.length > 0
        ? Math.round(gapsDays.reduce((sum, g) => sum + g, 0) / gapsDays.length)
        : null;
      const maxGapDays = gapsDays.length > 0 ? Math.max(...gapsDays) : null;
      const hasConsistentGaps = maxGapDays === null || maxGapDays <= maxAllowedGapDays;

      let level;
      if (attendedCount < minCheckInsForEvaluation) level = 'Too Early to Evaluate';
      else if (attendanceRate >= threshold && hasConsistentGaps) level = 'Faithful';
      else level = 'Committed';

      return { ...person, attendedCount, expectedSessions, attendanceRate, avgGapDays, maxGapDays, hasConsistentGaps, level };
    });

    return {
      expectedSessions,
      threshold,
      maxAllowedGapDays,
      stats: stats.sort((a, b) => b.attendanceRate - a.attendanceRate),
    };
  };

  // ─── Task CRUD ────────────────────────────────────────────────────────────

  const emptyTaskForm = {
    title: '', description: '', status: 'active',
    expectedRecurrence: '', expectedRecurrenceDays: '', minCommitmentPercent: '', minCheckInsForEvaluation: '',
    imageUrl: '',
  };

  const openAddTask = () => {
    setEditingTask(null);
    setTaskForm(emptyTaskForm);
    setTaskImageFile(null);
    setTaskImagePreview('');
    setShowTaskForm(true);
  };

  const openEditTask = (task) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description || '',
      status: task.status || 'active',
      expectedRecurrence: task.expectedRecurrence || '',
      expectedRecurrenceDays: task.expectedRecurrence === 'custom' ? String(task.recurrenceDays || '') : '',
      minCommitmentPercent: task.minCommitmentPercent ? String(task.minCommitmentPercent) : '',
      minCheckInsForEvaluation: task.minCheckInsForEvaluation ? String(task.minCheckInsForEvaluation) : '',
      imageUrl: task.imageUrl || '',
    });
    setTaskImageFile(null);
    setTaskImagePreview(task.imageUrl || '');
    setShowTaskForm(true);
  };

  const handleTaskImageSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) { toast.error("File doesn't have a valid image type."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB.'); return; }

    setTaskImageFile(file);
    setTaskImagePreview(URL.createObjectURL(file));
  };

  const removeTaskImage = () => {
    setTaskImageFile(null);
    setTaskImagePreview('');
    setTaskForm((f) => ({ ...f, imageUrl: '' }));
  };

  const saveTask = async () => {
    if (!taskForm.title.trim()) { toast.error('Task title is required.'); return; }

    const recurrenceDays = taskForm.expectedRecurrence === 'custom'
      ? Number(taskForm.expectedRecurrenceDays)
      : RECURRENCE_DAYS[taskForm.expectedRecurrence];
    const minCommitmentPercent = Number(taskForm.minCommitmentPercent);
    const minCheckInsForEvaluation = Number(taskForm.minCheckInsForEvaluation);

    const commitmentFields = {
      expectedRecurrence: taskForm.expectedRecurrence || null,
      recurrenceDays: recurrenceDays > 0 ? recurrenceDays : null,
      minCommitmentPercent: minCommitmentPercent > 0 && minCommitmentPercent <= 100 ? minCommitmentPercent : null,
      minCheckInsForEvaluation: minCheckInsForEvaluation > 0 ? minCheckInsForEvaluation : null,
    };

    setSavingTask(true);
    try {
      let imageUrl = taskForm.imageUrl || null;

      if (taskImageFile && storage) {
        setUploadingTaskImage(true);
        const uniqueFileName = `task-image-${Date.now()}-${taskImageFile.name}`;
        const fileRef = storageRef(storage, `churches/${organizationId}/trackMeTasks/${uniqueFileName}`);
        await uploadBytes(fileRef, taskImageFile);
        imageUrl = await getDownloadURL(fileRef);

        // Clean up the previous image if this task already had one.
        if (editingTask?.imageUrl && editingTask.imageUrl !== imageUrl) {
          deleteObject(storageRef(storage, editingTask.imageUrl)).catch(() => {});
        }
        setUploadingTaskImage(false);
      }

      if (editingTask) {
        await updateDoc(doc(db, 'churches', organizationId, 'trackMeTasks', editingTask.id), {
          title: taskForm.title.trim(),
          description: taskForm.description.trim(),
          status: taskForm.status,
          imageUrl,
          ...commitmentFields,
          updatedAt: serverTimestamp(),
        });
        toast.success('Task updated.');
      } else {
        await addDoc(tasksCollection(), {
          title: taskForm.title.trim(),
          description: taskForm.description.trim(),
          status: taskForm.status,
          imageUrl,
          ...commitmentFields,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || '',
        });
        toast.success('Task created.');
      }
      setShowTaskForm(false);
      setTaskImageFile(null);
      setTaskImagePreview('');
      fetchTasks();
    } catch {
      toast.error('Failed to save task.');
    } finally {
      setSavingTask(false);
      setUploadingTaskImage(false);
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

  // ─── Manual log entry (admin / global_admin) ──────────────────────────────

  const openManualLog = async (task) => {
    setManualLogTask(task);
    setManualLogSearch('');
    setManualLogSelectedUser(null);
    setManualLogDate(new Date().toISOString().split('T')[0]);

    if (orgUsers.length === 0) {
      setLoadingOrgUsers(true);
      try {
        const usersRef = collection(db, 'users');
        const snap = await getDocs(query(usersRef, where('churchId', '==', organizationId)));
        setOrgUsers(snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, name: [data.name, data.lastName].filter(Boolean).join(' ') || data.email || d.id };
        }));
      } catch {
        toast.error('Failed to load members.');
      } finally {
        setLoadingOrgUsers(false);
      }
    }
  };

  const closeManualLog = () => {
    setManualLogTask(null);
    setManualLogSelectedUser(null);
  };

  const submitManualLog = async () => {
    if (!manualLogTask || !manualLogSelectedUser || !manualLogDate) {
      toast.error('Select a member and a date.');
      return;
    }
    setSavingManualLog(true);
    try {
      const chosenDate = new Date(`${manualLogDate}T12:00:00`);
      await addDoc(scansCollection(manualLogTask.id), {
        userId: manualLogSelectedUser.id,
        userName: manualLogSelectedUser.name,
        scannedAt: Timestamp.fromDate(chosenDate),
        date: manualLogDate,
        time: chosenDate.toLocaleTimeString(),
        location: null,
        scannedBy: user?.uid || '',
        scannedByName: user?.name || user?.email || '',
        manualEntry: true,
      });
      toast.success(`✅ Manual log added for ${manualLogSelectedUser.name}`);
      closeManualLog();
      if (activeTab === TABS.DATA) fetchAllLogs(tasks);
      if (selectedTask?.id === manualLogTask.id) fetchLogs(manualLogTask.id);
    } catch {
      toast.error('Failed to add manual log.');
    } finally {
      setSavingManualLog(false);
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
      background: level === 'Faithful' ? '#dcfce7' : level === 'Committed' ? '#fef3c7' : '#f3f4f6',
      color: level === 'Faithful' ? '#16a34a' : level === 'Committed' ? '#b45309' : '#6b7280',
    }),
    configWarningBadge: {
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      background: '#fee2e2',
      color: '#dc2626',
    },
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

                <label style={styles.label}>Task Image (shown as a card on the member's QR page)</label>
                {taskImagePreview && (
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img
                      src={taskImagePreview}
                      alt="Task"
                      style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <button type="button" style={styles.btn('ghost')} onClick={removeTaskImage}>Remove</button>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/jpg, image/webp"
                  style={styles.input}
                  onChange={handleTaskImageSelect}
                />

                <div style={{
                  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
                  padding: 16, marginBottom: 12,
                }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                    Commitment criteria — needed to evaluate faithfulness for this task
                  </p>

                  <label style={styles.label}>1. How often is this task expected to happen? *</label>
                  <select
                    style={styles.input}
                    value={taskForm.expectedRecurrence}
                    onChange={(e) => setTaskForm((f) => ({ ...f, expectedRecurrence: e.target.value }))}
                  >
                    <option value="">Select recurrence…</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="custom">Custom (every N days)</option>
                  </select>
                  {taskForm.expectedRecurrence === 'custom' && (
                    <input
                      type="number"
                      min="1"
                      style={styles.input}
                      placeholder="Every how many days?"
                      value={taskForm.expectedRecurrenceDays}
                      onChange={(e) => setTaskForm((f) => ({ ...f, expectedRecurrenceDays: e.target.value }))}
                    />
                  )}

                  <label style={styles.label}>2. What's the minimum attendance % to be considered faithfully committed? *</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    style={styles.input}
                    placeholder="e.g. 75"
                    value={taskForm.minCommitmentPercent}
                    onChange={(e) => setTaskForm((f) => ({ ...f, minCommitmentPercent: e.target.value }))}
                  />

                  <label style={styles.label}>3. What's the minimum total check-ins needed for a solid faithful-commitment evaluation? *</label>
                  <input
                    type="number"
                    min="1"
                    style={styles.input}
                    placeholder="e.g. 4"
                    value={taskForm.minCheckInsForEvaluation}
                    onChange={(e) => setTaskForm((f) => ({ ...f, minCheckInsForEvaluation: e.target.value }))}
                  />

                  {(!taskForm.expectedRecurrence || !taskForm.minCommitmentPercent || !taskForm.minCheckInsForEvaluation) && (
                    <p style={{ margin: 0, fontSize: 12, color: '#dc2626' }}>
                      ⚠️ Not answered yet — Commitment stats can't be calculated for this task until all three questions are answered.
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={styles.btn('primary')} onClick={saveTask} disabled={savingTask}>
                    {uploadingTaskImage ? 'Uploading image…' : savingTask ? 'Saving…' : 'Save'}
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
              tasks.map((task, index) => (
                <div key={task.id} style={styles.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                      <button
                        style={{ ...styles.btn('ghost'), padding: '2px 8px', opacity: index === 0 ? 0.35 : 1 }}
                        onClick={() => moveTask(task.id, 'up')}
                        disabled={index === 0}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        style={{ ...styles.btn('ghost'), padding: '2px 8px', opacity: index === tasks.length - 1 ? 0.35 : 1 }}
                        onClick={() => moveTask(task.id, 'down')}
                        disabled={index === tasks.length - 1}
                        title="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    {task.imageUrl && (
                      <img
                        src={task.imageUrl}
                        alt={task.title}
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', flexShrink: 0 }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{task.title}</span>
                        <span style={styles.badge(task.status)}>{task.status}</span>
                        {!taskHasCommitmentConfig(task) && (
                          <span style={styles.configWarningBadge}>⚠️ Commitment criteria not set</span>
                        )}
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
                      {canManageManualLogs && (
                        <button style={styles.btn('ghost')} onClick={() => openManualLog(task)}>➕ Add Log</button>
                      )}
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
                  <option key={t.id} value={t.id}>
                    {t.title}{!taskHasCommitmentConfig(t) ? ' (criteria not set)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {loadingAllLogs ? (
              <p style={{ color: '#6b7280' }}>Loading commitment data…</p>
            ) : !commitmentTaskId ? (
              <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                Create a task first to track commitment.
              </div>
            ) : (() => {
              const task = tasks.find((t) => t.id === commitmentTaskId);

              if (!taskHasCommitmentConfig(task)) return (
                <div style={{ ...styles.card, textAlign: 'center', color: '#dc2626', padding: 40 }}>
                  ⚠️ "{task?.title}" doesn't have commitment criteria set yet.<br />
                  <span style={{ color: '#6b7280', fontSize: 13 }}>
                    Edit the task and answer the two required questions (expected recurrence and minimum attendance %) to evaluate commitment.
                  </span>
                  <div style={{ marginTop: 16 }}>
                    <button style={styles.btn('primary')} onClick={() => { setActiveTab(TABS.TASKS); openEditTask(task); }}>
                      Edit "{task?.title}"
                    </button>
                  </div>
                </div>
              );

              const result = computeCommitmentStats(commitmentTaskId);
              const { expectedSessions, threshold, maxAllowedGapDays, stats } = result;

              if (stats.length === 0) return (
                <div style={{ ...styles.card, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                  No scans recorded yet for "{task?.title}".
                </div>
              );

              return (
                <div style={styles.card}>
                  <div style={{ marginBottom: 10, fontSize: 12, color: '#6b7280' }}>
                    {stats.length} {stats.length !== 1 ? 'people' : 'person'} tracked · {RECURRENCE_LABELS[task.expectedRecurrence]} recurrence (every {task.recurrenceDays} days)
                    · {expectedSessions} expected session{expectedSessions !== 1 ? 's' : ''} so far
                    · Faithful requires {Math.round(threshold * 100)}%+ attendance with check-ins no more than {maxAllowedGapDays} days apart
                    · at least {task.minCheckInsForEvaluation} total check-ins before a level is assigned
                  </div>
                  <div style={{ ...styles.commitmentHeader, gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1fr' }}>
                    <span>User</span>
                    <span>Sessions Attended</span>
                    <span>Attendance</span>
                    <span>Avg Gap Between Check-ins</span>
                    <span>Commitment</span>
                  </div>
                  {stats.map((person) => (
                    <div key={person.userId} style={{ ...styles.commitmentRow, gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1fr' }}>
                      <span style={{ fontWeight: 500, color: '#111827' }}>{person.userName}</span>
                      <span>{person.attendedCount} / {person.expectedSessions}</span>
                      <span>{Math.round(person.attendanceRate * 100)}%</span>
                      <span>
                        {person.avgGapDays === null ? '—' : `${person.avgGapDays}d`}
                        {!person.hasConsistentGaps && (
                          <span style={{ display: 'block', fontSize: 10, color: '#dc2626' }}>
                            ⚠️ irregular (expected ~{task.recurrenceDays}d)
                          </span>
                        )}
                      </span>
                      <span><span style={styles.commitmentBadge(person.level)}>{person.level}</span></span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {manualLogTask && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
          }}
          onClick={closeManualLog}
        >
          <div
            style={{ background: 'white', borderRadius: 10, padding: 24, width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Add Manual Log</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>Task: {manualLogTask.title}</p>

            <label style={styles.label}>Member *</label>
            <input
              style={styles.input}
              placeholder="Search by name or email…"
              value={manualLogSelectedUser ? manualLogSelectedUser.name : manualLogSearch}
              onChange={(e) => { setManualLogSearch(e.target.value); setManualLogSelectedUser(null); }}
            />
            {!manualLogSelectedUser && manualLogSearch.trim() && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, maxHeight: 160, overflowY: 'auto', marginBottom: 12 }}>
                {loadingOrgUsers ? (
                  <p style={{ padding: 10, margin: 0, fontSize: 13, color: '#6b7280' }}>Loading members…</p>
                ) : (
                  orgUsers
                    .filter((u) => u.name.toLowerCase().includes(manualLogSearch.trim().toLowerCase()))
                    .slice(0, 20)
                    .map((u) => (
                      <div
                        key={u.id}
                        style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}
                        onClick={() => { setManualLogSelectedUser(u); setManualLogSearch(''); }}
                      >
                        {u.name}
                      </div>
                    ))
                )}
              </div>
            )}

            <label style={styles.label}>Date *</label>
            <input
              type="date"
              style={styles.input}
              value={manualLogDate}
              onChange={(e) => setManualLogDate(e.target.value)}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={styles.btn('primary')} onClick={submitManualLog} disabled={savingManualLog}>
                {savingManualLog ? 'Saving…' : 'Add Log'}
              </button>
              <button style={styles.btn('ghost')} onClick={closeManualLog}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrackMe;
