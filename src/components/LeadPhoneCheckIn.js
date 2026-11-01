import React, { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { findDuplicateLead, getClassInstanceLabel } from "../utils/leadOptions";

const normalizePhone = (value) => String(value || "").replace(/\D/g, "");

const formatPhone = (value) => {
  const digits = normalizePhone(value);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+${digits}`;
};

const getCurrentClassWeek = (instance, today = new Date()) => {
  const startDate = parseISO(instance.startDate || "");
  const totalWeeks = Number(instance.totalWeeks);
  if (!isValid(startDate) || !Number.isInteger(totalWeeks) || totalWeeks < 1) {
    return { available: false, message: "This class needs a valid start date and total weeks before check-in." };
  }
  const daysFromStart = differenceInCalendarDays(today, startDate);
  if (daysFromStart < 0) {
    return { available: false, message: `This class has not started yet. Check-in opens ${format(startDate, "MMMM d, yyyy")}.` };
  }
  const week = Math.floor(daysFromStart / 7) + 1;
  if (week > totalWeeks) return { available: false, message: "This class has ended; it has no current attendance week." };
  const weekStart = addDays(startDate, (week - 1) * 7);
  return { available: true, week, weekStart, weekEnd: addDays(weekStart, 6) };
};

const LeadPhoneCheckIn = ({ leads, classTypes, classInstances, attendanceRecords, onCheckIn, disabled }) => {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [classType, setClassType] = useState("");
  const [classInstanceId, setClassInstanceId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completedKey, setCompletedKey] = useState("");

  const phoneDigits = normalizePhone(phone);
  const existingLead = useMemo(() => (
    phoneDigits.length >= 7 ? findDuplicateLead({ phone }, leads)?.lead || null : null
  ), [leads, phone, phoneDigits.length]);
  const availableClassTypes = [...new Set([
    ...classTypes,
    ...classInstances.map((instance) => instance.classType),
  ].filter(Boolean))].sort((first, second) => first.localeCompare(second));
  const matchingInstances = classInstances
    .filter((instance) => instance.classType === classType)
    .sort((first, second) => String(first.startDate || "").localeCompare(String(second.startDate || "")));
  const selectedInstance = matchingInstances.find((instance) => instance.id === classInstanceId);
  const currentWeek = selectedInstance ? getCurrentClassWeek(selectedInstance) : null;
  const weekNumber = currentWeek?.available ? currentWeek.week : 1;
  const currentAttendance = selectedInstance && currentWeek?.available && existingLead
    ? attendanceRecords.find((record) => record.id === `classAttendance_${selectedInstance.id}_${weekNumber}`)?.attendance?.[existingLead.id]
    : null;
  const checkInKey = `${existingLead?.id || phoneDigits}:${classInstanceId}:${weekNumber}`;
  const alreadyPresent = Boolean(currentAttendance?.present || completedKey === checkInKey);
  const checkInName = existingLead?.name || name.trim();
  const canCheckIn = Boolean(
    phoneDigits.length >= 7
    && classType
    && selectedInstance
    && currentWeek?.available
    && (existingLead || name.trim())
    && confirmed
    && !disabled
    && !saving
    && !alreadyPresent
  );

  const handlePhoneChange = (event) => {
    setPhone(formatPhone(event.target.value));
    setConfirmed(false);
    setCompletedKey("");
  };

  const handleCheckIn = async (event) => {
    event.preventDefault();
    if (!canCheckIn) return;
    setSaving(true);
    const success = await onCheckIn({
      lead: existingLead,
      phone,
      name: checkInName,
      email: existingLead?.email || email.trim(),
      classInstance: selectedInstance,
      week: weekNumber,
    });
    setSaving(false);
    if (success) {
      setCompletedKey(checkInKey);
      setConfirmed(false);
    }
  };

  return (
    <section className="lead-phone-checkin" aria-labelledby="lead-phone-checkin-heading">
      <h3 id="lead-phone-checkin-heading">Phone Check-in</h3>
      <p className="text-muted">Find the lead by phone, choose their class, confirm they are here, then check them in.</p>
      {!disabled && <form onSubmit={handleCheckIn}>
        <div className="row g-3">
          <div className="col-12">
            <label htmlFor="lead-phone-checkin-phone" className="form-label">Phone number</label>
            <input id="lead-phone-checkin-phone" type="tel" className="form-control form-control-lg" value={phone} onChange={handlePhoneChange} autoComplete="tel" placeholder="(555)123-4567" required />
          </div>

          {phoneDigits.length >= 7 && (existingLead ? (
            <div className="col-12">
              <div className="alert alert-success mb-0" role="status">
                <strong>Lead found</strong>
                <div>{existingLead.name || "Unnamed lead"} · {existingLead.phone}</div>
                {existingLead.email && <div>{existingLead.email}</div>}
              </div>
            </div>
          ) : (
            <div className="col-12">
              <div className="alert alert-warning mb-0" role="status">No lead found for this phone. Create a lead profile to continue check-in.</div>
              <div className="row g-3 mt-0">
                <div className="col-md-6">
                  <label htmlFor="lead-phone-checkin-name" className="form-label">Lead name *</label>
                  <input id="lead-phone-checkin-name" className="form-control" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
                </div>
                <div className="col-md-6">
                  <label htmlFor="lead-phone-checkin-email" className="form-label">Email</label>
                  <input id="lead-phone-checkin-email" type="email" className="form-control" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                </div>
              </div>
            </div>
          ))}

          <div className="col-md-6">
            <label htmlFor="lead-phone-checkin-class-type" className="form-label">Class type</label>
            <select id="lead-phone-checkin-class-type" className="form-select" value={classType} onChange={(event) => { setClassType(event.target.value); setClassInstanceId(""); setConfirmed(false); setCompletedKey(""); }} required>
              <option value="">Select class type</option>
              {availableClassTypes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="col-md-6">
            <label htmlFor="lead-phone-checkin-instance" className="form-label">Class</label>
            <select id="lead-phone-checkin-instance" className="form-select" value={classInstanceId} onChange={(event) => { setClassInstanceId(event.target.value); setConfirmed(false); setCompletedKey(""); }} disabled={!classType || matchingInstances.length === 0} required>
              <option value="">Select class</option>
              {matchingInstances.map((instance) => <option key={instance.id} value={instance.id}>{getClassInstanceLabel(instance)}</option>)}
            </select>
          </div>

          {selectedInstance && (
            <div className="col-12">
              {!currentWeek?.available ? (
                <div className="alert alert-warning mb-0" role="alert">{currentWeek?.message}</div>
              ) : alreadyPresent ? (
                <div className="alert alert-info mb-0" role="status">{checkInName || "This lead"} is already marked present for Week {weekNumber}.</div>
              ) : (
                <>
                  <p className="alert alert-info mb-2" role="status">
                    Current class week: <strong>Week {weekNumber}</strong> · {format(currentWeek.weekStart, "MMM d")} - {format(currentWeek.weekEnd, "MMM d, yyyy")}
                  </p>
                  <label className="lead-phone-checkin-confirm">
                    <input type="checkbox" className="form-check-input" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={disabled || saving} />
                    <span>I confirm {checkInName || "this lead"} is here for {selectedInstance.name || classType}, Week {weekNumber} ({format(currentWeek.weekStart, "MMM d")} - {format(currentWeek.weekEnd, "MMM d, yyyy")}).</span>
                  </label>
                </>
              )}
            </div>
          )}

          <div className="col-12">
            <button type="submit" className="btn btn-danger btn-lg lead-phone-checkin-button" disabled={!canCheckIn}>
              {saving ? "CHECKING IN..." : alreadyPresent ? "ALREADY CHECKED IN" : "CHECK IN"}
            </button>
            {disabled && <p className="small text-danger mt-2 mb-0" role="alert">Sign in to record attendance.</p>}
          </div>
        </div>
      </form>}
      {disabled && <p className="alert alert-warning">Sign in to record attendance.</p>}
    </section>
  );
};

export default LeadPhoneCheckIn;