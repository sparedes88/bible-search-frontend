import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { db, storage } from '../../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, query, orderBy } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import SectionLayout from '../../components/church/SectionLayout';
import { toast } from 'react-toastify';
import Select from 'react-select';
import ReactPaginate from 'react-paginate';
import ImageLightbox from '../../components/ImageLightbox';
import commonStyles from '../../styles/commonStyles';
import '../../styles/sections.module.css';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

const Maintenance = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [punchlists, setPunchlists] = useState([]);
  const [isAddingPunchlist, setIsAddingPunchlist] = useState(false);
  const [editingPunchlist, setEditingPunchlist] = useState(null);
  const [punchlistSearchTerm, setPunchlistSearchTerm] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [rooms, setRooms] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [filters, setFilters] = useState({
    priority: 'all',
    type: 'all',
    progress: 'all',
    status: 'all'
  });
  const [punchlistForm, setPunchlistForm] = useState({
    title: '',
    description: '',
    type: '',
    priority: 'medium',
    status: 'open',
    assignedTo: '',
    images: [],
    comments: [],
    materialCost: 0,
    laborCost: 0,
    mandays: 0,
    progress: 0,
    rooms: [],
  });

  const ITEMS_PER_PAGE = 5;

  const maintenanceTypes = [
    'Plumbing',
    'Electrical',
    'HVAC',
    'Structural',
    'Painting',
    'Landscaping',
    'Cleaning',
    'General Repairs',
    'Other'
  ];

  const filteredPunchlists = punchlists.filter(item => {
    const matchesSearch = 
      item.title.toLowerCase().includes(punchlistSearchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(punchlistSearchTerm.toLowerCase());
    
    const matchesPriority = filters.priority === 'all' || item.priority === filters.priority;
    const matchesType = filters.type === 'all' || item.type === filters.type;
    const matchesStatus = filters.status === 'all' || item.status === filters.status;
    
    const matchesProgress = filters.progress === 'all' || (
      filters.progress === 'not_started' ? item.progress === 0 :
      filters.progress === 'in_progress' ? (item.progress > 0 && item.progress < 100) :
      filters.progress === 'completed' ? item.progress === 100 : true
    );

    return matchesSearch && matchesPriority && matchesType && matchesStatus && matchesProgress;
  });

  const paginatedPunchlists = filteredPunchlists.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  const handleAddPunchlist = async () => {
    try {
      const newPunchlist = { ...punchlistForm, images: selectedImages };
      const docRef = await addDoc(collection(db, 'punchlists'), newPunchlist);
      setPunchlists([...punchlists, { id: docRef.id, ...newPunchlist }]);
      setIsAddingPunchlist(false);
      toast.success('Punchlist item added successfully!');
    } catch (error) {
      toast.error('Failed to add punchlist item.');
    }
  };

  const handleUpdatePunchlist = async (id, updatedPunchlist) => {
    try {
      await updateDoc(doc(db, 'punchlists', id), updatedPunchlist);
      setPunchlists(punchlists.map(item => item.id === id ? { id, ...updatedPunchlist } : item));
      setEditingPunchlist(null);
      toast.success('Punchlist item updated successfully!');
    } catch (error) {
      toast.error('Failed to update punchlist item.');
    }
  };

  const handleDeletePunchlist = async (id) => {
    try {
      await deleteDoc(doc(db, 'punchlists', id));
      setPunchlists(punchlists.filter(item => item.id !== id));
      toast.success('Punchlist item deleted successfully!');
    } catch (error) {
      toast.error('Failed to delete punchlist item.');
    }
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    const statusGroups = {
      open: punchlists.filter(item => item.status === 'open'),
      'in-progress': punchlists.filter(item => item.status === 'in-progress'),
      completed: punchlists.filter(item => item.status === 'completed')
    };

    // Add title
    doc.setFontSize(20);
    doc.text('Maintenance Punchlist Report', 15, 15);
    doc.setFontSize(12);
    doc.text(`Generated on: ${format(new Date(), 'MMM dd, yyyy')}`, 15, 25);
    
    let yOffset = 35;

    Object.entries(statusGroups).forEach(([status, items]) => {
      if (items.length > 0) {
        // Add status section header
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.text(status.toUpperCase(), 15, yOffset);
        yOffset += 10;

        // Create table for this status group
        const tableData = items.map(item => [
          item.title,
          item.type,
          item.priority,
          `${item.progress}%`,
          item.assignedTo || 'Unassigned',
          `$${(parseFloat(item.materialCost) + parseFloat(item.laborCost)).toFixed(2)}`
        ]);

        doc.autoTable({
          startY: yOffset,
          head: [['Title', 'Type', 'Priority', 'Progress', 'Assigned To', 'Total Cost']],
          body: tableData,
          theme: 'striped',
          headStyles: { 
            fillColor: [41, 128, 185],
            textColor: 255,
            fontSize: 10,
          },
          bodyStyles: { fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 50 },
            1: { cellWidth: 30 },
            2: { cellWidth: 25 },
            3: { cellWidth: 20 },
            4: { cellWidth: 35 },
            5: { cellWidth: 25 }
          },
          margin: { left: 15 }
        });

        yOffset = doc.lastAutoTable.finalY + 15;
      }
    });

    // Add summary at the bottom
    const totalCost = punchlists.reduce((sum, item) => 
      sum + parseFloat(item.materialCost || 0) + parseFloat(item.laborCost || 0), 0
    );

    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Total Items: ${punchlists.length}`, 15, yOffset);
    doc.text(`Total Cost: $${totalCost.toFixed(2)}`, 15, yOffset + 7);

    // Save the PDF
    doc.save('maintenance-punchlist.pdf');
  };

  const componentRef = useRef();
  
  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
  });

  const renderPunchlistForm = () => (
    <form onSubmit={(e) => {
      e.preventDefault();
      editingPunchlist ? handleUpdatePunchlist(editingPunchlist.id, punchlistForm) : handleAddPunchlist();
    }}>
      {/* Form fields */}
    </form>
  );

  return (
    <SectionLayout 
      id={id}
      title="Maintenance Punchlist"
      onAdd={() => setIsAddingPunchlist(true)}
      addButtonText="Add Punchlist Item"
      user={user}
    >
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <button
            onClick={exportToPDF}
            style={{
              padding: "8px 16px",
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "center"
            }}
          >
            <span>Export to PDF</span>
          </button>
          <button
            onClick={handlePrint}
            style={{
              padding: "8px 16px",
              backgroundColor: "#10b981",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "center"
            }}
          >
            <span>Print</span>
          </button>
        </div>
        {/* Search and filters section */}
      </div>
      
      <div ref={componentRef}>
        <div style={{ display: "grid", gap: "1rem" }}>
          {paginatedPunchlists.map((item, index) => (
            <PunchlistItem 
              key={item.id} 
              item={item} 
              index={index}
              onEdit={handleUpdatePunchlist} 
              onDelete={handleDeletePunchlist}
            />
          ))}
        </div>

        {filteredPunchlists.length > 0 && (
          <ReactPaginate
            previousLabel={"← Previous"}
            nextLabel={"Next →"}
            pageCount={Math.ceil(filteredPunchlists.length / ITEMS_PER_PAGE)}
            onPageChange={(page) => setCurrentPage(page.selected)}
            containerClassName={"pagination"}
            activeClassName={"active"}
            previousClassName={"previous"}
            nextClassName={"next"}
            disabledClassName={"disabled"}
            pageClassName={"page-item"}
            pageLinkClassName={"page-link"}
          />
        )}

        <div style={{
          marginTop: "2rem",
          padding: "1rem",
          backgroundColor: "#f9fafb",
          borderRadius: "8px",
          border: "1px solid #e5e7eb"
        }}>
          {/* Totals section */}
        </div>
      </div>

      {(isAddingPunchlist || editingPunchlist) && renderPunchlistForm()}
    </SectionLayout>
  );
};

export default Maintenance;
