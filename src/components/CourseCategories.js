import React, { useState, useEffect, useCallback } from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import {
  Link,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  db,
  storage,
  getCategoriesCollection,
  getCoursesCollection,
  getCourseTopicsCollection,
} from "../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  serverTimestamp,
  addDoc,
  deleteDoc,
  getDoc
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import ChurchHeader from "./ChurchHeader";
import Skeleton from "react-loading-skeleton";
import UsersDropdown from "./UsersDropdown";
import { Bounce, ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Select from "react-select";
import { useAuth } from "../contexts/AuthContext";
import { FaChevronDown } from "react-icons/fa";
import "./CourseCategories.css"; // Import the new CSS file

// Safe toast wrapper to prevent errors - temporarily disabled
const safeToast = {
  success: (message) => {
    toast.success(message);
  },
  error: (message) => {
    toast.error(message);
  }
};

// Function to get a generic background color based on index
const getGenericBackgroundColor = (index) => {
  const colors = [
    "#3b82f6", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#f43f5e", // rose
    "#06b6d4", // cyan
    "#14b8a6", // teal
    "#a3e635", // lime
  ];
  return colors[index % colors.length];
};

const CourseCategories = () => {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  
  // Image error handler method
  const handleImageError = (event) => {
    const target = event.target;
    if (target && target.style) {
      console.error('Error loading image:', target.src);
      target.style.display = 'none';
    }
  };
  
  // Topics state
  const [topics, setTopics] = useState([]);
  const [editingTopic, setEditingTopic] = useState(false);
  const [isAddingTopicInline, setIsAddingTopicInline] = useState(false);
  const [newTopic, setNewTopic] = useState({
    name: "",
    description: "",
    categories: [],
  });
  
  // Categories state  
  const [categories, setCategories] = useState([]);
  const [editingCategory, setEditingCategory] = useState(false);
  const [editingSubcategory, setEditingSubcategory] = useState({
    categoryId: null,
    index: null,  });
  const [isAddingCategoryInline, setIsAddingCategoryInline] = useState(false);
  const [selectedTopicForCategory, setSelectedTopicForCategory] = useState(null);
  const [isAddingSubcategoryInline, setIsAddingSubcategoryInline] = useState(false);
  const [selectedCategoryForSubcategory, setSelectedCategoryForSubcategory] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [newSubInput, setNewSubInput] = useState("");
  const [newSubcategory, setNewSubcategory] = useState({
    name: "",
    description: "",
    order: 1,
  });
  const [newCategory, setNewCategory] = useState({
    name: "",
    description: "",
    subcategories: [],
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [componentError, setComponentError] = useState(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [isImageUpload, setImageUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const preselectedCategories =
    searchParams.get("categories")?.split(",") || [];
  const preselectedSubcategories =
    searchParams.get("subcategories")?.split(",") || [];
  const preselectedTopics =
    searchParams.get("topics")?.split(",") || [];
  const [selectedCategories, setSelectedCategories] = useState(
    preselectedCategories.map(id => ({ value: id, label: id }))
  );
  const [selectedSubcategories, setSelectedSubcategories] = useState(
    preselectedSubcategories.map(id => ({ value: id, label: id }))
  );
  const [selectedTopics, setSelectedTopics] = useState(
    preselectedTopics.map(id => ({ value: id, label: id }))
  );
  const [completionLogs, setCompletionLogs] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [filteredCategories, setFilteredCategories] = useState([]);
  const [hasSubcategoryFilter, setHasSubcategoryFilter] = useState(false);
  const [availableOrganizations, setAvailableOrganizations] = useState([]);
  const [currentOrganization, setCurrentOrganization] = useState(null);
  const [organizationSearchQuery, setOrganizationSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Show loading spinner while authentication is loading
  if (authLoading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh'
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  const userEditPermission =
    user && (user.role === "global_admin" ||
    (user.role === "admin" && user.churchId == id));

  const fetchTopics = useCallback(async () => {
    try {
      const topicsRef = collection(db, "coursetopics");
      const q = query(topicsRef, where("churchId", "==", id));
      const querySnapshot = await getDocs(q);
      const topicsData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      
      // Sort topics by order
      topicsData.sort((a, b) => (a.order || 0) - (b.order || 0));
      setTopics(topicsData);
    } catch (fetchError) {
      console.error("Error fetching topics:", fetchError);
      setComponentError("Failed to load topics");
    }
  }, [id]);

  const fetchCategories = useCallback(async () => {
    try {
      const categoriesRef = collection(db, "coursecategories");
      const q = query(categoriesRef, where("churchId", "==", id));
      const querySnapshot = await getDocs(q);
      const categoriesData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setCategories(categoriesData);
    } catch (fetchError) {
      console.error("Error fetching categories:", fetchError);
      setComponentError("Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Fetch available organizations for the user
  const fetchAvailableOrganizations = async () => {
    try {
      if (user?.role === 'global_admin' || user?.role === 'admin') {
        // Global admins and admins can access all organizations
        const churchesRef = collection(db, 'churches');
        const churchesSnapshot = await getDocs(churchesRef);
        const organizations = churchesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAvailableOrganizations(organizations);
        
        // Find current organization
        const currentOrg = organizations.find(org => org.id === id);
        setCurrentOrganization(currentOrg);
      } else {
        // Regular users can only access their organization
        const churchesRef = collection(db, 'churches');
        const churchDoc = await getDoc(doc(churchesRef, id));
        if (churchDoc.exists()) {
          const organization = { id: churchDoc.id, ...churchDoc.data() };
          setAvailableOrganizations([organization]);
          setCurrentOrganization(organization);
        }
      }
    } catch (error) {
      console.error('Error fetching organizations:', error);
    }
  };

  // Handle organization switch
  const handleOrganizationSwitch = (organizationId) => {
    const currentPath = location.pathname;
    const newPath = currentPath.replace(`/church/${id}`, `/church/${organizationId}`);
    navigate(newPath);
  };

  useEffect(() => {
    fetchTopics();
    fetchCategories();
    return () => {};
  }, [fetchTopics, fetchCategories]);

  // Fetch available organizations when user changes
  useEffect(() => {
    if (user) {
      fetchAvailableOrganizations();
    }
  }, [user, id]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isDropdownOpen && !event.target.closest('[data-dropdown]')) {
        setIsDropdownOpen(false);
        setOrganizationSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const handleCategoryChange = (selected) => {
    setSelectedCategories(selected || []);
  };

  const handleEdit = (categoryId) => {
    setEditingCategory(categoryId);
  };

  const isMember = user && user.role === "member";

  const handleUpdate = async (categoryId, updatedData) => {
    setIsLoading(true);
    try {
      if (isMember) {
        safeToast.error("Permission denied");
        return;
      }

      const categoryIndex = categories.findIndex((c) => c.id === categoryId);
      if (categoryIndex === -1) {
        throw new Error("Category not found");
      }

      const updateObject = {
        ...categories[categoryIndex],
        ...updatedData,
        churchId: id,
        updatedAt: serverTimestamp(),
        subcategories:
          updatedData.subcategories ||
          categories[categoryIndex].subcategories ||
          [],
        materials:
          updatedData.materials || categories[categoryIndex].materials || [],
      };

      const docRef = doc(db, "coursecategories", categoryId);
      await updateDoc(docRef, updateObject);

      setCategories((prevCategories) =>
        prevCategories.map((c) => (c.id === categoryId ? updateObject : c))
      );
      console.log('Updated category state:', updateObject);
      setForceUpdate(prev => prev + 1);

      safeToast.success("Changes saved successfully!");
      setEditingCategory(false);
      return updateObject;
    } catch (error) {
      console.error("Error updating category:", error);
      safeToast.error(`Failed to save changes: ${error.message}`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = async (
    e,
    categoryId,
    isSubcategory = false,
    subIndex = null
  ) => {
    console.log('Starting image upload for category:', categoryId, 'isSubcategory:', isSubcategory);
    try {
      e.preventDefault(); // Prevent page refresh
      setImageUpload(true);
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // Only allow one file at a time
      const file = files[0];

      const category = categories.find((c) => c.id === categoryId);
      if (!category) {
        throw new Error("Category not found");
      }

      const timestamp = Date.now();
      const path = isSubcategory
        ? `coursecategories/${id}/${categoryId}/subcategories/${subIndex}/${timestamp}_${file.name}`
        : `coursecategories/${id}/${categoryId}/${timestamp}_${file.name}`;

      const storageRef = ref(storage, path);

      // Set proper metadata to ensure image is processed correctly
      const metadata = {
        contentType: file.type,
        customMetadata: {
          churchId: id,
          categoryId: categoryId,
          uploadedAt: new Date().toISOString(),
          fullHeight: "true", // Add flag to indicate this image should display at full height
        },
      };

      const uploadTask = await uploadBytes(storageRef, file, metadata);
      const imageUrl = await getDownloadURL(uploadTask.ref);

      if (isSubcategory) {
        const updatedSubs = [...category.subcategories];
        if (!updatedSubs[subIndex]) {
          throw new Error("Subcategory not found");
        }
        // Replace existing image instead of adding to array
        updatedSubs[subIndex] = {
          ...updatedSubs[subIndex],
          imageUrls: [imageUrl], // Replace with single image
          imageStoragePaths: [path], // Replace with single path
        };

        console.log('Updating subcategory with new image:', updatedSubs[subIndex].imageUrls);
        await handleUpdate(categoryId, {
          ...category,
          subcategories: updatedSubs,
        });
      } else {
        // For categories, replace existing image instead of adding to array
        console.log('Updating category with new image:', [imageUrl]);
        await handleUpdate(categoryId, {
          ...category,
          imageUrls: [imageUrl], // Replace with single image
          imageStoragePaths: [path], // Replace with single path
        });
      }
      console.log('Upload completed successfully');
      safeToast.success("Image uploaded successfully!");
    } catch (error) {
      console.error("Upload error:", error);
      safeToast.error(`Upload failed: ${error.message}`);
    } finally {
      setImageUpload(false);
    }
  };

  const handleFileUpload = async (
    file,
    categoryId,
    isSubcategory = false,
    subIndex = null
  ) => {
    try {
      setUploading(true);

      const timestamp = Date.now();
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path = isSubcategory
        ? `coursecategories/${id}/${categoryId}/subcategories/${subIndex}/${timestamp}_${safeFileName}`
        : `coursecategories/${id}/${categoryId}/${timestamp}_${safeFileName}`;

      const storageRef = ref(storage, path);
      const metadata = {
        contentType: file.type,
        customMetadata: {
          churchId: id,
          categoryId: categoryId,
          uploadedAt: new Date().toISOString(),
        },
      };

      const uploadResult = await uploadBytes(storageRef, file, metadata);
      const downloadURL = await getDownloadURL(uploadResult.ref);

      const fileData = {
        name: file.name,
        url: downloadURL,
        type: file.type,
        path: path,
        uploadedAt: new Date().toISOString(),
      };

      if (isSubcategory) {
        const category = categories.find((c) => c.id === categoryId);
        const updatedSubs = [...category.subcategories];
        updatedSubs[subIndex] = {
          ...updatedSubs[subIndex],
          materials: [...(updatedSubs[subIndex].materials || []), fileData],
        };

        await handleUpdate(categoryId, {
          ...category,
          subcategories: updatedSubs,
        });
      } else {
        const category = categories.find((c) => c.id === categoryId);
        await handleUpdate(categoryId, {
          ...category,
          materials: [...(category.materials || []), fileData],
        });
      }

      safeToast.success(`Material "${file.name}" uploaded successfully!`);
    } catch (error) {
      console.error("Error uploading file:", error);
      safeToast.error(`Upload failed for "${file.name}": ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleVideoLink = async (
    link,
    categoryId,
    isSubcategory = false,
    subIndex = null
  ) => {
    try {
      const videoData = {
        url: link,
        type: "video",
        source: link.includes("youtube") ? "youtube" : "external",
        addedAt: new Date().toISOString(),
      };

      if (isSubcategory) {
        const category = categories.find((c) => c.id === categoryId);
        const updatedSubs = [...category.subcategories];
        updatedSubs[subIndex] = {
          ...updatedSubs[subIndex],
          materials: [...(updatedSubs[subIndex].materials || []), videoData],
        };

        await handleUpdate(categoryId, {
          ...category,
          subcategories: updatedSubs,
        });
      } else {
        const category = categories.find((c) => c.id === categoryId);
        await handleUpdate(categoryId, {
          ...category,
          materials: [...(category.materials || []), videoData],
        });
      }

      safeToast.success("Video link added successfully!");
    } catch (error) {
      console.error("Error adding video link:", error);
      safeToast.error("Failed to add video link");
    }
  };

  // Topic management functions
  const handleTopicUpdate = async (topicId, updatedData) => {
    setIsLoading(true);
    try {
      if (isMember) {
        toast.error("Permission denied", {
          position: "top-right",
          autoClose: 3000,
        });
        return;
      }

      const topicIndex = topics.findIndex((t) => t.id === topicId);
      if (topicIndex === -1) {
        throw new Error("Topic not found");
      }

      const updateObject = {
        ...topics[topicIndex],
        ...updatedData,
        churchId: id,
        updatedAt: serverTimestamp(),
        categories: updatedData.categories || topics[topicIndex].categories || [],
      };

      const docRef = doc(db, "coursetopics", topicId);
      await updateDoc(docRef, updateObject);

      const updatedTopics = [...topics];
      updatedTopics[topicIndex] = updateObject;
      console.log('Updating topics state:', updatedTopics[topicIndex]);
      setTopics(updatedTopics);
      setForceUpdate(prev => prev + 1);

      setEditingTopic(false);
      toast.success("Topic updated successfully!");
    } catch (error) {
      console.error("Error updating topic:", error);
      toast.error("Failed to update topic");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTopicImageUpload = async (event, topicId) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Only allow one file at a time
    const file = files[0];

    try {
      setImageUpload(true);

      const topic = topics.find((t) => t.id === topicId);
      if (!topic) {
        throw new Error("Topic not found");
      }

      const timestamp = Date.now();
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path = `coursetopics/${id}/${topicId}/${timestamp}_${safeFileName}`;

      const storageRef = ref(storage, path);

      // Set proper metadata to ensure image is processed correctly
      const metadata = {
        contentType: file.type,
        customMetadata: {
          churchId: id,
          topicId: topicId,
          uploadedAt: new Date().toISOString(),
          fullHeight: "true", // Add flag to indicate this image should display at full height
        },
      };

      const uploadTask = await uploadBytes(storageRef, file, metadata);
      const imageUrl = await getDownloadURL(uploadTask.ref);

      // Replace existing image instead of adding to array
      const updatedTopic = {
        ...topic,
        imageUrls: [imageUrl], // Replace with single image
        imageStoragePaths: [path], // Replace with single path
      };

      console.log('Updating topic with new image:', updatedTopic.imageUrls);
      await handleTopicUpdate(topicId, updatedTopic);
      
      toast.success("Topic image uploaded successfully!");
      console.log('Topic upload completed successfully');
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload topic image");
    } finally {
      setImageUpload(false);
    }
  };

  const addNewTopic = async () => {
    try {
      if (isMember) {
        toast.error("Permission denied", {
          position: "top-right",
          autoClose: 3000,
        });
        return;
      }

      if (!newTopic.name.trim()) {
        safeToast.error("Topic name is required");
        return;
      }

      const topicData = {
        name: newTopic.name.trim(),
        description: newTopic.description.trim(),
        categories: [],
        churchId: id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user?.uid || null,
        order: topics.length + 1,
      };

      const docRef = await addDoc(collection(db, "coursetopics"), topicData);
      const newTopicWithId = { id: docRef.id, ...topicData };

      setTopics([...topics, newTopicWithId]);
      setNewTopic({ name: "", description: "", categories: [] });
      setIsAddingTopicInline(false);

      safeToast.success("Topic added successfully!");
    } catch (error) {
      console.error("Error adding topic:", error);
      safeToast.error("Failed to add topic");
    }
  };

  useEffect(() => {
    const getFilteredCategories = () => {
      if (hasSubcategoryFilter) {
        return categories.filter((category) => {
          return (category.subcategories || []).length > 0;
        });
      }

      return categories
        .filter((category) => {
          // Topic filter
          if (selectedTopics && selectedTopics.length > 0) {
            const topicMatches = selectedTopics.some(selectedTopic => {
              const topic = topics.find(t => t.id === selectedTopic.value);
              return topic && topic.categories && topic.categories.includes(category.id);
            });
            if (!topicMatches) return false;
          }

          // Category filter
          if (selectedCategories && selectedCategories.length > 0) {
            const categoryIsSelected = selectedCategories.some(
              (selected) => selected.value === category.id
            );
            if (!categoryIsSelected) return false;
          }

          // Subcategory filter
          if (selectedSubcategories && selectedSubcategories.length > 0) {
            const subcategoryMatches = selectedSubcategories.some(selectedSub => {
              return (category.subcategories || []).some(sub => sub.id === selectedSub.value);
            });
            if (!subcategoryMatches) return false;
          }

          // Search term filter
          if (searchTerm) {
            const matchesSearch =
              category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              (category.description &&
                category.description.toLowerCase().includes(searchTerm.toLowerCase()));

            const subcategoryMatchesSearch = (category.subcategories || []).some(
              (sub) =>
                sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (sub.description &&
                  sub.description.toLowerCase().includes(searchTerm.toLowerCase()))
            );

            if (!matchesSearch && !subcategoryMatchesSearch) return false;
          }

          return true;
        })
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    };

    setFilteredCategories(getFilteredCategories());
  }, [categories, searchTerm, selectedCategories, selectedSubcategories, selectedTopics, hasSubcategoryFilter, topics]);

  // Initialize selected filters with proper labels after data loads
  useEffect(() => {
    if (categories.length > 0 && topics.length > 0) {
      // Initialize selected categories with proper labels
      if (preselectedCategories.length > 0) {
        const initializedCategories = preselectedCategories
          .map(id => {
            const category = categories.find(cat => cat.id === id);
            return category ? { value: id, label: category.name } : null;
          })
          .filter(Boolean);
        if (initializedCategories.length > 0) {
          setSelectedCategories(initializedCategories);
        }
      }

      // Initialize selected subcategories with proper labels
      if (preselectedSubcategories.length > 0) {
        const initializedSubcategories = preselectedSubcategories
          .map(id => {
            // Find subcategory across all categories
            for (const category of categories) {
              const subcategory = (category.subcategories || []).find(sub => sub.id === id);
              if (subcategory) {
                return { value: id, label: subcategory.name };
              }
            }
            return null;
          })
          .filter(Boolean);
        if (initializedSubcategories.length > 0) {
          setSelectedSubcategories(initializedSubcategories);
        }
      }

      // Initialize selected topics with proper labels
      if (preselectedTopics.length > 0) {
        const initializedTopics = preselectedTopics
          .map(id => {
            const topic = topics.find(t => t.id === id);
            return topic ? { value: id, label: topic.name } : null;
          })
          .filter(Boolean);
        if (initializedTopics.length > 0) {
          setSelectedTopics(initializedTopics);
        }
      }
    }
  }, [categories, topics, preselectedCategories, preselectedSubcategories, preselectedTopics]);

  // Update hasSubcategoryFilter when selectedSubcategories changes
  useEffect(() => {
    setHasSubcategoryFilter(selectedSubcategories && selectedSubcategories.length > 0);
  }, [selectedSubcategories]);

  const handleAddCategory = async (topicId = null) => {
    try {
      if (!newCategory.name.trim()) {
        safeToast.error("Category name is required");
        return;
      }

      console.log("Adding category:", newCategory.name, "to topic:", topicId);
      setIsLoading(true);
      
      const newOrder = Math.max(...categories.map((c) => c.order || 0), 0) + 1;
      const categoryToAdd = {
        name: newCategory.name.trim(),
        description: newCategory.description?.trim() || "",
        subcategories: [],
        order: newOrder,
        churchId: id,
        topicId: topicId || null, // Associate with topic if provided
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user?.uid || null,
      };

      console.log("Category data to add:", categoryToAdd);

      const docRef = await addDoc(
        collection(db, "coursecategories"),
        categoryToAdd
      );
      
      console.log("Category added with ID:", docRef.id);
      
      const newCategoryWithId = { 
        ...categoryToAdd, 
        id: docRef.id,
        createdAt: new Date(), // Use local date for immediate UI update
        updatedAt: new Date()
      };
      
      // Update local state immediately
      setCategories(prevCategories => {
        const updated = [...prevCategories, newCategoryWithId];
        console.log("Updated categories:", updated.length);
        return updated;
      });
      
      // If adding to a topic, update the topic's categories array
      if (topicId) {
        console.log("Updating topic with ID:", topicId);
        const topic = topics.find(t => t.id === topicId);
        if (topic) {
          const updatedCategories = [...(topic.categories || []), docRef.id];
          await handleTopicUpdate(topicId, {
            ...topic,
            categories: updatedCategories
          });
          
          // Update topics state to reflect the new category
          setTopics(prevTopics => 
            prevTopics.map(t => 
              t.id === topicId 
                ? { ...t, categories: updatedCategories }
                : t
            )
          );
          console.log("Topic updated successfully");
        }
      }
      
      // Reset form
      setIsAddingCategoryInline(false);
      setSelectedTopicForCategory(null);
      setNewCategory({ name: "", description: "", subcategories: [] });

      toast.success("Category added successfully!", {
        position: "top-right",
        autoClose: 2000,
      });
      
      // Fetch fresh data to ensure consistency
      console.log("Fetching fresh data...");
      await fetchCategories();
      await fetchTopics();
      console.log("Data fetch complete");
      
    } catch (err) {
      console.error("Error adding category:", err);
      toast.error(`Failed to add category: ${err.message}`, {
        position: "top-right",
        autoClose: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSubcategory = async (categoryId, newSub) => {
    try {
      if (!categoryId) {
        throw new Error("Category ID is required");
      }

      const category = categories.find((c) => c.id === categoryId);
      if (!category) {
        throw new Error("Category not found");
      }

      const subcategoryToAdd = {
        ...newSub,
        id: `sub_${Date.now()}`,
        order: (category.subcategories?.length || 0) + 1,
        createdAt: new Date().toISOString(),
        createdBy: user?.uid || null,
        assignedUsers: category.assignedUsers || [],
      };

      const updatedCategory = {
        ...category,
        subcategories: [...(category.subcategories || []), subcategoryToAdd],
      };

      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedCategory.subcategories,
        updatedAt: serverTimestamp(),
      });      setCategories((prevCategories) =>
        prevCategories.map((c) => (c.id === categoryId ? updatedCategory : c))
      );

      setNewSubInput("");
      setIsAddingSubcategoryInline(false);
      setSelectedCategoryForSubcategory(null);

      toast.success("Subcategory added successfully!");
      return subcategoryToAdd;
    } catch (error) {
      console.error("Error adding subcategory:", error);
      toast.error(`Failed to add subcategory: ${error.message}`);
      throw error;
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (isMember) {
      toast.error("Permission denied", {
        position: "top-right",
        autoClose: 3000,
      });
      return;
    }

    try {
      if (
        !window.confirm(
          "Are you sure you want to delete this category? This action cannot be undone."
        )
      ) {
        return;
      }

      await deleteDoc(doc(db, "coursecategories", categoryId));

      setCategories((prevCategories) =>
        prevCategories.filter((c) => c.id !== categoryId)
      );
      setEditingCategory(false);

      if (selectedCategories.some((cat) => cat.value === categoryId)) {
        const updatedSelected = selectedCategories.filter(
          (cat) => cat.value !== categoryId
        );
        setSelectedCategories(updatedSelected);

        if (updatedSelected.length > 0) {
          setSearchParams({
            categories: updatedSelected.map((s) => s.value).join(","),
          });
        } else {
          setSearchParams({});
        }
      }

      toast.success("Category deleted successfully!", {
        position: "top-right",
        autoClose: 3000,
      });
    } catch (err) {
      console.error("Error deleting category:", err);
      toast.error("Failed to delete category", {
        position: "top-right",
        autoClose: 3000,
      });
    }
  };

  const handleDeleteSubcategory = async (categoryId, subIndex) => {
    if (isMember) {
      toast.error("Permission denied", {
        position: "top-right",
        autoClose: 3000,
      });
      return;
    }
    if (
      !window.confirm(
        "Are you sure you want to delete this subcategory? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      const category = categories.find((c) => c.id === categoryId);
      const updatedSubcategories = category.subcategories.filter(
        (_, index) => index !== subIndex
      );

      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubcategories,
        updatedAt: serverTimestamp(),
      });

      setCategories(
        categories.map((c) =>
          c.id === categoryId
            ? { ...c, subcategories: updatedSubcategories }
            : c
        )
      );
      setEditingSubcategory({ categoryId: null, index: null });

      toast.success("Subcategory deleted successfully!", {
        position: "top-right",
        autoClose: 3000,
      });
    } catch (err) {
      console.error("Error deleting subcategory:", err);
      toast.error("Failed to delete subcategory", {
        position: "top-right",
        autoClose: 3000,
      });
    }
  };

  const handlePrerequisiteChange = (e, sub, index, category) => {
    const prerequisiteId = e.target.value;
    const prerequisiteSub = category.subcategories.find(
      (s) => s.id === prerequisiteId
    );

    let newOrder;
    const updatedSubs = [...category.subcategories];

    if (prerequisiteId) {
      const prerequisiteOrder = prerequisiteSub?.order || 1;

      const takenOrders = new Set(category.subcategories.map((s) => s.order));
      newOrder = prerequisiteOrder + 1;
      while (takenOrders.has(newOrder)) {
        newOrder++;
      }

      updatedSubs.forEach((s) => {
        if (s.id !== sub.id && s.order >= newOrder) {
          s.order++;
        }
      });
    } else {
      const takenOrders = new Set(
        category.subcategories
          .filter((s) => s.id !== sub.id)
          .map((s) => s.order)
      );
      newOrder = 1;
      while (takenOrders.has(newOrder)) {
        newOrder++;
      }
    }

    updatedSubs[index] = {
      ...sub,
      prerequisiteId,
      order: newOrder,
    };

    const updated = {
      ...category,
      subcategories: updatedSubs,
    };

    setCategories(categories.map((c) => (c.id === category.id ? updated : c)));
  };

  useEffect(() => {
    const categoryParams = searchParams.get("categories");
    const subcategoryParams = searchParams.get("subcategories");

    if (categoryParams) {
      const categoryIds = categoryParams.split(",");
      const selectedOptions = categories
        .filter((cat) => categoryIds.includes(cat.id))
        .map((cat) => ({
          value: cat.id,
          label: cat.name,
        }));
      setSelectedCategories(selectedOptions);
    }

    if (subcategoryParams) {
      const subcategoryIds = subcategoryParams.split(",");

      setHasSubcategoryFilter(true);

      const categoriesWithSelectedSubs = categories.filter(category =>
        category.subcategories && category.subcategories.some(sub => subcategoryIds.includes(sub.id))
      );

      if (categoriesWithSelectedSubs.length === 0) {
        console.warn("No categories found containing the specified subcategories");
        setHasSubcategoryFilter(false);
        return;
      }

      const parentCategoryIds = categoriesWithSelectedSubs.map(cat => cat.id);
      const allCategoryIds = [...new Set([
        ...(categoryParams ? categoryParams.split(",") : []),
        ...parentCategoryIds
      ])];

      const allSelectedOptions = categories
        .filter((cat) => allCategoryIds.includes(cat.id))
        .map((cat) => ({
          value: cat.id,
          label: cat.name,
        }));

      setSelectedCategories(allSelectedOptions);

      const filteredCats = categories
        .filter(category => allCategoryIds.includes(category.id))
        .map(category => {
          if (category.subcategories && category.subcategories.some(sub => subcategoryIds.includes(sub.id))) {
            return {
              ...category,
              subcategories: category.subcategories.filter(sub =>
                subcategoryIds.includes(sub.id)
              )
            };
          }
          if (categoryParams && categoryParams.split(",").includes(category.id)) {
            return category;
          }
          return null;
        })
        .filter(Boolean);

      setFilteredCategories(filteredCats);
    } else {
      setHasSubcategoryFilter(false);
      setFilteredCategories([]);
    }
  }, [searchParams, categories]);

  useEffect(() => {
    const fetchCompletionLogs = async () => {
      if (!user) return;

      try {
        const logsRef = collection(db, "completionLogs");
        const q = query(
          logsRef,
          where("userId", "==", user.uid),
          where("churchId", "==", id)
        );

        const snapshot = await getDocs(q);
        const logs = {};
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.subcategoryId) {
            logs[data.subcategoryId] = data;
          }
        });

        setCompletionLogs(logs);
      } catch (error) {
        console.error("Error fetching completion logs:", error);
      }
    };

    fetchCompletionLogs();
  }, [user, id]);

  const handleBackClick = (id) => {
    // Check if we have a referrer in sessionStorage that indicates we came from ChurchApp
    const referrer = sessionStorage.getItem('courseCategoryReferrer');
    if (referrer === 'churchApp') {
      // If we came from ChurchApp, go back there
      sessionStorage.removeItem('courseCategoryReferrer'); // Clean up
      navigate(`/church/${id}`);
    } else {
      // Default behavior - go to course admin
      navigate(`/church/${id}/course-admin`);
    }
  };

  const handleCategoryClick = (categoryId) => {
    navigate(`/church/${id}/courseDetail/${categoryId}`);
  };

  const handleSubcategoryClick = (categoryId, subcategoryId) => {
    navigate(`/church/${id}/course/${categoryId}/subcategory/${subcategoryId}`);
  };

  const onDragEnd = async (result) => {
    const { destination, source } = result;

    if (
      !destination ||
      (destination.droppableId === source.droppableId &&
        destination.index === source.index)
    ) {
      return;
    }

    try {
      const categoryId = source.droppableId;
      const category = categories.find((c) => c.id === categoryId);

      if (!category || !category.subcategories) {
        console.error("Category not found");
        return;
      }

      const newSubcategories = Array.from(category.subcategories);
      const [movedItem] = newSubcategories.splice(source.index, 1);
      newSubcategories.splice(destination.index, 0, movedItem);

      const updatedSubs = newSubcategories.map((sub, index) => {
        const order = index + 1;
        return order === 1
          ? { ...sub, order, prerequisiteId: null }
          : { ...sub, order };
      });

      setCategories((prevCategories) =>
        prevCategories.map((c) =>
          c.id === categoryId ? { ...c, subcategories: updatedSubs } : c
        )
      );

      await updateDoc(doc(db, "coursecategories", categoryId), {
        subcategories: updatedSubs,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error updating subcategory order:", error);
      toast.error("Failed to update subcategory order");
      await fetchCategories();
    }
  };

  if (loading) {
    return <div>Loading categories...</div>;
  }

  if (componentError) {
    return <div className="error-message">{componentError}</div>;
  }

  const renderCategoryEditForm = (category) => {
    return (
      <div className="card-edit-form" onClick={(e) => e.stopPropagation()}>
        <div className="form-group">
          <label className="label">Category Name:</label>
          <input
            type="text"
            value={category.name}
            onChange={(e) => {
              const updated = {
                ...category,
                name: e.target.value,
              };
              setCategories(
                categories.map((c) => (c.id === category.id ? updated : c))
              );
            }}
            className="input"
          />
        </div>
        <div className="form-group">
          <label className="label">Description:</label>
          <textarea
            value={category.description || ""}
            onChange={(e) => {
              const updated = {
                ...category,
                description: e.target.value,
              };
              setCategories(
                categories.map((c) => (c.id === category.id ? updated : c))
              );
            }}
            className="textarea"
          />
        </div>
        <div className="form-group">
          <label className="label">Category Image:</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleImageUpload(e, category.id)}
            className="input"
            disabled={isImageUpload}
          />
          {isImageUpload && <p className="upload-status">Uploading...</p>}
          {category.imageUrls && category.imageUrls.length > 0 && (
            <div style={{ marginTop: "10px" }}>
              <img
                src={category.imageUrls[0]}
                alt="Category Preview"
                style={{ width: "100%", borderRadius: "8px", marginBottom: "10px" }}
              />
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="label">Prerequisite Category:</label>
          <select
            value={category.prerequisiteId || ""}
            onChange={(e) => {
              const updated = {
                ...category,
                prerequisiteId: e.target.value || null,
              };
              setCategories(
                categories.map((c) => (c.id === category.id ? updated : c))
              );
            }}
            className="select"
          >
            <option value="">No Prerequisite</option>
            {categories
              .filter((c) => c.id !== category.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Assign Users:</label>
          <UsersDropdown
            selectedUsers={category.assignedUsers || []}
            onChange={(selected) => {
              const updatedSubs = category.subcategories.map((sub) => ({
                ...sub,
                assignedUsers: selected,
              }));

              const updated = {
                ...category,
                assignedUsers: selected,
                subcategories: updatedSubs,
              };

              setCategories(
                categories.map((c) => (c.id === category.id ? updated : c))
              );
            }}
            isMulti={true}
            idIglesia={id}
          />
        </div>
        <div className="form-group">
          <label className="label">Add Materials:</label>
          <div>
            <label>
              <input
                type="file"
                onChange={async (e) => {
                  const files = e.target.files;
                  if (files.length > 0) {
                    // Handle multiple files sequentially
                    for (let i = 0; i < files.length; i++) {
                      await handleFileUpload(files[i], category.id);
                    }
                    // Reset the input after all uploads
                    e.target.value = '';
                  }
                }}
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/*"
                className="input"
                disabled={uploading}
                multiple
              />
              <span className="button">
                {uploading ? "Uploading..." : "Upload Documents"}
              </span>
            </label>
            {uploading && <p>Uploading files...</p>}
          </div>
          <div>
            <input
              type="text"
              placeholder="Enter video URL (YouTube or direct link)"
              className="input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleVideoLink(e.target.value, category.id);
                  e.target.value = "";
                }
              }}
            />
          </div>
          {category.materials && category.materials.length > 0 && (
            <div>
              {category.materials.map((material, index) => (
                <div key={index}>
                  <span>{material.name || "Video Link"}</span>
                  <button
                    onClick={() => {
                      const updated = {
                        ...category,
                        materials: category.materials.filter(
                          (_, i) => i !== index
                        ),
                      };
                      handleUpdate(category.id, updated);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="label">Manage Subcategories:</label>
          <div>
            {category.subcategories?.map((sub, index) => (
              <div key={index}>
                <span>{sub.name}</span>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Are you sure you want to remove this subcategory?"
                      )
                    ) {
                      const updatedSubs = category.subcategories.filter(
                        (_, i) => i !== index
                      );
                      const updated = {
                        ...category,
                        subcategories: updatedSubs,
                      };
                      setCategories(
                        categories.map((c) =>
                          c.id === category.id ? updated : c
                        )
                      );
                    }
                  }}
                >
                  Remove
                </button>
                <button
                  onClick={() =>
                    setEditingSubcategory({
                      categoryId: category.id,
                      index,
                    })
                  }
                >
                  Edit
                </button>
              </div>
            ))}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newSubInput.trim() || !category.id) return;

                try {
                  const newSub = {
                    name: newSubInput.trim(),
                    description: "",
                    order: (category.subcategories?.length || 0) + 1,
                    createdAt: new Date().toISOString(),
                    assignedUsers: category.assignedUsers || [],
                  };

                  await handleAddSubcategory(category.id, newSub);
                } catch (error) {
                  console.error("Error in form submission:", error);
                  toast.error("Failed to add subcategory");
                }
              }}
            >
              <input
                type="text"
                placeholder="New subcategory name"
                className="input"
                value={newSubInput}
                onChange={(e) => setNewSubInput(e.target.value)}
              />
              <button type="submit" disabled={!newSubInput.trim()}>
                Add Subcategory
              </button>
            </form>
          </div>
        </div>
        <div className="form-group">
          <label className="label">Order Number:</label>
          <input
            type="number"
            min="1"
            value={category.order || 1}
            onChange={(e) => {
              const newOrder = parseInt(e.target.value) || 1;

              const orderExists = categories.some(
                (c) => c.id !== category.id && c.order === newOrder
              );

              if (orderExists) {
                toast.error("This order number is already in use", {
                  position: "top-right",
                  autoClose: 3000,
                });
                return;
              }

              const updatedCategories = categories.map((c) =>
                c.id === category.id ? { ...c, order: newOrder } : c
              );

              setCategories(updatedCategories);
            }}
            className="input"
          />
          <small>
            Order number must be unique across all categories. Current order
            numbers in use:{" "}
            {categories
              .filter((c) => c.id !== category.id && c.order)
              .map((c) => c.order)
              .sort((a, b) => a - b)
              .join(", ")}
          </small>
        </div>
        <div className="edit-actions">
          <button
            onClick={() => handleUpdate(category.id, category)}
            disabled={isLoading}
          >
            {isLoading ? "Saving..." : "Save"}
          </button>
          <button onClick={() => setEditingCategory(false)}>Cancel</button>
          <button onClick={() => handleDeleteCategory(category.id)}>
            Delete Category
          </button>
        </div>
      </div>
    );
  };

  const renderTopicEditForm = (topic) => {
    return (
      <div className="card-edit-form" onClick={(e) => e.stopPropagation()}>
        <div className="form-group">
          <label className="label">Topic Name:</label>
          <input
            type="text"
            value={topic.name}
            onChange={(e) => {
              const updated = {
                ...topic,
                name: e.target.value,
              };
              setTopics(
                topics.map((t) => (t.id === topic.id ? updated : t))
              );
            }}
            className="input"
          />
        </div>
        <div className="form-group">
          <label className="label">Description:</label>
          <textarea
            value={topic.description || ""}
            onChange={(e) => {
              const updated = {
                ...topic,
                description: e.target.value,
              };
              setTopics(
                topics.map((t) => (t.id === topic.id ? updated : t))
              );
            }}
            className="textarea"
          />
        </div>
        <div className="form-group">
          <label className="label">Topic Image:</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleTopicImageUpload(e, topic.id)}
            className="input"
          />
          {topic.imageUrls && topic.imageUrls.length > 0 && (
            <div style={{ marginTop: "10px" }}>
              <img
                src={topic.imageUrls[0]}
                alt="Topic Preview"
                style={{ width: "100%", borderRadius: "8px", marginBottom: "10px" }}
              />
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="label">Order Number:</label>
          <input
            type="number"
            min="1"
            value={topic.order || 1}
            onChange={(e) => {
              const newOrder = parseInt(e.target.value) || 1;

              const orderExists = topics.some(
                (t) => t.id !== topic.id && t.order === newOrder
              );

              if (orderExists) {
                toast.error("This order number is already in use", {
                  position: "top-right",
                  autoClose: 3000,
                });
                return;
              }

              const updatedTopics = topics.map((t) =>
                t.id === topic.id ? { ...t, order: newOrder } : t
              );

              setTopics(updatedTopics);
            }}
            className="input"
          />
          <small>
            Order number must be unique across all topics. Current order
            numbers in use:{" "}
            {topics
              .filter((t) => t.id !== topic.id && t.order)
              .map((t) => t.order)
              .sort((a, b) => a - b)
              .join(", ")}
          </small>
        </div>
        <div className="form-group">
          <label className="label">Associated Categories:</label>
          {/* Force complete remount of Select */}
          {topic.id && (
            <Select
              key={`select-${topic.id}-${categories.length}-${Date.now()}`}
              isMulti
              menuIsOpen={undefined}
              blurInputOnSelect={false}
              cacheOptions={false}
              menuPortalTarget={document.body}
              menuPosition="fixed"
            value={categories
              .filter(cat => topic.categories && topic.categories.includes(cat.id))
              .map(cat => ({ 
                value: cat.id, 
                label: cat.name 
              }))}
            onChange={async (selectedOptions) => {
              const selectedCategoryIds = selectedOptions ? selectedOptions.map(option => option.value) : [];
              const updated = {
                ...topic,
                categories: selectedCategoryIds,
              };
              
              // Update local state immediately
              setTopics(
                topics.map((t) => (t.id === topic.id ? updated : t))
              );
              
              // Auto-save to database
              try {
                await updateDoc(doc(db, "coursetopics", topic.id), {
                  categories: selectedCategoryIds,
                  updatedAt: serverTimestamp(),
                });
                safeToast.success("Topic categories updated successfully!");
              } catch (error) {
                console.error("Error updating topic categories:", error);
                safeToast.error("Failed to save category associations");
              }
            }}
            options={(() => {
              // Create a completely fresh options array each time
              const allCategories = [...categories];
              const filteredCategories = allCategories.filter(cat => {
                const isAssignedToOtherTopic = topics.some(otherTopic => 
                  otherTopic.id !== topic.id && 
                  otherTopic.categories && 
                  otherTopic.categories.includes(cat.id)
                );
                return !isAssignedToOtherTopic;
              });
              
              // Force a new array with new objects
              return filteredCategories.map((cat, index) => ({ 
                value: cat.id, 
                label: cat.name,
                key: `${cat.id}-${index}-${Date.now()}`
              }));
            })()}
            placeholder={`Select categories to associate with this topic... (${
              categories.filter(cat => {
                const isAssignedToOtherTopic = topics.some(otherTopic => 
                  otherTopic.id !== topic.id && 
                  otherTopic.categories && 
                  otherTopic.categories.includes(cat.id)
                );
                return !isAssignedToOtherTopic;
              }).length
            } available)`}
            className="react-select-container"
            classNamePrefix="react-select"
            noOptionsMessage={() => "No categories available"}
            styles={{
              control: (provided) => ({
                ...provided,
                minHeight: '40px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px'
              }),
              multiValue: (provided) => ({
                ...provided,
                backgroundColor: '#e5e7eb',
                borderRadius: '4px'
              }),
              multiValueLabel: (provided) => ({
                ...provided,
                color: '#374151',
                fontSize: '13px'
              }),
              multiValueRemove: (provided) => ({
                ...provided,
                color: '#6b7280',
                '&:hover': {
                  backgroundColor: '#f87171',
                  color: 'white'
                }
              }),
              menu: (provided) => ({
                ...provided,
                zIndex: 9999
              }),
              menuPortal: (provided) => ({
                ...provided,
                zIndex: 9999
              })
            }}
          />
          )}
          <small style={{ color: '#6b7280', fontSize: '12px', marginTop: '5px', display: 'block' }}>
            Select existing categories to display under this topic. Categories can belong to multiple topics.
          </small>
        </div>
        <div className="edit-actions">
          <button
            onClick={() => handleTopicUpdate(topic.id, topic)}
            disabled={isLoading}
          >
            {isLoading ? "Saving..." : "Save"}
          </button>
          <button onClick={() => setEditingTopic(false)}>Cancel</button>
          <button onClick={() => handleDeleteTopic(topic.id)}>
            Delete Topic
          </button>
        </div>
      </div>
    );
  };

  const handleDeleteTopic = async (topicId) => {
    if (window.confirm("Are you sure you want to delete this topic? This will not delete the categories within it.")) {
      try {
        await deleteDoc(doc(db, "coursetopics", topicId));
        setTopics(topics.filter(t => t.id !== topicId));
        toast.success("Topic deleted successfully!");
      } catch (error) {
        console.error("Error deleting topic:", error);
        toast.error("Failed to delete topic");
      }
    }
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="container" key={forceUpdate} style={{ position: "relative" }}>
        <button
          onClick={() => handleBackClick(id)}
          className="back-button-link"
        >
          ← Back to Course Admin
        </button>

        <ChurchHeader id={id} />
        
        {/* Organization Selector in Top Right */}
        {availableOrganizations.length > 1 && (
          <div style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            backgroundColor: "white",
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            border: "1px solid #e5e7eb",
            minWidth: "250px"
          }} data-dropdown>
            <label style={{ fontSize: "0.875rem", fontWeight: "500", color: "#374151" }}>Organization:</label>
            
            {/* Custom Dropdown */}
            <div style={{ position: "relative", width: "100%" }}>
              {/* Dropdown Trigger */}
              <div
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                style={{
                  padding: "0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.25rem",
                  fontSize: "0.875rem",
                  backgroundColor: "white",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontWeight: "500"
                }}
              >
                <span>
                  {currentOrganization ? (currentOrganization.nombre || currentOrganization.name || currentOrganization.churchId || currentOrganization.id) : 'Select organization...'}
                </span>
                <FaChevronDown style={{ 
                  transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s'
                }} />
              </div>
              
              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  backgroundColor: "white",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.25rem",
                  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                  zIndex: 1001,
                  maxHeight: "200px",
                  overflowY: "auto"
                }}>
                  {/* Search Input in Dropdown */}
                  <div style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb" }}>
                    <input
                      type="text"
                      placeholder="Search organizations..."
                      value={organizationSearchQuery}
                      onChange={(e) => setOrganizationSearchQuery(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.25rem",
                        border: "1px solid #d1d5db",
                        borderRadius: "0.25rem",
                        fontSize: "0.875rem",
                        boxSizing: "border-box"
                      }}
                      autoFocus
                    />
                  </div>
                  
                  {/* Filtered Options */}
                  <div>
                    {availableOrganizations
                      .filter((org) => {
                        const orgName = org.nombre || org.name || org.churchId || org.id || '';
                        const searchLower = organizationSearchQuery.toLowerCase();
                        return orgName.toLowerCase().includes(searchLower);
                      })
                      .map((org) => (
                        <div
                          key={org.id}
                          onClick={() => {
                            handleOrganizationSwitch(org.id);
                            setIsDropdownOpen(false);
                            setOrganizationSearchQuery('');
                          }}
                          style={{
                            padding: "0.5rem 0.75rem",
                            cursor: "pointer",
                            backgroundColor: org.id === id ? "#f3f4f6" : "white",
                            borderBottom: "1px solid #f3f4f6",
                            fontWeight: org.id === id ? "600" : "500"
                          }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = "#f9fafb"}
                          onMouseLeave={(e) => e.target.style.backgroundColor = org.id === id ? "#f3f4f6" : "white"}
                        >
                          {org.nombre || org.name || org.churchId || org.id}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Totals Section */}
        <div className="totals-section" style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '1.5rem',
          marginBottom: '2rem',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          <h2 style={{ 
            fontSize: '1.5rem', 
            fontWeight: '600', 
            marginBottom: '1rem',
            color: 'white',
            textAlign: 'center',
            padding: '0 1rem'
          }}>
            📊 Content Overview
          </h2>
          <div style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
            width: '100%',
            padding: '0 1rem'
          }}>
            <div className="total-card" style={{
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              padding: '1.25rem',
              borderRadius: '8px',
              textAlign: 'center',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              flex: '1',
              minWidth: '120px',
              maxWidth: '200px'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📚</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                {topics.length}
              </div>
              <div style={{ fontSize: '1rem', opacity: 0.9 }}>
                {topics.length === 1 ? 'Topic' : 'Topics'}
              </div>
            </div>
            
            <div className="total-card" style={{
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              padding: '1.25rem',
              borderRadius: '8px',
              textAlign: 'center',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              flex: '1',
              minWidth: '120px',
              maxWidth: '200px'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📂</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                {categories.length}
              </div>
              <div style={{ fontSize: '1rem', opacity: 0.9 }}>
                {categories.length === 1 ? 'Category' : 'Categories'}
              </div>
            </div>
            
            <div className="total-card" style={{
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              padding: '1.25rem',
              borderRadius: '8px',
              textAlign: 'center',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              flex: '1',
              minWidth: '120px',
              maxWidth: '200px'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📄</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                {categories.reduce((total, category) => {
                  return total + (category.subcategories ? category.subcategories.length : 0);
                }, 0)}
              </div>
              <div style={{ fontSize: '1rem', opacity: 0.9 }}>
                Subcategories
              </div>
            </div>
          </div>
        </div>
        
        <div className="page-header" style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          width: '100%',
          padding: '0 2rem',
          marginBottom: '2rem'
        }}>
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: '600' }}>Course Topics & Categories</h1>
          {userEditPermission && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className="button primary-button"
                onClick={() => setIsAddingTopicInline(!isAddingTopicInline)}
                style={{ 
                  fontWeight: 'bold', 
                  padding: '0.75rem 1.25rem',
                  fontSize: '1rem' 
                }}
              >
                {isAddingTopicInline ? "Cancel" : "+ Add New Topic"}
              </button>
              <button 
                className="button secondary-button"
                onClick={() => setIsAddingCategoryInline(!isAddingCategoryInline)}
                style={{ 
                  fontWeight: 'bold', 
                  padding: '0.75rem 1.25rem',
                  fontSize: '1rem' 
                }}
              >
                {isAddingCategoryInline ? "Cancel" : "+ Add Category"}
              </button>
            </div>
          )}
        </div>

        {/* Add Topic Form */}
        {isAddingTopicInline && userEditPermission && (
          <div className="inline-form">
            <h3 className="inline-form-title">Add New Topic</h3>
            <div className="form-group">
              <label className="label">Topic Name:</label>
              <input
                type="text"
                value={newTopic.name}
                onChange={(e) => setNewTopic({...newTopic, name: e.target.value})}
                className="input"
                placeholder="Enter topic name"
              />
            </div>
            <div className="form-group">
              <label className="label">Description:</label>
              <textarea
                value={newTopic.description || ""}
                onChange={(e) => setNewTopic({...newTopic, description: e.target.value})}
                className="textarea"
                placeholder="Enter topic description"
              />
            </div>
            <div className="form-actions">
              <button 
                className="button primary-button"
                onClick={async () => {
                  if (!newTopic.name.trim()) return;
                  
                  try {
                    await addNewTopic();
                    await fetchTopics();
                    setIsAddingTopicInline(false);
                  } catch (error) {
                    console.error("Failed to add topic:", error);
                    toast.error("Failed to add topic");
                  }
                }}
                disabled={!newTopic.name.trim()}
                style={{ padding: '0.625rem 1.25rem' }}
              >
                Add Topic
              </button>
              <button 
                className="button"
                onClick={() => {
                  setIsAddingTopicInline(false);
                  setNewTopic({ name: "", description: "", categories: [] });
                }}
                style={{ padding: '0.625rem 1.25rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add Category Form */}
        {isAddingCategoryInline && userEditPermission && (
          <div className="inline-form">
            <h3 className="inline-form-title">Add New Category</h3>
            <div className="form-group">
              <label className="label">Select Topic:</label>
              <select
                value={selectedTopicForCategory || ""}
                onChange={(e) => setSelectedTopicForCategory(e.target.value)}
                className="input"
              >
                <option value="">Select a topic (optional)</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Category Name:</label>
              <input
                type="text"
                value={newCategory.name}
                onChange={(e) => setNewCategory({...newCategory, name: e.target.value})}
                className="input"
                placeholder="Enter category name"
              />
            </div>
            <div className="form-group">
              <label className="label">Description:</label>
              <textarea
                value={newCategory.description || ""}
                onChange={(e) => setNewCategory({...newCategory, description: e.target.value})}
                className="textarea"
                placeholder="Enter category description"
              />
            </div>
            <div className="form-actions">
              <button 
                className="button primary-button"
                onClick={async () => {
                  await handleAddCategory(selectedTopicForCategory);
                }}
                disabled={!newCategory.name.trim() || isLoading}
                style={{ padding: '0.625rem 1.25rem' }}
              >
                {isLoading ? "Adding..." : "Add Category"}
              </button>
              <button 
                className="button"
                onClick={() => {
                  setIsAddingCategoryInline(false);
                  setSelectedTopicForCategory(null);
                  setNewCategory({ name: "", description: "", subcategories: [] });
                }}
                style={{ padding: '0.625rem 1.25rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="filters-container">
          <div className="filter-row">
            <input
              type="text"
              placeholder="Search topics, categories and subcategories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <Select
              isMulti
              options={topics.map((topic) => ({
                value: topic.id,
                label: topic.name,
              }))}
              value={selectedTopics}
              onChange={(selected) => {
                const selectedValues = selected || [];
                setSelectedTopics(selectedValues);

                const params = {};
                if (selectedValues.length > 0) {
                  params.topics = selectedValues.map((s) => s.value).join(",");
                }
                if (selectedCategories.length > 0) {
                  params.categories = selectedCategories.map((s) => s.value).join(",");
                }
                if (selectedSubcategories.length > 0) {
                  params.subcategories = selectedSubcategories.map((s) => s.value).join(",");
                }

                setSearchParams(params);
              }}
              placeholder="Filter by topics..."
              className="basic-multi-select"
              classNamePrefix="select"
              menuPosition="fixed"
              menuPortalTarget={document.body}
              styles={{
                menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                control: (base) => ({
                  ...base,
                  minHeight: '42px'
                }),
                menu: (base) => ({
                  ...base,
                  zIndex: 9999
                })
              }}
            />
            <Select
              isMulti
              options={categories.map((cat) => ({
                value: cat.id,
                label: cat.name,
              }))}
              value={selectedCategories}
              onChange={(selected) => {
                const selectedValues = selected || [];
                setSelectedCategories(selectedValues);

                const params = {};
                if (selectedTopics.length > 0) {
                  params.topics = selectedTopics.map((s) => s.value).join(",");
                }
                if (selectedValues.length > 0) {
                  params.categories = selectedValues.map((s) => s.value).join(",");
                }
                if (selectedSubcategories.length > 0) {
                  params.subcategories = selectedSubcategories.map((s) => s.value).join(",");
                }

                setSearchParams(params);
              }}
              placeholder="Filter by categories..."
              className="basic-multi-select"
              classNamePrefix="select"
              menuPosition="fixed"
              menuPortalTarget={document.body}
              styles={{
                menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                control: (base) => ({
                  ...base,
                  minHeight: '42px'
                }),
                menu: (base) => ({
                  ...base,
                  zIndex: 9999
                })
              }}
            />
            <Select
              isMulti
              options={categories
                .flatMap((cat) => cat.subcategories || [])
                .map((sub) => ({
                  value: sub.id,
                  label: sub.name,
                }))}
              value={selectedSubcategories}
              onChange={(selected) => {
                const selectedValues = selected || [];
                setSelectedSubcategories(selectedValues);

                const params = {};
                if (selectedTopics.length > 0) {
                  params.topics = selectedTopics.map((s) => s.value).join(",");
                }
                if (selectedCategories.length > 0) {
                  params.categories = selectedCategories.map((s) => s.value).join(",");
                }
                if (selectedValues.length > 0) {
                  params.subcategories = selectedValues.map((s) => s.value).join(",");
                }

                setSearchParams(params);
              }}
              placeholder="Filter by subcategories..."
              className="basic-multi-select"
              classNamePrefix="select"
              menuPosition="fixed"
              menuPortalTarget={document.body}
              styles={{
                menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                control: (base) => ({
                  ...base,
                  minHeight: '42px'
                }),
                menu: (base) => ({
                  ...base,
                  zIndex: 9999
                })
              }}
            />
          </div>
        </div>

        {/* Render Topics */}
        {topics
          .filter(topic => {
            // Topic filter
            if (selectedTopics && selectedTopics.length > 0) {
              const topicIsSelected = selectedTopics.some(selected => selected.value === topic.id);
              if (!topicIsSelected) return false;
            }

            // Search term filter for topics
            if (searchTerm) {
              const matchesSearch = topic.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (topic.description && topic.description.toLowerCase().includes(searchTerm.toLowerCase()));
              if (!matchesSearch) return false;
            }

            // Get categories that belong to this topic
            const topicCategories = categories.filter(cat => 
              topic.categories && topic.categories.includes(cat.id)
            );
            
            // If there are category or subcategory filters, check if topic has matching categories
            if ((selectedCategories && selectedCategories.length > 0) || (selectedSubcategories && selectedSubcategories.length > 0)) {
              const hasMatchingCategories = topicCategories.some(category => {
                // Category filter
                if (selectedCategories && selectedCategories.length > 0) {
                  const categoryIsSelected = selectedCategories.some(selected => selected.value === category.id);
                  if (!categoryIsSelected) return false;
                }

                // Subcategory filter
                if (selectedSubcategories && selectedSubcategories.length > 0) {
                  const subcategoryMatches = selectedSubcategories.some(selectedSub => {
                    return (category.subcategories || []).some(sub => sub.id === selectedSub.value);
                  });
                  if (!subcategoryMatches) return false;
                }

                return true;
              });

              if (!hasMatchingCategories) return false;
            }

            return true;
          })
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((topic, topicIndex) => {
          // Get categories that belong to this topic
          const topicCategories = categories.filter(cat => 
            topic.categories && topic.categories.includes(cat.id)
          );
          
          const filteredTopicCategories = topicCategories.filter(category => {
            // Category filter (already checked at topic level, but keeping for additional filtering)
            if (selectedCategories && selectedCategories.length > 0) {
              const categoryIsSelected = selectedCategories.some(selected => selected.value === category.id);
              if (!categoryIsSelected) return false;
            }

            // Subcategory filter (already checked at topic level, but keeping for additional filtering)
            if (selectedSubcategories && selectedSubcategories.length > 0) {
              const subcategoryMatches = selectedSubcategories.some(selectedSub => {
                return (category.subcategories || []).some(sub => sub.id === selectedSub.value);
              });
              if (!subcategoryMatches) return false;
            }

            // Search term filter
            const matchesSearch = !searchTerm || 
              category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              category.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
              (category.subcategories && category.subcategories.some(sub => 
                sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                sub.description?.toLowerCase().includes(searchTerm.toLowerCase())
              ));

            return matchesSearch;
          });

          return (
            <div key={topic.id} className="topic-section" style={{ marginBottom: '3rem' }}>
              {/* Topic Card */}
              <div className="topic-card">
                {editingTopic === topic.id ? (
                  renderTopicEditForm(topic)
                ) : (
                  <>
                    {topic.imageUrls && topic.imageUrls.length > 0 ? (
                      <div className="card-image-container">
                        <img
                          src={topic.imageUrls[0]}
                          alt={topic.name}
                          className="card-image"
                          onError={handleImageError}
                        />
                        <div className="image-overlay"></div>
                      </div>
                    ) : (
                      <div
                        className="card-image-placeholder"
                        style={{
                          backgroundColor: getGenericBackgroundColor(topicIndex),
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        <div className="placeholder-letter category-placeholder-letter">
                          {topic.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="placeholder-overlay"></div>
                        {userEditPermission && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // Create a hidden file input and trigger it
                              const fileInput = document.createElement('input');
                              fileInput.type = 'file';
                              fileInput.accept = 'image/*';
                              fileInput.multiple = true;
                              fileInput.style.display = 'none';
                              fileInput.onchange = (event) => {
                                handleTopicImageUpload(event, topic.id);
                                document.body.removeChild(fileInput);
                              };
                              document.body.appendChild(fileInput);
                              fileInput.click();
                            }}
                            className="update-image-btn-bottom"
                          >
                            Update Image
                          </button>
                        )}
                      </div>
                    )}
                    <div className="card-content">
                      <div className="card-header">
                        <span className="order-badge">
                          #{topic.order || topicIndex + 1}
                        </span>
                        <h2 className="card-title" style={{ fontSize: '1.5rem', color: '#1f2937' }}>
                          📚 {topic.name}
                        </h2>
                      </div>
                      {topic.description && (
                        <p className="card-description">
                          {topic.description}
                        </p>
                      )}
                      <p className="topic-stats">
                        {topicCategories.length} categories
                      </p>
                      {userEditPermission && (
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTopic(topic.id);
                            }}
                            className="button primary-button"
                          >
                            Edit Topic
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsAddingCategoryInline(true);
                              setSelectedTopicForCategory(topic.id);
                            }}
                            className="button secondary-button"
                          >
                            Add Category
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Categories in this Topic */}
              {filteredTopicCategories.length > 0 && (
                <div className="topic-categories" style={{ marginTop: '1.5rem', marginLeft: '2rem' }}>
                  <h3 style={{ color: '#6b7280', marginBottom: '1rem', fontSize: '1.1rem' }}>
                    Categories in {topic.name}
                  </h3>
                  {filteredTopicCategories.map((category, categoryIndex) => (
                    <div key={category.id} className="category-section" style={{ marginBottom: '2rem' }}>
                      <div className="category-group">
                        <div
                          className="category-card"
                          onClick={(e) => {
                            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'IMG') {
                              e.stopPropagation();
                              return;
                            }
                            handleCategoryClick(category.id);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          {editingCategory === category.id ? (
                            renderCategoryEditForm(category)
                          ) : (
                            <>
                              {category.imageUrls && category.imageUrls.length > 0 ? (
                                <div className="card-image-container">
                                  <img
                                    src={category.imageUrls[0]}
                                    alt={category.name}
                                    className="card-image"
                                    onError={handleImageError}
                                  />
                                  <div className="image-overlay"></div>
                                </div>
                              ) : (
                                <div
                                  className="card-image-placeholder"
                                  style={{
                                    backgroundColor: getGenericBackgroundColor(topicIndex + categoryIndex),
                                    position: 'relative',
                                    overflow: 'hidden'
                                  }}
                                >
                                  <div className="placeholder-letter category-placeholder-letter">
                                    {category.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="placeholder-overlay"></div>
                                  {userEditPermission && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // Create a hidden file input and trigger it
                                        const fileInput = document.createElement('input');
                                        fileInput.type = 'file';
                                        fileInput.accept = 'image/*';
                                        fileInput.multiple = true;
                                        fileInput.style.display = 'none';
                                        fileInput.onchange = (event) => {
                                          handleImageUpload(event, category.id);
                                          document.body.removeChild(fileInput);
                                        };
                                        document.body.appendChild(fileInput);
                                        fileInput.click();
                                      }}
                                      className="update-image-btn"
                                    >
                                      Update Image
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="card-content">
                                <div className="card-header">
                                  <span className="order-badge">
                                    #{category.order || categoryIndex + 1}
                                  </span>
                                  <h3 className="card-title">{category.name}</h3>
                                </div>
                                {category.description && (
                                  <p className="card-description">
                                    {category.description}
                                  </p>
                                )}
                                {userEditPermission && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingCategory(category.id);
                                    }}
                                    className="button primary-button"
                                  >
                                    Edit Category
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Display subcategories if they exist */}
                      {category.subcategories && category.subcategories.length > 0 && (
                        <div className="subcategories-container">
                          <h4 className="subcategories-title" style={{paddingLeft: '0.25rem'}}>Subcategories</h4>
                          <Droppable droppableId={category.id}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className="subcategories-grid"
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: window.innerWidth <= 480 ? '1fr' : 'repeat(2, 1fr)',
                                  gap: '15px',
                                  width: '100%',
                                }}
                              >
                                {category.subcategories
                                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                                  .map((sub, subIndex) => (
                                    <Draggable
                                      key={sub.id}
                                      draggableId={sub.id}
                                      index={subIndex}
                                    >
                                      {(provided, snapshot) => (
                                        <div
                                          ref={provided.innerRef}
                                          {...provided.draggableProps}
                                          {...provided.dragHandleProps}
                                          className="subcategory-card"
                                          style={{
                                            ...provided.draggableProps.style,
                                            cursor: 'pointer',
                                            margin: '0',
                                            padding: '0',
                                            position: snapshot.isDragging ? 'absolute' : 'relative',
                                            transform: snapshot.isDragging ? provided.draggableProps.style.transform : 'none'
                                          }}
                                          onClick={(e) => {
                                            if (e.target.tagName === 'BUTTON') {
                                              e.stopPropagation();
                                              return;
                                            }
                                            handleSubcategoryClick(category.id, sub.id);
                                          }}
                                        >
                                          {editingSubcategory.categoryId === category.id &&
                                          editingSubcategory.index === subIndex ? (
                                            <div className="card-edit-form" onClick={(e) => e.stopPropagation()}>
                                              {/* Comprehensive subcategory edit form */}
                                              <h3 className="edit-form-title">Edit Subcategory</h3>
                                              
                                              <div className="form-group">
                                                <label className="label">Name:</label>
                                                <input
                                                  type="text"
                                                  value={sub.name || ""}
                                                  onChange={(e) => {
                                                    const updated = [...category.subcategories];
                                                    updated[subIndex] = {
                                                      ...sub,
                                                      name: e.target.value,
                                                    };
                                                    setCategories(
                                                      categories.map((c) =>
                                                        c.id === category.id
                                                          ? { ...c, subcategories: updated }
                                                          : c
                                                      )
                                                    );
                                                  }}
                                                  className="input"
                                                  placeholder="Enter subcategory name"
                                                />
                                              </div>

                                              <div className="form-group">
                                                <label className="label">Description:</label>
                                                <textarea
                                                  value={sub.description || ""}
                                                  onChange={(e) => {
                                                    const updated = [...category.subcategories];
                                                    updated[subIndex] = {
                                                      ...sub,
                                                      description: e.target.value,
                                                    };
                                                    setCategories(
                                                      categories.map((c) =>
                                                        c.id === category.id
                                                          ? { ...c, subcategories: updated }
                                                          : c
                                                      )
                                                    );
                                                  }}
                                                  className="input textarea"
                                                  placeholder="Enter subcategory description"
                                                  rows="3"
                                                />
                                              </div>

                                              <div className="form-group">
                                                <label className="label">Order:</label>
                                                <input
                                                  type="number"
                                                  value={sub.order || subIndex + 1}
                                                  onChange={(e) => {
                                                    const updated = [...category.subcategories];
                                                    updated[subIndex] = {
                                                      ...sub,
                                                      order: parseInt(e.target.value) || 1,
                                                    };
                                                    setCategories(
                                                      categories.map((c) =>
                                                        c.id === category.id
                                                          ? { ...c, subcategories: updated }
                                                          : c
                                                      )
                                                    );
                                                  }}
                                                  className="input"
                                                  min="1"
                                                />
                                              </div>

                                              <div className="form-group">
                                                <label className="label">Image Upload:</label>
                                                <input
                                                  type="file"
                                                  accept="image/*"
                                                  onChange={(e) => handleImageUpload(e, category.id, true, subIndex)}
                                                  className="input file-input"
                                                  style={{ display: "block" }}
                                                  disabled={isImageUpload ? false : false}
                                                  multiple
                                                />
                                                {isImageUpload && <p className="upload-status">Uploading...</p>}
                                                {sub.imageUrls && sub.imageUrls.length > 0 && (
                                                  <div className="current-image-preview">
                                                    <img src={sub.imageUrls[0]} alt="Current" className="image-preview" />
                                                    <span className="image-status">Current image</span>
                                                  </div>
                                                )}
                                              </div>

                                              <div className="edit-actions">
                                                <button
                                                  onClick={async () => {
                                                    try {
                                                      await handleUpdate(category.id, {
                                                        ...category,
                                                      });
                                                      setEditingSubcategory({
                                                        categoryId: null,
                                                        index: null,
                                                      });
                                                      toast.success("Subcategory updated!");
                                                    } catch (e) {
                                                      console.error("Update failed", e);
                                                      toast.error("Failed to update subcategory");
                                                    }
                                                  }}
                                                  className="button primary-button"
                                                  disabled={isImageUpload}
                                                >
                                                  Save Changes
                                                </button>
                                                <button
                                                  onClick={() =>
                                                    setEditingSubcategory({
                                                      categoryId: null,
                                                      index: null,
                                                    })
                                                  }
                                                  className="button secondary-button"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <>
                                              {sub.imageUrls && sub.imageUrls.length > 0 ? (
                                                <div className="subcategory-image-container">
                                                  <img
                                                    src={sub.imageUrls[0]}
                                                    alt={sub.name}
                                                    className="subcategory-image"
                                                    onError={(e) => {
                                                      console.error('Error loading image:', sub.imageUrls[0]);
                                                      e.target.style.display = 'none';
                                                    }}
                                                  />
                                                  <div className="image-overlay"></div>
                                                  {completionLogs[sub.id] && (
                                                    <div className="completion-badge complete-badge"></div>
                                                  )}
                                                  {!completionLogs[sub.id] && 
                                                    sub.assignedUsers?.includes(user?.uid) && (
                                                      <div className="completion-badge incomplete-badge"></div>
                                                    )
                                                  }
                                                </div>
                                              ) : (
                                                <div
                                                  className="subcategory-image-placeholder"
                                                  style={{
                                                    backgroundColor: getGenericBackgroundColor(
                                                      (topicIndex + categoryIndex + subIndex) % 9
                                                    ),
                                                    position: 'relative',
                                                    overflow: 'hidden'
                                                  }}
                                                >
                                                  <div className="placeholder-letter subcategory-placeholder-letter">
                                                    {sub.name.charAt(0).toUpperCase()}
                                                  </div>
                                                  <div className="placeholder-overlay"></div>
                                                  {completionLogs[sub.id] && (
                                                    <div className="completion-badge complete-badge"></div>
                                                  )}
                                                  {!completionLogs[sub.id] && 
                                                    sub.assignedUsers?.includes(user?.uid) && (
                                                      <div className="completion-badge incomplete-badge"></div>
                                                    )
                                                  }
                                                  {userEditPermission && (
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        // Create a hidden file input and trigger it
                                                        const fileInput = document.createElement('input');
                                                        fileInput.type = 'file';
                                                        fileInput.accept = 'image/*';
                                                        fileInput.multiple = true;
                                                        fileInput.style.display = 'none';
                                                        fileInput.onchange = (event) => {
                                                          handleImageUpload(event, category.id, true, subIndex);
                                                          document.body.removeChild(fileInput);
                                                        };
                                                        document.body.appendChild(fileInput);
                                                        fileInput.click();
                                                      }}
                                                      className="update-image-btn-bottom"
                                                    >
                                                      Update Image
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                              <div className="subcategory-card-content">
                                                <div className="subcategory-header">
                                                  <span className="order-badge">#{sub.order || subIndex + 1}</span>
                                                  <h4 className="subcategory-name">{sub.name}</h4>
                                                </div>
                                                {sub.description && <p className="subcategory-description">{sub.description}</p>}
                                                {userEditPermission && (
                                                  <div className="subcategory-actions">
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        // Navigate to subcategory settings page with full functionality
                                                        navigate(`/church/${id}/course/${category.id}/subcategory/${sub.id}/settings`, {
                                                          state: {
                                                            subcategory: sub,
                                                            category: category,
                                                            subcategoryIndex: subIndex,
                                                            returnPath: window.location.pathname
                                                          }
                                                        });
                                                      }}
                                                      className="button settings-button"
                                                      title="Settings"
                                                    >
                                                      ⚙️
                                                    </button>
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingSubcategory({
                                                          categoryId: category.id,
                                                          index: subIndex,
                                                        });
                                                      }}
                                                      className="button secondary-button"
                                                      title="Edit"
                                                    >
                                                      ✏️ Edit
                                                    </button>
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteSubcategory(category.id, subIndex);
                                                      }}
                                                      className="button danger-button"
                                                      title="Delete"
                                                    >
                                                      🗑️ Delete
                                                    </button>
                                                  </div>
                                                )}
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </Draggable>
                                  ))}
                                <div style={{display: 'none'}}>{provided.placeholder}</div>
                                {userEditPermission && (
                                  <>
                                    {isAddingSubcategoryInline && selectedCategoryForSubcategory === category.id ? (
                                      <div className="inline-form add-subcategory-inline-form">
                                        <h3 className="inline-form-title">Add New Subcategory</h3>
                                        
                                        <div className="form-group">
                                          <label className="label">Subcategory Name:</label>
                                          <input
                                            type="text"
                                            value={newSubcategory.name}
                                            onChange={(e) => setNewSubcategory({...newSubcategory, name: e.target.value})}
                                            className="input"
                                            placeholder="Enter subcategory name"
                                          />
                                        </div>

                                        <div className="form-group">
                                          <label className="label">Description:</label>
                                          <textarea
                                            value={newSubcategory.description}
                                            onChange={(e) => setNewSubcategory({...newSubcategory, description: e.target.value})}
                                            className="input textarea"
                                            placeholder="Enter subcategory description"
                                            rows="3"
                                          />
                                        </div>

                                        <div className="form-group">
                                          <label className="label">Order:</label>
                                          <input
                                            type="number"
                                            value={newSubcategory.order}
                                            onChange={(e) => setNewSubcategory({...newSubcategory, order: parseInt(e.target.value) || 1})}
                                            className="input"
                                            min="1"
                                            placeholder="Display order"
                                          />
                                        </div>

                                        <div className="form-actions">
                                          <button 
                                            className="button primary-button"
                                            onClick={async () => {
                                              if (!newSubcategory.name.trim()) return;
                                              
                                              try {
                                                const newSub = {
                                                  name: newSubcategory.name.trim(),
                                                  description: newSubcategory.description.trim(),
                                                  order: newSubcategory.order || (category.subcategories?.length || 0) + 1
                                                };
                                                
                                                await handleAddSubcategory(category.id, newSub);
                                                await fetchCategories();
                                                setNewSubcategory({ name: "", description: "", order: 1 });
                                                setNewSubInput("");
                                                setIsAddingSubcategoryInline(false);
                                                setSelectedCategoryForSubcategory(null);
                                                
                                                toast.success(`Subcategory added successfully!`);
                                              } catch (error) {
                                                console.error("Failed to add subcategory:", error);
                                                toast.error("Failed to add subcategory");
                                              }
                                            }}
                                            disabled={!newSubcategory.name.trim()}
                                          >
                                            Add Subcategory
                                          </button>
                                          <button 
                                            className="button secondary-button"
                                            onClick={() => {
                                              setIsAddingSubcategoryInline(false);
                                              setSelectedCategoryForSubcategory(null);
                                              setNewSubcategory({ name: "", description: "", order: 1 });
                                              setNewSubInput("");
                                            }}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div
                                        className="add-card"
                                        style={{ 
                                          minHeight: '200px',
                                          width: '100%',
                                          gridColumn: window.innerWidth <= 480 ? 'span 1' : 'span 2'  
                                        }}
                                        onClick={() => {
                                          setIsAddingSubcategoryInline(true);
                                          setSelectedCategoryForSubcategory(category.id);
                                          setNewSubcategory({ 
                                            name: "", 
                                            description: "", 
                                            order: (category.subcategories?.length || 0) + 1 
                                          });
                                        }}
                                      >
                                        <div className="add-card-content">
                                          <span className="add-icon">+</span>
                                          <span>Add Subcategory</span>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </Droppable>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Categories without topics */}
        {(() => {
          const categoriesWithoutTopics = categories.filter(cat => 
            !topics.some(topic => topic.categories && topic.categories.includes(cat.id))
          );

          const filteredOrphanCategories = categoriesWithoutTopics.filter(category => {
            const matchesSearch = !searchTerm || 
              category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              category.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
              (category.subcategories && category.subcategories.some(sub => 
                sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                sub.description?.toLowerCase().includes(searchTerm.toLowerCase())
              ));

            const matchesFilter = selectedCategories.length === 0 ||
              selectedCategories.some(selected => selected.value === category.id);

            return matchesSearch && matchesFilter;
          });

          if (filteredOrphanCategories.length === 0) return null;

          return (
            <div className="orphan-categories-section" style={{ marginTop: '3rem' }}>
              <h2 style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
                📋 Categories Not Assigned to Topics
              </h2>
              {filteredOrphanCategories.map((category, index) => (
                <div key={category.id} className="category-section" style={{ marginBottom: '2rem' }}>
                  <div className="category-group">
                    <div
                      className="category-card"
                      onClick={(e) => {
                        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'IMG') {
                          e.stopPropagation();
                          return;
                        }
                        handleCategoryClick(category.id);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {editingCategory === category.id ? (
                        renderCategoryEditForm(category)
                      ) : (
                        <>
                          {category.imageUrls && category.imageUrls.length > 0 ? (
                            <div className="card-image-container">
                              <img
                                src={category.imageUrls[0]}
                                alt={category.name}
                                className="card-image"
                                onError={(e) => {
                                  console.error('Error loading image:', category.imageUrls[0]);
                                  e.target.style.display = 'none';
                                }}
                              />
                              <div className="image-overlay"></div>
                            </div>
                          ) : (
                            <div
                              className="card-image-placeholder"
                              style={{
                                backgroundColor: getGenericBackgroundColor(index),
                                position: 'relative',
                                overflow: 'hidden'
                              }}
                            >
                              <div className="placeholder-letter category-placeholder-letter">
                                {category.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="placeholder-overlay"></div>
                              {userEditPermission && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Create a hidden file input and trigger it
                                    const fileInput = document.createElement('input');
                                    fileInput.type = 'file';
                                    fileInput.accept = 'image/*';
                                    fileInput.multiple = false;
                                    fileInput.style.display = 'none';
                                    fileInput.onchange = (event) => {
                                      handleImageUpload(event, category.id);
                                      document.body.removeChild(fileInput);
                                    };
                                    document.body.appendChild(fileInput);
                                    fileInput.click();
                                  }}
                                  className="update-image-btn"
                                >
                                  Update Image
                                </button>
                              )}
                            </div>
                          )}
                          <div className="card-content">
                            <div className="card-header">
                              <span className="order-badge">
                                #{category.order || index + 1}
                              </span>
                              <h3 className="card-title">{category.name}</h3>
                            </div>
                            {category.description && (
                              <p className="card-description">
                                {category.description}
                              </p>
                            )}
                            {userEditPermission && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingCategory(category.id);
                                }}
                                className="button primary-button"
                              >
                                Edit Category
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Display subcategories */}
                  {category.subcategories && category.subcategories.length > 0 && (
                    <div className="subcategories-container">
                      <h4 className="subcategories-title" style={{paddingLeft: '0.25rem'}}>Subcategories</h4>
                      <Droppable droppableId={category.id}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="subcategories-grid"
                            style={{
                              display: 'grid',
                              gridTemplateColumns: window.innerWidth <= 480 ? '1fr' : 'repeat(2, 1fr)',
                              gap: '15px',
                              width: '100%',
                            }}
                          >
                            {category.subcategories
                              .sort((a, b) => (a.order || 0) - (b.order || 0))
                              .map((sub, subIndex) => (
                                <div
                                  key={sub.id}
                                  className="subcategory-card"
                                  style={{ cursor: 'pointer' }}
                                  onClick={(e) => {
                                    if (e.target.tagName === 'BUTTON') {
                                      e.stopPropagation();
                                      return;
                                    }
                                    handleSubcategoryClick(category.id, sub.id);
                                  }}
                                >
                                  {sub.imageUrls && sub.imageUrls.length > 0 ? (
                                    <div className="subcategory-image-container">
                                      <img
                                        src={sub.imageUrls[0]}
                                        alt={sub.name}
                                        className="subcategory-image"
                                      />
                                      <div className="image-overlay"></div>
                                    </div>
                                  ) : (
                                    <div
                                      className="subcategory-image-placeholder"
                                      style={{
                                        backgroundColor: getGenericBackgroundColor((index + subIndex) % 9),
                                        position: 'relative',
                                        overflow: 'hidden'
                                      }}
                                    >
                                      <div className="placeholder-letter subcategory-placeholder-letter">
                                        {sub.name.charAt(0).toUpperCase()}
                                      </div>
                                      <div className="placeholder-overlay"></div>
                                      {userEditPermission && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            // Create a hidden file input and trigger it
                                            const fileInput = document.createElement('input');
                                            fileInput.type = 'file';
                                            fileInput.accept = 'image/*';
                                            fileInput.multiple = true;
                                            fileInput.style.display = 'none';
                                            fileInput.onchange = (event) => {
                                              handleImageUpload(event, category.id, true, subIndex);
                                              document.body.removeChild(fileInput);
                                            };
                                            document.body.appendChild(fileInput);
                                            fileInput.click();
                                          }}
                                          className="update-image-btn-bottom"
                                        >
                                          Update Image
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  <div className="subcategory-card-content">
                                    <div className="subcategory-header">
                                      <span className="order-badge">#{sub.order || subIndex + 1}</span>
                                      <h4 className="subcategory-name">{sub.name}</h4>
                                    </div>
                                    {sub.description && <p className="subcategory-description">{sub.description}</p>}
                                    {userEditPermission && (
                                      <div className="subcategory-actions">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            // Navigate to subcategory settings page with full functionality
                                            navigate(`/church/${id}/course/${category.id}/subcategory/${sub.id}/settings`, {
                                              state: {
                                                subcategory: sub,
                                                category: category,
                                                subcategoryIndex: subIndex,
                                                returnPath: window.location.pathname
                                              }
                                            });
                                          }}
                                          className="button settings-button"
                                          title="Settings"
                                        >
                                          ⚙️
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingSubcategory({
                                              categoryId: category.id,
                                              index: subIndex,
                                            });
                                          }}
                                          className="button secondary-button"
                                          title="Edit"
                                        >
                                          ✏️ Edit
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteSubcategory(category.id, subIndex);
                                          }}
                                          className="button danger-button"
                                          title="Delete"
                                        >
                                          🗑️ Delete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {editingSubcategory.categoryId === category.id &&
                                  editingSubcategory.index === subIndex ? (
                                    <div className="card-edit-form" onClick={(e) => e.stopPropagation()}>
                                      {/* Comprehensive subcategory edit form */}
                                      <h3 className="edit-form-title">Edit Subcategory</h3>
                                      
                                      <div className="form-group">
                                        <label className="label">Name:</label>
                                        <input
                                          type="text"
                                          value={sub.name || ""}
                                          onChange={(e) => {
                                            const updated = [...category.subcategories];
                                            updated[subIndex] = {
                                              ...sub,
                                              name: e.target.value,
                                            };
                                            setCategories(
                                              categories.map((c) =>
                                                c.id === category.id
                                                  ? { ...c, subcategories: updated }
                                                  : c
                                              )
                                            );
                                          }}
                                          className="input"
                                          placeholder="Enter subcategory name"
                                        />
                                      </div>

                                      <div className="form-group">
                                        <label className="label">Description:</label>
                                        <textarea
                                          value={sub.description || ""}
                                          onChange={(e) => {
                                            const updated = [...category.subcategories];
                                            updated[subIndex] = {
                                              ...sub,
                                              description: e.target.value,
                                            };
                                            setCategories(
                                              categories.map((c) =>
                                                c.id === category.id
                                                  ? { ...c, subcategories: updated }
                                                  : c
                                              )
                                            );
                                          }}
                                          className="input textarea"
                                          placeholder="Enter subcategory description"
                                          rows="3"
                                        />
                                      </div>

                                      <div className="form-group">
                                        <label className="label">Order:</label>
                                        <input
                                          type="number"
                                          value={sub.order || subIndex + 1}
                                          onChange={(e) => {
                                            const updated = [...category.subcategories];
                                            updated[subIndex] = {
                                              ...sub,
                                              order: parseInt(e.target.value) || 1,
                                            };
                                            setCategories(
                                              categories.map((c) =>
                                                c.id === category.id
                                                  ? { ...c, subcategories: updated }
                                                  : c
                                              )
                                            );
                                          }}
                                          className="input"
                                          min="1"
                                        />
                                      </div>

                                      <div className="form-group">
                                        <label className="label">Image Upload:</label>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          onChange={(e) => handleImageUpload(e, category.id, true, subIndex)}
                                          className="input file-input"
                                          style={{ display: "block" }}
                                          disabled={isImageUpload ? false : false}
                                        />
                                        {isImageUpload && <p className="upload-status">Uploading...</p>}
                                        {sub.imageUrls && sub.imageUrls.length > 0 && (
                                          <div className="current-image-preview">
                                            <img src={sub.imageUrls[0]} alt="Current" className="image-preview" />
                                            <span className="image-status">Current image</span>
                                          </div>
                                        )}
                                      </div>

                                      <div className="edit-actions">
                                        <button
                                          onClick={async () => {
                                            try {
                                              await handleUpdate(category.id, {
                                                ...category,
                                              });
                                              setEditingSubcategory({
                                                categoryId: null,
                                                index: null,
                                              });
                                              toast.success("Subcategory updated successfully!");
                                            } catch (e) {
                                              console.error("Update failed", e);
                                              toast.error(`Failed to update subcategory: ${e.message}`);
                                            }
                                          }}
                                          className="button primary-button"
                                          disabled={isImageUpload}
                                        >
                                          Save Changes
                                        </button>
                                        <button
                                          onClick={() =>
                                            setEditingSubcategory({
                                              categoryId: null,
                                              index: null,
                                            })
                                          }
                                          className="button secondary-button"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            <div style={{display: 'none'}}>{provided.placeholder}</div>
                          </div>
                        )}
                      </Droppable>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        <ToastContainer position="top-right" autoClose={3000} />
      </div>
    </DragDropContext>
  );
};

export default CourseCategories;
