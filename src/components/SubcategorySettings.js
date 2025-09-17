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
  const { churchId, categoryId, subcategoryId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  // Video Links State
  const [newVideoTitle, setNewVideoTitle] = useState("");
  const [newVideoDescription, setNewVideoDescription] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [editingVideoId, setEditingVideoId] = useState(null);
  const [editingVideoData, setEditingVideoData] = useState({ title: "", description: "", url: "" });

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
    const fetchData = async () => {
      try {
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

  return (
    <div style={commonStyles.container}>
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
      <div style={{ textAlign: "left", marginBottom: "2rem" }}>
        <button
          onClick={() => navigate(`/church/${churchId}/course-categories`)}
          style={commonStyles.backButtonLink}
        >
          ← Back to Categories
        </button>
      </div>

      <div className="settings-container">
        <h1 className="page-title">{subcategory.name} Settings</h1>

        {/* Basic Settings Section */}
        <div className="settings-section">
          <h2 className="section-title">Basic Settings</h2>
          <div className="section-content">
            <div className="form-group">
              <label>Name:</label>
              <input
                type="text"
                value={subcategory.name}
                onChange={(e) => handleUpdate({ name: e.target.value })}
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label>Description:</label>
              <textarea
                value={subcategory.description || ""}
                onChange={(e) => handleUpdate({ description: e.target.value })}
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label>Order Number:</label>
              <input
                type="number"
                min="1"
                value={subcategory.order || 1}
                onChange={(e) => handleUpdate({ order: parseInt(e.target.value) })}
                className="form-control"
              />
            </div>
          </div>
        </div>

        {/* Content Settings Section */}
        <div className="settings-section">
          <h2 className="section-title">Content Settings</h2>
          <div className="section-content">
            <div className="form-group">
              <label>Associated Form:</label>
              {loadingForms ? (
                <div style={{ padding: '10px', color: '#666' }}>Loading forms...</div>
              ) : (
                <select
                  value={subcategory.formId || ""}
                  onChange={(e) => handleUpdate({ formId: e.target.value })}
                  className="form-control"
                  style={{ width: '100%' }}
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
                <small style={{ color: '#666', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                  Selected form will be displayed in the course detail view
                </small>
              )}
            </div>

            <div className="form-group">
              <label>Associated Gallery:</label>
              {loadingGalleries ? (
                <div style={{ padding: '10px', color: '#666' }}>Loading galleries...</div>
              ) : (
                <select
                  value={subcategory.galleryId || ""}
                  onChange={(e) => handleUpdate({ galleryId: e.target.value })}
                  className="form-control"
                  style={{ width: '100%' }}
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
                <small style={{ color: '#666', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                  Selected gallery will be displayed in the course detail view
                </small>
              )}
            </div>
          </div>
        </div>

        {/* Event Settings Section */}
        <div className="settings-section">
          <h2 className="section-title">Event Settings</h2>
          <div className="section-content">
            <div className="form-group">
              <div className="checkbox-container">
                <input
                  type="checkbox"
                  id="isEvent"
                  checked={subcategory.isEvent || false}
                  onChange={(e) => handleUpdate({ isEvent: e.target.checked })}
                  className="event-checkbox"
                />
                <label
                  htmlFor="isEvent"
                  className="checkbox-label"
                  style={{ marginTop: "10px" }}
                >
                  Is this an event?
                </label>
              </div>
            </div>
            {subcategory.isEvent && (
              <div className="event-fields">
                <h4>Event Management</h4>
                {subcategory.events && subcategory.events.length > 0 && (
                  <div className="events-list">
                    <h5>Scheduled Events</h5>
                    {subcategory.events.map((event) => (
                      <div key={event.id} className="event-item">
                        {editingEvent?.id === event.id ? (
                          <div className="event-edit-form">
                            <div className="form-group">
                              <label>Event Title:</label>
                              <input
                                type="text"
                                value={editingEvent.title}
                                onChange={(e) => setEditingEvent({...editingEvent, title: e.target.value})}
                                className="form-control"
                              />
                            </div>
                            <div className="form-group">
                              <div className="checkbox-container">
                                <input
                                  type="checkbox"
                                  id={`isRecurring-${event.id}`}
                                  checked={editingEvent.isRecurring}
                                  disabled={true}
                                  className="event-checkbox"
                                />
                                <label htmlFor={`isRecurring-${event.id}`} className="checkbox-label">
                                  {editingEvent.isRecurring ? "Recurring event" : "One-time event"}
                                </label>
                              </div>
                              {editingEvent.isRecurring && (
                                <div className="recurring-options">
                                  <div className="form-group">
                                    <label>Recurrence Pattern:</label>
                                    <select
                                      value={editingEvent.recurrencePattern}
                                      onChange={(e) =>
                                        setEditingEvent({
                                          ...editingEvent,
                                          recurrencePattern: e.target.value,
                                        })
                                      }
                                      className="form-control"
                                    >
                                      <option value="daily">Daily</option>
                                      <option value="weekly">Weekly</option>
                                      <option value="biweekly">Bi-weekly</option>
                                      <option value="monthly">Monthly</option>
                                      <option value="yearly">Yearly</option>
                                    </select>
                                  </div>
                                  <div className="form-group">
                                    <label>Recurrence End Date:</label>
                                    <input
                                      type="date"
                                      value={editingEvent.recurrenceEndDate || ""}
                                      onChange={(e) =>
                                        setEditingEvent({
                                          ...editingEvent,
                                          recurrenceEndDate: e.target.value,
                                        })
                                      }
                                      className="form-control"
                                      min={editingEvent.dates[0].date}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                            {editingEvent?.dates?.map((date, index) => (
                              <div key={index} className="date-edit-entry">
                                <label>Day {index + 1}:</label>
                                <input
                                  type="date"
                                  value={date.date}
                                  onChange={(e) => {
                                    const newDates = [...editingEvent.dates];
                                    newDates[index] = {...date, date: e.target.value};
                                    setEditingEvent({...editingEvent, dates: newDates});
                                  }}
                                  className="form-control"
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
                                    className="form-control"
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
                                    className="form-control"
                                  />
                                </div>
                              </div>
                            ))}
                            <div className="edit-actions">
                              <button onClick={() => handleSaveEventEdit(event.id)} className="save-btn">
                                Save Changes
                              </button>
                              <button onClick={handleCancelEventEdit} className="cancel-btn">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="event-item-header">
                              <h6>
                                {event.title}
                                {event.isRecurring && (
                                  <span className="recurring-badge">
                                    🔄 {event.recurrencePattern}
                                  </span>
                                )}
                              </h6>
                              <div className="event-actions">
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleEditEvent(event);
                                  }}
                                  className="edit-event-btn"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDeleteEvent(event.id);
                                  }}
                                  className="delete-event-btn"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                            <div className="event-instances">
                              {(event.instances || []).map((instance) => (
                                <div
                                  key={instance.id}
                                  className={`event-instance ${instance.isDeleted ? "deleted" : ""}`}
                                  style={{
                                    opacity: instance.isDeleted ? 0.6 : 1,
                                    backgroundColor: instance.isDeleted ? "#fff5f5" : "#ffffff",
                                  }}
                                >
                                  <div className="instance-details">
                                    {editingEventId === event.id && editingInstance?.id === instance.id ? (
                                      <>
                                        <input
                                          type="text"
                                          value={editingInstance.instanceTitle || editingInstance.title}
                                          onChange={(e) => setEditingInstance({
                                            ...editingInstance,
                                            instanceTitle: e.target.value
                                          })}
                                          className="form-control"
                                          placeholder="Instance title"
                                        />
                                        <input
                                          type="number"
                                          value={editingInstance.order || 1}
                                          onChange={(e) => setEditingInstance({
                                            ...editingInstance,
                                            order: parseInt(e.target.value)
                                          })}
                                          className="form-control"
                                          min="1"
                                          style={{ width: '80px' }}
                                        />
                                        <select
                                          value={editingInstance.status || 'optional'}
                                          onChange={(e) => setEditingInstance({
                                            ...editingInstance,
                                            status: e.target.value
                                          })}
                                          className="form-control"
                                        >
                                          <option value="required">Required</option>
                                          <option value="optional">Optional</option>
                                        </select>
                                        <button onClick={() => handleUpdateInstance(event.id, instance.id, editingInstance)}>
                                          Save
                                        </button>
                                        <button onClick={() => {
                                          setEditingEventId(null);
                                          setEditingInstance(null);
                                        }}>
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <span className="instance-order">#{instance.order}</span>
                                        <span className="instance-title">{instance.instanceTitle || instance.title}</span>
                                        <span>{instance.startDate} at {instance.startHour}</span>
                                        <span>to</span>
                                        <span>{instance.endHour}</span>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                          <span className={`status-badge ${instance.status}`}>
                                            {instance.status}
                                          </span>
                                          <span style={{
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            fontSize: '0.8em',
                                            backgroundColor: '#e2e8f0',
                                            color: '#4a5568'
                                          }}>
                                            Order: {instance.order}
                                          </span>
                                        </div>
                                        <button
                                          onClick={() => handleEditEventInstance(event, instance)}
                                          className="edit-instance-btn"
                                          disabled={instance.isDeleted}
                                        >
                                          Edit
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="add-event-form">
                  <h5>Add New Event</h5>
                  <div className="form-group">
                    <label>Event Title:</label>
                    <input
                      type="text"
                      value={newEvent.title}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, title: e.target.value })
                      }
                      placeholder="Enter event title"
                      className="form-control"
                    />
                  </div>
                  <div className="form-group">
                    <div className="checkbox-container">
                      <input
                        type="checkbox"
                        id="isRecurring"
                        checked={newEvent.recurring}
                        onChange={(e) =>
                          setNewEvent({ ...newEvent, recurring: e.target.checked })
                        }
                        className="event-checkbox"
                      />
                      <label htmlFor="isRecurring" className="checkbox-label">
                        Make this a recurring event
                      </label>
                    </div>
                    {newEvent.recurring && (
                      <div className="recurring-options">
                        <div className="form-group">
                          <label>Recurrence Pattern:</label>
                          <select
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
                            className="form-control"
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="biweekly">Bi-weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="yearly">Yearly</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Recurrence End Date: <span className="required">*</span></label>
                          <input
                            type="date"
                            value={newEvent.recurrenceEndDate}
                            onChange={(e) => {
                              setNewEvent({ ...newEvent, recurrenceEndDate: e.target.value });
                              const count = calculateInstances(
                                newEvent.dates[0].date,
                                e.target.value,
                                newEvent.recurrencePattern
                              );
                              setPreviewInstances(count);
                            }}
                            className="form-control"
                            min={newEvent.dates[0].date}
                            required
                          />
                        </div>
                        {previewInstances > 0 && (
                          <div className="instances-preview">
                            This will create <strong>{previewInstances}</strong> event instances.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div
                    className="event-dates"
                    style={{ display: "flex", flexDirection: "column", gap: "20px" }}
                  >
                    {newEvent.dates.map((dateEntry, index) => (
                      <div
                        key={index}
                        className="date-entry"
                        style={{
                          padding: "15px",
                          border: "1px solid #eee",
                          borderRadius: "8px",
                          backgroundColor: "#fafafa",
                          width: "100%",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "15px",
                          }}
                        >
                          <h6 style={{ margin: 0 }}>Day {index + 1}</h6>
                          <div style={{ display: "flex", gap: "10px" }}>
                            {editingIndex === index ? (
                              <>
                                <button
                                  onClick={() => handleSaveEdit(index)}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    color: "#28a745",
                                    cursor: "pointer",
                                    padding: "5px",
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    color: "#6c757d",
                                    cursor: "pointer",
                                    padding: "5px",
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleEditDate(index)}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    color: "#007bff",
                                    cursor: "pointer",
                                    padding: "5px",
                                  }}
                                >
                                  Edit
                                </button>
                                {index > 0 && (
                                  <button
                                    onClick={() => handleRemoveDate(index)}
                                    style={{
                                      border: "none",
                                      background: "none",
                                      color: "#dc3545",
                                      cursor: "pointer",
                                      padding: "5px",
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: "15px" }}>
                          <div className="form-group">
                            <label>Date:</label>
                            <input
                              type="date"
                              value={
                                editingIndex === index
                                  ? editingEntry.date
                                  : dateEntry.date
                              }
                              onChange={(e) =>
                                editingIndex === index
                                  ? handleEditingChange("date", e.target.value)
                                  : handleDateTimeChange(index, "date", e.target.value)
                              }
                              disabled={editingIndex !== index && editingIndex !== -1}
                              className="form-control"
                            />
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "15px",
                            }}
                          >
                            <div className="form-group">
                              <label>Start Time:</label>
                              <input
                                type="time"
                                value={
                                  editingIndex === index
                                    ? editingEntry.startHour
                                    : dateEntry.startHour
                                }
                                onChange={(e) =>
                                  editingIndex === index
                                    ? handleEditingChange("startHour", e.target.value)
                                    : handleDateTimeChange(
                                        index,
                                        "startHour",
                                        e.target.value
                                      )
                                }
                                disabled={editingIndex !== index && editingIndex !== -1}
                                className="form-control"
                              />
                            </div>
                            <div className="form-group">
                              <label>End Time:</label>
                              <input
                                type="time"
                                value={
                                  editingIndex === index
                                    ? editingEntry.endHour
                                    : dateEntry.endHour
                                }
                                min={editingIndex === index ? editingEntry.startHour : dateEntry.startHour}
                                onChange={(e) => {
                                  const newTime = e.target.value;
                                  const startTime = editingIndex === index ? editingEntry.startHour : dateEntry.startHour;
                                  
                                  if (newTime >= startTime) {
                                    editingIndex === index
                                      ? handleEditingChange("endHour", newTime)
                                      : handleDateTimeChange(index, "endHour", newTime);
                                  }
                                }}
                                disabled={editingIndex !== index && editingIndex !== -1}
                                className="form-control"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddDate}
                      className="add-date-btn"
                      style={{
                        background: "#f8f9fa",
                        border: "1px dashed #ccc",
                        padding: "12px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        width: "100%",
                        marginTop: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontSize: "20px" }}>+</span> Add Another Day
                    </button>
                  </div>
                  <div className="form-group">
                    <label>Event Image:</label>
                    <div className="event-image-upload">
                      <div className="checkbox-container mb-2">
                        <input
                          type="checkbox"
                          id="use-subcategory-image"
                          checked={newEvent.useSubcategoryImage}
                          onChange={(e) =>
                            setNewEvent({
                              ...newEvent,
                              useSubcategoryImage: e.target.checked,
                              imageUrl: e.target.checked ? "" : newEvent.imageUrl,
                            })
                          }
                          className="event-checkbox"
                        />
                        <label
                          htmlFor="use-subcategory-image"
                          className="checkbox-label"
                        >
                          Use subcategory image
                        </label>
                      </div>
                      {!newEvent.useSubcategoryImage && (
                        <div className="image-upload-container">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) =>
                              handleEventImageUpload(e.target.files[0])
                            }
                            className="form-control"
                            readOnly={uploadingImage}
                          />
                          {uploadingImage && (
                            <div className="upload-progress">
                              <div className="spinner"></div>
                              <span>Uploading image...</span>
                            </div>
                          )}
                          {newEvent.imageUrl && (
                            <div className="image-preview">
                              <img
                                src={newEvent.imageUrl}
                                alt="Event preview"
                                style={{
                                  maxWidth: "200px",
                                  maxHeight: "200px",
                                  objectFit: "cover",
                                  marginTop: "10px",
                                  borderRadius: "4px",
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleAddEvent}
                    className="add-event-button"
                    disabled={!newEvent.title || isAddingEvent}
                  >
                    {isAddingEvent ? "Adding..." : "Add Event"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Group Settings Section */}
        <div className="settings-section">
          <h2 className="section-title">Group Settings</h2>
          <div className="section-content">
            {subcategory?.groupId ? (
              <div className="group-verification-section">
                <div className="verification-text">
                  <span>Group Successfully Created & Verified</span>
                  <span className="verification-badge">ACTIVE</span>
                </div>
                <div className="group-fields">
                  <p>Group "{newGroupName || subcategory.name}" is active for this sub-category</p>
                  {isDeletingGroup ? (
                    <Spinner
                      animation="border"
                      style={{
                        width: "24px",
                        height: "24px",
                        color: "#ac4343",
                      }}
                    />
                  ) : (
                    <MdDelete
                      onClick={() => handleDeleteGroup(subcategory.groupId)}
                      size={24}
                      color="#ac4343"
                      data-tooltip-id="delete-tooltip"
                      data-tooltip-content="Delete Group"
                      className="cursor-pointer"
                    />
                  )}
                  <Tooltip id="delete-tooltip" place="top" effect="solid" />
                </div>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <div className="checkbox-container">
                    <input
                      type="checkbox"
                      id="isGroup"
                      checked={subcategory.isGroup || false}
                      onChange={(e) => handleUpdate({ isGroup: e.target.checked })}
                      className="event-checkbox"
                    />
                    <label
                      htmlFor="isGroup"
                      className="checkbox-label"
                      style={{ marginTop: "10px" }}
                    >
                      Mark this as a Group Category
                    </label>
                  </div>
                </div>
                {subcategory.isGroup && (
                  <div className="event-fields" style={{ textAlign: "start" }}>
                    <div className="group-status-indicator">
                      Group Mode Enabled
                    </div>
                    <div className="form-group">
                      <label>Group Title:</label>
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Enter a descriptive name for your group"
                        className="form-control"
                      />
                    </div>
                    <button
                      onClick={handleCreateGroup}
                      style={{
                        ...commonStyles.confirmButton,
                        marginLeft: "10px",
                        width: "200px",
                      }}
                      disabled={isCreatingGroup || !newGroupName.trim()}
                    >
                      {isCreatingGroup ? "Creating..." : "Create Group"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* User Assignment Section */}
        <div className="settings-section">
          <h2 className="section-title">User Assignment</h2>
          <div className="section-content">
            <div className="form-group">
              <label>Assign Users:</label>
              <UsersDropdown
                selectedUsers={subcategory.assignedUsers || []}
                onChange={(selected) => handleUpdate({ assignedUsers: selected })}
                isMulti={true}
                idIglesia={churchId}
              />
            </div>
          </div>
        </div>

        {/* Materials Section */}
        <div className="settings-section">
          <h2 className="section-title">Materials</h2>
          <div className="section-content">
            <div className="materials-upload">
              <div className="upload-section">
                <label className="upload-label">
                  <input
                    type="file"
                    onChange={(e) => {
                      e.preventDefault();
                      handleFileUpload(e.target.files);
                    }}
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.mp4,.mp3,.zip,.rar,.jpg,.jpeg,.png,.gif"
                    className="file-input"
                    disabled={uploading}
                    multiple
                  />
                  <span className="upload-button">
                    {uploading ? "Uploading..." : "Upload Material"}
                  </span>
                </label>
                {uploading && (
                  <div className="upload-progress">
                    <div className="spinner"></div>
                    <span>Uploading file...</span>
                  </div>
                )}
              </div>
            </div>
            {subcategory.materials && subcategory.materials.length > 0 ? (
              <div className="materials-list">
                <h4>Current Materials</h4>
                {subcategory.materials.map((material, index) => (
                  <div key={index} className="material-item">
                    <span className={`material-icon ${material.type}`}>
                      {material.type === "document" && "📄"}
                      {material.type === "image" && "🖼️"}
                      {material.type === "video" && "🎥"}
                      {material.type === "audio" && "🎵"}
                    </span>
                    <span className="material-name">{material.name}</span>
                    <div className="material-actions">
                      <a
                        href={material.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="view-material"
                      >
                        View
                      </a>
                      <button
                        onClick={() => handleDeleteMaterial(index)}
                        className="delete-material"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-materials">
                <p>No materials uploaded yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Video Links Section */}
        <div className="settings-section">
          <h2 className="section-title">Video Links</h2>
          <div className="section-content">
            <div className="video-links-upload">
              <input
                type="text"
                placeholder="Video Title"
                value={newVideoTitle || ''}
                onChange={e => setNewVideoTitle(e.target.value)}
                className="form-control"
                style={{ marginBottom: 8 }}
              />
              <input
                type="text"
                placeholder="Video Description"
                value={newVideoDescription || ''}
                onChange={e => setNewVideoDescription(e.target.value)}
                className="form-control"
                style={{ marginBottom: 8 }}
              />
              <input
                type="text"
                placeholder="YouTube or Vimeo Link"
                value={newVideoUrl || ''}
                onChange={e => setNewVideoUrl(e.target.value)}
                className="form-control"
                style={{ marginBottom: 8 }}
              />
              <button
                onClick={handleAddVideoLink}
                className="add-video-link-btn"
                style={{ marginBottom: 12 }}
              >
                Add Video Link
              </button>
            </div>
            {subcategory.videoLinks && subcategory.videoLinks.length > 0 ? (
              <div className="video-links-list">
                <h4>Current Video Links</h4>
                {subcategory.videoLinks.map((video, idx) => (
                  <div key={video.id || idx} className="video-link-item">
                    {editingVideoId === video.id ? (
                      <div className="video-edit-form">
                        <input
                          type="text"
                          value={editingVideoData.title}
                          onChange={e => setEditingVideoData({...editingVideoData, title: e.target.value})}
                          className="form-control"
                          placeholder="Video Title"
                          style={{ marginBottom: 8 }}
                        />
                        <input
                          type="text"
                          value={editingVideoData.description}
                          onChange={e => setEditingVideoData({...editingVideoData, description: e.target.value})}
                          className="form-control"
                          placeholder="Video Description"
                          style={{ marginBottom: 8 }}
                        />
                        <input
                          type="text"
                          value={editingVideoData.url}
                          onChange={e => setEditingVideoData({...editingVideoData, url: e.target.value})}
                          className="form-control"
                          placeholder="Video URL"
                          style={{ marginBottom: 8 }}
                        />
                        <div className="video-edit-actions">
                          <button onClick={saveEditingVideo} className="save-btn">Save</button>
                          <button onClick={cancelEditingVideo} className="cancel-btn">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="video-link-info">
                          <span className="video-link-title">{video.title}</span>
                          <span className="video-link-description">{video.description}</span>
                          <a href={video.url} target="_blank" rel="noopener noreferrer" className="video-link-url">
                            {video.url}
                          </a>
                        </div>
                        <div className="video-link-actions">
                          <button
                            onClick={() => startEditingVideo(video)}
                            className="edit-video-btn"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteVideoLink(video.id)}
                            className="delete-video-btn"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-video-links">
                <p>No video links added yet</p>
              </div>
            )}
          </div>
        </div>
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