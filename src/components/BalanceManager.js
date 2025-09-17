import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import ChurchHeader from './ChurchHeader';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import {
  getBalance,
  rechargeBalance,
  getTransactionHistory,
  getPricingInfo,
  calculateMessageAllowance
} from '../services/balanceService';
import './BalanceManager.css';

// Import Stripe directly instead of lazy loading
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

// Initialize Stripe promise outside the component to avoid recreating it
const stripePromise = loadStripe("pk_live_lFVwMl9P5iRRyJEe3UFIQxeA");

const BalanceManager = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [church, setChurch] = useState(null);
  const [balanceData, setBalanceData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rechargeAmount, setRechargeAmount] = useState(10);
  const [showRechargeForm, setShowRechargeForm] = useState(false);
  const [processPayment, setProcessPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [calculatorAmount, setCalculatorAmount] = useState(10);
  const [calculatorMessages, setCalculatorMessages] = useState(0);
  const pricingInfo = getPricingInfo();
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const fetchChurchData = async () => {
      try {
        const churchDoc = await getDoc(doc(db, 'churches', id));
        if (churchDoc.exists()) {
          setChurch(churchDoc.data());
        } else {
          toast.error("Church not found");
          navigate("/");
        }
      } catch (error) {
        console.error('Error fetching church:', error);
        toast.error("Failed to load church data");
      }
    };

    fetchChurchData();
  }, [id, navigate]);

  useEffect(() => {
    const fetchBalanceData = async () => {
      try {
        setLoading(true);
        
        const balance = await getBalance(id);
        setBalanceData(balance);
        
        const history = await getTransactionHistory(id);
        setTransactions(history);

        const messages = calculateMessageAllowance(10);
        setCalculatorMessages(messages);
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching balance data:', error);
        toast.error("Failed to load balance data");
        setLoading(false);
      }
    };

    if (id) {
      fetchBalanceData();
    }
  }, [id]);

  useEffect(() => {
    if (calculatorAmount) {
      const messages = calculateMessageAllowance(calculatorAmount);
      setCalculatorMessages(messages);
    }
  }, [calculatorAmount]);

  const handleRechargeAmountChange = (e) => {
    const amount = Math.max(pricingInfo.minimumRecharge, parseFloat(e.target.value) || 0);
    setRechargeAmount(amount);
  };

  const handleCalculatorAmountChange = (e) => {
    const amount = Math.max(0, parseFloat(e.target.value) || 0);
    setCalculatorAmount(amount);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  const refreshBalanceData = async () => {
    try {
      const balance = await getBalance(id);
      setBalanceData(balance);
      
      const history = await getTransactionHistory(id);
      setTransactions(history);
    } catch (error) {
      console.error('Error refreshing balance data:', error);
    }
  };

  // Payment form component using Stripe
  const PaymentForm = () => {
    const stripe = useStripe();
    const elements = useElements();
    const [cardError, setCardError] = useState(null);
    const cardElementRef = useRef(null);
  
    useEffect(() => {
      return () => {
        // Clear card element reference when component unmounts
        cardElementRef.current = null;
      };
    }, []);

    const handleSubmitPayment = async (event) => {
      event.preventDefault();
      
      if (!stripe || !elements) {
        toast.error("Payment processor not available. Please try again later.");
        return;
      }
      
      const cardElement = elements.getElement(CardElement);
      
      if (!cardElement) {
        toast.error("Card element not found. Please try again.");
        return;
      }
      
      // Store reference to card element
      cardElementRef.current = cardElement;
      
      setProcessPayment(true);
      setCardError(null);
      
      try {
        const { error: paymentMethodError, paymentMethod } = await stripe.createPaymentMethod({
          type: 'card',
          card: cardElementRef.current,
        });
        
        if (paymentMethodError) {
          setCardError(paymentMethodError.message);
          throw new Error(paymentMethodError.message || "Failed to process your payment method.");
        }
        
        // Check if component is still mounted
        if (!isMounted.current || !cardElementRef.current) {
          console.log('Component unmounted during payment process. Aborting.');
          return;
        }
        
        // Use our local proxy instead of the direct Firebase URL
        const createIntentUrl = '/firebase-api/createPaymentIntent';
        
        console.log('Sending payment intent request through local proxy:', createIntentUrl);
        
        const response = await fetch(createIntentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: Math.round(rechargeAmount * 100),
            churchId: id,
            description: `Balance recharge of $${rechargeAmount}`
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Network error' }));
          throw new Error(errorData.error || `Server error: ${response.status}`);
        }
        
        const paymentData = await response.json();
        
        // Confirm card payment
        const { error, paymentIntent } = await stripe.confirmCardPayment(paymentData.clientSecret, {
          payment_method: {
            card: cardElementRef.current,
          },
        });
        
        if (error) {
          throw new Error(error.message || "Payment failed");
        }
        
        // Call rechargeBalance function with payment method ID
        await rechargeBalance(id, rechargeAmount, paymentMethod.id);
        
        if (isMounted.current) {
          setPaymentSuccess(true);
          
          await refreshBalanceData();
          
          toast.success(`Successfully recharged $${rechargeAmount.toFixed(2)}`);
          
          // Reset form after success
          setTimeout(() => {
            if (isMounted.current) {
              setPaymentSuccess(false);
              setShowRechargeForm(false);
            }
          }, 2000);
        }
      } catch (error) {
        console.error('Payment error:', error);
        if (isMounted.current) {
          toast.error(error.message || "Payment failed. Please try again.");
        }
      } finally {
        if (isMounted.current) {
          setProcessPayment(false);
        }
      }
    };
  
    return (
      <form onSubmit={handleSubmitPayment} className="payment-form">
        <div className="amount-input">
          <label htmlFor="amount">Amount ($)</label>
          <input
            id="amount"
            type="number"
            min={pricingInfo.minimumRecharge}
            step="0.01"
            value={rechargeAmount}
            onChange={handleRechargeAmountChange}
            disabled={processPayment || paymentSuccess}
          />
        </div>
        
        <div className="card-input">
          <label>Card Details</label>
          <div className="card-element-container">
            <CardElement
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
                }
              }}
              disabled={processPayment || paymentSuccess}
              onChange={e => {
                if (!isMounted.current) return;
                
                if (e.error) {
                  setCardError(e.error.message);
                } else {
                  setCardError(null);
                }
                
                // Store reference to card element when fully loaded
                if (e.complete) {
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
            onClick={() => setShowRechargeForm(false)}
            disabled={processPayment || paymentSuccess}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`payment-button ${processPayment ? 'processing' : ''} ${paymentSuccess ? 'success' : ''}`}
            disabled={processPayment || paymentSuccess || rechargeAmount < pricingInfo.minimumRecharge || !stripe || !elements}
          >
            {paymentSuccess ? 'Payment Successful!' : processPayment ? 'Processing...' : `Pay $${rechargeAmount.toFixed(2)}`}
          </button>
        </div>
      </form>
    );
  };

  if (loading) {
    return (
      <div className="page-container">
        <ChurchHeader id={id} />
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading balance data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <ChurchHeader id={id} />
      <Link to={`/church/${id}/mi-organizacion`} className="back-button" style={{
        display: "inline-block",
        marginBottom: "15px",
        color: "#3498db",
        textDecoration: "none",
        fontSize: "16px"
      }}>
        ← Back to Organization
      </Link>
      <ToastContainer position="top-right" autoClose={5000} />
      
      <div className="balance-manager-container">
        <h1>Balance Management</h1>
        
        {church && (
          <div className="church-info">
            <h2>{church.name}</h2>
            <p>{church.address}</p>
          </div>
        )}
        
        <div className="balance-container">
          <div className="current-balance">
            <h3>Current Balance</h3>
            <div className="balance-amount">
              ${(balanceData && typeof balanceData.balance === 'number' ? balanceData.balance : 0).toFixed(2)}
            </div>
            {!showRechargeForm && (
              <button 
                className="recharge-button"
                onClick={() => setShowRechargeForm(true)}
              >
                Recharge Balance
              </button>
            )}
          </div>
          
          <div className="message-calculator">
            <h3>Message Calculator</h3>
            <div className="calculator-form">
              <div className="amount-input">
                <label htmlFor="calculatorAmount">Amount ($)</label>
                <input
                  id="calculatorAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={calculatorAmount}
                  onChange={handleCalculatorAmountChange}
                />
              </div>
              <div className="calculator-result">
                <span>Estimated SMS messages:</span>
                <strong>{calculatorMessages}</strong>
              </div>
            </div>
            <div className="pricing-info">
              <p>SMS Cost: ${pricingInfo.costPerMessage.toFixed(4)} per message</p>
              <p>Additional fees may apply depending on destination.</p>
            </div>
          </div>
        </div>
        
        {showRechargeForm && (
          <div className="recharge-section">
            <h3>Recharge Your Balance</h3>
            <div className="recharge-instructions">
              <p>Add funds to your account to send SMS messages.</p>
              <p>Minimum recharge amount: ${pricingInfo.minimumRecharge.toFixed(2)}</p>
            </div>
            
            <Elements stripe={stripePromise}>
              <PaymentForm />
            </Elements>
          </div>
        )}
        
        <div className="transaction-history">
          <h3>Transaction History</h3>
          {transactions.length === 0 ? (
            <p className="no-transactions">No transactions yet.</p>
          ) : (
            <div className="transaction-table-container">
              <table className="transaction-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, index) => (
                    <tr key={index} className={tx.type}>
                      <td>{formatDate(tx.timestamp)}</td>
                      <td>{tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</td>
                      <td>
                        {tx.type === 'charge' ? '-' : ''}
                        ${typeof tx.amount === 'number' ? Math.abs(tx.amount).toFixed(2) : '0.00'}
                      </td>
                      <td>{tx.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BalanceManager;