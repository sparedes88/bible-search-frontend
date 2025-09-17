import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db, storage } from '../firebase';
import { 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { toast } from 'react-toastify';
import './ProductManager.css';
import axios from 'axios';

const ProductManager = () => {
  const { id: churchId, productId } = useParams();
  const [products, setProducts] = useState([]);
  const [stripeProducts, setStripeProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    billingType: 'one-time', // 'one-time', 'monthly', 'yearly'
    features: [''],
    isActive: true,
    stripeProductId: '',  // Store Stripe product ID if available
    stripePriceId: ''     // Store Stripe price ID if available
  });
  const [editMode, setEditMode] = useState(false);
  const [currentProductId, setCurrentProductId] = useState(null);
  const [filterType, setFilterType] = useState('all'); // 'all', 'one-time', 'subscription'
  const [activeTab, setActiveTab] = useState('local'); // 'local' or 'stripe'
  const [stripeApiKey, setStripeApiKey] = useState(''); // For admin input

  useEffect(() => {
    fetchProducts();
    
    // If a specific productId is provided in the URL, load that product in edit mode
    if (productId) {
      loadProductById(productId);
    }
  }, [churchId, productId]);

  const loadProductById = async (id) => {
    try {
      const productDoc = await getDoc(doc(db, "products", id));
      if (productDoc.exists()) {
        const productData = productDoc.data();
        handleEdit({
          id,
          ...productData
        });
      } else {
        toast.error("Product not found");
      }
    } catch (error) {
      console.error("Error loading product:", error);
      toast.error("Failed to load product details");
    }
  };

  const fetchStripeProducts = async () => {
    try {
      setStripeLoading(true);
      // This would normally call your backend API that would fetch products from Stripe
      // Since we don't have direct Stripe integration in this codebase, we'll mock this
      // In a real implementation, you would have an endpoint like:
      
      // For demo purposes only, uncomment this in a real implementation
      /*
      const response = await axios.get('/api/stripe/products', {
        headers: {
          'Authorization': `Bearer ${stripeApiKey}`
        }
      });
      
      if (response.data && response.data.products) {
        setStripeProducts(response.data.products);
      }
      */
      
      // Mock data for demonstration purposes
      setTimeout(() => {
        const mockStripeProducts = [
          {
            id: 'prod_stripe1',
            name: 'Premium Plan',
            description: 'Full access to all premium features',
            active: true,
            images: [],
            metadata: {},
            prices: [
              {
                id: 'price_stripe1',
                product: 'prod_stripe1',
                unit_amount: 2999, // in cents
                currency: 'usd',
                recurring: {
                  interval: 'month'
                }
              }
            ]
          },
          {
            id: 'prod_stripe2',
            name: 'Enterprise Solution',
            description: 'Advanced features for large organizations',
            active: true,
            images: [],
            metadata: {},
            prices: [
              {
                id: 'price_stripe2',
                product: 'prod_stripe2',
                unit_amount: 9999, // in cents
                currency: 'usd',
                recurring: {
                  interval: 'month'
                }
              }
            ]
          },
          {
            id: 'prod_stripe3',
            name: 'One-Time Consultation',
            description: 'One-time professional consultation',
            active: true,
            images: [],
            metadata: {},
            prices: [
              {
                id: 'price_stripe3',
                product: 'prod_stripe3',
                unit_amount: 19999, // in cents
              }
            ]
          }
        ];
        setStripeProducts(mockStripeProducts);
        setStripeLoading(false);
      }, 1000);
      
    } catch (error) {
      console.error('Error fetching Stripe products:', error);
      toast.error('Failed to load Stripe products');
      setStripeLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const productsRef = collection(db, "products");
      let q = productsRef;
      
      // If churchId is provided, filter products for this specific church
      if (churchId) {
        q = query(productsRef, where("churchId", "==", churchId));
      }
      
      const querySnapshot = await getDocs(q);
      
      const productsList = [];
      querySnapshot.forEach((doc) => {
        productsList.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setProducts(productsList);
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleStripeApiKeyChange = (e) => {
    setStripeApiKey(e.target.value);
  };

  const handleFeatureChange = (index, value) => {
    const updatedFeatures = [...formData.features];
    updatedFeatures[index] = value;
    setFormData({ ...formData, features: updatedFeatures });
  };

  const addFeatureField = () => {
    setFormData({ ...formData, features: [...formData.features, ''] });
  };

  const removeFeatureField = (index) => {
    const updatedFeatures = formData.features.filter((_, i) => i !== index);
    setFormData({ ...formData, features: updatedFeatures });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      billingType: 'one-time',
      features: [''],
      isActive: true,
      stripeProductId: '',
      stripePriceId: ''
    });
    setImageFile(null);
    setImagePreview(null);
    setEditMode(false);
    setCurrentProductId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      // Form validation
      if (!formData.name.trim() || !formData.description.trim() || !formData.price) {
        toast.error("Please fill all required fields");
        return;
      }
      
      // Remove empty features
      const cleanedFeatures = formData.features.filter(feature => feature.trim() !== '');
      
      // Prepare product data
      const productData = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        price: parseFloat(formData.price),
        billingType: formData.billingType,
        features: cleanedFeatures,
        isActive: formData.isActive,
        churchId: churchId || null,
        updatedAt: new Date(),
        stripeProductId: formData.stripeProductId || null,
        stripePriceId: formData.stripePriceId || null
      };
      
      let productId;
      let imageUrl = null;
      
      // Upload image if provided
      if (imageFile) {
        // Create unique path for the image
        const timestamp = new Date().getTime();
        const imagePath = `product-images/${churchId || 'global'}/${timestamp}_${imageFile.name}`;
        const imageRef = ref(storage, imagePath);
        
        // Upload to Firebase Storage
        await uploadBytes(imageRef, imageFile);
        imageUrl = await getDownloadURL(imageRef);
        
        // Add image URL to product data
        productData.imageUrl = imageUrl;
        productData.imagePath = imagePath;
      }
      
      if (editMode && currentProductId) {
        // Update existing product
        const productRef = doc(db, "products", currentProductId);
        
        // If we're not changing the image, keep the existing one
        if (!imageFile && products.find(p => p.id === currentProductId)?.imageUrl) {
          const currentProduct = products.find(p => p.id === currentProductId);
          productData.imageUrl = currentProduct.imageUrl;
          productData.imagePath = currentProduct.imagePath;
        }
        
        await updateDoc(productRef, productData);
        toast.success("Product updated successfully");
      } else {
        // Create new product
        productData.createdAt = new Date();
        const docRef = await addDoc(collection(db, "products"), productData);
        productId = docRef.id;
        toast.success("Product created successfully");
      }
      
      // Reset form and refresh product list
      resetForm();
      fetchProducts();
      
    } catch (error) {
      console.error("Error saving product:", error);
      toast.error("Failed to save product");
    }
  };

  const handleEdit = (product) => {
    setFormData({
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      billingType: product.billingType || 'one-time',
      features: product.features && product.features.length > 0 ? product.features : [''],
      isActive: product.isActive !== undefined ? product.isActive : true,
      stripeProductId: product.stripeProductId || '',
      stripePriceId: product.stripePriceId || ''
    });
    
    // Set image preview if available
    if (product.imageUrl) {
      setImagePreview(product.imageUrl);
    } else {
      setImagePreview(null);
    }
    
    setEditMode(true);
    setCurrentProductId(product.id);
  };

  // Function to import a product from Stripe
  const importStripeProduct = (stripeProduct) => {
    const price = stripeProduct.prices && stripeProduct.prices.length > 0 
      ? stripeProduct.prices[0] : null;
    
    // Determine billing type based on price
    let billingType = 'one-time';
    if (price && price.recurring) {
      if (price.recurring.interval === 'month') {
        billingType = 'monthly';
      } else if (price.recurring.interval === 'year') {
        billingType = 'yearly';
      }
    }
    
    // Set formData with Stripe product data
    setFormData({
      name: stripeProduct.name,
      description: stripeProduct.description || '',
      price: price ? (price.unit_amount / 100).toString() : '',
      billingType: billingType,
      features: [''], // Default empty feature
      isActive: stripeProduct.active,
      stripeProductId: stripeProduct.id,
      stripePriceId: price ? price.id : ''
    });
    
    // Set image preview if available
    if (stripeProduct.images && stripeProduct.images.length > 0) {
      setImagePreview(stripeProduct.images[0]);
    } else {
      setImagePreview(null);
    }
    
    toast.info(`Imported "${stripeProduct.name}" from Stripe. Edit details and click "Create Product" to save.`);
  };

  const handleDelete = async (productId) => {
    // Confirm delete
    if (!window.confirm("Are you sure you want to delete this product?")) {
      return;
    }
    
    try {
      // Find the product to get image path
      const product = products.find(p => p.id === productId);
      
      // Delete product document
      await deleteDoc(doc(db, "products", productId));
      
      // Delete the associated image if it exists
      if (product.imagePath) {
        const imageRef = ref(storage, product.imagePath);
        try {
          await deleteObject(imageRef);
        } catch (imageError) {
          console.warn("Image could not be deleted:", imageError);
        }
      }
      
      toast.success("Product deleted successfully");
      fetchProducts();
      
      // Reset form if we were editing this product
      if (currentProductId === productId) {
        resetForm();
      }
    } catch (error) {
      console.error("Error deleting product:", error);
      toast.error("Failed to delete product");
    }
  };

  const formatPrice = (price, billingType) => {
    switch (billingType) {
      case 'monthly':
        return `$${price.toFixed(2)}/month`;
      case 'yearly':
        return `$${price.toFixed(2)}/year`;
      default:
        return `$${price.toFixed(2)}`;
    }
  };

  // Format price from Stripe (which is in cents)
  const formatStripePrice = (price) => {
    if (!price) return 'N/A';
    
    const amount = price.unit_amount / 100;
    
    if (price.recurring) {
      switch(price.recurring.interval) {
        case 'month':
          return `$${amount.toFixed(2)}/month`;
        case 'year':
          return `$${amount.toFixed(2)}/year`;
        default:
          return `$${amount.toFixed(2)}/${price.recurring.interval}`;
      }
    }
    
    return `$${amount.toFixed(2)}`;
  };

  // Filter products based on selected type
  const filteredProducts = products.filter(product => {
    if (filterType === 'all') return true;
    if (filterType === 'one-time') return product.billingType === 'one-time';
    if (filterType === 'subscription') return product.billingType === 'monthly' || product.billingType === 'yearly';
    return true;
  });

  return (
    <div className="product-manager-container">
      <div className="product-manager-header">
        <h1>{editMode ? 'Edit Product' : 'Create New Product'}</h1>
      </div>
      
      <div className="product-manager-content">
        <div className="product-form-container">
          <form onSubmit={handleSubmit} className="product-form">
            <div className="form-group">
              <label htmlFor="name">Product Name*</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Enter product name"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="description">Description*</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Enter product description"
                rows="4"
                required
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="price">Price*</label>
                <div className="price-input-container">
                  <span className="price-currency">$</span>
                  <input
                    type="number"
                    id="price"
                    name="price"
                    value={formData.price}
                    onChange={handleInputChange}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label htmlFor="billingType">Billing Type</label>
                <select
                  id="billingType"
                  name="billingType"
                  value={formData.billingType}
                  onChange={handleInputChange}
                >
                  <option value="one-time">One-time payment</option>
                  <option value="monthly">Monthly subscription</option>
                  <option value="yearly">Yearly subscription</option>
                </select>
              </div>
            </div>
            
            <div className="form-group">
              <label>Product Image</label>
              <div className="image-upload-container">
                <input
                  type="file"
                  id="productImage"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="file-input"
                />
                <label htmlFor="productImage" className="file-input-label">
                  {imageFile ? imageFile.name : "Choose an image"}
                </label>
                
                {imagePreview && (
                  <div className="image-preview">
                    <img src={imagePreview} alt="Product preview" />
                    <button
                      type="button"
                      className="remove-image-btn"
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview(null);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            <div className="form-group">
              <label>Features</label>
              {formData.features.map((feature, index) => (
                <div key={index} className="feature-input-row">
                  <input
                    type="text"
                    value={feature}
                    onChange={(e) => handleFeatureChange(index, e.target.value)}
                    placeholder={`Feature ${index + 1}`}
                  />
                  <button
                    type="button"
                    className="remove-feature-btn"
                    onClick={() => removeFeatureField(index)}
                    disabled={formData.features.length <= 1}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="add-feature-btn"
                onClick={addFeatureField}
              >
                + Add Feature
              </button>
            </div>
            
            <div className="form-group">
              <label className="checkbox-container">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({...formData, isActive: e.target.checked})}
                />
                <span className="checkmark"></span>
                Active (visible to users)
              </label>
            </div>
            
            {/* Display Stripe product ID if it exists */}
            {formData.stripeProductId && (
              <div className="form-group stripe-info">
                <label>Stripe Product ID</label>
                <div className="stripe-id">{formData.stripeProductId}</div>
                <a 
                  href={`https://dashboard.stripe.com/products/${formData.stripeProductId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="stripe-dashboard-link"
                >
                  View in Stripe Dashboard
                </a>
              </div>
            )}
            
            <div className="form-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={resetForm}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="submit-btn"
              >
                {editMode ? 'Update Product' : 'Create Product'}
              </button>
            </div>
          </form>
        </div>
        
        <div className="products-list-container">
          <div className="tabs">
            <button 
              className={`tab-btn ${activeTab === 'local' ? 'active' : ''}`}
              onClick={() => setActiveTab('local')}
            >
              Local Products
            </button>
            <button 
              className={`tab-btn ${activeTab === 'stripe' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('stripe');
                if (stripeProducts.length === 0) {
                  fetchStripeProducts();
                }
              }}
            >
              Stripe Products
            </button>
          </div>
          
          {activeTab === 'local' ? (
            <>
              <div className="products-header">
                <h2>Local Products</h2>
                
                <div className="product-filters">
                  <button 
                    className={`filter-btn ${filterType === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterType('all')}
                  >
                    All
                  </button>
                  <button 
                    className={`filter-btn ${filterType === 'one-time' ? 'active' : ''}`}
                    onClick={() => setFilterType('one-time')}
                  >
                    One-time
                  </button>
                  <button 
                    className={`filter-btn ${filterType === 'subscription' ? 'active' : ''}`}
                    onClick={() => setFilterType('subscription')}
                  >
                    Subscriptions
                  </button>
                </div>
              </div>
              
              {loading ? (
                <div className="loading-indicator">Loading products...</div>
              ) : filteredProducts.length === 0 ? (
                <div className="no-products-message">
                  {filterType === 'all' 
                    ? 'No products found. Create your first product using the form.' 
                    : `No ${filterType === 'one-time' ? 'one-time' : 'subscription'} products found.`}
                </div>
              ) : (
                <div className="products-grid">
                  {filteredProducts.map(product => (
                    <div 
                      key={product.id} 
                      className={`product-card ${!product.isActive ? 'inactive' : ''}`}
                    >
                      {product.imageUrl ? (
                        <div className="product-image">
                          <img src={product.imageUrl} alt={product.name} />
                        </div>
                      ) : (
                        <div className="product-image product-image-placeholder">
                          <span>No Image</span>
                        </div>
                      )}
                      
                      <div className="product-info">
                        <h3>{product.name}</h3>
                        <div className="product-price-badge">
                          {formatPrice(product.price, product.billingType)}
                        </div>
                        <p className="product-description">{product.description}</p>
                        
                        {product.features && product.features.length > 0 && (
                          <div className="product-features-list">
                            <h4>Features:</h4>
                            <ul>
                              {product.features.map((feature, index) => (
                                <li key={index}>{feature}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {!product.isActive && (
                          <div className="inactive-badge">Inactive</div>
                        )}
                        
                        {product.stripeProductId && (
                          <div className="stripe-badge">Stripe Connected</div>
                        )}
                      </div>
                      
                      <div className="product-actions">
                        <button
                          className="edit-product-btn"
                          onClick={() => handleEdit(product)}
                        >
                          Edit
                        </button>
                        <button
                          className="delete-product-btn"
                          onClick={() => handleDelete(product.id)}
                        >
                          Delete
                        </button>
                      </div>
                      
                      {product.stripeProductId && (
                        <div className="stripe-actions">
                          <a 
                            href={`https://dashboard.stripe.com/products/${product.stripeProductId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="stripe-dashboard-btn"
                          >
                            Stripe Dashboard
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="stripe-api-section">
                <h2>Stripe Products</h2>
                <div className="stripe-api-info">
                  <p>
                    View and import products from your Stripe account. This allows you to manage products already created in Stripe.
                  </p>
                  
                  {/* Stripe API Key input for demonstration - in a real app, you'd use server-side auth */}
                  <div className="stripe-api-key-input">
                    <label>Stripe API Key (for demo purposes)</label>
                    <input 
                      type="password"
                      value={stripeApiKey}
                      onChange={handleStripeApiKeyChange}
                      placeholder="Enter your Stripe API key"
                    />
                    <button 
                      className="fetch-stripe-btn"
                      onClick={fetchStripeProducts}
                      disabled={stripeLoading}
                    >
                      {stripeLoading ? 'Loading...' : 'Refresh Products'}
                    </button>
                  </div>
                </div>
                
                {stripeLoading ? (
                  <div className="loading-indicator">Loading Stripe products...</div>
                ) : stripeProducts.length === 0 ? (
                  <div className="no-products-message">
                    No products found in Stripe. Add products in your Stripe dashboard first.
                  </div>
                ) : (
                  <div className="products-grid">
                    {stripeProducts.map(product => (
                      <div 
                        key={product.id} 
                        className={`product-card ${!product.active ? 'inactive' : ''}`}
                      >
                        {product.images && product.images.length > 0 ? (
                          <div className="product-image">
                            <img src={product.images[0]} alt={product.name} />
                          </div>
                        ) : (
                          <div className="product-image product-image-placeholder">
                            <span>No Image</span>
                          </div>
                        )}
                        
                        <div className="product-info">
                          <h3>{product.name}</h3>
                          {product.prices && product.prices.length > 0 && (
                            <div className="product-price-badge">
                              {formatStripePrice(product.prices[0])}
                            </div>
                          )}
                          <p className="product-description">
                            {product.description || 'No description available'}
                          </p>
                          
                          {!product.active && (
                            <div className="inactive-badge">Inactive</div>
                          )}
                          
                          {/* Check if this Stripe product is already in our local database */}
                          {products.some(p => p.stripeProductId === product.id) && (
                            <div className="already-imported-badge">Already Imported</div>
                          )}
                        </div>
                        
                        <div className="product-actions">
                          <button
                            className="import-stripe-btn"
                            onClick={() => importStripeProduct(product)}
                          >
                            Import to Local
                          </button>
                          
                          <a 
                            href={`https://dashboard.stripe.com/products/${product.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="view-in-stripe-btn"
                          >
                            View in Stripe
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="stripe-integration-note">
                  <h3>About Stripe Integration</h3>
                  <p>
                    This tab shows products from your Stripe account. You can import them to your local database, which will:
                  </p>
                  <ul>
                    <li>Create a local copy of the product for display on your site</li>
                    <li>Link the local product to Stripe for payment processing</li>
                    <li>Allow you to customize the product details in your local system</li>
                  </ul>
                  <p>
                    <strong>Note:</strong> Changes made to local products will not automatically update in Stripe.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductManager;