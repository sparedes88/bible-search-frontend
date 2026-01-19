import React, { useState } from "react";
import { db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";

// Replace with your FreshBooks app's client ID
const CLIENT_ID = process.env.REACT_APP_FRESHBOOKS_CLIENT_ID;
const isLocal = window.location.hostname === "localhost";
// Replace with your FreshBooks app's redirect URI
const REDIRECT_URI = isLocal
  ? "http://localhost:3000/freshbooks/callback"
  : "https://bible-search-frontend.vercel.app/freshbooks/callback";

const FreshBooksConnect = ({ churchId }) => {
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    setSaving(true);
    setError("");
    try {
      await setDoc(doc(db, "churches", churchId), {
        freshbooksAccountId: accountId
      }, { merge: true });
      const url = `https://auth.freshbooks.com/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${churchId}`;
      window.location.href = url;
    } catch (err) {
      setError("Error saving account ID: " + err.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ margin: "2rem 0" }}>
      <h3>Connect FreshBooks</h3>
      <input
        type="text"
        placeholder="Enter FreshBooks Account ID"
        value={accountId}
        onChange={e => setAccountId(e.target.value)}
        style={{ marginRight: "1rem", padding: "0.5rem", borderRadius: 4, border: "1px solid #ccc" }}
        disabled={saving}
      />
      <button
        onClick={handleConnect}
        style={{ background: "#2d9cdb", color: "#fff", border: "none", borderRadius: 6, padding: "0.5rem 1rem", fontWeight: 500 }}
        disabled={!accountId.trim() || saving}
      >
        {saving ? "Saving..." : "Connect FreshBooks Account"}
      </button>
      {error && <div style={{ color: "red", marginTop: "1rem" }}>{error}</div>}
    </div>
  );
};

export default FreshBooksConnect;
