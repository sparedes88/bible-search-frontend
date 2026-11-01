import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import { useAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";
import ChurchHeader from "./ChurchHeader";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const inputStyle = {
  width: "100%",
  border: "1px solid #D1D5DB",
  borderRadius: "6px",
  padding: "10px 12px",
  boxSizing: "border-box",
  fontSize: "0.95rem",
};

const sanitizeFileName = (value) => String(value || "attachment")
  .replace(/[^a-zA-Z0-9._-]+/g, "_")
  .slice(0, 120);

const formatFileSize = (value) => {
  const size = Number(value) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const WorkRequestModule = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    projectId: "",
    priority: "medium",
    dueDate: "",
  });

  const projectsRef = useMemo(
    () => collection(db, "churches", id, "projectListIssueProjects"),
    [id]
  );
  const commitmentsRef = useMemo(() => collection(db, "churches", id, "commitments"), [id]);

  useEffect(() => {
    if (!id) return undefined;

    return onSnapshot(
      query(projectsRef, orderBy("createdAt", "desc")),
      (snapshot) => {
        const nextProjects = snapshot.docs.map((projectDoc) => ({
          id: projectDoc.id,
          ...projectDoc.data(),
        }));
        setProjects(nextProjects);
        setLoadingProjects(false);
      },
      (error) => {
        console.error("Failed to load projects for work request:", error);
        setProjects([]);
        setLoadingProjects(false);
        toast.error("Could not load projects.");
      }
    );
  }, [id, projectsRef]);

  const handleFilesChange = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    const oversizedFile = selectedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversizedFile) {
      toast.error(`${oversizedFile.name} is larger than 50 MB.`);
      event.target.value = "";
      return;
    }
    setFiles(selectedFiles);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const title = draft.title.trim();
    const projectId = draft.projectId.trim();
    const selectedProject = projects.find((project) => project.id === projectId);

    if (!title) {
      toast.warning("Work request title is required.");
      return;
    }
    if (!selectedProject) {
      toast.warning("Select a project for this work request.");
      return;
    }

    setSaving(true);
    try {
      const requestRef = await addDoc(commitmentsRef, {
        title,
        description: draft.description.trim(),
        projectId,
        projectName: String(selectedProject.name || "Untitled Project").trim(),
        dueDate: draft.dueDate,
        priority: draft.priority,
        status: "submitted",
        progressPercent: 0,
        direction: "add_to_queue",
        requestType: "work_request",
        attachments: [],
        createdByUid: user?.uid || "",
        createdByName: String(user?.displayName || user?.name || user?.email || "").trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const attachments = await Promise.all(files.map(async (file) => {
        const path = `churches/${id}/workRequests/${requestRef.id}/${Date.now()}_${sanitizeFileName(file.name)}`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
        return {
          name: file.name,
          url: await getDownloadURL(fileRef),
          path,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        };
      }));

      if (attachments.length) {
        const { updateDoc, doc } = await import("firebase/firestore");
        await updateDoc(doc(db, "churches", id, "commitments", requestRef.id), {
          attachments,
          updatedAt: serverTimestamp(),
        });
      }

      setDraft({ title: "", description: "", projectId: "", priority: "medium", dueDate: "" });
      setFiles([]);
      event.target.reset();
      toast.success("Work request submitted.");
    } catch (error) {
      console.error("Failed to submit work request:", error);
      toast.error("Could not submit the work request. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC" }}>
      <ChurchHeader />
      <main style={{ maxWidth: "820px", margin: "0 auto", padding: "32px 20px 56px" }}>
        <Link to={`/organization/${id}/mi-organizacion`} style={{ color: "#2563EB", textDecoration: "none", fontWeight: 600 }}>
          Back to My Organization
        </Link>
        <div style={{ marginTop: "20px", marginBottom: "24px" }}>
          <h1 style={{ margin: 0, color: "#172554", fontSize: "1.8rem" }}>Work Requests</h1>
          <p style={{ margin: "8px 0 0", color: "#475569" }}>Submit a task, connect it to a project, and include supporting documents.</p>
        </div>
        <form onSubmit={handleSubmit} style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "24px", display: "grid", gap: "18px" }}>
          <label style={{ display: "grid", gap: "7px", fontWeight: 600, color: "#334155" }}>
            Task title
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} style={inputStyle} required />
          </label>
          <label style={{ display: "grid", gap: "7px", fontWeight: 600, color: "#334155" }}>
            Project
            <select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })} style={inputStyle} required disabled={loadingProjects}>
              <option value="">{loadingProjects ? "Loading projects..." : "Select a project"}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name || "Untitled Project"}</option>)}
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "16px" }}>
            <label style={{ display: "grid", gap: "7px", fontWeight: 600, color: "#334155" }}>
              Priority
              <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} style={inputStyle}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "7px", fontWeight: 600, color: "#334155" }}>
              Requested due date
              <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} style={inputStyle} />
            </label>
          </div>
          <label style={{ display: "grid", gap: "7px", fontWeight: 600, color: "#334155" }}>
            Request details
            <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} style={{ ...inputStyle, minHeight: "130px", resize: "vertical" }} />
          </label>
          <label style={{ display: "grid", gap: "7px", fontWeight: 600, color: "#334155" }}>
            Documents and files
            <input type="file" multiple onChange={handleFilesChange} style={inputStyle} />
            <span style={{ color: "#64748B", fontSize: "0.85rem", fontWeight: 400 }}>Any file type, up to 50 MB per file.</span>
          </label>
          {files.length > 0 && <ul style={{ margin: 0, paddingLeft: "20px", color: "#475569" }}>{files.map((file) => <li key={`${file.name}-${file.lastModified}`}>{file.name} ({formatFileSize(file.size)})</li>)}</ul>}
          <button type="submit" disabled={saving || loadingProjects} style={{ justifySelf: "start", background: saving ? "#94A3B8" : "#2563EB", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "10px 16px", fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
            {saving ? "Submitting..." : "Submit Work Request"}
          </button>
        </form>
      </main>
    </div>
  );
};

export default WorkRequestModule;