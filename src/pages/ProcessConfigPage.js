import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import Select from 'react-select';
import { toast } from 'react-toastify';

const ProcessConfigPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchCategories = useCallback(async () => {
    try {
      const categoriesRef = collection(db, 'coursecategories');
      const q = query(categoriesRef, where('churchId', '==', id));
      const querySnapshot = await getDocs(q);
      const categoriesData = querySnapshot.docs.map(doc => ({
        value: doc.id,
        label: doc.data().name,
        ...doc.data()
      }));
      console.log('Fetched categories:', categoriesData);
      setCategories(categoriesData);
      return categoriesData;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  }, [id]);

  const fetchProcessConfig = useCallback(async (availableCategories) => {
    try {
      const configRef = doc(db, 'churches', id, 'config', 'process');
      const configDoc = await getDoc(configRef);
      if (configDoc.exists()) {
        const categoryIds = configDoc.data().categoryIds || [];
        console.log('Fetched category IDs:', categoryIds);
        const selectedCats = availableCategories.filter(cat => categoryIds.includes(cat.value));
        console.log('Selected categories:', selectedCats);
        setSelectedCategories(selectedCats);
      }
    } catch (error) {
      console.error('Error fetching process config:', error);
      throw error;
    }
  }, [id]);

  useEffect(() => {
    const initializeData = async () => {
      if (!user) {
        console.log('No user found, redirecting to login');
        navigate('/login');
        return;
      }

      if (user.role !== 'global_admin') {
        console.log('User is not global admin, redirecting');
        navigate(`/organization/${id}`);
        return;
      }

      try {
        setLoading(true);
        const categoriesData = await fetchCategories();
        await fetchProcessConfig(categoriesData);
      } catch (error) {
        console.error('Error initializing data:', error);
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    initializeData();
  }, [user, navigate, id, fetchCategories, fetchProcessConfig]);

  const handleSave = async () => {
    try {
      setSaving(true);
      console.log('Saving categories:', selectedCategories);
      
      const configRef = doc(db, 'churches', id, 'config', 'process');
      const dataToSave = {
        categoryIds: selectedCategories.map(cat => cat.value),
        updatedAt: new Date(),
        updatedBy: user.uid
      };
      
      console.log('Saving data:', dataToSave);
      await setDoc(configRef, dataToSave);
      
      toast.success('Process categories configured successfully!');
      navigate(`/organization/${id}/mi-perfil`);
    } catch (error) {
      console.error('Error saving process config:', error);
      setError('Failed to save configuration');
      toast.error('Error saving configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600">{error}</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <button 
        onClick={() => navigate(`/organization/${id}/mi-perfil`)}
        className="mb-4 flex items-center text-blue-600 hover:text-blue-800"
      >
        ← Back to Profile
      </button>

      <h1 className="text-2xl font-bold mb-6">Process Configuration</h1>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Select Process Categories:
          </label>
          <Select
            isMulti
            value={selectedCategories}
            onChange={setSelectedCategories}
            options={categories}
            className="basic-multi-select"
            classNamePrefix="select"
            placeholder="Select categories..."
          />
        </div>

        <button
          onClick={handleSave}
          disabled={selectedCategories.length === 0 || saving}
          className={`w-full py-2 px-4 rounded ${
            selectedCategories.length === 0 || saving
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};

export default ProcessConfigPage;