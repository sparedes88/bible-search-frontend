import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db, auth, firebaseDebug, storage } from "../firebase";
import { ref, getDownloadURL } from "firebase/storage";
import "./Search.css";
import "./Search.responsive.css";
import {
  collection,
  getDocs,
  setDoc,
  doc,
  writeBatch,
  query,
  where,
  orderBy
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";

const ENABLE_SEARCH_DEBUG = false;
const searchDebug = (...args) => {
  if (ENABLE_SEARCH_DEBUG) {
    console.log(...args);
  }
};

const Search = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [churches, setChurches] = useState([]);
  const [filteredChurches, setFilteredChurches] = useState([]);
  const [isCreatingChurch, setIsCreatingChurch] = useState(false);
  const [newChurch, setNewChurch] = useState({
    nombre: "",
    adminEmail: "",
    adminPassword: "",
    adminPhone: "",
    adminName: "",
    adminLastName: ""
  });

  // Debug environment variables
  useEffect(() => {
    searchDebug('Search component - Environment variables:');
    searchDebug('REACT_APP_FIREBASE_STORAGE_BUCKET:', process.env.REACT_APP_FIREBASE_STORAGE_BUCKET);
    searchDebug('Firebase storage object:', storage);
  }, []);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [churchesPerPage] = useState(12);

  // Brand filtering state
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState(searchParams.get('brand') || '');
  const [brandLogos, setBrandLogos] = useState({});

  // Function to get Firebase Storage download URL
  const getImageUrl = async (imagePath) => {
    if (!imagePath) {
      searchDebug('getImageUrl: No image path provided');
      return null;
    }

    // Check if storage is available
    if (!storage) {
      console.warn('getImageUrl: Storage not available, cannot get image URL for:', imagePath);
      return null;
    }
    
    try {
      // If it's already a full URL, return as is
      if (imagePath.startsWith('http')) {
        searchDebug('getImageUrl: Already a full URL:', imagePath);
        return imagePath;
      }
      
      searchDebug('getImageUrl: Getting download URL for path:', imagePath);
      // If it's a Firebase Storage path, get download URL with token
      const imageRef = ref(storage, imagePath);
      const downloadUrl = await getDownloadURL(imageRef);
      searchDebug('getImageUrl: Successfully got download URL:', downloadUrl);
      return downloadUrl;
    } catch (error) {
      console.warn('getImageUrl: Failed to get image URL for path:', imagePath, 'Error:', error);
      return null;
    }
  };

  // State to store resolved image URLs
  const [imageUrls, setImageUrls] = useState({});
  
  // Reset to first page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Calculate pagination
  const getCurrentChurches = () => {
    const churchesToPaginate = (searchQuery || selectedBrand) ? filteredChurches : churches;
    const startIndex = (currentPage - 1) * churchesPerPage;
    const endIndex = startIndex + churchesPerPage;
    return churchesToPaginate.slice(startIndex, endIndex);
  };

  const totalPages = Math.ceil(((searchQuery || selectedBrand) ? filteredChurches.length : churches.length) / churchesPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  useEffect(() => {
    // Load churches with timeout to prevent blocking
    const fetchChurches = async () => {
      try {
        setError(null);
        
        // Set timeout to prevent long blocking while allowing larger church datasets to load.
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );
        
        const fetchPromise = (async () => {
          firebaseDebug('Fetching churches from Firestore');

          const churchesRef = collection(db, "churches");
          const q = query(churchesRef, where("isActive", "==", true));
          
          const querySnapshot = await getDocs(q);
          
          const activeChurches = querySnapshot.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
          }));
          
          firebaseDebug(`Successfully fetched ${activeChurches.length} active churches`);
          return activeChurches;
        })();
        
        // Race between fetch and timeout
        const activeChurches = await Promise.race([fetchPromise, timeoutPromise]);
        
        setChurches(activeChurches);
        setIsLoading(false);
      } catch (error) {
        console.error("❌ Error fetching churches:", error);
        
        // If query fails (maybe isActive field doesn't exist), try without filter
        if (error.code === 'failed-precondition' || error.message?.includes('index')) {
          try {
            firebaseDebug('Retrying without isActive filter');
            const churchesRef = collection(db, "churches");
            const q = query(churchesRef);
            const querySnapshot = await getDocs(q);
            const churchData = querySnapshot.docs.map(doc => ({ 
              id: doc.id, 
              ...doc.data() 
            }));
            const activeChurches = churchData.filter(church => {
              return church.isActive === true || church.isActive === "true" || church.isActive === undefined;
            });
            setChurches(activeChurches);
            setIsLoading(false);
            return;
          } catch (retryError) {
            console.error("Retry also failed:", retryError);
          }
        }
        
        if (error.code === 'permission-denied') {
          setError("You need to be logged in to search organizations.");
        } else if (error.message === 'Request timeout') {
          setError("Loading is taking longer than expected. Please refresh.");
          setChurches([]);
        } else {
          setError(`Error loading churches: ${error.message}`);
          setChurches([]);
        }
        setIsLoading(false);
      }
    };

    // Fetch immediately - no delay
    fetchChurches();
  }, []);

  // Fetch brands (non-blocking, but immediate)
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        // Fetch immediately - no delay
        const brandsSnapshot = await getDocs(collection(db, "brands"));
        const brandsData = brandsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setBrands(brandsData);
        
        // Preload brand logos ASYNCHRONOUSLY (non-blocking)
        // Don't wait for logos to load - let them load in background
        const loadLogosAsync = async () => {
          const logos = {};
          const logoPromises = brandsData.map(async (brand) => {
            if (brand.imageUrl || brand.logo) {
              try {
                let logoUrl = brand.imageUrl || brand.logo;
                if (!logoUrl.startsWith('http')) {
                  if (logoUrl.startsWith('/')) {
                    const encodedPath = encodeURIComponent(logoUrl.substring(1));
                    logoUrl = `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodedPath}?alt=media`;
                  } else {
                    try {
                      const logoRef = ref(storage, logoUrl);
                      logoUrl = await Promise.race([
                        getDownloadURL(logoRef),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
                      ]);
                    } catch (err) {
                      return null; // Skip this logo
                    }
                  }
                }
                logos[brand.id] = logoUrl;
              } catch (error) {
                // Skip failed logos silently
              }
            }
            return null;
          });
          
          // Wait for all logos with timeout (reduced for faster loading)
          await Promise.race([
            Promise.all(logoPromises),
            new Promise(resolve => setTimeout(resolve, 1500))
          ]);
          
          setBrandLogos(logos);
        };
        
        // Start logo loading but don't wait for it
        loadLogosAsync();
      } catch (error) {
        console.error("Error fetching brands:", error);
        // Don't set error state for brands as it's not critical
      }
    };

    // Fetch immediately - no delay
    fetchBrands();
  }, []);

  // Debug: Log when selectedBrand or brandLogos change
  useEffect(() => {
    searchDebug('Selected brand changed:', selectedBrand);
    searchDebug('Available brand logos:', Object.keys(brandLogos));
    searchDebug('Current logo URL:', selectedBrand ? brandLogos[selectedBrand] : 'none');
  }, [selectedBrand, brandLogos]);

  // Handle URL parameter changes for brand
  useEffect(() => {
    const brandParam = searchParams.get('brand');
    if (brandParam !== selectedBrand) {
      setSelectedBrand(brandParam || '');
      setCurrentPage(1); // Reset to first page when brand changes
    }
  }, [searchParams]);

  // Compute brands that actually have at least one associated church
  // Helper: robust brand match (handles string, array, or object stored in church.brand)
  const collectStrings = (val, out = []) => {
    if (val == null) return out;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out.push(String(val));
      return out;
    }
    if (Array.isArray(val)) {
      val.forEach(v => collectStrings(v, out));
      return out;
    }
    if (typeof val === 'object') {
      Object.keys(val).forEach(k => collectStrings(val[k], out));
      return out;
    }
    // fallback
    try { out.push(String(val)); } catch (e) {}
    return out;
  };

  const matchesBrand = (church, brandIdOrName) => {
    const raw = church.brand || church.brandId || church.brand_id || '';
    const candidates = collectStrings(raw).map(s => s.toLowerCase().trim()).filter(Boolean);
    // also include church top-level id/name fields that might reference brand
    candidates.push((church.id || '').toString().toLowerCase());
    candidates.push((church.nombre || '').toString().toLowerCase());

    const target = String(brandIdOrName || '').toLowerCase().trim();
    if (!target) return false;

    return candidates.some(s => s === target || s.includes(target) || target.includes(s));
  };

  const [showBrandDebug, setShowBrandDebug] = React.useState(false);

  const visibleBrands = brands;

  // When a brand is selected, fetch all churches from Firestore to avoid the initial 36-item limit
  useEffect(() => {
    const fetchAllForBrand = async () => {
      if (!selectedBrand) return;
      try {
        setIsLoading(true);
        const snapshot = await getDocs(collection(db, "churches"));
        const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Only consider active organizations. Treat explicit false (boolean or string) as inactive.
        const allActive = all.filter(org => !(org.isActive === false || org.isActive === 'false'));
        setChurches(allActive);

        // Apply the same filtering logic used elsewhere on active set
        let filtered = [];
        if (selectedBrand === 'unassigned') {
          filtered = allActive.filter(church => {
            const churchBrand = church.brand || church.brandId || church.brand_id || '';
            return !churchBrand || String(churchBrand).trim() === '';
          });
        } else {
          const selectedBrandData = brands.find(b => b.id === selectedBrand);
          const selectedBrandName = selectedBrandData?.name || '';
          filtered = allActive.filter(church => matchesBrand(church, selectedBrand) || matchesBrand(church, selectedBrandName));
        }

        setFilteredChurches(filtered);
      } catch (error) {
        console.error('Error fetching all churches for brand:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllForBrand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrand]);

  useEffect(() => {
    // DEFER image preloading - don't block initial render
    if (churches.length === 0) return;
    
    const preloadImageUrls = async () => {
      // Preload immediately - no delay
      // Only preload first 12 images (one page worth) for speed
      const imageUrlsToLoad = [];
      const urlMap = {};
      
      churches.slice(0, 12).forEach(church => {
        const churchId = church.id;
        
        if (church.banner) {
          imageUrlsToLoad.push({ url: church.banner, key: `${churchId}_banner` });
        }
        if (church.logo) {
          imageUrlsToLoad.push({ url: church.logo, key: `${churchId}_logo` });
        }
      });
      
      // Load images in larger batches (10 at a time) for faster loading
      const batchSize = 10;
      for (let i = 0; i < imageUrlsToLoad.length; i += batchSize) {
        const batch = imageUrlsToLoad.slice(i, i + batchSize);
        const loadPromises = batch.map(async ({ url, key }) => {
          try {
            const imageUrl = await Promise.race([
              getImageUrl(url),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
            ]);
            urlMap[key] = imageUrl;
            // Update state incrementally for better UX
            setImageUrls(prev => ({ ...prev, [key]: imageUrl }));
          } catch (error) {
            // Skip failed images silently
          }
        });
        
        // Wait for batch with timeout (reduced for faster loading)
        await Promise.race([
          Promise.all(loadPromises),
          new Promise(resolve => setTimeout(resolve, 1500))
        ]);
      }
    };
    
    // Start preloading but don't block
    preloadImageUrls();
  }, [churches]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setIsLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  // Filter churches based on search query and brand
  useEffect(() => {
    let filtered = churches;
    searchDebug('Filtering churches - selectedBrand:', selectedBrand, 'searchQuery:', searchQuery);
    searchDebug('Total churches before filtering:', churches.length);

    // Filter by brand first
    if (selectedBrand) {
      searchDebug('Filtering by brand:', selectedBrand, 'type:', typeof selectedBrand);
      searchDebug('Available brands:', brands.map(b => ({id: b.id, name: b.name})));
      
      // Debug: Show churches with any brand field
      const churchesWithBrands = churches.filter(church => church.brand || church.brandId || church.brand_id);
      searchDebug('Churches with any brand field:', churchesWithBrands.length, churchesWithBrands.map(c => `${c.nombre}: ${c.brand || c.brandId || c.brand_id}`));
      
      if (selectedBrand === 'unassigned') {
        // Show churches without brand assignments
        filtered = churches.filter(church => {
          const churchBrand = church.brand || church.brandId || church.brand_id || '';
          const hasNoBrand = !churchBrand || String(churchBrand).trim() === '';
          searchDebug(`Church ${church.nombre}: brand=${church.brand}, hasNoBrand=${hasNoBrand}`);
          return hasNoBrand;
        });
      } else {
        // Show churches with specific brand - use robust matching (supports arrays/objects/ids/names)
        const selectedBrandData = brands.find(b => b.id === selectedBrand);
        const selectedBrandName = selectedBrandData?.name || '';

        const matches = (church) => {
          return matchesBrand(church, selectedBrand) || matchesBrand(church, selectedBrandName);
        };

        filtered = churches.filter(church => {
          const match = matches(church);
          searchDebug(`Church ${church.nombre}: brandRaw=${JSON.stringify(church.brand||church.brandId||church.brand_id||'')}, matches=${match}`);
          return match;
        });
      }
      searchDebug('Churches after brand filter:', filtered.length);
    }

    // Then filter by search query
    if (searchQuery.trim() !== "") {
      filtered = filtered.filter(church =>
        church.nombre && church.nombre.toLowerCase().includes(searchQuery.toLowerCase())
      );
    } else if (!selectedBrand) {
      // If no search query and no brand selected, show no results (only show when searching or brand selected)
      filtered = [];
    }

    searchDebug('Final filtered churches:', filtered.length);
    setFilteredChurches(filtered);
  }, [searchQuery, churches, selectedBrand]);

  const formatAddress = (church) => {
    const addressParts = [];
    
    // Check for various possible field names
    const possibleFields = ['street', 'city', 'state', 'zipCode', 'country', 'address', 'location'];
    possibleFields.forEach(field => {
      if (church[field]) {
        addressParts.push(church[field]);
      }
    });
    
    return addressParts.length > 0 ? addressParts.join(', ') : "Address not specified";
  };

  const handleSearch = (churchName) => {
    if (!churchName.trim()) return;
    
    // First try exact match
    let church = churches.find(church => church.nombre.toLowerCase() === churchName.toLowerCase());
    
    // If no exact match, try partial match
    if (!church) {
      church = churches.find(church => church.nombre.toLowerCase().includes(churchName.toLowerCase()));
    }
    
    if (church) {
      navigate(`/organization/${church.idIglesia}/login`);
    } else {
      alert(`No organization found with name "${churchName}". Please check the spelling or browse the list below.`);
    }
  };

  const handleCreateChurch = async () => {
    try {
      if (!newChurch.nombre || !newChurch.adminEmail || !newChurch.adminPassword) {
        alert("Please fill in all fields");
        return;
      }
  
      // First check if email exists
      try {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          newChurch.adminEmail,
          newChurch.adminPassword
        );
  
        const timestamp = Date.now();
        const churchId = `church_${timestamp}`;
  
        // Batch write to ensure data consistency
        const batch = writeBatch(db);
  
        // Add church document
        const churchRef = doc(db, "churches", churchId);
        batch.set(churchRef, {
          nombre: newChurch.nombre,
          createdAt: new Date(),
          adminId: userCredential.user.uid,
          idIglesia: churchId,
          active: true,
          version: "newchurchv1"
        });
  
        // Add admin user document
        const userRef = doc(db, "users", userCredential.user.uid);
        batch.set(userRef, {
          email: newChurch.adminEmail,
          role: "admin",
          churchId: churchId,
          createdAt: new Date(),
          status: "active",
          name: newChurch.adminName,
          lastName: newChurch.adminLastName,
          phone: newChurch.adminPhone
        });
  
        // Commit the batch
        await batch.commit();
  
        // Reset form and navigate
        setNewChurch({
          nombre: "",
          adminEmail: "",
          adminPassword: "",
          adminPhone: "",
          adminName: "",
          adminLastName: ""
        });
        setIsCreatingChurch(false);
  
        alert("Organization and admin user created successfully!");
        navigate(`/organization/${churchId}/mi-perfil`);
  
      } catch (authError) {
        if (authError.code === 'auth/email-already-in-use') {
          alert("This email is already registered. Please use a different email address.");
        } else {
          throw authError; // Re-throw other auth errors
        }
      }
    } catch (error) {
      console.error("Error creating church:", error);
      if (error.code === 'permission-denied') {
        alert("You don't have permission to create a organization. Please contact support.");
      } else {
        alert(`Error: ${error.message}`);
      }
    }
  };

  const handleBrandChange = (brandId) => {
    searchDebug('handleBrandChange called with:', brandId, 'type:', typeof brandId);
    searchDebug('Available brand logos:', brandLogos);
    setSelectedBrand(brandId);
    setCurrentPage(1); // Reset to first page
    
    // Update URL parameters
    if (brandId) {
      setSearchParams({ brand: brandId });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="search-container">
      {/* Header Section */}
      <div className="search-header">
        {/* Logo - changes based on selected brand */}
        <div className="search-logo-container" key={`logo-${selectedBrand}`}>
          {(() => {
            searchDebug('=== LOGO DISPLAY DEBUG ===');
            searchDebug('selectedBrand:', selectedBrand);
            searchDebug('brandLogos keys:', Object.keys(brandLogos));
            searchDebug('brandLogos[selectedBrand]:', brandLogos[selectedBrand]);
            searchDebug('brands array:', brands.map(b => ({id: b.id, name: b.name, logo: b.logo, imageUrl: b.imageUrl})));
            searchDebug('condition check:', selectedBrand && brandLogos[selectedBrand]);
            searchDebug('========================');
            
            return selectedBrand && brandLogos[selectedBrand] ? (
              <img 
                src={brandLogos[selectedBrand]} 
                alt={`${brands.find(b => b.id === selectedBrand)?.name || 'Brand'} Logo`} 
                className="search-logo" 
                loading="lazy"
                onError={(e) => {
                  console.error('Logo failed to load:', brandLogos[selectedBrand]);
                  e.target.style.display = 'none'; // Hide broken image
                }}
              />
            ) : (
              <img src="/logo.png" alt="Iglesia Tech Logo" className="search-logo" loading="lazy" />
            );
          })()}
        </div>

        <h2 className="search-title">🔍 Search Organization</h2>
        
        <div className="search-input-container">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
            placeholder="Type the organization name..."
            className="search-input"
          />
          <button onClick={() => handleSearch(searchQuery)} className="search-button">Search</button>
        </div>

        {/* Brand Filter - Moved after title for better visibility */}
        {visibleBrands.length > 0 && (
          <div className="brand-filter-container">
            <label style={{ marginRight: '10px', fontWeight: '600', fontSize: '16px' }}>
              Filter by Brand:
            </label>
            <select
              value={selectedBrand}
              onChange={(e) => handleBrandChange(e.target.value)}
              className="brand-select"
            >
              <option value="">All Brands</option>
              <option value="unassigned">Unassigned</option>
              {visibleBrands.map(brand => (
                <option key={brand.id} value={brand.id}>
                  {brand.name || brand.id}
                </option>
              ))}
            </select>
          </div>
        )}

        
      </div>

      {/* Church Cards Below Search */}
      {isLoading && churches.length === 0 ? (
        <div className="churches-grid" style={{ padding: '20px' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
            <div key={i} className="church-card" style={{ 
              background: '#f0f0f0',
              animation: 'pulse 1.5s ease-in-out infinite',
              minHeight: '300px',
              cursor: 'default'
            }}>
              <div style={{ 
                width: '100%', 
                height: '150px', 
                background: '#e0e0e0',
                borderRadius: '8px 8px 0 0'
              }} />
              <div style={{ padding: '15px' }}>
                <div style={{ 
                  height: '20px', 
                  background: '#d0d0d0',
                  borderRadius: '4px',
                  marginBottom: '10px'
                }} />
                <div style={{ 
                  height: '16px', 
                  background: '#d0d0d0',
                  borderRadius: '4px',
                  width: '70%'
                }} />
              </div>
            </div>
          ))}
        </div>
      ) : (searchQuery || selectedBrand || churches.length > 0) && (
        <>
          <h3 className="churches-title">
            {selectedBrand && searchQuery ? 
              `📋 ${brands.find(b => b.id === selectedBrand)?.name || 'Brand'} Organizations (${filteredChurches.length} results for "${searchQuery}")` :
              selectedBrand ? 
                `📋 ${brands.find(b => b.id === selectedBrand)?.name || 'Brand'} Organizations (${filteredChurches.length})` :
                searchQuery ? 
                  `📋 Registered Organizations (${filteredChurches.length} results)` : 
                  `📋 All Organizations (${churches.length})`
            }
          </h3>
          <div className="churches-grid">
            {getCurrentChurches().map((church) => (
              <div 
                key={church.id} 
                className="church-card" 
                onClick={() => handleSearch(church.nombre)}
              >
                <div className="card-header">
                  <img 
                    src={
                      // Use preloaded URL if available
                      imageUrls[`${church.id}_banner`] ||
                      // Fallback to constructing URL
                      (() => {
                        if (!church.banner) {
                          const baseUrl = process.env.PUBLIC_URL || '';
                          return `${baseUrl}/img/banner-fallback.svg`;
                        }
                        const bucket = process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'igletechv1.firebasestorage.app';
                        const cleanPath = church.banner.startsWith('/') ? church.banner.substring(1) : church.banner;
                        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(cleanPath)}?alt=media`;
                        return url;
                      })()
                    } 
                    alt={`${church.nombre} header`} 
                    className="header-image" 
                    loading="lazy"
                    onError={(e) => {
                      searchDebug('Header image failed to load for church:', church.nombre, 'Using fallback');
                      searchDebug('Failed image src was:', e.target.src);
                      searchDebug('Church banner path:', church.banner);
                      searchDebug('Preloaded banner URL:', imageUrls[`${church.id}_banner`]);
                      const baseUrl = process.env.PUBLIC_URL || '';
                      e.target.src = `${baseUrl}/img/banner-fallback.svg`;
                    }}
                  />
                  <div className="card-overlay">
                    <img 
                      src={
                        // Use preloaded URL if available
                        imageUrls[`${church.id}_logo`] ||
                        // Fallback to constructing URL
                        (() => {
                          const bucket = process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'igletechv1.firebasestorage.app';
                          let url;
                          if (church.logo) {
                            const cleanLogo = church.logo.startsWith('/') ? church.logo.substring(1) : church.logo;
                            url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(cleanLogo)}?alt=media`;
                          } else if (church.Logo) {
                            const cleanLogo = church.Logo.startsWith('/') ? church.Logo.substring(1) : church.Logo;
                            url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(cleanLogo)}?alt=media`;
                          } else {
                            const baseUrl = process.env.PUBLIC_URL || '';
                            url = `${baseUrl}/img/logo-fallback.svg`;
                          }
                          searchDebug('Logo URL for church', church.nombre, ':', url, 'Original paths - logo:', church.logo, 'Logo:', church.Logo);
                          return url;
                        })()
                      }
                      alt={`${church.nombre} logo`} 
                      className="card-logo" 
                      onError={(e) => {
                        searchDebug('Logo image failed to load for church:', church.nombre, 'Using fallback');
                        searchDebug('Failed logo src was:', e.target.src);
                        searchDebug('Church logo paths - logo:', church.logo, 'Logo:', church.Logo);
                        searchDebug('Preloaded logo URL:', imageUrls[`${church.id}_logo`]);
                        const baseUrl = process.env.PUBLIC_URL || '';
                      e.target.src = `${baseUrl}/img/logo-fallback.svg`;
                      }}
                    />
                  </div>
                </div>
                <div className="card-content">
                  <h4 className="church-name">{church.nombre}</h4>
                  <p className="church-info">
                    {formatAddress(church)}
                  </p>
                  <div className="card-actions">
                    <button className="visit-button">
                      Visit Organization
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls - Enhanced */}
          {totalPages > 1 && (
            <div className="pagination-container">
              <button 
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="pagination-button pagination-prev"
                aria-label="Previous page"
              >
                <span className="pagination-icon">←</span>
                <span className="pagination-text">Previous</span>
              </button>
              
              <div className="pagination-numbers">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`pagination-number ${currentPage === page ? 'active' : ''}`}
                    aria-label={`Go to page ${page}`}
                    aria-current={currentPage === page ? 'page' : undefined}
                  >
                    {page}
                  </button>
                ))}
              </div>
              
              <button 
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="pagination-button pagination-next"
                aria-label="Next page"
              >
                <span className="pagination-text">Next</span>
                <span className="pagination-icon">→</span>
              </button>
            </div>
          )}
        </>
      )}      {/* Replace the existing ChurchSync button with this */}
      {isCreatingChurch ? (
        <div style={styles.createChurchForm}>
          <h3>Create New Organization</h3>
          <input
            type="text"
            placeholder="Organization Name *"
            value={newChurch.nombre}
            onChange={(e) => setNewChurch({...newChurch, nombre: e.target.value})}
            style={styles.formInput}
            required
          />
          <input
            type="text"
            placeholder="Admin Name *"
            value={newChurch.adminName}
            onChange={(e) => setNewChurch({...newChurch, adminName: e.target.value})}
            style={styles.formInput}
            required
          />
          <input
            type="text"
            placeholder="Admin Last Name *"
            value={newChurch.adminLastName}
            onChange={(e) => setNewChurch({...newChurch, adminLastName: e.target.value})}
            style={styles.formInput}
            required
          />
          <input
            type="tel"
            placeholder="Admin Phone *"
            value={newChurch.adminPhone}
            onChange={(e) => setNewChurch({...newChurch, adminPhone: e.target.value})}
            style={styles.formInput}
            required
            maxLength="7"
            pattern="[0-9]*"
          />
          <input
            type="email"
            placeholder="Admin Email *"
            value={newChurch.adminEmail}
            onChange={(e) => setNewChurch({...newChurch, adminEmail: e.target.value})}
            style={styles.formInput}
            required
          />
          <input
            type="password"
            placeholder="Admin Password *"
            value={newChurch.adminPassword}
            onChange={(e) => setNewChurch({...newChurch, adminPassword: e.target.value})}
            style={styles.formInput}
            required
          />
          <div style={styles.formButtons}>
            <button 
              onClick={handleCreateChurch} 
              style={styles.createButton}
              disabled={!newChurch.nombre || !newChurch.adminEmail || 
                       !newChurch.adminPassword || !newChurch.adminPhone || 
                       !newChurch.adminName || !newChurch.adminLastName}
            >
              Create Organization
            </button>
            <button onClick={() => setIsCreatingChurch(false)} style={styles.cancelButton}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button 
          onClick={() => setIsCreatingChurch(true)} 
          style={styles.churchSyncButton}
        >
          Create Organization
        </button>
      )}
    </div>
  );
};

// Replace the entire styles object with this clean version
const styles = {
  logoContainer: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "15px"
  },
  logo: {
    width: "120px",
    height: "auto"
  },
  title: {
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "20px"
  },
  searchContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: "20px"
  },
  searchInput: {
    padding: "10px",
    fontSize: "16px",
    width: "60%",
    borderRadius: "5px",
    border: "1px solid #ccc",
    outline: "none",
    marginRight: "10px"
  },
  searchButton: {
    padding: "10px 15px",
    fontSize: "16px",
    cursor: "pointer",
    backgroundColor: "#007bff",
    color: "white",
    border: "none",
    borderRadius: "5px"
  },
  tableTitle: {
    fontSize: "20px",
    fontWeight: "600",
    marginTop: "20px"
  },
  cardsContainer: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "20px",
    marginTop: "20px",
    padding: "0 10px"
  },
  churchCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    boxShadow: "0 4px 15px rgba(0, 0, 0, 0.1)",
    overflow: "hidden",
    cursor: "pointer",
    transition: "transform 0.3s ease, box-shadow 0.3s ease",
    border: "1px solid #e1e8ed"
  },
  cardHeader: {
    position: "relative",
    height: "150px",
    overflow: "hidden"
  },
  headerImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover"
  },
  cardOverlay: {
    position: "absolute",
    top: "10px",
    left: "15px",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: "50%",
    padding: "3px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)"
  },
  cardLogo: {
    width: "50px",
    height: "50px",
    borderRadius: "50%",
    objectFit: "cover",
    border: "2px solid #ffffff"
  },
  cardContent: {
    padding: "20px"
  },
  churchName: {
    margin: "0 0 10px 0",
    fontSize: "18px",
    fontWeight: "600",
    color: "#2c3e50",
    textAlign: "center"
  },
  churchInfo: {
    margin: "0 0 15px 0",
    fontSize: "14px",
    color: "#6b7280",
    textAlign: "center"
  },
  cardActions: {
    display: "flex",
    justifyContent: "center"
  },
  visitButton: {
    backgroundColor: "#667eea",
    color: "white",
    border: "none",
    padding: "10px 20px",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background-color 0.3s ease"
  },
  churchCardHover: {
    transform: "translateY(-5px)",
    boxShadow: "0 8px 25px rgba(0, 0, 0, 0.15)"
  },
  visitButtonHover: {
    backgroundColor: "#5a67d8"
  },
  churchSyncButton: {
    marginTop: "20px",
    padding: "10px 20px",
    fontSize: "16px",
    cursor: "pointer",
    backgroundColor: "#28a745",
    color: "white",
    border: "none",
    borderRadius: "5px"
  },
  createChurchForm: {
    marginTop: "20px",
    padding: "20px",
    backgroundColor: "#fff",
    borderRadius: "8px",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)"
  },
  formInput: {
    width: "100%",
    padding: "10px",
    margin: "10px 0",
    fontSize: "16px",
    borderRadius: "5px",
    border: "1px solid #ccc",
    outline: "none"
  },
  formLabel: {
    display: "block",
    textAlign: "left",
    marginBottom: "5px",
    color: "#666",
    fontSize: "14px"
  },
  required: {
    color: "#dc3545",
    marginLeft: "3px"
  },
  formButtons: {
    display: "flex",
    gap: "10px",
    justifyContent: "center",
    marginTop: "20px"
  },
  createButton: {
    padding: "10px 20px",
    fontSize: "16px",
    cursor: "pointer",
    backgroundColor: "#28a745",
    color: "white",
    border: "none",
    borderRadius: "5px"
  },
  cancelButton: {
    padding: "10px 20px",
    fontSize: "16px",
    cursor: "pointer",
    backgroundColor: "#dc3545",
    color: "white",
    border: "none",
    borderRadius: "5px"
  },
  errorContainer: {
    backgroundColor: "#ffe0e0",
    padding: "10px",
    borderRadius: "5px",
    marginBottom: "15px"
  },
  errorText: {
    color: "#d32f2f",
    margin: "0 0 10px 0"
  },
  loginButton: {
    padding: "8px 15px",
    fontSize: "14px",
    cursor: "pointer",
    backgroundColor: "#4F46E5",
    color: "white",
    border: "none",
    borderRadius: "5px"
  }
};

export default Search;