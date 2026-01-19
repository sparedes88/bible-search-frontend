import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, orderBy, where } from 'firebase/firestore';
import commonStyles from '../../pages/commonStyles';
import { toast } from 'react-toastify';
import { FaPlus, FaSearch, FaFilter, FaComment, FaFilePdf } from 'react-icons/fa';
import Modal from '../../components/Modal';
import jsPDF from 'jspdf';

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  
  // Handle Firestore Timestamp
  if (timestamp?.toDate) {
    return timestamp.toDate().toLocaleString();
  }
  
  // Handle regular Date object or string
  return new Date(timestamp).toLocaleString();
};

const calculateTotalsByCategory = (finances) => {
  return finances.reduce((acc, finance) => {
    const category = finance.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = { income: 0, expense: 0 };
    }
    acc[category][finance.type] += Number(finance.amount);
    return acc;
  }, {});
};

const calculateTotalsByType = (finances) => {
  return finances.reduce((acc, finance) => {
    acc[finance.type] = (acc[finance.type] || 0) + Number(finance.amount);
    return acc;
  }, { income: 0, expense: 0 });
};

const FinancesPage = () => {
  const { id } = useParams();
  const [finances, setFinances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEntry, setNewEntry] = useState({
    title: '',
    description: '',
    amount: '',
    category: '',
    type: 'expense',
    date: new Date().toISOString().split('T')[0]
  });
  const [editingId, setEditingId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    type: 'all',
    category: 'all',
    startDate: '',
    endDate: ''
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [comments, setComments] = useState({});
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [selectedFinanceId, setSelectedFinanceId] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const itemsPerPage = 10;
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);

  useEffect(() => {
    fetchFinances();
    fetchCategories();
  }, [id]);

  const fetchFinances = async () => {
    try {
      const q = query(collection(db, `churches/${id}/finances`), orderBy('date', 'desc'));
      const querySnapshot = await getDocs(q);
      const financesData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setFinances(financesData);
      financesData.forEach(finance => fetchComments(finance.id));
    } catch (error) {
      console.error('Error fetching finances:', error);
      toast.error('Failed to load finances');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, `churches/${id}/finances`));
      const uniqueCategories = new Set();
      querySnapshot.docs.forEach(doc => {
        const category = doc.data().category;
        if (category) uniqueCategories.add(category);
      });
      setCategories(Array.from(uniqueCategories).sort());
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchComments = async (financeId) => {
    try {
      const commentsQuery = query(collection(db, `churches/${id}/finances/${financeId}/comments`), orderBy('createdAt', 'desc'));
      const commentsSnapshot = await getDocs(commentsQuery);
      const commentsData = commentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setComments(prev => ({
        ...prev,
        [financeId]: commentsData
      }));
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const financeData = {
        ...newEntry,
        amount: Number(newEntry.amount),
        createdAt: new Date(),
      };

      if (editingId) {
        await updateDoc(doc(db, `churches/${id}/finances`, editingId), financeData);
        toast.success('Entry updated successfully');
      } else {
        await addDoc(collection(db, `churches/${id}/finances`), financeData);
        toast.success('Entry added successfully');
      }

      setNewEntry({
        title: '',
        description: '',
        amount: '',
        category: '',
        type: 'expense',
        date: new Date().toISOString().split('T')[0]
      });
      setEditingId(null);
      fetchFinances();
      setShowModal(false);
    } catch (error) {
      console.error('Error saving finance:', error);
      toast.error('Failed to save entry');
    }
  };

  const handleAddNewCategory = () => {
    if (!newCategory.trim()) return;
    
    setCategories(prev => [...prev, newCategory.trim()].sort());
    setNewEntry(prev => ({ ...prev, category: newCategory.trim() }));
    setNewCategory('');
    setShowNewCategoryInput(false);
  };

  const handleDelete = async (financeId) => {
    if (!window.confirm('Are you sure you want to delete this entry?')) return;
    
    try {
      await deleteDoc(doc(db, `churches/${id}/finances`, financeId));
      toast.success('Entry deleted successfully');
      fetchFinances();
    } catch (error) {
      console.error('Error deleting finance:', error);
      toast.error('Failed to delete entry');
    }
  };

  const handleEdit = (finance) => {
    setNewEntry({
      title: finance.title,
      description: finance.description,
      amount: finance.amount.toString(),
      category: finance.category,
      type: finance.type,
      date: finance.date
    });
    setEditingId(finance.id);
    setShowModal(true);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    
    try {
      const commentRef = await addDoc(collection(db, `churches/${id}/finances/${selectedFinanceId}/comments`), {
        content: newComment,
        createdAt: new Date(),
      });
      
      setComments({
        ...comments,
        [selectedFinanceId]: [...(comments[selectedFinanceId] || []), {
          id: commentRef.id,
          content: newComment,
          createdAt: new Date()
        }]
      });
      
      setNewComment('');
      setShowCommentModal(false);
    } catch (error) {
      toast.error('Failed to add comment');
    }
  };

  const handleDeleteComment = async (financeId, commentId) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;
    
    try {
      await deleteDoc(doc(db, `churches/${id}/finances/${financeId}/comments`, commentId));
      setComments(prev => ({
        ...prev,
        [financeId]: prev[financeId].filter(comment => comment.id !== commentId)
      }));
      toast.success('Comment deleted');
    } catch (error) {
      console.error('Error deleting comment:', error);
      toast.error('Failed to delete comment');
    }
  };

  const handleEditComment = async (financeId, commentId, newContent) => {
    try {
      await updateDoc(doc(db, `churches/${id}/finances/${financeId}/comments`, commentId), {
        content: newContent,
        updatedAt: new Date()
      });
      
      setComments(prev => ({
        ...prev,
        [financeId]: prev[financeId].map(comment => 
          comment.id === commentId 
            ? { ...comment, content: newContent, updatedAt: new Date() }
            : comment
        )
      }));
      
      setEditingCommentId(null);
      setEditingCommentText('');
      toast.success('Comment updated');
    } catch (error) {
      console.error('Error updating comment:', error);
      toast.error('Failed to update comment');
    }
  };

  const exportToPDF = async () => {
    try {
      const toastId = toast.loading('Preparing PDF...', { autoClose: false });
      const doc = new jsPDF();
      
      // Add title and header with branded color
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      doc.setTextColor(255);
      doc.setFontSize(24);
      doc.text('Financial Management Report', 15, 25);
      
      // Header info
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);
      doc.text(`Total Entries: ${filteredFinances.length}`, doc.internal.pageSize.width - 60, 35);
      
      let yOffset = 50;

      // Add filter information if filters are active
      if (filters.type !== 'all' || filters.category !== 'all' || filters.startDate || filters.endDate || searchTerm) {
        doc.setFillColor(243, 244, 246);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 25, 'F');
        doc.setTextColor(75, 85, 99);
        doc.setFontSize(10);
        doc.text('Applied Filters:', 20, yOffset + 7);
        
        let filterText = [];
        if (filters.type !== 'all') filterText.push(`Type: ${filters.type}`);
        if (filters.category !== 'all') filterText.push(`Category: ${filters.category}`);
        if (filters.startDate) filterText.push(`From: ${filters.startDate}`);
        if (filters.endDate) filterText.push(`To: ${filters.endDate}`);
        if (searchTerm) filterText.push(`Search: "${searchTerm}"`);
        
        doc.text(filterText.join(' | '), 20, yOffset + 17);
        yOffset += 35;
      }

      // Add summary section
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Financial Summary', 15, yOffset);
      yOffset += 15;

      // Summary boxes
      const summaryBoxWidth = (doc.internal.pageSize.width - 45) / 3;
      const summaryBoxHeight = 40;
      
      // Income box
      doc.setFillColor(209, 250, 229);
      doc.rect(15, yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(...[4, 120, 87]);
      doc.setFontSize(12);
      doc.text('Total Income', 20, yOffset + 15);
      doc.setFontSize(14);
      doc.text(`$${totals.income.toFixed(2)}`, 20, yOffset + 30);

      // Expenses box
      doc.setFillColor(254, 226, 226);
      doc.rect(25 + summaryBoxWidth, yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(...[220, 38, 38]);
      doc.setFontSize(12);
      doc.text('Total Expenses', 30 + summaryBoxWidth, yOffset + 15);
      doc.setFontSize(14);
      doc.text(`$${totals.expense.toFixed(2)}`, 30 + summaryBoxWidth, yOffset + 30);

      // Net Balance box
      const netBalance = totals.income - totals.expense;
      const fillColor = netBalance >= 0 ? [209, 250, 229] : [254, 226, 226];
      const textColor = netBalance >= 0 ? [4, 120, 87] : [220, 38, 38];
      doc.setFillColor(...fillColor);
      doc.rect(35 + (summaryBoxWidth * 2), yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(...textColor);
      doc.setFontSize(12);
      doc.text('Net Balance', 40 + (summaryBoxWidth * 2), yOffset + 15);
      doc.setFontSize(14);
      doc.text(`$${netBalance.toFixed(2)}`, 40 + (summaryBoxWidth * 2), yOffset + 30);

      yOffset += summaryBoxHeight + 20;

      // Category breakdown section
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Category Breakdown', 15, yOffset);
      yOffset += 15;

      // Table header
      const columns = ['Category', 'Income', 'Expenses', 'Net'];
      const columnWidths = [80, 40, 40, 40];
      
      doc.setFillColor(243, 244, 246);
      doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 10, 'F');
      doc.setFontSize(10);
      doc.setTextColor(75, 85, 99);
      
      let xOffset = 20;
      columns.forEach((col, index) => {
        doc.text(col, xOffset, yOffset + 7);
        xOffset += columnWidths[index];
      });
      yOffset += 15;

      // Category details
      Object.entries(categoryTotals).forEach(([category, amounts]) => {
        if (yOffset > doc.internal.pageSize.height - 30) {
          doc.addPage();
          yOffset = 20;
        }

        const net = amounts.income - amounts.expense;
        xOffset = 20;
        
        doc.setTextColor(31, 41, 55);
        doc.text(category, xOffset, yOffset);
        
        xOffset += columnWidths[0];
        doc.setTextColor(...[4, 120, 87]);
        doc.text(`$${amounts.income.toFixed(2)}`, xOffset, yOffset);
        
        xOffset += columnWidths[1];
        doc.setTextColor(...[220, 38, 38]);
        doc.text(`$${amounts.expense.toFixed(2)}`, xOffset, yOffset);
        
        xOffset += columnWidths[2];
        const netTextColor = net >= 0 ? [4, 120, 87] : [220, 38, 38];
        doc.setTextColor(...netTextColor);
        doc.text(`$${net.toFixed(2)}`, xOffset, yOffset);

        yOffset += 10;
      });

      yOffset += 20;

      // Detailed transactions section
      doc.addPage();
      yOffset = 20;
      
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Detailed Transactions', 15, yOffset);
      yOffset += 15;

      // Process each transaction
      for (const finance of filteredFinances) {
        if (yOffset > doc.internal.pageSize.height - 60) {
          doc.addPage();
          yOffset = 20;
        }

        // Transaction box
        doc.setFillColor(249, 250, 251);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 40, 'F');
        
        // Title and amount
        doc.setFontSize(12);
        doc.setTextColor(31, 41, 55);
        doc.text(finance.title, 20, yOffset + 15);
        
        doc.setFontSize(12);
        const amountColor = finance.type === 'income' ? [4, 120, 87] : [220, 38, 38];
        doc.setTextColor(...amountColor);
        const amountText = `${finance.type === 'income' ? '+' : '-'} $${finance.amount}`;
        doc.text(amountText, doc.internal.pageSize.width - 35, yOffset + 15, { align: 'right' });

        // Details
        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        const details = [
          `Category: ${finance.category}`,
          `Date: ${new Date(finance.date).toLocaleDateString()}`,
          `Type: ${finance.type}`
        ].join(' | ');
        doc.text(details, 20, yOffset + 30);

        yOffset += 50;

        // Description if exists
        if (finance.description) {
          const descriptionLines = doc.splitTextToSize(finance.description, doc.internal.pageSize.width - 45);
          doc.setTextColor(75, 85, 99);
          doc.text(descriptionLines, 20, yOffset);
          yOffset += (descriptionLines.length * 7) + 10;
        }
      }

      // Add page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }

      // Save the PDF
      let filename = 'financial-management-report';
      if (filters.type !== 'all' || filters.category !== 'all' || filters.startDate || filters.endDate) {
        filename += '-filtered';
      }
      filename += '.pdf';
      
      doc.save(filename);
      
      toast.update(toastId, {
        render: 'PDF generated successfully!',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const filteredFinances = finances.filter(finance => {
    const matchesSearch = 
      finance.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      finance.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      finance.category.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = filters.type === 'all' || finance.type === filters.type;
    const matchesCategory = filters.category === 'all' || finance.category === filters.category;
    const matchesDate = (!filters.startDate || finance.date >= filters.startDate) &&
                       (!filters.endDate || finance.date <= filters.endDate);

    return matchesSearch && matchesType && matchesCategory && matchesDate;
  });

  const paginatedFinances = filteredFinances.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredFinances.length / itemsPerPage);

  const totals = calculateTotalsByType(filteredFinances);
  const categoryTotals = calculateTotalsByCategory(filteredFinances);

  return (
    <div style={{...commonStyles.fullWidthContainer}} className="finances-container">
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <h2 style={commonStyles.title}>Financial Management</h2>

      <div style={styles.toolbar} className="finances-toolbar">
        <div style={styles.searchContainer} className="finances-search-container">
          <FaSearch style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search finances..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>
        
        <div style={styles.filters} className="finances-filters">
          <select
            value={filters.type}
            onChange={(e) => setFilters({...filters, type: e.target.value})}
            style={styles.filterSelect}
            className="finances-filter-select"
          >
            <option value="all">All Types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>

          <select
            value={filters.category}
            onChange={(e) => setFilters({...filters, category: e.target.value})}
            style={styles.filterSelect}
            className="finances-filter-select"
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters({...filters, startDate: e.target.value})}
            style={styles.filterDate}
            className="finances-filter-date"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters({...filters, endDate: e.target.value})}
            style={styles.filterDate}
            className="finances-filter-date"
          />
        </div>

        <div style={{ display: "flex", gap: "1rem" }} className="finances-actions">
          <button 
            onClick={exportToPDF}
            style={{
              ...styles.addButton,
              backgroundColor: "#2563eb"
            }}
            className="finances-add-button"
          >
            <FaFilePdf /> Export to PDF
          </button>
          <button onClick={() => setShowModal(true)} style={styles.addButton} className="finances-add-button">
            <FaPlus /> Add New Entry
          </button>
        </div>
      </div>

      <div style={styles.list}>
        {loading ? (
          <p>Loading...</p>
        ) : paginatedFinances.length === 0 ? (
          <p>No financial entries yet</p>
        ) : (
          paginatedFinances.map(finance => (
            <div key={finance.id} style={styles.entry} className="finances-entry">
              <div style={styles.entryHeader} className="finances-entry-header">
                <h3>{finance.title}</h3>
                <div style={styles.actions} className="finances-entry-actions">
                  <button
                    onClick={() => {
                      setSelectedFinanceId(finance.id);
                      setShowCommentModal(true);
                    }}
                    style={styles.commentButton}
                  >
                    <FaComment />
                  </button>
                  <button onClick={() => handleEdit(finance)} style={styles.editButton}>Edit</button>
                  <button onClick={() => handleDelete(finance.id)} style={styles.deleteButton}>Delete</button>
                </div>
              </div>
              <div style={styles.entryContent} className="finances-entry-content">
                <div style={styles.mainInfo}>
                  <p style={styles.description}>{finance.description}</p>
                  <span style={styles.category}>{finance.category}</span>
                </div>
                <div style={styles.metadata} className="finances-metadata">
                  <span style={{
                    ...styles.amount,
                    color: finance.type === 'income' ? '#059669' : '#DC2626'
                  }} className="finances-amount">
                    {finance.type === 'income' ? '+' : '-'} ${finance.amount}
                  </span>
                  <span style={styles.date}>
                    {new Date(finance.date).toLocaleDateString()}
                  </span>
                  <span style={styles.createdAt}>
                    Created: {formatDate(finance.createdAt)}
                  </span>
                </div>
              </div>
              {comments[finance.id]?.length > 0 && (
                <div style={styles.comments}>
                  {comments[finance.id].map(comment => (
                    <div key={comment.id} style={styles.comment}>
                      {editingCommentId === comment.id ? (
                        <div style={styles.commentEditForm}>
                          <input
                            type="text"
                            value={editingCommentText}
                            onChange={(e) => setEditingCommentText(e.target.value)}
                            style={styles.commentEditInput}
                          />
                          <div style={styles.commentEditButtons}>
                            <button
                              onClick={() => handleEditComment(finance.id, comment.id, editingCommentText)}
                              style={styles.commentSaveButton}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditingCommentText('');
                              }}
                              style={styles.commentCancelButton}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={styles.commentContent}>
                            <p>{comment.content}</p>
                            <div style={styles.commentActions}>
                              <button
                                onClick={() => {
                                  setEditingCommentId(comment.id);
                                  setEditingCommentText(comment.content);
                                }}
                                style={styles.commentEditButton}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteComment(finance.id, comment.id)}
                                style={styles.commentDeleteButton}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <small style={styles.commentDate}>{formatDate(comment.createdAt)}</small>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div style={styles.summarySection} className="finances-summary-section">
        <h3 style={styles.summaryTitle}>Financial Summary</h3>
        
        <div style={styles.totalsByType} className="finances-totals-by-type">
          <div style={styles.totalItem} className="finances-total-item">
            <span>Total Income:</span>
            <span style={{ ...styles.totalAmount, color: '#059669' }}>
              ${totals.income.toFixed(2)}
            </span>
          </div>
          <div style={styles.totalItem} className="finances-total-item">
            <span>Total Expenses:</span>
            <span style={{ ...styles.totalAmount, color: '#DC2626' }}>
              ${totals.expense.toFixed(2)}
            </span>
          </div>
          <div style={styles.totalItem} className="finances-total-item">
            <span>Net Balance:</span>
            <span style={{
              ...styles.totalAmount,
              color: totals.income - totals.expense >= 0 ? '#059669' : '#DC2626'
            }}>
              ${(totals.income - totals.expense).toFixed(2)}
            </span>
          </div>
        </div>

        <h4 style={styles.subtotalsTitle}>Category Breakdown</h4>
        <div style={styles.categoryTotals} className="finances-category-totals finances-summary-grid">
          {Object.entries(categoryTotals).map(([category, amounts]) => (
            <div key={category} style={styles.categoryTotal}>
              <h5 style={styles.categoryName}>{category}</h5>
              <div style={styles.categoryAmounts}>
                <span style={{ color: '#059669' }}>
                  Income: ${amounts.income.toFixed(2)}
                </span>
                <span style={{ color: '#DC2626' }}>
                  Expenses: ${amounts.expense.toFixed(2)}
                </span>
                <span style={{
                  color: amounts.income - amounts.expense >= 0 ? '#059669' : '#DC2626'
                }}>
                  Net: ${(amounts.income - amounts.expense).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.pagination} className="finances-pagination">
        {[...Array(totalPages)].map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentPage(index + 1)}
            style={{
              ...styles.pageButton,
              backgroundColor: currentPage === index + 1 ? '#4F46E5' : 'white',
              color: currentPage === index + 1 ? 'white' : '#4F46E5'
            }}
          >
            {index + 1}
          </button>
        ))}
      </div>

      {showModal && (
        <Modal onClose={() => setShowModal(false)} className="finances-modal">
          <h3 style={styles.modalTitle}>{editingId ? 'Edit Entry' : 'Add New Entry'}</h3>
          <form onSubmit={handleSubmit} style={styles.form} className="finances-modal-form">
            <div style={styles.formGroup}>
              <label style={styles.label}>Title *</label>
              <input
                type="text"
                value={newEntry.title}
                onChange={e => setNewEntry({...newEntry, title: e.target.value})}
                required
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <input
                type="text"
                value={newEntry.description}
                onChange={e => setNewEntry({...newEntry, description: e.target.value})}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Amount *</label>
              <input
                type="number"
                value={newEntry.amount}
                onChange={e => setNewEntry({...newEntry, amount: e.target.value})}
                required
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Category *</label>
              {showNewCategoryInput ? (
                <div style={styles.newCategoryContainer}>
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="Enter new category"
                    style={styles.input}
                  />
                  <div style={styles.newCategoryButtons}>
                    <button
                      type="button"
                      onClick={handleAddNewCategory}
                      style={styles.addCategoryButton}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewCategoryInput(false)}
                      style={styles.cancelCategoryButton}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  value={newEntry.category}
                  onChange={(e) => {
                    if (e.target.value === 'new') {
                      setShowNewCategoryInput(true);
                    } else {
                      setNewEntry({...newEntry, category: e.target.value});
                    }
                  }}
                  required
                  style={styles.input}
                >
                  <option value="">Select a category</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value="new">+ Add New Category</option>
                </select>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Type *</label>
              <select
                value={newEntry.type}
                onChange={e => setNewEntry({...newEntry, type: e.target.value})}
                style={styles.input}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Date *</label>
              <input
                type="date"
                value={newEntry.date}
                onChange={e => setNewEntry({...newEntry, date: e.target.value})}
                required
                style={styles.input}
              />
            </div>

            <button type="submit" style={styles.button}>
              {editingId ? 'Update Entry' : 'Add Entry'}
            </button>
          </form>
        </Modal>
      )}

      {showCommentModal && (
        <Modal onClose={() => setShowCommentModal(false)} className="finances-comment-modal">
          <div style={styles.commentModal}>
            <h3>Add Comment</h3>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write your comment..."
              style={styles.commentInput}
            />
            <button onClick={handleAddComment} style={styles.addCommentButton}>
              Add Comment
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '20px',
    maxWidth: '500px',
  },
  input: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  button: {
    padding: '10px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  entry: {
    padding: '15px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  entryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  editButton: {
    padding: '5px 10px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  deleteButton: {
    padding: '5px 10px',
    backgroundColor: '#DC2626',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentButton: {
    padding: '5px 10px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  description: {
    color: '#6B7280',
    marginBottom: '10px',
  },
  entryContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  mainInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  metadata: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amount: {
    fontWeight: 'bold',
    fontSize: '1.1em',
  },
  category: {
    backgroundColor: '#F3F4F6',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '0.9em',
  },
  date: {
    color: '#6B7280',
    fontSize: '0.9em',
  },
  createdAt: {
    color: '#6B7280',
    fontSize: '0.9em',
  },
  comments: {
    marginTop: '10px',
    padding: '10px',
    backgroundColor: '#F9FAFB',
    borderRadius: '4px',
  },
  comment: {
    marginBottom: '10px',
    padding: '10px',
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap',
  },
  searchContainer: {
    position: 'relative',
    flex: 1,
  },
  searchIcon: {
    position: 'absolute',
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#6B7280',
  },
  searchInput: {
    width: '100%',
    padding: '8px 8px 8px 35px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  filters: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  filterSelect: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  filterDate: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '8px 16px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.5rem',
    marginTop: '2rem',
  },
  pageButton: {
    padding: '8px 12px',
    border: '1px solid #4F46E5',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentModal: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  commentInput: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    width: '100%',
    minHeight: '100px',
  },
  addCommentButton: {
    padding: '10px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
  },
  commentActions: {
    display: 'flex',
    gap: '0.5rem',
  },
  commentEditButton: {
    padding: '4px 8px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  commentDeleteButton: {
    padding: '4px 8px',
    backgroundColor: '#DC2626',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  commentEditForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  commentEditInput: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    width: '100%',
  },
  commentEditButtons: {
    display: 'flex',
    gap: '0.5rem',
  },
  commentSaveButton: {
    padding: '4px 8px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentCancelButton: {
    padding: '4px 8px',
    backgroundColor: '#6B7280',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentDate: {
    display: 'block',
    marginTop: '4px',
    color: '#6B7280',
    fontSize: '0.8rem',
  },
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: '600',
    marginBottom: '1.5rem',
    color: '#1F2937',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
  },
  newCategoryContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  newCategoryButtons: {
    display: 'flex',
    gap: '0.5rem',
  },
  addCategoryButton: {
    padding: '4px 8px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem',
  },
  cancelCategoryButton: {
    padding: '4px 8px',
    backgroundColor: '#6B7280',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem',
  },
  summarySection: {
    marginTop: '2rem',
    padding: '1.5rem',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  summaryTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    marginBottom: '1rem',
    color: '#1F2937',
  },
  totalsByType: {
    display: 'flex',
    gap: '2rem',
    marginBottom: '2rem',
    flexWrap: 'wrap',
  },
  totalItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  totalAmount: {
    fontSize: '1.5rem',
    fontWeight: '600',
  },
  subtotalsTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    marginBottom: '1rem',
    color: '#374151',
  },
  categoryTotals: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  },
  categoryTotal: {
    padding: '1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: '6px',
    border: '1px solid #E5E7EB',
  },
  categoryName: {
    fontSize: '1rem',
    fontWeight: '500',
    marginBottom: '0.5rem',
    color: '#374151',
  },
  categoryAmounts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.9rem',
  },
};

// Responsive styles
const responsiveStyles = `
  @media (max-width: 1024px) {
    .finances-container {
      padding: 15px;
    }
    
    .finances-toolbar {
      flex-direction: column;
      gap: 1rem;
    }
    
    .finances-filters {
      flex-wrap: wrap;
      justify-content: center;
    }
    
    .finances-summary-grid {
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
    }
  }

  @media (max-width: 768px) {
    .finances-container {
      padding: 10px;
    }
    
    .finances-toolbar {
      gap: 0.75rem;
    }
    
    .finances-search-container {
      order: 1;
      width: 100%;
    }
    
    .finances-filters {
      order: 2;
      width: 100%;
      justify-content: space-between;
    }
    
    .finances-actions {
      order: 3;
      width: 100%;
      justify-content: center;
      flex-wrap: wrap;
    }
    
    .finances-entry {
      padding: 1rem;
    }
    
    .finances-entry-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
    
    .finances-entry-actions {
      align-self: flex-end;
    }
    
    .finances-entry-content {
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .finances-metadata {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
    
    .finances-summary-section {
      padding: 1rem;
    }
    
    .finances-totals-by-type {
      flex-direction: column;
      gap: 1rem;
    }
    
    .finances-total-item {
      justify-content: space-between;
      padding: 0.75rem;
    }
    
    .finances-category-totals {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    
    .finances-pagination {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  }

  @media (max-width: 640px) {
    .finances-container {
      padding: 8px;
    }
    
    .finances-title {
      font-size: 1.5rem;
    }
    
    .finances-toolbar {
      gap: 0.5rem;
    }
    
    .finances-filters {
      flex-direction: column;
      align-items: stretch;
    }
    
    .finances-filter-select,
    .finances-filter-date {
      width: 100%;
    }
    
    .finances-actions {
      flex-direction: column;
      align-items: stretch;
    }
    
    .finances-add-button {
      justify-content: center;
    }
    
    .finances-entry {
      margin-bottom: 1rem;
    }
    
    .finances-summary-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 480px) {
    .finances-container {
      padding: 5px;
    }
    
    .finances-title {
      font-size: 1.25rem;
    }
    
    .finances-entry-header h3 {
      font-size: 1.125rem;
    }
    
    .finances-amount {
      font-size: 1rem;
    }
    
    .finances-comment-modal {
      margin: 1rem;
      width: calc(100vw - 2rem);
    }
    
    .finances-modal-form {
      max-width: 100%;
    }
  }
`;

// Inject responsive styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = responsiveStyles;
  document.head.appendChild(styleSheet);
}

export default FinancesPage;
