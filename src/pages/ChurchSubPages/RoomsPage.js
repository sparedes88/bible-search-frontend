import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import commonStyles from '../../pages/commonStyles';
import { jsPDF } from 'jspdf';
import { FaFilePdf } from 'react-icons/fa';

const RoomsPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState({
    name: '',
    description: '',
    capacity: 1,
    rentalCostHour: 0,
    rentalCostDay: '0.00',
    createdAt: new Date()
  });

  const styles = {
    button: {
      padding: "0.75rem 1.5rem",
      borderRadius: "0.5rem",
      border: "none",
      color: "white",
      cursor: "pointer",
      fontSize: "0.875rem",
      fontWeight: "600",
      transition: "all 0.2s ease",
      backgroundColor: "#4F46E5",
    },
    formControl: {
      ...commonStyles.input,
      width: "100%",
      marginBottom: "1rem"
    },
    roomCard: {
      border: "1px solid #e5e7eb",
      borderRadius: "0.5rem",
      padding: "1rem",
      marginBottom: "1rem",
      backgroundColor: "white"
    },
    actionBar: {
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: "1rem"
    },
    modal: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000
    },
    modalContent: {
      backgroundColor: "white",
      padding: "2rem",
      borderRadius: "0.5rem",
      width: "90%",
      maxWidth: "600px"
    }
  };

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const roomsRef = collection(db, 'churches', id, 'rooms');
        const q = query(roomsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const roomsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setRooms(roomsData);
      } catch (err) {
        console.error('Error fetching rooms:', err);
        toast.error('Failed to load rooms');
      }
    };

    fetchRooms();
  }, [id]);

  const handleAddRoom = async (e) => {
    e.preventDefault();
    if (!roomForm.name) {
      toast.error('Room name is required');
      return;
    }

    try {
      const roomsRef = collection(db, 'churches', id, 'rooms');
      await addDoc(roomsRef, {
        ...roomForm,
        createdAt: new Date()
      });

      const q = query(roomsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      setRooms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      
      setRoomForm({
        name: '',
        description: '',
        capacity: 1,
        rentalCostHour: 0,
        rentalCostDay: '0.00',
        createdAt: new Date()
      });
      setIsAddingRoom(false);
      toast.success('Room added successfully!');
    } catch (err) {
      console.error('Error adding room:', err);
      toast.error('Failed to add room');
    }
  };

  const handleUpdateRoom = async (roomId) => {
    try {
      const roomRef = doc(db, 'churches', id, 'rooms', roomId);
      await updateDoc(roomRef, roomForm);

      const roomsRef = collection(db, 'churches', id, 'rooms');
      const q = query(roomsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      setRooms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      setEditingRoom(null);
      setRoomForm({
        name: '',
        description: '',
        capacity: 1,
        rentalCostHour: 0,
        rentalCostDay: '0.00',
        createdAt: new Date()
      });
      toast.success('Room updated successfully!');
    } catch (err) {
      console.error('Error updating room:', err);
      toast.error('Failed to update room');
    }
  };

  const handleDeleteRoom = async (roomId) => {
    if (!window.confirm('Are you sure you want to delete this room?')) return;

    try {
      const roomRef = doc(db, 'churches', id, 'rooms', roomId);
      await deleteDoc(roomRef);
      setRooms(rooms.filter(room => room.id !== roomId));
      toast.success('Room deleted successfully!');
    } catch (err) {
      console.error('Error deleting room:', err);
      toast.error('Failed to delete room');
    }
  };

  const exportToPDF = async () => {
    try {
      const toastId = toast.loading('Preparing PDF...', { autoClose: false });
      const doc = new jsPDF();
      
      // Add title and header with branded color
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      doc.setTextColor(255);
      doc.setFontSize(24);
      doc.text('Rooms Management Report', 15, 25);
      
      // Header info
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);
      doc.text(`Total Rooms: ${rooms.length}`, doc.internal.pageSize.width - 60, 35);
      
      let yOffset = 50;

      // Process each room
      for (const room of rooms) {
        // Check if we need a new page
        if (yOffset > doc.internal.pageSize.height - 60) {
          doc.addPage();
          yOffset = 20;
        }

        // Room header
        doc.setFillColor(243, 244, 246);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 40, 'F');
        
        // Room name
        doc.setFontSize(16);
        doc.setTextColor(31, 41, 55);
        doc.text(room.name, 20, yOffset + 15);

        // Room stats
        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        const stats = [
          `Capacity: ${room.capacity || 0} people`,
          `Hourly Rate: $${room.rentalCostHour || 0}`,
          `Daily Rate: $${room.rentalCostDay || '0.00'}`
        ];
        doc.text(stats.join(' | '), 20, yOffset + 30);

        yOffset += 50;

        // Room description
        if (room.description) {
          const descriptionLines = doc.splitTextToSize(room.description, doc.internal.pageSize.width - 45);
          doc.setTextColor(75, 85, 99);
          doc.text(descriptionLines, 20, yOffset);
          yOffset += (descriptionLines.length * 7) + 20;
        }
      }

      // Add page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }

      // Save the PDF
      doc.save('rooms-management-report.pdf');
      
      toast.update(toastId, {
        render: 'PDF generated successfully!',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const renderRoomForm = () => (
    <div style={styles.modal}>
      <div style={styles.modalContent}>
        <h3>{editingRoom ? 'Edit Room' : 'Add New Room'}</h3>
        <form onSubmit={editingRoom ? () => handleUpdateRoom(editingRoom.id) : handleAddRoom}>
          <input
            type="text"
            placeholder="Room Name"
            value={roomForm.name}
            onChange={e => setRoomForm(prev => ({ ...prev, name: e.target.value }))}
            style={styles.formControl}
            required
          />
          <textarea
            placeholder="Description"
            value={roomForm.description}
            onChange={e => setRoomForm(prev => ({ ...prev, description: e.target.value }))}
            style={{ ...styles.formControl, minHeight: "100px" }}
          />
          <input
            type="number"
            placeholder="Capacity"
            value={roomForm.capacity}
            onChange={e => setRoomForm(prev => ({ ...prev, capacity: parseInt(e.target.value) || 1 }))}
            style={styles.formControl}
          />
          <input
            type="number"
            placeholder="Hourly Rental Cost"
            value={roomForm.rentalCostHour}
            onChange={e => setRoomForm(prev => ({ ...prev, rentalCostHour: parseFloat(e.target.value) || 0 }))}
            style={styles.formControl}
          />
          <input
            type="text"
            placeholder="Daily Rental Cost"
            value={roomForm.rentalCostDay}
            onChange={e => setRoomForm(prev => ({ ...prev, rentalCostDay: e.target.value }))}
            style={styles.formControl}
          />
          <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setEditingRoom(null);
                setIsAddingRoom(false);
              }}
              style={{ ...styles.button, backgroundColor: "#EF4444" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...styles.button, backgroundColor: "#10B981" }}
            >
              {editingRoom ? 'Update' : 'Add'} Room
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div style={commonStyles.container}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <h2 style={commonStyles.title}>Rooms Management</h2>
      
      <div style={styles.actionBar}>
        <button 
          onClick={exportToPDF}
          style={{ ...styles.button, backgroundColor: "#2563eb", marginRight: "1rem" }}
        >
          <FaFilePdf style={{ marginRight: "0.5rem" }} /> Export to PDF
        </button>
        <button 
          onClick={() => setIsAddingRoom(true)}
          style={{ ...styles.button, backgroundColor: "#10B981" }}
        >
          + Add New Room
        </button>
      </div>

      {rooms.map(room => (
        <div key={room.id} style={styles.roomCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>{room.name}</h3>
              <p style={{ margin: "0", color: "#6B7280" }}>
                Capacity: {room.capacity} | Hourly Rate: ${room.rentalCostHour} | Daily Rate: ${room.rentalCostDay}
                {room.description && <br />}
                {room.description}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => {
                  setEditingRoom(room);
                  setRoomForm(room);
                }}
                style={{ ...styles.button, backgroundColor: "#F59E0B" }}
              >
                Edit
              </button>
              <button
                onClick={() => handleDeleteRoom(room.id)}
                style={{ ...styles.button, backgroundColor: "#EF4444" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}

      {(isAddingRoom || editingRoom) && renderRoomForm()}
    </div>
  );
};

export default RoomsPage;
