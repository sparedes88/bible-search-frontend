import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

const normalizeValue = (value) => (value === null || value === undefined ? "" : String(value).trim());

const ensureHttpUrl = (value) => {
  const normalized = normalizeValue(value);
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
};

const EzLinkRedirect = () => {
  const { id, slug } = useParams();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Redirecting...");

  useEffect(() => {
    const runRedirect = async () => {
      if (!id || !slug) {
        setStatus("error");
        setMessage("Missing EZLink information.");
        return;
      }

      try {
        const linkRef = doc(db, "churches", id, "ezlinks", slug);
        const linkSnap = await getDoc(linkRef);

        if (!linkSnap.exists()) {
          setStatus("error");
          setMessage("This EZLink was not found.");
          return;
        }

        const data = linkSnap.data() || {};
        if (data.isActive === false) {
          setStatus("error");
          setMessage("This EZLink is currently disabled.");
          return;
        }

        const nextUrl = ensureHttpUrl(data.targetUrl);
        if (!nextUrl) {
          setStatus("error");
          setMessage("This EZLink has no destination configured.");
          return;
        }

        setStatus("redirecting");
        setMessage("Redirecting now...");
        window.location.replace(nextUrl);
      } catch (error) {
        console.error("Failed to resolve EZLink redirect:", error);
        setStatus("error");
        setMessage("Could not complete redirect.");
      }
    };

    runRedirect();
  }, [id, slug]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "20px",
        background: "linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: "12px",
          padding: "20px",
          textAlign: "center",
        }}
      >
        <h1 style={{ marginTop: 0, color: "#1E293B" }}>My EZLink</h1>
        <p style={{ color: "#475569" }}>{message}</p>
        {status === "error" ? (
          <Link to={`/organization/${id}/mi-organizacion`} style={{ color: "#1D4ED8", fontWeight: 700 }}>
            Go to organization
          </Link>
        ) : null}
      </div>
    </div>
  );
};

export default EzLinkRedirect;