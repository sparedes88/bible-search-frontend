import { db } from '../firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';

// Configuration values
const INITIAL_BALANCE = 5.00; // Initial $5 balance for new churches
const MINIMUM_RECHARGE = 10.00; // Minimum recharge amount
const TWILIO_COST_PER_MESSAGE = 0.0075; // Example Twilio cost per message (this should match your actual Twilio costs)
const PROFIT_MULTIPLIER = 3; // 3x profit margin as requested

// Calculated cost per message (Twilio cost * profit multiplier)
const COST_PER_MESSAGE = TWILIO_COST_PER_MESSAGE * PROFIT_MULTIPLIER;

/**
 * Get the current balance for a church
 * @param {string} churchId - The ID of the church
 * @returns {Promise<Object>} - The balance data
 */
export const getBalance = async (churchId) => {
  try {
    // Check if balance document exists
    const balanceRef = doc(db, 'churches', churchId, 'balance', 'current');
    const balanceDoc = await getDoc(balanceRef);
    
    if (balanceDoc.exists()) {
      return balanceDoc.data();
    } else {
      // Create a new balance document with initial balance if it doesn't exist
      const initialBalanceData = {
        balance: INITIAL_BALANCE,
        messagesSent: 0,
        totalSpent: 0,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      };
      
      await setDoc(balanceRef, initialBalanceData);
      return initialBalanceData;
    }
  } catch (error) {
    console.error('Error getting balance:', error);
    throw error;
  }
};

/**
 * Recharge the balance for a church
 * @param {string} churchId - The ID of the church
 * @param {number} amount - The amount to recharge (minimum $10)
 * @param {string} paymentMethodId - The Stripe payment method ID
 * @returns {Promise<Object>} - The result of the recharge operation
 */
export const rechargeBalance = async (churchId, amount, paymentMethodId) => {
  try {
    // Validate the amount
    if (amount < MINIMUM_RECHARGE) {
      throw new Error(`Minimum recharge amount is $${MINIMUM_RECHARGE.toFixed(2)}`);
    }
    
    // Call the Firebase function to confirm payment and update balance
    const response = await fetch('/api/confirm-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        churchId: churchId,
        amount: amount,
        paymentMethodId: paymentMethodId
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to process payment");
    }
    
    const result = await response.json();
    
    return {
      success: true,
      newBalance: result.newBalance
    };
  } catch (error) {
    console.error('Error recharging balance:', error);
    throw error;
  }
};

/**
 * Deduct from the balance for sent messages
 * @param {string} churchId - The ID of the church
 * @param {number} messageCount - The number of messages sent
 * @returns {Promise<Object>} - The result of the deduction operation
 */
export const deductBalance = async (churchId, messageCount) => {
  try {
    // Get the current balance
    const balanceRef = doc(db, 'churches', churchId, 'balance', 'current');
    const balanceDoc = await getDoc(balanceRef);
    
    if (!balanceDoc.exists()) {
      throw new Error('Balance not found');
    }
    
    const balanceData = balanceDoc.data();
    const currentBalance = balanceData.balance;
    const messagesSent = balanceData.messagesSent || 0;
    const totalSpent = balanceData.totalSpent || 0;
    
    // Calculate the amount to deduct
    const deductAmount = messageCount * COST_PER_MESSAGE;
    
    // Check if there's enough balance
    if (currentBalance < deductAmount) {
      return {
        success: false,
        error: 'Insufficient balance'
      };
    }
    
    // Calculate the new balance
    const newBalance = currentBalance - deductAmount;
    
    // Update the balance
    await updateDoc(balanceRef, {
      balance: newBalance,
      messagesSent: messagesSent + messageCount,
      totalSpent: totalSpent + deductAmount,
      lastUpdated: serverTimestamp()
    });
    
    // Record the transaction
    await addDoc(collection(db, 'churches', churchId, 'transactions'), {
      type: 'deduction',
      amount: deductAmount,
      messageCount: messageCount,
      timestamp: serverTimestamp(),
      balanceBefore: currentBalance,
      balanceAfter: newBalance
    });
    
    return {
      success: true,
      deductedAmount: deductAmount,
      remainingBalance: newBalance
    };
  } catch (error) {
    console.error('Error deducting from balance:', error);
    throw error;
  }
};

/**
 * Calculate the number of messages that can be sent with the current balance
 * @param {number} balance - The current balance
 * @returns {number} - The number of messages that can be sent
 */
export const calculateMessageAllowance = (balance) => {
  return Math.floor(balance / COST_PER_MESSAGE);
};

/**
 * Get the transaction history for a church
 * @param {string} churchId - The ID of the church
 * @param {number} limit - The maximum number of transactions to return
 * @returns {Promise<Array>} - The transaction history
 */
export const getTransactionHistory = async (churchId, transactionLimit = 50) => {
  try {
    const transactionsRef = collection(db, 'churches', churchId, 'transactions');
    const q = query(
      transactionsRef,
      orderBy('timestamp', 'desc'),
      limit(transactionLimit)
    );
    
    const querySnapshot = await getDocs(q);
    const transactions = [];
    
    querySnapshot.forEach((doc) => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return transactions;
  } catch (error) {
    console.error('Error getting transaction history:', error);
    throw error;
  }
};

/**
 * Get the pricing information for messages
 * @returns {Object} - The pricing information
 */
export const getPricingInfo = () => {
  return {
    twillioCostPerMessage: TWILIO_COST_PER_MESSAGE,
    profitMultiplier: PROFIT_MULTIPLIER,
    costPerMessage: COST_PER_MESSAGE,
    minimumRecharge: MINIMUM_RECHARGE,
    initialBalance: INITIAL_BALANCE
  };
};