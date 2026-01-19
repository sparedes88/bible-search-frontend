import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, where, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { toast } from 'react-toastify';
import { FiTrash2, FiEdit2, FiSave } from 'react-icons/fi';

const MemberNotes = ({ memberId, churchId }) => {
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [currentTag, setCurrentTag] = useState('');
  const [noteTags, setNoteTags] = useState([]);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // Fetch notes
  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const notesRef = collection(db, 'memberNotes');
        const q = query(notesRef, 
          where('memberId', '==', memberId),
          where('churchId', '==', churchId)
        );
        const querySnapshot = await getDocs(q);
        const notesData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate?.()?.toLocaleString() || 'N/A'
        }));
        setNotes(notesData);
      } catch (error) {
        console.error('Error fetching notes:', error);
        toast.error('Failed to load notes');
      }
    };

    fetchNotes();
  }, [memberId, churchId]);

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    try {
      const noteData = {
        memberId,
        churchId,
        text: newNote,
        tags: noteTags,
        createdAt: new Date()
      };

      await addDoc(collection(db, 'memberNotes'), noteData);
      setNewNote('');
      setNoteTags([]);
      toast.success('Note added successfully');
      
      // Refresh notes
      const notesRef = collection(db, 'memberNotes');
      const q = query(notesRef, 
        where('memberId', '==', memberId),
        where('churchId', '==', churchId)
      );
      const querySnapshot = await getDocs(q);
      const notesData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toLocaleString() || 'N/A'
      }));
      setNotes(notesData);
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('Failed to add note');
    }
  };

  const handleAddTag = () => {
    if (!currentTag.trim()) return;
    if (!noteTags.includes(currentTag)) {
      setNoteTags([...noteTags, currentTag.trim()]);
    }
    setCurrentTag('');
  };

  const handleRemoveTag = (tagToRemove) => {
    setNoteTags(noteTags.filter(tag => tag !== tagToRemove));
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await deleteDoc(doc(db, 'memberNotes', noteId));
      setNotes(notes.filter(note => note.id !== noteId));
      toast.success('Note deleted successfully');
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error('Failed to delete note');
    }
  };

  const handleEditNote = async (noteId) => {
    if (editingNoteId === noteId) {
      try {
        await updateDoc(doc(db, 'memberNotes', noteId), {
          text: editingText,
          updatedAt: new Date()
        });
        setNotes(notes.map(note => 
          note.id === noteId 
            ? { ...note, text: editingText } 
            : note
        ));
        setEditingNoteId(null);
        setEditingText('');
        toast.success('Note updated successfully');
      } catch (error) {
        console.error('Error updating note:', error);
        toast.error('Failed to update note');
      }
    } else {
      const note = notes.find(n => n.id === noteId);
      setEditingText(note.text);
      setEditingNoteId(noteId);
    }
  };

  return (
    <div className="notes-section">
      <h3>Notes</h3>
      
      <form onSubmit={handleAddNote} className="note-form">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a new note..."
          className="note-input"
        />
        
        <div className="tags-input-container">
          <input
            type="text"
            value={currentTag}
            onChange={(e) => setCurrentTag(e.target.value)}
            placeholder="Add tags..."
            className="tag-input"
          />
          <button type="button" onClick={handleAddTag} className="add-tag-btn">
            Add Tag
          </button>
        </div>

        {noteTags.length > 0 && (
          <div className="tags-container">
            {noteTags.map((tag, index) => (
              <span key={index} className="tag">
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="remove-tag-btn"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <button type="submit" className="submit-note-btn">
          Add Note
        </button>
      </form>

      <div className="notes-list">
        {notes.map((note) => (
          <div key={note.id} className="note-item">
            {editingNoteId === note.id ? (
              <textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="edit-note-input"
              />
            ) : (
              <p className="note-text">{note.text}</p>
            )}
            
            {note.tags?.length > 0 && (
              <div className="note-tags">
                {note.tags.map((tag, index) => (
                  <span key={index} className="tag">{tag}</span>
                ))}
              </div>
            )}
            
            <div className="note-footer">
              <span className="note-date">{note.createdAt}</span>
              <div className="note-actions">
                <button
                  onClick={() => handleEditNote(note.id)}
                  className="edit-note-btn"
                >
                  {editingNoteId === note.id ? <FiSave /> : <FiEdit2 />}
                </button>
                <button
                  onClick={() => handleDeleteNote(note.id)}
                  className="delete-note-btn"
                >
                  <FiTrash2 />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MemberNotes;