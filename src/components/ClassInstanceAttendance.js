import React, { useEffect, useState } from "react";
import { addWeeks, format, isValid, parseISO } from "date-fns";
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "react-toastify";
import { db } from "../firebase";
import { getClassInstanceLabel } from "../utils/leadOptions";
import LeadClassInstances from "./LeadClassInstances";

const ClassInstanceAttendance = ({ organizationId }) => {
  const { user } = useAuth();
  const leadsRoutePrefix = typeof window !== "undefined" && window.location?.pathname?.includes("/church/") ? "/church" : "/organization";
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState("");
  const [week, setWeek] = useState(1);
  const [roster, setRoster] = useState([]);
  const [attendanceByWeek, setAttendanceByWeek] = useState({});
  const [loadingInstances, setLoadingInstances] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [instancesError, setInstancesError] = useState("");
  const [rosterError, setRosterError] = useState("");
  const [attendanceError, setAttendanceError] = useState("");
  const [savingLeadId, setSavingLeadId] = useState(null);
  const [enrolling, setEnrolling] = useState(false);
  const instance = instances.find((entry) => entry.id === instanceId);
  const totalWeeks = Number(instance?.totalWeeks || 0);
  const showAllWeeks = week === "all";
  const validWeek = Number.isInteger(totalWeeks) && totalWeeks > 0 && (showAllWeeks || (week >= 1 && week <= totalWeeks));
  const visibleWeeks = validWeek ? (showAllWeeks ? Array.from({ length: totalWeeks }, (_unused, index) => index + 1) : [week]) : [];
  const attendance = Object.assign({}, ...visibleWeeks.map((weekNumber) => attendanceByWeek[weekNumber] || {}));
  const loading = loadingRoster || loadingAttendance;
  const startDate = parseISO(instance?.startDate || "");
  const dateForWeek = (weekNumber) => isValid(startDate) ? format(addWeeks(startDate, weekNumber - 1), "MMM d, yyyy") : "Date not set";
  const rows = [...roster, ...Object.entries(attendance)
    .filter(([leadId]) => !roster.some((lead) => lead.id === leadId))
    .map(([leadId, record]) => ({ id: leadId, name: record.name || "Former lead", email: record.email || "", phone: record.phone || "", former: true }))]
    .sort((first, second) => String(first.name || "").localeCompare(String(second.name || "")));

  useEffect(() => {
    setInstanceId("");
    setWeek(1);
    setLoadingInstances(true);
    setInstancesError("");
    return onSnapshot(doc(db, "churches", organizationId, "leadsSettings", "classInstances"), (snapshot) => {
      const list = snapshot.data()?.statusList;
      setInstances(Array.isArray(list) ? list : []);
      setLoadingInstances(false);
    }, () => {
      setInstancesError("Failed to load class instances");
      setLoadingInstances(false);
    });
  }, [organizationId]);

  useEffect(() => {
    setRoster([]);
    setRosterError("");
    if (!instance?.id) {
      setLoadingRoster(false);
      return undefined;
    }
    setLoadingRoster(true);
    return onSnapshot(query(collection(db, "churches", organizationId, "leads"), where("classInstanceId", "==", instance.id)), (snapshot) => {
      setRoster(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id })));
      setLoadingRoster(false);
    }, () => {
      setRosterError("Failed to load class roster");
      setLoadingRoster(false);
    });
  }, [organizationId, instance?.id]);

  useEffect(() => {
    setAttendanceByWeek({});
    setAttendanceError("");
    if (!instance?.id || !validWeek) {
      setLoadingAttendance(false);
      return undefined;
    }
    setLoadingAttendance(true);
    let active = true;
    const weeks = week === "all" ? Array.from({ length: totalWeeks }, (_unused, index) => index + 1) : [week];
    const pending = new Set(weeks);
    const unsubscribes = weeks.map((weekNumber) => onSnapshot(doc(db, "churches", organizationId, "leadsSettings", `classAttendance_${instance.id}_${weekNumber}`), (snapshot) => {
      if (!active) return;
      setAttendanceByWeek((previous) => ({ ...previous, [weekNumber]: snapshot.data()?.attendance || {} }));
      pending.delete(weekNumber);
      if (pending.size === 0) setLoadingAttendance(false);
    }, () => {
      if (!active) return;
      setAttendanceError("Failed to load attendance");
      setLoadingAttendance(false);
    }));
    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [organizationId, instance?.id, week, validWeek, totalWeeks]);

  const handlePresent = async (lead, present, weekNumber) => {
    if (!instance || !validWeek || !Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > totalWeeks || !user?.uid || loading || rosterError || attendanceError || savingLeadId || enrolling) return;
    const currentRecord = attendanceByWeek[weekNumber]?.[lead.id] || {};
    setSavingLeadId(`${lead.id}:${weekNumber}`);
    try {
      await setDoc(doc(db, "churches", organizationId, "leadsSettings", `classAttendance_${instance.id}_${weekNumber}`), {
        classInstanceId: instance.id,
        className: instance.name || "",
        classType: instance.classType || "",
        classInstance: { id: instance.id, name: instance.name || "", classType: instance.classType || "", startDate: instance.startDate || "", totalWeeks },
        week: weekNumber,
        attendance: {
          [lead.id]: {
            present, couponReceived: Boolean(currentRecord.couponReceived), amountPaid: Number(currentRecord.amountPaid || 0), programType: lead.programType || currentRecord.programType || "",
            name: lead.name || "", phone: lead.phone || "", email: lead.email || "",
            updatedBy: user.uid, updatedAt: serverTimestamp(),
          },
        },
      }, { merge: true });
    } catch (saveError) {
      toast.error("Failed to save attendance");
    } finally {
      setSavingLeadId(null);
    }
  };

  const handleCouponReceived = async (lead, received, weekNumber) => {
    if (!instance || !validWeek || !Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > totalWeeks || !user?.uid || loading || rosterError || attendanceError || savingLeadId || enrolling) return;
    const currentRecord = attendanceByWeek[weekNumber]?.[lead.id] || {};
    setSavingLeadId(`${lead.id}:${weekNumber}`);
    try {
      await setDoc(doc(db, "churches", organizationId, "leadsSettings", `classAttendance_${instance.id}_${weekNumber}`), {
        classInstanceId: instance.id,
        className: instance.name || "",
        classType: instance.classType || "",
        classInstance: { id: instance.id, name: instance.name || "", classType: instance.classType || "", startDate: instance.startDate || "", totalWeeks },
        week: weekNumber,
        attendance: {
          [lead.id]: {
            present: Boolean(currentRecord.present), couponReceived: received, amountPaid: 0, programType: lead.programType || currentRecord.programType || "",
            name: lead.name || "", phone: lead.phone || "", email: lead.email || "",
            updatedBy: user.uid, updatedAt: serverTimestamp(),
          },
        },
      }, { merge: true });
    } catch (saveError) {
      toast.error("Failed to save coupon receipt");
    } finally {
      setSavingLeadId(null);
    }
  };

  return (
    <section aria-labelledby="attendance-heading" className="pt-3">
      <h3 id="attendance-heading" className="h5">Attendance</h3>
      {instancesError && <p role="alert" className="text-danger">{instancesError}</p>}
      <div className="row g-3 mb-4">
        <div className="col-md-8">
          <label htmlFor="attendance-instance" className="form-label">Class instance</label>
          <select id="attendance-instance" className="form-select" value={instance ? instanceId : ""} disabled={loadingInstances || Boolean(instancesError) || Boolean(savingLeadId) || enrolling} onChange={(event) => { setInstanceId(event.target.value); setWeek(1); }}>
            <option value="">Select class instance</option>
            {[...instances].sort((first, second) => first.startDate.localeCompare(second.startDate)).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.classType}: {getClassInstanceLabel(entry)}</option>
            ))}
          </select>
        </div>
        <div className="col-md-4">
          <label htmlFor="attendance-week" className="form-label">Class week</label>
          <select id="attendance-week" className="form-select" value={week} disabled={!instance || Boolean(savingLeadId) || enrolling} onChange={(event) => setWeek(event.target.value === "all" ? "all" : Number(event.target.value))}>
            <option value="all">View All Weeks</option>
            {Array.from({ length: Number.isInteger(totalWeeks) && totalWeeks > 0 ? totalWeeks : 0 }, (_unused, index) => (
              <option key={index + 1} value={index + 1}>Week {index + 1} - {dateForWeek(index + 1)}</option>
            ))}
          </select>
        </div>
      </div>
      {instance && <LeadClassInstances key={instance.id} organizationId={organizationId} classTypes={[instance.classType]} mode="enroll" enrollmentInstance={instance} disabled={Boolean(savingLeadId)} onBusyChange={setEnrolling} />}
      {instance && !validWeek && <p role="alert">Select a valid class week.</p>}
      {instance && validWeek && (
        <>
          <h4 className="h6">{showAllWeeks ? "All Weeks" : `Week ${week} - ${dateForWeek(week)}`}</h4>
          {loading ? <p role="status">Loading attendance...</p> : rosterError || attendanceError ? (
            <p role="alert" className="text-danger">{rosterError || attendanceError}</p>
          ) : rows.length === 0 ? <p>No leads assigned to this instance.</p> : (
            <>
              <p className="small text-muted">{showAllWeeks ? `${rows.length} leads, ${totalWeeks} weeks` : `${rows.filter((lead) => attendanceByWeek[week]?.[lead.id]?.present).length} of ${rows.length} present`}</p>
              <div className="table-responsive">
                <table className="table table-sm" aria-label="Weekly class attendance">
                  <thead><tr>
                    <th scope="col">Lead</th><th scope="col">Phone</th>
                    {visibleWeeks.map((weekNumber) => <th scope="col" key={weekNumber} style={{ minWidth: showAllWeeks ? "135px" : undefined }}>{showAllWeeks ? <>Week {weekNumber}<span className="d-block text-muted small">{dateForWeek(weekNumber)}</span></> : "Present"}</th>)}
                    {showAllWeeks && <th scope="col">Present Total</th>}
                  </tr></thead>
                  <tbody>
                    {rows.map((lead) => (
                      <tr key={lead.id}>
                        <td style={{ overflowWrap: "anywhere", position: showAllWeeks ? "sticky" : undefined, left: 0, backgroundColor: "white", zIndex: 1 }}><a href={`${leadsRoutePrefix}/${organizationId}/leads?leadId=${encodeURIComponent(lead.id)}`}>{lead.name || "Unnamed lead"}</a>{lead.former && <span className="d-block text-muted small">Former assignment</span>}</td>
                        <td>{lead.phone || "Not provided"}</td>
                        {visibleWeeks.map((weekNumber) => {
                          const attendanceRecord = attendanceByWeek[weekNumber]?.[lead.id] || {};
                          const requiresCoupon = String(lead.programType || "").toLowerCase().includes("coupon");
                          const weekLabel = showAllWeeks ? `, week ${weekNumber}` : "";
                          return (
                            <td key={weekNumber}>
                              {requiresCoupon && <>
                                <label className="d-flex align-items-center gap-1 small mb-1"><input type="checkbox" className="form-check-input" aria-label={`Coupon received: ${lead.name || "Unnamed lead"}${weekLabel}`} checked={Boolean(attendanceRecord.couponReceived)} disabled={Boolean(savingLeadId) || enrolling || !user?.uid || Number(attendanceRecord.amountPaid || 0) >= 35} onChange={(event) => handleCouponReceived(lead, event.target.checked, weekNumber)} />Coupon received</label>
                                {!attendanceRecord.couponReceived && <span className={`d-block small mb-1 ${Number(attendanceRecord.amountPaid || 0) >= 35 ? "text-success" : "text-danger"}`}>{Number(attendanceRecord.amountPaid || 0) >= 35 ? "Paid $35" : "Owes $35"}</span>}
                                <span className={`d-block small mb-1 ${attendanceRecord.couponReceived || Number(attendanceRecord.amountPaid || 0) >= 35 ? "text-success" : "text-danger"}`}>{attendanceRecord.couponReceived ? "Coupon received" : Number(attendanceRecord.amountPaid || 0) >= 35 ? "Paid $35" : "Owes $35"}</span>
                              </>}
                              <label className="d-flex align-items-center gap-1"><input type="checkbox" className="form-check-input" aria-label={`Present: ${lead.name || "Unnamed lead"}${weekLabel}`} checked={Boolean(attendanceRecord.present)} disabled={Boolean(savingLeadId) || enrolling || !user?.uid} onChange={(event) => handlePresent(lead, event.target.checked, weekNumber)} />Present</label>
                              {savingLeadId === `${lead.id}:${weekNumber}` && <span className="ms-2 small" role="status">Saving...</span>}
                            </td>
                          );
                        })}
                        {showAllWeeks && <td>{visibleWeeks.filter((weekNumber) => attendanceByWeek[weekNumber]?.[lead.id]?.present).length} / {totalWeeks}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};

export default ClassInstanceAttendance;