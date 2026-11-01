import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

const FUNCTIONS_BASE_URL = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "/firebase-api"
  : "https://us-central1-igletechv1.cloudfunctions.net";

const normalizePhone = (value) => String(value || "").replace(/\D/g, "");
const formatPhone = (value) => {
  const digits = normalizePhone(value);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+${digits}`;
};

const requestPublicCheckIn = async ({ churchId, token, timeZone, payload }) => {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/publicLeadPhoneCheckIn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ churchId, token, timeZone, ...payload }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "The check-in request failed.");
  return result;
};

const PublicLeadPhoneCheckIn = () => {
  const { churchId, token } = useParams();
  const [classTypes, setClassTypes] = useState([]);
  const [classInstances, setClassInstances] = useState([]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [classType, setClassType] = useState("");
  const [classInstanceId, setClassInstanceId] = useState("");
  const [lead, setLead] = useState(null);
  const [lookupComplete, setLookupComplete] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  const availableInstances = useMemo(() => classInstances.filter((instance) => instance.classType === classType), [classInstances, classType]);
  const selectedInstance = availableInstances.find((instance) => instance.id === classInstanceId);
  const currentWeek = selectedInstance?.currentWeek;
  const phoneDigits = normalizePhone(phone);
  const canCheckIn = Boolean(lookupComplete && phoneDigits.length >= 7 && (lead || name.trim()) && selectedInstance && currentWeek?.available && confirmed && !busy);

  useEffect(() => {
    let active = true;
    requestPublicCheckIn({ churchId, token, timeZone, payload: { action: "bootstrap" } })
      .then((result) => {
        if (!active) return;
        setClassTypes(result.classTypes || []);
        setClassInstances(result.classInstances || []);
      })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [churchId, token, timeZone]);

  const handlePhoneChange = (event) => {
    setPhone(formatPhone(event.target.value));
    setLead(null);
    setLookupComplete(false);
    setConfirmed(false);
    setSuccess("");
    setError("");
  };

  const handleLookup = async () => {
    if (phoneDigits.length < 7 || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    setConfirmed(false);
    try {
      const result = await requestPublicCheckIn({ churchId, token, timeZone, payload: { action: "lookup", phone } });
      setLead(result.lead || null);
      setLookupComplete(true);
      setName("");
      setEmail("");
    } catch (lookupError) {
      setError(lookupError.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCheckIn = async (event) => {
    event.preventDefault();
    if (!canCheckIn) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await requestPublicCheckIn({
        churchId, token, timeZone,
        payload: { action: "checkIn", phone, name: name.trim(), email: email.trim(), classInstanceId, confirmed },
      });
      const status = result.alreadyPresent ? "already checked in" : "checked in";
      setSuccess(`${result.lead.name || "You"} is ${status} for ${result.className}, Week ${result.week} (${result.weekStart} - ${result.weekEnd}).`);
      setLead(result.lead);
      setConfirmed(false);
    } catch (checkInError) {
      setError(checkInError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="public-lead-checkin-page">
      <section className="public-lead-checkin-panel" aria-labelledby="public-lead-checkin-heading">
        <p className="public-lead-checkin-kicker">CLASS ATTENDANCE</p>
        <h1 id="public-lead-checkin-heading">Check in</h1>
        <p className="text-muted">Enter your phone number to find your profile and check in for class.</p>
        {loading ? <p role="status">Loading available classes...</p> : error && !classInstances.length ? <div className="alert alert-danger" role="alert">{error}</div> : (
          <form onSubmit={handleCheckIn}>
            <div className="mb-3">
              <label htmlFor="public-checkin-phone" className="form-label">Phone number</label>
              <div className="input-group">
                <input id="public-checkin-phone" type="tel" className="form-control form-control-lg" value={phone} onChange={handlePhoneChange} autoComplete="tel" placeholder="(555)123-4567" required />
                <button type="button" className="btn btn-outline-secondary" onClick={handleLookup} disabled={busy || phoneDigits.length < 7}>{busy ? "Please wait..." : "Find profile"}</button>
              </div>
            </div>

            {lookupComplete && (lead ? (
              <div className="alert alert-success" role="status"><strong>Profile found</strong><div>{lead.name || "Unnamed lead"} · {lead.phone}</div></div>
            ) : (
              <div className="row g-3 mb-3">
                <div className="col-12"><div className="alert alert-warning mb-0" role="status">No profile was found. Create your profile to continue.</div></div>
                <div className="col-md-6"><label htmlFor="public-checkin-name" className="form-label">Full name *</label><input id="public-checkin-name" className="form-control" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></div>
                <div className="col-md-6"><label htmlFor="public-checkin-email" className="form-label">Email</label><input id="public-checkin-email" type="email" className="form-control" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></div>
              </div>
            ))}

            {lookupComplete && <>
              <div className="row g-3 mb-3">
                <div className="col-md-6"><label htmlFor="public-checkin-class-type" className="form-label">Class type</label><select id="public-checkin-class-type" className="form-select form-select-lg" value={classType} onChange={(event) => { setClassType(event.target.value); setClassInstanceId(""); setConfirmed(false); }} required><option value="">Select class type</option>{classTypes.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="col-md-6"><label htmlFor="public-checkin-class" className="form-label">Class</label><select id="public-checkin-class" className="form-select form-select-lg" value={classInstanceId} onChange={(event) => { setClassInstanceId(event.target.value); setConfirmed(false); }} disabled={!classType || availableInstances.length === 0} required><option value="">Select class</option>{availableInstances.map((instance) => <option key={instance.id} value={instance.id}>{instance.name} · {instance.startDate}</option>)}</select></div>
              </div>

              {selectedInstance && (currentWeek?.available ? <>
                <p className="alert alert-info">Current class week: <strong>Week {currentWeek.week}</strong> · {currentWeek.weekStart} - {currentWeek.weekEnd}</p>
                <label className="lead-phone-checkin-confirm mb-3"><input type="checkbox" className="form-check-input" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /><span>I confirm {lead?.name || name.trim() || "this person"} is here for {selectedInstance.name}, Week {currentWeek.week}.</span></label>
              </> : <div className="alert alert-warning" role="alert">{currentWeek?.message || "This class is not available for check-in."}</div>)}

              <button type="submit" className="btn btn-danger btn-lg lead-phone-checkin-button" disabled={!canCheckIn}>{busy ? "CHECKING IN..." : "CHECK IN"}</button>
            </>}
          </form>
        )}
        {error && classInstances.length > 0 && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
        {success && <div className="alert alert-success mt-3" role="status">{success}</div>}
      </section>
    </main>
  );
};

export default PublicLeadPhoneCheckIn;
