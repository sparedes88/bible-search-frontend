import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import { collection, doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { toast } from "react-toastify";
import { PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";

const PROJECT_NAME_VALUES_FIELD = "projectNameValues";

const ProjectNameManagerPage = () => {
  const { id } = useParams();
  const [projectNames, setProjectNames] = useState([]);
  const [sortOrder, setSortOrder] = useState("asc"); // 'asc' or 'desc'
  const dragItem = useRef();
  const dragOverItem = useRef();
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(true);

  // Handle sort order change
  const handleSortOrderChange = (e) => {
    const order = e.target.value;
    setSortOrder(order);
    setProjectNames((prev) => {
      const sorted = [...prev].sort((a, b) => order === "asc" ? a.localeCompare(b) : b.localeCompare(a));
      return sorted;
    });
  };

  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const values = Array.isArray(data[PROJECT_NAME_VALUES_FIELD]) ? data[PROJECT_NAME_VALUES_FIELD] : [];
      setProjectNames((prev) => {
        const sorted = [...values].sort((a, b) => sortOrder === "asc" ? a.localeCompare(b) : b.localeCompare(a));
        return sorted;
      });
      setLoading(false);
    });
    return () => unsubscribe();
  }, [id, sortOrder]);

  // Arrow-based sorting handlers
  const moveProjectName = async (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= projectNames.length) return;
    const reordered = [...projectNames];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);
    setProjectNames(reordered);
    // Persist new order to Firestore
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await setDoc(configRef, {
        [PROJECT_NAME_VALUES_FIELD]: reordered,
      }, { merge: true });
      toast.success("Project Name order updated.");
    } catch (err) {
      toast.error("Failed to update order.");
    }
  };

  const handleAddProjectName = async (e) => {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    if (projectNames.includes(name)) {
      toast.info("Project Name already exists.");
      return;
    }
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await setDoc(configRef, {
        [PROJECT_NAME_VALUES_FIELD]: [...projectNames, name],
      }, { merge: true });
      setNewProjectName("");
      toast.success("Project Name added.");
    } catch (err) {
      toast.error("Failed to add Project Name.");
    }
  };

  return (
    <div style={{ maxWidth: 500, margin: "40px auto", background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px #0001", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Manage Project Name Values</h1>
      <form onSubmit={handleAddProjectName} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={newProjectName}
          onChange={e => setNewProjectName(e.target.value)}
          placeholder="Add new Project Name"
        />
        <button type="submit" style={{ padding: "8px 16px", borderRadius: 4, background: "#2563eb", color: "#fff", border: "none", fontWeight: 600 }}>
          Add
        </button>
      </form>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginRight: 16 }}>Existing Project Names</h2>
        <label style={{ fontSize: 14, color: "#555" }}>
          Sort:
          <select value={sortOrder} onChange={handleSortOrderChange} style={{ marginLeft: 8, padding: 4, borderRadius: 4, border: "1px solid #d1d5db" }}>
            <option value="asc">A-Z</option>
            <option value="desc">Z-A</option>
          </select>
        </label>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : projectNames.length === 0 ? (
        <div style={{ color: "#888" }}>No Project Names found.</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {projectNames.map((name, idx) => (
            <li
              key={name}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid #f3f4f6",
                display: "flex",
                alignItems: "center"
              }}
            >
              <span style={{ flex: 1 }}>{typeof name === 'string' ? name : JSON.stringify(name)}</span>
              <button
                aria-label="Move up"
                style={{ marginRight: 4, padding: "2px 6px", borderRadius: 4, border: "1px solid #d1d5db", background: "#f3f4f6", cursor: idx === 0 ? "not-allowed" : "pointer" }}
                disabled={idx === 0}
                onClick={() => moveProjectName(idx, idx - 1)}
              >▲</button>
              <button
                aria-label="Move down"
                style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #d1d5db", background: "#f3f4f6", cursor: idx === projectNames.length - 1 ? "not-allowed" : "pointer" }}
                disabled={idx === projectNames.length - 1}
                onClick={() => moveProjectName(idx, idx + 1)}
              >▼</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ProjectNameManagerPage;
