import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

// Resolves a short code like /b/AB12 to its full broadcast URL.
const BroadcastShortLink = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const resolveCode = async () => {
      const normalized = String(code || "").trim();
      if (!normalized) {
        setError("No broadcast code was provided.");
        return;
      }

      try {
        // Codes are stored uppercase, but people type them however they like.
        let snapshot = await getDoc(doc(db, "broadcastLinks", normalized.toUpperCase()));
        if (!snapshot.exists() && normalized !== normalized.toUpperCase()) {
          snapshot = await getDoc(doc(db, "broadcastLinks", normalized));
        }
        if (cancelled) return;

        if (!snapshot.exists()) {
          setError("That broadcast code was not found.");
          return;
        }

        const { churchId, broadcastId } = snapshot.data() || {};
        if (!churchId || !broadcastId) {
          setError("That broadcast code is no longer valid.");
          return;
        }

        navigate(`/church/${churchId}/broadcast/${broadcastId}`, { replace: true });
      } catch (err) {
        console.error("Failed to resolve broadcast code:", err);
        if (!cancelled) setError("Could not open that broadcast. Please try again.");
      }
    };

    resolveCode();
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "24px",
        fontFamily: "'Nunito', sans-serif",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.4rem", marginBottom: "8px" }}>
          {error ? "Broadcast not found" : "Opening broadcast..."}
        </h1>
        <p style={{ color: "#6b7280" }}>{error || `Code ${String(code || "").toUpperCase()}`}</p>
      </div>
    </div>
  );
};

export default BroadcastShortLink;
