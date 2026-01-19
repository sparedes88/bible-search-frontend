import React, { useState, useEffect } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { db, storage } from '../../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import ReactPaginate from 'react-paginate';
import commonStyles from '../../pages/commonStyles';
import { jsPDF } from 'jspdf';
import { FaFilePdf } from 'react-icons/fa';
import { QRCodeSVG } from "qrcode.react";
import ImagePlaceholder from '../../components/ImagePlaceholder';
import QRCodeGenerator from 'qrcode';
import { PDFDownloadLink } from '@react-pdf/renderer';
import InventoryQRLabel from '../../components/InventoryQRLabel';

const InventoryPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Add mobile detection state
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [items, setItems] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [filters, setFilters] = useState({
    status: 'all',
    room: 'all'
  });
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    quantity: 1,
    cost: 0,
    status: 'in_use',
    roomId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [] // This will be an array of {url, path, name, uploadedAt}
  });
  const [uploadingImages, setUploadingImages] = useState(false);
  const [previewImages, setPreviewImages] = useState([]);
  const [imageError, setImageError] = useState(false);
  const [showItemDetails, setShowItemDetails] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [inventoryCount, setInventoryCount] = useState(0);

  const ITEMS_PER_PAGE = 10;

  // Add resize event listener to update isMobile state
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const inventoryCard = {
    title: "Inventory",
    description: "Track equipment and supplies",
    icon: "📦",
    path: `/organization/${id}/inventory`
  };

  const itemStatuses = [
    { value: 'in_use', label: 'In Use', color: '#10B981' },
    { value: 'storage', label: 'In Storage', color: '#6B7280' },
    { value: 'repair', label: 'In Repair', color: '#F59E0B' },
    { value: 'disposed', label: 'Disposed', color: '#EF4444' }
  ];

  const styles = {
    button: {
      padding: "0.75rem 1.5rem",
      borderRadius: "0.5rem",
      border: "none",
      color: "white",
      cursor: "pointer",
      fontSize: "0.875rem",
      fontWeight: "600",
      transition: "all 0.2s ease",
      backgroundColor: "#4F46E5",
    },
    formControl: {
      ...commonStyles.input,
      width: "100%",
      marginBottom: "1rem"
    },
    itemCard: {
      border: "1px solid #e5e7eb",
      borderRadius: "0.5rem",
      padding: "1rem",
      marginBottom: "1rem",
      backgroundColor: "white"
    },
    select: {
      ...commonStyles.input,
      backgroundColor: "white",
      cursor: "pointer"
    },
    categoryTag: {
      display: "inline-block",
      padding: "0.25rem 0.75rem",
      borderRadius: "9999px",
      fontSize: "0.875rem",
      fontWeight: "500",
      backgroundColor: "#E5E7EB",
      color: "#374151",
      marginRight: "0.5rem"
    },
    card: {
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      padding: "1.5rem",
      transition: "transform 0.2s, box-shadow 0.2s",
      cursor: "pointer",
      backgroundColor: "white",
      ':hover': {
        transform: "translateY(-2px)",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)"
      }
    },
    cardIcon: {
      fontSize: "2rem",
      marginBottom: "1rem"
    },
    cardTitle: {
      margin: "0 0 0.5rem 0"
    },
    cardDescription: {
      margin: 0,
      color: "#6b7280"
    },
    pageHeader: {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      marginBottom: "1.5rem"
    },
    sectionTitle: {
      ...commonStyles.title,
      display: "flex",
      alignItems: "center",
      gap: "0.5rem"
    },
    headerIcon: {
      fontSize: "2rem"
    },
    actionBar: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "1.5rem",
      flexDirection: isMobile ? "column" : "row",
      gap: isMobile ? "1rem" : "0"
    },
    addButton: {
      backgroundColor: "#10B981",
      color: "white",
      padding: "0.75rem 1.5rem",
      borderRadius: "0.5rem",
      border: "none",
      cursor: "pointer",
      fontSize: "0.875rem",
      fontWeight: "600",
      display: "flex",
      alignItems: "center",
      gap: "0.5rem"
    },
    imagePreviewContainer: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
      gap: '10px',
      marginTop: '10px'
    },
    imagePreviewWrapper: {
      position: 'relative',
      width: '100px',
      height: '100px'
    },
    imagePreview: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      borderRadius: '4px'
    },
    removeImageButton: {
      position: 'absolute',
      top: '5px',
      right: '5px',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      color: 'white',
      border: 'none',
      borderRadius: '50%',
      width: '20px',
      height: '20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer'
    },
    uploadingMessage: {
      marginTop: '10px',
      color: '#4F46E5'
    },
    itemImagesContainer: {
      display: 'flex',
      gap: '10px',
      marginTop: '10px',
      overflowX: 'auto',
      padding: '5px 0'
    },
    itemImage: {
      width: '80px',
      height: '80px',
      objectFit: 'cover',
      borderRadius: '4px'
    },
    filterBar: {
      display: "flex",
      gap: "1rem",
      marginBottom: isMobile ? "1rem" : "0",
      flexDirection: isMobile ? "column" : "row",
      flexWrap: isMobile ? "nowrap" : "wrap"
    },
    filterSelect: {
      padding: "0.5rem",
      borderRadius: "0.375rem",
      border: "1px solid #E5E7EB",
      backgroundColor: "white",
      minWidth: isMobile ? "auto" : "150px",
      width: isMobile ? "100%" : "auto"
    },
    statusBadge: {
      display: "inline-block",
      padding: "0.25rem 0.75rem",
      borderRadius: "9999px",
      fontSize: "0.875rem",
      fontWeight: "500"
    },    imageGallery: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      gap: '1rem',
      marginTop: '1rem'
    },
    imageContainer: {
      position: 'relative',
      paddingTop: '100%', // 1:1 Aspect ratio
      overflow: 'hidden',
      borderRadius: '0.5rem',
      backgroundColor: '#f3f4f6'
    },
    galleryImage: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      transition: 'transform 0.3s ease',
      cursor: 'pointer',
      '&:hover': {
        transform: 'scale(1.05)'
      }
    },
    mainImage: {
      width: '100%',
      height: '300px',
      objectFit: 'contain',
      borderRadius: '0.5rem',
      marginTop: '1rem',
      backgroundColor: '#f3f4f6'
    },    imagePlaceholder: {
      width: '100%',
      height: '300px',
      backgroundColor: '#f3f4f6',
      borderRadius: '0.5rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: '1rem',
      border: '2px dashed #d1d5db',
      color: '#6b7280',
      fontSize: '1rem'
    }
  };

  const getStatusBadgeStyle = (status) => {
    const statusInfo = itemStatuses.find(s => s.value === status) || { color: '#6B7280' };
    return {
      ...styles.statusBadge,
      backgroundColor: `${statusInfo.color}20`,
      color: statusInfo.color
    };
  };

  const generateInventoryId = (count) => {
    // Format: INV-00001, INV-00002, etc.
    const paddedNumber = String(count + 1).padStart(5, '0');
    return `INV-${paddedNumber}`;
  };

  const getNextInventoryNumber = async () => {
    try {
      // Get a count of all inventory items to determine the next number
      const itemsRef = collection(db, 'churches', id, 'inventory');
      const snapshot = await getDocs(itemsRef);
      const count = snapshot.size;
      setInventoryCount(count);
      return count;
    } catch (err) {
      console.error('Error getting inventory count:', err);
      return inventoryCount; // Fallback to current state
    }
  };

  useEffect(() => {
    if (!user) {
      const returnUrl = `${location.pathname}${location.search}${location.hash}`;
      navigate(`/organization/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    const fetchItems = async () => {
      try {
        const itemsRef = collection(db, 'churches', id, 'inventory');
        const q = query(itemsRef, orderBy('updatedAt', 'desc'));
        const snapshot = await getDocs(q);
        const itemsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setItems(itemsData);
      } catch (err) {
        console.error('Error fetching inventory:', err);
        toast.error('Failed to load inventory items');
      }
    };

    fetchItems();
  }, [id, user, navigate, location]);

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const roomsRef = collection(db, 'churches', id, 'rooms');
        const snapshot = await getDocs(roomsRef);
        const roomsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setRooms(roomsData);
      } catch (err) {
        console.error('Error fetching rooms:', err);
      }
    };

    fetchRooms();
  }, [id]);

  const addToHistory = async (action, itemData) => {
    try {
      const historyRef = collection(db, 'churches', id, 'inventory_history');
      await addDoc(historyRef, {
        action,
        itemData,
        timestamp: new Date(),
        userId: user.email
      });
    } catch (err) {
      console.error('Error adding to history:', err);
    }
  };

  const handleImageUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    const validTypes = ["image/jpeg", "image/png", "image/jpg"];
    const maxSize = 5 * 1024 * 1024; // 5MB limit
    
    const invalidFiles = files.filter(file => !validTypes.includes(file.type) || file.size > maxSize);
    if (invalidFiles.length > 0) {
      toast.error("Some files were rejected. Please ensure all files are images under 5MB.");
      return;
    }

    setUploadingImages(true);
    try {
      const uploadPromises = files.map(async (file) => {
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        // Update path to match storage rules under categories
        const filePath = `categories/${id}/inventory/${timestamp}_${safeFileName}`;
        const storageRef = ref(storage, filePath);

        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);

        return {
          url: downloadURL,
          path: filePath,
          name: file.name,
          uploadedAt: new Date().toISOString()
        };
      });

      const uploadedImages = await Promise.all(uploadPromises);
      
      setItemForm(prev => ({
        ...prev,
        images: [...(prev.images || []), ...uploadedImages]
      }));

      toast.success('Images uploaded successfully');
    } catch (error) {
      console.error('Error uploading images:', error);
      toast.error('Failed to upload images');
    } finally {
      setUploadingImages(false);
    }
  };

  const handleRemoveImage = async (index) => {
    try {
      const imageToRemove = itemForm.images && itemForm.images[index];
      
      // Remove from Firebase Storage if it exists there
      if (imageToRemove?.path) {
        const fileRef = ref(storage, imageToRemove.path);
        await deleteObject(fileRef);
      }

      // Update the itemForm state to remove the image
      setItemForm(prev => ({
        ...prev,
        images: prev.images.filter((_, i) => i !== index)
      }));

      // Also remove from preview images if it exists there
      if (previewImages[index]) {
        URL.revokeObjectURL(previewImages[index]); // Clean up the URL object
        setPreviewImages(prev => prev.filter((_, i) => i !== index));
      }

      toast.success('Image removed successfully');
    } catch (error) {
      console.error('Error removing image:', error);
      toast.error('Failed to remove image');
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!itemForm.name || !itemForm.description) {
      toast.error('Name and description are required');
      return;
    }

    try {
      const itemsRef = collection(db, 'churches', id, 'inventory');
      const now = new Date();
      const nextInventoryNumber = await getNextInventoryNumber();
      const inventoryId = generateInventoryId(nextInventoryNumber);
      await addDoc(itemsRef, {
        ...itemForm,
        inventoryId,
        createdAt: now,
        updatedAt: now
      });

      const q = query(itemsRef, orderBy('updatedAt', 'desc'));
      const snapshot = await getDocs(q);
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      
      setItemForm({
        name: '',
        description: '',
        quantity: 1,
        cost: 0,
        status: 'in_use',
        roomId: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        images: []
      });
      setPreviewImages([]);
      setIsAddingItem(false);
      toast.success('Item added successfully!');
    } catch (err) {
      console.error('Error adding item:', err);
      toast.error('Failed to add item');
    }
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setItemForm({
      ...item,
      quantity: parseInt(item.quantity) || 0,
      cost: parseFloat(item.cost) || 0,
      images: item.images || []
    });
    // Set preview images from existing item images
    setPreviewImages(item.images?.map(img => img.url) || []);
  };

  const handleUpdateItem = async (itemId) => {
    if (!itemForm.name || !itemForm.description) {
      toast.error('Name and description are required');
      return;
    }

    try {      const itemRef = doc(db, 'churches', id, 'inventory', itemId);
      const now = new Date();
      
      // Ensure the item has an inventory ID (for older records)
      let inventoryIdToUse = itemForm.inventoryId;
      if (!inventoryIdToUse) {
        const nextNumber = await getNextInventoryNumber();
        inventoryIdToUse = generateInventoryId(nextNumber);
      }

      await updateDoc(itemRef, {
        ...itemForm,
        images: itemForm.images || [],
        inventoryId: inventoryIdToUse,
        updatedAt: now,
        updatedBy: user.email
      });

      // Add to history
      await addToHistory('updated', {
        ...itemForm,
        images: itemForm.images || [],
        updatedAt: now,
        updatedBy: user.email
      });

      // Refresh the items list
      const itemsRef = collection(db, 'churches', id, 'inventory');
      const q = query(itemsRef, orderBy('updatedAt', 'desc'));
      const snapshot = await getDocs(q);
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      setEditingItem(null);
      setItemForm({
        name: '',
        description: '',
        quantity: 1,
        cost: 0,
        status: 'in_use',
        roomId: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        images: []
      });
      setPreviewImages([]);
      toast.success('Item updated successfully');
    } catch (error) {
      console.error('Error updating item:', error);
      toast.error('Failed to update item');
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;

    try {
      const itemToDelete = items.find(item => item.id === itemId);
      if (itemToDelete?.images?.length > 0) {
        const deletePromises = itemToDelete.images.map(async (image) => {
          if (image.path) {
            const fileRef = ref(storage, image.path);
            return deleteObject(fileRef);
          }
        });
        await Promise.all(deletePromises);
      }

      await addToHistory('deleted', itemToDelete);

      const itemRef = doc(db, 'churches', id, 'inventory', itemId);
      await deleteDoc(itemRef);
      setItems(items.filter(item => item.id !== itemId));
      toast.success('Item deleted successfully!');
    } catch (err) {
      console.error('Error deleting item:', err);
      toast.error('Failed to delete item');
    }
  };

  const calculateTotalValue = (items) => {
    return items.reduce((sum, item) => {
      const itemValue = (parseFloat(item.cost) || 0) * (parseInt(item.quantity) || 0);
      return sum + itemValue;
    }, 0);
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
      doc.text('Inventory Management Report', 15, 25);
      
      // Header info
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);

      // Use all items instead of paginated items for the report
      const totalItems = items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
      const totalValue = calculateTotalValue(items);
      doc.text(`Total Items: ${totalItems}`, doc.internal.pageSize.width - 60, 35);
      
      let yOffset = 50;

      // Add summary section
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Inventory Summary', 15, yOffset);
      yOffset += 15;

      // Summary boxes
      const summaryBoxWidth = (doc.internal.pageSize.width - 45) / 3;
      const summaryBoxHeight = 40;
      
      // Calculate status totals using our defined statuses
      const itemsByStatus = {};
      itemStatuses.forEach(status => {
        itemsByStatus[status.value] = items
          .filter(item => item.status === status.value)
          .reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
      });

      // Total Items box
      doc.setFillColor(209, 250, 229);
      doc.rect(15, yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(4, 120, 87);
      doc.setFontSize(12);
      doc.text('Total Items', 20, yOffset + 15);
      doc.setFontSize(14);
      doc.text(totalItems.toString(), 20, yOffset + 30);

      // Total Value box
      doc.setFillColor(209, 250, 229);
      doc.rect(25 + summaryBoxWidth, yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(4, 120, 87);
      doc.setFontSize(12);
      doc.text('Total Value', 30 + summaryBoxWidth, yOffset + 15);
      doc.setFontSize(14);
      doc.text(`$${totalValue.toFixed(2)}`, 30 + summaryBoxWidth, yOffset + 30);

      // Status Distribution box
      doc.setFillColor(209, 250, 229);
      doc.rect(35 + (summaryBoxWidth * 2), yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(4, 120, 87);
      doc.setFontSize(12);
      doc.text('Status Distribution', 40 + (summaryBoxWidth * 2), yOffset + 15);
      doc.setFontSize(10);
      let statusOffset = 25;
      for (const status of itemStatuses) {
        const count = itemsByStatus[status.value] || 0;
        doc.text(`${status.label}: ${count}`, 40 + (summaryBoxWidth * 2), yOffset + statusOffset);
        statusOffset += 10;
      }

      yOffset += summaryBoxHeight + 20;
        // Add a consolidated inventory list with prices and totals
      doc.setFontSize(16);
      doc.setTextColor(31, 41, 55);
      doc.setFont(undefined, 'bold');
      doc.text('INVENTORY ITEMS LIST', 15, yOffset);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(107, 114, 128);
      doc.text('(All items with prices and totals)', 15, yOffset + 7);
      yOffset += 12;
      
      // Create table header for inventory list with improved styling
      doc.setFillColor(79, 70, 229);
      doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 10, 'F');
      
      // Set up column widths
      const colWidth = (doc.internal.pageSize.width - 30) / 100;
      const cols = {
        id: 15 * colWidth,
        name: 40 * colWidth,
        qty: 10 * colWidth,
        price: 15 * colWidth,
        total: 20 * colWidth
      };
        // Add table headers with improved visibility
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255); // White text for better contrast
      doc.setFont(undefined, 'bold');
      doc.text('ID', 15 + 2, yOffset + 6); // Slightly adjusted positioning
      doc.text('Item Name', 15 + cols.id + 2, yOffset + 6);
      doc.text('Qty', 15 + cols.id + cols.name + 2, yOffset + 6);
      doc.text('Unit Price', 15 + cols.id + cols.name + cols.qty + 2, yOffset + 6);
      doc.text('Total Value', 15 + cols.id + cols.name + cols.qty + cols.price + 2, yOffset + 6);
      
      yOffset += 12; // More space after header
      
      // Sort all items by name for a consolidated list
      const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name));
        // Add all items to the table with more compact rowHeight
      doc.setFont(undefined, 'normal');
      let rowHeight = 7; // Reduced row height for more compact display
      let totalInventoryValue = 0;
      
      for (const item of sortedItems) {
        // Add a new page if we're close to the bottom
        if (yOffset > doc.internal.pageSize.height - 20) {
          doc.addPage();
          yOffset = 20;
          
          // Repeat the header on new page
          doc.setFillColor(79, 70, 229, 0.2);
          doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 8, 'F');
          
          doc.setFontSize(10);
          doc.setTextColor(31, 41, 55);
          doc.setFont(undefined, 'bold');
          doc.text('ID', 15, yOffset + 5);
          doc.text('Item Name', 15 + cols.id, yOffset + 5);
          doc.text('Qty', 15 + cols.id + cols.name, yOffset + 5);
          doc.text('Unit Price', 15 + cols.id + cols.name + cols.qty, yOffset + 5);
          doc.text('Total Value', 15 + cols.id + cols.name + cols.qty + cols.price, yOffset + 5);
          
          yOffset += 10;
          doc.setFont(undefined, 'normal');
        }
          // Enhanced alternating row background color for better readability
        if ((sortedItems.indexOf(item) % 2) === 0) {
          doc.setFillColor(243, 244, 246); // Slightly darker for better contrast
          doc.rect(15, yOffset - 2, doc.internal.pageSize.width - 30, rowHeight, 'F');
        } else {
          doc.setFillColor(249, 250, 251); // Very light background for odd rows
          doc.rect(15, yOffset - 2, doc.internal.pageSize.width - 30, rowHeight, 'F');
        }
        
        // Calculate item value
        const qty = parseInt(item.quantity) || 0;
        const price = parseFloat(item.cost) || 0;
        const itemValue = qty * price;
        totalInventoryValue += itemValue;
        
        // Get status color for visual indication
        const statusInfo = itemStatuses.find(s => s.value === item.status) || { color: '#6B7280' };
        const rgbColor = hexToRgb(statusInfo.color);
        
        // Add a small status indicator
        doc.setFillColor(rgbColor[0], rgbColor[1], rgbColor[2]);
        doc.rect(15, yOffset, 3, rowHeight - 2, 'F');
        
        // Item data
        doc.setFontSize(8);
        doc.setTextColor(31, 41, 55);
        doc.text(item.inventoryId || 'No ID', 19, yOffset + 4);
        
        // Truncate name if too long
        const name = item.name || 'Unnamed Item';
        const truncatedName = name.length > 40 ? name.substring(0, 37) + '...' : name;
        doc.text(truncatedName, 15 + cols.id, yOffset + 4);
        
        // Right align the numbers
        doc.text(qty.toString(), 15 + cols.id + cols.name + cols.qty - doc.getTextWidth(qty.toString()) - 2, yOffset + 4);
        doc.text('$' + price.toFixed(2), 15 + cols.id + cols.name + cols.qty + cols.price - doc.getTextWidth('$' + price.toFixed(2)) - 2, yOffset + 4);
        doc.text('$' + itemValue.toFixed(2), 15 + cols.id + cols.name + cols.qty + cols.price + cols.total - doc.getTextWidth('$' + itemValue.toFixed(2)) - 5, yOffset + 4);
        
        yOffset += rowHeight;
      }
        // Add enhanced total line
      yOffset += 4; // Add more space before the total line
      doc.setFillColor(79, 70, 229);
      doc.rect(15, yOffset - 2, doc.internal.pageSize.width - 30, rowHeight + 4, 'F');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11); // Larger font
      doc.setTextColor(255); // White text
      doc.text('TOTAL', 15 + cols.id, yOffset + 6);
      doc.text('$' + totalInventoryValue.toFixed(2), 15 + cols.id + cols.name + cols.qty + cols.price + cols.total - doc.getTextWidth('$' + totalInventoryValue.toFixed(2)) - 5, yOffset + 6);
      
      yOffset += rowHeight + 5;
      
      // Add status breakdown section with more detail if needed
      if (yOffset < doc.internal.pageSize.height - 100) {
        doc.addPage();
        yOffset = 20;
      } else {
        yOffset += 20;
      }
        doc.setFontSize(16);
      doc.setTextColor(31, 41, 55);
      doc.setFont(undefined, 'bold');
      doc.text('INVENTORY DETAILS BY STATUS', 15, yOffset);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(107, 114, 128);
      doc.text('(Items organized by status with reduced spacing)', 15, yOffset + 7);
      yOffset += 15;

      // Status breakdown section with detailed items
      for (const status of itemStatuses) {
        // Filter items for this status
        const statusItems = items.filter(item => item.status === status.value);
        
        // Skip if no items in this status
        if (statusItems.length === 0) {
          continue;
        }

        // Check if we need a new page
        if (yOffset > doc.internal.pageSize.height - 40) {
          doc.addPage();
          yOffset = 20;
        }

        // Convert hex color to RGB for status header
        const rgbColor = hexToRgb(status.color);
        doc.setFillColor(rgbColor[0], rgbColor[1], rgbColor[2]);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 10, 'F');
        doc.setTextColor(255);
        doc.setFontSize(12);
        doc.text(`${status.label} (${statusItems.length} items)`, 20, yOffset + 7);
        yOffset += 15;      // Process items in this status with ultra-compact layout
        for (const item of statusItems) {
          if (yOffset > doc.internal.pageSize.height - 30) {
            doc.addPage();
            yOffset = 20;
          }          // Item details box - ultra compact at 22px height
          doc.setFillColor(249, 250, 251);
          doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 22, 'F');
          
          // Item name with ID
          doc.setFontSize(9);
          doc.setTextColor(31, 41, 55);
          doc.setFont(undefined, 'bold');
          doc.text(item.name || 'Unnamed Item', 20, yOffset + 7);
            // ID tag - ultra compact format, to the right
          doc.setFillColor(219, 234, 254);
          const idText = `ID: ${item.inventoryId || 'No ID'}`;
          const idWidth = doc.getTextWidth(idText) + 4; // Reduced padding
          doc.rect(doc.internal.pageSize.width - 35 - idWidth, yOffset + 3, idWidth, 5, 'F'); // Reduced height
          doc.setFont(undefined, 'normal');
          doc.setFontSize(6.5); // Smaller font size
          doc.setTextColor(30, 64, 175);
          doc.text(idText, doc.internal.pageSize.width - 33 - idWidth, yOffset + 6.5);// Item details - all on one line and more compact
          doc.setFontSize(7.5);
          doc.setTextColor(107, 114, 128);
          const itemValue = (parseFloat(item.cost) || 0) * (parseInt(item.quantity) || 0);
          const details = [
            `Qty: ${parseInt(item.quantity) || 0}`,
            `Cost: $${(parseFloat(item.cost) || 0).toFixed(2)}`,
            `Total: $${itemValue.toFixed(2)}`,
            `Room: ${rooms.find(r => r.id === item.roomId)?.name || 'N/A'}`
          ].join(' | ');
          doc.text(details, 20, yOffset + 16);yOffset += 26; // Further reduced spacing between items
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
      doc.save('inventory-management-report.pdf');
      
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

  // Helper function to convert hex color to RGB array
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [107, 114, 128]; // Default gray if parsing fails
  };

  // Helper function to convert image URL to base64 for PDF
  const getImageDataUrl = async (url) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error converting image:', error);
      throw error;
    }
  };

  // Add function to generate QR code data URL for PDFs
  const generateQRCodeDataUrl = async (url) => {
    try {
      return await QRCodeGenerator.toDataURL(url);
    } catch (error) {
      console.error('Error generating QR code data URL:', error);
      return null;
    }
  };

  // Filter items based on search term and filters
  const filteredItems = items.filter(item => {
    const matchesSearch = 
      (item.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (item.description?.toLowerCase() || '').includes(searchTerm.toLowerCase());

    const matchesStatus = filters.status === 'all' || item.status === filters.status;
    const matchesRoom = filters.room === 'all' || item.roomId === filters.room;
    const matchesValueRange = true; // We'll implement this if needed

    return matchesSearch && matchesStatus && matchesRoom;
  });

  // Get paginated items
  const paginatedItems = filteredItems.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  // Get summary stats
  const inventorySummary = {
    totalItems: items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0),
    totalValue: calculateTotalValue(items),
    itemsByStatus: items.reduce((acc, item) => {
      const status = item.status || 'unknown';
      acc[status] = (acc[status] || 0) + (parseInt(item.quantity) || 0);
      return acc;
    }, {})
  };

  // Add CSS for pagination
  const paginationStyles = `
    .pagination {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 2rem;
      list-style: none;
      padding: 0;
    }
    .pagination li {
      cursor: pointer;
    }
    .pagination li a {
      padding: 0.5rem 1rem;
      border: 1px solid #4F46E5;
      border-radius: 0.375rem;
      color: #4F46E5;
    }
    .pagination li.active a {
      background-color: #4F46E5;
      color: white;
    }
    .pagination li.disabled a {
      color: #9CA3AF;
      border-color: #E5E7EB;
      cursor: not-allowed;
    }
  `;

  useEffect(() => {
    // Add pagination styles to document
    const styleSheet = document.createElement("style");
    styleSheet.innerText = paginationStyles;
    document.head.appendChild(styleSheet);

    return () => {
      document.head.removeChild(styleSheet);
    };
  }, []);

  // Reset pagination when filters or search changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm, filters]);  // Function to get direct item URL for QR codes
  const getItemUrl = (itemId) => {
    const baseUrl = window.location.origin;
    // Generate a clean URL that will be processed by InventoryItemDetail.js
    // This URL format ensures the item is redirected correctly after login
    return `${baseUrl}/organization/${id}/inventory/${itemId}`;
  };

  // Add function to handle direct item viewing
  useEffect(() => {
    const path = location.pathname;
    const match = path.match(/\/inventory\/(.+)$/);
    // Check for itemId in path
    if (match) {
      const itemId = match[1];
      const item = items.find(i => i.id === itemId);
      if (item) {
        setSelectedItem(item);
        setShowItemDetails(true);
      }
    }
    
    // Also check for selectedItemId in query parameters (for when redirected after login)
    const urlParams = new URLSearchParams(location.search);
    const selectedItemId = urlParams.get('selectedItemId');
    if (selectedItemId && items.length > 0) {
      const item = items.find(i => i.id === selectedItemId);
      if (item) {
        setSelectedItem(item);
        setShowItemDetails(true);
        
        // Update URL to clean version without the query parameter (optional)
        // This prevents the modal from reopening if the user refreshes the page
        if (history && history.replaceState) {
          const newUrl = `${window.location.pathname}`;
          history.replaceState({}, document.title, newUrl);
        }
      }
    }
  }, [location.pathname, location.search, items]);

  // Add ItemDetails Modal component
  const ItemDetails = ({ item, onClose }) => {
    const [qrUrl, setQrUrl] = useState('');
    const [church, setChurch] = useState(null);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
    const [pdfLoading, setPdfLoading] = useState(false);

    useEffect(() => {
      const fetchChurchData = async () => {
        try {
          const churchDoc = await getDoc(doc(db, 'churches', id));
          if (churchDoc.exists()) {
            setChurch(churchDoc.data());
          }
        } catch (error) {
          console.error('Error fetching church data:', error);
        }
      };

      const prepareQRData = async () => {
        try {
          const url = getItemUrl(item.id);
          setQrUrl(url);
          const dataUrl = await generateQRCodeDataUrl(url);
          if (dataUrl) {
            // Convert data URL to base64 string by removing prefix
            const base64Data = dataUrl.split(',')[1];
            setQrCodeDataUrl(base64Data);
          }
        } catch (error) {
          console.error('Error generating QR code:', error);
        }
      };

      fetchChurchData();
      prepareQRData();
    }, [item.id]);

    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "2rem"
      }}>
        <div style={{
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "0.5rem",
          width: "90%",
          maxWidth: "800px",
          maxHeight: "90vh",
          overflow: "auto",
          margin: isMobile ? "1rem" : 0
        }}>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: isMobile ? "center" : "start", 
            marginBottom: "1rem",
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? "1rem" : 0
          }}>
            <h2 style={{ margin: isMobile ? "0 auto" : 0 }}>{item.name}</h2>
            <button
              onClick={onClose}
              style={{ 
                ...styles.button, 
                backgroundColor: "#EF4444",
                width: isMobile ? "100%" : "auto" 
              }}
            >
              Close
            </button>
          </div>          <div style={{ marginBottom: "2rem" }}>
            {item.images && item.images.length > 0 ? (
              <div style={{ 
                width: "100%", 
                height: "400px",
                borderRadius: "0.5rem",
                overflow: "hidden",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: "#f3f4f6"
              }}>
                <img
                  src={item.images[0].url}
                  alt={item.name}
                  style={{ 
                    width: "100%", 
                    height: "100%", 
                    objectFit: "contain",
                    borderRadius: "0.5rem" 
                  }}
                />
              </div>
            ) : (
              <ImagePlaceholder style={{ height: "400px" }} />
            )}
          </div><div style={{ marginBottom: "1rem", backgroundColor: "#EBF4FF", padding: "1rem", borderRadius: "0.5rem" }}>
            <div style={{ 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center",
              flexDirection: isMobile ? "column" : "row",
              gap: isMobile ? "0.5rem" : 0
            }}>
              <div style={{ fontWeight: "bold" }}>Inventory ID:</div>
              <div style={{ 
                fontSize: "1.2rem", 
                fontWeight: "bold", 
                color: "#1E40AF", 
                backgroundColor: "#DBEAFE", 
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                width: isMobile ? "100%" : "auto",
                textAlign: isMobile ? "center" : "left"
              }}>
                {item.inventoryId || "No ID Assigned"}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "2rem" }}>
            <div style={{ 
              display: "flex", 
              gap: "1rem", 
              marginBottom: "1rem",
              flexDirection: isMobile ? "column" : "row",
              alignItems: isMobile ? "flex-start" : "center"
            }}>
              <span style={getStatusBadgeStyle(item.status)}>
                {itemStatuses.find(s => s.value === item.status)?.label || item.status}
              </span>
              <span>Quantity: {item.quantity}</span>
              <span>Cost: ${parseFloat(item.cost).toFixed(2)}</span>
            </div>
            <p style={{ color: "#6B7280" }}>{item.description}</p>
          </div>

          {/* QR Code Section */}
          <div style={{
            marginTop: "2rem",
            padding: "1.5rem",
            backgroundColor: "#F9FAFB",
            borderRadius: "0.5rem"
          }}>
            <h3 style={{ marginBottom: "1rem" }}>Item QR Code</h3>
            
            <div style={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              alignItems: isMobile ? "center" : "flex-start",
              gap: "2rem",
              marginBottom: "1.5rem"
            }}>
              <div style={{
                backgroundColor: "white",
                padding: "1rem",
                borderRadius: "0.5rem",
                border: "1px solid #E5E7EB",
                width: isMobile ? "100%" : "auto",
                display: "flex",
                justifyContent: "center"
              }}>
                <QRCodeSVG value={qrUrl} size={144} level="H" />
              </div>
              
              <div style={{
                width: isMobile ? "100%" : "auto",
                textAlign: isMobile ? "center" : "left"
              }}>
                <p style={{ marginBottom: "0.5rem" }}>Scan this QR code to quickly access this item's details.</p>
                <PDFDownloadLink
                  document={
                    <InventoryQRLabel 
                      item={item}
                      qrUrl={qrUrl}
                      church={church}
                    />
                  }
                  fileName={`${item.name.replace(/\s+/g, '-').toLowerCase()}-qr-label.pdf`}
                  style={{
                    display: isMobile ? "block" : "inline-block",
                    padding: '8px 16px',
                    backgroundColor: '#4F46E5',
                    color: 'white',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    fontSize: '14px',
                    marginTop: '1rem',
                    width: isMobile ? "100%" : "auto",
                    textAlign: "center"
                  }}
                >
                  {({ blob, url, loading, error }) =>
                    loading ? 'Preparing PDF...' : '📄 Download QR Label PDF'
                  }
                </PDFDownloadLink>
              </div>
            </div>
          </div>

          {item.images && item.images.length > 1 && (
            <div>
              <h3 style={{ marginBottom: "1rem" }}>Additional Images</h3>
              <div style={styles.imageGallery}>
                {item.images.slice(1).map((image, index) => (
                  <div key={index} style={styles.imageContainer}>                    <img
                      src={image.url}
                      alt={`${item.name} - ${index + 2}`}
                      style={{
                        ...styles.galleryImage,
                        objectFit: "contain",
                        backgroundColor: "#f3f4f6"
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderItemForm = () => (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: "2rem"
    }}>
      <div style={{
        backgroundColor: "white",
        padding: "2rem",
        borderRadius: "0.5rem",
        width: "90%",
        maxWidth: "600px",
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column"
      }}>
        <h3 style={{ marginTop: 0 }}>{editingItem ? 'Edit Item' : 'Add New Item'}</h3>
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (editingItem) {
              handleUpdateItem(editingItem.id);
            } else {
              handleAddItem(e);
            }
          }}
          style={{
            overflowY: "auto",
            flex: 1,
            paddingRight: "1rem",
            marginRight: "-1rem" // Compensate for padding to align with header
          }}
        >
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Item Name *</label>
            <input
              type="text"
              value={itemForm.name}
              onChange={e => setItemForm(prev => ({ ...prev, name: e.target.value }))}
              style={styles.formControl}
              required
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Description *</label>
            <textarea
              value={itemForm.description}
              onChange={e => setItemForm(prev => ({ ...prev, description: e.target.value }))}
              style={{ ...styles.formControl, minHeight: "100px" }}
              required
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Quantity</label>
            <input
              type="number"
              value={itemForm.quantity}
              onChange={e => setItemForm(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
              style={styles.formControl}
              min="0"
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Cost ($)</label>
            <input
              type="number"
              value={itemForm.cost}
              onChange={e => setItemForm(prev => ({ ...prev, cost: parseFloat(e.target.value) || 0 }))}
              style={styles.formControl}
              min="0"
              step="0.01"
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Status</label>
            <select
              value={itemForm.status}
              onChange={e => setItemForm(prev => ({ ...prev, status: e.target.value }))}
              style={styles.select}
            >
              {itemStatuses.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Room</label>
            <select
              value={itemForm.roomId}
              onChange={e => setItemForm(prev => ({ ...prev, roomId: e.target.value }))}
              style={styles.select}
            >
              <option value="">Select Room</option>
              {rooms.map(room => (
                <option key={room.id} value={room.id}>{room.name}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Images</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              style={styles.formControl}
              disabled={uploadingImages}
            />
            {uploadingImages && (
              <div style={styles.uploadingMessage}>Uploading images...</div>
            )}
            {(previewImages.length > 0 || itemForm.images?.length > 0) && (
              <div style={styles.imagePreviewContainer}>
                {previewImages.map((preview, index) => (
                  <div key={`preview-${index}`} style={styles.imagePreviewWrapper}>
                    <img
                      src={preview}
                      alt={`Preview ${index + 1}`}
                      style={styles.imagePreview}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      style={styles.removeImageButton}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {itemForm.images?.map((image, index) => (
                  <div key={`image-${index}`} style={styles.imagePreviewWrapper}>
                    <img
                      src={image.url}
                      alt={`Item ${index + 1}`}
                      style={styles.imagePreview}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      style={styles.removeImageButton}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ 
            position: "sticky",
            bottom: 0,
            backgroundColor: "white",
            padding: "1rem 0 0 0",
            marginTop: "1rem",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            gap: "1rem",
            justifyContent: "flex-end"
          }}>
            <button
              type="button"
              onClick={() => {
                setEditingItem(null);
                setIsAddingItem(false);
              }}
              style={{ ...styles.button, backgroundColor: "#EF4444" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...styles.button, backgroundColor: "#10B981" }}
            >
              {editingItem ? 'Update' : 'Add'} Item
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div style={{ backgroundColor: '#f3f4f6', minHeight: '100vh', width: '100%', padding: '2rem' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          ← Back to Mi Organización
        </Link>

        <div style={{
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
          marginTop: "1rem"
        }}>
          <div style={styles.pageHeader}>
            <h2 style={styles.sectionTitle}>
              <span style={styles.headerIcon}>{inventoryCard.icon}</span>
              {inventoryCard.title}
            </h2>
            <p style={{ color: "#6B7280", margin: 0 }}>{inventoryCard.description}</p>
          </div>

          {/* Summary Section */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1rem",
            marginBottom: "2rem",
            backgroundColor: "#F9FAFB",
            padding: "1rem",
            borderRadius: "0.5rem"
          }}>
            <div>
              <div style={{ fontSize: "0.875rem", color: "#6B7280" }}>Total Items</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "600" }}>{inventorySummary.totalItems}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.875rem", color: "#6B7280" }}>Total Value</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "600" }}>${inventorySummary.totalValue.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.875rem", color: "#6B7280" }}>Status Distribution</div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                {itemStatuses.map(status => (
                  <span key={status.value} style={getStatusBadgeStyle(status.value)}>
                    {status.label}: {inventorySummary.itemsByStatus[status.value] || 0}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Filters and Search */}
          <div style={styles.actionBar}>
            <div style={{ 
              flex: 1,
              width: isMobile ? "100%" : "auto" 
            }}>
              <div style={styles.filterBar}>
                <input
                  type="text"
                  placeholder="Search inventory..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ 
                    ...styles.formControl, 
                    maxWidth: isMobile ? "100%" : "300px", 
                    marginBottom: isMobile ? "1rem" : 0,
                    width: isMobile ? "100%" : "auto"
                  }}
                />
                <select
                  value={filters.status}
                  onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  style={styles.filterSelect}
                >
                  <option value="all">All Statuses</option>
                  {itemStatuses.map(status => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.room}
                  onChange={e => setFilters(prev => ({ ...prev, room: e.target.value }))}
                  style={styles.filterSelect}
                >
                  <option value="all">All Rooms</option>
                  {rooms.map(room => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ 
              display: "flex", 
              gap: "1rem",
              width: isMobile ? "100%" : "auto" 
            }}>
              <button 
                onClick={exportToPDF}
                style={{
                  ...styles.button,
                  backgroundColor: "#2563eb",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flex: isMobile ? 1 : "auto"
                }}
              >
                <FaFilePdf /> Export to PDF
              </button>
              <button 
                onClick={() => setIsAddingItem(true)}
                style={{
                  ...styles.addButton,
                  flex: isMobile ? 1 : "auto"
                }}
              >
                <span>+</span> Add New Item
              </button>
            </div>
          </div>

          {/* Item Cards */}
          {paginatedItems.map(item => (
            <div key={item.id} style={styles.itemCard}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    display: "flex", 
                    justifyContent: isMobile ? "center" : "flex-end",
                    marginBottom: "0.5rem" 
                  }}>
                    <button
                      onClick={() => {
                        setSelectedItem(item);
                        setShowItemDetails(true);
                        // Update URL without refreshing
                        window.history.pushState({}, '', `/organization/${id}/inventory/${item.id}`);
                      }}
                      style={{
                        ...styles.button,
                        backgroundColor: "#4F46E5",
                        marginRight: isMobile ? "0" : "1rem",
                        width: isMobile ? "100%" : "auto"
                      }}
                    >
                      View Details & QR
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "0.5rem" }}>
                    <span style={getStatusBadgeStyle(item.status)}>
                      {itemStatuses.find(s => s.value === item.status)?.label || item.status}
                    </span>                    <span style={{ color: "#6B7280" }}>
                      <span style={{ 
                        backgroundColor: "#DBEAFE", 
                        color: "#1E40AF", 
                        padding: "2px 8px", 
                        borderRadius: "4px", 
                        fontWeight: "500" 
                      }}>
                        ID: {item.inventoryId || 'N/A'}
                      </span> | Quantity: {item.quantity} | Cost: ${parseFloat(item.cost).toFixed(2)} | 
                      Room: {rooms.find(r => r.id === item.roomId)?.name || 'N/A'}
                    </span>
                  </div>
                  <p style={{ margin: "0", color: "#6B7280" }}>
                    {item.description}
                  </p>
                    {/* Display main image or placeholder */}
                  {item.images && item.images.length > 0 ? (
                    <div style={{
                      width: '100%',
                      height: '300px',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '0.5rem',
                      marginTop: '1rem',
                      overflow: 'hidden'
                    }}>
                      <img
                        src={item.images[0].url}
                        alt={item.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain'
                        }}
                        onError={() => setImageError(true)}
                      />
                    </div>
                  ) : (
                    <ImagePlaceholder style={styles.mainImage} />
                  )}
                  
                  {/* Display additional images in a grid */}
                  {item.images && item.images.length > 1 && (
                    <div style={styles.imageGallery}>
                      {item.images.slice(1).map((image, index) => (
                        <div key={index} style={styles.imageContainer}>                          {image.url ? (
                            <img
                              src={image.url}
                              alt={`${item.name} - ${index + 2}`}
                              style={{
                                ...styles.galleryImage,
                                objectFit: 'contain',
                                backgroundColor: '#f3f4f6'
                              }}
                              onError={() => setImageError(true)}
                            />                          ) : (
                            <ImagePlaceholder style={{
                              ...styles.galleryImage,
                              objectFit: 'contain',
                              backgroundColor: '#f3f4f6'
                            }} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}                </div>
                <div style={{ 
                  display: "flex", 
                  gap: "0.5rem",
                  flexDirection: isMobile ? "row" : "column",
                  width: isMobile ? "100%" : "auto"
                }}>
                  <button
                    onClick={() => handleEditItem(item)}
                    style={{ 
                      ...styles.button, 
                      backgroundColor: "#F59E0B",
                      flex: isMobile ? 1 : "auto"
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    style={{ 
                      ...styles.button, 
                      backgroundColor: "#EF4444",
                      flex: isMobile ? 1 : "auto"
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}

          <ReactPaginate
            pageCount={Math.ceil(filteredItems.length / ITEMS_PER_PAGE)}
            pageRangeDisplayed={2}
            marginPagesDisplayed={1}
            onPageChange={({ selected }) => setCurrentPage(selected)}
            containerClassName="pagination"
            activeClassName="active"
          />
        </div>

        {(isAddingItem || editingItem) && renderItemForm()}

        {/* Show item details modal when an item is selected */}
        {showItemDetails && selectedItem && (
          <ItemDetails 
            item={selectedItem} 
            onClose={() => {
              setShowItemDetails(false);
              setSelectedItem(null);
              // Update URL back to inventory list
              window.history.pushState({}, '', `/organization/${id}/inventory`);
            }} 
          />
        )}
      </div>
    </div>
  );
};

export default InventoryPage;
