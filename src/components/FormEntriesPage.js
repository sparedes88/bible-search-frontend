import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  deleteDoc, 
  query, 
  orderBy,
  getDoc,
  setDoc,
  Timestamp
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import { FiDownload, FiTrash2, FiArrowLeft, FiRefreshCw, FiBarChart2 } from 'react-icons/fi';
import { analyzeFormEntries, getChurchData } from '../api/church';
import './Forms.css';
import html2pdf from 'html2pdf.js';

const FormEntriesPage = () => {
  const { id, formId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [churchLogoUrl, setChurchLogoUrl] = useState(null);
  const [churchName, setChurchName] = useState('');
  
  // AI Analysis states
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [showQuestionnaireModal, setShowQuestionnaireModal] = useState(false);
  const [pastoralContext, setPastoralContext] = useState({
    specificQuestions: ''
  });
  
  // Analysis history states
  const [analysisHistory, setAnalysisHistory] = useState([]);
  // Ref for PDF export
  const analysisRef = useRef(null);

  const handleDownloadAnalysisPDF = async () => {
    try {
      if (!analysisRef.current) return;
      const filenameSafeTitle = (form?.title || 'Form-Analysis').replace(/[^a-z0-9\-\_ ]/gi, '').replace(/\s+/g, '-');
      const ts = new Date();
      const stamp = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}`;
      const opt = {
        margin:       [10, 10, 10, 10],
        filename:     `${filenameSafeTitle}-${stamp}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      await html2pdf().set(opt).from(analysisRef.current).save();
      toast.success('PDF downloaded');
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate PDF');
    }
  };

  // Load church logo/name for header
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        if (!id) return;
        const data = await getChurchData(id);
        if (!isMounted) return;
        setChurchLogoUrl(data?.logo || '/img/logo-fallback.svg');
        setChurchName(data?.name || data?.churchName || '');
      } catch (e) {
        setChurchLogoUrl('/img/logo-fallback.svg');
      }
    })();
    return () => { isMounted = false; };
  }, [id]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedHistoryAnalysis, setSelectedHistoryAnalysis] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Check authentication
  useEffect(() => {
    if (!user) {
      console.log('No user found in FormEntriesPage, redirecting to login');
      navigate(`/church/${id}/login?returnUrl=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [user, id, navigate]);

  useEffect(() => {
    if (user && id && formId) {
      fetchForm();
      fetchEntries();
      loadAnalysisHistory();
    }
  }, [id, formId, user]);

  const fetchForm = async () => {
    try {
      if (!id || !formId) {
        console.error('Missing parameters:', { id, formId });
        toast.error('Invalid form URL');
        return;
      }

      const formRef = doc(db, 'churches', id, 'forms', formId);
      const formDoc = await getDoc(formRef);
      
      if (formDoc.exists()) {
        setForm({ id: formDoc.id, ...formDoc.data() });
      } else {
        toast.error('Form not found');
        navigate(`/organization/${id}/forms`);
      }
    } catch (error) {
      console.error('Error fetching form:', error);
      toast.error(`Failed to load form: ${error.message}`);
    }
  };

  const fetchEntries = async () => {
    try {
      setLoading(true);
      
      if (!id || !formId) {
        console.error('Missing parameters for fetchEntries:', { id, formId });
        return;
      }

      const entriesRef = collection(db, 'churches', id, 'forms', formId, 'entries');
      const q = query(entriesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const entriesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setEntries(entriesData);
    } catch (error) {
      console.error('Error fetching entries:', error);
      toast.error(`Failed to load entries: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this entry? This action cannot be undone.')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'churches', id, 'forms', formId, 'entries', entryId));
      toast.success('Entry deleted successfully');
      fetchEntries();
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast.error('Failed to delete entry');
    }
  };

  const loadAnalysisHistory = async () => {
    try {
      setLoadingHistory(true);
      const historyRef = collection(db, 'churches', id, 'forms', formId, 'analyses');
      const q = query(historyRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()
      }));
      
      setAnalysisHistory(history);
    } catch (error) {
      console.error('Error loading analysis history:', error);
      toast.error('Failed to load analysis history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleOpenQuestionnaire = () => {
    setShowQuestionnaireModal(true);
  };

  const handleSubmitQuestionnaire = async () => {
    if (entries.length === 0) {
      toast.error('No entries to analyze');
      return;
    }

    try {
      setAnalyzingAI(true);
      setShowQuestionnaireModal(false);
      
      // Prepare data for AI analysis - only send necessary data
      const entriesData = entries.map(entry => {
        const entryData = {};
        form.fields.forEach(field => {
          entryData[field.name] = entry[field.name];
        });
        return entryData;
      });

      // Get previous analysis for comparison if exists
      await loadAnalysisHistory();
      const previousAnalysis = analysisHistory.length > 0 ? analysisHistory[0] : null;

      // Call the API with pastoral context
      const analysis = await analyzeFormEntries(
        form.title, 
        form.fields, 
        entriesData,
        pastoralContext,
        previousAnalysis
      );
      
      // Save analysis to Firestore
      const analysisId = `analysis_${Date.now()}`;
      await setDoc(doc(db, 'churches', id, 'forms', formId, 'analyses', analysisId), {
        ...analysis,
        pastoralContext,
        formTitle: form.title,
        entryCount: entries.length,
        createdAt: Timestamp.now(),
        createdBy: user?.email || 'Unknown'
      });
      
      setAiAnalysis(analysis);
      setShowAIAnalysis(true);
      toast.success('AI Analysis complete and saved!');
      
      // Reload history to include new analysis
      await loadAnalysisHistory();
    } catch (error) {
      console.error('Error analyzing with AI:', error);
      toast.error(error.message || 'Failed to generate AI analysis. Please try again.');
    } finally {
      setAnalyzingAI(false);
    }
  };

  const exportToCSV = () => {
    if (entries.length === 0) {
      toast.error('No entries to export');
      return;
    }

    const headers = ['Submission Date', 'Submitted By', ...form.fields.map(field => field.label)];
    const csvData = [
      headers,
      ...entries.map(entry => [
        entry.createdAt ? new Date(entry.createdAt.toDate()).toLocaleString() : 'Unknown',
        entry.submittedBy || 'Anonymous',
        ...form.fields.map(field => {
          const value = entry[field.name];
          if (Array.isArray(value)) {
            return value.join(', ');
          }
          return value || '';
        })
      ])
    ];

    const csvContent = csvData.map(row => 
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.title}_entries.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success('Entries exported successfully!');
  };

  const renderFieldValue = (field, value) => {
    if (value === null || value === undefined) return '-';
    
    switch (field.type) {
      case 'checkbox':
        return Array.isArray(value) ? value.join(', ') : '-';
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'date':
        return value ? new Date(value).toLocaleDateString() : '-';
      default:
        return value || '-';
    }
  };

  const filteredEntries = entries.filter(entry => {
    if (!searchTerm) return true;
    
    const searchLower = searchTerm.toLowerCase();
    return form.fields.some(field => {
      const value = entry[field.name];
      if (typeof value === 'string') {
        return value.toLowerCase().includes(searchLower);
      }
      if (Array.isArray(value)) {
        return value.some(v => String(v).toLowerCase().includes(searchLower));
      }
      return false;
    });
  });

  if (loading || !form) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}>
        <div>Loading entries...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '100%',
        margin: '0 auto',
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '16px',
        border: '1px solid #E5E7EB',
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)'
      }}>
        {/* Church Logo - top center */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <div style={{ textAlign: 'center' }}>
            <img
              src={churchLogoUrl || '/img/logo-fallback.svg'}
              alt={churchName ? `${churchName} Logo` : 'Church Logo'}
              style={{ width: 80, height: 80, objectFit: 'contain' }}
              onError={(e) => { e.currentTarget.src = '/img/logo-fallback.svg'; }}
            />
            {churchName && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6b7280' }}>{churchName}</div>
            )}
          </div>
        </div>

        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '2rem',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div>
            <Link 
              to={`/organization/${id}/forms`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: '#4f46e5',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: '500',
                marginBottom: '0.5rem'
              }}
            >
              <FiArrowLeft /> Back to Forms
            </Link>
            <h1 style={{ 
              margin: 0, 
              fontSize: '1.75rem', 
              fontWeight: '700',
              color: '#111827'
            }}>
              {form.title} - Entries
            </h1>
            <p style={{ margin: '0.5rem 0 0 0', color: '#6b7280' }}>
              {entries.length} {entries.length === 1 ? 'submission' : 'submissions'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleOpenQuestionnaire}
              disabled={entries.length === 0 || analyzingAI}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: entries.length === 0 || analyzingAI ? '#9ca3af' : '#6366f1',
                color: 'white',
                padding: '0.75rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                cursor: entries.length === 0 || analyzingAI ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: '600'
              }}
            >
              <FiBarChart2 /> {analyzingAI ? 'Analyzing...' : 'AI Analysis'}
            </button>
            {analysisHistory.length > 0 && (
              <button
                onClick={() => { loadAnalysisHistory(); setShowHistoryModal(true); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  padding: '0.75rem 1.25rem',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '600'
                }}
              >
                📊 History ({analysisHistory.length})
              </button>
            )}
            <button
              onClick={exportToCSV}
              disabled={entries.length === 0}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: entries.length === 0 ? '#9ca3af' : '#10b981',
                color: 'white',
                padding: '0.75rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                cursor: entries.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: '600'
              }}
            >
              <FiDownload /> Export CSV
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="text"
            placeholder="Search entries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              border: '2px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '0.875rem'
            }}
          />
        </div>

        {/* Overview when Analysis is hidden */}
        {!showAIAnalysis && (
          <div style={{
            marginBottom: '1.5rem',
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            padding: '1rem'
          }}>
            {/* Top Stats */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              {/* Total Entries */}
              <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Total Entries</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{entries.length}</div>
              </div>

              {/* New in last 7 days */}
              <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Last 7 Days</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
                  {entries.filter(e => {
                    try {
                      const d = e.createdAt?.toDate ? e.createdAt.toDate() : (e.createdAt ? new Date(e.createdAt) : null);
                      if (!d) return false;
                      const now = new Date();
                      const seven = new Date(now.getTime() - 7*24*60*60*1000);
                      return d >= seven && d <= now;
                    } catch { return false; }
                  }).length}
                </div>
              </div>

              {/* Latest Health Grade */}
              <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Latest Health Grade</div>
                {analysisHistory?.length > 0 && analysisHistory[0]?.healthMetrics?.overall != null ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{analysisHistory[0].healthMetrics.overall}</div>
                    {analysisHistory.length > 1 && analysisHistory[1]?.healthMetrics?.overall != null && (
                      (() => {
                        const delta = analysisHistory[0].healthMetrics.overall - analysisHistory[1].healthMetrics.overall;
                        return (
                          <div style={{ fontSize: '0.875rem', color: delta >= 0 ? '#059669' : '#b91c1c' }}>
                            {delta >= 0 ? '+' : ''}{delta}
                          </div>
                        );
                      })()
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '1rem', color: '#6b7280' }}>No analysis yet</div>
                )}
              </div>
            </div>

            {/* Weekly Trend (last 8 weeks) */}
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>Weekly Entries Trend</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', height: 120 }}>
                {(() => {
                  const now = new Date();
                  const startOfWeek = (date) => {
                    const d = new Date(date);
                    d.setHours(0,0,0,0);
                    const day = d.getDay(); // 0 Sun - 6 Sat
                    const diff = day === 0 ? 6 : day - 1; // Monday-based
                    d.setDate(d.getDate() - diff);
                    return d;
                  };
                  const weeks = [];
                  let cursor = startOfWeek(now);
                  for (let i = 7; i >= 0; i--) {
                    const wStart = new Date(startOfWeek(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i*7)));
                    const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 7);
                    weeks.push({ start: wStart, end: wEnd });
                  }
                  const counts = weeks.map(w => entries.filter(e => {
                    try {
                      const d = e.createdAt?.toDate ? e.createdAt.toDate() : (e.createdAt ? new Date(e.createdAt) : null);
                      return d && d >= w.start && d < w.end;
                    } catch { return false; }
                  }).length);
                  const max = Math.max(1, ...counts);
                  return counts.map((c, idx) => (
                    <div key={idx} style={{ flex: 1 }}>
                      <div style={{
                        height: `${(c / max) * 100}%`,
                        background: 'linear-gradient(180deg, #818cf8, #6366f1)',
                        borderTopLeftRadius: '4px',
                        borderTopRightRadius: '4px'
                      }} />
                      <div style={{ fontSize: '0.7rem', color: '#6b7280', textAlign: 'center', marginTop: '0.25rem' }}>
                        wk-{idx+1}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        {/* AI Analysis Section */}
        {showAIAnalysis && aiAnalysis && (
          <div ref={analysisRef} style={{
            marginBottom: '2rem',
            padding: '2rem',
            backgroundColor: '#f9fafb',
            borderRadius: '12px',
            border: '2px solid #e5e7eb'
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '1.5rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img src="/logo.png" alt="Logo" style={{ width: 36, height: 36, borderRadius: '4px' }} />
                <h2 style={{ 
                  margin: 0, 
                  fontSize: '1.5rem', 
                  fontWeight: '700',
                  color: '#111827',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <FiBarChart2 style={{ color: '#6366f1' }} />
                  Pastoral Insights & Analysis
                </h2>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={handleDownloadAnalysisPDF}
                  style={{
                    padding: '0.5rem 0.75rem',
                    backgroundColor: '#111827',
                    color: 'white',
                    border: '1px solid #111827',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                  title="Download PDF"
                >
                  <FiDownload /> PDF
                </button>
                <button
                  onClick={() => setShowAIAnalysis(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  Hide Analysis
                </button>
              </div>
            </div>

            {/* Overall Health Rating */}
            {aiAnalysis.healthMetrics && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  Church Health Score
                </h3>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  marginBottom: '1rem'
                }}>
                  <div style={{
                    fontSize: '3rem',
                    fontWeight: '700',
                    color: aiAnalysis.healthMetrics.overall >= 80 ? '#10b981' : 
                           aiAnalysis.healthMetrics.overall >= 60 ? '#f59e0b' : '#ef4444'
                  }}>
                    {aiAnalysis.healthMetrics.overall}
                  </div>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#374151' }}>
                      {aiAnalysis.healthMetrics.overall >= 80 ? 'Excellent' : 
                       aiAnalysis.healthMetrics.overall >= 60 ? 'Good' : 'Needs Attention'}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                      Overall Health Rating
                    </div>
                  </div>
                </div>
                
                {/* Individual Metrics */}
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '1rem',
                  marginTop: '1rem'
                }}>
                  {Object.entries(aiAnalysis.healthMetrics).filter(([key]) => key !== 'overall').map(([key, value]) => (
                    <div key={key} style={{
                      padding: '1rem',
                      backgroundColor: '#f9fafb',
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      <div style={{
                        fontSize: '1.5rem',
                        fontWeight: '700',
                        color: value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#ef4444',
                        marginBottom: '0.25rem'
                      }}>
                        {value}
                      </div>
                      <div style={{
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        color: '#6b7280',
                        textTransform: 'capitalize'
                      }}>
                        {key}
                      </div>
                      <div style={{
                        width: '100%',
                        height: '4px',
                        backgroundColor: '#e5e7eb',
                        borderRadius: '2px',
                        marginTop: '0.5rem',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${value}%`,
                          height: '100%',
                          backgroundColor: value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#ef4444',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Executive Summary */}
            {aiAnalysis.executiveSummary && (
              <div style={{
                backgroundColor: '#eff6ff',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                borderLeft: '4px solid #3b82f6'
              }}>
                <h3 style={{ 
                  margin: '0 0 0.75rem 0', 
                  fontSize: '1rem', 
                  fontWeight: '600',
                  color: '#1e40af'
                }}>
                  Executive Summary
                </h3>
                <p style={{ margin: 0, color: '#1e3a8a', lineHeight: '1.6' }}>
                  {aiAnalysis.executiveSummary}
                </p>
              </div>
            )}

            {/* Progress Comparison (if available) */}
            {aiAnalysis.progressComparison && (
              <div style={{
                backgroundColor: '#f0fdf4',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                borderLeft: '4px solid #10b981'
              }}>
                <h3 style={{ 
                  margin: '0 0 0.75rem 0', 
                  fontSize: '1rem', 
                  fontWeight: '600',
                  color: '#065f46'
                }}>
                  📈 Progress Since Last Analysis
                </h3>
                <div style={{ marginBottom: '1rem' }}>
                  <strong style={{ color: '#064e3b' }}>Overall Change: </strong>
                  <span style={{ 
                    fontSize: '1.25rem', 
                    fontWeight: '700',
                    color: aiAnalysis.progressComparison.overallChange?.startsWith('+') ? '#10b981' : '#ef4444'
                  }}>
                    {aiAnalysis.progressComparison.overallChange}
                  </span>
                </div>
                {aiAnalysis.progressComparison.improvements?.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <strong style={{ color: '#064e3b' }}>Improvements:</strong>
                    <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem', color: '#065f46' }}>
                      {aiAnalysis.progressComparison.improvements.map((imp, idx) => (
                        <li key={idx} style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>{imp}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiAnalysis.progressComparison.regressions?.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <strong style={{ color: '#064e3b' }}>Areas Needing Attention:</strong>
                    <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem', color: '#92400e' }}>
                      {aiAnalysis.progressComparison.regressions.map((reg, idx) => (
                        <li key={idx} style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>{reg}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiAnalysis.progressComparison.trendAnalysis && (
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#064e3b', fontStyle: 'italic' }}>
                    {aiAnalysis.progressComparison.trendAnalysis}
                  </p>
                )}
              </div>
            )}

            {/* What People Are Saying */}
            {aiAnalysis.whatPeopleAreSaying && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  💬 What Your People Are Saying
                </h3>
                
                {aiAnalysis.whatPeopleAreSaying.emotionalTone && (
                  <div style={{ 
                    padding: '0.75rem 1rem', 
                    backgroundColor: '#f9fafb', 
                    borderRadius: '6px', 
                    marginBottom: '1rem',
                    fontSize: '0.875rem'
                  }}>
                    <strong style={{ color: '#374151' }}>Overall Tone: </strong>
                    <span style={{ color: '#6b7280', fontStyle: 'italic' }}>
                      {aiAnalysis.whatPeopleAreSaying.emotionalTone}
                    </span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                  {aiAnalysis.whatPeopleAreSaying.positiveThemes?.length > 0 && (
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#10b981' }}>
                        ✅ Positive Feedback
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151' }}>
                        {aiAnalysis.whatPeopleAreSaying.positiveThemes.map((theme, idx) => (
                          <li key={idx} style={{ marginBottom: '0.5rem' }}>{theme}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiAnalysis.whatPeopleAreSaying.concernsRaised?.length > 0 && (
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#f59e0b' }}>
                        ⚠️ Concerns Raised
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151' }}>
                        {aiAnalysis.whatPeopleAreSaying.concernsRaised.map((concern, idx) => (
                          <li key={idx} style={{ marginBottom: '0.5rem' }}>{concern}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiAnalysis.whatPeopleAreSaying.commonRequests?.length > 0 && (
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#6366f1' }}>
                        🎯 Common Requests
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151' }}>
                        {aiAnalysis.whatPeopleAreSaying.commonRequests.map((request, idx) => (
                          <li key={idx} style={{ marginBottom: '0.5rem' }}>{request}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Data Interpretation */}
            {aiAnalysis.dataInterpretation && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  📊 What The Data Is Telling You
                </h3>
                <div style={{ padding: '1rem', backgroundColor: '#eff6ff', borderRadius: '6px', marginBottom: '1rem' }}>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: '#1e40af', lineHeight: '1.6' }}>
                    {aiAnalysis.dataInterpretation.whatTheDataTells}
                  </p>
                </div>
                {aiAnalysis.dataInterpretation.underlyingPatterns?.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#6366f1' }}>
                      🔍 Underlying Patterns
                    </h4>
                    <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.875rem', color: '#374151' }}>
                      {aiAnalysis.dataInterpretation.underlyingPatterns.map((pattern, idx) => (
                        <li key={idx} style={{ marginBottom: '0.5rem' }}>{pattern}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiAnalysis.dataInterpretation.surprisingFindings?.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#f59e0b' }}>
                      ⚡ Surprising Findings
                    </h4>
                    <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.875rem', color: '#374151' }}>
                      {aiAnalysis.dataInterpretation.surprisingFindings.map((finding, idx) => (
                        <li key={idx} style={{ marginBottom: '0.5rem' }}>{finding}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Improvements Needed */}
            {aiAnalysis.improvementsNeeded?.length > 0 && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  🔧 Improvements Needed
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {aiAnalysis.improvementsNeeded.map((improvement, idx) => (
                    <div key={idx} style={{
                      padding: '1rem',
                      backgroundColor: improvement.priority === 'High' ? '#fef2f2' : improvement.priority === 'Medium' ? '#fffbeb' : '#f9fafb',
                      borderRadius: '6px',
                      borderLeft: `4px solid ${improvement.priority === 'High' ? '#ef4444' : improvement.priority === 'Medium' ? '#f59e0b' : '#6b7280'}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: '#111827' }}>
                          {improvement.area}
                        </h4>
                        <span style={{
                          padding: '0.25rem 0.75rem',
                          backgroundColor: improvement.priority === 'High' ? '#ef4444' : improvement.priority === 'Medium' ? '#f59e0b' : '#6b7280',
                          color: 'white',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {improvement.priority}
                        </span>
                      </div>
                      <p style={{ margin: '0.5rem 0', fontSize: '0.875rem', color: '#374151' }}>
                        <strong>Issue:</strong> {improvement.issue}
                      </p>
                      {improvement.evidenceQuotes?.length > 0 && (
                        <div style={{ margin: '0.5rem 0' }}>
                          <strong style={{ fontSize: '0.75rem', color: '#6b7280' }}>What people said:</strong>
                          <div style={{ marginTop: '0.25rem', paddingLeft: '1rem', borderLeft: '2px solid #e5e7eb' }}>
                            {improvement.evidenceQuotes.map((quote, qIdx) => (
                              <p key={qIdx} style={{ margin: '0.25rem 0', fontSize: '0.75rem', color: '#6b7280', fontStyle: 'italic' }}>
                                "{quote}"
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                      <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#374151' }}>
                        <strong>Impact:</strong> {improvement.impact}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Responses To Your Questions */}
            {aiAnalysis.responsesToYourSpecificQuestions?.length > 0 && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  ❓ Answers to Your Questions
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {aiAnalysis.responsesToYourSpecificQuestions.map((qa, idx) => (
                    <div key={idx} style={{
                      padding: '1rem',
                      backgroundColor: '#f9fafb',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Question</div>
                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: '#111827' }}>
                        {qa.question}
                      </h4>
                      <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#374151' }}>
                        {qa.answer}
                      </p>
                      {qa.evidenceQuotes?.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <strong style={{ fontSize: '0.75rem', color: '#6b7280' }}>Evidence:</strong>
                          <div style={{ marginTop: '0.25rem', paddingLeft: '1rem', borderLeft: '2px solid #e5e7eb' }}>
                            {qa.evidenceQuotes.map((quote, qIdx) => (
                              <p key={qIdx} style={{ margin: '0.25rem 0', fontSize: '0.75rem', color: '#6b7280', fontStyle: 'italic' }}>
                                "{quote}"
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                      {qa.confidence && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
                          Confidence: <strong style={{ color: '#374151' }}>{qa.confidence}</strong>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Growth & Trends */}
            {aiAnalysis.growthAndTrends && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  📈 Growth & Trends
                </h3>
                {typeof aiAnalysis.growthAndTrends.overallChangeNumeric === 'number' && (
                  <div style={{
                    padding: '0.75rem 1rem',
                    backgroundColor: aiAnalysis.growthAndTrends.overallChangeNumeric >= 0 ? '#ecfdf5' : '#fef2f2',
                    borderRadius: '6px',
                    border: `1px solid ${aiAnalysis.growthAndTrends.overallChangeNumeric >= 0 ? '#a7f3d0' : '#fecaca'}`,
                    marginBottom: '1rem',
                    fontSize: '0.9rem'
                  }}>
                    Overall change since last analysis: <strong>{aiAnalysis.growthAndTrends.overallChangeNumeric >= 0 ? '+' : ''}{aiAnalysis.growthAndTrends.overallChangeNumeric}</strong>
                  </div>
                )}
                {aiAnalysis.growthAndTrends.byArea?.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    {aiAnalysis.growthAndTrends.byArea.map((m, idx) => (
                      <div key={idx} style={{ padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'capitalize' }}>{m.area}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{m.current}</div>
                          {typeof m.previous === 'number' && (
                            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>prev {m.previous}</div>
                          )}
                          {typeof m.delta === 'number' && (
                            <div style={{ fontSize: '0.8rem', color: m.delta >= 0 ? '#059669' : '#b91c1c', marginLeft: 'auto' }}>
                              {m.delta >= 0 ? '+' : ''}{m.delta}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {aiAnalysis.growthAndTrends.notes?.length > 0 && (
                  <ul style={{ margin: '0.75rem 0 0 0', paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151' }}>
                    {aiAnalysis.growthAndTrends.notes.map((n, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Next Steps for Respondents */}
            {aiAnalysis.nextStepsForRespondents?.length > 0 && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  👥 Next Steps with Respondents
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {aiAnalysis.nextStepsForRespondents.map((step, idx) => (
                    <div key={idx} style={{
                      padding: '1rem',
                      backgroundColor: step.urgency === 'High' ? '#fef2f2' : step.urgency === 'Medium' ? '#fffbeb' : '#f0fdf4',
                      borderRadius: '6px',
                      borderLeft: `4px solid ${step.urgency === 'High' ? '#ef4444' : step.urgency === 'Medium' ? '#f59e0b' : '#10b981'}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: '#111827' }}>
                          {step.personProfile}
                        </h4>
                        <span style={{
                          padding: '0.25rem 0.75rem',
                          backgroundColor: step.urgency === 'High' ? '#ef4444' : step.urgency === 'Medium' ? '#f59e0b' : '#10b981',
                          color: 'white',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {step.urgency} Urgency
                        </span>
                      </div>
                      <p style={{ margin: '0.5rem 0', fontSize: '0.875rem', color: '#6b7280', fontStyle: 'italic' }}>
                        {step.responsesSummary}
                      </p>
                      <p style={{ margin: '0.5rem 0', fontSize: '0.875rem', color: '#374151' }}>
                        <strong>Action:</strong> {step.recommendedAction}
                      </p>
                      {step.suggestedFollowUp && (
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#374151' }}>
                          <strong>Follow-up:</strong> {step.suggestedFollowUp}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pastoral & Apostolic Guidance */}
            {aiAnalysis.pastoralAndApostolicGuidance && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  ✝️ Pastoral & Apostolic Guidance
                </h3>
                
                {/* Pastoral Guidance */}
                {aiAnalysis.pastoralAndApostolicGuidance.pastoral?.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ 
                      margin: '0 0 1rem 0', 
                      fontSize: '1rem', 
                      fontWeight: '600',
                      color: '#10b981',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <span>🐑</span> Pastoral Care (Shepherding)
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {aiAnalysis.pastoralAndApostolicGuidance.pastoral.map((guidance, idx) => (
                        <div key={idx} style={{
                          padding: '1rem',
                          backgroundColor: '#f0fdf4',
                          borderRadius: '6px',
                          border: '1px solid #86efac'
                        }}>
                          <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#166534' }}>
                            {guidance.area}
                          </h5>
                          <p style={{ margin: '0.5rem 0', fontSize: '0.875rem', color: '#374151' }}>
                            {guidance.guidance}
                          </p>
                          {guidance.practicalSteps?.length > 0 && (
                            <div style={{ margin: '0.5rem 0' }}>
                              <strong style={{ fontSize: '0.75rem', color: '#166534' }}>Practical Steps:</strong>
                              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem', fontSize: '0.75rem', color: '#374151' }}>
                                {guidance.practicalSteps.map((step, sIdx) => (
                                  <li key={sIdx} style={{ marginBottom: '0.25rem' }}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {guidance.scriptureRelevance && (
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#6b7280', fontStyle: 'italic' }}>
                              📖 {guidance.scriptureRelevance}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Apostolic Guidance */}
                {aiAnalysis.pastoralAndApostolicGuidance.apostolic?.length > 0 && (
                  <div>
                    <h4 style={{ 
                      margin: '0 0 1rem 0', 
                      fontSize: '1rem', 
                      fontWeight: '600',
                      color: '#6366f1',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <span>🚀</span> Apostolic Mission (Mobilizing)
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {aiAnalysis.pastoralAndApostolicGuidance.apostolic.map((guidance, idx) => (
                        <div key={idx} style={{
                          padding: '1rem',
                          backgroundColor: '#eff6ff',
                          borderRadius: '6px',
                          border: '1px solid #a5b4fc'
                        }}>
                          <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#1e40af' }}>
                            {guidance.area}
                          </h5>
                          <p style={{ margin: '0.5rem 0', fontSize: '0.875rem', color: '#374151' }}>
                            {guidance.guidance}
                          </p>
                          {guidance.practicalSteps?.length > 0 && (
                            <div style={{ margin: '0.5rem 0' }}>
                              <strong style={{ fontSize: '0.75rem', color: '#1e40af' }}>Mobilization Steps:</strong>
                              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem', fontSize: '0.75rem', color: '#374151' }}>
                                {guidance.practicalSteps.map((step, sIdx) => (
                                  <li key={sIdx} style={{ marginBottom: '0.25rem' }}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {guidance.visionAlignment && (
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#6b7280', fontStyle: 'italic' }}>
                              🎯 {guidance.visionAlignment}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Leadership Lenses (Advisory Styles) */}
            {aiAnalysis.leadershipLenses?.length > 0 && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  🧭 Leadership Lenses: Next Steps
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                  {aiAnalysis.leadershipLenses.map((lens, idx) => (
                    <div key={idx} style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Lens</div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600, color: '#111827' }}>{lens.lens}</h4>
                      <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#374151' }}>{lens.guidance}</p>
                      {lens.nextStep && (
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#111827' }}>
                          <strong>Next Step:</strong> {lens.nextStep}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Excellence & Servanthood */}
            {aiAnalysis.excellenceAndServanthood && (
              <div style={{
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#0f766e'
                }}>
                  🙌 Excellence & Servanthood
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  {aiAnalysis.excellenceAndServanthood.standards?.length > 0 && (
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>Standards</h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151' }}>
                        {aiAnalysis.excellenceAndServanthood.standards.map((s, idx) => (
                          <li key={idx} style={{ marginBottom: '0.25rem' }}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiAnalysis.excellenceAndServanthood.quickWins?.length > 0 && (
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>Quick Wins</h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151' }}>
                        {aiAnalysis.excellenceAndServanthood.quickWins.map((w, idx) => (
                          <li key={idx} style={{ marginBottom: '0.25rem' }}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiAnalysis.excellenceAndServanthood.qualityChecklist?.length > 0 && (
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>Quality Checklist</h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151' }}>
                        {aiAnalysis.excellenceAndServanthood.qualityChecklist.map((c, idx) => (
                          <li key={idx} style={{ marginBottom: '0.25rem' }}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Statistics */}
            {aiAnalysis.statistics && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1.125rem', 
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  Key Statistics
                </h3>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem'
                }}>
                  {Object.entries(aiAnalysis.statistics).map(([key, value]) => (
                    <div key={key} style={{
                      padding: '1rem',
                      backgroundColor: '#f9fafb',
                      borderRadius: '6px'
                    }}>
                      <div style={{
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        color: '#6b7280',
                        textTransform: 'capitalize',
                        marginBottom: '0.25rem'
                      }}>
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </div>
                      <div style={{
                        fontSize: '1.25rem',
                        fontWeight: '700',
                        color: '#111827'
                      }}>
                        {Array.isArray(value) ? value.join(', ') : value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Charts */}
            {aiAnalysis.chartData && aiAnalysis.chartData.length > 0 && (
              <div style={{
                backgroundColor: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb'
              }}>
                {aiAnalysis.chartData.map((chart, idx) => (
                  <div key={idx} style={{ marginBottom: idx < aiAnalysis.chartData.length - 1 ? '2rem' : 0 }}>
                    <h4 style={{ 
                      margin: '0 0 1rem 0', 
                      fontSize: '1rem', 
                      fontWeight: '600',
                      color: '#374151'
                    }}>
                      {chart.title}
                    </h4>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: chart.type === 'bar' ? 'column' : 'row',
                      gap: '0.5rem'
                    }}>
                      {chart.data.map((item, itemIdx) => (
                        <div key={itemIdx} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.75rem',
                          backgroundColor: '#f9fafb',
                          borderRadius: '6px'
                        }}>
                          <div style={{
                            minWidth: '120px',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            color: '#374151'
                          }}>
                            {item.label}
                          </div>
                          <div style={{
                            flex: 1,
                            height: '24px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            position: 'relative'
                          }}>
                            <div style={{
                              width: chart.type === 'bar' ? `${(item.value / Math.max(...chart.data.map(d => d.value))) * 100}%` : '100%',
                              height: '100%',
                              backgroundColor: '#6366f1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              paddingRight: '0.5rem',
                              transition: 'width 0.3s ease'
                            }}>
                              <span style={{
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                color: 'white'
                              }}>
                                {item.value}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Two Column Layout for Lists */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '1.5rem',
              marginBottom: '1.5rem'
            }}>
              {/* Key Insights */}
              {aiAnalysis.keyInsights && aiAnalysis.keyInsights.length > 0 && (
                <div style={{
                  backgroundColor: 'white',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb'
                }}>
                  <h3 style={{ 
                    margin: '0 0 1rem 0', 
                    fontSize: '1.125rem', 
                    fontWeight: '600',
                    color: '#374151'
                  }}>
                    Key Insights
                  </h3>
                  <ul style={{ 
                    margin: 0, 
                    padding: '0 0 0 1.25rem',
                    listStyleType: 'none'
                  }}>
                    {aiAnalysis.keyInsights.map((insight, idx) => (
                      <li key={idx} style={{
                        marginBottom: '0.75rem',
                        paddingLeft: '1rem',
                        position: 'relative',
                        color: '#374151',
                        lineHeight: '1.6',
                        fontSize: '0.875rem'
                      }}>
                        <span style={{
                          position: 'absolute',
                          left: 0,
                          color: '#6366f1',
                          fontWeight: '700'
                        }}>•</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pastoral Recommendations */}
              {aiAnalysis.pastoralRecommendations && aiAnalysis.pastoralRecommendations.length > 0 && (
                <div style={{
                  backgroundColor: 'white',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb'
                }}>
                  <h3 style={{ 
                    margin: '0 0 1rem 0', 
                    fontSize: '1.125rem', 
                    fontWeight: '600',
                    color: '#374151'
                  }}>
                    Pastoral Recommendations
                  </h3>
                  {typeof aiAnalysis.pastoralRecommendations[0] === 'string' ? (
                    <ul style={{ 
                      margin: 0, 
                      padding: '0 0 0 1.25rem',
                      listStyleType: 'none'
                    }}>
                      {aiAnalysis.pastoralRecommendations.map((rec, idx) => (
                        <li key={idx} style={{
                          marginBottom: '0.75rem',
                          paddingLeft: '1rem',
                          position: 'relative',
                          color: '#374151',
                          lineHeight: '1.6',
                          fontSize: '0.875rem'
                        }}>
                          <span style={{
                            position: 'absolute',
                            left: 0,
                            color: '#10b981',
                            fontWeight: '700'
                          }}>✓</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {aiAnalysis.pastoralRecommendations.map((rec, idx) => (
                        <div key={idx} style={{
                          padding: '1rem',
                          backgroundColor: '#f9fafb',
                          borderRadius: '6px',
                          borderLeft: '3px solid #10b981'
                        }}>
                          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: '600', color: '#111827' }}>
                            {rec.recommendation}
                          </h4>
                          <p style={{ margin: '0.25rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
                            <strong>Why:</strong> {rec.reasoning}
                          </p>
                          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
                            <span style={{ color: '#6b7280' }}>
                              <strong>Timeline:</strong> {rec.timeline}
                            </span>
                            <span style={{ color: '#6b7280' }}>
                              <strong>Success Metric:</strong> {rec.successMetric}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Warning Flags and Strength Areas */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '1.5rem'
            }}>
              {/* Warning Flags */}
              {aiAnalysis.warningFlags && aiAnalysis.warningFlags.length > 0 && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  borderLeft: '4px solid #ef4444'
                }}>
                  <h3 style={{ 
                    margin: '0 0 1rem 0', 
                    fontSize: '1rem', 
                    fontWeight: '600',
                    color: '#991b1b'
                  }}>
                    ⚠️ Areas Needing Attention
                  </h3>
                  <ul style={{ 
                    margin: 0, 
                    padding: '0 0 0 1.25rem',
                    listStyleType: 'disc'
                  }}>
                    {aiAnalysis.warningFlags.map((flag, idx) => (
                      <li key={idx} style={{
                        marginBottom: '0.5rem',
                        color: '#7f1d1d',
                        lineHeight: '1.6',
                        fontSize: '0.875rem'
                      }}>
                        {flag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Strength Areas */}
              {aiAnalysis.strengthAreas && aiAnalysis.strengthAreas.length > 0 && (
                <div style={{
                  backgroundColor: '#f0fdf4',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  borderLeft: '4px solid #10b981'
                }}>
                  <h3 style={{ 
                    margin: '0 0 1rem 0', 
                    fontSize: '1rem', 
                    fontWeight: '600',
                    color: '#065f46'
                  }}>
                    ✨ Strength Areas
                  </h3>
                  <ul style={{ 
                    margin: 0, 
                    padding: '0 0 0 1.25rem',
                    listStyleType: 'disc'
                  }}>
                    {aiAnalysis.strengthAreas.map((strength, idx) => (
                      <li key={idx} style={{
                        marginBottom: '0.5rem',
                        color: '#064e3b',
                        lineHeight: '1.6',
                        fontSize: '0.875rem'
                      }}>
                        {strength}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Entries Table */}
        {filteredEntries.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem',
            color: '#6b7280'
          }}>
            {searchTerm ? 'No entries match your search' : 'No submissions yet'}
          </div>
        ) : (
          <div style={{ 
            overflowX: 'auto',
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse',
              fontSize: '0.875rem'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  <th style={{ 
                    padding: '0.75rem 1rem', 
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#374151',
                    borderBottom: '2px solid #e5e7eb'
                  }}>
                    Date
                  </th>
                  <th style={{ 
                    padding: '0.75rem 1rem', 
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#374151',
                    borderBottom: '2px solid #e5e7eb'
                  }}>
                    Submitted By
                  </th>
                  {form.fields.map(field => (
                    <th 
                      key={field.name}
                      style={{ 
                        padding: '0.75rem 1rem', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: '#374151',
                        borderBottom: '2px solid #e5e7eb'
                      }}
                    >
                      {field.label}
                    </th>
                  ))}
                  <th style={{ 
                    padding: '0.75rem 1rem', 
                    textAlign: 'right',
                    fontWeight: '600',
                    color: '#374151',
                    borderBottom: '2px solid #e5e7eb'
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry, index) => (
                  <tr 
                    key={entry.id}
                    style={{ 
                      backgroundColor: index % 2 === 0 ? 'white' : '#f9fafb',
                      borderBottom: '1px solid #e5e7eb'
                    }}
                  >
                    <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                      {entry.createdAt ? new Date(entry.createdAt.toDate()).toLocaleDateString() : '-'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {entry.submittedBy || 'Anonymous'}
                    </td>
                    {form.fields.map(field => (
                      <td 
                        key={field.name}
                        style={{ 
                          padding: '0.75rem 1rem',
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {renderFieldValue(field, entry[field.name])}
                      </td>
                    ))}
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <button
                        onClick={() => handleDeleteEntry(entry.id)}
                        style={{
                          color: '#ef4444',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0.25rem',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                        title="Delete entry"
                      >
                        <FiTrash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Questionnaire Modal */}
        {showQuestionnaireModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '2rem',
              maxWidth: '700px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}>
              <h2 style={{ 
                margin: '0 0 1rem 0', 
                fontSize: '1.5rem', 
                fontWeight: '700',
                color: '#111827'
              }}>
                Customize Your Analysis
              </h2>
              <p style={{ margin: '0 0 1.5rem 0', color: '#6b7280', fontSize: '0.875rem' }}>
                Tell us what specific insights or questions you want addressed in this analysis. This helps us provide more targeted, actionable recommendations.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Specific Questions Only */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#374151', fontSize: '0.875rem' }}>
                    What specific questions do you want this analysis to address?
                  </label>
                  <textarea
                    value={pastoralContext.specificQuestions}
                    onChange={(e) => setPastoralContext({...pastoralContext, specificQuestions: e.target.value})}
                    placeholder="Examples:
• What next steps should I take with people who responded?
• How satisfied are people with current ministries?
• What pastoral/apostolic guidance should I provide?
• Which respondents need immediate follow-up?
• What underlying issues am I missing?
• How should I prioritize improvements?"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e5e7eb',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      minHeight: '150px',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
                
                <div style={{
                  padding: '1rem',
                  backgroundColor: '#eff6ff',
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe',
                  fontSize: '0.875rem',
                  color: '#1e40af'
                }}>
                  <strong>💡 Tip:</strong> The analysis will automatically interpret what the form data is telling you, provide specific next steps for respondents, and give pastoral/apostolic guidance based on the actual questions your form asked.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowQuestionnaireModal(false)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: 'white',
                    border: '2px solid #e5e7eb',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    color: '#374151'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitQuestionnaire}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: '#6366f1',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    color: 'white'
                  }}
                >
                  Generate Analysis
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History Modal */}
        {showHistoryModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '2rem',
              maxWidth: '900px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '700', color: '#111827' }}>
                  Analysis History
                </h2>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>
              </div>

              {loadingHistory ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>Loading history...</div>
              ) : analysisHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>No previous analyses found</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {analysisHistory.map((analysis, idx) => (
                    <div
                      key={analysis.id}
                      style={{
                        padding: '1.5rem',
                        backgroundColor: '#f9fafb',
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        setSelectedHistoryAnalysis(analysis);
                        setAiAnalysis(analysis);
                        setShowAIAnalysis(true);
                        setShowHistoryModal(false);
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                        <div>
                          <div style={{ fontWeight: '600', color: '#111827', fontSize: '1rem' }}>
                            Analysis #{analysisHistory.length - idx}
                          </div>
                          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                            {analysis.createdAt ? new Date(analysis.createdAt).toLocaleString() : 'Unknown date'}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '1.5rem',
                          fontWeight: '700',
                          color: analysis.healthMetrics?.overall >= 80 ? '#10b981' : 
                                 analysis.healthMetrics?.overall >= 60 ? '#f59e0b' : '#ef4444'
                        }}>
                          {analysis.healthMetrics?.overall || 'N/A'}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                        {analysis.executiveSummary?.substring(0, 150)}...
                      </div>
                      <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#6b7280' }}>
                        {analysis.entryCount} responses analyzed • By {analysis.createdBy}
                      </div>
                      {idx > 0 && analysis.progressComparison && (
                        <div style={{
                          marginTop: '0.75rem',
                          padding: '0.5rem',
                          backgroundColor: 'white',
                          borderRadius: '4px',
                          fontSize: '0.75rem'
                        }}>
                          <strong>Progress: </strong>
                          {analysis.progressComparison.overallChange}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormEntriesPage;
