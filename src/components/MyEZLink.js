import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import QRCodeGenerator from "qrcode";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { db } from "../firebase";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const sanitizeSlug = (value) => {
  return normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9-\s_]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
};

const ensureHttpUrl = (value) => {
  const normalized = normalizeValue(value);
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
};

const buildDefaultSlug = (nameValue) => {
  const base = sanitizeSlug(nameValue) || "ezlink";
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${randomSuffix}`;
};

const formatTimestamp = (value) => {
  if (!value || typeof value.toDate !== "function") return "No scans yet";
  try {
    return value.toDate().toLocaleString();
  } catch {
    return "No scans yet";
  }
};

const formatShortTime = (value) => {
  if (!value || typeof value.toDate !== "function") return "—";
  try {
    return value.toDate().toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const topMetrics = (value, limit = 10) => {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter((entry) => Number.isFinite(Number(entry[1])))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit);
};

// Mini horizontal bar row
const BarRow = ({ label, count, max, color }) => {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ marginBottom: "5px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#475569", marginBottom: "2px" }}>
        <span style={{ textTransform: "capitalize" }}>{label}</span>
        <span style={{ fontWeight: 700 }}>{count}</span>
      </div>
      <div style={{ height: "6px", borderRadius: "4px", background: "#E2E8F0", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "4px", transition: "width 0.4s" }} />
      </div>
    </div>
  );
};

// 24-hour sparkline dots
const HourSparkline = ({ hourCounts }) => {
  const max = Math.max(1, ...Object.values(hourCounts || {}).map(Number).filter(Number.isFinite));
  return (
    <div style={{ display: "flex", gap: "2px", alignItems: "flex-end", height: "28px" }}>
      {Array.from({ length: 24 }, (_, h) => {
        const key = String(h).padStart(2, "0");
        const val = Number(hourCounts?.[key] || 0);
        const heightPct = max > 0 ? Math.max(3, Math.round((val / max) * 100)) : 3;
        return (
          <div
            key={key}
            title={`${key}:00 — ${val} scan${val !== 1 ? "s" : ""}`}
            style={{
              flex: 1,
              height: `${heightPct}%`,
              minHeight: "3px",
              borderRadius: "2px 2px 0 0",
              background: val > 0 ? "#3B82F6" : "#E2E8F0",
              cursor: "default",
            }}
          />
        );
      })}
    </div>
  );
};

const MyEZLink = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState([]);
  const [nameInput, setNameInput] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingKeys, setSavingKeys] = useState({});
  // slug -> array of recent hit log docs
  const [hitLogsMap, setHitLogsMap] = useState({});
  const hitLogUnsubs = useRef({});

  useEffect(() => {
    if (!id) return undefined;
    const ezLinksRef = collection(db, "churches", id, "ezlinks");
    const unsubscribe = onSnapshot(
      ezLinksRef,
      (snapshot) => {
        const nextLinks = snapshot.docs
          .map((item) => {
            const data = item.data() || {};
            return {
              id: item.id,
              slug: item.id,
              name: normalizeValue(data.name) || item.id,
              targetUrl: normalizeValue(data.targetUrl),
              isActive: data.isActive !== false,
              updatedAt: data.updatedAt || null,
              analytics: data.analytics || {},
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setLinks(nextLinks);
        setLoading(false);

        // Subscribe to hitLogs for each link automatically
        nextLinks.forEach((link) => {
          if (hitLogUnsubs.current[link.slug]) return; // already subscribed
          const logsRef = collection(db, "churches", id, "ezlinks", link.slug, "hitLogs");
          const logsQuery = query(logsRef, orderBy("createdAt", "desc"), limit(50));
          const unsub = onSnapshot(logsQuery, (snap) => {
            const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setHitLogsMap((prev) => ({ ...prev, [link.slug]: logs }));
          }, () => {});
          hitLogUnsubs.current[link.slug] = unsub;
        });
      },
      (error) => {
        console.error("Failed to load EZLinks:", error);
        setLinks([]);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
      Object.values(hitLogUnsubs.current).forEach((fn) => fn());
      hitLogUnsubs.current = {};
    };
  }, [id]);

  const appOrigin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const buildRedirectUrl = (slug) => `${appOrigin}/organization/${id}/ezlink/${slug}`;

  const handleCreateEzLink = async () => {
    const normalizedName = normalizeValue(nameInput);
    const normalizedUrl = ensureHttpUrl(urlInput);
    const normalizedSlug = sanitizeSlug(slugInput) || buildDefaultSlug(normalizedName || "ezlink");
    if (!normalizedName) { toast.error("Please enter a name for this EZLink."); return; }
    if (!normalizedUrl) { toast.error("Please enter a destination URL."); return; }
    if (!normalizedSlug) { toast.error("Could not build a valid slug. Try another name."); return; }
    setSaving(true);
    try {
      const linkRef = doc(db, "churches", id, "ezlinks", normalizedSlug);
      const existingSnap = await getDoc(linkRef);
      if (existingSnap.exists()) { toast.error("That EZLink slug already exists. Use a different slug."); return; }
      await setDoc(linkRef, { name: normalizedName, targetUrl: normalizedUrl, isActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setNameInput(""); setSlugInput(""); setUrlInput("");
      toast.success("EZLink created.");
    } catch (error) {
      console.error("Failed to create EZLink:", error);
      toast.error("Could not create EZLink.");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateField = async (link, field, value) => {
    if (!link?.slug) return;
    setSavingKeys((prev) => ({ ...prev, [link.slug]: true }));
    try {
      const linkRef = doc(db, "churches", id, "ezlinks", link.slug);
      const nextValue = field === "targetUrl" ? ensureHttpUrl(value) : value;
      if (field === "targetUrl" && !nextValue) { toast.error("Destination URL cannot be empty."); return; }
      await updateDoc(linkRef, { [field]: nextValue, updatedAt: serverTimestamp() });
      toast.success("EZLink updated.");
    } catch (error) {
      console.error("Failed to update EZLink:", error);
      toast.error("Could not update EZLink.");
    } finally {
      setSavingKeys((prev) => { const next = { ...prev }; delete next[link.slug]; return next; });
    }
  };

  const handleDeleteLink = async (link) => {
    if (!link?.slug) return;
    if (!window.confirm(`Delete EZLink "${link.name}"?`)) return;
    try {
      await deleteDoc(doc(db, "churches", id, "ezlinks", link.slug));
      toast.success("EZLink deleted.");
    } catch (error) {
      console.error("Failed to delete EZLink:", error);
      toast.error("Could not delete EZLink.");
    }
  };

  const handleCopy = async (textValue) => {
    try {
      await navigator.clipboard.writeText(textValue);
      toast.success("Copied.");
    } catch {
      toast.error("Copy failed.");
    }
  };

  const handleDownloadQrPng = async (link) => {
    if (!link?.slug) return;
    try {
      const redirectUrl = buildRedirectUrl(link.slug);
      const dataUrl = await QRCodeGenerator.toDataURL(redirectUrl, { width: 900, margin: 2, errorCorrectionLevel: "H" });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `${sanitizeSlug(link.name) || link.slug}-qr.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      toast.success("QR downloaded.");
    } catch (error) {
      console.error("Failed to download QR:", error);
      toast.error("Could not download QR.");
    }
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={false} />

      <div style={{ marginTop: "-20px" }}>
        <h1 style={commonStyles.title}>My EZLink</h1>
        <p style={{ color: "#64748B", marginTop: "6px" }}>
          Create multiple QR links and change destinations anytime without replacing the QR code.
        </p>

        {/* ── Create form ── */}
        <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", background: "#fff", padding: "14px", marginBottom: "20px" }}>
          <h3 style={{ marginTop: 0 }}>Create EZLink</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
            <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Name (example: Business Card)" style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }} />
            <input type="text" value={slugInput} onChange={(e) => setSlugInput(e.target.value)} placeholder="Custom slug (optional)" style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }} />
            <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="Destination URL" style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }} />
          </div>
          <button type="button" onClick={handleCreateEzLink} disabled={saving} style={{ marginTop: "10px", border: "none", borderRadius: "8px", padding: "10px 14px", background: "#1D4ED8", color: "#fff", cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Creating..." : "Create EZLink"}
          </button>
        </div>

        {/* ── Link cards ── */}
        {loading ? (
          <div style={{ color: "#64748B" }}>Loading EZLinks...</div>
        ) : links.length === 0 ? (
          <div style={{ color: "#64748B" }}>No EZLinks yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {links.map((link) => {
              const redirectUrl = buildRedirectUrl(link.slug);
              const isSaving = Boolean(savingKeys[link.slug]);
              const analytics = link.analytics || {};
              const totalHits = Number(analytics.totalHits || 0);
              const deviceEntries = topMetrics(analytics.deviceCounts, 5);
              const cityEntries = topMetrics(analytics.cityCounts, 8);
              const maxDevice = deviceEntries.length ? Number(deviceEntries[0][1]) : 1;
              const maxCity = cityEntries.length ? Number(cityEntries[0][1]) : 1;
              const recentLogs = hitLogsMap[link.slug] || [];

              return (
                <div key={link.slug} style={{ border: "1px solid #E2E8F0", borderRadius: "12px", background: "#fff", overflow: "hidden" }}>
                  {/* ── Top row: QR left | Analytics right ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0" }}>

                    {/* LEFT: QR + controls */}
                    <div style={{ padding: "16px", borderRight: "1px solid #F1F5F9", display: "flex", flexDirection: "column", gap: "12px", minWidth: "220px", maxWidth: "260px" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                        <QRCodeSVG value={redirectUrl} size={150} includeMargin level="H" />
                        <div style={{ fontSize: "11px", color: "#94A3B8", wordBreak: "break-all", textAlign: "center" }}>
                          {redirectUrl}
                        </div>
                      </div>

                      <input
                        type="text"
                        defaultValue={link.name}
                        onBlur={(e) => handleUpdateField(link, "name", normalizeValue(e.target.value) || link.name)}
                        style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "7px 8px", fontWeight: 700, fontSize: "13px", boxSizing: "border-box" }}
                      />

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "11px", color: "#475569", fontWeight: 700 }}>Destination URL</label>
                        <input
                          type="text"
                          defaultValue={link.targetUrl}
                          onBlur={(e) => handleUpdateField(link, "targetUrl", e.target.value)}
                          style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "7px 8px", fontSize: "12px", boxSizing: "border-box", width: "100%" }}
                        />
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#334155" }}>
                          <input type="checkbox" checked={link.isActive} onChange={(e) => handleUpdateField(link, "isActive", e.target.checked)} />
                          Active redirect
                        </label>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        <button type="button" onClick={() => handleCopy(redirectUrl)} style={{ fontSize: "11px", border: "1px solid #CBD5E1", borderRadius: "6px", padding: "5px 8px", background: "#F8FAFC", cursor: "pointer" }}>Copy Link</button>
                        <button type="button" onClick={() => handleDownloadQrPng(link)} style={{ fontSize: "11px", border: "1px solid #BBF7D0", borderRadius: "6px", padding: "5px 8px", background: "#F0FDF4", color: "#166534", cursor: "pointer" }}>Download QR</button>
                        <button type="button" onClick={() => window.open(link.targetUrl, "_blank", "noopener,noreferrer")} style={{ fontSize: "11px", border: "1px solid #BFDBFE", borderRadius: "6px", padding: "5px 8px", background: "#EFF6FF", color: "#1E40AF", cursor: "pointer" }}>Open URL</button>
                        <button type="button" onClick={() => handleDeleteLink(link)} style={{ fontSize: "11px", border: "1px solid #FECACA", borderRadius: "6px", padding: "5px 8px", background: "#FEF2F2", color: "#991B1B", cursor: "pointer" }}>Delete</button>
                      </div>
                      {isSaving && <div style={{ fontSize: "11px", color: "#64748B" }}>Saving…</div>}
                    </div>

                    {/* RIGHT: Analytics detail */}
                    <div style={{ padding: "16px", background: "#FAFBFE" }}>

                      {/* Summary row */}
                      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                        {[
                          { label: "Total Scans", value: totalHits, color: "#1D4ED8", bg: "#EFF6FF" },
                          { label: "Last Scan", value: formatTimestamp(analytics.lastHitAt), color: "#065F46", bg: "#ECFDF5", small: true },
                          { label: "Last City", value: normalizeValue(analytics.lastSeenCity) || "Unknown", color: "#7C3AED", bg: "#F5F3FF", small: true },
                          { label: "Last Country", value: normalizeValue(analytics.lastSeenCountry) || "Unknown", color: "#B45309", bg: "#FFFBEB", small: true },
                        ].map((stat) => (
                          <div key={stat.label} style={{ flex: "1 1 120px", minWidth: "100px", background: stat.bg, borderRadius: "10px", padding: "10px 12px" }}>
                            <div style={{ fontSize: "10px", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>{stat.label}</div>
                            <div style={{ fontSize: stat.small ? "13px" : "26px", fontWeight: 700, color: stat.color, lineHeight: 1.2 }}>{stat.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Mid: devices + cities + hour chart */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginBottom: "16px" }}>

                        {/* Devices */}
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>Device Type</div>
                          {deviceEntries.length === 0 ? (
                            <div style={{ fontSize: "11px", color: "#94A3B8" }}>No data yet</div>
                          ) : deviceEntries.map(([device, count]) => (
                            <BarRow key={device} label={device} count={Number(count)} max={maxDevice} color="#3B82F6" />
                          ))}
                        </div>

                        {/* Cities */}
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>Top Cities</div>
                          {cityEntries.length === 0 ? (
                            <div style={{ fontSize: "11px", color: "#94A3B8" }}>No data yet</div>
                          ) : cityEntries.map(([city, count]) => (
                            <BarRow key={city} label={city.replace(/_/g, " ")} count={Number(count)} max={maxCity} color="#8B5CF6" />
                          ))}
                        </div>

                        {/* Hour activity */}
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>Time of Day (24h)</div>
                          <HourSparkline hourCounts={analytics.hourCounts} />
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#94A3B8", marginTop: "3px" }}>
                            <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                          </div>
                          {/* Top 3 peak hours */}
                          <div style={{ marginTop: "10px" }}>
                            {topMetrics(analytics.hourCounts, 3).map(([h, c]) => (
                              <div key={h} style={{ fontSize: "11px", color: "#475569", display: "flex", justifyContent: "space-between" }}>
                                <span>{h.replace(/^0/, "")}:00{Number(h) < 12 ? " am" : " pm"}</span>
                                <strong>{c} scans</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Recent scans log */}
                      <div>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                          Recent Scans {recentLogs.length > 0 && <span style={{ color: "#94A3B8", fontWeight: 400 }}>({recentLogs.length} shown)</span>}
                        </div>
                        {recentLogs.length === 0 ? (
                          <div style={{ fontSize: "11px", color: "#94A3B8" }}>No scans recorded yet. Scan the QR code to see data here.</div>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                              <thead>
                                <tr style={{ background: "#F1F5F9" }}>
                                  {["Time", "Device", "City", "Region", "Country", "Language"].map((h) => (
                                    <th key={h} style={{ textAlign: "left", padding: "5px 8px", color: "#475569", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {recentLogs.map((log, idx) => (
                                  <tr key={log.id} style={{ background: idx % 2 === 0 ? "#fff" : "#F8FAFC", borderTop: "1px solid #F1F5F9" }}>
                                    <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#334155" }}>{formatShortTime(log.createdAt)}</td>
                                    <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                                      <span style={{ background: log.deviceType === "mobile" ? "#DBEAFE" : log.deviceType === "tablet" ? "#D1FAE5" : "#F3F4F6", color: log.deviceType === "mobile" ? "#1D4ED8" : log.deviceType === "tablet" ? "#065F46" : "#374151", borderRadius: "4px", padding: "2px 6px", textTransform: "capitalize" }}>
                                        {normalizeValue(log.deviceType) || "—"}
                                      </span>
                                    </td>
                                    <td style={{ padding: "5px 8px", color: "#334155" }}>{normalizeValue(log.city) || "—"}</td>
                                    <td style={{ padding: "5px 8px", color: "#334155" }}>{normalizeValue(log.region) || "—"}</td>
                                    <td style={{ padding: "5px 8px", color: "#334155" }}>{normalizeValue(log.country) || "—"}</td>
                                    <td style={{ padding: "5px 8px", color: "#334155" }}>{normalizeValue(log.language) || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyEZLink;
