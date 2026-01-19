import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, collection, addDoc, getDocs, updateDoc, deleteDoc } from "firebase/firestore";
import ChurchHeader from "./ChurchHeader";
import { useAuth } from "../contexts/AuthContext";
import { getFirestore, onSnapshot } from "firebase/firestore";
import { app } from "../firebase";
import FreshBooksInvoices from "./FreshBooksInvoices";
import FreshBooksConnect from "./FreshBooksConnect";

const ChurchProfile = () => {
  const { id } = useParams();
  const { user, isGlobalAdmin } = useAuth();
  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingFields, setEditingFields] = useState({});
  const [editValues, setEditValues] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState("");
  const [noteTagInputs, setNoteTagInputs] = useState({});
  const [notesPage, setNotesPage] = useState(1);
  const notesPerPage = 10;
  const [users, setUsers] = useState([]);

  // Define all possible church fields
  const allChurchFields = [
    // Basic Information
    'nombre', 'name', 'description', 'mission', 'vision', 'about',
    // Contact Information
    'address', 'phone', 'email', 'website', 'facebook', 'twitter', 'instagram', 'youtube',
    // Location Details
    'street', 'city', 'state', 'zipCode', 'country', 'location', 'coordinates',
    // Media & Images
    'logo', 'headerImage', 'banner', 'gallery', 'photos',
    // Status & Activity
    'isActive', 'active', 'status', 'type', 'denomination',
    // Organization Details
    'founded', 'pastor', 'leadership', 'staff', 'volunteers', 'capacity',
    // Services & Programs
    'services', 'programs', 'ministries', 'events', 'groups',
    // Metadata
    'createdAt', 'updatedAt', 'version', 'tags', 'notes'
  ];

  useEffect(() => {
    const fetchChurch = async () => {
      setLoading(true);
      const docRef = doc(db, "churches", id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const churchData = { id, ...docSnap.data() };
        setChurch(churchData);
        // Initialize editValues with all possible fields
        const initialValues = {};
        allChurchFields.forEach(field => {
          initialValues[field] = churchData[field] || '';
        });
        setEditValues(initialValues);
        setTags(churchData.tags || []);
      } else {
        setChurch(null);
      }
      setLoading(false);
    };
    fetchChurch();
  }, [id]);

  useEffect(() => {
    const fetchNotes = async () => {
      if (!id) return;
      const notesSnap = await getDocs(collection(db, "churches", id, "notes"));
      setNotes(notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchNotes();
  }, [id]);

  useEffect(() => {
    const usersRef = collection(db, "users");
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  const addNote = async () => {
    if (!noteText.trim()) return;
    await addDoc(collection(db, "churches", id, "notes"), { text: noteText, created: Date.now(), author: user?.uid });
    setNoteText("");
    const notesSnap = await getDocs(collection(db, "churches", id, "notes"));
    setNotes(notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };
  const updateNote = async (noteId) => {
    await updateDoc(doc(db, "churches", id, "notes", noteId), { text: editingNoteText });
    setEditingNoteId(null);
    setEditingNoteText("");
    const notesSnap = await getDocs(collection(db, "churches", id, "notes"));
    setNotes(notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };
  const deleteNote = async (noteId) => {
    await deleteDoc(doc(db, "churches", id, "notes", noteId));
    const notesSnap = await getDocs(collection(db, "churches", id, "notes"));
    setNotes(notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };
  const addTag = async () => {
    if (!newTag.trim()) return;
    const updatedTags = [...tags, newTag.trim()];
    await updateDoc(doc(db, "churches", id), { tags: updatedTags });
    setTags(updatedTags);
    setNewTag("");
  };
  const deleteTag = async (tag) => {
    const updatedTags = tags.filter(t => t !== tag);
    await updateDoc(doc(db, "churches", id), { tags: updatedTags });
    setTags(updatedTags);
  };
  const addNoteTag = async (noteId, tag) => {
    if (!tag.trim()) return;
    const noteRef = doc(db, "churches", id, "notes", noteId);
    const noteSnap = await getDoc(noteRef);
    if (!noteSnap.exists()) return;
    const noteData = noteSnap.data();
    const updatedTags = [...(noteData.tags || []), tag.trim()];
    await updateDoc(noteRef, { tags: updatedTags });
    const notesSnap = await getDocs(collection(db, "churches", id, "notes"));
    setNotes(notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };
  const deleteNoteTag = async (noteId, tag) => {
    const noteRef = doc(db, "churches", id, "notes", noteId);
    const noteSnap = await getDoc(noteRef);
    if (!noteSnap.exists()) return;
    const noteData = noteSnap.data();
    const updatedTags = (noteData.tags || []).filter(t => t !== tag);
    await updateDoc(noteRef, { tags: updatedTags });
    const notesSnap = await getDocs(collection(db, "churches", id, "notes"));
    setNotes(notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  // Get all fields that exist in the church document or should be available
  const getAllFields = () => {
    const existingFields = Object.keys(church || {});
    // Combine all predefined fields with any additional fields from the document
    const allFields = new Set([...allChurchFields, ...existingFields]);
    return Array.from(allFields);
  };

  const startEditing = () => {
    setIsEditing(true);
    // Initialize editValues with all possible fields, using existing values or empty strings
    const initialValues = {};
    allChurchFields.forEach(field => {
      initialValues[field] = church[field] || '';
    });
    setEditValues(initialValues);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValues({ ...church });
  };

  const saveChurchFields = async () => {
    try {
      // Remove the id field and filter out empty values
      const { id: churchId, ...rawUpdateData } = editValues;
      
      // Only include fields that have actual values (not empty strings or null/undefined)
      const updateData = {};
      Object.entries(rawUpdateData).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) {
          updateData[key] = value;
        }
      });
      
      await updateDoc(doc(db, "churches", id), updateData);
      
      // Update local state with the filtered data
      const updatedChurch = { ...church, ...updateData };
      setChurch(updatedChurch);
      setIsEditing(false);
      
      // Refresh tags if they were updated
      if (updateData.tags) {
        setTags(updateData.tags);
      }
      
      alert("Church profile updated successfully!");
    } catch (error) {
      console.error("Error updating church:", error);
      alert("Error updating church profile. Please try again.");
    }
  };

  // Render field input based on field type
  const renderFieldInput = (field, value) => {
    // Handle boolean fields
    if (typeof value === 'boolean' || field === 'isActive') {
      return (
        <select 
          value={editValues[field] ? 'true' : 'false'} 
          onChange={e => handleFieldEdit(field, e.target.value === 'true')}
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }
    
    // Handle date/timestamp fields
    if (field.toLowerCase().includes('date') || field.toLowerCase().includes('time') || field === 'createdAt' || field === 'updatedAt') {
      return (
        <input
          type="text"
          value={editValues[field] || ''}
          onChange={e => handleFieldEdit(field, e.target.value)}
          placeholder="Enter date/time..."
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
        />
      );
    }
    
    // Handle URL fields (including social media)
    if (field.toLowerCase().includes('url') || field.toLowerCase().includes('link') || 
        field === 'logo' || field === 'banner' || field === 'headerImage' ||
        field.toLowerCase().includes('facebook') || field.toLowerCase().includes('twitter') || 
        field.toLowerCase().includes('instagram') || field.toLowerCase().includes('youtube') ||
        field === 'website') {
      return (
        <input
          type="url"
          value={editValues[field] || ''}
          onChange={e => handleFieldEdit(field, e.target.value)}
          placeholder="Enter URL..."
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
        />
      );
    }
    
    // Handle email fields
    if (field.toLowerCase().includes('email')) {
      return (
        <input
          type="email"
          value={editValues[field] || ''}
          onChange={e => handleFieldEdit(field, e.target.value)}
          placeholder="Enter email..."
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
        />
      );
    }
    
    // Handle phone fields
    if (field.toLowerCase().includes('phone') || field.toLowerCase().includes('mobile') || field.toLowerCase().includes('tel')) {
      return (
        <input
          type="tel"
          value={editValues[field] || ''}
          onChange={e => handleFieldEdit(field, e.target.value)}
          placeholder="Enter phone number..."
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
        />
      );
    }
    
    // Handle array fields (services, programs, ministries, etc.)
    if (Array.isArray(value) || field.toLowerCase().includes('services') || 
        field.toLowerCase().includes('programs') || field.toLowerCase().includes('ministries') ||
        field.toLowerCase().includes('events') || field.toLowerCase().includes('groups') ||
        field.toLowerCase().includes('staff') || field.toLowerCase().includes('leadership')) {
      const arrayValue = Array.isArray(editValues[field]) 
        ? editValues[field].join(', ') 
        : (editValues[field] || '');
      return (
        <textarea
          value={arrayValue}
          onChange={e => {
            const textValue = e.target.value;
            // Convert comma-separated string back to array
            const arrayResult = textValue ? textValue.split(',').map(item => item.trim()).filter(item => item) : [];
            handleFieldEdit(field, arrayResult.length > 0 ? arrayResult : textValue || '');
          }}
          placeholder={`Enter ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} (comma-separated)...`}
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd', minHeight: '60px' }}
        />
      );
    }
    
    // Default text input
    return (
      <input
        type="text"
        value={editValues[field] || ''}
        onChange={e => handleFieldEdit(field, e.target.value)}
        placeholder={`Enter ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}...`}
        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
      />
    );
  };

  // Format field name for display
  const formatFieldName = (field) => {
    return field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1');
  };

  // Helper to get user name from ID
  const getUserName = (userId) => {
    if (!users || users.length === 0) return userId;
    const user = users.find(u => u.id === userId);
    return user ? user.name || user.displayName || user.email || user.id : userId;
  };

  // Sort notes by newest first
  const sortedNotes = [...notes].sort((a, b) => b.created - a.created);
  const paginatedNotes = sortedNotes.slice((notesPage - 1) * notesPerPage, notesPage * notesPerPage);

  if (loading) return <div>Loading...</div>;
  if (!church) return <div>Church not found.</div>;

  return (
    <div>
      <ChurchHeader />
      <div style={{ maxWidth: 800, margin: "2rem auto", background: "#fff", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", padding: "2rem" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: "1.5rem" }}>
          <h2>{church.nombre || church.name || "Organization Profile"}</h2>
          {isGlobalAdmin() && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!isEditing ? (
                <>
                  <button 
                    onClick={startEditing}
                    style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "0.5rem 1rem", fontWeight: 500, cursor: "pointer" }}
                  >
                    Edit Profile
                  </button>
                  <button 
                    onClick={() => window.location.href = '/sql-server-bridge'}
                    style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "0.5rem 1rem", fontWeight: 500, cursor: "pointer" }}
                    title="Access SQL Server Database Bridge"
                  >
                    🗄️ Database Bridge
                  </button>
                </>
              ) : (
                <div>
                  <button 
                    onClick={saveChurchFields}
                    style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 6, padding: "0.5rem 1rem", fontWeight: 500, cursor: "pointer", marginRight: "0.5rem" }}
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={cancelEditing}
                    style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "0.5rem 1rem", fontWeight: 500, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {church.logo && (
          <div style={{ textAlign: 'center', marginBottom: "1.5rem" }}>
            <img src={church.logo} alt="logo" style={{ width: 100, height: 100, objectFit: "contain", borderRadius: 8, border: "2px solid #e5e7eb" }} />
          </div>
        )}
        
        <div style={{ marginBottom: "2rem" }}>
          <h3 style={{ marginBottom: "1rem", color: "#374151" }}>Organization Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
            {getAllFields().map((key) => {
              const value = church[key];
              return (
                key !== "id" && (
                  <div key={key} style={{ 
                    background: "#f9fafb", 
                    borderRadius: "8px", 
                    padding: "1rem", 
                    border: "1px solid #e5e7eb",
                    opacity: isEditing ? 1 : 0.9
                  }}>
                    <label style={{ 
                      fontWeight: 600, 
                      color: "#374151", 
                      display: "block", 
                      marginBottom: "0.5rem",
                      fontSize: "0.9rem"
                    }}>
                      {formatFieldName(key)}
                    </label>
                    {isEditing ? (
                      renderFieldInput(key, value)
                    ) : (
                      <div style={{ 
                        color: value ? "#111827" : "#9ca3af",
                        fontStyle: value ? "normal" : "italic",
                        minHeight: "2.5rem",
                        display: "flex",
                        alignItems: "center"
                      }}>
                        {value ? (
                          Array.isArray(value) ? 
                            value.join(', ') : 
                            String(value)
                        ) : "Not set - Click Edit to add"}
                      </div>
                    )}
                  </div>
                )
              );
            })}
          </div>
        </div>
        {/* Tags Section - Only show if not in edit mode */}
        {!isEditing && isGlobalAdmin() && (
          <div style={{ marginTop: "2rem" }}>
            <h3>Tags</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {tags.map(tag => (
                <span key={tag} style={{ background: "#e0e7ff", color: "#3730a3", borderRadius: "6px", padding: "0.3rem 0.7rem", fontWeight: 500 }}>
                  {tag} <button style={{ marginLeft: 4, background: "none", border: "none", color: "#888", cursor: "pointer" }} onClick={() => deleteTag(tag)}>×</button>
                </span>
              ))}
              <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Add tag..." style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.3rem 0.7rem" }} />
              <button onClick={addTag} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "0.3rem 0.7rem", fontWeight: 500 }}>Add</button>
            </div>
          </div>
        )}
        {/* Notes Section - Only show if not in edit mode */}
        {!isEditing && isGlobalAdmin() && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h3>Admin Notes</h3>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note..." style={{ width: "100%", borderRadius: 6, border: "1px solid #e5e7eb", padding: "0.5rem", marginTop: "0.5rem" }} />
            <button onClick={addNote} style={{ marginTop: 8, background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "0.3rem 0.7rem", fontWeight: 500 }}>Add Note</button>
            <div style={{ marginTop: "1.5rem" }}>
              {paginatedNotes.map(note => (
                <div key={note.id} style={{ background: "#f3f4f6", borderRadius: 8, padding: "0.7rem", marginBottom: "0.5rem", position: "relative" }}>
                  {/* Note tags UI only in edit mode */}
                  {editingNoteId === note.id && (
                    <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(note.tags || []).map(tag => (
                        <span key={tag} style={{ background: "#fde68a", color: "#92400e", borderRadius: "6px", padding: "0.2rem 0.6rem", fontWeight: 500 }}>
                          {tag} <button style={{ marginLeft: 4, background: "none", border: "none", color: "#888", cursor: "pointer" }} onClick={() => deleteNoteTag(note.id, tag)}>×</button>
                        </span>
                      ))}
                      <input
                        value={noteTagInputs[note.id] || ""}
                        onChange={e => setNoteTagInputs(inputs => ({ ...inputs, [note.id]: e.target.value }))}
                        placeholder="Add tag..."
                        style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.2rem 0.6rem" }}
                      />
                      <button onClick={() => { addNoteTag(note.id, noteTagInputs[note.id] || ""); setNoteTagInputs(inputs => ({ ...inputs, [note.id]: "" })); }} style={{ background: "#f59e42", color: "#fff", border: "none", borderRadius: 6, padding: "0.2rem 0.6rem", fontWeight: 500 }}>Add</button>
                    </div>
                  )}
                  {editingNoteId === note.id ? (
                    <>
                      <textarea value={editingNoteText} onChange={e => setEditingNoteText(e.target.value)} style={{ width: "100%", borderRadius: 6, border: "1px solid #e5e7eb", padding: "0.5rem" }} />
                      <button onClick={() => updateNote(note.id)} style={{ marginRight: 8 }}>Save</button>
                      <button onClick={() => { setEditingNoteId(null); setEditingNoteText(""); }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <div>{note.text}</div>
                      {/* Show tags in view mode */}
                      {note.tags && note.tags.length > 0 && (
                        <div style={{ margin: '0.3rem 0', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {note.tags.map(tag => (
                            <span key={tag} style={{ background: "#fde68a", color: "#92400e", borderRadius: "6px", padding: "0.2rem 0.6rem", fontWeight: 500 }}>{tag}</span>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: "0.8rem", color: "#888" }}>By {getUserName(note.author)} • {new Date(note.created).toLocaleString()}</div>
                      <button style={{ position: "absolute", top: 8, right: 8 }} onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text); }}>Edit</button>
                      <button style={{ position: "absolute", top: 8, right: 60 }} onClick={() => deleteNote(note.id)}>Delete</button>
                    </>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
                <button onClick={() => setNotesPage(p => Math.max(1, p - 1))} disabled={notesPage === 1}>Previous</button>
                <span>Page {notesPage} of {Math.ceil(sortedNotes.length / notesPerPage)}</span>
                <button onClick={() => setNotesPage(p => Math.min(Math.ceil(sortedNotes.length / notesPerPage), p + 1))} disabled={notesPage === Math.ceil(sortedNotes.length / notesPerPage)}>Next</button>
              </div>
            </div>
          </div>
        )}
        <FreshBooksConnect churchId={id} />
        <FreshBooksInvoices churchId={id} />
      </div>
    </div>
  );
};

export default ChurchProfile;
