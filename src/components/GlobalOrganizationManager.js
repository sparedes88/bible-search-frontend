import React, { useEffect, useState } from "react";
import ChurchHeader from "./ChurchHeader";
import { db, storage } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  where
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "./GlobalOrganizationManager.css";

const GlobalOrganizationManager = () => {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState(null); // {orgId: string, field: string}
  const [tempValues, setTempValues] = useState({}); // Temporary values during editing
  const [logoFile, setLogoFile] = useState(null); // For logo upload
  const [logoPreview, setLogoPreview] = useState(null); // For logo preview
  const [adding, setAdding] = useState(false);
  const [newOrganization, setNewOrganization] = useState({
    nombre: "",
    address: "",
    logo: "",
    status: "active",
    featured: false,
    brand: ""
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState("nombre");
  const [sortDirection, setSortDirection] = useState("asc");
  const [showInactive, setShowInactive] = useState(false);
  const [brandFilter, setBrandFilter] = useState("");
  const organizationsPerPage = 10;
  const totalPages = Math.ceil(organizations.length / organizationsPerPage);

  // Brands State
  const [brands, setBrands] = useState([]);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [newBrand, setNewBrand] = useState({
    name: "",
    description: "",
    imageUrl: "",
    imageFile: null
  });

  // Topic Categories State
  const [topicCategories, setTopicCategories] = useState([]);
  const [showTopicCategoryModal, setShowTopicCategoryModal] = useState(false);
  const [editingTopicCategory, setEditingTopicCategory] = useState(null);
  const [newTopicCategory, setNewTopicCategory] = useState({
    name: "",
    description: "",
    color: "#3b82f6"
  });

  // Topics State
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [editingTopic, setEditingTopic] = useState(null);
  const [newTopic, setNewTopic] = useState({
    name: "",
    description: "",
    categoryId: ""
  });

  // Topics Database State
  const [topicsData, setTopicsData] = useState([]);
  const [topicsSearch, setTopicsSearch] = useState("");
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [brandImagePreview, setBrandImagePreview] = useState(null);
  const [editingTagsItem, setEditingTagsItem] = useState(null);
  const [newTag, setNewTag] = useState("");

  // Analytics State
  const [analyticsData, setAnalyticsData] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [analyticsSummary, setAnalyticsSummary] = useState({
    topics: 0,
    categories: 0,
    subcategories: 0,
    users: 0
  });

  // Active Tab
  const [activeTab, setActiveTab] = useState("organizations");

  useEffect(() => {
    const fetchOrganizations = async () => {
      setLoading(true);
      const snapshot = await getDocs(collection(db, "churches"));
      const organizationsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Set isActive to true in Firebase if missing
      for (const organization of organizationsData) {
        if (typeof organization.isActive === 'undefined') {
          await updateDoc(doc(db, "churches", organization.id), { isActive: true });
          organization.isActive = true;
        }
      }
      setOrganizations(organizationsData);
      setLoading(false);
    };
    fetchOrganizations();
  }, []);

  // Load Brands
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "brands"),
      (snapshot) => {
        const brandsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setBrands(brandsData);
      },
      (error) => {
        console.error('Error loading brands:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // Load Topic Categories
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "topiccategories"),
      (snapshot) => {
        const categoriesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setTopicCategories(categoriesData);
      },
      (error) => {
        console.error('Error loading topic categories:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // Load Topics for Unified Table
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "coursetopics"),
      (snapshot) => {
        const topicsData = snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name || '',
          description: doc.data().description || '',
          categoryId: doc.data().categoryId || null,
          ...doc.data()
        }));
        setTopicsData(topicsData);
      },
      (error) => {
        console.error('Error loading topics:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // Load Comprehensive Topics Database
  useEffect(() => {
    const fetchTopicsDatabase = async () => {
      setTopicsLoading(true);
      try {
        // Fetch organizations if not already loaded
        let orgs = organizations;
        if (orgs.length === 0) {
          const orgSnapshot = await getDocs(collection(db, "churches"));
          orgs = orgSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // Fetch all topics
        const topicsSnapshot = await getDocs(collection(db, "coursetopics"));
        const topics = topicsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Fetch all categories
        const categoriesSnapshot = await getDocs(collection(db, "coursecategories"));
        const categories = categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Create a map of categories for quick lookup
        const categoriesMap = new Map();
        categories.forEach(cat => categoriesMap.set(cat.id, cat));

        // Create the database view data
        const databaseData = [];
        topics.forEach(topic => {
          const organization = orgs.find(org => org.id === topic.churchId);
          const orgName = organization ? (organization.nombre || organization.name || organization.idIglesia || `ID: ${topic.churchId}`) : `Unknown Organization (${topic.churchId})`;
          const churchId = organization ? (organization.idIglesia || organization.id) : topic.churchId;

          // Collect all tags for this topic (own + categories + subcategories)
          let allTopicTags = [...(topic.tags || [])];

          // If topic has categories, create entries for each category
          if (topic.categories && topic.categories.length > 0) {
            topic.categories.forEach(categoryId => {
              const category = categoriesMap.get(categoryId);
              if (category) {
                // Collect all tags for this category (own + subcategories)
                let allCategoryTags = [...(category.tags || [])];

                // If category has subcategories, create entries for each subcategory
                if (category.subcategories && category.subcategories.length > 0) {
                  category.subcategories.forEach(subcategory => {
                    // Add subcategory tags to category and topic tags
                    allCategoryTags = [...allCategoryTags, ...(subcategory.tags || [])];
                    allTopicTags = [...allTopicTags, ...(subcategory.tags || [])];

                    databaseData.push({
                      organization: orgName,
                      churchId: churchId,
                      topic: topic.name,
                      category: category.name,
                      subcategory: subcategory.name,
                      topicImage: topic.imageUrls ? topic.imageUrls[0] : null,
                      categoryImage: category.imageUrl || null,
                      subcategoryImage: subcategory.imageUrl || null,
                      categoryId: categoryId,
                      subcategoryId: subcategory.name, // Use name as identifier since subcategories may not have IDs
                      topicId: topic.id,
                      createdAt: topic.createdAt,
                      createdBy: topic.createdBy,
                      tags: subcategory.tags || [], // Subcategories show only their own tags
                      link: `/church/${churchId}/course-categories?categories=${categoryId}&subcategories=${subcategory.name}`,
                      type: 'subcategory',
                      id: `${topic.id}-${categoryId}-${subcategory.name}`
                    });
                  });
                }

                // Remove duplicates from category tags
                allCategoryTags = [...new Set(allCategoryTags)];
                allTopicTags = [...new Set(allTopicTags)];

                // Add category entry
                databaseData.push({
                  organization: orgName,
                  churchId: churchId,
                  topic: topic.name,
                  category: category.name,
                  subcategory: '',
                  topicImage: topic.imageUrls ? topic.imageUrls[0] : null,
                  categoryImage: category.imageUrl || null,
                  subcategoryImage: null,
                  categoryId: categoryId,
                  topicId: topic.id,
                  createdAt: topic.createdAt,
                  createdBy: topic.createdBy,
                  tags: allCategoryTags, // Categories show inherited tags
                  link: `/church/${churchId}/course-categories?categories=${categoryId}`,
                  type: 'category',
                  id: `${topic.id}-${categoryId}`
                });
              }
            });
          }

          // Remove duplicates from topic tags
          allTopicTags = [...new Set(allTopicTags)];

          // Add topic entry (only if it has no categories or we want to show it anyway)
          if (!topic.categories || topic.categories.length === 0) {
            databaseData.push({
              organization: orgName,
              churchId: churchId,
              topic: topic.name,
              category: '',
              subcategory: '',
              topicImage: topic.imageUrls ? topic.imageUrls[0] : null,
              categoryImage: null,
              subcategoryImage: null,
              categoryId: null,
              topicId: topic.id,
              createdAt: topic.createdAt,
              createdBy: topic.createdBy,
              tags: topic.tags || [], // Topics show their own tags
              link: null,
              type: 'topic',
              id: topic.id
            });
          } else {
            // Add topic entry with inherited tags
            databaseData.push({
              organization: orgName,
              churchId: churchId,
              topic: topic.name,
              category: '',
              subcategory: '',
              topicImage: topic.imageUrls ? topic.imageUrls[0] : null,
              categoryImage: null,
              subcategoryImage: null,
              categoryId: null,
              topicId: topic.id,
              createdAt: topic.createdAt,
              createdBy: topic.createdBy,
              tags: allTopicTags, // Topics show inherited tags
              link: null,
              type: 'topic',
              id: topic.id
            });
          }
        });

        setTopicsData(databaseData);
      } catch (error) {
        console.error('Error loading topics database:', error);
      } finally {
        setTopicsLoading(false);
      }
    };

    fetchTopicsDatabase();
  }, [organizations]);

  // Fetch Analytics Data
  const fetchAnalyticsData = async (date) => {
    setAnalyticsLoading(true);
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Fetch topics created on the selected date
      const topicsQuery = query(
        collection(db, "coursetopics"),
        where("createdAt", ">=", startOfDay),
        where("createdAt", "<=", endOfDay)
      );
      const topicsSnapshot = await getDocs(topicsQuery);
      const topics = topicsSnapshot.docs.map(doc => ({
        id: doc.id,
        type: 'topic',
        ...doc.data()
      }));

      // Fetch categories created on the selected date
      const categoriesQuery = query(
        collection(db, "coursecategories"),
        where("createdAt", ">=", startOfDay),
        where("createdAt", "<=", endOfDay)
      );
      const categoriesSnapshot = await getDocs(categoriesQuery);
      const categories = categoriesSnapshot.docs.map(doc => ({
        id: doc.id,
        type: 'category',
        ...doc.data()
      }));

      // Get subcategories created on the selected date
      const allCategoriesSnapshot = await getDocs(collection(db, "coursecategories"));
      const subcategories = [];
      
      allCategoriesSnapshot.docs.forEach(doc => {
        const categoryData = doc.data();
        if (categoryData.subcategories) {
          categoryData.subcategories.forEach(sub => {
            if (sub.createdAt) {
              const subCreatedAt = new Date(sub.createdAt);
              if (subCreatedAt >= startOfDay && subCreatedAt <= endOfDay) {
                subcategories.push({
                  id: sub.id,
                  type: 'subcategory',
                  name: sub.name,
                  categoryName: categoryData.name,
                  createdAt: sub.createdAt,
                  createdBy: sub.createdBy
                });
              }
            }
          });
        }
      });

      // Fetch users created on the selected date
      const usersQuery = query(
        collection(db, "users"),
        where("createdAt", ">=", startOfDay),
        where("createdAt", "<=", endOfDay)
      );
      const usersSnapshot = await getDocs(usersQuery);
      const users = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        type: 'user',
        ...doc.data()
      }));

      const allData = [...topics, ...categories, ...subcategories, ...users];
      setAnalyticsData(allData);
      
      setAnalyticsSummary({
        topics: topics.length,
        categories: categories.length,
        subcategories: subcategories.length,
        users: users.length
      });
    } catch (error) {
      console.error("Error fetching analytics data:", error);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // Load analytics data when date changes
  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalyticsData(selectedDate);
    }
  }, [selectedDate, activeTab]);

  const startEditing = (orgId, field, currentValue) => {
    setEditingField({ orgId, field });
    setTempValues(prev => ({ ...prev, [`${orgId}-${field}`]: currentValue }));
  };

  const updateField = async (orgId, field, value) => {
    try {
      await updateDoc(doc(db, "churches", orgId), { [field]: value });
      setEditingField(null);
      setTempValues(prev => {
        const newTemp = { ...prev };
        delete newTemp[`${orgId}-${field}`];
        return newTemp;
      });
      // Refresh organizations
      const snapshot = await getDocs(collection(db, "churches"));
      setOrganizations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.error('Error updating field:', error);
      alert('Failed to update field');
    }
  };

  const cancelEditing = () => {
    setEditingField(null);
    setTempValues({});
  };

  const handleKeyPress = (e, orgId, field, value) => {
    if (e.key === 'Enter') {
      updateField(orgId, field, value);
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  const getFullLogoUrl = (logoPath) => {
    if (!logoPath) return null;
    
    // If it's already a full URL, return as is
    if (logoPath.startsWith('http')) return logoPath;
    
    // If it's a relative path starting with /, convert to full Firebase Storage URL
    if (logoPath.startsWith('/')) {
      const encodedPath = encodeURIComponent(logoPath.substring(1)); // Remove leading slash
      return `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodedPath}?alt=media`;
    }
    
    return logoPath;
  };

  const toggleStatus = async (id, currentStatus, isActive) => {
    const newIsActive = isActive === false ? true : false;
    await updateDoc(doc(db, "churches", id), { isActive: newIsActive });
    // Refresh
    const snapshot = await getDocs(collection(db, "churches"));
    setOrganizations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const handleAddOrganization = async () => {
    await addDoc(collection(db, "churches"), newOrganization);
    setAdding(false);
    setNewOrganization({ nombre: "", address: "", logo: "", status: "active", featured: false, brand: "" });
    // Refresh
    const snapshot = await getDocs(collection(db, "churches"));
    setOrganizations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Brand Management Functions
  const saveBrand = async () => {
    try {
      if (!newBrand.name.trim()) {
        alert('Brand name is required');
        return;
      }

      let imageUrl = newBrand.imageUrl;

      if (newBrand.imageFile) {
        const storageRef = ref(storage, `brands/${Date.now()}_${newBrand.imageFile.name}`);
        const uploadTask = await uploadBytes(storageRef, newBrand.imageFile);
        imageUrl = await getDownloadURL(uploadTask.ref);
      }

      const brandData = {
        name: newBrand.name.trim(),
        description: newBrand.description.trim(),
        imageUrl: imageUrl,
        updatedAt: new Date()
      };

      if (editingBrand) {
        await updateDoc(doc(db, "brands", editingBrand.id), {
          ...brandData,
          updatedAt: new Date()
        });
        alert('Brand updated successfully!');
      } else {
        brandData.createdAt = new Date();
        await addDoc(collection(db, "brands"), {
          ...brandData,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        alert('Brand created successfully!');
      }

      setNewBrand({
        name: "",
        description: "",
        imageUrl: "",
        imageFile: null
      });
      setBrandImagePreview(null);
      setEditingBrand(null);
      setShowBrandModal(false);
    } catch (error) {
      console.error('Error saving brand:', error);
      alert('Failed to save brand');
    }
  };

  const deleteBrand = async (brandId) => {
    if (!window.confirm('Are you sure you want to delete this brand?')) return;

    try {
      await deleteDoc(doc(db, "brands", brandId));
      setBrands(prev => prev.filter(brand => brand.id !== brandId));
      alert('Brand deleted successfully!');
    } catch (error) {
      console.error('Error deleting brand:', error);
      alert('Failed to delete brand');
    }
  };

  const openBrandModal = (brand = null) => {
    if (brand) {
      setEditingBrand(brand);
      setNewBrand({
        name: brand.name || "",
        description: brand.description || "",
        imageUrl: brand.imageUrl || "",
        imageFile: null
      });
      setBrandImagePreview(brand.imageUrl || null);
    } else {
      setEditingBrand(null);
      setNewBrand({
        name: "",
        description: "",
        imageUrl: "",
        imageFile: null
      });
      setBrandImagePreview(null);
    }
    setShowBrandModal(true);
  };

  const closeBrandModal = () => {
    setShowBrandModal(false);
    setEditingBrand(null);
    setNewBrand({
      name: "",
      description: "",
      imageUrl: "",
      imageFile: null
    });
    setBrandImagePreview(null);
  };

  const handleBrandImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setNewBrand(prev => ({ ...prev, imageFile: file }));

      const reader = new FileReader();
      reader.onload = (e) => {
        setBrandImagePreview(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Topic Category Management Functions
  const saveTopicCategory = async () => {
    try {
      if (!newTopicCategory.name.trim()) {
        alert('Topic category name is required');
        return;
      }

      const categoryData = {
        name: newTopicCategory.name.trim(),
        description: newTopicCategory.description.trim(),
        color: newTopicCategory.color,
        updatedAt: new Date()
      };

      if (editingTopicCategory) {
        await updateDoc(doc(db, "topiccategories", editingTopicCategory.id), {
          ...categoryData,
          updatedAt: new Date()
        });
        alert('Topic category updated successfully!');
      } else {
        categoryData.createdAt = new Date();
        await addDoc(collection(db, "topiccategories"), {
          ...categoryData,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        alert('Topic category created successfully!');
      }

      setNewTopicCategory({
        name: "",
        description: "",
        color: "#3b82f6"
      });
      setEditingTopicCategory(null);
      setShowTopicCategoryModal(false);
    } catch (error) {
      console.error('Error saving topic category:', error);
      alert('Failed to save topic category');
    }
  };

  const deleteTopicCategory = async (categoryId) => {
    if (!window.confirm('Are you sure you want to delete this topic category?')) return;

    try {
      await deleteDoc(doc(db, "topiccategories", categoryId));
      setTopicCategories(prev => prev.filter(cat => cat.id !== categoryId));
      alert('Topic category deleted successfully!');
    } catch (error) {
      console.error('Error deleting topic category:', error);
      alert('Failed to delete topic category');
    }
  };

  const openTopicCategoryModal = (category = null) => {
    if (category) {
      setEditingTopicCategory(category);
      setNewTopicCategory({
        name: category.name || "",
        description: category.description || "",
        color: category.color || "#3b82f6"
      });
    } else {
      setEditingTopicCategory(null);
      setNewTopicCategory({
        name: "",
        description: "",
        color: "#3b82f6"
      });
    }
    setShowTopicCategoryModal(true);
  };

  const editTopicCategory = (category) => {
    openTopicCategoryModal(category);
  };

  const closeTopicCategoryModal = () => {
    setShowTopicCategoryModal(false);
    setEditingTopicCategory(null);
    setNewTopicCategory({
      name: "",
      description: "",
      color: "#3b82f6"
    });
  };

  // Topic Management Functions
  const saveTopic = async () => {
    try {
      if (!newTopic.name.trim()) {
        alert('Topic name is required');
        return;
      }

      const topicData = {
        name: newTopic.name.trim(),
        description: newTopic.description.trim(),
        categoryId: newTopic.categoryId || null,
        updatedAt: new Date()
      };

      if (editingTopic) {
        await updateDoc(doc(db, "coursetopics", editingTopic.id), {
          ...topicData,
          updatedAt: new Date()
        });
        alert('Topic updated successfully!');
      } else {
        topicData.createdAt = new Date();
        await addDoc(collection(db, "coursetopics"), {
          ...topicData,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        alert('Topic created successfully!');
      }

      setNewTopic({
        name: "",
        description: "",
        categoryId: ""
      });
      setEditingTopic(null);
      setShowTopicModal(false);
      // Topics data will be updated automatically via the listener
    } catch (error) {
      console.error('Error saving topic:', error);
      alert('Failed to save topic');
    }
  };

  const editTopic = (topic) => {
    setEditingTopic(topic);
    setNewTopic({
      name: topic.name || "",
      description: topic.description || "",
      categoryId: topic.categoryId || ""
    });
    setShowTopicModal(true);
  };

  const deleteTopic = async (topicId) => {
    if (!window.confirm('Are you sure you want to delete this topic?')) return;

    try {
      await deleteDoc(doc(db, "coursetopics", topicId));
      setTopicsData(prev => prev.filter(topic => topic.id !== topicId));
      alert('Topic deleted successfully!');
    } catch (error) {
      console.error('Error deleting topic:', error);
      alert('Failed to delete topic');
    }
  };

  const assignTopicToCategory = async (topicId, categoryId) => {
    try {
      await updateDoc(doc(db, "coursetopics", topicId), {
        categoryId: categoryId || null,
        updatedAt: new Date()
      });
      // Update local state
      setTopicsData(prev => prev.map(topic => 
        topic.id === topicId 
          ? { ...topic, categoryId: categoryId || null }
          : topic
      ));
    } catch (error) {
      console.error('Error assigning topic to category:', error);
      alert('Failed to assign topic to category');
    }
  };

  const closeTopicModal = () => {
    setShowTopicModal(false);
    setEditingTopic(null);
    setNewTopic({
      name: "",
      description: "",
      categoryId: ""
    });
  };

  // Tag Management Functions
  const addTag = async (itemId, tag) => {
    if (!tag.trim()) return;

    try {
      // Find the item in topicsData to determine its type and collection
      const item = topicsData.find(item => item.id === itemId);
      if (!item) {
        console.error('Item not found:', itemId);
        return;
      }

      console.log('Adding tag to item:', item);

      let collectionName = '';
      let docId = '';
      let updateData = {};

      if (item.type === 'topic') {
        collectionName = 'coursetopics';
        docId = itemId;
        const currentTags = item.tags || [];
        updateData = { tags: [...currentTags, tag.trim()] };
      } else if (item.type === 'category') {
        collectionName = 'coursecategories';
        docId = item.categoryId;
        const currentTags = item.tags || [];
        updateData = { tags: [...currentTags, tag.trim()] };
      } else if (item.type === 'subcategory') {
        collectionName = 'coursecategories';
        docId = item.categoryId;

        console.log('Updating subcategory, categoryId:', item.categoryId, 'subcategoryId:', item.subcategoryId, 'subcategory:', item.subcategory);

        try {
          console.log('About to fetch category document...');
          // For subcategories, we need to update the subcategory within the category document
          const categoryDoc = await getDoc(doc(db, 'coursecategories', item.categoryId));
          console.log('Category document fetched, exists:', categoryDoc.exists());
          
          if (categoryDoc.exists()) {
            console.log('Processing category data...');
            const categoryData = categoryDoc.data();
            console.log('Category data retrieved successfully');
            console.log('Category data:', categoryData);
            console.log('All subcategories in category:', categoryData.subcategories);
            const updatedSubcategories = (categoryData.subcategories || []).map(sub => {
              console.log('Checking sub:', sub.id, sub.name, 'against:', item.subcategoryId, item.subcategory);
              // Match by name (case-insensitive and trimmed) since subcategories may not have IDs
              if (sub.name && sub.name.trim().toLowerCase() === item.subcategory.trim().toLowerCase()) {
                const currentTags = sub.tags || [];
                console.log('Found matching subcategory, current tags:', currentTags);
                const updatedSub = { ...sub, tags: [...currentTags, tag.trim()] };
                console.log('Updated subcategory:', updatedSub);
                return updatedSub;
              }
              return sub;
            });
            console.log('Original subcategories count:', categoryData.subcategories?.length || 0);
            console.log('Updated subcategories count:', updatedSubcategories.length);
            
            // Check if any subcategory was actually updated
            const wasUpdated = updatedSubcategories.some((sub, index) => {
              const original = categoryData.subcategories[index];
              return JSON.stringify(sub) !== JSON.stringify(original);
            });
            console.log('Was any subcategory updated:', wasUpdated);
            
            if (!wasUpdated) {
              console.error('No subcategory was updated - possible matching issue');
              alert('Subcategory not found or not updated');
              return;
            }
            
            updateData = { subcategories: updatedSubcategories };
            console.log('Update data for subcategory:', updateData);
          } else {
            console.error('Category document not found:', item.categoryId);
            alert('Category not found');
            return;
          }
        } catch (subcategoryError) {
          console.error('Error processing subcategory:', subcategoryError);
          alert('Error processing subcategory: ' + subcategoryError.message);
          return;
        }
      } else {
        console.error('Unknown item type:', item.type);
        return;
      }

      updateData.updatedAt = new Date();

      console.log('Final update data before Firestore update:', updateData);
      console.log('Collection:', collectionName, 'DocId:', docId);
      
      if (!updateData || Object.keys(updateData).length === 0) {
        console.error('updateData is empty or undefined');
        alert('No data to update');
        return;
      }
      
      // Verify the document exists before updating
      const docRef = doc(db, collectionName, docId);
      const docSnapshot = await getDoc(docRef);
      if (!docSnapshot.exists()) {
        console.error('Document does not exist:', collectionName, docId);
        alert('Document not found');
        return;
      }
      
      try {
        await updateDoc(docRef, updateData);
        console.log('Document updated successfully');
      } catch (updateError) {
        console.error('Failed to update document:', updateError);
        throw updateError;
      }

      // Update local state
      setTopicsData(prev => prev.map(dataItem =>
        dataItem.id === itemId
          ? { ...dataItem, tags: [...(dataItem.tags || []), tag.trim()] }
          : dataItem
      ));

      setNewTag("");
      console.log('Tag added successfully');
    } catch (error) {
      console.error('Error adding tag:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      alert('Failed to add tag: ' + (error.message || 'Unknown error'));
    }
  };

  const removeTag = async (itemId, tagToRemove) => {
    try {
      // Find the item in topicsData to determine its type and collection
      const item = topicsData.find(item => item.id === itemId);
      if (!item) return;

      let collectionName = '';
      let docId = '';
      let updateData = {};

      if (item.type === 'topic') {
        collectionName = 'coursetopics';
        docId = itemId;
        const currentTags = item.tags || [];
        updateData = { tags: currentTags.filter(tag => tag !== tagToRemove) };
      } else if (item.type === 'category') {
        collectionName = 'coursecategories';
        docId = item.categoryId;
        const currentTags = item.tags || [];
        updateData = { tags: currentTags.filter(tag => tag !== tagToRemove) };
      } else if (item.type === 'subcategory') {
        collectionName = 'coursecategories';
        docId = item.categoryId;
        
        // For subcategories, we need to update the subcategory within the category document
        const categoryDoc = await getDoc(doc(db, 'coursecategories', item.categoryId));
        if (categoryDoc.exists()) {
          const categoryData = categoryDoc.data();
          const updatedSubcategories = (categoryData.subcategories || []).map(sub => {
            if (sub.id === item.subcategoryId || sub.name === item.subcategory) {
              const currentTags = sub.tags || [];
              return { ...sub, tags: currentTags.filter(tag => tag !== tagToRemove) };
            }
            return sub;
          });
          updateData = { subcategories: updatedSubcategories };
        }
      } else {
        return; // Unknown type
      }

      updateData.updatedAt = new Date();

      await updateDoc(doc(db, collectionName, docId), updateData);

      // Update local state
      setTopicsData(prev => prev.map(dataItem => 
        dataItem.id === itemId 
          ? { ...dataItem, tags: (dataItem.tags || []).filter(tag => tag !== tagToRemove) }
          : dataItem
      ));
    } catch (error) {
      console.error('Error removing tag:', error);
      alert('Failed to remove tag');
    }
  };

  const closeTagsModal = () => {
    setEditingTagsItem(null);
    setNewTag("");
  };

  const filteredOrganizations = organizations.filter(organization => {
    // Search term filter
    if (searchTerm && !Object.values(organization).some(val =>
      typeof val === "string" && val.toLowerCase().includes(searchTerm.toLowerCase())
    )) {
      return false;
    }

    // Inactive filter - hide inactive by default unless checkbox is checked
    if (!showInactive && organization.isActive === false) {
      return false;
    }

    // Brand filter
    if (brandFilter && organization.brand !== brandFilter) {
      return false;
    }

    return true;
  });

  const sortedOrganizations = [...filteredOrganizations].sort((a, b) => {
    const aVal = a[sortColumn] ?? "";
    const bVal = b[sortColumn] ?? "";
    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const paginatedOrganizations = sortedOrganizations.slice((currentPage - 1) * organizationsPerPage, currentPage * organizationsPerPage);

  return (
    <div>
      <ChurchHeader />
      <div className="global-organization-manager">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2>Global Management</h2>
          <button 
            onClick={() => window.location.href = '/sql-server-bridge'}
            style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "0.75rem 1.5rem", fontWeight: 500, cursor: "pointer" }}
            title="Access SQL Server Database Bridge"
          >
            🗄️ Database Bridge
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="tab-navigation" style={{ marginBottom: '2rem' }}>
          <button 
            className={`tab-btn ${activeTab === 'organizations' ? 'active' : ''}`}
            onClick={() => setActiveTab('organizations')}
          >
            🏢 Organizations
          </button>
          <button 
            className={`tab-btn ${activeTab === 'brands' ? 'active' : ''}`}
            onClick={() => setActiveTab('brands')}
          >
            🏷️ Brands
          </button>
          <button 
            className={`tab-btn ${activeTab === 'topics' ? 'active' : ''}`}
            onClick={() => setActiveTab('topics')}
          >
            📚 Topics
          </button>
          <button 
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            📊 Analytics
          </button>
        </div>

        {activeTab === 'organizations' && (
          <>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={e => setShowInactive(e.target.checked)}
                />
                Show Inactive Organizations
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label>Filter by Brand:</label>
                <select
                  value={brandFilter}
                  onChange={e => setBrandFilter(e.target.value)}
                  style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #e5e7eb' }}
                >
                  <option value="">All Brands</option>
                  {brands.map(brand => (
                    <option key={brand.id} value={brand.name}>{brand.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <input
              type="text"
              placeholder="Search organizations..."
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              style={{ marginBottom: '1.5rem', padding: '0.75rem', width: '100%', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '1rem' }}
            />
            {loading ? <div>Loading...</div> : (
              <>
              <div style={{marginBottom: '2rem'}}>
                <table className="organization-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('id')} style={{cursor:'pointer'}}>ID {sortColumn==='id' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('nombre')} style={{cursor:'pointer'}}>Name {sortColumn==='nombre' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('address')} style={{cursor:'pointer'}}>Address {sortColumn==='address' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('logo')} style={{cursor:'pointer'}}>Logo {sortColumn==='logo' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('featured')} style={{cursor:'pointer'}}>Featured {sortColumn==='featured' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('brand')} style={{cursor:'pointer'}}>Brand {sortColumn==='brand' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('isActive')} style={{cursor:'pointer'}}>Status {sortColumn==='isActive' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrganizations.map(organization => (
                  <tr key={organization.id} className={organization.isActive === false ? 'inactive-row' : ''}>
                    <td>{organization.id}</td>
                    <td>
                      {editingField?.orgId === organization.id && editingField?.field === 'nombre' ? (
                        <input
                          value={tempValues[`${organization.id}-nombre`] ?? organization.nombre}
                          onChange={e => setTempValues(prev => ({ ...prev, [`${organization.id}-nombre`]: e.target.value }))}
                          onBlur={e => updateField(organization.id, 'nombre', e.target.value)}
                          onKeyDown={e => handleKeyPress(e, organization.id, 'nombre', e.target.value)}
                          autoFocus
                          style={{ width: '100%', padding: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                        />
                      ) : (
                        <span
                          onClick={() => startEditing(organization.id, 'nombre', organization.nombre)}
                          style={{ cursor: 'pointer', padding: '0.25rem', borderRadius: '4px', display: 'inline-block', width: '100%' }}
                          onMouseEnter={e => e.target.style.backgroundColor = '#f3f4f6'}
                          onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
                        >
                          {organization.nombre}
                        </span>
                      )}
                    </td>
                    <td>
                      {editingField?.orgId === organization.id && editingField?.field === 'address' ? (
                        <input
                          value={tempValues[`${organization.id}-address`] ?? organization.address}
                          onChange={e => setTempValues(prev => ({ ...prev, [`${organization.id}-address`]: e.target.value }))}
                          onBlur={e => updateField(organization.id, 'address', e.target.value)}
                          onKeyDown={e => handleKeyPress(e, organization.id, 'address', e.target.value)}
                          autoFocus
                          style={{ width: '100%', padding: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                        />
                      ) : (
                        <span
                          onClick={() => startEditing(organization.id, 'address', organization.address)}
                          style={{ cursor: 'pointer', padding: '0.25rem', borderRadius: '4px', display: 'inline-block', width: '100%' }}
                          onMouseEnter={e => e.target.style.backgroundColor = '#f3f4f6'}
                          onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
                        >
                          {organization.address}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ position: 'relative' }}>
                          {organization.logo ? (
                            <img src={getFullLogoUrl(organization.logo)} alt="logo" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: '4px' }} title={organization.logo} onError={e => { console.warn('Logo failed to load:', organization.logo); e.target.onerror=null; e.target.src='https://ui-avatars.com/api/?name='+encodeURIComponent(organization.nombre||'Organization')+'&background=eee&color=888&size=40'; }} />
                          ) : (
                            <img src={'https://ui-avatars.com/api/?name='+encodeURIComponent(organization.nombre||'Organization')+'&background=eee&color=888&size=40'} alt="logo" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: '4px' }} title="No logo URL" />
                          )}
                          <label style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#3b82f6', color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  handleLogoUpload(organization.id, file);
                                }
                              }}
                              style={{ display: 'none' }}
                            />
                            +
                          </label>
                        </div>
                      </div>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={organization.featured ?? false}
                        onChange={e => updateField(organization.id, 'featured', e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <select
                        value={organization.brand ?? ""}
                        onChange={e => updateField(organization.id, 'brand', e.target.value)}
                        style={{ padding: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        <option value="">No Brand</option>
                        {brands.map(brand => (
                          <option key={brand.id} value={brand.name}>{brand.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={organization.isActive === false ? 'inactive' : 'active'}
                        onChange={e => updateField(organization.id, 'isActive', e.target.value === 'active')}
                        style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td>
                      <button onClick={() => window.location.href = `/church-profile/${organization.id}`} style={{ background: '#6b7280', color: 'white', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-controls">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</button>
            <span>Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</button>
          </div>
          </>
        )}
          </>
        )}
        {adding ? (
          <div className="add-organization-form">
            <h3>Add New Organization</h3>
            <input placeholder="Name" value={newOrganization.nombre} onChange={e => setNewOrganization({ ...newOrganization, nombre: e.target.value })} />
            <input placeholder="Address" value={newOrganization.address} onChange={e => setNewOrganization({ ...newOrganization, address: e.target.value })} />
            <input placeholder="Logo URL" value={newOrganization.logo} onChange={e => setNewOrganization({ ...newOrganization, logo: e.target.value })} />
            <label>
              <input type="checkbox" checked={newOrganization.featured} onChange={e => setNewOrganization({ ...newOrganization, featured: e.target.checked })} />
              Featured Organization
            </label>
            <select value={newOrganization.brand} onChange={e => setNewOrganization({ ...newOrganization, brand: e.target.value })}>
              <option value="">Select Brand (Optional)</option>
              {brands.map(brand => (
                <option key={brand.id} value={brand.name}>{brand.name}</option>
              ))}
            </select>
            <button onClick={handleAddOrganization}>Add</button>
            <button onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}>+ Add Organization</button>
        )}

        {activeTab === 'brands' && (
          <>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Brand Management</h3>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <span style={{ background: '#10b981', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.875rem', fontWeight: '500' }}>
                    Active: {brands.filter(brand => brand.isActive !== false).length}
                  </span>
                  <span style={{ background: '#ef4444', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.875rem', fontWeight: '500' }}>
                    Inactive: {brands.filter(brand => brand.isActive === false).length}
                  </span>
                  <span style={{ background: '#6b7280', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.875rem', fontWeight: '500' }}>
                    Total: {brands.length}
                  </span>
                </div>
              </div>
              <button onClick={() => openBrandModal()} style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: '500', fontSize: '0.875rem' }}>
                + Add Brand
              </button>
            </div>

            <div className="brands-list">
              {brands.length === 0 ? (
                <div className="empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
                  <p>No brands found. Click "Add Brand" to get started.</p>
                </div>
              ) : (
                brands.map(brand => (
                  <div key={brand.id} className="brand-card">
                    <div className="brand-image" style={{ width: '80px', height: '80px', borderRadius: '12px', overflow: 'hidden', background: '#f3f4f6', marginBottom: '1rem' }}>
                      {brand.imageUrl ? (
                        <img src={brand.imageUrl} alt={brand.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '0.875rem' }}>No Image</div>
                      )}
                    </div>
                    <div className="brand-info" style={{ flex: 1 }}>
                      <h4 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600', color: '#1f2937' }}>{brand.name}</h4>
                      <p style={{ margin: '0.5rem 0', color: '#6b7280', fontSize: '0.875rem' }}>{brand.description}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <span style={{
                          background: brand.isActive !== false ? '#10b981' : '#ef4444',
                          color: 'white',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '500'
                        }}>
                          {brand.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div className="brand-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                      <button onClick={() => openBrandModal(brand)} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '500' }}>Edit</button>
                      <button onClick={() => deleteBrand(brand.id)} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '500' }}>Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {activeTab === 'topics' && (
          <div>
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Topics Database</h2>
              <p style={{ color: '#6b7280' }}>Comprehensive view of all topics, categories, and subcategories with navigation links</p>
            </div>

            {/* Search and Filters */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <input
                  type="text"
                  placeholder="Search topics, categories, subcategories..."
                  value={topicsSearch}
                  onChange={(e) => setTopicsSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '1rem' }}
                />
              </div>
              <button
                onClick={() => setShowTopicCategoryModal(true)}
                style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
              >
                Add Category
              </button>
              <button
                onClick={() => setShowTopicModal(true)}
                style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
              >
                Add Topic
              </button>
            </div>

            {/* Comprehensive Topics Database Table */}
            <div style={{ overflowX: 'auto', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              {topicsLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                  Loading topics database...
                </div>
              ) : topicsData.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                  No topics found.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Organization</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Topic</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Category</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Subcategory</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Tags</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Created By</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topicsData
                      .filter(item => 
                        (item.organization && typeof item.organization === 'string' && item.organization.toLowerCase().includes((topicsSearch || '').toLowerCase())) ||
                        (item.topic && typeof item.topic === 'string' && item.topic.toLowerCase().includes((topicsSearch || '').toLowerCase())) ||
                        (item.category && typeof item.category === 'string' && item.category.toLowerCase().includes((topicsSearch || '').toLowerCase())) ||
                        (item.subcategory && typeof item.subcategory === 'string' && item.subcategory.toLowerCase().includes((topicsSearch || '').toLowerCase()))
                      )
                      .map((item, index) => (
                        <tr key={`${item.type}-${item.id}-${index}`} style={{ borderBottom: '1px solid #e5e7eb', background: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                          <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                            {item.organization || 'N/A'}
                          </td>
                          <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151', fontWeight: '500' }}>
                            {item.topic || 'N/A'}
                          </td>
                          <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                            {item.category || 'N/A'}
                          </td>
                          <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                            {item.subcategory || 'N/A'}
                          </td>
                          <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {(item.tags || []).map((tag, tagIndex) => (
                                <span
                                  key={tagIndex}
                                  style={{
                                    background: '#e5e7eb',
                                    color: '#374151',
                                    padding: '0.125rem 0.375rem',
                                    borderRadius: '12px',
                                    fontSize: '0.75rem',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}
                                >
                                  {tag}
                                  <button
                                    onClick={() => removeTag(item.id, tag)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#6b7280',
                                      cursor: 'pointer',
                                      fontSize: '0.625rem',
                                      padding: '0',
                                      lineHeight: 1
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                              {(item.type === 'topic' || item.type === 'category' || item.type === 'subcategory') && (
                                <button
                                  onClick={() => setEditingTagsItem(item)}
                                  style={{
                                    background: '#f3f4f6',
                                    border: '1px solid #d1d5db',
                                    color: '#6b7280',
                                    padding: '0.125rem 0.375rem',
                                    borderRadius: '12px',
                                    fontSize: '0.75rem',
                                    cursor: 'pointer'
                                  }}
                                >
                                  +
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                            {item.createdBy || 'Unknown'}
                          </td>
                          <td style={{ padding: '1rem', color: '#374151' }}>
                            {item.link ? (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ 
                                  background: '#3b82f6', 
                                  color: 'white', 
                                  padding: '0.25rem 0.5rem', 
                                  borderRadius: '4px', 
                                  textDecoration: 'none',
                                  fontSize: '0.875rem',
                                  display: 'inline-block'
                                }}
                              >
                                View
                              </a>
                            ) : (
                              <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>No Link</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Topic Category Modal */}
        {showTopicCategoryModal && (
          <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="modal-content" style={{ background: 'white', borderRadius: '8px', padding: '2rem', maxWidth: '500px', width: '90%', maxHeight: '90vh', overflow: 'auto' }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>{editingTopicCategory ? 'Edit Topic Category' : 'Add New Topic Category'}</h3>
                <button onClick={closeTopicCategoryModal} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Name *</label>
                <input
                  type="text"
                  value={newTopicCategory.name}
                  onChange={(e) => setNewTopicCategory(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter topic category name"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Description</label>
                <textarea
                  value={newTopicCategory.description}
                  onChange={(e) => setNewTopicCategory(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter topic category description"
                  rows="3"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Color</label>
                <input
                  type="color"
                  value={newTopicCategory.color}
                  onChange={(e) => setNewTopicCategory(prev => ({ ...prev, color: e.target.value }))}
                  style={{ width: '100%', height: '40px', padding: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}
                />
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button onClick={closeTopicCategoryModal} style={{ background: '#6b7280', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveTopicCategory} style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>
                  {editingTopicCategory ? 'Update' : 'Create'} Category
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Topic Modal */}
        {showTopicModal && (
          <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="modal-content" style={{ background: 'white', borderRadius: '8px', padding: '2rem', maxWidth: '500px', width: '90%', maxHeight: '90vh', overflow: 'auto' }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>{editingTopic ? 'Edit Topic' : 'Add New Topic'}</h3>
                <button onClick={closeTopicModal} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Name *</label>
                <input
                  type="text"
                  value={newTopic.name}
                  onChange={(e) => setNewTopic(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter topic name"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Category</label>
                <select
                  value={newTopic.categoryId || ''}
                  onChange={(e) => setNewTopic(prev => ({ ...prev, categoryId: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                >
                  <option value="">No Category</option>
                  {topicCategories.map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Description</label>
                <textarea
                  value={newTopic.description}
                  onChange={(e) => setNewTopic(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter topic description"
                  rows="3"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                />
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button onClick={closeTopicModal} style={{ background: '#6b7280', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveTopic} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>
                  {editingTopic ? 'Update' : 'Create'} Topic
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div>
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Content Analytics</h2>
              <p style={{ color: '#6b7280' }}>Track topics, categories, and subcategories created per day</p>
            </div>

            {/* Date Picker and Summary */}
            <div style={{ marginBottom: '2rem', display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Select Date:</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '1rem' }}
                />
              </div>
              
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ background: '#10b981', color: 'white', padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{analyticsSummary.topics}</div>
                  <div style={{ fontSize: '0.875rem' }}>Topics</div>
                </div>
                <div style={{ background: '#3b82f6', color: 'white', padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{analyticsSummary.categories}</div>
                  <div style={{ fontSize: '0.875rem' }}>Categories</div>
                </div>
                <div style={{ background: '#8b5cf6', color: 'white', padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{analyticsSummary.subcategories}</div>
                  <div style={{ fontSize: '0.875rem' }}>Subcategories</div>
                </div>
                <div style={{ background: '#f59e0b', color: 'white', padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{analyticsSummary.users || 0}</div>
                  <div style={{ fontSize: '0.875rem' }}>Users</div>
                </div>
              </div>
            </div>

            {/* Analytics Data Table */}
            <div style={{ overflowX: 'auto', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              {analyticsLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                  Loading analytics data...
                </div>
              ) : analyticsData.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                  No content was created on {new Date(selectedDate).toLocaleDateString()}.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Type</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Name</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Created By</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #e5e7eb' }}>Created At</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsData.map((item, index) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #e5e7eb', background: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                          <span style={{ 
                            backgroundColor: 
                              item.type === 'topic' ? '#10b981' : 
                              item.type === 'category' ? '#3b82f6' : '#8b5cf6',
                            color: 'white', 
                            padding: '0.125rem 0.5rem', 
                            borderRadius: '12px', 
                            fontSize: '0.75rem',
                            fontWeight: '500',
                            textTransform: 'capitalize'
                          }}>
                            {item.type}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151', fontWeight: '500' }}>
                          {item.name}
                        </td>
                        <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                          {item.createdBy || 'Unknown'}
                        </td>
                        <td style={{ padding: '1rem', borderRight: '1px solid #e5e7eb', color: '#374151' }}>
                          {item.createdAt ? new Date(item.createdAt.seconds ? item.createdAt.seconds * 1000 : item.createdAt).toLocaleString() : 'N/A'}
                        </td>
                        <td style={{ padding: '1rem', color: '#374151' }}>
                          {item.type === 'subcategory' && item.categoryName && (
                            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                              Category: {item.categoryName}
                            </span>
                          )}
                          {item.type === 'topic' && item.churchId && (
                            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                              Church: {item.churchId}
                            </span>
                          )}
                          {item.type === 'category' && item.churchId && (
                            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                              Church: {item.churchId}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tags Modal */}
        {editingTagsItem && (
          <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="modal-content" style={{ background: 'white', borderRadius: '8px', padding: '2rem', maxWidth: '500px', width: '90%', maxHeight: '90vh', overflow: 'auto' }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>Manage Tags for {editingTagsItem.topic || editingTagsItem.name || 'Item'}</h3>
                <button onClick={closeTagsModal} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
              </div>

              <div className="current-tags" style={{ marginBottom: '1rem' }}>
                <h4 style={{ marginBottom: '0.5rem', fontWeight: '500' }}>Current Tags:</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {(editingTagsItem.tags || []).length === 0 ? (
                    <span style={{ color: '#6b7280', fontStyle: 'italic' }}>No tags</span>
                  ) : (
                    (editingTagsItem.tags || []).map((tag, index) => (
                      <span
                        key={index}
                        style={{
                          background: '#e5e7eb',
                          color: '#374151',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '12px',
                          fontSize: '0.875rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}
                      >
                        {tag}
                        <button
                          onClick={() => removeTag(editingTagsItem.id, tag)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#6b7280',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            padding: '0',
                            lineHeight: 1
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="add-tag" style={{ marginBottom: '1rem' }}>
                <h4 style={{ marginBottom: '0.5rem', fontWeight: '500' }}>Add New Tag:</h4>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="Enter tag name"
                    style={{ flex: 1, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        addTag(editingTagsItem.id, newTag);
                      }
                    }}
                  />
                  <button
                    onClick={() => addTag(editingTagsItem.id, newTag)}
                    style={{
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      padding: '0.5rem 1rem',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button onClick={closeTagsModal} style={{ background: '#6b7280', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default GlobalOrganizationManager;
