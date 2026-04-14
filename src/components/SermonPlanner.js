import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";

const createEmptyPoint = () => ({
  point: "",
  verseReference: "",
  verseText: "",
  explanation: "",
  argumentation: "",
  illustration: "",
  application: "",
  highlights: [],
});

const HIGHLIGHT_COLORS = [
  { key: "amber", label: "Amber", markBg: "#fde68a", cardBg: "#fffbeb", border: "#f59e0b", text: "#92400e" },
  { key: "mint", label: "Mint", markBg: "#bbf7d0", cardBg: "#f0fdf4", border: "#22c55e", text: "#166534" },
  { key: "sky", label: "Sky", markBg: "#bae6fd", cardBg: "#f0f9ff", border: "#38bdf8", text: "#075985" },
  { key: "rose", label: "Rose", markBg: "#fecdd3", cardBg: "#fff1f2", border: "#fb7185", text: "#9f1239" },
  { key: "violet", label: "Violet", markBg: "#ddd6fe", cardBg: "#f5f3ff", border: "#8b5cf6", text: "#5b21b6" },
  { key: "slate", label: "Slate", markBg: "#e2e8f0", cardBg: "#f8fafc", border: "#64748b", text: "#334155" },
];

const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].key;

const getHighlightColorConfig = (colorKey) => {
  return HIGHLIGHT_COLORS.find((item) => item.key === colorKey) || HIGHLIGHT_COLORS[0];
};

const isValidHighlightColor = (colorKey) => {
  return HIGHLIGHT_COLORS.some((item) => item.key === colorKey);
};

const pickLeastUsedColor = (colorCounts) => {
  return HIGHLIGHT_COLORS
    .map((item) => ({ key: item.key, count: colorCounts[item.key] || 0 }))
    .sort((a, b) => a.count - b.count)[0].key;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeHighlights = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const byText = new Map();

  value.forEach((item) => {
    if (typeof item === "string") {
      const text = String(item || "").trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (!byText.has(key)) {
        byText.set(key, { text, point: "", color: "" });
      }
      return;
    }

    const text = String(item?.text || "").trim();
    const point = String(item?.point || "").trim();
    const color = String(item?.color || "").trim();
    const normalizedColor = isValidHighlightColor(color) ? color : "";
    if (!text) return;

    const key = text.toLowerCase();
    const existing = byText.get(key);
    if (!existing) {
      byText.set(key, { text, point, color: normalizedColor });
      return;
    }

    byText.set(key, {
      text: existing.text,
      point: existing.point || point,
      color: existing.color || normalizedColor,
    });
  });

  const normalized = Array.from(byText.values());
  const colorCounts = HIGHLIGHT_COLORS.reduce((acc, item) => {
    acc[item.key] = 0;
    return acc;
  }, {});

  normalized.forEach((item) => {
    if (isValidHighlightColor(item.color)) {
      colorCounts[item.color] = (colorCounts[item.color] || 0) + 1;
    }
  });

  return normalized.map((item) => {
    if (isValidHighlightColor(item.color)) {
      return item;
    }

    const autoColor = pickLeastUsedColor(colorCounts);
    colorCounts[autoColor] = (colorCounts[autoColor] || 0) + 1;

    return {
      ...item,
      color: autoColor,
    };
  });
};

const renderHighlightedText = (text, highlights) => {
  const sourceText = String(text || "");
  const normalizedHighlights = normalizeHighlights(highlights).sort((a, b) => b.text.length - a.text.length);

  if (normalizedHighlights.length === 0) {
    return sourceText;
  }

  const highlightMap = new Map(
    normalizedHighlights.map((item) => [item.text.toLowerCase(), item])
  );
  const splitter = new RegExp(
    `(${normalizedHighlights.map((item) => escapeRegExp(item.text)).join("|")})`,
    "gi"
  );

  return sourceText.split(splitter).map((chunk, index) => {
    const matched = highlightMap.get(chunk.toLowerCase());

    if (matched) {
      const colorConfig = getHighlightColorConfig(matched.color);

      return (
        <mark
          key={`hl-${index}`}
          title={matched.point || "Highlighted section"}
          style={{ backgroundColor: colorConfig.markBg, padding: "0 2px", borderRadius: "2px" }}
        >
          {chunk}
        </mark>
      );
    }

    return <React.Fragment key={`tx-${index}`}>{chunk}</React.Fragment>;
  });
};

const normalizeOutlinePoints = (outline) => {
  if (!Array.isArray(outline) || outline.length === 0) {
    return [createEmptyPoint()];
  }

  const normalized = outline.map((item) => {
    if (typeof item === "string") {
      return {
        point: item,
        verseReference: "",
        verseText: "",
        explanation: "",
        argumentation: "",
        illustration: "",
        application: "",
        highlights: [],
      };
    }

    const normalizedHighlights = normalizeHighlights(item?.highlights);
    const legacyHighlight = String(item?.highlightText || "").trim();

    if (normalizedHighlights.length === 0 && legacyHighlight) {
      normalizedHighlights.push({ text: legacyHighlight, point: "", color: DEFAULT_HIGHLIGHT_COLOR });
    }

    return {
      point: String(item?.point || ""),
      verseReference: String(item?.verseReference || ""),
      verseText: String(item?.verseText || ""),
      explanation: String(item?.explanation || ""),
      argumentation: String(item?.argumentation || ""),
      illustration: String(item?.illustration || ""),
      application: String(item?.application || ""),
      highlights: normalizedHighlights,
    };
  });

  return normalized.length > 0 ? normalized : [createEmptyPoint()];
};

const SermonPlanner = () => {
  const { id } = useParams();
  const [sermons, setSermons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [savedSermonSearch, setSavedSermonSearch] = useState("");
  const [manualHighlightInputs, setManualHighlightInputs] = useState({});
  const verseTextRefs = useRef({});

  const [formData, setFormData] = useState({
    title: "",
    subject: "",
    mainBibleVerse: "",
    notes: "",
    outlinePoints: [createEmptyPoint()],
  });

  useEffect(() => {
    if (!id) return;

    const sermonsRef = collection(db, "churches", id, "sermons");
    const sermonsQuery = query(sermonsRef, orderBy("updatedAt", "desc"));

    const unsubscribe = onSnapshot(
      sermonsQuery,
      (snapshot) => {
        const sermonData = snapshot.docs.map((sermonDoc) => ({
          id: sermonDoc.id,
          ...sermonDoc.data(),
        }));

        setSermons(sermonData);
        setLoading(false);
      },
      (error) => {
        console.error("Error loading sermons:", error);
        toast.error("Failed to load sermons");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const resetForm = () => {
    setFormData({
      title: "",
      subject: "",
      mainBibleVerse: "",
      notes: "",
      outlinePoints: [createEmptyPoint()],
    });
    setManualHighlightInputs({});
    setEditingId(null);
  };

  const handlePointChange = (index, field, value) => {
    setFormData((prev) => {
      const nextPoints = [...prev.outlinePoints];
      nextPoints[index] = {
        ...nextPoints[index],
        [field]: value,
      };

      return {
        ...prev,
        outlinePoints: nextPoints,
      };
    });
  };

  const handleAddPoint = () => {
    setFormData((prev) => ({
      ...prev,
      outlinePoints: [...prev.outlinePoints, createEmptyPoint()],
    }));
  };

  const handleRemovePoint = (index) => {
    setFormData((prev) => {
      const nextPoints = prev.outlinePoints.filter((_, pointIndex) => pointIndex !== index);
      return {
        ...prev,
        outlinePoints: nextPoints.length > 0 ? nextPoints : [createEmptyPoint()],
      };
    });

    setManualHighlightInputs((prev) => {
      const next = { ...prev };
      delete next[index];

      const shifted = {};
      Object.keys(next).forEach((key) => {
        const numericKey = Number(key);
        if (numericKey > index) {
          shifted[numericKey - 1] = next[numericKey];
        } else {
          shifted[numericKey] = next[numericKey];
        }
      });

      return shifted;
    });

    delete verseTextRefs.current[index];
  };

  const getNextHighlightColor = (currentHighlights = []) => {
    if (!Array.isArray(currentHighlights) || currentHighlights.length === 0) {
      return DEFAULT_HIGHLIGHT_COLOR;
    }

    const colorCounts = HIGHLIGHT_COLORS.reduce((acc, item) => {
      acc[item.key] = 0;
      return acc;
    }, {});

    currentHighlights.forEach((highlight) => {
      const key = getHighlightColorConfig(highlight?.color).key;
      colorCounts[key] = (colorCounts[key] || 0) + 1;
    });

    return HIGHLIGHT_COLORS
      .map((item) => ({ key: item.key, count: colorCounts[item.key] || 0 }))
      .sort((a, b) => a.count - b.count)[0].key;
  };

  const addHighlightToPoint = (index, value) => {
    const phrase = String(value || "").trim();

    if (!phrase) {
      toast.error("Select or type text to highlight first");
      return;
    }

    setFormData((prev) => {
      const nextPoints = [...prev.outlinePoints];
      const currentPoint = nextPoints[index] || createEmptyPoint();
      const nextColor = getNextHighlightColor(currentPoint.highlights || []);
      const nextHighlights = normalizeHighlights([
        ...(currentPoint.highlights || []),
        { text: phrase, point: "", color: nextColor },
      ]);

      nextPoints[index] = {
        ...currentPoint,
        highlights: nextHighlights,
      };

      return {
        ...prev,
        outlinePoints: nextPoints,
      };
    });
  };

  const handleAddHighlightFromSelection = (index) => {
    const textarea = verseTextRefs.current[index];

    if (!textarea) {
      toast.error("Add verse text first");
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (typeof start !== "number" || typeof end !== "number" || end <= start) {
      toast.error("Select the verse words you want to highlight");
      return;
    }

    const selectedText = textarea.value.slice(start, end).trim();
    addHighlightToPoint(index, selectedText);
  };

  const handleAddManualHighlight = (index) => {
    const manualValue = manualHighlightInputs[index] || "";
    addHighlightToPoint(index, manualValue);
    setManualHighlightInputs((prev) => ({ ...prev, [index]: "" }));
  };

  const handleRemoveHighlight = (pointIndex, highlightIndex) => {
    setFormData((prev) => {
      const nextPoints = [...prev.outlinePoints];
      const currentPoint = nextPoints[pointIndex] || createEmptyPoint();
      const nextHighlights = (currentPoint.highlights || []).filter((_, index) => index !== highlightIndex);

      nextPoints[pointIndex] = {
        ...currentPoint,
        highlights: nextHighlights,
      };

      return {
        ...prev,
        outlinePoints: nextPoints,
      };
    });
  };

  const handleMoveHighlight = (pointIndex, fromIndex, direction) => {
    setFormData((prev) => {
      const nextPoints = [...prev.outlinePoints];
      const currentPoint = nextPoints[pointIndex] || createEmptyPoint();
      const currentHighlights = [...(currentPoint.highlights || [])];

      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= currentHighlights.length) {
        return prev;
      }

      const temp = currentHighlights[fromIndex];
      currentHighlights[fromIndex] = currentHighlights[toIndex];
      currentHighlights[toIndex] = temp;

      nextPoints[pointIndex] = {
        ...currentPoint,
        highlights: currentHighlights,
      };

      return {
        ...prev,
        outlinePoints: nextPoints,
      };
    });
  };

  const handleHighlightPointChange = (pointIndex, highlightIndex, value) => {
    setFormData((prev) => {
      const nextPoints = [...prev.outlinePoints];
      const currentPoint = nextPoints[pointIndex] || createEmptyPoint();
      const nextHighlights = [...(currentPoint.highlights || [])];

      if (!nextHighlights[highlightIndex]) {
        return prev;
      }

      nextHighlights[highlightIndex] = {
        ...nextHighlights[highlightIndex],
        point: value,
      };

      nextPoints[pointIndex] = {
        ...currentPoint,
        highlights: nextHighlights,
      };

      return {
        ...prev,
        outlinePoints: nextPoints,
      };
    });
  };

  const handleHighlightColorChange = (pointIndex, highlightIndex, colorKey) => {
    setFormData((prev) => {
      const nextPoints = [...prev.outlinePoints];
      const currentPoint = nextPoints[pointIndex] || createEmptyPoint();
      const nextHighlights = [...(currentPoint.highlights || [])];

      if (!nextHighlights[highlightIndex]) {
        return prev;
      }

      nextHighlights[highlightIndex] = {
        ...nextHighlights[highlightIndex],
        color: getHighlightColorConfig(colorKey).key,
      };

      nextPoints[pointIndex] = {
        ...currentPoint,
        highlights: nextHighlights,
      };

      return {
        ...prev,
        outlinePoints: nextPoints,
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.title.trim()) {
      toast.error("Please enter a sermon title");
      return;
    }

    const cleanedPoints = formData.outlinePoints.map((pointItem) => ({
      point: String(pointItem.point || "").trim(),
      verseReference: String(pointItem.verseReference || "").trim(),
      verseText: String(pointItem.verseText || "").trim(),
      explanation: String(pointItem.explanation || "").trim(),
      argumentation: String(pointItem.argumentation || "").trim(),
      illustration: String(pointItem.illustration || "").trim(),
      application: String(pointItem.application || "").trim(),
      highlights: normalizeHighlights(pointItem.highlights),
      highlightText: normalizeHighlights(pointItem.highlights)[0]?.text || "",
    }));

    if (cleanedPoints.length === 0) {
      toast.error("Please add at least one point");
      return;
    }

    const invalidPointIndex = cleanedPoints.findIndex(
      (pointItem) => !pointItem.point || !pointItem.verseReference || !pointItem.verseText
    );

    if (invalidPointIndex >= 0) {
      toast.error(`Statement ${invalidPointIndex + 1} must include statement text, verse reference, and verse content`);
      return;
    }

    const missingExpositionIndex = cleanedPoints.findIndex((pointItem) => {
      return !pointItem.explanation && !pointItem.argumentation && !pointItem.illustration && !pointItem.application;
    });

    if (missingExpositionIndex >= 0) {
      toast.error(`Statement ${missingExpositionIndex + 1} needs at least one field: explanation, argumentation, illustration, or application`);
      return;
    }

    setSaving(true);

    try {
      const payload = {
        title: formData.title.trim(),
        subject: String(formData.subject || "").trim(),
        mainBibleVerse: String(formData.mainBibleVerse || "").trim(),
        notes: formData.notes.trim(),
        outline: cleanedPoints,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(doc(db, "churches", id, "sermons", editingId), payload);
        toast.success("Sermon updated");
      } else {
        await addDoc(collection(db, "churches", id, "sermons"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success("Sermon saved");
      }

      resetForm();
    } catch (error) {
      console.error("Error saving sermon:", error);
      toast.error("Failed to save sermon");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (sermon) => {
    const normalizedPoints = normalizeOutlinePoints(sermon.outline);

    setEditingId(sermon.id);
    setFormData({
      title: sermon.title || "",
      subject: sermon.subject || "",
      mainBibleVerse: sermon.mainBibleVerse || "",
      notes: sermon.notes || "",
      outlinePoints: normalizedPoints,
    });
    setManualHighlightInputs({});
  };

  const handleDelete = async (sermonId) => {
    if (!window.confirm("Delete this sermon note?")) return;

    try {
      await deleteDoc(doc(db, "churches", id, "sermons", sermonId));
      toast.success("Sermon deleted");

      if (editingId === sermonId) {
        resetForm();
      }
    } catch (error) {
      console.error("Error deleting sermon:", error);
      toast.error("Failed to delete sermon");
    }
  };

  const sortedSermons = useMemo(() => sermons, [sermons]);
  const filteredSermons = useMemo(() => {
    const queryText = String(savedSermonSearch || "").trim().toLowerCase();

    if (!queryText) {
      return sortedSermons;
    }

    return sortedSermons.filter((sermon) => {
      const title = String(sermon?.title || "").toLowerCase();
      const subject = String(sermon?.subject || "").toLowerCase();
      const mainBibleVerse = String(sermon?.mainBibleVerse || "").toLowerCase();
      return title.includes(queryText) || subject.includes(queryText) || mainBibleVerse.includes(queryText);
    });
  }, [sortedSermons, savedSermonSearch]);

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>
      <ChurchHeader id={id} applyShadow={false} />

      <div style={{ marginTop: "-20px" }}>
        <h1 style={commonStyles.title}>Sermon Planner</h1>
        <p style={{ marginBottom: "1rem", color: "#6b7280" }}>
          Build your sermon plan and ensure every point includes a Bible verse and verse content.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1rem",
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "1rem",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "0.75rem" }}>
              {editingId ? "Edit Sermon" : "New Sermon"}
            </h2>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
                  Sermon Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Example: Walking by Faith"
                  style={{
                    width: "100%",
                    padding: "0.6rem",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                  }}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
                  Subject / Main Idea
                </label>
                <input
                  type="text"
                  value={fo                firebase deploy --only functions:suggestIssueTagsVision2026-04-11rmData.subject}
                  onChange={(e) => setFormData((prev) => ({ ...prev, subject: e.target.value }))}
                  placeholder="Example: Jesus is faithful in every season"
                  style={{
                    width: "100%",
                    padding: "0.6rem",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                  }}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
                  Main Bible Verse
                </label>
                <input
                  type="text"
                  value={formData.mainBibleVerse}
                  onChange={(e) => setFormData((prev) => ({ ...prev, mainBibleVerse: e.target.value }))}
                  placeholder="Example: John 3:16"
                  style={{
                    width: "100%",
                    padding: "0.6rem",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                  }}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
                  Point Outline
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {formData.outlinePoints.map((pointItem, index) => (
                    <div
                      key={`point-${index}`}
                      style={{
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        padding: "0.75rem",
                        backgroundColor: "#f9fafb",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                        <strong>Statement {index + 1}</strong>
                        <button
                          type="button"
                          onClick={() => handleRemovePoint(index)}
                          style={{
                            border: "none",
                            backgroundColor: "#ef4444",
                            color: "white",
                            borderRadius: "6px",
                            padding: "0.3rem 0.6rem",
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </div>

                      <input
                        type="text"
                        value={pointItem.point}
                        onChange={(e) => handlePointChange(index, "point", e.target.value)}
                        placeholder="Statement"
                        style={{
                          width: "100%",
                          padding: "0.55rem",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          marginBottom: "0.5rem",
                        }}
                      />

                      <textarea
                        rows={2}
                        value={pointItem.explanation || ""}
                        onChange={(e) => handlePointChange(index, "explanation", e.target.value)}
                        placeholder="1. Explanation - what does the context say?"
                        style={{
                          width: "100%",
                          padding: "0.55rem",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          marginBottom: "0.5rem",
                          resize: "vertical",
                        }}
                      />

                      <textarea
                        rows={2}
                        value={pointItem.argumentation || ""}
                        onChange={(e) => handlePointChange(index, "argumentation", e.target.value)}
                        placeholder="2. Argumentation / Exegesis - what backs up the verse?"
                        style={{
                          width: "100%",
                          padding: "0.55rem",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          marginBottom: "0.5rem",
                          resize: "vertical",
                        }}
                      />

                      <textarea
                        rows={2}
                        value={pointItem.illustration || ""}
                        onChange={(e) => handlePointChange(index, "illustration", e.target.value)}
                        placeholder="3. Illustration - a story that complements the verse"
                        style={{
                          width: "100%",
                          padding: "0.55rem",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          marginBottom: "0.5rem",
                          resize: "vertical",
                        }}
                      />

                      <textarea
                        rows={2}
                        value={pointItem.application || ""}
                        onChange={(e) => handlePointChange(index, "application", e.target.value)}
                        placeholder="4. Application - how do we apply this to our lives?"
                        style={{
                          width: "100%",
                          padding: "0.55rem",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          marginBottom: "0.5rem",
                          resize: "vertical",
                        }}
                      />

                      <input
                        type="text"
                        value={pointItem.verseReference}
                        onChange={(e) => handlePointChange(index, "verseReference", e.target.value)}
                        placeholder="Bible verse reference (example: John 3:16)"
                        style={{
                          width: "100%",
                          padding: "0.55rem",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          marginBottom: "0.5rem",
                        }}
                      />

                      <textarea
                        ref={(element) => {
                          if (element) {
                            verseTextRefs.current[index] = element;
                          } else {
                            delete verseTextRefs.current[index];
                          }
                        }}
                        rows={4}
                        value={pointItem.verseText}
                        onChange={(e) => handlePointChange(index, "verseText", e.target.value)}
                        placeholder="Bible verse content"
                        style={{
                          width: "100%",
                          padding: "0.55rem",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          resize: "vertical",
                        }}
                      />

                      <div style={{ marginTop: "0.55rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleAddHighlightFromSelection(index)}
                          style={{
                            backgroundColor: "#f59e0b",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            padding: "0.4rem 0.7rem",
                            cursor: "pointer",
                          }}
                        >
                          Highlight Selected Text
                        </button>

                        <input
                          type="text"
                          value={manualHighlightInputs[index] || ""}
                          onChange={(e) =>
                            setManualHighlightInputs((prev) => ({
                              ...prev,
                              [index]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddManualHighlight(index);
                            }
                          }}
                          placeholder="Or type phrase to highlight"
                          style={{
                            flex: "1 1 240px",
                            minWidth: "200px",
                            padding: "0.5rem",
                            borderRadius: "8px",
                            border: "1px solid #d1d5db",
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => handleAddManualHighlight(index)}
                          style={{
                            backgroundColor: "#2563eb",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            padding: "0.4rem 0.7rem",
                            cursor: "pointer",
                          }}
                        >
                          Add Highlight
                        </button>
                      </div>

                      {Array.isArray(pointItem.highlights) && pointItem.highlights.length > 0 && (
                        <div style={{ marginTop: "0.55rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {pointItem.highlights.map((highlight, highlightIndex) => (
                            (() => {
                              const colorConfig = getHighlightColorConfig(highlight.color);
                              return (
                            <div
                              key={`${index}-highlight-${highlightIndex}`}
                              style={{
                                border: `1px solid ${colorConfig.border}`,
                                backgroundColor: colorConfig.cardBg,
                                borderRadius: "8px",
                                padding: "0.45rem",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 600, color: colorConfig.text }}>
                                  {highlight.text}
                                </span>
                                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveHighlight(index, highlightIndex, "up")}
                                    disabled={highlightIndex === 0}
                                    title="Move highlight up"
                                    style={{
                                      border: `1px solid ${colorConfig.border}`,
                                      backgroundColor: "white",
                                      color: colorConfig.text,
                                      borderRadius: "999px",
                                      padding: "0.2rem 0.55rem",
                                      cursor: highlightIndex === 0 ? "not-allowed" : "pointer",
                                      opacity: highlightIndex === 0 ? 0.55 : 1,
                                    }}
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveHighlight(index, highlightIndex, "down")}
                                    disabled={highlightIndex === pointItem.highlights.length - 1}
                                    title="Move highlight down"
                                    style={{
                                      border: `1px solid ${colorConfig.border}`,
                                      backgroundColor: "white",
                                      color: colorConfig.text,
                                      borderRadius: "999px",
                                      padding: "0.2rem 0.55rem",
                                      cursor: highlightIndex === pointItem.highlights.length - 1 ? "not-allowed" : "pointer",
                                      opacity: highlightIndex === pointItem.highlights.length - 1 ? 0.55 : 1,
                                    }}
                                  >
                                    Down
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveHighlight(index, highlightIndex)}
                                    title="Remove highlight"
                                    style={{
                                      border: `1px solid ${colorConfig.border}`,
                                      backgroundColor: "white",
                                      color: colorConfig.text,
                                      borderRadius: "999px",
                                      padding: "0.2rem 0.55rem",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>

                              <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.45rem", flexWrap: "wrap" }}>
                                {HIGHLIGHT_COLORS.map((colorOption) => (
                                  <button
                                    key={`${index}-${highlightIndex}-${colorOption.key}`}
                                    type="button"
                                    onClick={() => handleHighlightColorChange(index, highlightIndex, colorOption.key)}
                                    title={`Use ${colorOption.label} highlight`}
                                    style={{
                                      width: "20px",
                                      height: "20px",
                                      borderRadius: "999px",
                                      border:
                                        getHighlightColorConfig(highlight.color).key === colorOption.key
                                          ? "2px solid #111827"
                                          : "1px solid #9ca3af",
                                      backgroundColor: colorOption.markBg,
                                      cursor: "pointer",
                                      padding: 0,
                                    }}
                                  />
                                ))}
                              </div>

                              <input
                                type="text"
                                value={highlight.point || ""}
                                onChange={(e) => handleHighlightPointChange(index, highlightIndex, e.target.value)}
                                placeholder="Add point/insight for this highlighted text"
                                style={{
                                  width: "100%",
                                  marginTop: "0.45rem",
                                  padding: "0.45rem",
                                  borderRadius: "6px",
                                  border: "1px solid #d1d5db",
                                }}
                              />
                            </div>
                              );
                            })()
                          ))}
                        </div>
                      )}

                      {pointItem.verseText && Array.isArray(pointItem.highlights) && pointItem.highlights.length > 0 && (
                        <div
                          style={{
                            marginTop: "0.6rem",
                            fontSize: "0.92rem",
                            color: "#374151",
                            backgroundColor: "#ffffff",
                            border: "1px dashed #d1d5db",
                            borderRadius: "8px",
                            padding: "0.55rem",
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {renderHighlightedText(pointItem.verseText, pointItem.highlights)}
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={handleAddPoint}
                    style={{
                      backgroundColor: "#16a34a",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      padding: "0.55rem 0.8rem",
                      cursor: "pointer",
                      width: "fit-content",
                    }}
                  >
                    + Add Point
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
                  Sermon Notes
                </label>
                <textarea
                  rows={8}
                  value={formData.notes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Add your full sermon notes here..."
                  style={{
                    width: "100%",
                    padding: "0.6rem",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    backgroundColor: "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    padding: "0.6rem 1rem",
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? "Saving..." : editingId ? "Update Sermon" : "Save Sermon"}
                </button>

                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    style={{
                      backgroundColor: "#6b7280",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      padding: "0.6rem 1rem",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "1rem",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "0.75rem" }}>Saved Sermons</h2>

            <input
              type="text"
              value={savedSermonSearch}
              onChange={(e) => setSavedSermonSearch(e.target.value)}
              placeholder="Search by title, subject, or main verse"
              style={{
                width: "100%",
                padding: "0.55rem 0.65rem",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                marginBottom: "0.75rem",
              }}
            />

            {loading ? (
              <p style={{ color: "#6b7280" }}>Loading sermons...</p>
            ) : sortedSermons.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No sermons saved yet.</p>
            ) : filteredSermons.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No sermons match your search.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {filteredSermons.map((sermon) => (
                  <div
                    key={sermon.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      padding: "0.75rem",
                      backgroundColor: "#f9fafb",
                    }}
                  >
                    <h3 style={{ margin: "0 0 0.4rem 0" }}>{sermon.title}</h3>
                    {sermon.subject && (
                      <p style={{ margin: "0 0 0.45rem 0", color: "#4b5563", fontWeight: 600 }}>
                        Subject/Main Idea: {String(sermon.subject)}
                      </p>
                    )}
                    {sermon.mainBibleVerse && (
                      <p style={{ margin: "0 0 0.55rem 0", color: "#4b5563", fontWeight: 600 }}>
                        Main Bible Verse: {String(sermon.mainBibleVerse)}
                      </p>
                    )}

                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <Link
                        to={`/organization/${id}/sermon-planner/view/${sermon.id}`}
                        style={{
                          backgroundColor: "#0f766e",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          padding: "0.4rem 0.7rem",
                          cursor: "pointer",
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                        }}
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleEdit(sermon)}
                        style={{
                          backgroundColor: "#2563eb",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          padding: "0.4rem 0.7rem",
                          cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(sermon.id)}
                        style={{
                          backgroundColor: "#dc2626",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          padding: "0.4rem 0.7rem",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SermonPlanner;
