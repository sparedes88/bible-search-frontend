import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  db,
  storage
} from "../firebase";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  getDoc,
  query,
  where,
  deleteDoc,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { toast } from "react-toastify";
import { useAuth } from "../contexts/AuthContext";
import { getChurchData } from "../api/church";
import { FaImage } from "react-icons/fa";
import { Spinner } from "react-bootstrap";
import { MdDelete } from "react-icons/md";
import Select from "react-select";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

const AVAILABLE_PAGES = [
  { value: "bible", label: "📖 Bible" },
  { value: "mi-perfil", label: "👤 Mi Perfil" },
  { value: "chatv2", label: "💬 Chat" },
  { value: "course-categories", label: "📚 Course Categories" },
  { value: "course-subcategory", label: "📖 Course Subcategory" },
  { value: "external-link", label: "🔗 External Link" },
  { value: "category-detail", label: "📋 Category Detail" },
  { value: "subcategory-detail", label: "📑 Subcategory Detail" },
  { value: "forms", label: "📝 Forms" },
  { value: "sql-server-bridge", label: "🗄️ Database Bridge", adminOnly: true },
];

const PROCESS_CATEGORIES = [
  { value: "discipleship", label: "🎯 Discipleship" },
  { value: "leadership", label: "👥 Leadership" },
  { value: "ministry", label: "🙏 Ministry" },
  { value: "evangelism", label: "📣 Evangelism" },
  // Add more categories as needed
];

// Add webkit-specific scrollbar hiding
const horizontalScrollStyles = {
  scrollbarWidth: "none",  // Firefox
  msOverflowStyle: "none", // IE and Edge
};

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  },
  cardsContainer: {
    display: "flex",
    flexDirection: "column", // Stack cards vertically by default
    alignItems: "center",    // Center cards horizontally
    width: "100%",
    maxWidth: "800px",       // Limit maximum width
    gap: "20px",             // Space between cards
  },
  horizontalCardsContainer: {
    display: "flex",
    flexDirection: "row",    // Display cards horizontally
    overflowX: "auto",       // Enable horizontal scrolling
    width: "100%",
    maxWidth: "800px",
    gap: "20px",             // Space between cards
    paddingBottom: "16px",   // Space for scrollbar
    marginBottom: "20px",    // Space between horizontal groups
    scrollbarWidth: "none",  // Firefox
    msOverflowStyle: "none", // IE and Edge
    WebkitOverflowScrolling: "touch", // Enable smooth scrolling on iOS
    scrollSnapType: "x mandatory", // Enable snap scrolling
  },
  tallCard: {
    width: "100%",           // Full width of container
    height: "220px",         // Increased height from 180px to 220px
    borderRadius: "8px",
    backgroundSize: "cover",
    backgroundPosition: "center",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
    position: "relative",
    flexShrink: 0,           // Prevent shrinking in horizontal scroll
  },
  horizontalCard: {
    width: "280px",          // Fixed width for horizontal cards
    minWidth: "280px",       // Ensure minimum width
    height: "220px",         // Increased height from 180px to 220px
    flexShrink: 0,           // Prevent card from shrinking
  },
  controlsContainer: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "20px",
  },
  editButton: {
    padding: "8px 16px",
    backgroundColor: "#4F46E5",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "600",
  },
  addButton: {
    padding: "8px 16px",
    backgroundColor: "#10B981",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "600",
  },
  cardControls: {
    position: "absolute",
    top: "8px",
    right: "8px",
    display: "flex",
    gap: "4px",
  },
  removeButton: {
    padding: "4px 8px",
    width: "40px",
    height: "40px",
    backgroundColor: "#EF4444",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: "1",
  },
  editCardButton: {
    padding: "4px 8px",
    width: "40px",
    height: "40px",
    backgroundColor: "#F59E0B",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: "1",
  },
  imageUploadButton: {
    padding: '4px 8px',
    backgroundColor: '#3B82F6',
    width: '40px',
    height: '40px',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    overflow: "auto", // Allow scrolling
    padding: "20px 0", // Add padding for better spacing
  },
  modalContent: {
    backgroundColor: "white",
    padding: "24px",
    borderRadius: "8px",
    width: "90%",
    maxWidth: "400px",
    maxHeight: "90vh", // Set max height
    overflow: "auto", // Enable scrolling for content that exceeds max height
    margin: "auto", // Center the modal
  },
  modalTitle: {
    fontSize: "20px",
    fontWeight: "600",
    marginBottom: "16px",
    color: "#111827",
  },
  formGroup: {
    marginBottom: "16px",
    textAlign: "left",
  },
  label: {
    display: "block",
    marginBottom: "4px",
    fontSize: "14px",
    fontWeight: "500",
    color: "#374151",
  },
  input: {
    width: "100%",
    padding: "8px",
    borderRadius: "4px",
    border: "1px solid #D1D5DB",
    fontSize: "14px",
  },
  select: {
    width: "100%",
    padding: "8px",
    borderRadius: "4px",
    border: "1px solid #D1D5DB",
    fontSize: "14px",
    backgroundColor: "white",
  },
  buttonContainer: {
    width: "100%",
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "24px",
  },
  saveButton: {
    width: "100%",
    padding: "8px 16px",
    backgroundColor: "#10B981",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "500",
  },
  cancelButton: {
    width: "100%",
    padding: "8px 16px",
    backgroundColor: "#EF4444",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "500",
  },
  deleteButton: {
    width: "100%",
    padding: "8px 16px",
    backgroundColor: "#EF4444",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "500",
  },
  noCardsMessage: {
    textAlign: 'center',
    padding: '40px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    margin: '20px 0',
    color: '#6b7280',
    fontSize: '16px',
  },
  cardLabel: {
    position: 'relative',
    zIndex: 1,
    color: 'white',
    fontSize: '24px',
    fontWeight: '600',
    textShadow: '0 2px 4px rgba(0,0,0,0.5)',
    padding: '10px',
    width: '100%',
    textAlign: 'center',
    borderRadius: '4px',
    opacity: 1,                // Default visible
    transition: 'opacity 0.3s',
  },
  hiddenLabel: {
    opacity: 0,                // Hide label
  },
  orderBadge: {
    position: 'absolute',
    top: '8px',
    left: '8px',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    color: 'white',
    borderRadius: '50%',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 'bold',
  },
};

const ChurchApp = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [church, setChurch] = useState(null);
  const [clickCount, setClickCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardImageUrls, setCardImageUrls] = useState({});
  const [uploadingCardId, setUploadingCardId] = useState(null);
  const [deletingCardId, setDeletingCardId] = useState(null);
  const [courseCategories, setCourseCategories] = useState([]);
  const [forms, setForms] = useState([]);
  const [hiddenLabels, setHiddenLabels] = useState({});
  
  console.log("Cards", cards)
  
  const accessPermission =
    user?.role === "global_admin" ||
    (user?.role === "admin" && user?.churchId === id);

  const handleImageLoad = (index) => {
    setImageLoaded((prevState) => ({ ...prevState, [index]: true }));
  };

  // Function to get download URL for a card's background
  const getCardBackgroundUrl = async (card) => {
    if (!card.background || card.background.startsWith('/')) {
      return null;
    }
    try {
      const imageRef = ref(storage, card.background);
      const url = await getDownloadURL(imageRef);
      return url;
    } catch (error) {
      console.error('Error getting image URL:', error);
      return null;
    }
  };

  // Fetch quick cards from Firebase
  const fetchQuickCards = async () => {
    try {
      const churchDoc = doc(db, 'churches', id);
      const quickCardsCollection = collection(churchDoc, 'quickCards');
      const querySnapshot = await getDocs(query(quickCardsCollection, orderBy('createdAt', 'desc')));
      
      const fetchedCards = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setCards(fetchedCards);

      // Fetch image URLs for all cards
      const urlPromises = fetchedCards.map(async (card) => {
        const url = await getCardBackgroundUrl(card);
        return { id: card.id, url };
      });

      const urls = await Promise.all(urlPromises);
      const urlMap = urls.reduce((acc, { id, url }) => {
        if (url) acc[id] = url;
        return acc;
      }, {});

      setCardImageUrls(urlMap);
    } catch (error) {
      console.error('Error fetching quick cards:', error);
      setCards([]);
      toast.error('Error loading quick cards');
    }
  };

  // Save card to Firebase
  const handleSaveCard = async (cardData) => {
    try {
      const churchDoc = doc(db, 'churches', id);
      const quickCardsCollection = collection(churchDoc, 'quickCards');
      
      if (cardData.id && cardData.id !== 'new') {
        // Get existing card data to preserve createdAt
        const cardRef = doc(quickCardsCollection, cardData.id);
        const existingCard = await getDoc(cardRef);
        
        // Update existing card while preserving createdAt
        await setDoc(cardRef, {
          ...cardData,
          createdAt: existingCard.data().createdAt, // Preserve original createdAt
          updatedAt: serverTimestamp()
        });
        toast.success('Card updated successfully');
      } else {
        // Create new card
        const newCardRef = doc(quickCardsCollection);
        await setDoc(newCardRef, {
          ...cardData,
          id: newCardRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        toast.success('Card created successfully');
      }
      
      fetchQuickCards();
      setIsEditing(false);
      setEditingCard(null);
    } catch (error) {
      console.error('Error saving card:', error);
      toast.error('Error saving card');
    }
  };

  // Delete card from Firebase
  const handleDeleteCard = async (cardId) => {
    try {
      setDeletingCardId(cardId);
      const churchDoc = doc(db, 'churches', id);
      const cardRef = doc(collection(churchDoc, 'quickCards'), cardId);
      await deleteDoc(cardRef);
      toast.success('Card deleted successfully');
      fetchQuickCards();
    } catch (error) {
      console.error('Error deleting card:', error);
      toast.error('Error deleting card');
    } finally {
      setDeletingCardId(null);
    }
  };

  // Handle image upload for a specific card
  const handleImageUpload = async (event, cardId) => {
    const file = event.target.files[0];
    if (!file || !id) return;

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      toast.error("File doesn't have a valid type");
      return;
    }

    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      toast.error("File size exceeds 5MB limit");
      return;
    }

    setUploadingCardId(cardId);
    try {
      const uniqueFileName = `quick_card-${Date.now()}-${file.name}`;
      const filePath = `quick_cards/church_${id}/${uniqueFileName}`;
      const fileRef = ref(storage, filePath);

      // Get the current card data
      const churchDoc = doc(db, 'churches', id);
      const quickCardsCollection = collection(churchDoc, 'quickCards');
      const cardRef = doc(quickCardsCollection, cardId);
      const cardDoc = await getDoc(cardRef);
      const cardData = cardDoc.data();

      // Delete previous file if exists and it's not the default image
      if (cardData.background && !cardData.background.startsWith('/')) {
        const previousFileRef = ref(storage, cardData.background);
        await deleteObject(previousFileRef).catch((error) => {
          console.warn("Error deleting old file:", error);
        });
      }

      // Upload new file
      await uploadBytes(fileRef, file);
      await getDownloadURL(fileRef); // We don't need the URL as we store the path

      // Update card with new background path
      await setDoc(cardRef, {
        ...cardData,
        background: filePath,
        updatedAt: serverTimestamp()
      });

      toast.success("Image updated successfully!");
      fetchQuickCards(); // Refresh the cards list
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload image");
    } finally {
      setUploadingCardId(null);
    }
  };

  // Add fetch course categories function
  const fetchCourseCategories = async () => {
    try {
      // Fetch all course categories from Firebase
      const categoriesQuery = query(collection(db, "coursecategories"), where("churchId", "==", id));
      const querySnapshot = await getDocs(categoriesQuery);
      
      const categoriesData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setCourseCategories(categoriesData);
      console.log("Loaded course categories:", categoriesData.length);
    } catch (error) {
      console.error("Error fetching course categories:", error);
      toast.error("Failed to load course categories");
    }
  };

  // Add fetch forms function
  const fetchForms = async () => {
    try {
      // Fetch all forms from Firebase
      const formsQuery = query(collection(db, "churches", id, "forms"), orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(formsQuery);
      
      const formsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setForms(formsData);
      console.log("Loaded forms:", formsData.length);
    } catch (error) {
      console.error("Error fetching forms:", error);
      toast.error("Failed to load forms");
    }
  };

  useEffect(() => {
    const loadChurchAndCards = async () => {
      try {
        const churchData = await getChurchData(id);
        setChurch(churchData);
        await fetchQuickCards();
        setLoading(false);
      } catch (error) {
        console.error('Error:', error);
        setLoading(false);
      }
    };

    loadChurchAndCards();
  }, [id]);

  useEffect(() => {
    if (clickCount === 4) {
      navigate("/");
    }
  }, [clickCount, navigate]);

  // Update the card click handler
  const handleCardClick = (card) => {
    // Skip navigation if in edit mode
    if (isEditing) {
      return;
    }
    
    // First, let's log the card being clicked to help debug
    console.log("Card clicked:", card);
    
    // Check if we're in edit mode with sufficient click count
    if (accessPermission && clickCount >= 2) {
      setIsEditing(true);
      setEditingCard(card);
      setClickCount(0);
      return; // Add early return to prevent navigation while editing
    }
    
    // Handle navigation based on card path
    if (!card.path) {
      console.warn("Card has no path defined:", card);
      
      // Special handling for Bible cards that don't have a path
      if (card.label && card.label.toLowerCase() === "bible") {
        console.log("Found Bible card without path, navigating anyway");
        window.location.assign(`/church/${id}/bible`);
        return;
      }
      
      return;
    }
    
    // Handle external link type
    if (card.path === "external-link") {
      if (!card.externalUrl) {
        console.warn("External link card has no URL:", card);
        return;
      }
      console.log("Opening external URL:", card.externalUrl);
      window.open(card.externalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    
    // Handle forms type
    if (card.path === "forms") {
      if (card.formId) {
        console.log("Navigating to specific form:", card.formId);
        navigate(`/church/${id}/form/${card.formId}`);
      } else {
        console.log("Navigating to forms list");
        navigate(`/church/${id}/forms`);
      }
      return;
    }
    
    // Handle category detail type
    if (card.path === "category-detail") {
      if (!card.categoryId) {
        console.warn("Category detail card has no categoryId:", card);
        return;
      }
      console.log("Navigating to course-categories with category filter:", card.categoryId);
      // Store referrer information before navigating
      sessionStorage.setItem('courseCategoryReferrer', 'churchApp');
      navigate(`/church/${id}/course-categories?categories=${card.categoryId}`);
      return;
    }
    
    // Handle subcategory detail type
    if (card.path === "subcategory-detail") {
      if (!card.categoryId || !card.subcategoryId) {
        console.warn("Subcategory detail card missing required IDs:", card);
        return;
      }
      console.log("Navigating to course-categories with subcategory filter:", card.subcategoryId);
      // Store referrer information before navigating
      sessionStorage.setItem('courseCategoryReferrer', 'churchApp');
      navigate(`/church/${id}/course-categories?categories=${card.categoryId}&subcategories=${card.subcategoryId}`);
      return;
    }
    
    // Handle Bible page type - special case with forceful navigation
    if (card.path === "bible") {
      console.log("Bible card clicked, navigating to:", `/church/${id}/bible`);
      try {
        // Add debugging alert
        alert("Bible card clicked, attempting navigation now");
        
        // Try direct location change
        window.location.assign(`/church/${id}/bible`);
        return;
      } catch (error) {
        console.error("Navigation error:", error);
        
        // Fallback navigation method
        try {
          navigate(`/church/${id}/bible`);
        } catch (navigateError) {
          console.error("Navigate fallback failed:", navigateError);
          
          // Final fallback - open in new tab
          window.open(`/church/${id}/bible`, "_self");
        }
        return;
      }
    }
    
    // Handle other page types
    if (card.path === "events") {
      console.log("Navigating to events page");
      // Force navigation with a small delay to ensure it happens
      setTimeout(() => {
        navigate(`/church/${id}/events`);
      }, 10);
    } else if (card.path === "course-subcategory") {
      // For subcategory cards, we need to properly build the URL
      let url = `/church/${id}/course-categories`;
      
      const params = [];
      if (card.categoryIds?.length > 0) {
        params.push(`categories=${card.categoryIds.join(",")}`);
      }
      if (card.subcategoryIds?.length > 0) {
        // This is the key fix - use the subcategories parameter (not subcategory)
        params.push(`subcategories=${card.subcategoryIds.join(",")}`);
      }
      if (params.length > 0) {
        url += `?${params.join("&")}`;
      }
      
      console.log("Navigating to subcategories URL:", url);
      navigate(url);
    } else {
      // For other page types, use the original navigation logic
      let url = `/church/${id}/${card.path}`;
      
      // Add query parameters for filtering if needed
      if (card.path === "course-categories" && card.categoryIds?.length > 0) {
        url += `?categories=${card.categoryIds.join(",")}`;
        // Store referrer information before navigating
        sessionStorage.setItem('courseCategoryReferrer', 'churchApp');
      } else if (card.path === "course-categories") {
        // Always set referrer for course-categories, even without category IDs
        sessionStorage.setItem('courseCategoryReferrer', 'churchApp');
      }
      
      console.log("Navigating to URL:", url);
      navigate(url);
    }
    
    // Only increment click count if we're not navigating (which we shouldn't reach here)
    if (!isEditing) {
      setClickCount(prevCount => prevCount + 1);
    }
  };

  // Add new card handler
  const handleAddNewCard = () => {
    setIsEditing(true);
    setEditingCard({
      id: 'new',
      path: '',
      label: '',
      background: ''
    });
    // Fetch course categories when opening the modal
    fetchCourseCategories();
    // Fetch forms when opening the modal
    fetchForms();
  };

  if (loading) {
    return (
      <div style={commonStyles.container}>
        {/* Skeleton loading for header/navigation area */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          width: "100%", 
          marginBottom: "20px" 
        }}>
          <Skeleton width={160} height={36} />
          <Skeleton width={120} height={36} />
        </div>
        
        {/* Skeleton for the church header */}
        <div style={{ width: "100%", marginBottom: "20px" }}>
          <Skeleton height={180} width="100%" />
        </div>
        
        {/* Skeleton for the cards */}
        <div style={styles.cardsContainer}>
          {[1, 2, 3].map((item) => (
            <Skeleton 
              key={item} 
              height={180} 
              width="100%" 
              style={{ borderRadius: "8px", marginBottom: "20px" }} 
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.container}>
      {/* Only show navigation buttons when user is logged in */}
      {user ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <button
            onClick={() => navigate(`/church/${id}/mi-perfil`)}
            style={{ ...commonStyles.backButtonLink, width: "160px" }}
          >
            ← Back to Profile
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: "20px",
          }}
        >
          <button
            onClick={() => navigate(`/church/${id}/login`)}
            style={{
              ...commonStyles.backButton,
              width: "120px",
              backgroundColor: "#53bf49",
            }}
          >
            Log in →
          </button>
        </div>
      )}

      {/* Banner & Logo Image */}
      <ChurchHeader id={id} applyShadow={false} />

      {user && accessPermission && (
        <div style={styles.controlsContainer}>
          <button
            onClick={() => setIsEditing(!isEditing)}
            style={styles.editButton}
          >
            {isEditing ? "✅ Done Editing" : "✏️ Edit Cards"}
          </button>
          {isEditing && (
            <button onClick={handleAddNewCard} style={styles.addButton}>
              + Add New Card
            </button>
          )}
        </div>
      )}

      {/* Navigation Buttons */}
      <div style={styles.cardsContainer}>
        {cards.length === 0 ? (
          <div style={styles.noCardsMessage}>
            <p>No quick cards available right now</p>
            {accessPermission && (
              <button 
                onClick={handleAddNewCard}
                style={styles.addButton}
              >
                + Add New Card
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Combined, unified display of ALL cards (both horizontal and vertical) in correct order */}
            {(() => {
              // Step 1: Create a unified array of all display elements in their proper order
              const unifiedCardOrder = [];
              
              // Step 2: Group horizontal cards by their order value
              const horizontalCardsByOrder = {};
              cards.filter(card => card.horizontalScroll).forEach(card => {
                const orderValue = card.order || 0;
                if (!horizontalCardsByOrder[orderValue]) {
                  horizontalCardsByOrder[orderValue] = {};
                }
                
                const groupId = card.horizontalGroupId || 'default';
                if (!horizontalCardsByOrder[orderValue][groupId]) {
                  horizontalCardsByOrder[orderValue][groupId] = [];
                }
                
                horizontalCardsByOrder[orderValue][groupId].push(card);
              });
              
              // Step A3: Sort cards within each horizontal group by their horizontalPosition
              Object.keys(horizontalCardsByOrder).forEach(orderValue => {
                Object.keys(horizontalCardsByOrder[orderValue]).forEach(groupId => {
                  horizontalCardsByOrder[orderValue][groupId].sort((a, b) => {
                    // First sort by horizontalPosition (lowest first)
                    if (a.horizontalPosition !== undefined && b.horizontalPosition !== undefined) {
                      return a.horizontalPosition - b.horizontalPosition;
                    }
                    if (a.horizontalPosition !== undefined) return -1; // a has position, b doesn't
                    if (b.horizontalPosition !== undefined) return 1;  // b has position, a doesn't
                    
                    // As fallback, sort by creation date (newest first)
                    const aDate = a.createdAt?.toDate?.() || new Date(0);
                    const bDate = b.createdAt?.toDate?.() || new Date(0);
                    return bDate - aDate;
                  });
                });
              });
              
              // Step 3: Process vertical cards and add to unified order
              const verticalCards = cards
                .filter(card => !card.horizontalScroll)
                .map(card => ({ type: 'vertical', card, order: card.order || 0 }));
              
              // Step 4: Add horizontal card groups to unified order
              const horizontalGroups = [];
              Object.keys(horizontalCardsByOrder).forEach(orderValue => {
                Object.keys(horizontalCardsByOrder[orderValue]).forEach(groupId => {
                  horizontalGroups.push({
                    type: 'horizontal',
                    groupId,
                    orderValue: parseInt(orderValue),
                    cards: horizontalCardsByOrder[orderValue][groupId]
                  });
                });
              });
              
              // Step 5: Merge vertical cards and horizontal groups into unified order
              const allCardElements = [...verticalCards, ...horizontalGroups];
              
              // Step 6: Sort all elements by their order (lowest to highest)
              allCardElements.sort((a, b) => {
                const orderA = a.type === 'vertical' ? a.order : a.orderValue;
                const orderB = b.type === 'vertical' ? a.order : b.orderValue;
                
                // Sort by order (lowest first)
                return orderA - orderB; 
              });
              
              console.log("Sorted card elements:", allCardElements.map(e => ({
                type: e.type,
                order: e.type === 'vertical' ? e.order : e.orderValue,
                label: e.type === 'vertical' ? e.card.label : `Group with ${e.cards.length} cards`
              })));
              
              // Step 7: Render each element in the unified order
              return allCardElements.map((element, index) => {
                if (element.type === 'horizontal') {
                  // Render a horizontal group
                  return (
                    <div 
                      key={`horizontal-${element.orderValue}-${element.groupId}`} 
                      style={styles.horizontalCardsContainer}
                      data-order={element.orderValue}
                    >
                      {element.cards.map(item => (
                        <div
                          key={item.id}
                          style={{
                            ...styles.tallCard,
                            ...styles.horizontalCard,
                            ...(cardImageUrls[item.id] 
                              ? { 
                                  backgroundImage: `url('${cardImageUrls[item.id]}')`, 
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center',
                                }
                              : { backgroundColor: '#1A237E' }
                            ),
                          }}
                          onClick={() => handleCardClick(item)}
                          onMouseEnter={() => {
                            if (item.hideText) {
                              setHiddenLabels(prev => ({...prev, [item.id]: false}));
                            }
                          }}
                          onMouseLeave={() => {
                            if (item.hideText) {
                              setHiddenLabels(prev => ({...prev, [item.id]: true}));
                            }
                          }}
                        >
                          {/* Show order badge if in edit mode or if card has order > 0 */}
                          {(isEditing || item.order > 0) && (
                            <div style={styles.orderBadge}>
                              {item.order || 0}
                            </div>
                          )}
                          
                          {isEditing && (
                            <div style={styles.cardControls}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteCard(item.id);
                                }}
                                style={styles.removeButton}
                                disabled={deletingCardId === item.id}
                              >
                                {deletingCardId === item.id ? (
                                  <Spinner animation="border" size="sm" />
                                ) : (
                                  <MdDelete size={20} color="white" />
                                )}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingCard(item);
                                  fetchCourseCategories(); // Fetch categories when editing a card
                                  fetchForms(); // Fetch forms when editing a card
                                }}
                                style={styles.editCardButton}
                              >
                                ✏️
                              </button>
                              <label 
                                style={styles.imageUploadButton}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {uploadingCardId === item.id ? (
                                  <Spinner animation="border" size="sm" />
                                ) : (
                                  <FaImage size={20} color="white" />
                                )}
                                <input
                                  type="file"
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    handleImageUpload(e, item.id);
                                  }}
                                  accept=".png,.jpg,.jpeg"
                                  style={{ display: "none" }}
                                  disabled={uploadingCardId !== null}
                                />
                              </label>
                            </div>
                          )}
                          <div style={{
                            ...styles.cardLabel,
                            ...(hiddenLabels[item.id] ? styles.hiddenLabel : {})
                          }}>
                            {item.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                } else {
                  // Render a vertical card
                  const item = element.card;
                  return (
                    <div
                      key={item.id}
                      style={{
                        ...styles.tallCard,
                        ...(cardImageUrls[item.id] 
                          ? { 
                              backgroundImage: `url('${cardImageUrls[item.id]}')`, 
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }
                          : { backgroundColor: '#1A237E' }
                        ),
                        width: "100%",  // Ensure full width
                      }}
                      onClick={() => handleCardClick(item)}
                      onMouseEnter={() => {
                        if (item.hideText) {
                          setHiddenLabels(prev => ({...prev, [item.id]: false}));
                        }
                      }}
                      onMouseLeave={() => {
                        if (item.hideText) {
                          setHiddenLabels(prev => ({...prev, [item.id]: true}));
                        }
                      }}
                      data-order={item.order || 0}
                    >
                      {/* Show order badge if in edit mode or if card has order > 0 */}
                      {(isEditing || item.order > 0) && (
                        <div style={styles.orderBadge}>
                          {item.order || 0}
                        </div>
                      )}
                      
                      {isEditing && (
                        <div style={styles.cardControls}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCard(item.id);
                            }}
                            style={styles.removeButton}
                            disabled={deletingCardId === item.id}
                          >
                            {deletingCardId === item.id ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              <MdDelete size={20} color="white" />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCard(item);
                              fetchCourseCategories(); // Fetch categories when editing a card
                              fetchForms(); // Fetch forms when editing a card
                            }}
                            style={styles.editCardButton}
                          >
                              ✏️
                          </button>
                          <label 
                            style={styles.imageUploadButton}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {uploadingCardId === item.id ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              <FaImage size={20} color="white" />
                            )}
                            <input
                              type="file"
                              onChange={(e) => {
                                  e.stopPropagation();
                                  handleImageUpload(e, item.id);
                                }}
                              accept=".png,.jpg,.jpeg"
                              style={{ display: "none" }}
                              disabled={uploadingCardId !== null}
                            />
                          </label>
                        </div>
                      )}
                      <div style={{
                        ...styles.cardLabel,
                        ...(hiddenLabels[item.id] ? styles.hiddenLabel : {})
                      }}>
                        {item.label}
                      </div>
                    </div>
                  );
                }
              });
            })()}
          </>
        )}
      </div>

      {editingCard && (
        <EditCardModal
          card={editingCard}
          onSave={handleSaveCard}
          onClose={() => {
            setIsEditing(false);
            setEditingCard(null);
          }}
          courseCategories={courseCategories}
          forms={forms}
        />
      )}
    </div>
  );
};

const EditCardModal = ({ card, onSave, onClose, courseCategories, forms }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    label: card.label || '',
    path: card.path || '',
    background: card.background || '',
    categoryIds: card.categoryIds || [], // Array for multi-select categories
    subcategoryIds: card.subcategoryIds || [], // Array for multi-select subcategories
    categorySelections: card.categorySelections || [], // Array of {categoryId, subcategoryIds} for multiple category-subcategory pairs
    order: card.order || 0, // Card order for sorting
    hideText: card.hideText || false, // Option to hide card label
    horizontalScroll: card.horizontalScroll || false, // Whether this card should be in a horizontal scrolling group
    horizontalGroupId: card.horizontalGroupId || '', // Group ID for horizontal scrolling
    horizontalPosition: card.horizontalPosition || 0, // Position within horizontal group
    externalUrl: card.externalUrl || '', // External URL for external-link page type
    categoryId: card.categoryId || null, // Single category ID for category-detail page type
    subcategoryId: card.subcategoryId || null, // Single subcategory ID for subcategory-detail page type
    formId: card.formId || null, // Single form ID for forms page type
  });
  const [selectedPage, setSelectedPage] = useState(card.path || "info");
  const [loading, setLoading] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false); // Added for category modal

  // Modal for adding a category with subcategories
  const [tempCategory, setTempCategory] = useState("");
  const [tempSubcategories, setTempSubcategories] = useState([]);

  // Handle adding a new category with its subcategories
  const handleAddCategorySelection = () => {
    if (!tempCategory || tempSubcategories.length === 0) {
      toast.error("Please select a category and at least one subcategory");
      return;
    }

    const newSelection = {
      categoryId: tempCategory,
      subcategoryIds: tempSubcategories
    };

    setFormData(prev => ({
      ...prev,
      categorySelections: [...(prev.categorySelections || []), newSelection],
      // Also update the combined arrays for the URL parameters
      categoryIds: [...new Set([...(prev.categoryIds || []), tempCategory])],
      subcategoryIds: [...new Set([...(prev.subcategoryIds || []), ...tempSubcategories])]
    }));

    // Reset temp values
    setTempCategory("");
    setTempSubcategories([]);
    setShowCategoryModal(false);
  };

  const handlePageChange = (e) => {
    const newPath = e.target.value;
    setSelectedPage(newPath);
    setFormData((prev) => ({
      ...prev,
      path: newPath,
    }));
  };

  // Check localStorage for saved form data
  useEffect(() => {
    const savedFormData = localStorage.getItem('tempCardData');
    if (savedFormData) {
      try {
        const parsedData = JSON.parse(savedFormData);
        // Only update if we're editing the same card
        if (parsedData.id === card.id) {
          setFormData(prev => ({
            ...prev,
            ...parsedData
          }));
        }
        // Clear saved data
        localStorage.removeItem('tempCardData');
      } catch (error) {
        console.error('Error parsing saved form data:', error);
      }
    }
  }, [card.id]);

  // Initialize selected page based on card.path when card changes
  useEffect(() => {
    setSelectedPage(card.path || "");
    
    // Log to help with debugging
    console.log("Card being edited:", card);
    console.log("Course categories available:", courseCategories);
    
    // Log when a categoryId is present
    if (card.categoryId) {
      console.log("Card has categoryId:", card.categoryId);
      const category = courseCategories.find(c => c.id === card.categoryId);
      console.log("Found category:", category?.name || "Not found");
    }
  }, [card, courseCategories]);

  // Add a useEffect specifically for subcategory dropdown initialization
  useEffect(() => {
    if (formData.categoryId && selectedPage === "subcategory-detail") {
      // Log the available subcategories for this category
      const category = courseCategories.find(cat => cat.id === formData.categoryId);
      console.log("Available subcategories for selected category:", 
                 category?.subcategories?.map(sub => ({id: sub.id, name: sub.name})) || "None found");
      
      // If card has a subcategoryId, make sure it exists in the selected category
      if (formData.subcategoryId) {
        const subcategoryExists = category?.subcategories?.some(sub => sub.id === formData.subcategoryId);
        console.log("Current subcategoryId exists in category:", subcategoryExists);
        
        // If it doesn't exist in the current category, reset it
        if (!subcategoryExists) {
          console.log("Resetting subcategoryId as it doesn't exist in current category");
          setFormData(prev => ({...prev, subcategoryId: null}));
        }
      }
    }
  }, [formData.categoryId, selectedPage, courseCategories, formData.subcategoryId]);

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    const updatedCard = {
      ...formData,
      id: card.id,
    };

    if ((formData.path === "course-categories" || formData.path === "course-subcategory") && formData.categoryIds.length === 0) {
      toast.error("Please select at least one course category");
      setLoading(false);
      return;
    }

    if (formData.path === "course-subcategory" && formData.subcategoryIds.length === 0) {
      toast.error("Please select at least one subcategory");
      setLoading(false);
      return;
    }

    onSave(updatedCard);
    setLoading(false);
  };

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        <h2 style={styles.modalTitle}>
          {card.id === "new" ? "Add New Card" : "Edit Card"}
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Label</label>
            <input
              type="text"
              value={formData.label}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, label: e.target.value }))
              }
              style={styles.input}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Page Type</label>
            <select
              value={selectedPage}
              onChange={handlePageChange}
              style={styles.select}
              required
            >
              {AVAILABLE_PAGES.map((page) => (
                <option key={page.value} value={page.value}>
                  {page.label}
                </option>
              ))}
            </select>
          </div>

          {/* External Link field */}
          {selectedPage === "external-link" && (
            <div style={styles.formGroup}>
              <label style={styles.label}>External URL</label>
              <input
                type="url"
                value={formData.externalUrl || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, externalUrl: e.target.value }))
                }
                style={styles.input}
                placeholder="https://example.com"
                required={selectedPage === "external-link"}
              />
              <small style={{ color: '#6B7280', marginTop: '4px', display: 'block' }}>
                Enter a valid URL (starting with http:// or https://)
              </small>
            </div>
          )}

          {/* Category Detail Selection */}
          {selectedPage === "category-detail" && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Select Category</label>
              <select
                value={formData.categoryId || ""}
                onChange={(e) => {
                  const selectedCategoryId = e.target.value;
                  console.log("Selected categoryId:", selectedCategoryId);
                  setFormData(prev => ({
                    ...prev,
                    categoryId: selectedCategoryId || null
                  }));
                }}
                style={styles.select}
                required
              >
                <option value="">Select a category</option>
                {courseCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name || 'Unnamed Category'}
                  </option>
                ))}
              </select>
              {courseCategories.length === 0 && (
                <div style={{ color: '#EF4444', marginTop: '5px', fontSize: '14px' }}>
                  No categories available. Please create categories first.
                </div>
              )}
            </div>
          )}

          {/* Subcategory Detail Selection */}
          {selectedPage === "subcategory-detail" && (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>Select Category</label>
                <select
                  value={formData.categoryId || ""}
                  onChange={(e) => {
                    const selectedCategoryId = e.target.value;
                    console.log("Selected categoryId for subcategory detail:", selectedCategoryId);
                    setFormData(prev => ({
                      ...prev,
                      categoryId: selectedCategoryId || null,
                      // Clear subcategory when category changes
                      subcategoryId: null
                    }));
                  }}
                  style={styles.select}
                  required
                >
                  <option value="">Select a category</option>
                  {courseCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name || 'Unnamed Category'}
                    </option>
                  ))}
                </select>
              </div>

              {formData.categoryId && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>Select Subcategory</label>
                  <select
                    value={formData.subcategoryId || ""}
                    onChange={(e) => {
                      const selectedSubcategoryId = e.target.value;
                      console.log("Selected subcategoryId:", selectedSubcategoryId);
                      setFormData(prev => ({
                        ...prev,
                        subcategoryId: selectedSubcategoryId || null
                      }));
                    }}
                    style={styles.select}
                    required
                  >
                    <option value="">Select a subcategory</option>
                    {courseCategories
                      .find(cat => cat.id === formData.categoryId)
                      ?.subcategories?.map(sub => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name || 'Unnamed Subcategory'}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Forms Selection */}
          {selectedPage === "forms" && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Select Form</label>
              <select
                value={formData.formId || ""}
                onChange={(e) => {
                  const selectedFormId = e.target.value;
                  console.log("Selected formId:", selectedFormId);
                  setFormData(prev => ({
                    ...prev,
                    formId: selectedFormId || null
                  }));
                }}
                style={styles.select}
                required
              >
                <option value="">Select a form</option>
                {forms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.title || 'Untitled Form'}
                  </option>
                ))}
              </select>
              {forms.length === 0 && (
                <div style={{ color: '#EF4444', marginTop: '5px', fontSize: '14px' }}>
                  No forms available. Please create forms first.
                </div>
              )}
            </div>
          )}

          {/* Add category selection for course-categories page type */}
          {selectedPage === "course-categories" && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Select Categories</label>
              <Select
                isMulti
                value={formData.categoryIds?.map(catId => {
                  const category = courseCategories.find(cat => cat.id === catId);
                  return category ? {
                    value: category.id,
                    label: category.name
                  } : null;
                }).filter(Boolean)}
                onChange={(selected) => {
                  const categoryIds = selected ? selected.map(option => option.value) : [];
                  setFormData(prev => ({
                    ...prev,
                    categoryIds: categoryIds
                  }));
                }}
                options={courseCategories.map(category => ({
                  value: category.id,
                  label: category.name
                }))}
                placeholder="Select categories..."
              />
            </div>
          )}

          {selectedPage === "course-subcategory" && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Category-Subcategory Selections</label>
              <div style={{
                border: '1px solid #D1D5DB',
                borderRadius: '4px',
                padding: '10px',
                marginBottom: '10px'
              }}>
                {formData.categorySelections?.map((selection, index) => (
                  <div key={index} style={{
                    marginBottom: '10px',
                    padding: '10px',
                    backgroundColor: '#f9fafb',
                    borderRadius: '4px',
                    position: 'relative'
                  }}>
                    <button 
                      onClick={() => {
                        // Remove this category selection
                        const newSelections = [...formData.categorySelections];
                        newSelections.splice(index, 1);
                        setFormData(prev => ({
                          ...prev,
                          categorySelections: newSelections,
                          // Also update the combined arrays for the URL parameters
                          categoryIds: prev.categorySelections
                            .filter((_, i) => i !== index)
                            .map(sel => sel.categoryId),
                          subcategoryIds: prev.categorySelections
                            .filter((_, i) => i !== index)
                            .flatMap(sel => sel.subcategoryIds)
                        }));
                      }}
                      style={{
                        position: 'absolute',
                        right: '5px',
                        top: '5px',
                        background: '#EF4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                      type="button"
                    >
                      ×
                    </button>
                    <div><strong>{courseCategories.find(cat => cat.id === selection.categoryId)?.name || 'Category'}</strong></div>
                    <div style={{marginLeft: '15px', marginTop: '5px'}}>
                      {selection.subcategoryIds.map(subId => {
                        const category = courseCategories.find(cat => cat.id === selection.categoryId);
                        const subcategory = category?.subcategories?.find(sub => sub.id === subId);
                        return subcategory ? (
                          <div key={subId} style={{
                            display: 'inline-block',
                            margin: '2px',
                            padding: '2px 8px',
                            backgroundColor: '#e5edff',
                            color: '#1e40af',
                            borderRadius: '12px',
                            fontSize: '12px'
                          }}>
                            {subcategory.name}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                ))}
                
                <button
                  onClick={() => {
                    // Open the category selection modal
                    setShowCategoryModal(true);
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#4F46E5',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    width: '100%',
                    fontSize: '14px'
                  }}
                  type="button"
                >
                  + Add Category with Subcategories
                </button>
              </div>
            </div>
          )}

          <div style={styles.formGroup}>
            <label style={styles.label}>Card Order</label>
            <input
              type="number"
              min="0"
              value={formData.order || 0}
              onChange={(e) => {
                const orderValue = parseInt(e.target.value, 10) || 0;
                setFormData(prev => ({ ...prev, order: orderValue }));
              }}
              style={styles.input}
              placeholder="Enter card order (0 = default)"
            />
            <small style={{ color: '#6B7280', marginTop: '4px', display: 'block' }}>
              Cards with higher order numbers will be displayed first. Zero or blank means default order.
            </small>
          </div>

          {/* Add text visibility toggle */}
          <div style={styles.formGroup}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              marginBottom: '8px'
            }}>
              <input
                type="checkbox"
                checked={formData.hideText || false}
                onChange={(e) => {
                  setFormData(prev => ({ 
                    ...prev, 
                    hideText: e.target.checked 
                  }));
                }}
                style={{ marginRight: '8px' }}
              />
              Hide card text
            </label>
            <small style={{ color: '#6B7280', display: 'block' }}>
              When checked, the card's label text will be hidden until hovered.
            </small>
          </div>

          {/* Add horizontal scrolling option */}
          <div style={styles.formGroup}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              marginBottom: '8px'
            }}>
              <input
                type="checkbox"
                checked={formData.horizontalScroll || false}
                onChange={(e) => {
                  setFormData(prev => ({ 
                    ...prev, 
                    horizontalScroll: e.target.checked,
                    // Reset group ID if turning off horizontal scrolling
                    horizontalGroupId: e.target.checked ? prev.horizontalGroupId : '',
                    // Initialize horizontalPosition if turning on horizontal scrolling
                    horizontalPosition: e.target.checked ? (prev.horizontalPosition || 0) : undefined
                  }));
                }}
                style={{ marginRight: '8px' }}
              />
              Include in horizontal scrolling group
            </label>
            <small style={{ color: '#6B7280', display: 'block', marginBottom: '8px' }}>
              Cards in the same group will scroll horizontally.
            </small>

            {formData.horizontalScroll && (
              <>
                <div style={{ marginTop: '8px' }}>
                  <label style={styles.label}>Group ID</label>
                  <input
                    type="text"
                    value={formData.horizontalGroupId || ''}
                    onChange={(e) => {
                      setFormData(prev => ({
                        ...prev,
                        horizontalGroupId: e.target.value
                      }));
                    }}
                    style={styles.input}
                    placeholder="group1 (cards with same ID will be grouped)"
                  />
                  <small style={{ color: '#6B7280', marginTop: '4px', display: 'block' }}>
                    Cards with the same group ID will be displayed together in a horizontal scrolling row.
                  </small>
                </div>

                <div style={{ marginTop: '16px' }}>
                  <label style={styles.label}>Horizontal Position</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.horizontalPosition || 0}
                    onChange={(e) => {
                      const positionValue = parseInt(e.target.value, 10) || 0;
                      setFormData(prev => ({ 
                        ...prev, 
                        horizontalPosition: positionValue 
                      }));
                    }}
                    style={styles.input}
                    placeholder="Position within horizontal group (1, 2, 3...)"
                  />
                  <small style={{ color: '#6B7280', marginTop: '4px', display: 'block' }}>
                    Position of this card within the horizontal group. Lower numbers come first (1, 2, 3...).
                  </small>
                </div>
              </>
            )}
          </div>

          <div style={styles.buttonContainer}>
            <button type="submit" style={styles.saveButton} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={onClose} style={styles.cancelButton}>
              Cancel
            </button>
          </div>
        </form>
      </div>

      {/* Modal for selecting a category and its subcategories */}
      {showCategoryModal && (
        <div style={styles.modalOverlay}>
          <div style={{...styles.modalContent, zIndex: 1100}}>
            <h2 style={styles.modalTitle}>Add Category with Subcategories</h2>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Select Category</label>
              <select
                value={tempCategory}
                onChange={(e) => {
                  setTempCategory(e.target.value);
                  setTempSubcategories([]); // Reset subcategories when category changes
                }}
                style={styles.select}
                required
              >
                <option value="">Select a category</option>
                {courseCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            
            {tempCategory && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Select Subcategories</label>
                <Select
                  isMulti
                  value={tempSubcategories.map(subId => {
                    const category = courseCategories.find(cat => cat.id === tempCategory);
                    const subcategory = category?.subcategories?.find(sub => sub.id === subId);
                    return subcategory ? {
                      value: subcategory.id,
                      label: subcategory.name
                    } : null;
                  }).filter(Boolean)}
                  onChange={(selected) => {
                    const subcategoryIds = selected ? selected.map(option => option.value) : [];
                    setTempSubcategories(subcategoryIds);
                  }}
                  options={courseCategories
                    .find(cat => cat.id === tempCategory)
                    ?.subcategories?.map(sub => ({
                      value: sub.id,
                      label: sub.name
                    })) || []}
                  placeholder="Select subcategories..."
                />
              </div>
            )}
            
            <div style={{
              display: 'flex',
              gap: '10px',
              marginTop: '20px'
            }}>
              <button
                onClick={handleAddCategorySelection}
                style={{
                  ...styles.saveButton,
                  flex: 1,
                  marginTop: 0
                }}
                disabled={!tempCategory || tempSubcategories.length === 0}
                type="button"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowCategoryModal(false);
                  setTempCategory("");
                  setTempSubcategories([]);
                }}
                style={{
                  ...styles.cancelButton,
                  flex: 1,
                  marginTop: 0
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChurchApp;
