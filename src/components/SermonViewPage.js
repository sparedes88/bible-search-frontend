import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp } from "firebase/firestore";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { db } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const renderHighlightedText = (text, highlights, pointNumberByText = new Map()) => {
  const sourceText = String(text || "");
  const normalizedHighlights = normalizeHighlights(highlights).sort((a, b) => b.text.length - a.text.length);

  if (normalizedHighlights.length === 0) {
    return sourceText;
  }

  const highlightMap = new Map(normalizedHighlights.map((item) => [item.text.toLowerCase(), item]));
  const splitter = new RegExp(`(${normalizedHighlights.map((item) => escapeRegExp(item.text)).join("|")})`, "gi");

  return sourceText.split(splitter).map((chunk, index) => {
    const matched = highlightMap.get(chunk.toLowerCase());

    if (matched) {
      const colorConfig = getHighlightColorConfig(matched.color);
      const pointNumber = pointNumberByText.get(matched.text.toLowerCase());

      return (
        <mark
          key={`hl-${index}`}
          title={matched.point || "Highlighted section"}
          style={{
            backgroundColor: colorConfig.markBg,
            padding: "0 2px",
            borderRadius: "2px",
            boxShadow: matched.point ? `inset 0 -1px 0 ${colorConfig.text}` : "none",
          }}
        >
          {chunk}
          {pointNumber ? (
            <span
              style={{
                marginLeft: "0.2rem",
                fontSize: "0.72rem",
                fontWeight: 700,
                color: colorConfig.text,
                verticalAlign: "super",
              }}
            >
              [{pointNumber}]
            </span>
          ) : null}
        </mark>
      );
    }

    return <React.Fragment key={`tx-${index}`}>{chunk}</React.Fragment>;
  });
};

const SermonViewPage = () => {
  const { id, sermonId } = useParams();
  const [sermon, setSermon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [isPreachingMode, setIsPreachingMode] = useState(false);
  const [activePointIndex, setActivePointIndex] = useState(0);
  const [feedbackEntries, setFeedbackEntries] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSuccess, setFeedbackSuccess] = useState("");
  const pdfContentRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0, active: false });
  const forcedTitleBySermonId = {
    by8O80P5mDchVrFT23dh: "Al 3er Dia",
  };
  const sermonTitle =
    forcedTitleBySermonId[String(sermonId || "")] || String(sermon?.title || "").trim() || "Al 3er Dia";

  const getNormalizedOutlinePoint = (pointItem) => {
    if (typeof pointItem === "string") {
      return {
        point: pointItem,
        verseReference: "",
        verseText: "",
        explanation: "",
        argumentation: "",
        illustration: "",
        application: "",
        highlights: [],
      };
    }

    return {
      point: pointItem?.point || "",
      verseReference: pointItem?.verseReference || "",
      verseText: pointItem?.verseText || "",
      explanation: String(pointItem?.explanation || ""),
      argumentation: String(pointItem?.argumentation || ""),
      illustration: String(pointItem?.illustration || ""),
      application: String(pointItem?.application || ""),
      highlights: normalizeHighlights(
        Array.isArray(pointItem?.highlights)
          ? pointItem.highlights
          : [pointItem?.highlightText || ""]
      ),
    };
  };

  const loadFeedback = async () => {
    if (!id || !sermonId) {
      return;
    }

    setFeedbackLoading(true);

    try {
      const feedbackRef = collection(db, "churches", id, "sermons", sermonId, "feedback");
      const feedbackQuery = query(feedbackRef, orderBy("createdAt", "desc"), limit(50));
      const snapshot = await getDocs(feedbackQuery);

      setFeedbackEntries(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );
    } catch (feedbackLoadError) {
      console.error("Error loading sermon feedback:", feedbackLoadError);
      setFeedbackError("Could not load feedback yet.");
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleSubmitFeedback = async (event) => {
    event.preventDefault();

    const trimmedNote = String(feedbackNote || "").trim();
    const trimmedName = String(feedbackName || "").trim();

    if (!trimmedNote) {
      setFeedbackError("Please leave your final note.");
      return;
    }

    if (!Number.isInteger(feedbackRating) || feedbackRating < 1 || feedbackRating > 5) {
      setFeedbackError("Please choose a rating from 1 to 5 stars.");
      return;
    }

    if (!id || !sermonId) {
      setFeedbackError("Missing sermon route information.");
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError("");
    setFeedbackSuccess("");

    try {
      await addDoc(collection(db, "churches", id, "sermons", sermonId, "feedback"), {
        name: trimmedName || "Anonymous",
        note: trimmedNote,
        rating: feedbackRating,
        churchId: id,
        sermonId,
        createdAt: serverTimestamp(),
      });

      setFeedbackName("");
      setFeedbackNote("");
      setFeedbackRating(0);
      setFeedbackSuccess("Thanks. Your note and rating were submitted.");
      await loadFeedback();
    } catch (feedbackSubmitError) {
      console.error("Error saving sermon feedback:", feedbackSubmitError);
      setFeedbackError("Could not submit feedback right now.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const formatFeedbackDate = (timestamp) => {
    if (!timestamp) {
      return "Just now";
    }

    const dateValue =
      typeof timestamp?.toDate === "function"
        ? timestamp.toDate()
        : Number.isFinite(timestamp?.seconds)
          ? new Date(timestamp.seconds * 1000)
          : null;

    if (!dateValue || Number.isNaN(dateValue.getTime())) {
      return "Just now";
    }

    return dateValue.toLocaleString();
  };

  const handleDownloadPDF = async () => {
    if (!sermon || !pdfContentRef.current || exportingPdf) {
      return;
    }

    try {
      setExportingPdf(true);

      const canvas = await html2canvas(pdfContentRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const docPdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });

      const pageWidth = docPdf.internal.pageSize.getWidth();
      const pageHeight = docPdf.internal.pageSize.getHeight();
      const margin = 22;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const renderedHeight = (canvas.height * printableWidth) / canvas.width;

      let remainingHeight = renderedHeight;
      let yPosition = margin;

      docPdf.addImage(imgData, "PNG", margin, yPosition, printableWidth, renderedHeight, undefined, "FAST");
      remainingHeight -= printableHeight;

      while (remainingHeight > 0) {
        docPdf.addPage();
        yPosition = margin - (renderedHeight - remainingHeight);
        docPdf.addImage(imgData, "PNG", margin, yPosition, printableWidth, renderedHeight, undefined, "FAST");
        remainingHeight -= printableHeight;
      }

      const fileName = `${sermonTitle.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "sermon"}.pdf`;
      docPdf.save(fileName);
    } catch (pdfError) {
      console.error("Error generating sermon PDF:", pdfError);
    } finally {
      setExportingPdf(false);
    }
  };

  const normalizedOutline = Array.isArray(sermon?.outline)
    ? sermon.outline.map((pointItem) => getNormalizedOutlinePoint(pointItem))
    : [];

  const totalPoints = normalizedOutline.length;

  const goToPreviousPoint = () => {
    setActivePointIndex((prev) => Math.max(0, prev - 1));
  };

  const goToNextPoint = () => {
    setActivePointIndex((prev) => Math.min(totalPoints - 1, prev + 1));
  };

  const handleTouchStart = (event) => {
    if (!isPreachingMode || totalPoints <= 1) {
      return;
    }

    const touch = event.touches?.[0];
    if (!touch) {
      return;
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      active: true,
    };
  };

  const handleTouchEnd = (event) => {
    if (!isPreachingMode || totalPoints <= 1 || !touchStartRef.current.active) {
      return;
    }

    const touch = event.changedTouches?.[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    touchStartRef.current.active = false;

    // Only react to intentional horizontal swipes, not vertical scrolling.
    if (absX < 50 || absY > 80 || absX <= absY) {
      return;
    }

    if (deltaX < 0) {
      goToNextPoint();
    } else {
      goToPreviousPoint();
    }
  };

  useEffect(() => {
    if (!isPreachingMode || totalPoints === 0) {
      return;
    }

    const handleKeyNavigation = (event) => {
      const key = String(event.key || "").toLowerCase();

      if (key === "arrowright" || key === "n") {
        event.preventDefault();
        goToNextPoint();
      }

      if (key === "arrowleft" || key === "p") {
        event.preventDefault();
        goToPreviousPoint();
      }
    };

    window.addEventListener("keydown", handleKeyNavigation);
    return () => window.removeEventListener("keydown", handleKeyNavigation);
  }, [isPreachingMode, totalPoints]);

  useEffect(() => {
    const loadSermon = async () => {
      if (!id || !sermonId) {
        setError("Missing sermon route information.");
        setLoading(false);
        return;
      }

      try {
        const sermonRef = doc(db, "churches", id, "sermons", sermonId);
        const sermonSnap = await getDoc(sermonRef);

        if (!sermonSnap.exists()) {
          setError("Sermon not found.");
          setSermon(null);
        } else {
          setSermon({ id: sermonSnap.id, ...sermonSnap.data() });
          setActivePointIndex(0);
          setError("");
        }
      } catch (loadError) {
        console.error("Error loading sermon:", loadError);
        setError("Could not load sermon.");
      } finally {
        setLoading(false);
      }
    };

    loadSermon();
  }, [id, sermonId]);

  useEffect(() => {
    loadFeedback();
  }, [id, sermonId]);

  const averageRating = feedbackEntries.length
    ? (feedbackEntries.reduce((total, item) => total + (Number(item.rating) || 0), 0) / feedbackEntries.length).toFixed(1)
    : "0.0";

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/sermon-planner`} style={commonStyles.backButtonLink}>
        ← Back to Sermon Planner
      </Link>
      <ChurchHeader id={id} applyShadow={false} />

      <div style={{ marginTop: "-20px", textAlign: "left" }}>
        <h1 style={{ ...commonStyles.title, textAlign: "left" }}>Sermon View</h1>

        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            padding: "1rem",
            textAlign: "left",
          }}
        >
          {loading ? (
            <p style={{ color: "#6b7280", margin: 0 }}>Loading sermon...</p>
          ) : error ? (
            <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p>
          ) : (
            <>
              <h2 style={{ marginTop: 0, marginBottom: "0.6rem", color: "#111827", textAlign: "left" }}>
                {sermonTitle}
              </h2>
              {String(sermon?.subject || "").trim() && (
                <p style={{ marginTop: "-0.15rem", marginBottom: "0.65rem", color: "#4b5563", fontWeight: 700 }}>
                  Subject / Main Idea: {String(sermon.subject)}
                </p>
              )}
              {String(sermon?.mainBibleVerse || "").trim() && (
                <p style={{ marginTop: "-0.2rem", marginBottom: "0.65rem", color: "#4b5563", fontWeight: 600 }}>
                  Main Bible Verse: {String(sermon.mainBibleVerse)}
                </p>
              )}

              <button
                type="button"
                onClick={handleDownloadPDF}
                disabled={exportingPdf}
                style={{
                  backgroundColor: "#0f766e",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.5rem 0.8rem",
                  cursor: exportingPdf ? "not-allowed" : "pointer",
                  opacity: exportingPdf ? 0.75 : 1,
                  marginBottom: "0.8rem",
                }}
              >
                {exportingPdf ? "Building PDF..." : "Download PDF"}
              </button>

              {totalPoints > 0 && (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
                  <button
                    type="button"
                    onClick={() => setIsPreachingMode((prev) => !prev)}
                    style={{
                      backgroundColor: isPreachingMode ? "#7c2d12" : "#1d4ed8",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      padding: "0.5rem 0.8rem",
                      cursor: "pointer",
                    }}
                  >
                    {isPreachingMode ? "Exit Preaching Mode" : "Start Preaching Mode"}
                  </button>

                  {isPreachingMode && (
                    <>
                      <button
                        type="button"
                        onClick={goToPreviousPoint}
                        disabled={activePointIndex === 0}
                        style={{
                          backgroundColor: "#334155",
                          color: "white",
                          border: "none",
                          borderRadius: "8px",
                          padding: "0.5rem 0.8rem",
                          cursor: activePointIndex === 0 ? "not-allowed" : "pointer",
                          opacity: activePointIndex === 0 ? 0.6 : 1,
                        }}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={goToNextPoint}
                        disabled={activePointIndex >= totalPoints - 1}
                        style={{
                          backgroundColor: "#334155",
                          color: "white",
                          border: "none",
                          borderRadius: "8px",
                          padding: "0.5rem 0.8rem",
                          cursor: activePointIndex >= totalPoints - 1 ? "not-allowed" : "pointer",
                          opacity: activePointIndex >= totalPoints - 1 ? 0.6 : 1,
                        }}
                      >
                        Next
                      </button>
                    </>
                  )}
                </div>
              )}

              <div
                ref={pdfContentRef}
                style={{ backgroundColor: "#ffffff" }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
              {totalPoints > 0 && (
                <ul style={{ margin: "0 0 0.75rem 1.1rem", color: "#1f2937", textAlign: "left" }}>
                  {(isPreachingMode
                    ? normalizedOutline
                        .map((item, index) => ({ item, index }))
                        .filter(({ index }) => index === activePointIndex)
                    : normalizedOutline.map((item, index) => ({ item, index }))
                  ).map(({ item: normalizedPoint, index }) => {

                    const highlightPoints = Array.isArray(normalizedPoint.highlights)
                      ? normalizedPoint.highlights.filter((item) => item.point)
                      : [];

                    const pointNumberByText = new Map(
                      highlightPoints.map((item, highlightIndex) => [item.text.toLowerCase(), highlightIndex + 1])
                    );

                    return (
                      <li
                        key={`${sermon?.id || "sermon"}-point-${index}`}
                        style={{
                          marginBottom: "0.65rem",
                          textAlign: "left",
                          listStyle: "none",
                          border: isPreachingMode ? "2px solid #1d4ed8" : "none",
                          borderRadius: isPreachingMode ? "12px" : 0,
                          padding: isPreachingMode ? "0.8rem" : 0,
                          backgroundColor: isPreachingMode ? "#f8fbff" : "transparent",
                        }}
                      >
                        {isPreachingMode && (
                          <p
                            style={{
                              margin: "0 0 0.6rem",
                              fontWeight: 700,
                              color: "#1e3a8a",
                              fontSize: "1rem",
                            }}
                          >
                            You are on Statement #{index + 1} of {totalPoints}
                          </p>
                        )}
                        <div
                          style={{
                            backgroundColor: "#eef2ff",
                            border: "1px solid #c7d2fe",
                            borderRadius: "8px",
                            padding: isPreachingMode ? "0.8rem 0.9rem" : "0.5rem 0.65rem",
                            marginBottom: "0.35rem",
                          }}
                        >
                          <p style={{ margin: 0, fontSize: isPreachingMode ? "0.95rem" : "0.82rem", fontWeight: 800, color: "#3730a3", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            Statement #{index + 1}
                          </p>
                          <p style={{ margin: "0.18rem 0 0", fontWeight: 700, color: "#111827", fontSize: isPreachingMode ? "2rem" : "1.02rem", lineHeight: isPreachingMode ? 1.25 : 1.45 }}>
                            {normalizedPoint.point || "No main point text"}
                          </p>
                        </div>
                        <p style={{ margin: "0.12rem 0", color: "#4b5563", fontSize: isPreachingMode ? "1.2rem" : "0.95rem", fontWeight: isPreachingMode ? 700 : 500 }}>
                          {normalizedPoint.verseReference || "No verse reference"}
                        </p>
                        {normalizedPoint.verseText && (
                          <p
                            style={{
                              margin: "0.15rem 0 0",
                              color: "#1f2937",
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                              fontSize: isPreachingMode ? "1.55rem" : "1rem",
                              lineHeight: isPreachingMode ? 1.6 : 1.45,
                            }}
                          >
                            {renderHighlightedText(normalizedPoint.verseText, normalizedPoint.highlights, pointNumberByText)}
                          </p>
                        )}
                        {(normalizedPoint.explanation || normalizedPoint.argumentation || normalizedPoint.illustration || normalizedPoint.application) && (
                          <div
                            style={{
                              marginTop: "0.4rem",
                              backgroundColor: "#f8fafc",
                              border: "1px solid #e5e7eb",
                              borderRadius: "8px",
                              padding: isPreachingMode ? "0.75rem 0.85rem" : "0.55rem 0.65rem",
                              display: "grid",
                              gap: "0.3rem",
                            }}
                          >
                            {normalizedPoint.explanation && (
                              <p style={{ margin: 0, color: "#111827", fontSize: isPreachingMode ? "1.1rem" : "0.96rem" }}>
                                <strong>1. Explanation:</strong> {normalizedPoint.explanation}
                              </p>
                            )}
                            {normalizedPoint.argumentation && (
                              <p style={{ margin: 0, color: "#111827", fontSize: isPreachingMode ? "1.1rem" : "0.96rem" }}>
                                <strong>2. Argumentation/Exegesis:</strong> {normalizedPoint.argumentation}
                              </p>
                            )}
                            {normalizedPoint.illustration && (
                              <p style={{ margin: 0, color: "#111827", fontSize: isPreachingMode ? "1.1rem" : "0.96rem" }}>
                                <strong>3. Illustration:</strong> {normalizedPoint.illustration}
                              </p>
                            )}
                            {normalizedPoint.application && (
                              <p style={{ margin: 0, color: "#111827", fontSize: isPreachingMode ? "1.1rem" : "0.96rem" }}>
                                <strong>4. Application:</strong> {normalizedPoint.application}
                              </p>
                            )}
                          </div>
                        )}
                        {highlightPoints.length > 0 && (
                          <div
                            style={{
                              marginTop: "0.45rem",
                              backgroundColor: "#fffbeb",
                              border: "1px solid #fde68a",
                              borderRadius: "8px",
                              padding: isPreachingMode ? "0.8rem 0.9rem" : "0.55rem 0.6rem",
                            }}
                          >
                            <p style={{ margin: "0 0 0.35rem", fontSize: isPreachingMode ? "1.05rem" : "0.85rem", fontWeight: 700, color: "#92400e" }}>
                              Points Linked To Highlights
                            </p>
                            <ul style={{ margin: "0 0 0.1rem 1rem", color: "#78350f", padding: 0 }}>
                              {highlightPoints.map((item, itemIndex) => (
                                (() => {
                                  const colorConfig = getHighlightColorConfig(item.color);
                                  return (
                                <li
                                  key={`${sermon?.id || "sermon"}-highlight-point-${index}-${itemIndex}`}
                                  style={{
                                    marginBottom: "0.55rem",
                                    lineHeight: 1.45,
                                    listStyle: "none",
                                    borderLeft: `4px solid ${colorConfig.border}`,
                                    backgroundColor: colorConfig.cardBg,
                                    borderRadius: "6px",
                                    padding: isPreachingMode ? "0.6rem 0.7rem" : "0.35rem 0.5rem",
                                  }}
                                >
                                  <strong style={{ color: colorConfig.text, fontSize: isPreachingMode ? "1.1rem" : "1rem" }}>Point #{itemIndex + 1}:</strong> <span style={{ fontSize: isPreachingMode ? "1.1rem" : "1rem" }}>{item.point}</span>
                                  <div style={{ marginTop: "0.12rem", fontSize: isPreachingMode ? "1.03rem" : "0.9rem", color: colorConfig.text }}>
                                    Linked highlight: {item.text}
                                  </div>
                                </li>
                                  );
                                })()
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {sermon?.notes && (
                <div
                  style={{
                    borderTop: "1px solid #e5e7eb",
                    paddingTop: "0.75rem",
                    color: "#374151",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    textAlign: "left",
                    fontSize: isPreachingMode ? "1.15rem" : "1rem",
                    lineHeight: isPreachingMode ? 1.65 : 1.45,
                  }}
                >
                  {String(sermon.notes)}
                </div>
              )}
              </div>

              <div
                style={{
                  marginTop: "1rem",
                  borderTop: "1px solid #e5e7eb",
                  paddingTop: "0.95rem",
                }}
              >
                <h3 style={{ margin: "0 0 0.35rem", color: "#111827" }}>Final Notes & 5-Star Rating</h3>
                <p style={{ margin: "0 0 0.65rem", color: "#4b5563", fontSize: "0.94rem" }}>
                  Average rating: <strong>{averageRating}</strong> / 5 ({feedbackEntries.length} review{feedbackEntries.length === 1 ? "" : "s"})
                </p>

                <form onSubmit={handleSubmitFeedback} style={{ display: "grid", gap: "0.55rem", marginBottom: "0.9rem" }}>
                  <input
                    type="text"
                    value={feedbackName}
                    onChange={(event) => setFeedbackName(event.target.value)}
                    placeholder="Your name (optional)"
                    maxLength={120}
                    style={{ border: "1px solid #d1d5db", borderRadius: "8px", padding: "0.55rem 0.7rem" }}
                  />

                  <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
                    <span style={{ color: "#374151", fontWeight: 600 }}>Final Rating:</span>
                    {[1, 2, 3, 4, 5].map((starValue) => (
                      <button
                        key={`feedback-star-${starValue}`}
                        type="button"
                        onClick={() => setFeedbackRating(starValue)}
                        aria-label={`Rate ${starValue} star${starValue === 1 ? "" : "s"}`}
                        style={{
                          border: "none",
                          background: "transparent",
                          fontSize: "1.45rem",
                          lineHeight: 1,
                          cursor: "pointer",
                          color: starValue <= feedbackRating ? "#f59e0b" : "#d1d5db",
                          padding: 0,
                        }}
                      >
                        ★
                      </button>
                    ))}
                    <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                      {feedbackRating > 0 ? `${feedbackRating}/5` : "Select rating"}
                    </span>
                  </div>

                  <textarea
                    value={feedbackNote}
                    onChange={(event) => setFeedbackNote(event.target.value)}
                    placeholder="Leave your final notes here..."
                    rows={4}
                    maxLength={2000}
                    style={{ border: "1px solid #d1d5db", borderRadius: "8px", padding: "0.65rem 0.7rem", resize: "vertical" }}
                  />

                  {feedbackError && <p style={{ margin: 0, color: "#b91c1c" }}>{feedbackError}</p>}
                  {feedbackSuccess && <p style={{ margin: 0, color: "#065f46" }}>{feedbackSuccess}</p>}

                  <button
                    type="submit"
                    disabled={feedbackSubmitting}
                    style={{
                      width: "fit-content",
                      border: "none",
                      borderRadius: "8px",
                      padding: "0.5rem 0.9rem",
                      color: "#ffffff",
                      backgroundColor: "#1d4ed8",
                      cursor: feedbackSubmitting ? "not-allowed" : "pointer",
                      opacity: feedbackSubmitting ? 0.75 : 1,
                    }}
                  >
                    {feedbackSubmitting ? "Submitting..." : "Submit Final Note"}
                  </button>
                </form>

                {feedbackLoading ? (
                  <p style={{ margin: 0, color: "#6b7280" }}>Loading feedback...</p>
                ) : feedbackEntries.length > 0 ? (
                  <div style={{ display: "grid", gap: "0.55rem" }}>
                    {feedbackEntries.map((entry) => {
                      const entryRating = Math.min(5, Math.max(0, Number(entry.rating) || 0));
                      return (
                        <div
                          key={entry.id}
                          style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                            backgroundColor: "#f8fafc",
                            padding: "0.6rem 0.7rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                            <strong style={{ color: "#111827" }}>{String(entry.name || "Anonymous")}</strong>
                            <span style={{ color: "#6b7280", fontSize: "0.86rem" }}>{formatFeedbackDate(entry.createdAt)}</span>
                          </div>
                          <p style={{ margin: "0.22rem 0", color: "#f59e0b", letterSpacing: "0.04em", fontSize: "1.08rem" }}>
                            {"★".repeat(entryRating)}
                            {"☆".repeat(5 - entryRating)}
                          </p>
                          <p style={{ margin: 0, color: "#1f2937", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                            {String(entry.note || "")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: "#6b7280" }}>No reviews yet. Be the first to leave one.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SermonViewPage;
