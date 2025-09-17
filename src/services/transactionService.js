import { db } from "../firebase";
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  doc, 
  updateDoc, 
  deleteDoc, 
  Timestamp, 
  getDoc,
  limit,
  startAfter
} from "firebase/firestore";

const TRANSACTIONS_COLLECTION = "transactions";
const CATEGORIES_COLLECTION = "transaction_categories";
const ACCOUNTS_COLLECTION = "financial_accounts";

// Transaction-related functions
export const addTransaction = async (churchId, transactionData) => {
  try {
    const transactionWithTimestamp = {
      ...transactionData,
      churchId,
      date: Timestamp.fromDate(new Date(transactionData.date)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    
    const docRef = await addDoc(
      collection(db, TRANSACTIONS_COLLECTION), 
      transactionWithTimestamp
    );
    
    return { id: docRef.id, ...transactionWithTimestamp };
  } catch (error) {
    console.error("Error adding transaction:", error);
    throw error;
  }
};

export const getTransactions = async (churchId, filters = {}, paginationParams = {}) => {
  try {
    const { startDate, endDate, type, category, account, searchTerm } = filters;
    const { pageSize = 10, lastVisible = null } = paginationParams;
    
    let transactionsQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("churchId", "==", churchId),
      orderBy("date", "desc")
    );

    // Apply filters if they exist
    if (startDate && endDate) {
      const startTimestamp = Timestamp.fromDate(new Date(startDate));
      const endTimestamp = Timestamp.fromDate(new Date(endDate));
      transactionsQuery = query(
        transactionsQuery,
        where("date", ">=", startTimestamp),
        where("date", "<=", endTimestamp)
      );
    }

    if (type) {
      transactionsQuery = query(transactionsQuery, where("type", "==", type));
    }

    if (category) {
      transactionsQuery = query(transactionsQuery, where("categoryId", "==", category));
    }

    if (account) {
      transactionsQuery = query(transactionsQuery, where("accountId", "==", account));
    }

    // Add pagination
    if (lastVisible) {
      transactionsQuery = query(
        transactionsQuery,
        startAfter(lastVisible),
        limit(pageSize)
      );
    } else {
      transactionsQuery = query(transactionsQuery, limit(pageSize));
    }

    const snapshot = await getDocs(transactionsQuery);
    
    const transactions = [];
    snapshot.forEach((doc) => {
      transactions.push({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date.toDate(),
      });
    });

    // If search term is provided, filter results client-side
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return transactions.filter(
        (transaction) => 
          transaction.description.toLowerCase().includes(term) ||
          transaction.notes?.toLowerCase().includes(term)
      );
    }

    // Return the last document for pagination
    const lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];
    
    return {
      transactions,
      lastVisible: lastVisibleDoc
    };
  } catch (error) {
    console.error("Error getting transactions:", error);
    throw error;
  }
};

export const updateTransaction = async (transactionId, updatedData) => {
  try {
    const transactionRef = doc(db, TRANSACTIONS_COLLECTION, transactionId);
    
    // Update date format if needed
    let dataToUpdate = { ...updatedData, updatedAt: Timestamp.now() };
    
    if (updatedData.date && !(updatedData.date instanceof Timestamp)) {
      dataToUpdate.date = Timestamp.fromDate(new Date(updatedData.date));
    }
    
    await updateDoc(transactionRef, dataToUpdate);
    
    // Get the updated document
    const updatedSnapshot = await getDoc(transactionRef);
    
    if (updatedSnapshot.exists()) {
      const updatedTransaction = {
        id: updatedSnapshot.id,
        ...updatedSnapshot.data(),
        date: updatedSnapshot.data().date.toDate(),
      };
      
      return updatedTransaction;
    }
    
    throw new Error("Transaction not found after update");
  } catch (error) {
    console.error("Error updating transaction:", error);
    throw error;
  }
};

export const deleteTransaction = async (transactionId) => {
  try {
    await deleteDoc(doc(db, TRANSACTIONS_COLLECTION, transactionId));
    return { success: true, id: transactionId };
  } catch (error) {
    console.error("Error deleting transaction:", error);
    throw error;
  }
};

export const getTransactionSummary = async (churchId, dateRange = {}) => {
  try {
    const { startDate, endDate } = dateRange;
    
    let transactionsQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("churchId", "==", churchId)
    );
    
    if (startDate && endDate) {
      const startTimestamp = Timestamp.fromDate(new Date(startDate));
      const endTimestamp = Timestamp.fromDate(new Date(endDate));
      transactionsQuery = query(
        transactionsQuery,
        where("date", ">=", startTimestamp),
        where("date", "<=", endTimestamp)
      );
    }
    
    const snapshot = await getDocs(transactionsQuery);
    
    let totalIncome = 0;
    let totalExpenses = 0;
    
    snapshot.forEach((doc) => {
      const transaction = doc.data();
      
      if (transaction.type === "income") {
        totalIncome += parseFloat(transaction.amount) || 0;
      } else if (transaction.type === "expense") {
        totalExpenses += parseFloat(transaction.amount) || 0;
      }
    });
    
    const balance = totalIncome - totalExpenses;
    
    return {
      totalIncome,
      totalExpenses,
      balance,
      transactionCount: snapshot.size
    };
  } catch (error) {
    console.error("Error getting transaction summary:", error);
    throw error;
  }
};

// Category-related functions
export const getCategories = async (churchId) => {
  try {
    const categoriesQuery = query(
      collection(db, CATEGORIES_COLLECTION),
      where("churchId", "==", churchId),
      orderBy("name", "asc")
    );
    
    const snapshot = await getDocs(categoriesQuery);
    
    const categories = [];
    snapshot.forEach((doc) => {
      categories.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return categories;
  } catch (error) {
    console.error("Error getting categories:", error);
    throw error;
  }
};

export const addCategory = async (churchId, categoryData) => {
  try {
    const categoryWithTimestamp = {
      ...categoryData,
      churchId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    
    const docRef = await addDoc(
      collection(db, CATEGORIES_COLLECTION), 
      categoryWithTimestamp
    );
    
    return { id: docRef.id, ...categoryWithTimestamp };
  } catch (error) {
    console.error("Error adding category:", error);
    throw error;
  }
};

export const updateCategory = async (categoryId, updatedData) => {
  try {
    const categoryRef = doc(db, CATEGORIES_COLLECTION, categoryId);
    
    await updateDoc(categoryRef, {
      ...updatedData,
      updatedAt: Timestamp.now()
    });
    
    const updatedSnapshot = await getDoc(categoryRef);
    
    if (updatedSnapshot.exists()) {
      return {
        id: updatedSnapshot.id,
        ...updatedSnapshot.data()
      };
    }
    
    throw new Error("Category not found after update");
  } catch (error) {
    console.error("Error updating category:", error);
    throw error;
  }
};

export const deleteCategory = async (categoryId) => {
  try {
    await deleteDoc(doc(db, CATEGORIES_COLLECTION, categoryId));
    return { success: true, id: categoryId };
  } catch (error) {
    console.error("Error deleting category:", error);
    throw error;
  }
};

// Account-related functions
export const getAccounts = async (churchId) => {
  try {
    const accountsQuery = query(
      collection(db, ACCOUNTS_COLLECTION),
      where("churchId", "==", churchId),
      orderBy("name", "asc")
    );
    
    const snapshot = await getDocs(accountsQuery);
    
    const accounts = [];
    snapshot.forEach((doc) => {
      accounts.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return accounts;
  } catch (error) {
    console.error("Error getting accounts:", error);
    throw error;
  }
};

export const addAccount = async (churchId, accountData) => {
  try {
    const accountWithTimestamp = {
      ...accountData,
      churchId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    
    const docRef = await addDoc(
      collection(db, ACCOUNTS_COLLECTION), 
      accountWithTimestamp
    );
    
    return { id: docRef.id, ...accountWithTimestamp };
  } catch (error) {
    console.error("Error adding account:", error);
    throw error;
  }
};

export const updateAccount = async (accountId, updatedData) => {
  try {
    const accountRef = doc(db, ACCOUNTS_COLLECTION, accountId);
    
    await updateDoc(accountRef, {
      ...updatedData,
      updatedAt: Timestamp.now()
    });
    
    const updatedSnapshot = await getDoc(accountRef);
    
    if (updatedSnapshot.exists()) {
      return {
        id: updatedSnapshot.id,
        ...updatedSnapshot.data()
      };
    }
    
    throw new Error("Account not found after update");
  } catch (error) {
    console.error("Error updating account:", error);
    throw error;
  }
};

export const deleteAccount = async (accountId) => {
  try {
    await deleteDoc(doc(db, ACCOUNTS_COLLECTION, accountId));
    return { success: true, id: accountId };
  } catch (error) {
    console.error("Error deleting account:", error);
    throw error;
  }
};

export const getAccountBalance = async (accountId) => {
  try {
    const transactionsQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("accountId", "==", accountId)
    );
    
    const snapshot = await getDocs(transactionsQuery);
    
    let balance = 0;
    
    snapshot.forEach((doc) => {
      const transaction = doc.data();
      
      if (transaction.type === "income") {
        balance += parseFloat(transaction.amount) || 0;
      } else if (transaction.type === "expense") {
        balance -= parseFloat(transaction.amount) || 0;
      }
    });
    
    return balance;
  } catch (error) {
    console.error("Error getting account balance:", error);
    throw error;
  }
};