import React, { Suspense, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import ChurchHeader from "../components/ChurchHeader";
import commonStyles from "./commonStyles";

const QR_LOOKUP_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/getMemberQrByPhone";

const PublicQRLookup = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setResult(null);

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setError("Please enter a valid phone number.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(QR_LOOKUP_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ churchId: id, phone: digits }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "No member found with that phone number.");
        return;
      }

      setResult(data);
    } catch (fetchError) {
      console.error("QR lookup error:", fetchError);
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        ...commonStyles.fullWidthContainer,
        minHeight: "100vh",
        paddingBottom: "40px",
      }}
    >
      <div style={{ padding: "12px 16px" }}>
        <button onClick={() => navigate(`/organization/${id}/login`)} style={commonStyles.backButton}>
          ⬅ Back
        </button>
      </div>

      {id && (
        <Suspense fallback={<div style={{ minHeight: 120 }} />}>
          <ChurchHeader id={id} applyShadow={false} />
        </Suspense>
      )}

      <div
        style={{
          maxWidth: "420px",
          margin: "24px auto",
          padding: "24px",
          backgroundColor: "white",
          borderRadius: "12px",
          boxShadow: "0 1px 6px rgba(0,0,0,0.1)",
        }}
      >
        <h2 style={{ textAlign: "center", marginBottom: "8px", color: "#374151" }}>
          Get My QR Code
        </h2>
        <p style={{ textAlign: "center", color: "#6b7280", marginBottom: "20px", fontSize: "14px" }}>
          Enter the phone number on your profile to retrieve your check-in QR code.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <input
            type="tel"
            placeholder="Phone Number"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            style={{
              padding: "10px 12px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "16px",
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 12px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#4F46E5",
              color: "white",
              fontSize: "15px",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Searching..." : "Get My QR Code"}
          </button>
        </form>

        {error && (
          <p style={{ color: "#dc2626", marginTop: "16px", textAlign: "center", fontSize: "14px" }}>
            {error}
          </p>
        )}

        {result && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: "24px",
              paddingTop: "20px",
              borderTop: "1px solid #e5e7eb",
            }}
          >
            <QRCodeSVG value={result.uid} size={180} level="H" />
            {result.name && (
              <p style={{ marginTop: "12px", fontSize: "15px", color: "#374151" }}>{result.name}</p>
            )}
            <p style={{ fontSize: "12px", color: "#9ca3af" }}>ID: {result.uid}</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate(`/organization/${id}/track-me`)}
          style={{
            display: "block",
            width: "100%",
            marginTop: "24px",
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px solid #4F46E5",
            backgroundColor: "white",
            color: "#4F46E5",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          Open QR Scanner (staff login required)
        </button>
      </div>
    </div>
  );
};

export default PublicQRLookup;
