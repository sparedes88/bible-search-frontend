import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { getChurchData } from "../api/church";

const QR_LOOKUP_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/getMemberQrByPhone";
const COMMITMENT_SUMMARY_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/getMemberCommitmentSummary";

const PublicQRLookup = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const qrCanvasRef = useRef(null);
  const [church, setChurch] = useState(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showScannerAccess, setShowScannerAccess] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [commitmentTasks, setCommitmentTasks] = useState(null);
  const [loadingCommitment, setLoadingCommitment] = useState(false);

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
      fetchCommitmentSummary(data.uid);
    } catch (fetchError) {
      console.error("QR lookup error:", fetchError);
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchCommitmentSummary = async (uid) => {
    setLoadingCommitment(true);
    setCommitmentTasks(null);
    try {
      const response = await fetch(
        `${COMMITMENT_SUMMARY_FUNCTION_URL}?churchId=${encodeURIComponent(id)}&uid=${encodeURIComponent(uid)}`
      );
      const data = await response.json();
      if (response.ok && data.success) {
        setCommitmentTasks(data.tasks.filter((t) => t.configured));
      }
    } catch (commitmentError) {
      console.error("Commitment summary error:", commitmentError);
    } finally {
      setLoadingCommitment(false);
    }
  };

  const getQrImageBlob = () =>
    new Promise((resolve) => {
      const canvas = qrCanvasRef.current;
      if (!canvas) return resolve(null);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });

  // Contact photos get aggressively zoom-cropped to a circle/square by different
  // iOS/Android Contacts apps (often beyond just a simple inscribed-circle crop),
  // so keep the QR code small and centered with a very generous white margin
  // to guarantee its corner finder patterns always survive the crop.
  // The QR is drawn at its native size (no rescale) to avoid corrupting modules.
  const getPaddedQrCanvas = () => {
    const sourceCanvas = qrCanvasRef.current;
    if (!sourceCanvas) return null;

    const outputSize = 600;
    const qrDrawSize = sourceCanvas.width; // native size, drawn 1:1 to avoid resampling artifacts
    const offset = (outputSize - qrDrawSize) / 2;

    const paddedCanvas = document.createElement("canvas");
    paddedCanvas.width = outputSize;
    paddedCanvas.height = outputSize;
    const ctx = paddedCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outputSize, outputSize);
    ctx.drawImage(sourceCanvas, offset, offset);
    return paddedCanvas;
  };

  const handleSaveImage = async () => {
    setSaveMessage("");
    const blob = await getQrImageBlob();
    if (!blob) return;

    const fileName = `${(church?.name || "my-qr-code").replace(/[^a-z0-9]+/gi, "-")}.png`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setSaveMessage("Saved! Check your device's downloads or photos.");
  };

  const handleShareImage = async () => {
    setSaveMessage("");
    const blob = await getQrImageBlob();
    if (!blob) return;

    const fileName = `${(church?.name || "my-qr-code").replace(/[^a-z0-9]+/gi, "-")}.png`;
    const file = new File([blob], fileName, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "My Check-in QR Code" });
      } catch (shareError) {
        // User cancelled the share sheet; nothing to do.
      }
    } else {
      handleSaveImage();
    }
  };

  const handleSaveAsContact = () => {
    setSaveMessage("");
    const paddedCanvas = getPaddedQrCanvas();
    if (!paddedCanvas) return;

    // Embed the padded QR code as the contact's photo so it shows up right in Contacts.
    const base64Photo = paddedCanvas.toDataURL("image/png").split(",")[1];
    const organization = church?.name || "";
    const contactName = `${organization} ${result?.name || ""}`.trim() || "My QR Code";

    const vCardLines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:;${contactName};;;`,
      `FN:${contactName}`,
      organization ? `ORG:${organization}` : null,
      `NOTE:Check-in QR code ID ${result?.uid || ""}`,
      `PHOTO;ENCODING=b;TYPE=PNG:${base64Photo}`,
      "END:VCARD",
    ].filter(Boolean);

    const blob = new Blob([vCardLines.join("\r\n")], { type: "text/vcard" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${contactName.replace(/[^a-z0-9]+/gi, "-")}.vcf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setSaveMessage("Contact card downloaded — open it and tap \"Add to Contacts\" to save the QR code as a contact photo.");
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
        .qr-lookup-result svg,
        .qr-lookup-result canvas {
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
          background-color: #4F46E5;
          color: white;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
        }
        .qr-lookup-share-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          margin-top: 10px;
          padding: 12px;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background-color: white;
          color: #374151;
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
        .qr-lookup-save-message {
          color: #16a34a;
          margin-top: 10px;
          text-align: center;
          font-size: 13px;
        }
        .qr-commitment-task {
          padding: 14px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .qr-commitment-task:last-child {
          border-bottom: none;
        }
        .qr-commitment-task-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }
        .qr-commitment-task-title {
          font-weight: 600;
          font-size: 14px;
          color: #374151;
        }
        .qr-commitment-badge {
          display: inline-block;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }
        .qr-commitment-badge-faithful { background: #dcfce7; color: #16a34a; }
        .qr-commitment-badge-committed { background: #fef3c7; color: #b45309; }
        .qr-commitment-badge-too-early-to-evaluate,
        .qr-commitment-badge-not-started { background: #f3f4f6; color: #6b7280; }
        .qr-commitment-meter-track {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: #f3f4f6;
          overflow: hidden;
        }
        .qr-commitment-meter-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        .qr-commitment-meter-faithful { background: #16a34a; }
        .qr-commitment-meter-committed { background: #f59e0b; }
        .qr-commitment-meter-too-early-to-evaluate,
        .qr-commitment-meter-not-started { background: #9ca3af; }
        .qr-commitment-meter-caption {
          margin: 6px 0 0;
          font-size: 12px;
          color: #6b7280;
        }
        .qr-commitment-feedback {
          margin: 8px 0 2px;
          font-size: 13px;
          color: #374151;
        }
        .qr-commitment-verse {
          margin: 0;
          font-size: 12px;
          font-style: italic;
          color: #4F46E5;
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
            <QRCodeCanvas ref={qrCanvasRef} value={result.uid} size={260} level="H" includeMargin />
            {result.name && (
              <p style={{ marginTop: "12px", fontSize: "15px", color: "#374151" }}>{result.name}</p>
            )}
            <p style={{ fontSize: "12px", color: "#9ca3af" }}>ID: {result.uid}</p>
            <button type="button" onClick={handleSaveAsContact} className="qr-lookup-wallet-btn">
              👤 Save as Contact (iPhone &amp; Android)
            </button>
            <button type="button" onClick={handleSaveImage} className="qr-lookup-share-btn">
              📷 Save QR Code Image
            </button>
            <button type="button" onClick={handleShareImage} className="qr-lookup-share-btn">
              📤 Share
            </button>
            {saveMessage && <p className="qr-lookup-save-message">{saveMessage}</p>}
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

      {result && (
        <div className="qr-lookup-card" style={{ marginTop: "16px" }}>
          <h2 className="qr-lookup-title" style={{ marginBottom: "4px" }}>My Faithful Commitment</h2>
          <p className="qr-lookup-subtitle">How you're doing on each check-in task, with a little encouragement.</p>

          {loadingCommitment && <p style={{ textAlign: "center", color: "#6b7280", fontSize: "14px" }}>Loading...</p>}

          {!loadingCommitment && commitmentTasks && commitmentTasks.length === 0 && (
            <p style={{ textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>
              No check-in tasks are set up for this organization yet.
            </p>
          )}

          {!loadingCommitment && commitmentTasks && commitmentTasks.map((task) => (
            <div key={task.taskId} className="qr-commitment-task">
              <div className="qr-commitment-task-header">
                <span className="qr-commitment-task-title">{task.title}</span>
                <span className={`qr-commitment-badge qr-commitment-badge-${task.level.replace(/\s+/g, "-").toLowerCase()}`}>
                  {task.level}
                </span>
              </div>
              <div className="qr-commitment-meter-track">
                <div
                  className={`qr-commitment-meter-fill qr-commitment-meter-${task.level.replace(/\s+/g, "-").toLowerCase()}`}
                  style={{ width: `${Math.round(task.attendanceRate * 100)}%` }}
                />
              </div>
              <p className="qr-commitment-meter-caption">
                {task.attendedCount} / {task.expectedSessions} expected sessions ({Math.round(task.attendanceRate * 100)}%)
                {task.avgGapDays !== null && ` · avg. ${task.avgGapDays}d between check-ins`}
              </p>
              <p className="qr-commitment-feedback">{task.feedback.message}</p>
              <p className="qr-commitment-verse">{task.feedback.verse}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PublicQRLookup;
