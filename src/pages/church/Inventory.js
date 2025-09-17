import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import SectionLayout from '../../components/church/SectionLayout';
import styles from '../../styles/sections.module.css';
import { toast } from 'react-toastify';

const Inventory = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [inventory, setInventory] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [inventoryForm, setInventoryForm] = useState({
    name: '',
    description: '',
    quantity: 1,
    roomId: '',
    status: 'available',
    cost: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const fetchInventory = async () => {
      const inventoryCollection = collection(db, 'inventory');
      const inventorySnapshot = await getDocs(inventoryCollection);
      const inventoryData = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInventory(inventoryData);
    };

    fetchInventory();
  }, []);

  const handleAddItem = async () => {
    try {
      const inventoryCollection = collection(db, 'inventory');
      await addDoc(inventoryCollection, inventoryForm);
      toast.success('Item added successfully');
      setIsAddingItem(false);
    } catch (error) {
      toast.error('Failed to add item');
    }
  };

  const handleUpdateItem = async (id) => {
    try {
      const itemDoc = doc(db, 'inventory', id);
      await updateDoc(itemDoc, inventoryForm);
      toast.success('Item updated successfully');
      setEditingItem(null);
    } catch (error) {
      toast.error('Failed to update item');
    }
  };

  const handleDeleteItem = async (id) => {
    try {
      const itemDoc = doc(db, 'inventory', id);
      await deleteDoc(itemDoc);
      toast.success('Item deleted successfully');
    } catch (error) {
      toast.error('Failed to delete item');
    }
  };

  return (
    <SectionLayout 
      id={id}
      title="Inventory Management"
      onAdd={() => setIsAddingItem(true)}
      addButtonText="Add Item"
      user={user}
    >
      {/* Inventory list */}
      <div className={styles.inventoryList}>
        {inventory.map(item => (
          <div key={item.id} className={styles.inventoryItem}>
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <p>Quantity: {item.quantity}</p>
            <p>Status: {item.status}</p>
            <button onClick={() => setEditingItem(item)}>Edit</button>
            <button onClick={() => handleDeleteItem(item.id)}>Delete</button>
          </div>
        ))}
      </div>

      {/* Inventory form modal */}
      {isAddingItem && (
        <div className={styles.modal}>
          <h2>Add Item</h2>
          <form onSubmit={handleAddItem}>
            <input 
              type="text" 
              placeholder="Name" 
              value={inventoryForm.name} 
              onChange={(e) => setInventoryForm({ ...inventoryForm, name: e.target.value })} 
            />
            <textarea 
              placeholder="Description" 
              value={inventoryForm.description} 
              onChange={(e) => setInventoryForm({ ...inventoryForm, description: e.target.value })} 
            />
            <input 
              type="number" 
              placeholder="Quantity" 
              value={inventoryForm.quantity} 
              onChange={(e) => setInventoryForm({ ...inventoryForm, quantity: e.target.value })} 
            />
            <button type="submit">Add</button>
            <button onClick={() => setIsAddingItem(false)}>Cancel</button>
          </form>
        </div>
      )}

      {editingItem && (
        <div className={styles.modal}>
          <h2>Edit Item</h2>
          <form onSubmit={() => handleUpdateItem(editingItem.id)}>
            <input 
              type="text" 
              placeholder="Name" 
              value={inventoryForm.name} 
              onChange={(e) => setInventoryForm({ ...inventoryForm, name: e.target.value })} 
            />
            <textarea 
              placeholder="Description" 
              value={inventoryForm.description} 
              onChange={(e) => setInventoryForm({ ...inventoryForm, description: e.target.value })} 
            />
            <input 
              type="number" 
              placeholder="Quantity" 
              value={inventoryForm.quantity} 
              onChange={(e) => setInventoryForm({ ...inventoryForm, quantity: e.target.value })} 
            />
            <button type="submit">Update</button>
            <button onClick={() => setEditingItem(null)}>Cancel</button>
          </form>
        </div>
      )}
    </SectionLayout>
  );
};

export default Inventory;
