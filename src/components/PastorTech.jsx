import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import ReactMarkdown from "react-markdown";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import { auth, db, storage } from "../firebase";

const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";

const SUPPORTED_TEXT_FILE_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
]);

const SOURCE_TYPE_OPTIONS = [
  { value: "text", label: "Text note" },
  { value: "document", label: "Document" },
  { value: "image", label: "Image" },
  { value: "link", label: "Link or reference" },
];

const sanitizeFileName = (value) =>
  String(value || "source")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");

const normalizeText = (value) => String(value || "").trim();

const formatDateTime = (value) => {
  if (!value) return "";

  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const buildExcerpt = (value, maxLength = 220) => {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
};

const buildLocalFallbackAnswer = (question, relevantSources) => {
  if (!Array.isArray(relevantSources) || relevantSources.length === 0) {
    return [
      "I do not have enough taught content yet to answer that.",
      "Add documents, images, or notes in the Teach PastorTech section, then ask again.",
      `Question saved: ${question}`,
    ].join("\n\n");
  }

  return [
    "I could not reach Gemini right now, but here are the closest taught sources:",
    ...relevantSources.map(
      (source) => `- ${source.title}: ${buildExcerpt(source.summary || source.content, 220)}`
    ),
    "Try again in a few seconds, or add more specific source content for this topic.",
  ].join("\n");
};

const isTextLikeFile = (file) => SUPPORTED_TEXT_FILE_TYPES.has(String(file?.type || "").toLowerCase());

const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsText(file);
  });

const scoreSource = (source, questionTokens) => {
  const haystack = [source?.title, source?.summary, source?.content, ...(Array.isArray(source?.tags) ? source.tags : [])]
    .map((value) => normalizeText(value).toLowerCase())
    .join(" ");

  return questionTokens.reduce((total, token) => {
    if (!token) return total;
    return total + (haystack.includes(token) ? 3 : 0);
  }, 0);
};

const PastorTech = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [sources, setSources] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [sourceForm, setSourceForm] = useState({
    title: "",
    sourceType: "text",
    content: "",
    notes: "",
    tags: "",
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const normalizedRole = String(user?.role || user?.customRole || user?.assignedRoleId || "").trim().toLowerCase();
  const isGlobalAdminUser = ["global_admin", "system_global_admin"].includes(normalizedRole);
  const isAdminUser = isGlobalAdminUser || ["admin", "system_admin"].includes(normalizedRole);
  const canManageSources = Boolean(isAdminUser || isGlobalAdminUser);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sourceCollectionPath = useMemo(() => (id ? `churches/${id}/pastortechSources` : ""), [id]);
  const messageCollectionPath = useMemo(
    () => (id && user?.uid ? `churches/${id}/pastortechChats/${user.uid}/messages` : ""),
    [id, user?.uid]
  );

  const loadWorkspace = useCallback(async () => {
    if (!id || !user) {
      setLoading(false);
      setSourcesLoading(false);
      return;
    }

    try {
      setLoading(true);
      setSourcesLoading(true);

      const [sourcesSnapshot, messagesSnapshot] = await Promise.all([
        getDocs(query(collection(db, sourceCollectionPath), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, messageCollectionPath), orderBy("createdAt", "asc"))),
      ]);

      setSources(
        sourcesSnapshot.docs.map((sourceDoc) => ({
          id: sourceDoc.id,
          ...sourceDoc.data(),
        }))
      );

      const loadedMessages = messagesSnapshot.docs.map((messageDoc) => ({
        id: messageDoc.id,
        ...messageDoc.data(),
      }));

      setMessages(
        loadedMessages.length
          ? loadedMessages
          : [
              {
                id: "welcome",
                role: "assistant",
                content:
                  "I’m ready to learn from your organization’s documents, images, and notes. Add a source, then ask me something about it.",
              },
            ]
      );
    } catch (error) {
      console.error("Failed to load PastorTech workspace:", error);
      toast.error("Could not load PastorTech yet.");
    } finally {
      setLoading(false);
      setSourcesLoading(false);
    }
  }, [id, messageCollectionPath, sourceCollectionPath, user]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const filteredSources = useMemo(() => {
    const tokens = normalizeText(searchQuery).toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return sources;
    }

    return sources.filter((source) => scoreSource(source, tokens) > 0);
  }, [searchQuery, sources]);

  const sourceStats = useMemo(() => {
    const imageCount = sources.filter((source) => String(source.sourceType || "").toLowerCase() === "image").length;
    const documentCount = sources.filter((source) => String(source.sourceType || "").toLowerCase() !== "image").length;
    const wordCount = sources.reduce((total, source) => {
      const content = normalizeText(source.summary || source.content);
      return total + (content ? content.split(/\s+/).filter(Boolean).length : 0);
    }, 0);

    return {
      total: sources.length,
      imageCount,
      documentCount,
      wordCount,
    };
  }, [sources]);

  const handleSourceFieldChange = (event) => {
    const { name, value } = event.target;
    setSourceForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);

    if (file && !sourceForm.title) {
      setSourceForm((previous) => ({
        ...previous,
        title: file.name.replace(/\.[^.]+$/, ""),
      }));
    }
  };

  const getAuthToken = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("Sign in first.");
    }

    return currentUser.getIdToken();
  };

  const buildSourcePayload = async () => {
    const title = normalizeText(sourceForm.title) || selectedFile?.name || "Untitled source";
    const tags = sourceForm.tags
      .split(",")
      .map((value) => normalizeText(value))
      .filter(Boolean);
    const notes = normalizeText(sourceForm.notes);
    const sourceType = normalizeText(sourceForm.sourceType) || "text";
    const file = selectedFile;
    const nextPayload = {
      title,
      sourceType,
      notes,
      tags,
      createdBy: user?.uid || "",
      createdByName: user?.displayName || user?.email || "",
      createdAt: serverTimestamp(),
    };

    let content = normalizeText(sourceForm.content);
    let fileUrl = "";
    let fileName = "";
    let fileMimeType = "";

    if (file) {
      fileName = file.name;
      fileMimeType = String(file.type || "").trim().toLowerCase();

      if (storage) {
        const uploadPath = `churches/${id}/pastortech/${Date.now()}-${sanitizeFileName(file.name)}`;
        const storageRef = ref(storage, uploadPath);
        await uploadBytes(storageRef, file);
        fileUrl = await getDownloadURL(storageRef);
      }

      if (isTextLikeFile(file)) {
        content = normalizeText(await readFileAsText(file));
      }
    }

    return {
      ...nextPayload,
      content,
      fileUrl,
      fileName,
      fileMimeType,
    };
  };

  const handleTeachSource = async (event) => {
    event.preventDefault();

    if (!id || !user) {
      return;
    }

    if (!sourceForm.title.trim() && !selectedFile && !sourceForm.content.trim()) {
      toast.error("Add a title, file, or text before teaching PastorTech.");
      return;
    }

    try {
      setSavingSource(true);

      const payload = await buildSourcePayload();
      const authToken = await getAuthToken();
      let summary = buildExcerpt(payload.content || payload.notes, 500);
      let tags = payload.tags;

      if (payload.fileUrl || payload.content) {
        const analyzeResponse = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/pastortechAnalyzeSource`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            churchId: id,
            title: payload.title,
            sourceType: payload.sourceType,
            rawText: payload.content,
            notes: payload.notes,
            fileUrl: payload.fileUrl,
            fileName: payload.fileName,
            fileMimeType: payload.fileMimeType,
          }),
        });

        if (analyzeResponse.ok) {
          const analyzedPayload = await analyzeResponse.json();
          summary = normalizeText(analyzedPayload.summary) || summary;
          tags = Array.isArray(analyzedPayload.tags) && analyzedPayload.tags.length ? analyzedPayload.tags : tags;
        }
      }

      await addDoc(collection(db, sourceCollectionPath), {
        ...payload,
        summary,
        tags,
      });

      toast.success("PastorTech learned from this source.");
      setSourceForm({
        title: "",
        sourceType: "text",
        content: "",
        notes: "",
        tags: "",
      });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadWorkspace();
    } catch (error) {
      console.error("Failed to teach PastorTech:", error);
      toast.error("Could not save this source.");
    } finally {
      setSavingSource(false);
    }
  };

  const getRelevantSources = (question) => {
    const tokens = normalizeText(question)
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2);

    return [...sources]
      .map((source) => ({
        ...source,
        score: scoreSource(source, tokens),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();

    const question = normalizeText(chatInput);
    if (!question || sendingMessage || !id || !user) {
      return;
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question,
    };

    setMessages((previous) => [...previous, userMessage]);
    setChatInput("");

    const relevantSources = getRelevantSources(question);

    try {
      setSendingMessage(true);
      const authToken = await getAuthToken();

      if (messageCollectionPath) {
        await addDoc(collection(db, messageCollectionPath), {
          role: "user",
          content: question,
          createdAt: serverTimestamp(),
        });
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/pastortechChat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          churchId: id,
          organizationName: user?.churchName || user?.organizationName || "this organization",
          question,
          sources: relevantSources,
        }),
      });

      window.clearTimeout(timeoutId);

      let answer = buildLocalFallbackAnswer(question, relevantSources);
      if (response.ok) {
        const payload = await response.json();
        answer = normalizeText(payload.answer) || answer;
      } else {
        let serverErrorMessage = "";
        try {
          const errorPayload = await response.json();
          serverErrorMessage = normalizeText(errorPayload?.error || errorPayload?.message || "");
        } catch (parseError) {
          try {
            const responseText = await response.text();
            serverErrorMessage = normalizeText(responseText).slice(0, 240);
          } catch (textError) {
            serverErrorMessage = "";
          }
        }

        answer = [
          answer,
          serverErrorMessage ? `Server detail: ${serverErrorMessage}` : "Server detail: chat service returned an unexpected response.",
        ].join("\n\n");
      }

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: answer,
      };

      setMessages((previous) => [...previous, assistantMessage]);

      if (messageCollectionPath) {
        await addDoc(collection(db, messageCollectionPath), {
          role: "assistant",
          content: answer,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("PastorTech chat failed:", error);
      const isTimeout = error?.name === "AbortError";
      toast.error(isTimeout ? "PastorTech timed out. Showing source fallback." : "Could not talk to PastorTech right now.");

      const fallbackAnswer = buildLocalFallbackAnswer(question, relevantSources);
      setMessages((previous) => [
        ...previous,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: fallbackAnswer,
        },
      ]);
    } finally {
      setSendingMessage(false);
    }
  };

  const statsCards = [
    { label: "Sources", value: sourceStats.total },
    { label: "Docs & notes", value: sourceStats.documentCount },
    { label: "Images", value: sourceStats.imageCount },
    { label: "Indexed words", value: sourceStats.wordCount.toLocaleString() },
  ];

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #07111f 0%, #0f172a 40%, #111827 100%)", color: "white" }}>
        <ChurchHeader />
        <div style={{ padding: "48px 24px", textAlign: "center" }}>Loading PastorTech...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(20, 184, 166, 0.16), transparent 30%), radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 28%), linear-gradient(180deg, #06101d 0%, #0f172a 42%, #111827 100%)", color: "#e5eefb" }}>
      <ChurchHeader />
      <div style={{ maxWidth: "1440px", margin: "0 auto", padding: "28px 20px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }}>
          <div style={{ maxWidth: "820px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", padding: "8px 14px", borderRadius: "999px", background: "rgba(15, 23, 42, 0.62)", border: "1px solid rgba(148, 163, 184, 0.2)", color: "#a7f3d0", marginBottom: "14px" }}>
              <span>🧠</span>
              <span>PastorTech</span>
            </div>
            <h1 style={{ ...commonStyles.title, color: "white", marginBottom: "10px" }}>A church knowledge base that learns from your content.</h1>
            <p style={{ marginBottom: 0, color: "#cbd5e1", fontSize: "1.05rem", lineHeight: 1.7 }}>
              Teach it documents, images, notes, and references from this organization. PastorTech stores the material in Firestore, summarizes it with Gemini, and turns it into a chatable knowledge base for your team.
            </p>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Link to={`/organization/${id}/mi-organizacion`} style={{ textDecoration: "none" }}>
              <button type="button" style={{ border: "1px solid rgba(148, 163, 184, 0.24)", background: "rgba(15, 23, 42, 0.72)", color: "white", borderRadius: "14px", padding: "12px 18px" }}>
                Back to Mi Organizacion
              </button>
            </Link>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "14px", marginBottom: "18px" }}>
          {statsCards.map((card) => (
            <div key={card.label} style={{ borderRadius: "18px", padding: "18px", background: "rgba(15, 23, 42, 0.82)", border: "1px solid rgba(148, 163, 184, 0.18)", boxShadow: "0 20px 50px rgba(2, 6, 23, 0.24)" }}>
              <div style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", marginBottom: "8px" }}>{card.label}</div>
              <div style={{ fontSize: "1.7rem", fontWeight: 700, color: "white" }}>{card.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(340px, 0.9fr)", gap: "18px", alignItems: "start" }}>
          <div style={{ display: "grid", gap: "18px" }}>
            <section style={{ borderRadius: "24px", padding: "22px", background: "rgba(15, 23, 42, 0.9)", border: "1px solid rgba(148, 163, 184, 0.18)", boxShadow: "0 24px 70px rgba(2, 6, 23, 0.28)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ color: "white", marginBottom: "6px", fontSize: "1.3rem" }}>Teach PastorTech</h2>
                  <p style={{ marginBottom: 0, color: "#cbd5e1" }}>Add content once and use it everywhere in the assistant.</p>
                </div>
                {!canManageSources && (
                  <div style={{ padding: "8px 12px", borderRadius: "999px", background: "rgba(59, 130, 246, 0.14)", color: "#bfdbfe", border: "1px solid rgba(96, 165, 250, 0.2)" }}>
                    Chat access only. Ask an admin to add sources.
                  </div>
                )}
              </div>

              <form onSubmit={handleTeachSource} style={{ display: "grid", gap: "14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ color: "#cbd5e1", fontSize: "0.9rem" }}>Title</span>
                    <input
                      name="title"
                      value={sourceForm.title}
                      onChange={handleSourceFieldChange}
                      placeholder="Sunday sermon outline, ministry handbook, photo album..."
                      style={{ width: "100%", borderRadius: "14px", border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.75)", color: "white", padding: "14px 16px" }}
                      disabled={!canManageSources}
                    />
                  </label>

                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ color: "#cbd5e1", fontSize: "0.9rem" }}>Type</span>
                    <select
                      name="sourceType"
                      value={sourceForm.sourceType}
                      onChange={handleSourceFieldChange}
                      style={{ width: "100%", borderRadius: "14px", border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.75)", color: "white", padding: "14px 16px" }}
                      disabled={!canManageSources}
                    >
                      {SOURCE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} style={{ color: "#0f172a" }}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ color: "#cbd5e1", fontSize: "0.9rem" }}>Content to teach</span>
                  <textarea
                    name="content"
                    value={sourceForm.content}
                    onChange={handleSourceFieldChange}
                    placeholder="Paste the text here, add a note, or provide an excerpt from a document."
                    rows={6}
                    style={{ width: "100%", borderRadius: "16px", border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.75)", color: "white", padding: "14px 16px", resize: "vertical" }}
                    disabled={!canManageSources}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ color: "#cbd5e1", fontSize: "0.9rem" }}>Notes</span>
                    <input
                      name="notes"
                      value={sourceForm.notes}
                      onChange={handleSourceFieldChange}
                      placeholder="What should PastorTech remember about this source?"
                      style={{ width: "100%", borderRadius: "14px", border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.75)", color: "white", padding: "14px 16px" }}
                      disabled={!canManageSources}
                    />
                  </label>

                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ color: "#cbd5e1", fontSize: "0.9rem" }}>Tags</span>
                    <input
                      name="tags"
                      value={sourceForm.tags}
                      onChange={handleSourceFieldChange}
                      placeholder="sermon, leadership, photo, outreach"
                      style={{ width: "100%", borderRadius: "14px", border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.75)", color: "white", padding: "14px 16px" }}
                      disabled={!canManageSources}
                    />
                  </label>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderRadius: "14px", border: "1px dashed rgba(148, 163, 184, 0.28)", background: "rgba(15, 23, 42, 0.65)", color: "#cbd5e1", cursor: canManageSources ? "pointer" : "not-allowed" }}>
                    <span>📎 Upload file</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileChange}
                      accept=".txt,.md,.csv,.json,.html,.pdf,image/*"
                      style={{ display: "none" }}
                      disabled={!canManageSources}
                    />
                  </label>
                  {selectedFile && <span style={{ color: "#a7f3d0" }}>{selectedFile.name}</span>}
                  <button
                    type="submit"
                    disabled={!canManageSources || savingSource}
                    style={{ marginLeft: "auto", border: "none", borderRadius: "14px", padding: "13px 18px", background: savingSource ? "#475569" : "linear-gradient(135deg, #14b8a6 0%, #2563eb 100%)", color: "white", fontWeight: 700 }}
                  >
                    {savingSource ? "Teaching..." : "Teach PastorTech"}
                  </button>
                </div>
              </form>
            </section>

            <section style={{ borderRadius: "24px", padding: "22px", background: "rgba(15, 23, 42, 0.9)", border: "1px solid rgba(148, 163, 184, 0.18)", boxShadow: "0 24px 70px rgba(2, 6, 23, 0.28)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ color: "white", marginBottom: "6px", fontSize: "1.3rem" }}>Knowledge Library</h2>
                  <p style={{ marginBottom: 0, color: "#cbd5e1" }}>Search the sources PastorTech has already learned.</p>
                </div>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search the library"
                  style={{ minWidth: "240px", flex: 1, maxWidth: "360px", borderRadius: "14px", border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.75)", color: "white", padding: "12px 16px" }}
                />
              </div>

              {sourcesLoading ? (
                <div style={{ color: "#cbd5e1" }}>Loading sources...</div>
              ) : filteredSources.length ? (
                <div style={{ display: "grid", gap: "12px" }}>
                  {filteredSources.map((source) => (
                    <article key={source.id} style={{ borderRadius: "18px", padding: "16px", background: "rgba(2, 6, 23, 0.35)", border: "1px solid rgba(148, 163, 184, 0.16)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" }}>
                        <div>
                          <h3 style={{ color: "white", marginBottom: "4px", fontSize: "1.02rem" }}>{source.title}</h3>
                          <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>
                            {normalizeText(source.sourceType || "text")} · {formatDateTime(source.createdAt)}
                          </div>
                        </div>
                        {Array.isArray(source.tags) && source.tags.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                            {source.tags.slice(0, 4).map((tag) => (
                              <span key={`${source.id}-${tag}`} style={{ padding: "6px 10px", borderRadius: "999px", background: "rgba(20, 184, 166, 0.14)", color: "#99f6e4", border: "1px solid rgba(45, 212, 191, 0.18)", fontSize: "0.82rem" }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <p style={{ marginBottom: "8px", color: "#e2e8f0", lineHeight: 1.65 }}>{buildExcerpt(source.summary || source.content, 280)}</p>
                      {source.fileUrl ? (
                        <a href={source.fileUrl} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>
                          Open source file
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div style={{ padding: "18px", borderRadius: "18px", border: "1px dashed rgba(148, 163, 184, 0.2)", color: "#cbd5e1" }}>
                  No sources yet. Teach PastorTech something first, then ask it a question.
                </div>
              )}
            </section>
          </div>

          <aside style={{ borderRadius: "24px", padding: "22px", background: "rgba(15, 23, 42, 0.9)", border: "1px solid rgba(148, 163, 184, 0.18)", boxShadow: "0 24px 70px rgba(2, 6, 23, 0.28)", position: "sticky", top: "20px" }}>
            <div style={{ marginBottom: "16px" }}>
              <h2 style={{ color: "white", marginBottom: "6px", fontSize: "1.3rem" }}>Talk to PastorTech</h2>
              <p style={{ marginBottom: 0, color: "#cbd5e1" }}>Ask questions about the content you taught it.</p>
            </div>

            <div style={{ display: "grid", gap: "12px", marginBottom: "14px", maxHeight: "56vh", overflowY: "auto", paddingRight: "4px" }}>
              {messages.map((message) => (
                <div key={message.id} style={{ padding: "14px", borderRadius: "18px", border: message.role === "user" ? "1px solid rgba(74, 222, 128, 0.22)" : "1px solid rgba(96, 165, 250, 0.22)", background: message.role === "user" ? "rgba(4, 120, 87, 0.12)" : "rgba(30, 41, 59, 0.9)" }}>
                  <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", color: message.role === "user" ? "#86efac" : "#93c5fd", marginBottom: "8px" }}>
                    {message.role === "user" ? "You" : "PastorTech"}
                  </div>
                  <ReactMarkdown>{String(message.content || "")}</ReactMarkdown>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendMessage} style={{ display: "grid", gap: "10px" }}>
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={sources.length ? "Ask about anything PastorTech has learned..." : "Teach content first, then ask a question."}
                rows={5}
                style={{ width: "100%", borderRadius: "16px", border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(15, 23, 42, 0.75)", color: "white", padding: "14px 16px", resize: "vertical" }}
              />
              <button
                type="submit"
                disabled={sendingMessage || !chatInput.trim()}
                style={{ border: "none", borderRadius: "14px", padding: "13px 18px", background: sendingMessage ? "#475569" : "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)", color: "white", fontWeight: 700 }}
              >
                {sendingMessage ? "Thinking..." : "Send message"}
              </button>
            </form>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default PastorTech;