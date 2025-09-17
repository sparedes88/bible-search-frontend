import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import SectionLayout from '../../components/church/SectionLayout';
import styles from '../../styles/sections.module.css';
import { toast } from 'react-toastify';

const Finances = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [finances, setFinances] = useState([]);
  const [isAddingFinance, setIsAddingFinance] = useState(false);
  const [editingFinance, setEditingFinance] = useState(null);
  const [financeForm, setFinanceForm] = useState({
    title: '',
    description: '',
    amount: '',
    type: 'income',
    category: '',
    date: new Date().toISOString().split('T')[0]
  });
  const [financeSearchTerm, setFinanceSearchTerm] = useState('');
  const [financeDateRange, setFinanceDateRange] = useState({
    startDate: '',
    endDate: ''
  });
  const [selectedCategories, setSelectedCategories] = useState([]);

  useEffect(() => {
    const fetchFinances = async () => {
      try {
        const financesCollection = collection(db, 'finances');
        const financesSnapshot = await getDocs(financesCollection);
        const financesData = financesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setFinances(financesData);
      } catch (error) {
        toast.error('Failed to fetch finances');
      }
    };

    fetchFinances();
  }, []);

  const handleAddFinance = async () => {
    try {
      const financesCollection = collection(db, 'finances');
      await addDoc(financesCollection, financeForm);
      toast.success('Finance added successfully');
      setIsAddingFinance(false);
    } catch (error) {
      toast.error('Failed to add finance');
    }
  };

  const handleUpdateFinance = async (id) => {
    try {
      const financeDoc = doc(db, 'finances', id);
      await updateDoc(financeDoc, financeForm);
      toast.success('Finance updated successfully');
      setEditingFinance(null);
    } catch (error) {
      toast.error('Failed to update finance');
    }
  };

  const handleDeleteFinance = async (id) => {
    try {
      const financeDoc = doc(db, 'finances', id);
      await deleteDoc(financeDoc);
      toast.success('Finance deleted successfully');
    } catch (error) {
      toast.error('Failed to delete finance');
    }
  };

  return (
    <SectionLayout 
      id={id}
      title="Financial Management"
      onAdd={() => setIsAddingFinance(true)}
      addButtonText="Add Entry"
      user={user}
    >
      {/* Finance list and modal components */}
    </SectionLayout>
  );
};

export default Finances;
