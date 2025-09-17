import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";

// Replace with your FreshBooks app's client ID and secret
const CLIENT_ID = process.env.REACT_APP_FRESHBOOKS_CLIENT_ID;
const CLIENT_SECRET = process.env.REACT_APP_FRESHBOOKS_CLIENT_SECRET;
const REDIRECT_URI = "https://bible-search-frontend.vercel.app/freshbooks/callback";
const CLOUD_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/freshbooksToken";

const FreshBooksCallback = () => {
  const [status, setStatus] = useState("Processing...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state"); // churchId
    console.log("FreshBooks OAuth callback params:", { code, state });
    if (!code) {
      setStatus("No code found in URL.");
      return;
    }
    setStatus("Exchanging code for token...");
    // Exchange code for access token via Cloud Function
    fetch(CLOUD_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    })
      .then(res => {
        if (!res.ok) throw new Error("Network response was not ok: " + res.status);
        return res.json();
      })
      .then(data => {
        console.log("FreshBooks token response:", data);
        if (data.access_token) {
          setStatus("FreshBooks account connected! Token saved.");
          // Save token to Firestore for this church
          const churchId = state;
          setDoc(doc(db, "churches", churchId), {
            freshbooksToken: data.access_token,
            freshbooksRefresh: data.refresh_token,
            freshbooksExpires: data.expires_in,
            freshbooksAccountId: data.account_id || (data.response && data.response.account_id),
            freshbooksConnected: true,
          }, { merge: true })
            .then(() => {
              setStatus("Token saved for church: " + churchId);
            })
            .catch(err => {
              setStatus("Error saving token: " + err.message);
            });
        } else {
          setStatus("Failed to get access token: " + JSON.stringify(data));
        }
      })
      .catch(err => {
        setStatus("Error: " + err.message);
        console.error("FreshBooks token exchange error:", err);
      });
  }, []);

  return (
    <div style={{ margin: "2rem" }}>
      <h3>FreshBooks OAuth Callback</h3>
      <div>{status}</div>
    </div>
  );
};

export default FreshBooksCallback;
