import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db, auth, firebaseDebug, storage } from "../firebase";
import { ref, getDownloadURL } from "firebase/storage";
import "./Search.css";
import { 
  collection, 
  getDocs, 
  setDoc,
  doc,
  writeBatch
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

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
    console.log('Search component - Environment variables:');
    console.log('REACT_APP_FIREBASE_STORAGE_BUCKET:', process.env.REACT_APP_FIREBASE_STORAGE_BUCKET);
    console.log('Firebase storage object:', storage);
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
      console.log('getImageUrl: No image path provided');
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
        console.log('getImageUrl: Already a full URL:', imagePath);
        return imagePath;
      }
      
      console.log('getImageUrl: Getting download URL for path:', imagePath);
      // If it's a Firebase Storage path, get download URL with token
      const imageRef = ref(storage, imagePath);
      const downloadUrl = await getDownloadURL(imageRef);
      console.log('getImageUrl: Successfully got download URL:', downloadUrl);
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
    const fetchChurches = async () => {
      try {
        setIsLoading(true);
        setError(null);
        firebaseDebug('Fetching churches from Firestore');
        
        // Try to get churches from Firestore
        const querySnapshot = await getDocs(collection(db, "churches"));
        const churchData = querySnapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        }));
        
        // Debug: Log first church to see field structure
        if (churchData.length > 0) {
          console.log('Church data structure:', churchData[0]);
          console.log('Header image field:', churchData[0].headerImage);
          console.log('Logo field:', churchData[0].logo);
          console.log('Brand field:', churchData[0].brand);
        }
        
        // Filter out inactive churches
        const activeChurches = churchData.filter(church => {
          // Handle different possible values for isActive
          return church.isActive === true || church.isActive === "true";
        });
        console.log(`Filtered ${churchData.length} total churches to ${activeChurches.length} active churches`);
        
        setChurches(activeChurches);
        firebaseDebug(`Successfully fetched ${activeChurches.length} active churches`);
      } catch (error) {
        console.error("❌ Error fetching churches:", error);
        firebaseDebug(`Error fetching churches: ${error.message}`);
        
        if (error.code === 'permission-denied') {
          setError("You need to be logged in to search organizations.");
        } else {
          setError(`Error loading churches: ${error.message}`);
        }
        
        // Set empty array to avoid undefined errors
        setChurches([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchChurches();
  }, []);

  // Fetch brands
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        console.log('Fetching brands from Firestore...');
        const brandsSnapshot = await getDocs(collection(db, "brands"));
        const brandsData = brandsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        console.log('Brands fetched successfully:', brandsData.length, 'brands');
        console.log('Brands data:', brandsData);
        setBrands(brandsData);
        
        // Preload brand logos
        const logos = {};
        for (const brand of brandsData) {
          if (brand.imageUrl || brand.logo) { // Check both imageUrl and logo fields
            try {
              console.log(`Loading logo for brand ${brand.name || brand.id}: ${brand.imageUrl || brand.logo}`);
              
              // Use the same logic as GlobalOrganizationManager
              let logoUrl = brand.imageUrl || brand.logo;
              if (!logoUrl.startsWith('http')) {
                if (logoUrl.startsWith('/')) {
                  const encodedPath = encodeURIComponent(logoUrl.substring(1));
                  logoUrl = `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodedPath}?alt=media`;
                } else {
                  // Try to get download URL from Firebase Storage
                  const logoRef = ref(storage, logoUrl);
                  logoUrl = await getDownloadURL(logoRef);
                }
              }
              
              logos[brand.id] = logoUrl;
              console.log(`Logo loaded for ${brand.name || brand.id}: ${logoUrl}`);
            } catch (error) {
              console.warn(`Failed to preload logo for brand ${brand.id}:`, error);
            }
          }
        }
        setBrandLogos(logos);
        console.log('Brand logos loaded:', logos);
        
        // TEMP: Add test logos for debugging
        if (brandsData.length > 0) {
          console.log('TEMP: Adding test logos for debugging');
          // Add a test logo for the first brand if it doesn't have one
          if (!logos[brandsData[0].id] && (!brandsData[0].imageUrl && !brandsData[0].logo)) {
            logos[brandsData[0].id] = '/logo.png'; // Use the default logo as test
            console.log(`TEMP: Added test logo for ${brandsData[0].name}: /logo.png`);
          }
        }
        setBrandLogos(logos);
      } catch (error) {
        console.error("Error fetching brands:", error);
        // Don't set error state for brands as it's not critical
      }
    };

    fetchBrands();
  }, []);

  // Debug: Log when selectedBrand or brandLogos change
  useEffect(() => {
    console.log('Selected brand changed:', selectedBrand);
    console.log('Available brand logos:', Object.keys(brandLogos));
    console.log('Current logo URL:', selectedBrand ? brandLogos[selectedBrand] : 'none');
  }, [selectedBrand, brandLogos]);

  // Handle URL parameter changes for brand
  useEffect(() => {
    const brandParam = searchParams.get('brand');
    if (brandParam !== selectedBrand) {
      setSelectedBrand(brandParam || '');
      setCurrentPage(1); // Reset to first page when brand changes
    }
  }, [searchParams]);

  useEffect(() => {
    const preloadImageUrls = async () => {
      if (churches.length === 0) return;
      
      console.log('Starting image preload for', churches.length, 'churches');
      const urls = {};
      for (const church of churches) {
        const churchId = church.id;
        
        // Preload banner/header image
        if (church.banner) {
          console.log('Preloading banner for church', church.nombre, 'path:', church.banner);
          try {
            const bannerUrl = await getImageUrl(church.banner);
            urls[`${churchId}_banner`] = bannerUrl;
            console.log('Successfully preloaded banner URL:', bannerUrl);
          } catch (error) {
            console.warn(`Failed to preload banner for church ${churchId}:`, error);
          }
        }
        
        // Preload logo image
        if (church.logo) {
          console.log('Preloading logo for church', church.nombre, 'path:', church.logo);
          try {
            const logoUrl = await getImageUrl(church.logo);
            urls[`${churchId}_logo`] = logoUrl;
            console.log('Successfully preloaded logo URL:', logoUrl);
          } catch (error) {
            console.warn(`Failed to preload logo for church ${churchId}:`, error);
          }
        }
      }
      
      console.log('Setting imageUrls state with:', urls);
      setImageUrls(urls);
    };
    
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
    console.log('Filtering churches - selectedBrand:', selectedBrand, 'searchQuery:', searchQuery);
    console.log('Total churches before filtering:', churches.length);

    // Filter by brand first
    if (selectedBrand) {
      console.log('Filtering by brand:', selectedBrand, 'type:', typeof selectedBrand);
      console.log('Available brands:', brands.map(b => ({id: b.id, name: b.name})));
      
      // Debug: Show churches with any brand field
      const churchesWithBrands = churches.filter(church => church.brand || church.brandId || church.brand_id);
      console.log('Churches with any brand field:', churchesWithBrands.length, churchesWithBrands.map(c => `${c.nombre}: ${c.brand || c.brandId || c.brand_id}`));
      
      if (selectedBrand === 'unassigned') {
        // Show churches without brand assignments
        filtered = churches.filter(church => {
          const churchBrand = church.brand || church.brandId || church.brand_id || '';
          const hasNoBrand = !churchBrand || String(churchBrand).trim() === '';
          console.log(`Church ${church.nombre}: brand=${church.brand}, hasNoBrand=${hasNoBrand}`);
          return hasNoBrand;
        });
      } else {
        // Show churches with specific brand - match against both ID and name
        const selectedBrandData = brands.find(b => b.id === selectedBrand);
        const selectedBrandName = selectedBrandData?.name || '';
        
        filtered = churches.filter(church => {
          const churchBrand = church.brand || church.brandId || church.brand_id || '';
          const brandMatch = String(churchBrand).toLowerCase() === String(selectedBrand).toLowerCase() ||
                            String(churchBrand).toLowerCase() === String(selectedBrandName).toLowerCase();
          console.log(`Church ${church.nombre}: brand='${churchBrand}', selectedId='${selectedBrand}', selectedName='${selectedBrandName}', matches=${brandMatch}`);
          return brandMatch;
        });
      }
      console.log('Churches after brand filter:', filtered.length);
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

    console.log('Final filtered churches:', filtered.length);
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
    console.log('handleBrandChange called with:', brandId, 'type:', typeof brandId);
    console.log('Available brand logos:', brandLogos);
    setSelectedBrand(brandId);
    setCurrentPage(1); // Reset to first page
    
    // Update URL parameters
    if (brandId) {
      setSearchParams({ brand: brandId });
    } else {
      setSearchParams({});
    }
  };

  // Skeleton loader component for church cards
  const ChurchCardSkeleton = () => (
    <div className="church-card">
      <div className="card-header">
        <Skeleton height={180} />
        <div className="card-overlay">
          <Skeleton circle width={50} height={50} className="card-logo" />
        </div>
      </div>
      <div className="card-content">
        <Skeleton height={24} width="80%" style={{ margin: '0 auto 15px' }} />
        <Skeleton height={36} width="90%" style={{ marginBottom: '20px' }} />
        <div className="card-actions">
          <Skeleton height={40} width={150} borderRadius={25} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="search-container">
      {/* Header Section */}
      <div className="search-header">
        {/* Logo - changes based on selected brand */}
        <div className="search-logo-container" key={`logo-${selectedBrand}`}>
          {(() => {
            console.log('=== LOGO DISPLAY DEBUG ===');
            console.log('selectedBrand:', selectedBrand);
            console.log('brandLogos keys:', Object.keys(brandLogos));
            console.log('brandLogos[selectedBrand]:', brandLogos[selectedBrand]);
            console.log('brands array:', brands.map(b => ({id: b.id, name: b.name, logo: b.logo, imageUrl: b.imageUrl})));
            console.log('condition check:', selectedBrand && brandLogos[selectedBrand]);
            console.log('========================');
            
            return selectedBrand && brandLogos[selectedBrand] ? (
              <img 
                src={brandLogos[selectedBrand]} 
                alt={`${brands.find(b => b.id === selectedBrand)?.name || 'Brand'} Logo`} 
                className="search-logo" 
                onError={(e) => {
                  console.error('Logo failed to load:', brandLogos[selectedBrand]);
                  e.target.style.display = 'none'; // Hide broken image
                }}
              />
            ) : (
              <img src="/logo.png" alt="Iglesia Tech Logo" className="search-logo" />
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
        {brands.length > 0 && (
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
              {brands.map(brand => (
                <option key={brand.id} value={brand.id}>
                  {brand.name || brand.id}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Debug info */}
        <div style={{ marginBottom: '20px', textAlign: 'center', fontSize: '11px', color: '#999', maxHeight: '60px', overflow: 'hidden' }}>
          <p>Debug: {churches.length} churches, {filteredChurches.length} filtered, {brands.length} brands, Selected: {selectedBrand || 'none'}</p>
        </div>
      </div>

      {/* Church Cards Below Search */}
      {isLoading ? (
        <>
          <h3 className="churches-title">
            📋 Loading Organizations...
          </h3>
          <div className="churches-grid">
            {Array.from({ length: 12 }).map((_, index) => (
              <ChurchCardSkeleton key={index} />
            ))}
          </div>
        </>
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
                        const bucket = process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'igletechv1.firebasestorage.app';
                        const url = church.banner ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o${encodeURIComponent(church.banner)}?alt=media` : "/img/banner-fallback.svg";
                        console.log('Banner URL for church', church.nombre, ':', url, 'Original path:', church.banner);
                        return url;
                      })()
                    } 
                    alt={`${church.nombre} header`} 
                    className="header-image" 
                    onError={(e) => {
                      console.log('Header image failed to load for church:', church.nombre, 'Using fallback');
                      console.log('Failed image src was:', e.target.src);
                      console.log('Church banner path:', church.banner);
                      console.log('Preloaded banner URL:', imageUrls[`${church.id}_banner`]);
                      e.target.src = "/img/banner-fallback.svg";
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
                            url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o${encodeURIComponent(church.logo)}?alt=media`;
                          } else if (church.Logo) {
                            url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o${encodeURIComponent(church.Logo)}?alt=media`;
                          } else {
                            url = "/img/logo-fallback.svg";
                          }
                          console.log('Logo URL for church', church.nombre, ':', url, 'Original paths - logo:', church.logo, 'Logo:', church.Logo);
                          return url;
                        })()
                      }
                      alt={`${church.nombre} logo`} 
                      className="card-logo" 
                      onError={(e) => {
                        console.log('Logo image failed to load for church:', church.nombre, 'Using fallback');
                        console.log('Failed logo src was:', e.target.src);
                        console.log('Church logo paths - logo:', church.logo, 'Logo:', church.Logo);
                        console.log('Preloaded logo URL:', imageUrls[`${church.id}_logo`]);
                        e.target.src = "/img/logo-fallback.svg";
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

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="pagination-container">
              <button 
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="pagination-button"
              >
                ← Previous
              </button>
              
              <div className="pagination-numbers">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`pagination-number ${currentPage === page ? 'active' : ''}`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              
              <button 
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="pagination-button"
              >
                Next →
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