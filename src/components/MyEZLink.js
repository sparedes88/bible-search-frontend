import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
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

const MyEZLink = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState([]);
  const [nameInput, setNameInput] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingKeys, setSavingKeys] = useState({});

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
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        setLinks(nextLinks);
        setLoading(false);
      },
      (error) => {
        console.error("Failed to load EZLinks:", error);
        setLinks([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
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

    if (!normalizedName) {
      toast.error("Please enter a name for this EZLink.");
      return;
    }

    if (!normalizedUrl) {
      toast.error("Please enter a destination URL.");
      return;
    }

    if (!normalizedSlug) {
      toast.error("Could not build a valid slug. Try another name.");
      return;
    }

    setSaving(true);
    try {
      const linkRef = doc(db, "churches", id, "ezlinks", normalizedSlug);
      const existingSnap = await getDoc(linkRef);
      if (existingSnap.exists()) {
        toast.error("That EZLink slug already exists. Use a different slug.");
        return;
      }

      await setDoc(linkRef, {
        name: normalizedName,
        targetUrl: normalizedUrl,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNameInput("");
      setSlugInput("");
      setUrlInput("");
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

      if (field === "targetUrl" && !nextValue) {
        toast.error("Destination URL cannot be empty.");
        return;
      }

      await updateDoc(linkRef, {
        [field]: nextValue,
        updatedAt: serverTimestamp(),
      });
      toast.success("EZLink updated.");
    } catch (error) {
      console.error("Failed to update EZLink:", error);
      toast.error("Could not update EZLink.");
    } finally {
      setSavingKeys((prev) => {
        const next = { ...prev };
        delete next[link.slug];
        return next;
      });
    }
  };

  const handleDeleteLink = async (link) => {
    if (!link?.slug) return;
    if (!window.confirm(`Delete EZLink \"${link.name}\"?`)) return;

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
      const dataUrl = await QRCodeGenerator.toDataURL(redirectUrl, {
        width: 900,
        margin: 2,
        errorCorrectionLevel: "H",
      });

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

        <div style={{ border: "1px solid #E2E8F0", borderRadius: "10px", background: "#fff", padding: "14px", marginBottom: "14px" }}>
          <h3 style={{ marginTop: 0 }}>Create EZLink</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
            <input
              type="text"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Name (example: Sunday Bulletin)"
              style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }}
            />
            <input
              type="text"
              value={slugInput}
              onChange={(event) => setSlugInput(event.target.value)}
              placeholder="Custom slug (optional)"
              style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }}
            />
            <input
              type="text"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="Destination URL"
              style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "10px" }}
            />
          </div>
          <button
            type="button"
            onClick={handleCreateEzLink}
            disabled={saving}
            style={{ marginTop: "10px", border: "none", borderRadius: "8px", padding: "10px 14px", background: "#1D4ED8", color: "#fff", cursor: saving ? "not-allowed" : "pointer" }}
          >
            {saving ? "Creating..." : "Create EZLink"}
          </button>
        </div>

        {loading ? (
          <div style={{ color: "#64748B" }}>Loading EZLinks...</div>
        ) : links.length === 0 ? (
          <div style={{ color: "#64748B" }}>No EZLinks yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
            {links.map((link) => {
              const redirectUrl = buildRedirectUrl(link.slug);
              const isSaving = Boolean(savingKeys[link.slug]);

              return (
                <div key={link.slug} style={{ border: "1px solid #E2E8F0", borderRadius: "10px", background: "#fff", padding: "12px" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <QRCodeSVG value={redirectUrl} size={110} includeMargin />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <input
                        type="text"
                        defaultValue={link.name}
                        onBlur={(event) => handleUpdateField(link, "name", normalizeValue(event.target.value) || link.name)}
                        style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "8px", marginBottom: "6px", fontWeight: 700 }}
                      />
                      <div style={{ fontSize: "12px", color: "#64748B", wordBreak: "break-all" }}>{redirectUrl}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", color: "#475569", fontWeight: 700 }}>Destination URL</label>
                    <input
                      type="text"
                      defaultValue={link.targetUrl}
                      onBlur={(event) => handleUpdateField(link, "targetUrl", event.target.value)}
                      style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "8px" }}
                    />

                    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#334155" }}>
                      <input
                        type="checkbox"
                        checked={link.isActive}
                        onChange={(event) => handleUpdateField(link, "isActive", event.target.checked)}
                      />
                      Active redirect
                    </label>
                  </div>

                  <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => handleCopy(redirectUrl)} style={{ border: "1px solid #CBD5E1", borderRadius: "8px", padding: "6px 10px", background: "#F8FAFC", cursor: "pointer" }}>
                      Copy QR Link
                    </button>
                    <button type="button" onClick={() => handleDownloadQrPng(link)} style={{ border: "1px solid #BBF7D0", borderRadius: "8px", padding: "6px 10px", background: "#F0FDF4", color: "#166534", cursor: "pointer" }}>
                      Download QR
                    </button>
                    <button type="button" onClick={() => window.open(link.targetUrl, "_blank", "noopener,noreferrer")} style={{ border: "1px solid #BFDBFE", borderRadius: "8px", padding: "6px 10px", background: "#EFF6FF", color: "#1E40AF", cursor: "pointer" }}>
                      Open Destination
                    </button>
                    <button type="button" onClick={() => handleDeleteLink(link)} style={{ border: "1px solid #FECACA", borderRadius: "8px", padding: "6px 10px", background: "#FEF2F2", color: "#991B1B", cursor: "pointer" }}>
                      Delete
                    </button>
                  </div>

                  {isSaving ? <div style={{ marginTop: "6px", color: "#64748B", fontSize: "12px" }}>Saving...</div> : null}
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