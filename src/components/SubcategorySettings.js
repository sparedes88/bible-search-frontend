import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  addDoc,
  collection,
  deleteDoc,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase";
import { ToastContainer, toast } from "react-toastify";
import UsersDropdown from "./UsersDropdown";
import "./SubcategorySettings.css";
import "react-toastify/dist/ReactToastify.css";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import { MdDelete } from "react-icons/md";
import { Tooltip } from "react-tooltip";
import { Spinner } from "react-bootstrap";

const formatDate = (date) => {
  if (typeof date === 'string' && date.includes('-')) {
    const parts = date.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[1]}-${parts[2]}-${parts[0]}`;
      }
      return date;
    }
  }

  const d = new Date(date);
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  return `${month}-${day}-${year}`;
};

const formatTime = (time) => {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const formattedHour = hour % 12 || 12;
  return `${String(formattedHour).padStart(2, "0")}:${minutes} ${ampm}`;
};

const calculateTotalOccurrences = (startDate, endDate, pattern) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Add one day to end date to include it in the calculation
  end.setDate(end.getDate() + 1);
  
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  switch (pattern) {
    case 'daily':
      return diffDays;
    case 'weekly':
      return Math.ceil(diffDays / 7);
    case 'biweekly':
      return Math.ceil(diffDays / 14);
    case 'monthly': {
      let months = (end.getFullYear() - start.getFullYear()) * 12;
      months += end.getMonth() - start.getMonth();
      if (end.getDate() >= start.getDate()) months += 1;
      return months;
    }
    case 'yearly':
      let years = end.getFullYear() - start.getFullYear();
      if (end.getMonth() > start.getMonth() || 
         (end.getMonth() === start.getMonth() && end.getDate() >= start.getDate())) {
        years += 1;
      }
      return years;
    default:
      return Math.ceil(diffDays / 7);
  }
};

const generateRecurringInstances = (event) => {
  if (!event.recurring && !event.isRecurring) {
    return [{
      ...event,
      id: event.id || `single-${Date.now()}`,
      parentEventId: event.id,
      startDate: event.startDate,
      endDate: event.endDate || event.startDate,
      startHour: event.startHour || '09:00 AM',
      endHour: event.endHour || '10:00 AM',
      title: event.title,
      instanceTitle: event.instanceTitle || event.title,
      status: event.status || 'optional',
      order: event.order || 1,
      isRecurring: false
    }];
  }

  const instances = [];
  const startDate = new Date(event.startDate);
  const endRecurrence = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;
  
  // Fix end date calculation
  endRecurrence?.setHours(23, 59, 59, 999);
  
  const maxDate = endRecurrence || new Date(startDate.getTime() + (180 * 24 * 60 * 60 * 1000));
  let currentDate = new Date(startDate);
  let instanceCount = 0;

  const totalOccurrences = event.totalOccurrences || 
    calculateTotalOccurrences(startDate, maxDate, event.recurrencePattern);

  // Ensure we don't exceed totalOccurrences
  while (instanceCount < totalOccurrences && currentDate <= maxDate) {
    instanceCount++;
    const instanceDate = currentDate.toISOString().split('T')[0];
    
    instances.push({
      ...event,
      id: `${event.id}-${instanceCount}`,
      parentEventId: event.id,
      startDate: instanceDate,
      endDate: instanceDate,
      startHour: event.startHour || '09:00 AM',
      endHour: event.endHour || '10:00 AM',
      title: event.title,
      instanceTitle: event.instanceTitle || event.title,
      status: event.status || 'optional',
      order: instanceCount,
      isRecurring: true,
      recurrencePattern: event.recurrencePattern,
      instanceNumber: instanceCount
    });

    // Move to next date based on pattern
    const nextDate = new Date(currentDate);
    switch (event.recurrencePattern) {
      case 'daily':
        nextDate.setDate(currentDate.getDate() + 1);
        break;
      case 'weekly':
        nextDate.setDate(currentDate.getDate() + 7);
        break;
      case 'biweekly':
        nextDate.setDate(currentDate.getDate() + 14);
        break;
      case 'monthly':
        nextDate.setMonth(currentDate.getMonth() + 1);
        break;
      case 'yearly':
        nextDate.setFullYear(currentDate.getFullYear() + 1);
        break;
      default:
        nextDate.setDate(currentDate.getDate() + 7);
    }
    currentDate = nextDate;
  }

  return instances;
};

const generateNextInstances = async (event) => {
  const lastDate = new Date(event.lastInstanceDate);
  const generateUntil = new Date(lastDate.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (event.recurrenceEndDate) {
    const endDate = new Date(event.recurrenceEndDate);
    if (lastDate >= endDate) return [];
  }
  const nextInstances = generateRecurringInstances({
    ...event,
    startDate: event.nextInstanceDate,
    recurrenceEndDate: generateUntil.toISOString().split("T")[0],
  });
  return nextInstances;
};

const SubcategorySettings = () => {
  const params = useParams();
  console.log('SubcategorySettings useParams:', params);
  const { id: churchId, categoryId, subcategoryId } = params;
  const { user } = useAuth();
  const navigate = useNavigate();
  // Video Links State
  const [newVideoTitle, setNewVideoTitle] = useState("");
  const [newVideoDescription, setNewVideoDescription] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [editingVideoId, setEditingVideoId] = useState(null);
  const [editingVideoData, setEditingVideoData] = useState({ title: "", description: "", url: "" });
  const [previewVideoId, setPreviewVideoId] = useState(null);

  // Add Video Link Handler (to be implemented in next step)
  const handleAddVideoLink = async () => {
    if (!newVideoTitle.trim() || !newVideoUrl.trim()) {
      toast.error("Please provide both title and URL for the video link");
      return;
    }

    try {
      const videoLink = {
        title: newVideoTitle.trim(),
        description: newVideoDescription.trim(),
        url: newVideoUrl.trim(),
        id: Date.now().toString(),
        order: (subcategory.videoLinks || []).length + 1,
        addedAt: new Date().toISOString()
      };

      const updatedVideoLinks = [...(subcategory.videoLinks || []), videoLink];
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, videoLinks: updatedVideoLinks } : sub
      );

      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });

      setSubcategory((prev) => ({ ...prev, videoLinks: updatedVideoLinks }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));

      // Clear form
      setNewVideoTitle("");
      setNewVideoDescription("");
      setNewVideoUrl("");

      toast.success("Video link added successfully!");
    } catch (error) {
      console.error("Error adding video link:", error);
      toast.error(`Failed to add video link: ${error.message}`);
    }
  };

  const handleDeleteVideoLink = async (videoId) => {
    try {
      const updatedVideoLinks = (subcategory.videoLinks || []).filter(link => link.id !== videoId);
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, videoLinks: updatedVideoLinks } : sub
      );

      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });

      setSubcategory((prev) => ({ ...prev, videoLinks: updatedVideoLinks }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));

      toast.success("Video link deleted successfully!");
    } catch (error) {
      console.error("Error deleting video link:", error);
      toast.error(`Failed to delete video link: ${error.message}`);
    }
  };

  const handleEditVideoLink = async (videoId, updatedLink) => {
    try {
      const updatedVideoLinks = (subcategory.videoLinks || []).map(link =>
        link.id === videoId ? { ...link, ...updatedLink } : link
      );
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, videoLinks: updatedVideoLinks } : sub
      );

      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });

      setSubcategory((prev) => ({ ...prev, videoLinks: updatedVideoLinks }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));

      toast.success("Video link updated successfully!");
    } catch (error) {
      console.error("Error updating video link:", error);
      toast.error(`Failed to update video link: ${error.message}`);
    }
  };

  const startEditingVideo = (video) => {
    setEditingVideoId(video.id);
    setEditingVideoData({
      title: video.title,
      description: video.description,
      url: video.url
    });
  };

  const handleReorderVideoLinks = async (videoId, direction) => {
    try {
      const currentLinks = [...(subcategory.videoLinks || [])];
      const currentIndex = currentLinks.findIndex(link => link.id === videoId);

      if (currentIndex === -1) return;

      let newIndex;
      if (direction === 'up' && currentIndex > 0) {
        newIndex = currentIndex - 1;
      } else if (direction === 'down' && currentIndex < currentLinks.length - 1) {
        newIndex = currentIndex + 1;
      } else {
        return; // Can't move further in that direction
      }

      // Swap the positions
      [currentLinks[currentIndex], currentLinks[newIndex]] = [currentLinks[newIndex], currentLinks[currentIndex]];

      // Update order numbers
      const updatedLinks = currentLinks.map((link, index) => ({
        ...link,
        order: index + 1
      }));

      // Update in database
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, videoLinks: updatedLinks } : sub
      );

      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });

      setSubcategory((prev) => ({ ...prev, videoLinks: updatedLinks }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));

      toast.success("Video order updated successfully!");
    } catch (error) {
      console.error("Error reordering video links:", error);
      toast.error(`Failed to reorder videos: ${error.message}`);
    }
  };

  const extractVideoId = (url) => {
    if (!url) return null;

    // YouTube patterns
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const youtubeMatch = url.match(youtubeRegex);
    if (youtubeMatch) {
      return { platform: 'youtube', id: youtubeMatch[1] };
    }

    // Vimeo patterns
    const vimeoRegex = /(?:vimeo\.com\/)(?:.*#|.*\/videos\/|.*\/|channels\/.*\/|groups\/.*\/videos\/|album\/.*\/video\/|video\/)?([0-9]+)(?:$|\/|\?)/;
    const vimeoMatch = url.match(vimeoRegex);
    if (vimeoMatch) {
      return { platform: 'vimeo', id: vimeoMatch[1] };
    }

    // Direct video files (mp4, webm, ogg)
    if (url.match(/\.(mp4|webm|ogg)$/i)) {
      return { platform: 'direct', url: url };
    }

    return null;
  };

  const getEmbedUrl = (videoInfo) => {
    if (!videoInfo) return null;

    switch (videoInfo.platform) {
      case 'youtube':
        return `https://www.youtube.com/embed/${videoInfo.id}`;
      case 'vimeo':
        return `https://player.vimeo.com/video/${videoInfo.id}`;
      case 'direct':
        return videoInfo.url;
      default:
        return null;
    }
  };

  const handlePreviewVideo = (videoId) => {
    setPreviewVideoId(previewVideoId === videoId ? null : videoId);
  };

  const cancelEditingVideo = () => {
    setEditingVideoId(null);
    setEditingVideoData({ title: "", description: "", url: "" });
  };

  const saveEditingVideo = async () => {
    if (!editingVideoData.title.trim() || !editingVideoData.url.trim()) {
      toast.error("Please provide both title and URL");
      return;
    }

    await handleEditVideoLink(editingVideoId, editingVideoData);
    cancelEditingVideo();
  };
  const [loading, setLoading] = useState(true);
  const [subcategory, setSubcategory] = useState(null);
  const [category, setCategory] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isAddingEvent, setEventAdding] = useState(false);
  const [isCreatingGroup, setCreatingGroup] = useState(false);
  const [isDeletingGroup, setDeletingGroup] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: "",
    dates: [
      {
        date: new Date().toISOString().split("T")[0],
        startHour: "09:00",
        endHour: "10:00",
      },
    ],
    recurring: false,
    recurrencePattern: "weekly",
    recurrenceEndDate: "",
    imageUrl: "",
    useSubcategoryImage: true,
    isMultiDay: false,
  });
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editingEntry, setEditingEntry] = useState(null);
  const [newGroupName, setNewGroupName] = useState(subcategory?.name || "");
  const [editingEventId, setEditingEventId] = useState(null);
  const [editingInstance, setEditingInstance] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [previewInstances, setPreviewInstances] = useState(0);
  const [activeTab, setActiveTab] = useState('basic');

  // Form and Gallery state
  const [forms, setForms] = useState([]);
  const [galleries, setGalleries] = useState([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [loadingGalleries, setLoadingGalleries] = useState(false);

  const calculateInstances = (startDate, endDate, pattern) => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    let current = new Date(start);
    while (current <= end) {
      count++;
      switch (pattern) {
        case "daily":
          current.setDate(current.getDate() + 1);
          break;
        case "weekly":
          current.setDate(current.getDate() + 7);
          break;
        case "biweekly":
          current.setDate(current.getDate() + 14);
          break;
        case "monthly":
          current.setMonth(current.getMonth() + 1);
          break;
        case "yearly":
          current.setFullYear(current.getFullYear() + 1);
          break;
        default:
          current.setDate(current.getDate() + 7);
      }
    }
    return count;
  };

  useEffect(() => {
    console.log('SubcategorySettings: Starting fetchData with params:', { churchId, categoryId, subcategoryId });
    
    if (!categoryId) {
      console.error('SubcategorySettings: categoryId is missing');
      setLoading(false);
      return;
    }
    
    if (!subcategoryId) {
      console.error('SubcategorySettings: subcategoryId is missing');
      setLoading(false);
      return;
    }
    
    const fetchData = async () => {
      try {
        console.log('SubcategorySettings: Fetching category data for categoryId:', categoryId);
        const categoryDoc = await getDoc(
          doc(db, "coursecategories", categoryId)
        );
        if (categoryDoc.exists()) {
          const categoryData = { ...categoryDoc.data(), id: categoryDoc.id };
          setCategory(categoryData);
          const sub = categoryData.subcategories.find(
            (s) => s.id === subcategoryId
          );
          if (sub) {
            setSubcategory(sub);
            setNewGroupName(sub.name);
          }
        }
        setLoading(false);
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Error loading subcategory");
        setLoading(false);
      }
    };
    fetchData();
  }, [categoryId, subcategoryId]);

  // Fetch forms for the church
  const fetchForms = async () => {
    try {
      setLoadingForms(true);
      console.log('Fetching forms for churchId:', churchId);
      
      const formsQuery = query(
        collection(db, "churches", churchId, "forms"),
        where("isActive", "==", true)
      );
      
      const formsSnapshot = await getDocs(formsQuery);
      const formsData = formsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log('Found forms:', formsData.length, formsData);
      setForms(formsData);
    } catch (error) {
      console.error('Error fetching forms:', error);
      
      // Fallback: try to get all forms without the isActive filter
      try {
        console.log('Trying fallback query without isActive filter...');
        const fallbackQuery = collection(db, "churches", churchId, "forms");
        const fallbackSnapshot = await getDocs(fallbackQuery);
        const fallbackData = fallbackSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        console.log('Fallback found forms:', fallbackData.length, fallbackData);
        setForms(fallbackData);
      } catch (fallbackError) {
        console.error('Fallback query also failed:', fallbackError);
        toast.error('Failed to load forms');
        setForms([]);
      }
    } finally {
      setLoadingForms(false);
    }
  };

  // Fetch galleries for the church
  const fetchGalleries = async () => {
    try {
      setLoadingGalleries(true);
      console.log('Fetching galleries for churchId:', churchId, 'Type:', typeof churchId);
      
      // Fetch all galleries first (same approach as galleryview.js)
      console.log('Fetching all galleries...');
      const allGalleriesSnapshot = await getDocs(collection(db, "gallery_new"));
      const allGalleries = allGalleriesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`Found ${allGalleries.length} total galleries in collection.`);
      
      // Filter galleries strictly by church ownership
      const churchGalleries = allGalleries.filter(gallery => {
        // Convert churchId to both string and number for comparison
        const churchIdStr = String(churchId);
        const churchIdNum = parseInt(churchId);
        
        // Check if gallery belongs to this church using idIglesia or churchId fields
        const belongsToChurch = (
          gallery.idIglesia === churchIdNum ||
          gallery.idIglesia === churchIdStr ||
          gallery.churchId === churchIdNum ||
          gallery.churchId === churchIdStr
        );
        
        if (belongsToChurch) {
          console.log(`✅ Gallery "${gallery.name || gallery.title || 'Unnamed'}" (${gallery.id}) belongs to church ${churchId}`);
        }
        
        return belongsToChurch;
      });
      
      console.log(`Church ${churchId} has ${churchGalleries.length} galleries available for assignment.`);
      
      // Additional debug: show which churches the other galleries belong to
      if (churchGalleries.length < allGalleries.length) {
        console.log('Other galleries belong to different churches:');
        allGalleries
          .filter(gallery => !churchGalleries.includes(gallery))
          .forEach(gallery => {
            console.log(`  - "${gallery.name || gallery.title || 'Unnamed'}" belongs to church ${gallery.idIglesia || gallery.churchId || 'Unknown'}`);
          });
      }
      
      setGalleries(churchGalleries);
      
    } catch (error) {
      console.error('Error fetching galleries:', error);
      toast.error('Failed to load galleries');
      setGalleries([]);
    } finally {
      setLoadingGalleries(false);
    }
  };

  // Fetch forms and galleries when component mounts
  useEffect(() => {
    if (churchId) {
      fetchForms();
      fetchGalleries();
    }
  }, [churchId]);

  const handleUpdate = async (updatedData) => {
    try {
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, ...updatedData } : sub
      );
      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });
      setSubcategory((prev) => ({ ...prev, ...updatedData }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));
    } catch (error) {
      console.error("Error updating subcategory:", error);
      toast.error(`Failed to save changes: ${error.message}`);
    }
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    try {
      setUploading(true);
      
      // Handle multiple files
      const uploadPromises = Array.from(files).map(async (file) => {
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const filePath = `coursecategories/${churchId}/${categoryId}/subcategories/${subcategoryId}/materials/${timestamp}_${safeFileName}`;
        const storageRef = ref(storage, filePath);
        const metadata = {
          contentType: file.type,
          customMetadata: {
            uploadedBy: "subcategory-settings",
            uploadTime: new Date().toISOString(),
          },
        };
        const uploadResult = await uploadBytes(storageRef, file, metadata);
        const downloadURL = await getDownloadURL(uploadResult.ref);
        const fileExt = file.name.split(".").pop().toLowerCase();
        let fileType = "document";
        if (["jpg", "jpeg", "png", "gif", "svg"].includes(fileExt)) {
          fileType = "image";
        } else if (["mp4", "webm", "avi", "mov"].includes(fileExt)) {
          fileType = "video";
        } else if (["mp3", "wav", "ogg"].includes(fileExt)) {
          fileType = "audio";
        }
        return {
          name: file.name,
          url: downloadURL,
          path: filePath,
          type: fileType,
          uploadedAt: new Date().toISOString(),
          size: file.size,
        };
      });

      const uploadedMaterials = await Promise.all(uploadPromises);
      
      const updatedMaterials = [...(subcategory.materials || []), ...uploadedMaterials];
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, materials: updatedMaterials } : sub
      );
      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });
      setSubcategory({
        ...subcategory,
        materials: updatedMaterials,
      });
      setCategory({
        ...category,
        subcategories: updatedSubcategories,
      });
      toast.success(`${uploadedMaterials.length} material(s) uploaded successfully!`);
    } catch (error) {
      console.error("Error uploading files:", error);
      toast.error(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMaterial = async (index) => {
    try {
      const updatedMaterials = [...(subcategory.materials || [])];
      updatedMaterials.splice(index, 1);
      const categoryRef = doc(db, "coursecategories", categoryId);
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, materials: updatedMaterials } : sub
      );
      await updateDoc(categoryRef, {
        subcategories: updatedSubcategories,
      });
      setSubcategory((prev) => ({
        ...prev,
        materials: updatedMaterials,
      }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));
    } catch (error) {
      console.error("Error removing material:", error);
      toast.error(`Failed to remove material: ${error.message}`);
    }
  };

  const handleAddDate = () => {
    setNewEvent((prev) => ({
      ...prev,
      dates: [
        ...prev.dates,
        {
          date: new Date().toISOString().split("T")[0],
          startHour: "09:00",
          endHour: "10:00",
        },
      ],
    }));
  };

  const handleRemoveDate = (index) => {
    setNewEvent((prev) => ({
      ...prev,
      dates: prev.dates.filter((_, i) => i !== index),
    }));
  };

  const handleDateTimeChange = (index, field, value) => {
    setNewEvent((prev) => {
      const newDates = [...prev.dates];
      const dateEntry = { ...newDates[index] };
      if (field === 'startHour') {
        dateEntry.startHour = value;
        if (dateEntry.endHour < value) {
          dateEntry.endHour = value;
        }
      } else if (field === 'endHour' && value < dateEntry.startHour) {
        return prev;
      } else {
        dateEntry[field] = value;
      }
      newDates[index] = dateEntry;
      return { ...prev, dates: newDates };
    });
  };

  const handleEditDate = (index) => {
    setEditingIndex(index);
    setEditingEntry({ ...newEvent.dates[index] });
  };

  const handleSaveEdit = (index) => {
    setNewEvent((prev) => ({
      ...prev,
      dates: prev.dates.map((date, i) => (i === index ? editingEntry : date)),
    }));
    setEditingIndex(-1);
    setEditingEntry(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(-1);
    setEditingEntry(null);
  };

  const handleEditingChange = (field, value) => {
    setEditingEntry((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAddEvent = async () => {
    setEventAdding(true);
    try {
      if (newEvent.recurring && !newEvent.recurrenceEndDate) {
        toast.error("Please set an end date for recurring events");
        return;
      }
      if (newEvent.dates.length === 0) {
        toast.error("At least one date is required");
        return;
      }
      const eventId = Date.now().toString();
      let allInstances = [];
      if (newEvent.recurring) {
        const totalOccurrences = calculateTotalOccurrences(
          newEvent.dates[0].date,
          newEvent.recurrenceEndDate,
          newEvent.recurrencePattern
        );

        // Log the calculations for debugging
        console.log('Start Date:', newEvent.dates[0].date);
        console.log('End Date:', newEvent.recurrenceEndDate);
        console.log('Pattern:', newEvent.recurrencePattern);
        console.log('Total Occurrences:', totalOccurrences);

        newEvent.dates.forEach((dateEntry) => {
          const baseInstance = {
            startDate: dateEntry.date, // Remove formatDate here to prevent date shifting
            endDate: dateEntry.date,
            startHour: formatTime(dateEntry.startHour),
            endHour: formatTime(dateEntry.endHour),
            totalOccurrences,
            recurring: true,
            recurrencePattern: newEvent.recurrencePattern
          };
          
          const recurringInstances = generateRecurringInstances(baseInstance);
          allInstances = [...allInstances, ...recurringInstances];
        });
      } else {
        allInstances = newEvent.dates.map((dateEntry) => ({
          startDate: formatDate(dateEntry.date),
          endDate: formatDate(dateEntry.date),
          startHour: formatTime(dateEntry.startHour),
          endHour: formatTime(dateEntry.endHour),
        }));
      }
      const eventInstances = allInstances.map((instance, index) => ({
        id: `${eventId}-${index}`,
        parentEventId: eventId,
        categoryId,
        subcategoryId,
        churchId,
        title: newEvent.title,
        startDate: instance.startDate,
        endDate: instance.endDate,
        startHour: instance.startHour,
        endHour: instance.endHour,
        imageUrl: newEvent.useSubcategoryImage
          ? subcategory.imageUrl || ""
          : newEvent.imageUrl,
        useSubcategoryImage: newEvent.useSubcategoryImage,
        instanceNumber: index + 1,
        isRecurring: newEvent.recurring,
        recurrencePattern: newEvent.recurring ? newEvent.recurrencePattern : null,
        isDeleted: false,
        status: "optional",
        instanceTitle: newEvent.title,
        order: index + 1,
      }));

      await Promise.all(
        eventInstances.map((instance) =>
          setDoc(doc(db, "eventInstances", instance.id), instance)
        )
      );
      const baseEvent = {
        id: eventId,
        title: newEvent.title,
        dates: newEvent.dates,
        instances: eventInstances || [],
        isMultiDay: newEvent.dates.length > 1,
        isRecurring: newEvent.recurring,
        recurrencePattern: newEvent.recurring ? newEvent.recurrencePattern : null,
        recurrenceEndDate: newEvent.recurring ? newEvent.recurrenceEndDate : null,
        imageUrl: newEvent.useSubcategoryImage
          ? subcategory.imageUrl || ""
          : newEvent.imageUrl,
      };
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId
          ? {
              ...sub,
              eventIds: [...(sub.eventIds || []), eventId],
              events: [...(sub.events || []), baseEvent],
              isEvent: true,
            }
          : sub
      );
      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });
      setSubcategory((prev) => ({
        ...prev,
        eventIds: [...(prev.eventIds || []), eventId],
        events: [...(prev.events || []), baseEvent],
        isEvent: true,
      }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));
      toast.success("Event created successfully!");

      setNewEvent({
        title: "",
        dates: [
          {
            date: new Date().toISOString().split("T")[0],
            startHour: "09:00",
            endHour: "10:00",
          },
        ],
        recurring: false,
        recurrencePattern: "weekly",
        recurrenceEndDate: "",
        imageUrl: "",
        useSubcategoryImage: true,
        isMultiDay: false,
      });
    } catch (error) {
      console.error("Error adding event:", error);
      toast.error(`Failed to add event: ${error.message}`);
    } finally {
      setEventAdding(false);
    }
  };

  const handleUpdateEvent = async (eventId, updatedEventData) => {
    try {
      const updatedEvents = subcategory.events.map((event) =>
        event.id === eventId ? { ...event, ...updatedEventData } : event
      );
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId ? { ...sub, events: updatedEvents } : sub
      );
      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });
      setSubcategory((prev) => ({
        ...prev,
        events: updatedEvents,
      }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));
    } catch (error) {
      console.error("Error updating event:", error);
      toast.error(`Failed to update event: ${error.message}`);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    try {
      const eventToDelete = subcategory.events.find(event => event.id === eventId);
      if (eventToDelete?.instances) {
        await Promise.all(
          eventToDelete.instances.map(instance => 
            deleteDoc(doc(db, "eventInstances", instance.id))
          )
        );
      }
      const updatedEvents = subcategory.events.filter(
        (event) => event.id !== eventId
      );
      const updatedSubcategories = category.subcategories.map((sub) =>
        sub.id === subcategoryId
          ? {
              ...sub,
              events: updatedEvents,
              isEvent: updatedEvents.length > 0,
              eventIds: (sub.eventIds || []).filter(id => id !== eventId)
            }
          : sub
      );
      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
      });
      setSubcategory((prev) => ({
        ...prev,
        events: updatedEvents,
        isEvent: updatedEvents.length > 0,
        eventIds: (prev.eventIds || []).filter(id => id !== eventId)
      }));
      setCategory((prev) => ({
        ...prev,
        subcategories: updatedSubcategories,
      }));
      toast.success("Event deleted successfully");
    } catch (error) {
      console.error("Error deleting event:", error);
      toast.error(`Failed to delete event: ${error.message}`);
    }
  };

  const handleEventImageUpload = async (file) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const timestamp = Date.now();
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const filePath = `events/${churchId}/${categoryId}/${subcategoryId}/images/${timestamp}_${safeFileName}`;
      const storageRef = ref(storage, filePath);
      const uploadResult = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(uploadResult.ref);

      setNewEvent((prev) => ({
        ...prev,
        imageUrl: downloadURL,
        useSubcategoryImage: false,
      }));
      return downloadURL;
    } catch (error) {
      console.error("Error uploading event image:", error);
      toast.error("Failed to upload image");
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName) {
      console.error("Group name is required");
      return;
    }
    setCreatingGroup(true);
    try {
      const newGroup = {
        groupName: newGroupName,
        churchId: churchId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        members: [
          {
            userId: user.uid,
            displayName: `${user.name} ${user.lastName}`,
            role: user.role,
          },
        ],
      };
      const docRef = await addDoc(collection(db, "groups"), newGroup);
      if (docRef.id) {
        handleUpdate({ groupId: docRef.id });
        toast.success("Group created successfully!");
      }
    } catch (error) {
      console.error("Error creating group:", error);
      toast.error("Failed to create group");
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!groupId) {
      toast.warn("Oops, Try refresh browser!");
      return;
    }
    setDeletingGroup(true);
    try {
      const groupDocRef = doc(db, "groups", groupId);
      await deleteDoc(groupDocRef);
      const docSnap = await getDoc(groupDocRef);
      if (!docSnap.exists()) {
        handleUpdate({ groupId: "", isGroup: false });
        toast.success("Group deleted successfully!");
      }
    } catch (error) {
      console.error("Error deleting group:", error);
      toast.error("Failed to delete group");
    } finally {
      setDeletingGroup(false);
    }
  };

  const handleEditEventInstance = (event, instance) => {
    setEditingEventId(event.id);
    setEditingInstance({
      ...instance,
      date: instance.startDate,
      startHour: instance.startHour.split(" ")[0],
      endHour: instance.endHour.split(" ")[0],
    });
  };

  const handleUpdateInstance = async (eventId, instanceId, updatedData) => {
    try {
      await updateDoc(doc(db, 'eventInstances', instanceId), {
        ...updatedData,
        lastUpdated: serverTimestamp()
      });

      const updatedEvents = subcategory.events.map(event => {
        if (event.id === eventId) {
          return {
            ...event,
            instances: event.instances.map(instance =>
              instance.id === instanceId
                ? { ...instance, ...updatedData }
                : instance
            )
          };
        }
        return event;
      });

      await handleUpdateEvent(eventId, {
        instances: updatedEvents.find(e => e.id === eventId).instances
      });

      setEditingEventId(null);
      setEditingInstance(null);
      toast.success('Event instance updated successfully!');
    } catch (error) {
      console.error('Error updating event instance:', error);
      toast.error('Failed to update event instance');
    }
  };

  const handleSoftDeleteInstance = async (eventId, instanceId) => {
    try {
      await updateDoc(doc(db, "eventInstances", instanceId), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
      });
      const updatedEvents = subcategory.events.map((event) => {
        if (event.id === eventId) {
          return {
            ...event,
            instances: event.instances.map((instance) =>
              instance.id === instanceId ? { ...instance, isDeleted: true } : instance
            ),
          };
        }
        return event;
      });
      await handleUpdateEvent(eventId, {
        instances: updatedEvents.find((e) => e.id === eventId).instances,
      });
      toast.success("Event instance removed");
    } catch (error) {
      console.error("Error removing event instance:", error);
      toast.error("Failed to remove event instance");
    }
  };

  const handleRestoreInstance = async (eventId, instanceId) => {
    try {
      await updateDoc(doc(db, "eventInstances", instanceId), {
        isDeleted: false,
        restoredAt: serverTimestamp(),
      });
      const updatedEvents = subcategory.events.map((event) => {
        if (event.id === eventId) {
          return {
            ...event,
            instances: event.instances.map((instance) =>
              instance.id === instanceId ? { ...instance, isDeleted: false } : instance
            ),
          };
        }
        return event;
      });
      await handleUpdateEvent(eventId, {
        instances: updatedEvents.find((e) => e.id === eventId).instances,
      });
      toast.success("Event instance restored");
    } catch (error) {
      console.error("Error restoring event instance:", error);
      toast.error("Failed to restore event instance");
    }
  };

  const handleEditEvent = (event) => {
    const dates = event.dates || 
      (event.instances || []).map(instance => ({
        date: instance.startDate,
        startHour: instance.startHour?.split(' ')[0] || '09:00',
        endHour: instance.endHour?.split(' ')[0] || '10:00'
      }));
    setEditingEvent({
      ...event,
      dates: dates,
      isRecurring: event.isRecurring || false,
      recurrencePattern: event.recurrencePattern || 'weekly'
    });
  };

  const handleCancelEventEdit = () => {
    setEditingEvent(null);
  };

  const handleSaveEventEdit = async (eventId) => {
    try {
      if (!editingEvent?.dates) {
        toast.error("No dates available to save");
        return;
      }
      
      const originalEvent = subcategory.events.find(e => e.id === eventId);
      if (!originalEvent) {
        toast.error("Event not found");
        return;
      }

      const updatedEvent = {
        ...originalEvent,
        ...editingEvent,
        instances: editingEvent.dates.map((date, index) => ({
          id: `${eventId}-${index}`,
          parentEventId: eventId,
          categoryId,
          subcategoryId,
          churchId,
          title: editingEvent.title,
          startDate: formatDate(date.date),
          endDate: formatDate(date.date),
          startHour: formatTime(date.startHour),
          endHour: formatTime(date.endHour),
          imageUrl: originalEvent.imageUrl || '',
          useSubcategoryImage: originalEvent.useSubcategoryImage || true,
          instanceNumber: index + 1,
          isRecurring: editingEvent.isRecurring,
          recurrencePattern: editingEvent.recurrencePattern,
          isDeleted: false,
          status: 'optional',
          instanceTitle: editingEvent.title,
          order: index + 1
        }))
      };

      await Promise.all(
        updatedEvent.instances.map(instance =>
          setDoc(doc(db, "eventInstances", instance.id), instance)
        )
      );

      await handleUpdateEvent(eventId, updatedEvent);
      setEditingEvent(null);
      toast.success("Event updated successfully!");
    } catch (error) {
      console.error("Error updating event:", error);
      toast.error("Failed to update event");
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!subcategory) {
    return <div className="error">Subcategory not found</div>;
  }

  const VideoEmbed = ({ link, onClose }) => {
    const videoInfo = extractVideoId(link.url);
    const embedUrl = getEmbedUrl(videoInfo);

    return (
      <div className="video-embed-container">
        <div className="video-embed-header">
          <h5>Video Preview</h5>
          <button
            onClick={onClose}
            className="btn-icon close-embed"
            title="Close preview"
          >
            ✕
          </button>
        </div>
        <div className="video-embed">
          {videoInfo && embedUrl ? (
            videoInfo.platform === 'direct' ? (
              <video controls className="direct-video-player">
                <source src={embedUrl} type={`video/${embedUrl.split('.').pop()}`} />
                Your browser does not support the video tag.
              </video>
            ) : (
              <iframe
                src={embedUrl}
                title={link.title}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="video-iframe"
              ></iframe>
            )
          ) : (
            <div className="video-embed-error">
              <p>Unable to preview this video. The URL format is not supported.</p>
              <button
                onClick={onClose}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="subcategory-settings">
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={true}
        newestOnTop={true}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable
        pauseOnHover={false}
        theme="light"
        limit={2}
      />

      {/* Header Section */}
      <div className="settings-header">
        <div className="header-content">
          <button
            onClick={() => navigate(`/church/${churchId}/course-categories`)}
            className="back-button"
          >
            ← Back to Categories
          </button>
          <div className="header-info">
            <h1 className="page-title">{subcategory.name}</h1>
            <p className="page-subtitle">Manage subcategory settings and content</p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="settings-navigation">
        <nav className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            <span className="tab-icon">⚙️</span>
            Basic Settings
          </button>
          <button
            className={`nav-tab ${activeTab === 'content' ? 'active' : ''}`}
            onClick={() => setActiveTab('content')}
          >
            <span className="tab-icon">📄</span>
            Content
          </button>
          <button
            className={`nav-tab ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            <span className="tab-icon">📅</span>
            Events
          </button>
          <button
            className={`nav-tab ${activeTab === 'materials' ? 'active' : ''}`}
            onClick={() => setActiveTab('materials')}
          >
            <span className="tab-icon">📚</span>
            Materials
          </button>
          <button
            className={`nav-tab ${activeTab === 'videos' ? 'active' : ''}`}
            onClick={() => setActiveTab('videos')}
          >
            <span className="tab-icon">🎥</span>
            Video Links
          </button>
          <button
            className={`nav-tab ${activeTab === 'groups' ? 'active' : ''}`}
            onClick={() => setActiveTab('groups')}
          >
            <span className="tab-icon">👥</span>
            Groups
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'basic' && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>Basic Information</h2>
              <p>Configure the fundamental settings for this subcategory</p>
            </div>

            <div className="settings-grid">
              <div className="setting-card">
                <div className="card-header">
                  <h3>Subcategory Details</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label htmlFor="subcategory-name">Name</label>
                    <input
                      id="subcategory-name"
                      type="text"
                      value={subcategory.name}
                      onChange={(e) => handleUpdate({ name: e.target.value })}
                      className="form-input"
                      placeholder="Enter subcategory name"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="subcategory-description">Description</label>
                    <textarea
                      id="subcategory-description"
                      value={subcategory.description || ""}
                      onChange={(e) => handleUpdate({ description: e.target.value })}
                      className="form-textarea"
                      placeholder="Enter subcategory description"
                      rows={4}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="subcategory-order">Display Order</label>
                    <input
                      id="subcategory-order"
                      type="number"
                      min="1"
                      value={subcategory.order || 1}
                      onChange={(e) => handleUpdate({ order: parseInt(e.target.value) })}
                      className="form-input"
                    />
                    <p className="form-help">Lower numbers appear first in the list</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'content' && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>Content Associations</h2>
              <p>Link forms and galleries to enhance the learning experience</p>
            </div>

            <div className="settings-grid">
              <div className="setting-card">
                <div className="card-header">
                  <h3>Form Integration</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label htmlFor="associated-form">Associated Form</label>
                    {loadingForms ? (
                      <div className="loading-indicator">
                        <Spinner animation="border" size="sm" />
                        Loading forms...
                      </div>
                    ) : (
                      <select
                        id="associated-form"
                        value={subcategory.formId || ""}
                        onChange={(e) => handleUpdate({ formId: e.target.value })}
                        className="form-select"
                      >
                        <option value="">No form selected</option>
                        {forms.map((form) => (
                          <option key={form.id} value={form.id}>
                            {form.title || `Form ${form.id}`}
                          </option>
                        ))}
                      </select>
                    )}
                    {subcategory.formId && (
                      <p className="form-help">
                        This form will be displayed when users access this subcategory
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="setting-card">
                <div className="card-header">
                  <h3>Gallery Integration</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label htmlFor="associated-gallery">Associated Gallery</label>
                    {loadingGalleries ? (
                      <div className="loading-indicator">
                        <Spinner animation="border" size="sm" />
                        Loading galleries...
                      </div>
                    ) : (
                      <select
                        id="associated-gallery"
                        value={subcategory.galleryId || ""}
                        onChange={(e) => handleUpdate({ galleryId: e.target.value })}
                        className="form-select"
                      >
                        <option value="">No gallery selected</option>
                        {galleries.map((gallery) => (
                          <option key={gallery.id} value={gallery.id}>
                            {gallery.title || gallery.name || `Gallery ${gallery.id}`}
                            {gallery.images && ` (${gallery.images.length} images)`}
                          </option>
                        ))}
                      </select>
                    )}
                    {subcategory.galleryId && (
                      <p className="form-help">
                        This gallery will be displayed when users access this subcategory
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>Event Management</h2>
              <p>Schedule and manage events for this subcategory</p>
            </div>

            <div className="settings-grid">
              <div className="setting-card full-width">
                <div className="card-header">
                  <h3>Event Configuration</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <div className="checkbox-wrapper">
                      <input
                        type="checkbox"
                        id="isEvent"
                        checked={subcategory.isEvent || false}
                        onChange={(e) => handleUpdate({ isEvent: e.target.checked })}
                        className="form-checkbox"
                      />
                      <label htmlFor="isEvent" className="checkbox-label">
                        Enable event functionality for this subcategory
                      </label>
                    </div>
                  </div>

                  {subcategory.isEvent && (
                    <div className="event-management-section">
                      {/* Existing Events */}
                      {subcategory.events && subcategory.events.length > 0 && (
                        <div className="existing-events">
                          <h4>Scheduled Events</h4>
                          <div className="events-grid">
                            {subcategory.events.map((event) => (
                              <div key={event.id} className="event-card">
                                {editingEvent?.id === event.id ? (
                                  <div className="event-edit-form">
                                    <div className="form-group">
                                      <label>Event Title</label>
                                      <input
                                        type="text"
                                        value={editingEvent.title}
                                        onChange={(e) => setEditingEvent({...editingEvent, title: e.target.value})}
                                        className="form-input"
                                      />
                                    </div>
                                    <div className="form-group">
                                      <div className="checkbox-wrapper">
                                        <input
                                          type="checkbox"
                                          id={`isRecurring-${event.id}`}
                                          checked={editingEvent.isRecurring}
                                          disabled={true}
                                          className="form-checkbox"
                                        />
                                        <label htmlFor={`isRecurring-${event.id}`}>
                                          {editingEvent.isRecurring ? "Recurring event" : "One-time event"}
                                        </label>
                                      </div>
                                    </div>
                                    {editingEvent.isRecurring && (
                                      <div className="recurring-options">
                                        <div className="form-group">
                                          <label>Pattern</label>
                                          <select
                                            value={editingEvent.recurrencePattern}
                                            onChange={(e) =>
                                              setEditingEvent({
                                                ...editingEvent,
                                                recurrencePattern: e.target.value,
                                              })
                                            }
                                            className="form-select"
                                          >
                                            <option value="daily">Daily</option>
                                            <option value="weekly">Weekly</option>
                                            <option value="biweekly">Bi-weekly</option>
                                            <option value="monthly">Monthly</option>
                                            <option value="yearly">Yearly</option>
                                          </select>
                                        </div>
                                        <div className="form-group">
                                          <label>End Date</label>
                                          <input
                                            type="date"
                                            value={editingEvent.recurrenceEndDate || ""}
                                            onChange={(e) =>
                                              setEditingEvent({
                                                ...editingEvent,
                                                recurrenceEndDate: e.target.value,
                                              })
                                            }
                                            className="form-input"
                                            min={editingEvent.dates[0].date}
                                          />
                                        </div>
                                      </div>
                                    )}
                                    {editingEvent?.dates?.map((date, index) => (
                                      <div key={index} className="date-entry">
                                        <label>Day {index + 1}</label>
                                        <input
                                          type="date"
                                          value={date.date}
                                          onChange={(e) => {
                                            const newDates = [...editingEvent.dates];
                                            newDates[index] = {...date, date: e.target.value};
                                            setEditingEvent({...editingEvent, dates: newDates});
                                          }}
                                          className="form-input"
                                        />
                                        <div className="time-inputs">
                                          <input
                                            type="time"
                                            value={date.startHour}
                                            onChange={(e) => {
                                              const newDates = [...editingEvent.dates];
                                              if (date.endHour < e.target.value) {
                                                newDates[index] = {
                                                  ...date,
                                                  startHour: e.target.value,
                                                  endHour: e.target.value,
                                                };
                                              } else {
                                                newDates[index] = {...date, startHour: e.target.value};
                                              }
                                              setEditingEvent({...editingEvent, dates: newDates});
                                            }}
                                            className="form-input time-input"
                                          />
                                          <input
                                            type="time"
                                            value={date.endHour}
                                            min={date.startHour}
                                            onChange={(e) => {
                                              const newDates = [...editingEvent.dates];
                                              if (e.target.value >= date.startHour) {
                                                newDates[index] = {...date, endHour: e.target.value};
                                                setEditingEvent({...editingEvent, dates: newDates});
                                              }
                                            }}
                                            className="form-input time-input"
                                          />
                                        </div>
                                      </div>
                                    ))}
                                    <div className="form-actions">
                                      <button onClick={() => handleSaveEventEdit(event.id)} className="btn-primary">
                                        Save Changes
                                      </button>
                                      <button onClick={handleCancelEventEdit} className="btn-secondary">
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="event-content">
                                    <div className="event-header">
                                      <h5>{event.title}</h5>
                                      {event.isRecurring && (
                                        <span className="recurring-badge">
                                          🔄 {event.recurrencePattern}
                                        </span>
                                      )}
                                      <div className="event-actions">
                                        <button
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleEditEvent(event);
                                          }}
                                          className="btn-icon"
                                          title="Edit event"
                                        >
                                          ✏️
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleDeleteEvent(event.id);
                                          }}
                                          className="btn-icon btn-danger"
                                          title="Delete event"
                                        >
                                          🗑️
                                        </button>
                                      </div>
                                    </div>
                                    <div className="event-instances">
                                      {(event.instances || []).slice(0, 3).map((instance) => (
                                        <div key={instance.id} className="event-instance">
                                          <div className="instance-info">
                                            <span className="instance-date">{instance.startDate}</span>
                                            <span className="instance-time">{instance.startHour} - {instance.endHour}</span>
                                            <span className={`status-badge ${instance.status}`}>
                                              {instance.status}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                      {(event.instances || []).length > 3 && (
                                        <div className="more-instances">
                                          +{(event.instances || []).length - 3} more instances
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add New Event */}
                      <div className="add-event-section">
                        <h4>Add New Event</h4>
                        <div className="event-form">
                          <div className="form-group">
                            <label htmlFor="event-title">Event Title</label>
                            <input
                              id="event-title"
                              type="text"
                              value={newEvent.title}
                              onChange={(e) =>
                                setNewEvent({ ...newEvent, title: e.target.value })
                              }
                              placeholder="Enter event title"
                              className="form-input"
                            />
                          </div>

                          <div className="form-group">
                            <div className="checkbox-wrapper">
                              <input
                                type="checkbox"
                                id="isRecurring"
                                checked={newEvent.recurring}
                                onChange={(e) =>
                                  setNewEvent({ ...newEvent, recurring: e.target.checked })
                                }
                                className="form-checkbox"
                              />
                              <label htmlFor="isRecurring">
                                Recurring event
                              </label>
                            </div>
                          </div>

                          {newEvent.recurring && (
                            <div className="recurring-config">
                              <div className="form-row">
                                <div className="form-group">
                                  <label htmlFor="recurrence-pattern">Pattern</label>
                                  <select
                                    id="recurrence-pattern"
                                    value={newEvent.recurrencePattern}
                                    onChange={(e) => {
                                      setNewEvent({ ...newEvent, recurrencePattern: e.target.value });
                                      if (newEvent.recurrenceEndDate) {
                                        const count = calculateInstances(
                                          newEvent.dates[0].date,
                                          newEvent.recurrenceEndDate,
                                          e.target.value
                                        );
                                        setPreviewInstances(count);
                                      }
                                    }}
                                    className="form-select"
                                  >
                                    <option value="weekly">Weekly</option>
                                    <option value="biweekly">Bi-weekly</option>
                                    <option value="monthly">Monthly</option>
                                    <option value="yearly">Yearly</option>
                                  </select>
                                </div>
                                <div className="form-group">
                                  <label htmlFor="recurrence-end">End Date</label>
                                  <input
                                    id="recurrence-end"
                                    type="date"
                                    value={newEvent.recurrenceEndDate}
                                    onChange={(e) =>
                                      setNewEvent({ ...newEvent, recurrenceEndDate: e.target.value })
                                    }
                                    className="form-input"
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="form-group">
                            <label>Schedule</label>
                            <div className="schedule-builder">
                              {newEvent.dates.map((date, index) => (
                                <div key={index} className="schedule-item">
                                  <div className="date-time-row">
                                    <input
                                      type="date"
                                      value={date.date}
                                      onChange={(e) => {
                                        const newDates = [...newEvent.dates];
                                        newDates[index] = { ...date, date: e.target.value };
                                        setNewEvent({ ...newEvent, dates: newDates });
                                      }}
                                      className="form-input"
                                    />
                                    <div className="time-range">
                                      <input
                                        type="time"
                                        value={date.startHour}
                                        onChange={(e) => {
                                          const newDates = [...newEvent.dates];
                                          newDates[index] = { ...date, startHour: e.target.value };
                                          setNewEvent({ ...newEvent, dates: newDates });
                                        }}
                                        className="form-input time-input"
                                      />
                                      <span className="time-separator">to</span>
                                      <input
                                        type="time"
                                        value={date.endHour}
                                        onChange={(e) => {
                                          const newDates = [...newEvent.dates];
                                          newDates[index] = { ...date, endHour: e.target.value };
                                          setNewEvent({ ...newEvent, dates: newDates });
                                        }}
                                        className="form-input time-input"
                                      />
                                    </div>
                                    {newEvent.dates.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newDates = newEvent.dates.filter((_, i) => i !== index);
                                          setNewEvent({ ...newEvent, dates: newDates });
                                        }}
                                        className="btn-icon btn-danger"
                                        title="Remove date"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  const newDates = [...newEvent.dates, {
                                    date: new Date().toISOString().split("T")[0],
                                    startHour: "09:00",
                                    endHour: "10:00",
                                  }];
                                  setNewEvent({ ...newEvent, dates: newDates });
                                }}
                                className="btn-secondary"
                              >
                                + Add Another Date
                              </button>
                            </div>
                          </div>

                          <div className="form-actions">
                            <button
                              onClick={handleAddEvent}
                              disabled={!newEvent.title.trim() || isAddingEvent}
                              className="btn-primary"
                            >
                              {isAddingEvent ? "Creating Event..." : "Create Event"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'materials' && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>Materials Management</h2>
              <p>Upload and organize learning materials for this subcategory</p>
            </div>

            <div className="materials-section">
              <div className="upload-section">
                <div className="upload-area">
                  <input
                    type="file"
                    multiple
                    onChange={(e) => handleFileUpload(e.target.files)}
                    className="file-input"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="upload-label">
                    <div className="upload-icon">📁</div>
                    <div className="upload-text">
                      <strong>Click to upload</strong> or drag and drop
                    </div>
                    <div className="upload-subtext">
                      PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, images, videos, audio files
                    </div>
                  </label>
                </div>
                {uploading && (
                  <div className="upload-progress">
                    <Spinner animation="border" />
                    Uploading files...
                  </div>
                )}
              </div>

              {subcategory.materials && subcategory.materials.length > 0 && (
                <div className="materials-list">
                  <h4>Uploaded Materials</h4>
                  <div className="materials-grid">
                    {subcategory.materials.map((material, index) => (
                      <div key={index} className="material-item">
                        <div className="material-icon">
                          {material.type === 'image' && '🖼️'}
                          {material.type === 'video' && '🎥'}
                          {material.type === 'audio' && '🎵'}
                          {material.type === 'document' && '📄'}
                        </div>
                        <div className="material-info">
                          <h5>{material.name}</h5>
                          <p>{(material.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                        <div className="material-actions">
                          <a
                            href={material.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-icon"
                            title="View/Download"
                          >
                            👁️
                          </a>
                          <button
                            onClick={() => {
                              const updatedMaterials = subcategory.materials.filter((_, i) => i !== index);
                              handleUpdate({ materials: updatedMaterials });
                            }}
                            className="btn-icon btn-danger"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'videos' && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>Video Links</h2>
              <p>Add and manage video links for this subcategory</p>
            </div>

            <div className="settings-grid">
              <div className="setting-card full-width">
                <div className="card-header">
                  <h3>Add New Video Link</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label htmlFor="video-title">Video Title</label>
                    <input
                      id="video-title"
                      type="text"
                      value={newVideoTitle}
                      onChange={(e) => setNewVideoTitle(e.target.value)}
                      placeholder="Enter video title"
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="video-description">Description (Optional)</label>
                    <textarea
                      id="video-description"
                      value={newVideoDescription}
                      onChange={(e) => setNewVideoDescription(e.target.value)}
                      placeholder="Enter video description"
                      className="form-textarea"
                      rows={3}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="video-url">Video URL</label>
                    <input
                      id="video-url"
                      type="url"
                      value={newVideoUrl}
                      onChange={(e) => setNewVideoUrl(e.target.value)}
                      placeholder="https://example.com/video"
                      className="form-input"
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      onClick={handleAddVideoLink}
                      disabled={!newVideoTitle.trim() || !newVideoUrl.trim()}
                      className="btn-primary"
                    >
                      Add Video Link
                    </button>
                  </div>
                </div>
              </div>

              {(subcategory.videoLinks || []).length > 0 && (
                <div className="setting-card full-width">
                  <div className="card-header">
                    <h3>Existing Video Links</h3>
                  </div>
                  <div className="card-body">
                    <div className="video-links-list">
                      {(subcategory.videoLinks || []).map((link, index) => (
                        <div key={link.id || index} className="video-link-item">
                          <div className="video-order">
                            <span className="order-number">{link.order || (index + 1)}</span>
                            <div className="order-controls">
                              <button
                                onClick={() => handleReorderVideoLinks(link.id, 'up')}
                                disabled={index === 0}
                                className="btn-icon order-btn"
                                title="Move up"
                              >
                                ▲
                              </button>
                              <button
                                onClick={() => handleReorderVideoLinks(link.id, 'down')}
                                disabled={index === (subcategory.videoLinks || []).length - 1}
                                className="btn-icon order-btn"
                                title="Move down"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                          <div className="video-link-info">
                            <h4>{link.title}</h4>
                            {link.description && <p>{link.description}</p>}
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="video-link-url"
                            >
                              {link.url}
                            </a>
                          </div>
                          <div className="video-link-actions">
                            <button
                              onClick={() => handlePreviewVideo(link.id)}
                              className={`btn-secondary btn-icon ${previewVideoId === link.id ? 'active' : ''}`}
                              title="Preview video"
                            >
                              ▶️
                            </button>
                            <button
                              onClick={() => {
                                setEditingVideoId(link.id);
                                setEditingVideoData({
                                  title: link.title,
                                  description: link.description || '',
                                  url: link.url
                                });
                              }}
                              className="btn-secondary btn-icon"
                              title="Edit video link"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteVideoLink(link.id)}
                              className="btn-danger btn-icon"
                              title="Delete video link"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      ))}
                      {previewVideoId && (() => {
                        const currentLink = (subcategory.videoLinks || []).find(link => link.id === previewVideoId);
                        return currentLink ? (
                          <VideoEmbed link={currentLink} onClose={() => setPreviewVideoId(null)} />
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {editingVideoId && (
                <div className="setting-card full-width">
                  <div className="card-header">
                    <h3>Edit Video Link</h3>
                  </div>
                  <div className="card-body">
                    <div className="form-group">
                      <label htmlFor="edit-video-title">Video Title</label>
                      <input
                        id="edit-video-title"
                        type="text"
                        value={editingVideoData.title}
                        onChange={(e) => setEditingVideoData(prev => ({ ...prev, title: e.target.value }))}
                        className="form-input"
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="edit-video-description">Description (Optional)</label>
                      <textarea
                        id="edit-video-description"
                        value={editingVideoData.description}
                        onChange={(e) => setEditingVideoData(prev => ({ ...prev, description: e.target.value }))}
                        className="form-textarea"
                        rows={3}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="edit-video-url">Video URL</label>
                      <input
                        id="edit-video-url"
                        type="url"
                        value={editingVideoData.url}
                        onChange={(e) => setEditingVideoData(prev => ({ ...prev, url: e.target.value }))}
                        className="form-input"
                      />
                    </div>

                    <div className="form-actions">
                      <button
                        onClick={() => handleEditVideoLink(editingVideoId)}
                        disabled={!editingVideoData.title.trim() || !editingVideoData.url.trim()}
                        className="btn-primary"
                      >
                        Update Video Link
                      </button>
                      <button
                        onClick={() => {
                          setEditingVideoId(null);
                          setEditingVideoData({ title: '', description: '', url: '' });
                        }}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'groups' && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>Group Management</h2>
              <p>Create and manage study groups for this subcategory</p>
            </div>

            <div className="settings-grid">
              <div className="setting-card full-width">
                <div className="card-header">
                  <h3>Group Configuration</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <div className="checkbox-wrapper">
                      <input
                        type="checkbox"
                        id="isGroup"
                        checked={subcategory.isGroup || false}
                        onChange={(e) => handleUpdate({ isGroup: e.target.checked })}
                        className="form-checkbox"
                      />
                      <label htmlFor="isGroup" className="checkbox-label">
                        Enable group functionality for this subcategory
                      </label>
                    </div>
                  </div>

                  {subcategory.isGroup && (
                    <div className="group-management-section">
                      {subcategory.groupId ? (
                        <div className="existing-group">
                          <div className="group-info">
                            <h4>Active Group</h4>
                            <p>This subcategory is associated with a study group.</p>
                            <div className="group-actions">
                              <button
                                onClick={() => handleDeleteGroup(subcategory.groupId)}
                                disabled={isDeletingGroup}
                                className="btn-danger"
                              >
                                {isDeletingGroup ? "Deleting..." : "Delete Group"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="create-group">
                          <h4>Create Study Group</h4>
                          <div className="form-group">
                            <label htmlFor="group-name">Group Name</label>
                            <input
                              id="group-name"
                              type="text"
                              value={newGroupName}
                              onChange={(e) => setNewGroupName(e.target.value)}
                              placeholder="Enter group name"
                              className="form-input"
                            />
                          </div>
                          <div className="form-actions">
                            <button
                              onClick={handleCreateGroup}
                              disabled={!newGroupName.trim() || isCreatingGroup}
                              className="btn-primary"
                            >
                              {isCreatingGroup ? "Creating Group..." : "Create Group"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const eventItemStyles = `
.event-date-entry {
  padding: 8px;
  border-bottom: 1px solid #eee;
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px;
}

.date-label {
  font-weight: bold;
  color: #666;
}

.date-times {
  display: flex;
  justify-content: space-between;
}

.recurrence-info {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #ddd;
  color: #666;
  font-style: italic;
}

.event-instance {
  padding: 12px;
  border: 1px solid #eee;
  margin: 8px 0;
  border-radius: 4px;
}

.instance-details {
  display: flex;
  gap: 10px;
  align-items: center;
}

.instance-details select {
  margin-left: 10px;
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid #ddd;
  background-color: white;
}

.instance-details select[disabled] {
  background-color: #f5f5f5;
  cursor: not-allowed;
}

.instance-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.instance-actions button {
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.instance-edit-form {
  display: grid;
  gap: 10px;
}

.restore-btn {
  background-color: #28a745;
  color: white;
}

.deleted {
  border-style: dashed;
}

.event-edit-form {
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
  margin: 10px 0;
}

.date-edit-entry {
  margin: 15px 0;
  padding: 10px;
  border: 1px solid #eee;
  border-radius: 4px;
  background: white;
}

.time-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}

.edit-actions {
  display: flex;
  gap: 10px;
  margin-top: 15px;
}

.save-btn {
  background: #28a745;
  color: white;
  border: none;
  padding: 5px 15px;
  border-radius: 4px;
  cursor: pointer;
}

.cancel-btn {
  background: #6c757d;
  color: white;
  border: none;
  padding: 5px 15px;
  border-radius: 4px;
  cursor: pointer;
}

.event-actions {
  display: flex;
  gap: 10px;
}

.edit-event-btn {
  background: #007bff;
  color: white;
  border: none;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.recurring-options {
  margin-top: 15px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 4px;
  border: 1px solid #eee;
}

.required {
  color: #dc3545;
  margin-left: 2px;
}

.instances-preview {
  margin-top: 10px;
  padding: 10px;
  background: #e9ecef;
  border-radius: 4px;
  font-size: 0.9em;
  color: #495057;
}

.instances-preview strong {
  color: #28a745;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  text-transform: capitalize;
}

.status-badge.required {
  background-color: #dc3545;
  color: white;
}

.status-badge.optional {
  background-color: #6c757d;
  color: white;
}

.instance-order {
  color: #666;
  font-weight: bold;
  min-width: 40px;
}

.instance-title {
  font-weight: 500;
  margin-right: 10px;
}

.edit-instance-btn {
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}

.edit-instance-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`;

const styleSheet = document.createElement("style");
styleSheet.innerText = eventItemStyles;
document.head.appendChild(styleSheet);

export default SubcategorySettings;