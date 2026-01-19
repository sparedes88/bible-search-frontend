import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { db, storage } from '../../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, query, orderBy, arrayUnion } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import Select from 'react-select';
import ReactPaginate from 'react-paginate';
import ImageLightbox from '../../components/ImageLightbox';
import commonStyles from '../../pages/commonStyles';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import TaskQRLabel from '../../components/TaskQRLabel';

const MaintenancePage = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [initialItemId, setInitialItemId] = useState(searchParams.get('item'));

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return '#DC2626'; // Red
      case 'medium':
        return '#F59E0B'; // Orange
      case 'low':
        return '#2563EB'; // Blue
      default:
        return '#6B7280'; // Gray
    }
  };

  const [punchlists, setPunchlists] = useState([]);
  const [isAddingPunchlist, setIsAddingPunchlist] = useState(false);
  const [editingPunchlist, setEditingPunchlist] = useState(null);
  const [punchlistSearchTerm, setPunchlistSearchTerm] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState([]);
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
    quotes: [], // Add quotes array to store contractor quotes
  });
  const [isOpen, setIsOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const componentRef = useRef();
  const [qrValue, setQrValue] = useState('');
  const [showQRDetail, setShowQRDetail] = useState(false);
  const [selectedPunchlist, setSelectedPunchlist] = useState(null);
  const [church, setChurch] = useState(null);
  const [editingQuote, setEditingQuote] = useState(null);
  const [quoteForm, setQuoteForm] = useState({
    contractor: '',
    amount: 0,
    description: '',
    date: new Date().toISOString().split('T')[0],
    status: 'pending'
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
    'Carpentry',
    'Roofing',
    'Flooring',
    'Windows & Doors',
    'Security Systems',
    'Audio/Visual',
    'Fire Safety',
    'Pest Control',
    'Lighting',
    'Furniture',
    'Equipment',
    'Bathroom',
    'Kitchen',
    'Other'
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
      "&:hover": {
        backgroundColor: "#4338CA",
        transform: "translateY(-1px)"
      }
    },
    deleteButton: {
      backgroundColor: "#EF4444",
      "&:hover": {
        backgroundColor: "#DC2626"
      }
    },
    editButton: {
      backgroundColor: "#F59E0B",
      "&:hover": {
        backgroundColor: "#D97706"
      }
    },
    cancelButton: {
      backgroundColor: "#9CA3AF",
      "&:hover": {
        backgroundColor: "#6B7280"
      }
    },
    successButton: {
      backgroundColor: "#10B981",
      "&:hover": {
        backgroundColor: "#059669"
      }
    },
    smallButton: {
      padding: "0.375rem 0.75rem",
      borderRadius: "0.375rem",
      fontSize: "0.75rem",
      fontWeight: "500"
    },
    formControl: {
      ...commonStyles.input,
      width: "100%",
      padding: "0.75rem",
      borderRadius: "0.5rem",
      border: "1px solid #E5E7EB",
      marginBottom: "1rem",
      transition: "border-color 0.2s ease",
      "&:focus": {
        borderColor: "#4F46E5",
        outline: "none"
      }
    },
    select: {
      ...commonStyles.select,
      padding: "0.75rem",
      borderRadius: "0.5rem",
      border: "1px solid #E5E7EB",
      cursor: "pointer",
      "&:focus": {
        borderColor: "#4F46E5",
        outline: "none"
      }
    }
  };

  useEffect(() => {
    // Clear any selected task and URL parameters if user is not authenticated
    if (!user) {
      setSelectedPunchlist(null);
      setInitialItemId(null);
      const returnUrl = `${location.pathname}${location.search}${location.hash}`;
      navigate(`/organization/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    const fetchPunchlists = async () => {
      if (!id) return;
      try {
        const punchlistsRef = collection(db, `churches/${id}/punchlists`);
        const q = query(punchlistsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const punchlistsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setPunchlists(punchlistsData);

        // If there's an item ID in the URL, show that item's details
        const itemId = searchParams.get('item');
        if (itemId) {
          const item = punchlistsData.find(p => p.id === itemId);
          if (item) {
            setSelectedPunchlist(item);
          }
        }
      } catch (err) {
        console.error('Error fetching punchlists:', err);
        toast.error('Failed to load punchlists');
      }
    };

    fetchPunchlists();
  }, [user, id, navigate, location, searchParams]);

  useEffect(() => {
    const fetchRooms = async () => {
      if (!id) return;
      try {
        const roomsCollection = collection(db, `churches/${id}/rooms`);
        const roomsSnapshot = await getDocs(roomsCollection);
        const roomsData = roomsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setRooms(roomsData);
      } catch (err) {
        console.error("Error fetching rooms:", err);
        toast.error("Failed to load rooms");
      }
    };

    const fetchUsers = async () => {
      try {
        const usersRef = collection(db, "users");
        const snapshot = await getDocs(usersRef);
        const usersData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAvailableUsers(usersData);
      } catch (err) {
        console.error('Error fetching users:', err);
        toast.error('Failed to load users');
      }
    };

    fetchRooms();
    fetchUsers();
  }, [id]);

  useEffect(() => {
    const baseUrl = window.location.origin;
    const currentPath = location.pathname;
    const fullUrl = `${baseUrl}${currentPath}`;
    setQrValue(fullUrl);
  }, [location]);

  useEffect(() => {
    const fetchChurchData = async () => {
      try {
        const churchRef = doc(db, 'churches', id);
        const churchSnap = await getDoc(churchRef);
        if (churchSnap.exists()) {
          setChurch(churchSnap.data());
        }
      } catch (error) {
        console.error('Error fetching church:', error);
      }
    };

    fetchChurchData();
  }, [id]);

  useEffect(() => {
    if (selectedPunchlist) {
      // Update URL without navigating
      const newUrl = `${location.pathname}?item=${selectedPunchlist.id}`;
      window.history.pushState({}, '', newUrl);
    } else if (!initialItemId) {
      // Remove item parameter if there's no selected task and it wasn't in initial URL
      const newUrl = location.pathname;
      window.history.pushState({}, '', newUrl);
    }
  }, [selectedPunchlist, location.pathname, initialItemId]);

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files);
    const validFiles = files.filter(file => file.size <= 5 * 1024 * 1024); // 5MB limit
    
    if (validFiles.length !== files.length) {
      toast.error('Some images were skipped because they exceed 5MB');
    }
    
    setSelectedImages(prev => [...prev, ...validFiles]);
    
    // Generate previews
    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviewUrls(prev => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddPunchlist = async (e) => {
    e.preventDefault();
    if (!punchlistForm.title.trim() || !punchlistForm.type) {
      toast.error('Title and type are required');
      return;
    }

    try {
      const punchlistsRef = collection(db, `churches/${id}/punchlists`);
      const imageUrls = [...(punchlistForm.images || [])];

      if (selectedImages.length > 0) {
        for (const image of selectedImages) {
          if (image.size > 5 * 1024 * 1024) {
            toast.error(`Image ${image.name} is too large. Maximum size is 5MB`);
            continue;
          }

          const storageRef = ref(storage, `churches/${id}/punchlists/${Date.now()}_${image.name}`);
          const uploadTask = await uploadBytes(storageRef, image);
          const url = await getDownloadURL(uploadTask.ref);
          imageUrls.push(url);
        }
      }

      await addDoc(punchlistsRef, {
        ...punchlistForm,
        images: imageUrls,
        createdAt: new Date(),
        createdBy: user.email,
        comments: [],
        status: punchlistForm.status || 'open'  // Ensure consistent status value
      });

      setPunchlistForm({
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
        quotes: [],
      });
      setSelectedImages([]);
      setImagePreviewUrls([]);
      setIsAddingPunchlist(false);
      
      const snapshot = await getDocs(query(punchlistsRef, orderBy('createdAt', 'desc')));
      setPunchlists(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      
      toast.success('Punchlist item added successfully!');
    } catch (err) {
      console.error('Error adding punchlist:', err);
      toast.error('Failed to add punchlist item');
    }
  };

  const handleUpdatePunchlist = async (punchlistId) => {
    try {
      const punchlistRef = doc(db, `churches/${id}/punchlists`, punchlistId);
      const imageUrls = [...(punchlistForm.images || [])];

      if (selectedImages.length > 0) {
        for (const image of selectedImages) {
          const storageRef = ref(storage, `churches/${id}/punchlists/${Date.now()}_${image.name}`);
          const uploadTask = await uploadBytes(storageRef, image);
          const url = await getDownloadURL(uploadTask.ref);
          imageUrls.push(url);
        }
      }

      await updateDoc(punchlistRef, {
        ...punchlistForm,
        images: imageUrls,
        updatedAt: new Date()
      });

      const snapshot = await getDocs(query(collection(db, `churches/${id}/punchlists`), orderBy('createdAt', 'desc')));
      setPunchlists(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      resetForm();
      setEditingPunchlist(null);
      toast.success('Punchlist item updated successfully!');
    } catch (err) {
      console.error('Error updating punchlist:', err);
      toast.error('Failed to update punchlist item');
    }
  };

  const handleDeletePunchlist = async (punchlistId) => {
    if (!window.confirm('Are you sure you want to delete this punchlist item?')) return;

    try {
      const punchlistRef = doc(db, `churches/${id}/punchlists`, punchlistId);
      const punchlistDoc = await getDoc(punchlistRef);

      if (punchlistDoc.exists() && punchlistDoc.data().images?.length > 0) {
        for (const imageUrl of punchlistDoc.data().images) {
          try {
            const imageRef = ref(storage, imageUrl);
            await deleteObject(imageRef);
          } catch (imageErr) {
            console.error('Error deleting image:', imageErr);
          }
        }
      }

      await deleteDoc(punchlistRef);
      setPunchlists(punchlists.filter(item => item.id !== punchlistId));
      toast.success('Punchlist item deleted successfully!');
    } catch (err) {
      console.error('Error deleting punchlist:', err);
      toast.error('Failed to delete punchlist item');
    }
  };

  const handleDeleteImage = async (punchlistId, imageUrl) => {
    try {
      const imageRef = ref(storage, imageUrl);
      await deleteObject(imageRef);
      
      const punchlistRef = doc(db, `churches/${id}/punchlists`, punchlistId);
      const punchlist = punchlists.find(p => p.id === punchlistId);
      
      if (punchlist) {
        const updatedImages = punchlist.images.filter(url => url !== imageUrl);
        await updateDoc(punchlistRef, { images: updatedImages });
        setPunchlists(punchlists.map(item =>
          item.id === punchlistId ? { ...item, images: updatedImages } : item
        ));
      }
      
      toast.success('Image deleted successfully');
    } catch (err) {
      console.error('Error deleting image:', err);
      toast.error('Failed to delete image');
    }
  };

  const handleDeleteComment = async (punchlistId, commentTimestamp) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;
    
    try {
      const punchlistRef = doc(db, `churches/${id}/punchlists`, punchlistId);
      const punchlist = punchlists.find(p => p.id === punchlistId);
      
      if (punchlist) {
        const updatedComments = punchlist.comments.filter(c => c.timestamp !== commentTimestamp);
        await updateDoc(punchlistRef, { comments: updatedComments });
        setPunchlists(punchlists.map(item =>
          item.id === punchlistId ? { ...item, comments: updatedComments } : item
        ));
        toast.success('Comment deleted successfully');
      }
    } catch (err) {
      console.error('Error deleting comment:', err);
      toast.error('Failed to delete comment');
    }
  };

  const handleEditComment = async (punchlistId, commentTimestamp, newText) => {
    try {
      const punchlistRef = doc(db, `churches/${id}/punchlists`, punchlistId);
      const punchlist = punchlists.find(p => p.id === punchlistId);
      
      if (punchlist) {
        const updatedComments = punchlist.comments.map(c => 
          c.timestamp === commentTimestamp ? { ...c, text: newText, edited: true } : c
        );
        await updateDoc(punchlistRef, { comments: updatedComments });
        setPunchlists(punchlists.map(item =>
          item.id === punchlistId ? { ...item, comments: updatedComments } : item
        ));
        toast.success('Comment updated successfully');
      }
    } catch (err) {
      console.error('Error updating comment:', err);
      toast.error('Failed to update comment');
    }
  };

  const handleAddQuote = () => {
    if (!quoteForm.contractor.trim() || quoteForm.amount <= 0) {
      toast.error("Contractor name and amount are required");
      return;
    }

    // Initialize newQuotes as an empty array if punchlistForm.quotes is undefined or null
    const newQuotes = punchlistForm.quotes ? [...punchlistForm.quotes] : [];
    
    if (editingQuote !== null) {
      // Update existing quote
      newQuotes[editingQuote] = quoteForm;
    } else {
      // Add new quote
      newQuotes.push({...quoteForm, id: Date.now().toString()});
    }
    
    setPunchlistForm({...punchlistForm, quotes: newQuotes});
    setQuoteForm({
      contractor: "",
      amount: 0,
      description: "",
      date: new Date().toISOString().split("T")[0],
      status: "pending"
    });
    setEditingQuote(null);
  };

  const handleEditQuote = (index) => {
    setEditingQuote(index);
    setQuoteForm({...punchlistForm.quotes[index]});
  };

  const handleDeleteQuote = (index) => {
    const newQuotes = [...punchlistForm.quotes];
    newQuotes.splice(index, 1);
    setPunchlistForm({...punchlistForm, quotes: newQuotes});
  };

  const resetForm = () => {
    setPunchlistForm({
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
      quotes: [],
    });
    setSelectedImages([]);
    setImagePreviewUrls([]);
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return 'N/A';
    try {
      const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
      return isNaN(date.getTime()) ? 'N/A' : format(date, 'MMM dd, yyyy');
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'N/A';
    }
  };

  const addImageToPDF = async (imageUrl, doc, x, y, maxWidth, maxHeight) => {
    return new Promise(async (resolve) => {
      try {
        // Extract storage path and reference
        const urlPath = decodeURIComponent(imageUrl.split('/o/')[1].split('?')[0]);
        const storageRef = ref(storage, urlPath);

        // Get fresh download URL
        const freshUrl = await getDownloadURL(storageRef);

        // Fetch image with proper headers
        const response = await fetch(freshUrl, {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Access-Control-Allow-Origin': '*'
          }
        });

        // Convert response to blob
        const blob = await response.blob();

        // Create object URL from blob
        const objectUrl = URL.createObjectURL(blob);

        // Create and load image
        const img = new Image();
        img.crossOrigin = 'anonymous';

        // Create promise to handle image loading
        await new Promise((resolveImage) => {
          img.onload = () => {
            try {
              // Create canvas
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              
              // Draw image to canvas
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              
              // Get base64 data
              const imgData = canvas.toDataURL('image/jpeg', 0.8);
              
              // Calculate dimensions
              let finalWidth = maxWidth;
              let finalHeight = maxHeight;
              const aspectRatio = img.width / img.height;
              
              if (aspectRatio > 1) {
                finalHeight = finalWidth / aspectRatio;
              } else {
                finalWidth = finalHeight * aspectRatio;
              }
              
              // Add to PDF
              doc.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight, undefined, 'FAST');
              
              // Clean up
              URL.revokeObjectURL(objectUrl);
              resolveImage();
            } catch (err) {
              console.error('Error processing canvas:', err);
              URL.revokeObjectURL(objectUrl);
              resolveImage();
            }
          };

          img.onerror = (err) => {
            console.error('Error loading image:', err);
            URL.revokeObjectURL(objectUrl);
            resolveImage();
          };

          // Start loading image
          img.src = objectUrl;
        });

        resolve(maxHeight);
      } catch (error) {
        console.error('Error in addImageToPDF:', error);
        resolve(0);
      }
    });
  };

  const exportToPDF = async () => {
    try {
      const toastId = toast.loading('Preparing PDF...', { autoClose: false });
      const doc = new jsPDF();
      
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      doc.setTextColor(255);
      doc.setFontSize(24);
      doc.text('Maintenance Punchlist Report', 15, 25);
      
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);
      doc.text(`Total Items: ${filteredPunchlists.length}`, doc.internal.pageSize.width - 60, 35);
      
      let yOffset = 50;

      doc.setTextColor(31, 41, 55);
      doc.setFontSize(16);
      doc.text('Summary', 15, yOffset);
      yOffset += 15;

      const statusCounts = filteredPunchlists.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});

      doc.setFontSize(12);
      doc.text('Status Distribution:', 15, yOffset);
      yOffset += 10;

      doc.setFontSize(10);
      Object.entries(statusCounts).forEach(([status, count]) => {
        doc.text(`${status.toUpperCase()}: ${count} items`, 25, yOffset);
        yOffset += 8;
      });
      yOffset += 10;

      const priorityCounts = filteredPunchlists.reduce((acc, item) => {
        acc[item.priority] = (acc[item.priority] || 0) + 1;
        return acc;
      }, {});

      doc.setFontSize(12);
      doc.text('Priority Distribution:', 15, yOffset);
      yOffset += 10;

      doc.setFontSize(10);
      Object.entries(priorityCounts).forEach(([priority, count]) => {
        doc.text(`${priority.toUpperCase()}: ${count} items`, 25, yOffset);
        yOffset += 8;
      });
      yOffset += 10;

      const totalMaterialCost = filteredPunchlists.reduce((sum, item) => sum + (parseFloat(item.materialCost) || 0), 0);
      const totalLaborCost = filteredPunchlists.reduce((sum, item) => sum + (parseFloat(item.laborCost) || 0), 0);
      const totalCost = totalMaterialCost + totalLaborCost;

      doc.setFontSize(12);
      doc.text('Cost Summary:', 15, yOffset);
      yOffset += 10;

      doc.setFontSize(10);
      doc.text(`Total Material Cost: $${totalMaterialCost.toFixed(2)}`, 25, yOffset);
      yOffset += 8;
      doc.text(`Total Labor Cost: $${totalLaborCost.toFixed(2)}`, 25, yOffset);
      yOffset += 8;
      doc.text(`Total Cost: $${totalCost.toFixed(2)}`, 25, yOffset);
      yOffset += 20;

      if (filters.priority !== 'all' || filters.type !== 'all' || filters.status !== 'all' || punchlistSearchTerm) {
        doc.setFillColor(243, 244, 246);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 25, 'F');
        doc.setTextColor(75, 85, 99);
        doc.setFontSize(10);
        doc.text('Applied Filters:', 20, yOffset + 7);
        
        let filterText = [];
        if (filters.priority !== 'all') filterText.push(`Priority: ${filters.priority}`);
        if (filters.type !== 'all') filterText.push(`Type: ${filters.type}`);
        if (filters.status !== 'all') filterText.push(`Status: ${filters.status}`);
        if (punchlistSearchTerm) filterText.push(`Search: "${punchlistSearchTerm}"`);
        
        doc.text(filterText.join(' | '), 20, yOffset + 17);
      }

      const statusColors = {
        'open': { bg: [239, 68, 68], text: [255, 255, 255] },
        'in_progress': { bg: [245, 158, 11], text: [255, 255, 255] },
        'completed': { bg: [16, 185, 129], text: [255, 255, 255] }
      };

      const statusGroups = {
        'open': filteredPunchlists.filter(item => item.status === 'open'),
        'in_progress': filteredPunchlists.filter(item => item.status === 'in_progress'),
        'completed': filteredPunchlists.filter(item => item.status === 'completed')
      };

      let processedItems = 0;
      const totalItems = filteredPunchlists.length;

      for (const [status, items] of Object.entries(statusGroups)) {
        if (items.length === 0) continue;

        doc.addPage();
        yOffset = 20;

        const statusColor = statusColors[status] || { bg: [79, 70, 229], text: [255, 255, 255] };
        doc.setFillColor(...statusColor.bg);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 10, 'F');
        doc.setTextColor(...statusColor.text);
        doc.setFontSize(14);
        doc.text(status.toUpperCase().replace('_', ' '), 20, yOffset + 7);
        yOffset += 20;

        for (const item of items) {
          processedItems++;
          const progress = Math.round((processedItems / totalItems) * 100);
          toast.update(toastId, { 
            render: `Generating PDF... ${progress}%`,
          });

          doc.setFillColor(243, 244, 246);
          doc.rect(15, yOffset - 5, doc.internal.pageSize.width - 30, 12, 'F');
          doc.setTextColor(31, 41, 55);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text(`#${processedItems} - ${item.title}`, 20, yOffset + 3);
          doc.setFont(undefined, 'normal');
          yOffset += 15;

          if (item.description) {
            doc.setFontSize(10);
            doc.setTextColor(75, 85, 99);
            const descriptionLines = doc.splitTextToSize(item.description, doc.internal.pageSize.width - 40);
            doc.text(descriptionLines, 20, yOffset);
            yOffset += (descriptionLines.length * 5) + 10;
          }

          if (item.images && item.images.length > 0) {
            yOffset += 5;
            const imageWidth = 50;
            const imageHeight = 50;
            const imagesPerRow = 3;
            const margin = 5;

            for (let i = 0; i < Math.min(3, item.images.length); i++) {
              try {
                const xPos = 20 + (i * (imageWidth + margin));
                await addImageToPDF(item.images[i], doc, xPos, yOffset, imageWidth, imageHeight);
              } catch (error) {
                console.error('Error adding image to PDF:', error);
              }
            }

            if (item.images.length > 3) {
              doc.setFontSize(8);
              doc.setTextColor(107, 114, 128);
              doc.text(`+ ${item.images.length - 3} more images`, 20, yOffset + imageHeight + 5);
            }

            yOffset += imageHeight + 15;
          }

          const detailsY = yOffset;
          doc.setFillColor(243, 244, 246);
          doc.roundedRect(20, detailsY, doc.internal.pageSize.width - 40, 40, 2, 2, 'F');

          doc.setFontSize(9);
          doc.setTextColor(75, 85, 99);

          const details = [
            [`Type: ${item.type || 'N/A'}`, `Priority: ${item.priority || 'N/A'}`, `Status: ${item.status || 'N/A'}`],
            [`Progress: ${item.progress || 0}%`, `Man-days: ${item.mandays || 0}`, `Assigned To: ${item.assignedTo?.email || item.assignedTo || 'Unassigned'}`],
            [`Material Cost: $${parseFloat(item.materialCost || 0).toFixed(2)}`, 
             `Labor Cost: $${parseFloat(item.laborCost || 0).toFixed(2)}`, 
             `Total: $${(parseFloat(item.materialCost || 0) + parseFloat(item.laborCost || 0)).toFixed(2)}`]
          ];

          details.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
              const xPos = 25 + (colIndex * Math.floor((doc.internal.pageSize.width - 50) / 3));
              doc.text(cell, xPos, detailsY + 12 + (rowIndex * 12));
            });
          });

          yOffset = detailsY + 50;

          if (yOffset > doc.internal.pageSize.height - 60) {
            doc.addPage();
            yOffset = 20;
          }
        }
      }

      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }

      toast.update(toastId, { 
        render: 'Finalizing PDF...',
      });
      
      let filename = 'maintenance-punchlist';
      if (filters.priority !== 'all' || filters.type !== 'all' || filters.status !== 'all') {
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

  const handleExportQRPDF = async () => {
    try {
      const toastId = toast.loading('Generating QR Code PDF...', { autoClose: false });
      
      const doc = new jsPDF();
      
      doc.setFontSize(24);
      doc.setTextColor(79, 70, 229);
      doc.text('Maintenance Page QR Code', 20, 30);
      
      doc.setFontSize(12);
      doc.setTextColor(75, 85, 99);
      doc.text('Scan this QR code to access the maintenance page:', 20, 50);
      doc.text(`URL: ${qrValue}`, 20, 60);
      doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, 20, 70);
      
      const qrCanvas = document.createElement('canvas');
      const qrContext = qrCanvas.getContext('2d');
      const svgElement = document.querySelector('.qr-code-svg');
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const img = new Image();
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
      });
      
      qrCanvas.width = img.width;
      qrCanvas.height = img.height;
      qrContext.drawImage(img, 0, 0);
      
      const qrImage = qrCanvas.toDataURL('image/png');
      doc.addImage(qrImage, 'PNG', 70, 90, 70, 70);
      
      doc.setFontSize(10);
      doc.text('Instructions:', 20, 180);
      doc.text('1. Open your smartphone camera or QR code scanner app', 30, 190);
      doc.text('2. Point the camera at the QR code above', 30, 200);
      doc.text('3. Click the link that appears to access the maintenance page', 30, 210);
      
      doc.save('maintenance-page-qr.pdf');
      
      toast.update(toastId, {
        render: 'QR Code PDF generated successfully!',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error generating QR PDF:', error);
      toast.error('Failed to generate QR Code PDF');
    }
  };

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
  });

  const QRDetailModal = ({ onClose }) => (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '8px',
        maxWidth: '500px',
        width: '90%'
      }}>
        <h3 style={{ marginTop: 0 }}>Maintenance Page QR Code</h3>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <QRCodeSVG 
            value={qrValue} 
            size={200} 
            level="H"
            className="qr-code-svg"
          />
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <p><strong>URL:</strong> {qrValue}</p>
          <p><strong>Generated:</strong> {format(new Date(), 'MMM dd, yyyy HH:mm')}</p>
          <p>Scan this QR code with your smartphone camera or QR code scanner app to quickly access the maintenance page.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={handleExportQRPDF}
            style={{
              ...styles.button,
              backgroundColor: '#2563eb'
            }}
          >
            Export QR to PDF
          </button>
          <button
            onClick={onClose}
            style={{
              ...styles.button,
              backgroundColor: '#6B7280'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  const getPunchlistUrl = (punchlistId) => {
    // Generate an absolute URL that includes the item parameter
    return `${window.location.origin}/organization/${id}/maintenance?item=${punchlistId}`;
  };

  const DetailModal = ({ item, onClose }) => {
    if (!item) return null;

    const qrValue = getPunchlistUrl(item.id);

    return (
      <div style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          width: '90%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>{item.title}</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem' }}>
              ×
            </button>
          </div>

          <div style={{ 
            padding: '20px',
            backgroundColor: '#F9FAFB',
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <h3 style={{ marginBottom: '16px' }}>Punchlist QR Code</h3>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '32px'
            }}>
              <div style={{
                backgroundColor: 'white',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid #E5E7EB'
              }}>
                <QRCodeSVG value={qrValue} size={256} />
              </div>
              
              <div>
                <p style={{ marginBottom: '8px' }}>Scan this QR code to quickly access this punchlist item's details.</p>
                <PDFDownloadLink
                  document={<TaskQRLabel task={item} qrUrl={getPunchlistUrl(item.id)} church={church} />}
                  fileName={`${item.title.replace(/\s+/g, '-').toLowerCase()}-qr-label.pdf`}
                  style={{
                    display: 'inline-block',
                    padding: '8px 16px',
                    backgroundColor: '#4F46E5',
                    color: 'white',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    fontSize: '14px'
                  }}
                >
                  {({ blob, url, loading, error }) =>
                    loading ? 'Preparing PDF...' : '📄 Download QR Label PDF'
                  }
                </PDFDownloadLink>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <span style={{
              padding: '8px 16px',
              borderRadius: '9999px',
              fontSize: '0.875rem',
              fontWeight: '500',
              marginRight: '8px',
              backgroundColor: getPriorityColor(item.priority) + '20',
              color: getPriorityColor(item.priority)
            }}>
              {item.priority.toUpperCase()}
            </span>
            <span style={{
              padding: '8px 16px',
              borderRadius: '9999px',
              fontSize: '0.875rem',
              fontWeight: '500',
              backgroundColor: '#E5E7EB',
              color: '#374151'
            }}>
              {item.status.toUpperCase()}
            </span>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <p style={{ whiteSpace: 'pre-wrap' }}>{item.description}</p>
          </div>

          {item.assignedTo && (
            <div style={{ marginBottom: '20px' }}>
              <strong>Assigned to:</strong> {item.assignedTo}
            </div>
          )}

          {item.images && item.images.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h3>Images</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                {item.images.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`Punchlist item ${index + 1}`}
                    style={{
                      width: '100%',
                      height: '200px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      setCurrentImage(url);
                      setIsOpen(true);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button 
              onClick={() => {
                setEditingPunchlist(item);
                setPunchlistForm({...item});
                onClose();
              }}
              style={{ 
                padding: '8px 16px',
                backgroundColor: '#4F46E5',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Edit Item
            </button>
          </div>
        </div>
      </div>
    );
  };

  const PunchlistItem = ({ item, index }) => {
    const [showCommentBox, setShowCommentBox] = useState(false);
    const [comment, setComment] = useState('');
    const [editingComment, setEditingComment] = useState(null);
    const [editedCommentText, setEditedCommentText] = useState('');

    const handleAddComment = async () => {
      if (!comment.trim()) return;
      
      try {
        const punchlistRef = doc(db, `churches/${id}/punchlists`, item.id);
        const newComment = {
          text: comment,
          author: user.email,
          timestamp: new Date().toISOString()
        };
        
        await updateDoc(punchlistRef, {
          comments: arrayUnion(newComment)
        });

        const snapshot = await getDocs(query(collection(db, `churches/${id}/punchlists`), orderBy('createdAt', 'desc')));
        setPunchlists(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        
        setComment('');
        setShowCommentBox(false);
        toast.success('Comment added successfully');
      } catch (err) {
        console.error('Error adding comment:', err);
        toast.error('Failed to add comment');
      }
    };

    const handleImageClick = (imageUrl) => {
      setCurrentImage(imageUrl);
      setIsOpen(true);
    };

    return (
      <div style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1.5rem",
        marginBottom: "1rem",
        backgroundColor: "white",
        boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        cursor: "pointer"
      }}
      onClick={() => setSelectedPunchlist(item)}
      >
        <div style={{
          display: "flex",
          flexDirection: window.innerWidth < 768 ? "column" : "row",
          gap: "1rem"
        }}>
          <div style={{ 
            flexShrink: 0, 
            fontSize: "1.25rem", 
            fontWeight: "600",
            color: "#4F46E5",
            minWidth: "2rem"
          }}>
            #{index + 1}
          </div>

          <div style={{ flex: window.innerWidth < 768 ? "1" : "0 0 200px" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
              gap: "0.5rem",
              marginBottom: window.innerWidth < 768 ? "1rem" : "0"
            }}>
              {item.images?.map((url, imgIndex) => (
                <div 
                  key={imgIndex}
                  onClick={() => handleImageClick(url)}
                  style={{ cursor: "pointer" }}
                >
                  <img 
                    src={url} 
                    alt={`Image ${imgIndex + 1}`}
                    style={{
                      width: "100%",
                      height: "100px",
                      objectFit: "cover",
                      borderRadius: "4px"
                    }}
                  />
                </div>
              ))}
              {!item.images?.length && (
                <div style={{ 
                  height: "100px",
                  backgroundColor: "#f3f4f6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "4px"
                }}>
                  No Images
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div>
                <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem" }}>{item.title}</h3>
                <p style={{ margin: "0", color: "#6B7280" }}>{item.description}</p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button 
                  onClick={() => {
                    setEditingPunchlist(item);
                    setPunchlistForm({
                      ...item,
                      images: item.images || []
                    });
                  }}
                  style={{
                    ...styles.button,
                    ...styles.editButton
                  }}
                >
                  Edit
                </button>
                <button 
                  onClick={() => handleDeletePunchlist(item.id)}
                  style={{
                    ...styles.button,
                    ...styles.deleteButton
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: window.innerWidth < 768 
                ? "repeat(2, 1fr)" 
                : "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "1rem",
              padding: "1rem",
              backgroundColor: "#F9FAFB",
              borderRadius: "0.5rem",
              marginBottom: "1rem"
            }}>
              <DetailItem label="Type" value={item.type} />
              <DetailItem label="Priority" value={item.priority} />
              <DetailItem label="Status" value={item.status} />
              <DetailItem label="Progress" value={`${item.progress}%`} />
              <DetailItem label="Material Cost" value={`$${item.materialCost}`} />
              <DetailItem label="Labor Cost" value={`$${item.laborCost}`} />
              <DetailItem label="Man-days" value={item.mandays} />
            </div>

            <div style={{ marginTop: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h4 style={{ margin: 0 }}>Comments ({item.comments?.length || 0})</h4>
                <button
                  onClick={() => setShowCommentBox(!showCommentBox)}
                  style={{
                    ...styles.button
                  }}
                >
                  Add Comment
                </button>
              </div>

              {showCommentBox && (
                <div style={{ marginBottom: "1rem" }}>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    style={{ ...styles.formControl, minHeight: "80px" }}
                    placeholder="Write your comment..."
                  />
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setShowCommentBox(false)}
                      style={{
                        ...styles.button,
                        ...styles.cancelButton
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddComment}
                      style={{
                        ...styles.button,
                        ...styles.successButton
                      }}
                    >
                      Post Comment
                    </button>
                  </div>
                </div>
              )}

              {item.comments?.map((comment, i) => (
                <div key={i} style={{
                  padding: "1rem",
                  backgroundColor: "#F9FAFB",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem",
                  position: "relative"
                }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "0.5rem",
                    fontSize: "0.875rem",
                    color: "#6B7280"
                  }}>
                    <span>{comment.author}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span>{new Date(comment.timestamp).toLocaleString()}</span>
                      {comment.edited && (
                        <span style={{ fontSize: "0.75rem", fontStyle: "italic" }}>(edited)</span>
                      )}
                      {user.email === comment.author && (
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            onClick={() => {
                              setEditingComment(comment);
                              setEditedCommentText(comment.text);
                            }}
                            style={{
                              ...styles.smallButton,
                              ...styles.editButton
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteComment(item.id, comment.timestamp)}
                            style={{
                              ...styles.smallButton,
                              ...styles.deleteButton
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {editingComment?.timestamp === comment.timestamp ? (
                    <div style={{ marginTop: "0.5rem" }}>
                      <textarea
                        value={editedCommentText}
                        onChange={(e) => setEditedCommentText(e.target.value)}
                        style={{
                          ...styles.formControl,
                          minHeight: "60px"
                        }}
                      />
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => setEditingComment(null)}
                          style={{
                            ...styles.button,
                            ...styles.cancelButton
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            handleEditComment(item.id, comment.timestamp, editedCommentText);
                            setEditingComment(null);
                          }}
                          style={{
                            ...styles.button,
                            ...styles.successButton
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: 0 }}>{comment.text}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const DetailItem = ({ label, value }) => (
    <div>
      <span style={{ color: "#6B7280", fontSize: "0.875rem" }}>{label}: </span>
      <span style={{ fontWeight: "500" }}>{value}</span>
    </div>
  );

  const renderPunchlistForm = () => (
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
      zIndex: 1000
    }}>
      <div style={{ 
        backgroundColor: "white", 
        padding: "2rem", 
        borderRadius: "8px", 
        width: "90%", 
        maxWidth: "800px",
        maxHeight: "90vh",
        overflow: "auto"
      }}>
        <h2>{editingPunchlist ? 'Edit Punchlist Item' : 'Add New Punchlist Item'}</h2>
        <form onSubmit={editingPunchlist ? () => handleUpdatePunchlist(editingPunchlist.id) : handleAddPunchlist}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <label>Title *</label>
              <input
                type="text"
                value={punchlistForm.title}
                onChange={e => setPunchlistForm(prev => ({ ...prev, title: e.target.value }))}
                style={styles.formControl}
                required
              />
            </div>

            <div>
              <label>Type *</label>
              <select
                value={punchlistForm.type}
                onChange={e => setPunchlistForm(prev => ({ ...prev, type: e.target.value }))}
                style={styles.formControl}
                required
              >
                <option value="">Select Type</option>
                {maintenanceTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label>Priority</label>
              <select
                value={punchlistForm.priority}
                onChange={e => setPunchlistForm(prev => ({ ...prev, priority: e.target.value }))}
                style={styles.formControl}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <label>Status</label>
              <select
                value={punchlistForm.status}
                onChange={e => setPunchlistForm(prev => ({ ...prev, status: e.target.value }))}
                style={styles.formControl}
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="on_hold">On Hold</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="pending_materials">Pending Materials</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_review">In Review</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label>Material Cost ($)</label>
              <input
                type="number"
                value={punchlistForm.materialCost}
                onChange={e => setPunchlistForm(prev => ({ 
                  ...prev, 
                  materialCost: parseFloat(e.target.value) || 0 
                }))}
                min="0"
                step="0.01"
                style={styles.formControl}
              />
            </div>

            <div>
              <label>Labor Cost ($)</label>
              <input
                type="number"
                value={punchlistForm.laborCost}
                onChange={e => setPunchlistForm(prev => ({ 
                  ...prev, 
                  laborCost: parseFloat(e.target.value) || 0 
                }))}
                min="0"
                step="0.01"
                style={styles.formControl}
              />
            </div>

            <div>
              <label>Man-days</label>
              <input
                type="number"
                value={punchlistForm.mandays}
                onChange={e => setPunchlistForm(prev => ({ 
                  ...prev, 
                  mandays: parseFloat(e.target.value) || 0 
                }))}
                min="0"
                step="0.5"
                style={styles.formControl}
              />
            </div>

            <div>
              <label>Progress (%)</label>
              <input
                type="number"
                value={punchlistForm.progress}
                onChange={e => setPunchlistForm(prev => ({ 
                  ...prev, 
                  progress: Math.min(100, Math.max(0, parseInt(e.target.value) || 0))
                }))}
                min="0"
                max="100"
                style={styles.formControl}
              />
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Description</label>
            <textarea
              value={punchlistForm.description}
              onChange={e => setPunchlistForm(prev => ({ ...prev, description: e.target.value }))}
              style={{ ...styles.formControl, minHeight: "100px" }}
            />
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Assign To</label>
            <Select
              value={availableUsers.find(user => user.email === punchlistForm.assignedTo)}
              onChange={selected => setPunchlistForm(prev => ({ 
                ...prev, 
                assignedTo: selected ? selected.email : '' 
              }))}
              options={availableUsers.map(user => ({
                value: user.email,
                label: `${user.name} ${user.lastName}`
              }))}
              isClearable
            />
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Select Rooms</label>
            <Select
              isMulti
              value={rooms.filter(room => punchlistForm.rooms.includes(room.id))
                .map(room => ({ value: room.id, label: room.name }))}
              onChange={selected => {
                const roomIds = selected ? selected.map(option => option.value) : [];
                setPunchlistForm(prev => ({ ...prev, rooms: roomIds }));
              }}
              options={rooms.map(room => ({
                value: room.id,
                label: room.name
              }))}
            />
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Images</label>
            <div style={{ marginBottom: "1rem" }}>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageSelect}
                style={{ marginBottom: "1rem" }}
              />
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: "1rem",
                marginTop: "1rem"
              }}>
                {editingPunchlist?.images?.map((url, index) => (
                  <div key={`existing-${index}`} style={{ position: "relative" }}>
                    <img
                      src={url}
                      alt={`Existing ${index + 1}`}
                      style={{
                        width: "100%",
                        height: "150px",
                        objectFit: "cover",
                        borderRadius: "4px"
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteImage(editingPunchlist.id, url)}
                      style={{
                        position: "absolute",
                        top: "5px",
                        right: "5px",
                        backgroundColor: "#EF4444",
                        color: "white",
                        border: "none",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {imagePreviewUrls.map((url, index) => (
                  <div key={`preview-${index}`} style={{ position: "relative" }}>
                    <img
                      src={url}
                      alt={`Preview ${index + 1}`}
                      style={{
                        width: "100%",
                        height: "150px",
                        objectFit: "cover",
                        borderRadius: "4px"
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      style={{
                        position: "absolute",
                        top: "5px",
                        right: "5px",
                        backgroundColor: "#EF4444",
                        color: "white",
                        border: "none",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Contractor Quotes</label>
            <div style={{ marginBottom: "1rem" }}>
              {(punchlistForm.quotes || []).map((quote, index) => (
                <div key={quote.id} style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  alignItems: "center", 
                  padding: "0.5rem", 
                  border: "1px solid #E5E7EB", 
                  borderRadius: "4px", 
                  marginBottom: "0.5rem" 
                }}>
                  <div>
                    <strong>{quote.contractor}</strong> - ${quote.amount} ({quote.status})
                    <p style={{ margin: 0 }}>{quote.description}</p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() => handleEditQuote(index)}
                      style={{
                        ...styles.smallButton,
                        ...styles.editButton
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteQuote(index)}
                      style={{
                        ...styles.smallButton,
                        ...styles.deleteButton
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <input
                type="text"
                placeholder="Contractor Name"
                value={quoteForm.contractor}
                onChange={e => setQuoteForm(prev => ({ ...prev, contractor: e.target.value }))}
                style={styles.formControl}
              />
              <input
                type="number"
                placeholder="Amount ($)"
                value={quoteForm.amount}
                onChange={e => setQuoteForm(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                style={styles.formControl}
              />
              <textarea
                placeholder="Description"
                value={quoteForm.description}
                onChange={e => setQuoteForm(prev => ({ ...prev, description: e.target.value }))}
                style={{ ...styles.formControl, minHeight: "80px" }}
              />
              <select
                value={quoteForm.status}
                onChange={e => setQuoteForm(prev => ({ ...prev, status: e.target.value }))}
                style={styles.formControl}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <button
                type="button"
                onClick={handleAddQuote}
                style={{
                  ...styles.button,
                  ...styles.successButton
                }}
              >
                {editingQuote !== null ? 'Update Quote' : 'Add Quote'}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setEditingPunchlist(null);
                setIsAddingPunchlist(false);
              }}
              style={{
                ...styles.modalButton,
                ...styles.deleteButton
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...styles.modalButton,
                ...styles.successButton
              }}
            >
              {editingPunchlist ? 'Update' : 'Add'} Punchlist Item
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderFilters = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
      <input
        type="text"
        placeholder="Search punchlists..."
        value={punchlistSearchTerm}
        onChange={e => setPunchlistSearchTerm(e.target.value)}
        style={styles.formControl}
      />
      <select
        value={filters.priority}
        onChange={e => setFilters(prev => ({ ...prev, priority: e.target.value }))}
        style={styles.formControl}
      >
        <option value="all">All Priorities</option>
        <option value="high">High Priority</option>
        <option value="medium">Medium Priority</option>
        <option value="low">Low Priority</option>
      </select>
      <select
        value={filters.type}
        onChange={e => setFilters(prev => ({ ...prev, type: e.target.value }))}
        style={styles.formControl}
      >
        <option value="all">All Types</option>
        {maintenanceTypes.map(type => (
          <option key={type} value={type}>{type}</option>
        ))}
      </select>
      <select
        value={filters.status}
        onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}
        style={styles.formControl}
      >
        <option value="all">All Status</option>
        <option value="open">Open</option>
        <option value="in_progress">In Progress</option>
        <option value="on_hold">On Hold</option>
        <option value="pending_approval">Pending Approval</option>
        <option value="pending_materials">Pending Materials</option>
        <option value="scheduled">Scheduled</option>
        <option value="in_review">In Review</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <select
        value={filters.progress}
        onChange={e => setFilters(prev => ({ ...prev, progress: e.target.value }))}
        style={styles.formControl}
      >
        <option value="all">All Progress</option>
        <option value="not_started">Not Started (0%)</option>
        <option value="in_progress">In Progress (1-99%)</option>
        <option value="completed">Completed (100%)</option>
      </select>
    </div>
  );

  const filteredPunchlists = punchlists.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(punchlistSearchTerm.toLowerCase()) ||
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
            <h2 style={commonStyles.title}>Maintenance Management</h2>
            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                onClick={exportToPDF}
                style={{
                  ...styles.button,
                  backgroundColor: "#2563eb"
                }}
              >
                Export to PDF
              </button>
              <button
                onClick={() => setIsAddingPunchlist(true)}
                style={styles.button}
              >
                Add Punchlist Item
              </button>
            </div>
          </div>

          {renderFilters()}

          <div ref={componentRef}>
            {paginatedPunchlists.map((item, index) => (
              <PunchlistItem key={item.id} item={item} index={index} />
            ))}
          </div>

          <ReactPaginate
            pageCount={Math.ceil(filteredPunchlists.length / ITEMS_PER_PAGE)}
            pageRangeDisplayed={2}
            marginPagesDisplayed={1}
            onPageChange={({ selected }) => setCurrentPage(selected)}
            containerClassName="pagination"
            activeClassName="active"
          />

          {(isAddingPunchlist || editingPunchlist) && renderPunchlistForm()}
        </div>

        {isOpen && (
          <ImageLightbox
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            imageUrl={currentImage}
          />
        )}

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <QRCodeSVG 
            value={qrValue} 
            size={128} 
            level="H" 
            className="qr-code-svg"
          />
          <div style={{ marginTop: '1rem' }}>
            <button
              onClick={() => setShowQRDetail(true)}
              style={{
                ...styles.button,
                backgroundColor: '#4F46E5'
              }}
            >
              View QR Details
            </button>
          </div>
        </div>
      </div>
      {showQRDetail && <QRDetailModal onClose={() => setShowQRDetail(false)} />}
      {selectedPunchlist && <DetailModal item={selectedPunchlist} onClose={() => setSelectedPunchlist(null)} />}
    </div>
  );
};

export default MaintenancePage;