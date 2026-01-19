import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import SectionLayout from '../../components/church/SectionLayout';
import commonStyles from '../../pages/commonStyles';
import { toast } from 'react-toastify';

const Rooms = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState({ 
    name: '', 
    capacity: '', 
    description: '', 
    rentalCostHour: ''
  });
  const [roomSearchTerm, setRoomSearchTerm] = useState('');

  const calculateDailyRate = (hourlyRate) => {
    const hoursPerDay = 8;
    const hourly = parseFloat(hourlyRate) || 0;
    return (hourly * hoursPerDay).toFixed(2);
  };

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        setLoading(true);
        const roomsRef = collection(db, `churches/${id}/rooms`);
        const q = query(roomsRef, orderBy('name'));
        const snapshot = await getDocs(q);
        const roomsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setRooms(roomsData);
      } catch (err) {
        console.error('Error fetching rooms:', err);
        toast.error('Failed to load rooms');
      } finally {
        setLoading(false);
      }
    };

    fetchRooms();
  }, [id]);

  const handleAddRoom = async (e) => {
    e.preventDefault();
    if (!roomForm.name.trim()) {
      toast.error('Room name is required');
      return;
    }
    
    try {
      const roomsRef = collection(db, `churches/${id}/rooms`);
      await addDoc(roomsRef, {
        ...roomForm,
        capacity: parseInt(roomForm.capacity) || 0,
        rentalCostHour: parseFloat(roomForm.rentalCostHour) || 0,
        rentalCostDay: calculateDailyRate(roomForm.rentalCostHour),
        createdAt: new Date()
      });
      
      const q = query(roomsRef, orderBy('name'));
      const snapshot = await getDocs(q);
      const roomsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRooms(roomsData);
      
      setRoomForm({ name: '', capacity: '', description: '', rentalCostHour: '' });
      setIsAddingRoom(false);
      toast.success('Room added successfully!');
    } catch (err) {
      console.error('Error adding room:', err);
      toast.error('Failed to add room');
    }
  };

  const handleEditRoom = async (roomId) => {
    try {
      const roomRef = doc(db, `churches/${id}/rooms`, roomId);
      await updateDoc(roomRef, {
        ...roomForm,
        capacity: parseInt(roomForm.capacity) || 0,
        rentalCostHour: parseFloat(roomForm.rentalCostHour) || 0,
        rentalCostDay: calculateDailyRate(roomForm.rentalCostHour),
        updatedAt: new Date()
      });

      const updatedRooms = rooms.map(room => 
        room.id === roomId ? { ...room, ...roomForm } : room
      );
      setRooms(updatedRooms);
      
      setRoomForm({ name: '', capacity: '', description: '', rentalCostHour: '' });
      setEditingRoom(null);
      toast.success('Room updated successfully!');
    } catch (err) {
      console.error('Error updating room:', err);
      toast.error('Failed to update room');
    }
  };

  const handleDeleteRoom = async (roomId) => {
    if (!window.confirm('Are you sure you want to delete this room?')) return;

    try {
      await deleteDoc(doc(db, `churches/${id}/rooms`, roomId));
      setRooms(rooms.filter(room => room.id !== roomId));
      toast.success('Room deleted successfully!');
    } catch (err) {
      console.error('Error deleting room:', err);
      toast.error('Failed to delete room');
    }
  };

  const filteredRooms = rooms.filter(room => 
    room.name.toLowerCase().includes(roomSearchTerm.toLowerCase()) ||
    room.description?.toLowerCase().includes(roomSearchTerm.toLowerCase())
  );

  return (
    <SectionLayout 
      id={id}
      title="Rooms Management"
      onAdd={() => setIsAddingRoom(true)}
      addButtonText="Add Room"
      user={user}
    >
      {loading ? (
        <div>Loading rooms...</div>
      ) : (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <input
              type="text"
              placeholder="Search rooms..."
              value={roomSearchTerm}
              onChange={(e) => setRoomSearchTerm(e.target.value)}
              style={commonStyles.input}
            />
          </div>

          <div style={{ display: "grid", gap: "1rem" }}>
            {filteredRooms.map(room => (
              <div
                key={room.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <div>
                  <h3 style={{ margin: "0 0 0.5rem 0", fontWeight: "600" }}>{room.name}</h3>
                  <p style={{ margin: "0", color: "#6b7280" }}>
                    Capacity: {room.capacity} | {room.description}
                    <br />
                    Rental Cost: ${room.rentalCostHour}/hr | ${room.rentalCostDay}/day
                  </p>
                </div>
                {(user.role === "global_admin" || (user.role === "admin" && user.churchId === id)) && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => {
                        setEditingRoom(room);
                        setRoomForm({
                          name: room.name,
                          capacity: room.capacity,
                          description: room.description,
                          rentalCostHour: room.rentalCostHour
                        });
                      }}
                      style={commonStyles.orangeButton}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteRoom(room.id)}
                      style={commonStyles.redButton}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Room Form Modal */}
      {(isAddingRoom || editingRoom) && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{editingRoom ? 'Edit Room' : 'Add New Room'}</h2>
            <form onSubmit={editingRoom ? () => handleEditRoom(editingRoom.id) : handleAddRoom}>
              <input
                type="text"
                placeholder="Room Name"
                value={roomForm.name}
                onChange={e => setRoomForm(prev => ({ ...prev, name: e.target.value }))}
                required
                style={commonStyles.input}
              />
              <input
                type="number"
                placeholder="Capacity"
                value={roomForm.capacity}
                onChange={e => setRoomForm(prev => ({ ...prev, capacity: e.target.value }))}
                required
                style={commonStyles.input}
              />
              <textarea
                placeholder="Description"
                value={roomForm.description}
                onChange={e => setRoomForm(prev => ({ ...prev, description: e.target.value }))}
                style={commonStyles.textarea}
              />
              <div style={{ marginBottom: "1rem" }}>
                <input
                  type="number"
                  placeholder="Hourly Rate ($)"
                  value={roomForm.rentalCostHour}
                  onChange={e => {
                    const value = Math.max(0, parseFloat(e.target.value)) || '';
                    setRoomForm(prev => ({ ...prev, rentalCostHour: value }));
                  }}
                  min="0"
                  step="0.01"
                  style={commonStyles.input}
                />
                {roomForm.rentalCostHour && (
                  <p style={{ marginTop: "0.5rem", color: "#6B7280", fontSize: "0.875rem" }}>
                    Daily Rate (8 hrs): ${calculateDailyRate(roomForm.rentalCostHour)}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingRoom(false);
                    setEditingRoom(null);
                    setRoomForm({ name: '', capacity: '', description: '', rentalCostHour: '' });
                  }}
                  style={commonStyles.redButton}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={commonStyles.greenButton}
                >
                  {editingRoom ? 'Update' : 'Add'} Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </SectionLayout>
  );
};

export default Rooms;
