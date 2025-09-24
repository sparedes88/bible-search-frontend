import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from "../contexts/AuthContext";
import { db } from '../firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import ChurchHeader from './ChurchHeader';
import './MyPlan.css';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { toast } from 'react-toastify';

const StripeContextProvider = ({ children }) => {
  const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLIC_KEY || 'your_stripe_public_key');
  
  return (
    <Elements stripe={stripePromise}>
      {children}
    </Elements>
  );
};

const CheckoutSection = ({ product, onCancel, onSuccess }) => {
  const checkoutKey = useRef(`checkout-${product.id}-${Date.now()}`).current;
  
  return (
    <div className="checkout-wrapper">
      <StripeContextProvider key={checkoutKey}>
        <PaymentForm 
          product={product}
          onCancelPayment={onCancel}
          onSuccessPayment={onSuccess}
        />
      </StripeContextProvider>
    </div>
  );
};

const PaymentForm = ({ product, onCancelPayment, onSuccessPayment }) => {
  const [processing, setProcessing] = useState(false);
  const [cardError, setCardError] = useState(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [elementReady, setElementReady] = useState(false);
  
  const stripe = useStripe();
  const elements = useElements();
  const { id } = useParams();
  
  const isMounted = useRef(true);
  const formRef = useRef(null);
  const cardElementRef = useRef(null); // Add ref to track card element
  
  useEffect(() => {
    console.log(`[PaymentForm] Mounting for product: ${product.id}`);
    isMounted.current = true;
    
    return () => {
      console.log(`[PaymentForm] Unmounting for product: ${product.id}`);
      isMounted.current = false;
      // Clear the reference when unmounting
      cardElementRef.current = null;
    };
  }, [product.id]);
  
  const handleSubmit = async (event) => {
    event.preventDefault();
    
    if (!stripe || !elements) {
      toast.error("Payment processor not available. Please try again later.");
      return;
    }
    
    const cardElement = elements.getElement(CardElement);
    
    if (!cardElement) {
      toast.error("Card element not found. Please refresh and try again.");
      return;
    }
    
    // Store a reference to the card element
    cardElementRef.current = cardElement;
    
    if (isMounted.current) {
      setProcessing(true);
      setCardError(null);
    }
    
    try {
      console.log('[PaymentForm] Processing payment...');
      
      // Use our local proxy instead of the direct Firebase URL
      const createIntentUrl = '/firebase-api/createPaymentIntent';
      
      console.log('[PaymentForm] Sending payment intent request through local proxy:', createIntentUrl);
      
      const response = await fetch(createIntentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(product.price * 100),
          currency: 'usd',
          churchId: id,
          productId: product.id,
          productName: product.name
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Network error' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }
      
      const paymentData = await response.json();
      console.log('[PaymentForm] Payment intent created:', paymentData.clientSecret);
      
      // Check if component is still mounted before proceeding
      if (!isMounted.current || !cardElementRef.current) {
        console.log('[PaymentForm] Component unmounted during payment process. Aborting.');
        return;
      }
      
      const { error, paymentIntent } = await stripe.confirmCardPayment(paymentData.clientSecret, {
        payment_method: {
          card: cardElementRef.current,
          billing_details: {
            name: 'Church Admin',
          },
        },
      });
      
      if (error) {
        throw new Error(error.message || "Payment failed");
      }
      
      if (paymentIntent.status === 'succeeded') {
        console.log('[PaymentForm] Payment succeeded:', paymentIntent);
        
        // Only proceed if still mounted
        if (!isMounted.current) {
          console.log('[PaymentForm] Component unmounted after payment. Skipping final steps.');
          return;
        }
        
        await fetch('https://us-central1-igletechv1.cloudfunctions.net/recordPurchase', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            churchId: id,
            productId: product.id,
            productName: product.name,
            amount: product.price,
            paymentIntentId: paymentIntent.id
          }),
        });
        
        if (isMounted.current) {
          setPaymentSuccess(true);
          toast.success(`Successfully purchased ${product.name}!`);
          
          setTimeout(() => {
            if (isMounted.current) {
              onSuccessPayment(product);
            }
          }, 2000);
        }
      }
    } catch (error) {
      console.error('[PaymentForm] Payment error:', error);
      if (isMounted.current) {
        setCardError(error.message);
        toast.error(error.message || "Payment failed. Please try again.");
      }
    } finally {
      if (isMounted.current) {
        setProcessing(false);
      }
    }
  };
  
  if (!stripe || !elements) {
    return <div className="loading-stripe-element">Loading payment form...</div>;
  }
  
  return (
    <div className="payment-form-container">
      <h2>Purchase {product.name}</h2>
      <p className="payment-amount">Amount: ${product.price.toFixed(2)}</p>
      
      <form 
        ref={formRef}
        onSubmit={handleSubmit} 
        className="product-payment-form"
        id={`payment-form-${product.id}`}
      >
        <div className="card-input">
          <label>Card Details</label>
          <div className="card-element-container">
            <CardElement
              id={`card-element-${product.id}`}
              options={{
                style: {
                  base: {
                    fontSize: '16px',
                    color: '#424770',
                    '::placeholder': {
                      color: '#aab7c4',
                    },
                  },
                  invalid: {
                    color: '#9e2146',
                  },
                },
                hidePostalCode: true
              }}
              onChange={e => {
                if (!isMounted.current) return;
                
                if (e.error) {
                  setCardError(e.error.message);
                } else {
                  setCardError(null);
                }
                
                if (e.complete) {
                  setElementReady(true);
                  // Store reference to the card element when it's ready
                  cardElementRef.current = elements.getElement(CardElement);
                }
              }}
            />
            {cardError && <div className="card-error">{cardError}</div>}
          </div>
        </div>
        
        <div className="payment-button-container">
          <button
            type="button"
            className="cancel-button"
            onClick={() => {
              if (isMounted.current && !processing) {
                onCancelPayment();
              }
            }}
            disabled={processing || paymentSuccess}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`payment-button ${processing ? 'processing' : ''} ${paymentSuccess ? 'success' : ''}`}
            disabled={processing || paymentSuccess || !stripe || !elements || !elementReady}
          >
            {paymentSuccess ? 'Payment Successful!' : processing ? 'Processing...' : `Pay $${product.price.toFixed(2)}`}
          </button>
        </div>
        
        <div className="test-card-info">
          <p><strong>Test Card:</strong> 4242 4242 4242 4242 | Exp: Any future date | CVC: Any 3 digits</p>
        </div>
      </form>
    </div>
  );
};

const MyPlan = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [churchData, setChurchData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [purchasedProducts, setPurchasedProducts] = useState([]);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        const churchRef = doc(db, "churches", id);
        const churchSnap = await getDoc(churchRef);
        
        if (churchSnap.exists()) {
          const data = churchSnap.data();
          setChurchData(data);
          
          if (data.planId) {
            const planRef = doc(db, "subscriptionPlans", data.planId);
            const planSnap = await getDoc(planRef);
            
            if (planSnap.exists()) {
              setPlan(planSnap.data());
            }
          } else {
            setPlan({
              name: "Free Plan",
              price: 0,
              features: [
                "Up to 20 users",
                "Basic messaging",
                "Limited storage (10GB)"
              ],
              limitations: [
                "No SMS messaging",
                "Limited analytics"
              ]
            });
          }
          
          if (data.purchasedProducts) {
            setPurchasedProducts(data.purchasedProducts);
          }
        }

        const productsQuery = await getDocs(collection(db, "products"));
        const productsData = [];
        productsQuery.forEach((doc) => {
          productsData.push({
            id: doc.id,
            ...doc.data()
          });
        });
        setProducts(productsData);

        if (productsData.length === 0) {
          setProducts([
            {
              id: 'prod_sample1',
              name: 'SMS Package - 1000 Credits',
              price: 29.99,
              description: 'Purchase 1000 SMS credits for your organization.',
              features: [
                '1000 SMS messages',
                'No expiration',
                'Includes delivery tracking'
              ]
            },
            {
              id: 'prod_sample2',
              name: 'Extended Storage - 50GB',
              price: 9.99,
              description: 'Add 50GB of additional storage to your account.',
              features: [
                '50GB of secure storage',
                'Fast cloud access',
                'Automatic backups'
              ]
            },
            {
              id: 'prod_sample3',
              name: 'Premium Support - 1 Month',
              price: 19.99,
              description: 'Get priority support for one month.',
              features: [
                'Priority email support',
                'Phone support during business hours',
                'Quick response times'
              ]
            }
          ]);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleProductSelect = (product) => {
    setShowCheckout(false);
    setSelectedProduct(null);
    
    setTimeout(() => {
      setSelectedProduct(product);
      setShowCheckout(true);
    }, 50);
  };

  const handleCancelPayment = () => {
    setShowCheckout(false);
    setTimeout(() => {
      setSelectedProduct(null);
    }, 50);
  };

  const handleSuccessPayment = (product) => {
    setPurchasedProducts([...purchasedProducts, product.id]);
    setShowCheckout(false);
    setSelectedProduct(null);
  };

  return (
    <div className="my-plan-container">
      <div className="back-button-container">
        <Link to={`/organization/${id}/mi-organizacion`} className="back-button">
          ← Back
        </Link>
      </div>

      <ChurchHeader id={id} />

      <div className="plan-content">
        <h1>My Subscription Plan</h1>

        {loading ? (
          <div className="loading-indicator">Loading...</div>
        ) : (
          <div className="plan-details">
            <div className="plan-card">
              <div className="plan-header">
                <h2>{plan?.name || "Free Plan"}</h2>
                <div className="plan-price">
                  ${plan?.price || 0}<span>/month</span>
                </div>
              </div>
              
              <div className="plan-body">
                <h3>Features</h3>
                <ul className="features-list">
                  {plan?.features?.map((feature, index) => (
                    <li key={index} className="feature-item">
                      <span className="feature-check">✓</span> {feature}
                    </li>
                  )) || (
                    <li className="feature-item">
                      <span className="feature-check">✓</span> Basic features
                    </li>
                  )}
                </ul>
                
                {plan?.limitations && (
                  <>
                    <h3>Limitations</h3>
                    <ul className="limitations-list">
                      {plan.limitations.map((limitation, index) => (
                        <li key={index} className="limitation-item">
                          <span className="limitation-x">✗</span> {limitation}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              
              <div className="plan-actions">
                <button className="upgrade-btn">Upgrade Plan</button>
                <button className="contact-btn">Contact Support</button>
              </div>
            </div>
            
            <h2 className="usage-title">Current Usage</h2>
            
            <div className="usage-metrics">
              <div className="usage-card">
                <div className="usage-icon">👥</div>
                <div className="usage-info">
                  <h3>Active Users</h3>
                  <div className="progress-container">
                    <div className="progress-bar" style={{width: '40%'}}></div>
                  </div>
                  <div className="usage-details">
                    <span>20 / Unlimited</span>
                    <span>No limit</span>
                  </div>
                </div>
              </div>
              
              <div className="usage-card">
                <div className="usage-icon">🖼️</div>
                <div className="usage-info">
                  <h3>Storage Used</h3>
                  <div className="progress-container">
                    <div className="progress-bar" style={{width: '25%'}}></div>
                  </div>
                  <div className="usage-details">
                    <span>2.5 GB / 10 GB</span>
                    <span>25%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="products-header">
              <h2 className="products-title">Available Products</h2>
              <Link to={`/church/${id}/product-manager`} className="manage-all-products-btn">
                Manage All Products
              </Link>
            </div>
            
            {showCheckout && selectedProduct ? (
              <div className="checkout-section-wrapper" key={`checkout-wrapper-${selectedProduct.id}`}>
                <CheckoutSection 
                  product={selectedProduct}
                  onCancel={handleCancelPayment}
                  onSuccess={handleSuccessPayment}
                />
              </div>
            ) : (
              <div className="products-grid">
                {products.map(product => (
                  <ProductItem 
                    key={product.id} 
                    product={product} 
                    onSelect={handleProductSelect}
                  />
                ))}
              </div>
            )}

            {purchasedProducts.length > 0 && (
              <>
                <h2 className="purchased-title">Your Purchased Products</h2>
                <div className="purchased-products">
                  {purchasedProducts.map(productId => {
                    const product = products.find(p => p.id === productId);
                    return product ? (
                      <div key={productId} className="purchased-product-card">
                        <h3>{product.name}</h3>
                        <p>{product.description}</p>
                        <div className="purchased-badge">Purchased</div>
                      </div>
                    ) : null;
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyPlan;