import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { toast } from "react-toastify";

const ASSIGNEE_DOC_PATH = [
  "churches",
  // id param
  null,
  "bimProjects",
  "stanford-ff-rad",
  "data-option-values",
  "live-issue-tracker"
];

const ManageAssigneesPage = () => {
  const { id } = useParams();
  const [assignees, setAssignees] = useState([]);
  const [newAssignee, setNewAssignee] = useState("");
  const [loading, setLoading] = useState(true);
  const [editIndex, setEditIndex] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [sortMode, setSortMode] = useState("custom"); // 'custom' or 'az'

  useEffect(() => {
    if (!id) return;
    const docRef = doc(db, ...ASSIGNEE_DOC_PATH.map((p) => (p === null ? id : p)));
    getDoc(docRef)
      .then((snap) => {
        const data = snap.data() || {};
        setAssignees(Array.isArray(data.assignee) ? data.assignee : []);
      })
      .catch(() => toast.error("Failed to load assignees."))
      .finally(() => setLoading(false));
  }, [id]);

  const handleAddAssignee = async (e) => {
    e.preventDefault();
    if (!newAssignee.trim()) return;
    const docRef = doc(db, ...ASSIGNEE_DOC_PATH.map((p) => (p === null ? id : p)));
    const updated = [...assignees, newAssignee.trim()];
    try {
      await updateDoc(docRef, { assignee: updated });
      setAssignees(updated);
      setNewAssignee("");
      toast.success("Assignee added.");
    } catch {
      toast.error("Failed to add assignee.");
    }
  };

  // Sorting logic
  const sortedAssignees = sortMode === "az"
    ? [...assignees].sort((a, b) => a.localeCompare(b))
    : assignees;

  const handleEdit = (idx) => {
    setEditIndex(idx);
    setEditValue(assignees[idx]);
  };

  const handleEditSave = async (idx) => {
    if (!editValue.trim()) return;
    const updated = assignees.map((a, i) => (i === idx ? editValue.trim() : a));
    const docRef = doc(db, ...ASSIGNEE_DOC_PATH.map((p) => (p === null ? id : p)));
    try {
      await updateDoc(docRef, { assignee: updated });
      setAssignees(updated);
      setEditIndex(null);
      setEditValue("");
      toast.success("Assignee updated.");
    } catch {
      toast.error("Failed to update assignee.");
    }
  };

  const handleEditCancel = () => {
    setEditIndex(null);
    setEditValue("");
  };

  const handleMove = async (from, to) => {
    if (to < 0 || to >= assignees.length) return;
    const updated = [...assignees];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    const docRef = doc(db, ...ASSIGNEE_DOC_PATH.map((p) => (p === null ? id : p)));
    try {
      await updateDoc(docRef, { assignee: updated });
      setAssignees(updated);
    } catch {
      toast.error("Failed to reorder assignees.");
    }
  };

  return (
    <div style={{ maxWidth: 500, margin: "40px auto", padding: 24, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px #0001" }}>
      <h2 style={{ fontSize: 22, marginBottom: 16 }}>Manage Assignees</h2>
      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <button
          style={{ padding: "4px 12px", borderRadius: 4, border: sortMode === "custom" ? "2px solid #2563eb" : "1px solid #ccc", background: sortMode === "custom" ? "#e0e7ff" : "#f3f4f6" }}
          onClick={() => setSortMode("custom")}
        >
          Custom Order
        </button>
        <button
          style={{ padding: "4px 12px", borderRadius: 4, border: sortMode === "az" ? "2px solid #2563eb" : "1px solid #ccc", background: sortMode === "az" ? "#e0e7ff" : "#f3f4f6" }}
          onClick={() => setSortMode("az")}
        >
          A-Z Order
        </button>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          <ul style={{ marginBottom: 16, listStyle: "none", padding: 0 }}>
            {sortedAssignees.map((a, i) => (
              <li key={i} style={{ padding: "4px 0", display: "flex", alignItems: "center", gap: 8 }}>
                {editIndex === i ? (
                  <>
                    <input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      style={{ flex: 1, padding: 4, borderRadius: 4, border: "1px solid #ccc" }}
                    />
                    <button onClick={() => handleEditSave(i)} style={{ padding: "4px 8px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4 }}>Save</button>
                    <button onClick={handleEditCancel} style={{ padding: "4px 8px", background: "#f3f4f6", border: "1px solid #ccc", borderRadius: 4 }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1 }}>{a}</span>
                    {sortMode === "custom" && (
                      <>
                        <button onClick={() => handleMove(i, i - 1)} disabled={i === 0} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #ccc", background: "#f3f4f6" }}>↑</button>
                        <button onClick={() => handleMove(i, i + 1)} disabled={i === assignees.length - 1} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #ccc", background: "#f3f4f6" }}>↓</button>
                      </>
                    )}
                    <button onClick={() => handleEdit(i)} style={{ padding: "2px 8px", background: "#e0e7ff", border: "1px solid #2563eb", borderRadius: 4 }}>Edit</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form onSubmit={handleAddAssignee} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              placeholder="Add new assignee"
              style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
            />
            <button type="submit" style={{ padding: "8px 16px", borderRadius: 4, background: "#2563eb", color: "#fff", border: "none" }}>
              Add
            </button>
          </form>
        </>
      )}
    </div>
  );
};

export default ManageAssigneesPage;
