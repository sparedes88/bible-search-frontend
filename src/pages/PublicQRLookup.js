import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { getChurchData } from "../api/church";

const QR_LOOKUP_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/getMemberQrByPhone";
const APPLE_WALLET_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/generateAppleWalletPass";

const PublicQRLookup = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showScannerAccess, setShowScannerAccess] = useState(false);
  const [walletError, setWalletError] = useState("");

  useEffect(() => {
    let isMounted = true;
    if (id) {
      getChurchData(id).then((data) => {
        if (isMounted) setChurch(data);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [id]);

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

  const handleAddToWallet = async () => {
    if (!result?.uid) return;
    setWalletError("");

    const walletUrl = `${APPLE_WALLET_FUNCTION_URL}?churchId=${encodeURIComponent(id)}&uid=${encodeURIComponent(result.uid)}`;
    try {
      // Probe for configuration errors first so we can show a friendly message
      // instead of letting the browser download a JSON error as a broken .pkpass file.
      const response = await fetch(walletUrl);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setWalletError(data.error || "Apple Wallet is not available right now.");
        return;
      }
      window.location.href = walletUrl;
    } catch (walletFetchError) {
      console.error("Add to Apple Wallet error:", walletFetchError);
      setWalletError("Could not reach the server. Please try again.");
    }
  };

  return (
    <div className="qr-lookup-page">
      <style>{`
        .qr-lookup-page {
          min-height: 100vh;
          background: linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%);
          padding: 16px;
          box-sizing: border-box;
        }
        .qr-lookup-back {
          background: none;
          border: none;
          color: #4F46E5;
          font-size: 15px;
          cursor: pointer;
          padding: 8px 4px;
        }
        .qr-lookup-logo-wrap {
          display: flex;
          justify-content: center;
          margin: 12px 0 20px;
        }
        .qr-lookup-logo-circle {
          width: clamp(144px, 48vw, 208px);
          height: clamp(144px, 48vw, 208px);
          border-radius: 50%;
          background: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          box-sizing: border-box;
          overflow: hidden;
        }
        .qr-lookup-logo {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .qr-lookup-card {
          width: 100%;
          max-width: 420px;
          margin: 0 auto;
          padding: clamp(16px, 5vw, 28px);
          background-color: white;
          border-radius: 12px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.1);
          box-sizing: border-box;
        }
        .qr-lookup-title {
          text-align: center;
          margin-bottom: 6px;
          color: #374151;
          font-size: clamp(18px, 5vw, 22px);
        }
        .qr-lookup-org-name {
          text-align: center;
          color: #4F46E5;
          font-weight: 600;
          font-size: clamp(14px, 4vw, 16px);
          margin-bottom: 4px;
        }
        .qr-lookup-subtitle {
          text-align: center;
          color: #6b7280;
          margin-bottom: 20px;
          font-size: 14px;
        }
        .qr-lookup-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .qr-lookup-input {
          padding: 12px;
          border-radius: 6px;
          border: 1px solid #d1d5db;
          font-size: 16px;
          width: 100%;
          box-sizing: border-box;
        }
        .qr-lookup-submit {
          padding: 12px;
          border-radius: 6px;
          border: none;
          background-color: #4F46E5;
          color: white;
          font-size: 15px;
          cursor: pointer;
          width: 100%;
        }
        .qr-lookup-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .qr-lookup-error {
          color: #dc2626;
          margin-top: 16px;
          text-align: center;
          font-size: 14px;
        }
        .qr-lookup-result {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
        }
        .qr-lookup-result svg {
          width: clamp(140px, 55vw, 200px) !important;
          height: clamp(140px, 55vw, 200px) !important;
        }
        .qr-lookup-scanner-btn {
          display: block;
          width: 100%;
          margin-top: 24px;
          padding: 12px;
          border-radius: 6px;
          border: 1px solid #4F46E5;
          background-color: white;
          color: #4F46E5;
          font-size: 14px;
          cursor: pointer;
        }
        .qr-lookup-wallet-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          margin-top: 16px;
          padding: 12px;
          border-radius: 8px;
          border: none;
          background-color: #000;
          color: white;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
        }
        .qr-lookup-wallet-error {
          color: #dc2626;
          margin-top: 10px;
          text-align: center;
          font-size: 13px;
        }
      `}</style>

      <button className="qr-lookup-back" onClick={() => navigate(`/organization/${id}/login`)}>
        ⬅ Back
      </button>

      {church?.logo && (
        <div className="qr-lookup-logo-wrap">
          {/* Triple-click the logo to reveal the staff scanner shortcut */}
          <div
            className="qr-lookup-logo-circle"
            onClick={(event) => {
              if (event.detail === 3) setShowScannerAccess(true);
            }}
          >
            <img src={church.logo} alt={`${church.name || "Organization"} logo`} className="qr-lookup-logo" />
          </div>
        </div>
      )}

      <div className="qr-lookup-card">
        <h2 className="qr-lookup-title">Get My QR Code</h2>
        {church?.name && <p className="qr-lookup-org-name">{church.name}</p>}
        <p className="qr-lookup-subtitle">
          Enter the phone number on your profile to retrieve your check-in QR code.
        </p>

        <form onSubmit={handleSubmit} className="qr-lookup-form">
          <input
            type="tel"
            placeholder="Phone Number"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            className="qr-lookup-input"
          />
          <button type="submit" disabled={loading} className="qr-lookup-submit">
            {loading ? "Searching..." : "Get My QR Code"}
          </button>
        </form>

        {error && <p className="qr-lookup-error">{error}</p>}

        {result && (
          <div className="qr-lookup-result">
            <QRCodeSVG value={result.uid} level="H" />
            {result.name && (
              <p style={{ marginTop: "12px", fontSize: "15px", color: "#374151" }}>{result.name}</p>
            )}
            <p style={{ fontSize: "12px", color: "#9ca3af" }}>ID: {result.uid}</p>
            <button type="button" onClick={handleAddToWallet} className="qr-lookup-wallet-btn">
              🍎 Add to Apple Wallet
            </button>
            {walletError && <p className="qr-lookup-wallet-error">{walletError}</p>}
          </div>
        )}

        {showScannerAccess && (
          <button
            type="button"
            onClick={() => navigate(`/organization/${id}/track-me`)}
            className="qr-lookup-scanner-btn"
          >
            Open QR Scanner (staff login required)
          </button>
        )}
      </div>
    </div>
  );
};

export default PublicQRLookup;
