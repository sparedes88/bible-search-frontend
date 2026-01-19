import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import { FaCog, FaArrowLeft } from "react-icons/fa";
import commonStyles from "./commonStyles";
import "./pages.responsive.css";
import { collection, getDocs, query, where, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '../styles/ChurchInfo.css';
import Select from 'react-select';
import { useAuth } from "../contexts/AuthContext";

const getGenericBackgroundColor = (index) => {
  const colors = [
    "#60a5fa", "#34d399", "#f472b6", "#a78bfa",
    "#fbbf24", "#f87171", "#818cf8", "#2dd4bf"
  ];
  return colors[index % colors.length];
};

const ChurchInfo = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);
  const {user} = useAuth();
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedCategories, setSavedCategories] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const churchData = await searchChurchById(id);
        setChurch(churchData);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching church info:", error);
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const fetchCategories = async () => {
    if (!user || !id) return;

    setCategoriesLoading(true);
    try {
      const categoriesRef = collection(db, 'coursecategories');
      const q = query(categoriesRef, where('churchId', '==', id));
      const querySnapshot = await getDocs(q);
      
      const mainCategories = [];
      const subcategories = new Map();

      // First, separate categories and subcategories
      querySnapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() };
        if (data.type === 'subcategory') {
          if (!subcategories.has(data.parentCategoryId)) {
            subcategories.set(data.parentCategoryId, []);
          }
          subcategories.get(data.parentCategoryId).push(data);
        } else {
          mainCategories.push({ ...data, subcategories: [] });
        }
      });

      // Then, attach subcategories to their parent categories
      mainCategories.forEach(category => {
        if (subcategories.has(category.id)) {
          category.subcategories = subcategories.get(category.id);
        }
      });

      console.log('Fetched categories:', mainCategories);
      setCategories(mainCategories);

      // Fetch saved categories from user document
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.selectedCategories && userData.churchId === id) {
          setSelectedCategories(userData.selectedCategories);
          setSavedCategories(userData.selectedCategories);
        }
      }

    } catch (error) {
      console.error("Error fetching categories:", error);
      toast.error("Error loading categories");
      setCategories([]);
    } finally {
      setCategoriesLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, [user, id]);

  useEffect(() => {
    if (user && id) {
      fetchCategories();
    }
  }, [user, id]); // Add fetchCategories to deps if needed

  const fetchSavedCategories = async () => {
    if (user) {
      try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists() && userDoc.data().selectedCategories) {
          setSavedCategories(userDoc.data().selectedCategories);
        }
      } catch (error) {
        console.error('Error fetching saved categories:', error);
      }
    }
  };

  useEffect(() => {
    fetchSavedCategories();
  }, [user]);

  const handleCategoryToggle = (categoryId) => {
    setSelectedCategories(prev => {
      const isSelected = prev.includes(categoryId);
      return isSelected 
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId];
    });
  };

  const handleSubcategoryToggle = (categoryId, subcategoryId) => {
    setSelectedCategories(prev => {
      const isSelected = prev.includes(subcategoryId);
      if (isSelected) {
        return prev.filter(id => id !== subcategoryId);
      } else {
        // Ensure parent category is selected when selecting subcategory
        return prev.includes(categoryId) 
          ? [...prev, subcategoryId]
          : [...prev, categoryId, subcategoryId];
      }
    });
  };

  const handleCategoryClick = (categoryId) => {
    navigate(`/category/${categoryId}/details`);
  };

  const handleSubcategoryClick = (categoryId, subcategoryId) => {
    navigate(`/category/${categoryId}/subcategory/${subcategoryId}`);
  };

  const handleSaveCategories = async () => {
    setIsSaving(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        selectedCategories: selectedCategories,
        churchId: id
      });
      
      setSavedCategories(selectedCategories);
      toast.success('Categories and subcategories saved successfully');
      setShowSettings(false);
    } catch (error) {
      console.error('Error saving categories:', error);
      toast.error('Error saving categories');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCategoryFilterChange = (selectedOptions) => {
    setSelectedCategories(selectedOptions || []);
  };

  const getFilteredCategories = () => {
    return categories
      .filter((category) => {
        const matchesSearch = category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          category.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          category.subcategories.some(sub => 
            sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            sub.description?.toLowerCase().includes(searchTerm.toLowerCase())
          );

        const matchesCategory = selectedCategories.length === 0 || 
          selectedCategories.some(selected => selected.value === category.id);

        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  };

  // Update the renderCategoryCard function
  const renderCategoryCard = (category) => (
    <div className="settings-category-item">
      <div className="category-header">
        <h4 className="settings-category-name">{category.name}</h4>
        <button
          onClick={() => handleCategoryToggle(category.id)}
          className={`select-button ${
            selectedCategories.includes(category.id)
              ? 'selected'
              : ''
          }`}
        >
          {selectedCategories.includes(category.id) ? 'Selected' : 'Select'}
        </button>
      </div>
      
      {/* Show subcategories if category is selected */}
      {selectedCategories.includes(category.id) && category.subcategories?.length > 0 && (
        <div className="subcategories-selection">
          <h5 className="subcategories-title">Select Subcategories:</h5>
          <div className="subcategories-list">
            {category.subcategories.map(sub => (
              <label key={sub.id} className="subcategory-checkbox">
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(sub.id)}
                  onChange={() => handleSubcategoryToggle(category.id, sub.id)}
                />
                <span className="subcategory-name">{sub.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={commonStyles.container}>
      <ToastContainer />
      <div style={commonStyles.sectionContainer}>
        {/* Header Section */}
        <div style={commonStyles.banner}>
          {loading ? <Skeleton height={300} /> : church?.portadaArticulos ? (
            <img 
              src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} 
              alt="Church Banner" 
              style={commonStyles.bannerImage}
              loading="lazy"
              onError={(e) => {
                e.target.src = '/img/image-fallback.svg';
              }}
            />
          ) : <Skeleton height={300} />}
        </div>

        <div style={commonStyles.logoContainer}>
          {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
            <img 
              src={`https://iglesia-tech-api.e2api.com${church.Logo}`} 
              alt="Church Logo" 
              style={commonStyles.logo}
              loading="lazy"
              onError={(e) => {
                e.target.src = '/img/logo-fallback.svg';
              }}
            />
          ) : <Skeleton circle height={90} width={90} />}
        </div>

        <h1 style={commonStyles.title}>{church?.first_section_containers?.[0]?.title || "Church Name"}</h1>

        {/* Display Saved Categories */}
        <div className="mt-8">
          <h2 className="text-2xl font-semibold mb-4">My Categories</h2>
          {categories
            .filter(cat => savedCategories.includes(cat.id))
            .map((category) => (
              <div key={category.id} className="mb-8">
                {/* Category Card */}
                <div 
                  className="saved-category-card mb-4"
                  onClick={() => handleCategoryClick(category.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="card-image-wrapper">
                    {category.imageUrl ? (
                      <img 
                        src={category.imageUrl} 
                        alt={category.name} 
                        className="card-image"
                      />
                    ) : (
                      <div className="card-placeholder">
                        {category.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="category-tag">Category</span>
                  </div>
                  <div className="card-content">
                    <div className="card-header">
                      <h3 className="card-title">{category.name}</h3>
                      {category.description && (
                        <p className="card-description">{category.description}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Subcategories Grid */}
                {category.subcategories?.length > 0 && (
                  <div>
                    <h4 className="text-xl font-medium mb-3 ml-4">Subcategories</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ml-8">
                      {category.subcategories.map(sub => (
                        <div
                          key={sub.id}
                          className="saved-category-card subcategory-card"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSubcategoryClick(category.id, sub.id);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="card-image-wrapper">
                            {sub.imageUrl ? (
                              <img 
                                src={sub.imageUrl} 
                                alt={sub.name} 
                                className="card-image"
                              />
                            ) : (
                              <div className="card-placeholder">
                                {sub.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="category-tag subcategory">Subcategory</span>
                          </div>
                          <div className="card-content">
                            <div className="card-header">
                              <h5 className="card-title text-lg">{sub.name}</h5>
                              {sub.description && (
                                <p className="card-description">{sub.description}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>

        {/* Back Button */}
        <button 
          onClick={() => navigate(-1)} 
          className="back-button"
          aria-label="Go back"
        >
          <FaArrowLeft /> Back
        </button>

        {/* Settings Button */}
        {user && (
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="settings-toggle-button"
          >
            <FaCog /> Settings
          </button>
        )}

        {/* Settings Section */}
        {user && (
          <div className="settings-section mt-8">
            <div className="settings-header">
              <h2 className="text-2xl font-semibold">Settings</h2>
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className="settings-toggle"
              >
                <FaCog className={showSettings ? 'rotate-180' : ''} />
              </button>
            </div>

            {showSettings && (
              <div className="settings-content">
                <h3 className="settings-title">Available Categories:</h3>
                <div className="category-filter">
                  <Select
                    isMulti
                    options={categories.map(cat => ({
                      value: cat.id,
                      label: cat.name
                    }))}
                    value={selectedCategories}
                    onChange={handleCategoryFilterChange}
                    placeholder="Filter by categories..."
                    className="filter-select"
                    classNamePrefix="filter"
                  />
                </div>
                <div className="settings-categories-grid">
                  {categoriesLoading ? (
                    <Skeleton count={3} />
                  ) : categories.length > 0 ? (
                    categories.map((category) => renderCategoryCard(category))
                  ) : (
                    <p className="text-gray-500">No categories available</p>
                  )}
                </div>
                {categories.length > 0 && (
                  <div className="settings-footer">
                    <button
                      onClick={handleSaveCategories}
                      disabled={isSaving}
                      className="save-button"
                    >
                      {isSaving ? 'Saving...' : 'Save Categories'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChurchInfo;