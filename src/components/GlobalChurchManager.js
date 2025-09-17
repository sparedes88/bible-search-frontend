import React, { useEffect, useState } from "react";
import ChurchHeader from "./ChurchHeader";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
} from "firebase/firestore";
import "./GlobalChurchManager.css";

const GlobalChurchManager = () => {
  const [churches, setChurches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [adding, setAdding] = useState(false);
  const [newChurch, setNewChurch] = useState({
    nombre: "",
    address: "",
    logo: "",
    status: "active",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState("nombre");
  const [sortDirection, setSortDirection] = useState("asc");
  const churchesPerPage = 10;
  const totalPages = Math.ceil(churches.length / churchesPerPage);

  useEffect(() => {
    const fetchChurches = async () => {
      setLoading(true);
      const snapshot = await getDocs(collection(db, "churches"));
      const churchesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Set isActive to true in Firebase if missing
      for (const church of churchesData) {
        if (typeof church.isActive === 'undefined') {
          await updateDoc(doc(db, "churches", church.id), { isActive: true });
          church.isActive = true;
        }
      }
      setChurches(churchesData);
      setLoading(false);
    };
    fetchChurches();
  }, []);

  const handleEdit = (id, field, value) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  };

  const saveEdit = async (id) => {
    await updateDoc(doc(db, "churches", id), editData);
    setEditingId(null);
    setEditData({});
    // Refresh
    const snapshot = await getDocs(collection(db, "churches"));
    setChurches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const toggleStatus = async (id, currentStatus, isActive) => {
    const newIsActive = isActive === false ? true : false;
    await updateDoc(doc(db, "churches", id), { isActive: newIsActive });
    // Refresh
    const snapshot = await getDocs(collection(db, "churches"));
    setChurches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const handleAddChurch = async () => {
    await addDoc(collection(db, "churches"), newChurch);
    setAdding(false);
    setNewChurch({ nombre: "", address: "", logo: "", status: "active" });
    // Refresh
    const snapshot = await getDocs(collection(db, "churches"));
    setChurches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const filteredChurches = churches.filter(church => {
    if (!searchTerm) return true;
    return Object.values(church).some(val =>
      typeof val === "string" && val.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const sortedChurches = [...filteredChurches].sort((a, b) => {
    const aVal = a[sortColumn] ?? "";
    const bVal = b[sortColumn] ?? "";
    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const paginatedChurches = sortedChurches.slice((currentPage - 1) * churchesPerPage, currentPage * churchesPerPage);

  return (
    <div>
      <ChurchHeader />
      <div className="global-church-manager">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2>Global Church Management</h2>
          <button 
            onClick={() => window.location.href = '/sql-server-bridge'}
            style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "0.75rem 1.5rem", fontWeight: 500, cursor: "pointer" }}
            title="Access SQL Server Database Bridge"
          >
            🗄️ Database Bridge
          </button>
        </div>
        <input
          type="text"
          placeholder="Search churches..."
          value={searchTerm}
          onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          style={{ marginBottom: '1.5rem', padding: '0.75rem', width: '100%', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '1rem' }}
        />
        {loading ? <div>Loading...</div> : (
          <>
          <div style={{marginBottom: '2rem'}}>
            <table className="church-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('id')} style={{cursor:'pointer'}}>ID {sortColumn==='id' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('nombre')} style={{cursor:'pointer'}}>Name {sortColumn==='nombre' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('address')} style={{cursor:'pointer'}}>Address {sortColumn==='address' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('logo')} style={{cursor:'pointer'}}>Logo {sortColumn==='logo' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th onClick={() => handleSort('isActive')} style={{cursor:'pointer'}}>Status {sortColumn==='isActive' ? (sortDirection==='asc'?'▲':'▼') : ''}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedChurches.map(church => (
                  <tr key={church.id} className={church.isActive === false ? 'inactive-row' : ''}>
                    <td>{church.id}</td>
                    <td>{editingId === church.id ? (
                      <input value={editData.nombre ?? church.nombre} onChange={e => handleEdit(church.id, "nombre", e.target.value)} />
                    ) : church.nombre}</td>
                    <td>{editingId === church.id ? (
                      <input value={editData.address ?? church.address} onChange={e => handleEdit(church.id, "address", e.target.value)} />
                    ) : church.address}</td>
                    <td>
                      {church.logo ? (
                        <img src={church.logo} alt="logo" style={{ width: 40, height: 40, objectFit: "contain" }} title={church.logo} onError={e => { console.warn('Logo failed to load:', church.logo); e.target.onerror=null; e.target.src='https://ui-avatars.com/api/?name='+encodeURIComponent(church.nombre||'Church')+'&background=eee&color=888&size=40'; }} />
                      ) : (
                        <img src={'https://ui-avatars.com/api/?name='+encodeURIComponent(church.nombre||'Church')+'&background=eee&color=888&size=40'} alt="logo" style={{ width: 40, height: 40, objectFit: "contain" }} title="No logo URL" />
                      )}
                    </td>
                    <td>
                    {typeof church.isActive === 'undefined' ? (
                      <span style={{ color: 'red', fontWeight: 'bold' }}>active (missing isActive)</span>
                    ) : (
                      church.isActive === false ? 'inactive' : 'active'
                    )}
                    </td>
                    <td>
                      {editingId === church.id ? (
                        <button onClick={() => saveEdit(church.id)}>Save</button>
                      ) : (
                        <button onClick={() => { setEditingId(church.id); setEditData(church); }}>Edit</button>
                      )}
                      <button onClick={() => toggleStatus(church.id, church.status, church.isActive)}>
                        {church.isActive === false ? "Activate" : "Deactivate"}
                      </button>
                      <button onClick={() => window.location.href = `/church-profile/${church.id}`}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-controls">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</button>
            <span>Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</button>
          </div>
          </>
        )}
        {adding ? (
          <div className="add-church-form">
            <h3>Add New Church</h3>
            <input placeholder="Name" value={newChurch.nombre} onChange={e => setNewChurch({ ...newChurch, nombre: e.target.value })} />
            <input placeholder="Address" value={newChurch.address} onChange={e => setNewChurch({ ...newChurch, address: e.target.value })} />
            <input placeholder="Logo URL" value={newChurch.logo} onChange={e => setNewChurch({ ...newChurch, logo: e.target.value })} />
            <button onClick={handleAddChurch}>Add</button>
            <button onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}>+ Add Church</button>
        )}
      </div>
    </div>
  );
};

export default GlobalChurchManager;
