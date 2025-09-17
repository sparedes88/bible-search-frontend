import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs, 
  getDoc, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { FaPlus, FaFileDownload, FaEdit, FaTrash, FaEye, FaSearch, FaStripe, FaCalendarAlt, FaRecycle, FaArrowLeft } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import './InvoiceManager.css';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe("pk_live_lFVwMl9P5iRRyJEe3UFIQxeA");

const InvoiceManager = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [filteredInvoices, setFilteredInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    status: 'all',
    startDate: '',
    endDate: '',
  });
  const [paginatedInvoices, setPaginatedInvoices] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    status: 'draft',
    items: [{ description: '', quantity: 1, price: '', total: 0 }],
    subtotal: 0,
    taxRate: 0,
    taxAmount: 0,
    discountRate: 0,
    discountAmount: 0,
    total: 0,
    notes: ''
  });
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [recurringForm, setRecurringForm] = useState({
    frequency: 'monthly',
    amount: 0,
    startDate: new Date().toISOString().split('T')[0],
    description: '',
    status: 'active'
  });
  const [recurringInvoices, setRecurringInvoices] = useState([]);
  const [payingInvoice, setPayingInvoice] = useState(null);

  const statusOptions = [
    { value: 'draft', label: 'Draft', color: '#6B7280' },
    { value: 'pending', label: 'Pending', color: '#F59E0B' },
    { value: 'paid', label: 'Paid', color: '#10B981' },
    { value: 'overdue', label: 'Overdue', color: '#EF4444' },
    { value: 'cancelled', label: 'Cancelled', color: '#6B7280' }
  ];

  useEffect(() => {
    fetchInvoices();
    fetchRecurringInvoices();
  }, [id]);

  useEffect(() => {
    applyFilters();
  }, [invoices, searchTerm, filters]);

  useEffect(() => {
    const offset = (currentPage - 1) * itemsPerPage;
    setPaginatedInvoices(filteredInvoices.slice(offset, offset + itemsPerPage));
  }, [filteredInvoices, currentPage, itemsPerPage]);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const invoicesRef = collection(db, `churches/${id}/invoices`);
      const q = query(invoicesRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const invoicesData = [];
      querySnapshot.forEach((doc) => {
        invoicesData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setInvoices(invoicesData);
      setFilteredInvoices(invoicesData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching invoices:', error);
      toast.error('Failed to load invoices');
      setLoading(false);
    }
  };

  const fetchRecurringInvoices = async () => {
    try {
      const recurringRef = collection(db, `churches/${id}/recurringInvoices`);
      const q = query(recurringRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const recurringData = [];
      querySnapshot.forEach((doc) => {
        recurringData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setRecurringInvoices(recurringData);
    } catch (error) {
      console.error('Error fetching recurring invoices:', error);
      toast.error('Failed to load recurring invoices');
    }
  };

  const applyFilters = () => {
    let result = [...invoices];
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(invoice => 
        invoice.invoiceNumber?.toLowerCase().includes(term) ||
        invoice.items?.[0]?.description?.toLowerCase().includes(term)
      );
    }
    
    if (filters.status !== 'all') {
      result = result.filter(invoice => invoice.status === filters.status);
    }
    
    if (filters.startDate) {
      result = result.filter(invoice => 
        new Date(invoice.invoiceDate) >= new Date(filters.startDate)
      );
    }
    
    if (filters.endDate) {
      result = result.filter(invoice => 
        new Date(invoice.invoiceDate) <= new Date(filters.endDate)
      );
    }
    
    setFilteredInvoices(result);
    setCurrentPage(1);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    if (name === 'taxRate' || name === 'discountRate') {
      recalculateTotals({ ...formData, [name]: value });
    }
  };

  const handleItemChange = (index, field, value) => {
    const updatedItems = [...formData.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    
    if (field === 'quantity' || field === 'price') {
      const quantity = field === 'quantity' ? parseFloat(value) || 0 : parseFloat(updatedItems[index].quantity) || 0;
      const price = field === 'price' ? parseFloat(value) || 0 : parseFloat(updatedItems[index].price) || 0;
      updatedItems[index].total = quantity * price;
    }
    
    const updatedFormData = { ...formData, items: updatedItems };
    setFormData(updatedFormData);
    recalculateTotals(updatedFormData);
  };

  const recalculateTotals = (data) => {
    const subtotal = data.items.reduce((sum, item) => sum + (item.total || 0), 0);
    const discountRate = parseFloat(data.discountRate) || 0;
    const discountAmount = (subtotal * discountRate) / 100;
    const taxableAmount = subtotal - discountAmount;
    const taxRate = parseFloat(data.taxRate) || 0;
    const taxAmount = (taxableAmount * taxRate) / 100;
    const total = taxableAmount + taxAmount;
    
    setFormData(prev => ({
      ...prev,
      subtotal,
      discountAmount,
      taxAmount,
      total
    }));
  };

  const addItemRow = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: 1, price: '', total: 0 }]
    }));
  };

  const removeItemRow = (index) => {
    if (formData.items.length === 1) {
      return;
    }
    
    const updatedItems = formData.items.filter((_, i) => i !== index);
    const updatedFormData = { ...formData, items: updatedItems };
    setFormData(updatedFormData);
    recalculateTotals(updatedFormData);
  };

  const resetForm = () => {
    const invoiceNumber = generateInvoiceNumber();
    setFormData({
      invoiceNumber,
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: '',
      status: 'draft',
      items: [{ description: '', quantity: 1, price: '', total: 0 }],
      subtotal: 0,
      taxRate: 0,
      taxAmount: 0,
      discountRate: 0,
      discountAmount: 0,
      total: 0,
      notes: ''
    });
    setEditingId(null);
  };

  const generateInvoiceNumber = () => {
    const prefix = 'INV';
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${timestamp}-${random}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.invoiceDate || formData.items.some(item => !item.description || !item.price)) {
      toast.error('Please fill in all required fields');
      return;
    }
    
    try {
      const invoiceData = {
        ...formData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      if (editingId) {
        await updateDoc(doc(db, `churches/${id}/invoices`, editingId), {
          ...invoiceData,
          updatedAt: serverTimestamp()
        });
        toast.success('Invoice updated successfully');
      } else {
        await addDoc(collection(db, `churches/${id}/invoices`), invoiceData);
        toast.success('Invoice created successfully');
      }
      
      resetForm();
      fetchInvoices();
      setShowModal(false);
    } catch (error) {
      console.error('Error saving invoice:', error);
      toast.error('Failed to save invoice');
    }
  };

  const handleEdit = async (invoiceId) => {
    try {
      const docRef = doc(db, `churches/${id}/invoices`, invoiceId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        setFormData(docSnap.data());
        setEditingId(invoiceId);
        setShowModal(true);
      } else {
        toast.error('Invoice not found');
      }
    } catch (error) {
      console.error('Error fetching invoice for edit:', error);
      toast.error('Failed to load invoice details');
    }
  };

  const handleDelete = async (invoiceId) => {
    if (window.confirm('Are you sure you want to delete this invoice?')) {
      try {
        console.log(`Attempting to delete invoice with ID: ${invoiceId}`);
        
        // Check if the invoice exists first
        const docRef = doc(db, `churches/${id}/invoices`, invoiceId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
          console.error(`Invoice with ID ${invoiceId} does not exist`);
          toast.error('Invoice not found. It may have been already deleted.');
          return;
        }
        
        // If it's a paid invoice, show an additional warning
        const invoiceData = docSnap.data();
        if (invoiceData.status === 'paid') {
          const confirmPaidDelete = window.confirm('This invoice has been paid. Are you absolutely sure you want to delete it?');
          if (!confirmPaidDelete) {
            return;
          }
        }
        
        // Proceed with deletion
        await deleteDoc(docRef);
        console.log(`Successfully deleted invoice with ID: ${invoiceId}`);
        toast.success('Invoice deleted successfully');
        
        // Refresh the invoice list
        fetchInvoices();
      } catch (error) {
        console.error('Error deleting invoice:', error);
        toast.error(`Failed to delete invoice: ${error.message}`);
      }
    }
  };

  const handleView = async (invoiceId) => {
    try {
      const docRef = doc(db, `churches/${id}/invoices`, invoiceId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        setViewingInvoice({
          id: docSnap.id,
          ...docSnap.data()
        });
        setShowViewModal(true);
      } else {
        toast.error('Invoice not found');
      }
    } catch (error) {
      console.error('Error fetching invoice details:', error);
      toast.error('Failed to load invoice details');
    }
  };

  const initiateStripePayment = (invoice) => {
    setPayingInvoice(invoice);
  };

  const toggleRecurringStatus = async (invoice) => {
    try {
      const newStatus = invoice.status === 'active' ? 'paused' : 'active';
      await updateDoc(doc(db, `churches/${id}/recurringInvoices`, invoice.id), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      toast.success(`Recurring invoice ${newStatus === 'active' ? 'activated' : 'paused'} successfully`);
      fetchRecurringInvoices();
    } catch (error) {
      console.error('Error updating recurring invoice status:', error);
      toast.error('Failed to update recurring invoice status');
    }
  };

  const handleDeleteRecurringInvoice = async (invoiceId) => {
    if (window.confirm('Are you sure you want to delete this recurring invoice?')) {
      try {
        await deleteDoc(doc(db, `churches/${id}/recurringInvoices`, invoiceId));
        toast.success('Recurring invoice deleted successfully');
        fetchRecurringInvoices();
      } catch (error) {
        console.error('Error deleting recurring invoice:', error);
        toast.error('Failed to delete recurring invoice');
      }
    }
  };

  const generateInvoiceFromRecurring = async (recurringInvoice) => {
    try {
      const invoiceNumber = generateInvoiceNumber();
      const today = new Date().toISOString().split('T')[0];
      
      // Calculate due date (30 days from today)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      const formattedDueDate = dueDate.toISOString().split('T')[0];
      
      const invoiceData = {
        invoiceNumber,
        invoiceDate: today,
        dueDate: formattedDueDate,
        status: 'pending',
        items: [{ 
          description: recurringInvoice.description || `${recurringInvoice.frequency} recurring payment`, 
          quantity: 1, 
          price: recurringInvoice.amount, 
          total: recurringInvoice.amount 
        }],
        subtotal: recurringInvoice.amount,
        taxRate: 0,
        taxAmount: 0,
        discountRate: 0,
        discountAmount: 0,
        total: recurringInvoice.amount,
        notes: `Automatically generated from recurring invoice schedule.`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isRecurring: true,
        recurringInvoiceId: recurringInvoice.id
      };
      
      await addDoc(collection(db, `churches/${id}/invoices`), invoiceData);
      
      // Update next invoice date
      const nextInvoiceDate = new Date();
      if (recurringInvoice.frequency === 'monthly') {
        nextInvoiceDate.setMonth(nextInvoiceDate.getMonth() + 1);
      } else {
        nextInvoiceDate.setFullYear(nextInvoiceDate.getFullYear() + 1);
      }
      
      await updateDoc(doc(db, `churches/${id}/recurringInvoices`, recurringInvoice.id), {
        lastInvoiceDate: serverTimestamp(),
        nextInvoiceDate,
        updatedAt: serverTimestamp()
      });
      
      toast.success('Invoice generated successfully');
      fetchInvoices();
      fetchRecurringInvoices();
    } catch (error) {
      console.error('Error generating invoice:', error);
      toast.error('Failed to generate invoice');
    }
  };

  const InlinePaymentForm = ({ invoice }) => {
    if (!invoice) return null;
    
    if (invoice.status === 'paid') {
      return (
        <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#F0FDF4', borderRadius: '4px' }}>
          <p style={{ color: '#10B981', margin: 0 }}>
            ✓ Paid on {invoice.paymentDate} via {invoice.paymentMethod || 'unknown method'}
          </p>
        </div>
      );
    }

    return (
      <div style={{ 
        marginTop: '20px', 
        padding: '20px', 
        border: '1px solid #E5E7EB', 
        borderRadius: '8px',
        backgroundColor: '#F9FAFB'
      }}>
        <h3 style={{ margin: '0 0 15px 0' }}>Pay Invoice #{invoice.invoiceNumber}</h3>
        
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '15px',
          padding: '10px',
          backgroundColor: 'white',
          borderRadius: '4px',
          border: '1px solid #E5E7EB'
        }}>
          <div>
            <strong>Amount Due:</strong> ${invoice.total.toFixed(2)}
          </div>
          <div>
            <strong>Due Date:</strong> {invoice.dueDate || 'N/A'}
          </div>
        </div>
        
        <Elements stripe={stripePromise}>
          <PaymentProcessor invoice={invoice} onPaymentComplete={() => fetchInvoices()} />
        </Elements>
      </div>
    );
  };

  const PaymentProcessor = ({ invoice, onPaymentComplete }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [cardError, setCardError] = useState(null);
    const [stripeError, setStripeError] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [success, setSuccess] = useState(false);
    const [email, setEmail] = useState('');
    const cardElementRef = useRef(null);
    
    useEffect(() => {
      return () => {
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
      
      cardElementRef.current = cardElement;
      
      setProcessing(true);
      setStripeError(null);
      
      try {
        const { error: paymentMethodError, paymentMethod } = await stripe.createPaymentMethod({
          type: 'card',
          card: cardElementRef.current,
        });
        
        if (paymentMethodError) {
          setCardError(paymentMethodError.message);
          throw new Error(paymentMethodError.message || "Failed to process your payment method.");
        }
        
        if (!cardElementRef.current) {
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
            amount: Math.round(invoice.total * 100),
            currency: 'usd',
            description: `Invoice #${invoice.invoiceNumber} payment`,
            churchId: id,
            metadata: {
              invoiceId: invoice.id
            }
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Network error' }));
          throw new Error(errorData.error || `Server error: ${response.status}`);
        }
        
        const paymentData = await response.json();
        
        if (!cardElementRef.current) {
          console.log('Component unmounted after payment intent creation. Aborting.');
          return;
        }
        
        const { error, paymentIntent } = await stripe.confirmCardPayment(paymentData.clientSecret, {
          payment_method: {
            card: cardElementRef.current,
            billing_details: {
              email: email || undefined,
            },
          },
        });
        
        if (error) {
          throw new Error(error.message || "Payment failed");
        }
        
        if (paymentIntent.status === 'succeeded') {
          await updateDoc(doc(db, `churches/${id}/invoices`, invoice.id), {
            status: 'paid',
            paymentDate: new Date().toISOString(),
            paymentMethod: 'credit_card',
            paymentId: paymentIntent.id,
            updatedAt: serverTimestamp()
          });
          
          toast.success('Payment successful!');
          setSuccess(true);
          
          setTimeout(() => {
            onPaymentComplete();
          }, 2000);
        }
      } catch (error) {
        console.error('Payment error:', error);
        setStripeError(error.message);
        toast.error(error.message || "Payment failed. Please try again.");
      } finally {
        setProcessing(false);
      }
    };
  
    if (success) {
      return (
        <div style={{ 
          padding: '20px', 
          textAlign: 'center', 
          backgroundColor: '#F0FDF4',
          borderRadius: '4px' 
        }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>✓</div>
          <h3 style={{ color: '#10B981', marginBottom: '10px' }}>Payment Successful!</h3>
          <p>Your payment for Invoice #{invoice.invoiceNumber} has been processed successfully.</p>
        </div>
      );
    }
  
    return (
      <form onSubmit={handleSubmitPayment}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Card Details</label>
          <div style={{
            padding: '12px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            backgroundColor: cardError ? '#FEF2F2' : 'white',
            minHeight: '20px'
          }}>
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
              disabled={processing}
              onChange={e => {
                if (e.error) {
                  setCardError(e.error.message);
                } else {
                  setCardError(null);
                }
                
                if (e.complete && elements) {
                  cardElementRef.current = elements.getElement(CardElement);
                }
              }}
              onReady={element => {
                cardElementRef.current = element;
              }}
            />
          </div>
          {cardError && (
            <div style={{color: '#e53e3e', fontSize: '14px', marginTop: '8px'}}>
              {cardError}
            </div>
          )}
          {stripeError && (
            <div style={{color: '#e53e3e', fontSize: '14px', marginTop: '8px'}}>
              {stripeError}
            </div>
          )}
        </div>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>Email Receipt (optional)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            placeholder="Email for receipt (optional)"
          />
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            style={{
              padding: '10px 20px',
              backgroundColor: processing ? '#A78BFA' : '#6772E5',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: processing ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
            }}
            disabled={processing || !stripe || !elements}
          >
            {processing ? 'Processing...' : `Pay $${invoice.total.toFixed(2)}`}
          </button>
        </div>
      </form>
    );
  };

  const styles = {
    container: {
      padding: '20px',
      maxWidth: '1200px',
      margin: '0 auto',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
    },
    title: {
      fontSize: '1.8rem',
      margin: 0,
    },
    filterSection: {
      marginBottom: '20px',
      padding: '15px',
      backgroundColor: '#F9FAFB',
      borderRadius: '8px',
      border: '1px solid #E5E7EB',
    },
    filterRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '15px',
      alignItems: 'center',
    },
    filterControl: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: '200px',
    },
    label: {
      marginBottom: '5px',
      fontSize: '0.9rem',
      fontWeight: '500',
      color: '#374151',
    },
    input: {
      padding: '8px 12px',
      border: '1px solid #D1D5DB',
      borderRadius: '4px',
      fontSize: '0.95rem',
    },
    select: {
      padding: '8px 12px',
      border: '1px solid #D1D5DB',
      borderRadius: '4px',
      fontSize: '0.95rem',
      backgroundColor: '#fff',
    },
    formGroup: {
      marginBottom: '20px',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            onClick={() => navigate(`/church/${id}/mi-organizacion`)} 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 15px',
              backgroundColor: '#4F46E5',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.95rem',
              fontWeight: '500',
            }}
          >
            <FaArrowLeft /> Back to Organization
          </button>
          <h2 style={styles.title}>Invoice Manager</h2>
        </div>
        <button 
          onClick={() => {
            resetForm();
            setFormData(prev => ({
              ...prev,
              invoiceNumber: generateInvoiceNumber()
            }));
            setShowModal(true);
          }} 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 15px',
            backgroundColor: '#4F46E5',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: '500',
          }}
        >
          <FaPlus /> Create New Invoice
        </button>
      </div>
      
      {/* Rendering recurring invoices section */}
      <div style={{marginBottom: '30px'}}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}>
          <h3 style={{fontSize: '1.4rem', margin: 0}}>Recurring Invoices</h3>
          <button 
            onClick={() => setShowRecurringModal(true)} 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 15px',
              backgroundColor: '#4F46E5',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.95rem',
              fontWeight: '500',
            }}
          >
            <FaRecycle /> Create Recurring Invoice
          </button>
        </div>
        
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        }}>
          {recurringInvoices.length === 0 ? (
            <p style={{padding: '20px', textAlign: 'center'}}>No recurring invoices found</p>
          ) : (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
            }}>
              <thead>
                <tr>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'left',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                  }}>Description</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'left',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                  }}>Frequency</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'left',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                  }}>Amount</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'left',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                  }}>Next Invoice</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'left',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                  }}>Status</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'left',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                  }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recurringInvoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td style={{
                      padding: '12px 15px',
                      borderBottom: '1px solid #E5E7EB',
                      color: '#1F2937',
                    }}>{invoice.description || `${invoice.frequency === 'monthly' ? 'Monthly' : 'Yearly'} recurring payment`}</td>
                    <td style={{
                      padding: '12px 15px',
                      borderBottom: '1px solid #E5E7EB',
                      color: '#1F2937',
                    }}>{invoice.frequency === 'monthly' ? 'Monthly' : 'Yearly'}</td>
                    <td style={{
                      padding: '12px 15px',
                      borderBottom: '1px solid #E5E7EB',
                      color: '#1F2937',
                    }}>${invoice.amount.toFixed(2)}</td>
                    <td style={{
                      padding: '12px 15px',
                      borderBottom: '1px solid #E5E7EB',
                      color: '#1F2937',
                    }}>
                      {invoice.nextInvoiceDate ? 
                        new Date(invoice.nextInvoiceDate.seconds * 1000).toLocaleDateString() : 
                        invoice.startDate}
                    </td>
                    <td style={{
                      padding: '12px 15px',
                      borderBottom: '1px solid #E5E7EB',
                      color: '#1F2937',
                    }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        backgroundColor: invoice.status === 'active' ? '#10B981' : '#6B7280',
                        color: 'white',
                        fontSize: '0.8rem'
                      }}>
                        {invoice.status === 'active' ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td style={{
                      padding: '12px 15px',
                      borderBottom: '1px solid #E5E7EB',
                      color: '#1F2937',
                    }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          onClick={() => toggleRecurringStatus(invoice)} 
                          style={{
                            padding: '6px 10px',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            backgroundColor: invoice.status === 'active' ? '#F59E0B' : '#10B981',
                            color: 'white',
                          }}
                        >
                          {invoice.status === 'active' ? 'Pause' : 'Activate'}
                        </button>
                        <button 
                          onClick={() => generateInvoiceFromRecurring(invoice)} 
                          style={{
                            padding: '6px 10px',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            backgroundColor: '#4F46E5',
                            color: 'white',
                          }}
                        >
                          Generate Now
                        </button>
                        <button 
                          onClick={() => handleDeleteRecurringInvoice(invoice.id)} 
                          style={{
                            padding: '6px 10px',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            backgroundColor: '#FEE2E2',
                            color: '#EF4444',
                          }}
                        >
                          <FaTrash /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{
        marginBottom: '20px',
        padding: '15px',
        backgroundColor: '#F9FAFB',
        borderRadius: '8px',
        border: '1px solid #E5E7EB',
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '15px',
          alignItems: 'center',
        }}>
          <div style={{
            position: 'relative',
            flex: '1',
            minWidth: '200px',
          }}>
            <FaSearch style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#9CA3AF',
            }} />
            <input
              type="text"
              placeholder="Search invoices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: '8px 12px 8px 40px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px',
                fontSize: '0.95rem',
                width: '100%',
              }}
            />
          </div>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: '200px',
          }}>
            <label style={styles.label}>Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
              style={styles.select}
            >
              <option value="all">All Statuses</option>
              {statusOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: '200px',
          }}>
            <label style={styles.label}>From Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              style={styles.input}
            />
          </div>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: '200px',
          }}>
            <label style={styles.label}>To Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              style={styles.input}
            />
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: '15px',
        marginBottom: '25px',
      }}>
        {statusOptions.map(status => (
          <div key={status.value} style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            padding: '15px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          }}>
            <h4 style={{
              fontSize: '0.9rem',
              color: '#4B5563',
              marginTop: 0,
              marginBottom: '5px',
            }}>{status.label} Invoices</h4>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '600',
              margin: '10px 0 5px',
              color: status.color
            }}>
              ${invoices.filter(invoice => invoice.status === status.value).reduce((sum, invoice) => sum + (invoice.total || 0), 0).toFixed(2)}
            </div>
            <div style={{
              fontSize: '0.9rem',
              color: '#6B7280',
            }}>
              {invoices.filter(invoice => invoice.status === status.value).length} invoices
            </div>
          </div>
        ))}
        
        <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            padding: '15px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          }}>
          <h4 style={{
            fontSize: '0.9rem',
            color: '#4B5563',
            marginTop: 0,
            marginBottom: '5px',
          }}>Total Invoices</h4>
          <div style={{
            fontSize: '1.5rem',
            fontWeight: '600',
            margin: '10px 0 5px',
          }}>
            ${invoices.reduce((sum, invoice) => sum + (invoice.total || 0), 0).toFixed(2)}
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: '#6B7280',
          }}>
            {invoices.length} invoices
          </div>
        </div>
      </div>

      <div style={{
        backgroundColor: '#fff',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      }}>
        {loading ? (
          <p style={{padding: '20px', textAlign: 'center'}}>Loading...</p>
        ) : paginatedInvoices.length === 0 ? (
          <p style={{padding: '20px', textAlign: 'center'}}>No invoices found</p>
        ) : (
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
          }}>
            <thead>
              <tr>
                <th style={{
                  padding: '12px 15px',
                  textAlign: 'left',
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>Invoice #</th>
                <th style={{
                  padding: '12px 15px',
                  textAlign: 'left',
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>Description</th>
                <th style={{
                  padding: '12px 15px',
                  textAlign: 'left',
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>Date</th>
                <th style={{
                  padding: '12px 15px',
                  textAlign: 'left',
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>Due Date</th>
                <th style={{
                  padding: '12px 15px',
                  textAlign: 'left',
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>Amount</th>
                <th style={{
                  padding: '12px 15px',
                  textAlign: 'left',
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>Status</th>
                <th style={{
                  padding: '12px 15px',
                  textAlign: 'left',
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedInvoices.map(invoice => (
                <tr key={invoice.id}>
                  <td style={{
                    padding: '12px 15px',
                    borderBottom: '1px solid #E5E7EB',
                    color: '#1F2937',
                  }}>{invoice.invoiceNumber}</td>
                  <td style={{
                    padding: '12px 15px',
                    borderBottom: '1px solid #E5E7EB',
                    color: '#1F2937',
                  }}>
                    {invoice.items?.[0]?.description || 'Invoice'}
                  </td>
                  <td style={{
                    padding: '12px 15px',
                    borderBottom: '1px solid #E5E7EB',
                    color: '#1F2937',
                  }}>{invoice.invoiceDate}</td>
                  <td style={{
                    padding: '12px 15px',
                    borderBottom: '1px solid #E5E7EB',
                    color: '#1F2937',
                  }}>{invoice.dueDate || 'N/A'}</td>
                  <td style={{
                    padding: '12px 15px',
                    borderBottom: '1px solid #E5E7EB',
                    color: '#1F2937',
                  }}>${invoice.total.toFixed(2)}</td>
                  <td style={{
                    padding: '12px 15px',
                    borderBottom: '1px solid #E5E7EB',
                    color: '#1F2937',
                  }}>
                    {(() => {
                      const status = statusOptions.find(s => s.value === invoice.status);
                      return (
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          fontWeight: '500',
                          backgroundColor: `${status?.color}20`,
                          color: status?.color
                        }}>
                          {status?.label || invoice.status}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{
                    padding: '12px 15px',
                    borderBottom: '1px solid #E5E7EB',
                    color: '#1F2937',
                  }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => handleView(invoice.id)} 
                        style={{
                          padding: '6px 10px',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          backgroundColor: '#EFF6FF',
                          color: '#3B82F6',
                        }}
                      >
                        <FaEye /> View
                      </button>
                      <button 
                        onClick={() => initiateStripePayment(invoice)} 
                        style={{
                          padding: '6px 10px',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          backgroundColor: '#F0FDF4',
                          color: '#10B981',
                        }}
                        disabled={invoice.status === 'paid'}
                      >
                        <FaStripe /> Pay
                      </button>
                      <button 
                        onClick={() => handleEdit(invoice.id)} 
                        style={{
                          padding: '6px 10px',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          backgroundColor: '#FEF3C7',
                          color: '#D97706',
                        }}
                      >
                        <FaEdit /> Edit
                      </button>
                      <button 
                        onClick={() => handleDelete(invoice.id)} 
                        style={{
                          padding: '6px 10px',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          backgroundColor: '#FEE2E2',
                          color: '#EF4444',
                        }}
                      >
                        <FaTrash /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        
        {!loading && paginatedInvoices.length > 0 && (
          <div style={{ padding: '15px', borderTop: '1px solid #E5E7EB' }}>
            <div className="pagination" style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button 
                onClick={() => setCurrentPage(1)} 
                disabled={currentPage === 1}
                style={{
                  padding: '5px 10px',
                  backgroundColor: currentPage === 1 ? '#F3F4F6' : '#fff',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  color: currentPage === 1 ? '#9CA3AF' : '#374151',
                }}
              >
                First
              </button>
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                disabled={currentPage === 1}
                style={{
                  padding: '5px 10px',
                  backgroundColor: currentPage === 1 ? '#F3F4F6' : '#fff',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  color: currentPage === 1 ? '#9CA3AF' : '#374151',
                }}
              >
                Previous
              </button>
              <span style={{ padding: '5px 10px' }}>
                Page {currentPage} of {Math.ceil(filteredInvoices.length / itemsPerPage) || 1}
              </span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredInvoices.length / itemsPerPage)))} 
                disabled={currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0}
                style={{
                  padding: '5px 10px',
                  backgroundColor: currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0 ? '#F3F4F6' : '#fff',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  cursor: currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0 ? 'not-allowed' : 'pointer',
                  color: currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0 ? '#9CA3AF' : '#374151',
                }}
              >
                Next
              </button>
              <button 
                onClick={() => setCurrentPage(Math.ceil(filteredInvoices.length / itemsPerPage))} 
                disabled={currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0}
                style={{
                  padding: '5px 10px',
                  backgroundColor: currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0 ? '#F3F4F6' : '#fff',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  cursor: currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0 ? 'not-allowed' : 'pointer',
                  color: currentPage === Math.ceil(filteredInvoices.length / itemsPerPage) || filteredInvoices.length === 0 ? '#9CA3AF' : '#374151',
                }}
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail view for invoice with inline payment form */}
      {payingInvoice && (
        <div style={{ marginTop: '30px' }}>
          <h2>Invoice Details: #{payingInvoice.invoiceNumber}</h2>
          
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            marginBottom: '20px'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '20px',
              marginBottom: '20px'
            }}>
              <div>
                <h4 style={{ margin: '0 0 10px 0' }}>Invoice Details</h4>
                <p style={{ margin: '0 0 5px 0' }}>
                  <strong>Date:</strong> {payingInvoice.invoiceDate}
                </p>
                <p style={{ margin: '0 0 5px 0' }}>
                  <strong>Due Date:</strong> {payingInvoice.dueDate || 'N/A'}
                </p>
                <p style={{ margin: '0' }}>
                  <strong>Status:</strong> {
                    statusOptions.find(s => s.value === payingInvoice.status)?.label || 
                    payingInvoice.status
                  }
                </p>
              </div>
              <div>
                <h4 style={{ margin: '0 0 10px 0' }}>Amount Due</h4>
                <p style={{ 
                  fontSize: '24px', 
                  fontWeight: 'bold', 
                  margin: '0',
                  color: payingInvoice.status === 'paid' ? '#10B981' : '#1F2937'
                }}>
                  ${payingInvoice.total.toFixed(2)}
                </p>
                {payingInvoice.status === 'paid' && (
                  <p style={{ color: '#10B981', margin: '5px 0 0 0' }}>
                    ✓ Paid on {payingInvoice.paymentDate} via {payingInvoice.paymentMethod || 'unknown method'}
                  </p>
                )}
              </div>
            </div>
            
            <h4>Items</h4>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              marginBottom: '20px'
            }}>
              <thead>
                <tr>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'left',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                  }}>Description</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'right',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    width: '100px'
                  }}>Quantity</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'right',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    width: '150px'
                  }}>Price</th>
                  <th style={{
                    padding: '12px 15px',
                    textAlign: 'right',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                    color: '#374151',
                    width: '150px'
                  }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {payingInvoice.items.map((item, index) => (
                  <tr key={index}>
                    <td style={{
                      padding: '12px 15px',
                      borderBottom: '1px solid #E5E7EB',
                    }}>{item.description}</td>
                    <td style={{
                      padding: '12px 15px',
                      textAlign: 'right',
                      borderBottom: '1px solid #E5E7EB',
                    }}>{item.quantity}</td>
                    <td style={{
                      padding: '12px 15px',
                      textAlign: 'right',
                      borderBottom: '1px solid #E5E7EB',
                    }}>${parseFloat(item.price).toFixed(2)}</td>
                    <td style={{
                      padding: '12px 15px',
                      textAlign: 'right',
                      borderBottom: '1px solid #E5E7EB',
                    }}>${item.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="3" style={{
                    padding: '12px 15px',
                    textAlign: 'right',
                    fontWeight: 'bold'
                  }}>Subtotal:</td>
                  <td style={{
                    padding: '12px 15px',
                    textAlign: 'right'
                  }}>${payingInvoice.subtotal.toFixed(2)}</td>
                </tr>
                {payingInvoice.discountRate > 0 && (
                  <tr>
                    <td colSpan="3" style={{
                      padding: '12px 15px',
                      textAlign: 'right',
                      fontWeight: 'bold'
                    }}>Discount ({payingInvoice.discountRate}%):</td>
                    <td style={{
                      padding: '12px 15px',
                      textAlign: 'right'
                    }}>-${payingInvoice.discountAmount.toFixed(2)}</td>
                  </tr>
                )}
                {payingInvoice.taxRate > 0 && (
                  <tr>
                    <td colSpan="3" style={{
                      padding: '12px 15px',
                      textAlign: 'right',
                      fontWeight: 'bold'
                    }}>Tax ({payingInvoice.taxRate}%):</td>
                    <td style={{
                      padding: '12px 15px',
                      textAlign: 'right'
                    }}>${payingInvoice.taxAmount.toFixed(2)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan="3" style={{
                    padding: '12px 15px',
                    textAlign: 'right',
                    fontWeight: 'bold',
                    fontSize: '1.1rem'
                  }}>Total:</td>
                  <td style={{
                    padding: '12px 15px',
                    textAlign: 'right',
                    fontWeight: 'bold',
                    fontSize: '1.1rem'
                  }}>${payingInvoice.total.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
            
            {payingInvoice.notes && (
              <>
                <h4>Notes</h4>
                <p style={{ whiteSpace: 'pre-wrap', backgroundColor: '#F9FAFB', padding: '10px', borderRadius: '4px' }}>{payingInvoice.notes}</p>
              </>
            )}
            
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => handleEdit(payingInvoice.id)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#FEF3C7',
                  color: '#D97706',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <FaEdit /> Edit Invoice
              </button>
              <button
                onClick={() => setPayingInvoice(null)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#F3F4F6',
                  color: '#374151',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Close Details
              </button>
            </div>
          </div>
          
          {/* Display inline payment form if invoice is not paid */}
          {payingInvoice.status !== 'paid' && (
            <InlinePaymentForm invoice={payingInvoice} />
          )}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '800px',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          }}>
            <div style={{
              padding: '15px 20px',
              borderBottom: '1px solid #E5E7EB',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h3 style={{
                fontSize: '1.2rem',
                color: '#111827',
                margin: 0,
              }}>
                {editingId ? 'Edit Invoice' : 'Create New Invoice'}
              </h3>
              <button 
                onClick={() => setShowModal(false)} 
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.5rem',
                  color: '#6B7280',
                }}
              >
                &times;
              </button>
            </div>
            <div style={{ padding: '20px' }}>
              <form onSubmit={handleSubmit}>
                {/* Form content */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#F3F4F6',
                      color: '#374151',
                      border: '1px solid #D1D5DB',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#4F46E5',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {editingId ? 'Update Invoice' : 'Create Invoice'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showRecurringModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '800px',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          }}>
            <div style={{
              padding: '15px 20px',
              borderBottom: '1px solid #E5E7EB',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h3 style={{
                fontSize: '1.2rem',
                color: '#111827',
                margin: 0,
              }}>Create Recurring Invoice</h3>
              <button 
                onClick={() => setShowRecurringModal(false)} 
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.5rem',
                  color: '#6B7280',
                }}
              >
                &times;
              </button>
            </div>
            <div style={{ padding: '20px' }}>
              {/* Recurring invoice form */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceManager;