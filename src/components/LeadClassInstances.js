import React, { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import CreatableSelect from "react-select/creatable";
import { FaUserMinus } from "react-icons/fa";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "react-toastify";
import { db } from "../firebase";
import { EMPTY_LEAD_FORM, findDuplicateLead, formatLeadDisplayValue, getClassInstanceLabel, getDefaultLeadOptions, getLeadClassAssignment, getLeadLocation, isValidClassInstance, LEAD_DETAIL_LISTS } from "../utils/leadOptions";
import LeadDetailFields from "./LeadDetailFields";

const EMPTY_INSTANCE = { name: "", classType: "", startDate: "", totalWeeks: "", programAssignments: [] };

const LeadClassInstances = ({ organizationId, classTypes, mode = "roster", enrollmentInstance = null, disabled = false, onBusyChange }) => {
  const { user } = useAuth();
  const leadsRoutePrefix = typeof window !== "undefined" && window.location?.pathname?.includes("/church/") ? "/church" : "/organization";
  const [instances, setInstances] = useState([]);
  const [form, setForm] = useState(EMPTY_INSTANCE);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [assignedLeads, setAssignedLeads] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [availableLeads, setAvailableLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [removingLeadId, setRemovingLeadId] = useState(null);
  const [newLead, setNewLead] = useState(null);
  const [leadSearch, setLeadSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [leadSettings, setLeadSettings] = useState(getDefaultLeadOptions);
  const [availableProgramTypes, setAvailableProgramTypes] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const hasNewLead = Boolean(newLead);
  const busy = disabled || saving || assigning || creating || Boolean(removingLeadId);
  const selectedInstance = enrollmentInstance || instances.find((instance) => instance.id === selectedInstanceId);
  const assignmentInstances = enrollmentInstance ? [enrollmentInstance] : instances;
  const duplicateMatch = newLead ? findDuplicateLead(newLead, availableLeads) : null;
  const candidateLeads = availableLeads.filter((lead) => lead.classInstanceId !== selectedInstance?.id);
  const leadOptions = candidateLeads.map((lead) => ({
    value: lead.id,
    label: [lead.name || "Unnamed lead", lead.email, lead.phone].filter(Boolean).join(" - "),
  }));

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    setNewLead(null);
    setLeadSearch("");
  }, [organizationId, selectedInstance?.id]);

  useEffect(() => {
    if (!hasNewLead) return undefined;
    setSettingsLoading(true);
    setSettingsError("");
    return onSnapshot(collection(db, "churches", organizationId, "leadsSettings"), (snapshot) => {
      const options = getDefaultLeadOptions();
      snapshot.docs.forEach((entry) => {
        const list = entry.data()?.statusList;
        if (Object.prototype.hasOwnProperty.call(options, entry.id) && Array.isArray(list)) options[entry.id] = list;
      });
      setLeadSettings(options);
      setSettingsLoading(false);
    }, () => {
      setSettingsError("Failed to load lead options");
      setSettingsLoading(false);
    });
  }, [organizationId, hasNewLead]);

  const openNewLead = (name = "") => {
    if (!selectedInstance || busy || leadsLoading || leadsError) return;
    setSelectedLeadId("");
    setNewLead({ ...EMPTY_LEAD_FORM, name: name.trim(), status: "", followUp: false,
      classType: selectedInstance.classType, ...getLeadClassAssignment({ classType: selectedInstance.classType, classInstanceId: selectedInstance.id }, assignmentInstances),
    });
  };

  const changeNewLead = (field) => (event) => {
    const value = field === "followUp" ? event.target.checked : event.target.value;
    setNewLead((previous) => ({ ...previous, [field]: value }));
  };

  const handleCreateLead = async (event) => {
    event.preventDefault();
    if (!newLead || !selectedInstance || busy || settingsLoading || settingsError || !user?.uid || leadsLoading || leadsError) return;
    const name = newLead.name.trim();
    if (!name) {
      toast.error("Lead name is required");
      return;
    }
    const duplicate = findDuplicateLead(newLead, availableLeads);
    if (duplicate) {
      toast.error(`A lead with this ${duplicate.field} already exists. Select the existing lead instead.`);
      return;
    }
    setCreating(true);
    try {
      await addDoc(collection(db, "churches", organizationId, "leads"), {
        name, phone: newLead.phone.trim(), email: newLead.email.trim(),
        ...Object.fromEntries(LEAD_DETAIL_LISTS.map((list) => [list.field, list.field === "classType" ? selectedInstance.classType : newLead[list.field]])),
        ...getLeadClassAssignment({ classType: selectedInstance.classType, classInstanceId: selectedInstance.id }, assignmentInstances),
        status: newLead.status || leadSettings.statuses[0] || "New",
        followUp: Boolean(newLead.followUp), callbackTime: newLead.callbackTime,
        createdAt: serverTimestamp(), createdBy: user.uid,
        createdByName: user.displayName || user.email || "",
      });
      setNewLead(null);
      setLeadSearch("");
      toast.success("Lead created and assigned to class instance");
    } catch (createError) {
      toast.error("Failed to create lead");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    setForm(EMPTY_INSTANCE);
    setEditingId(null);
    setSelectedInstanceId("");
    if (mode === "enroll") {
      setLoading(false);
      return undefined;
    }
    return onSnapshot(doc(db, "churches", organizationId, "leadsSettings", "classInstances"), (snapshot) => {
      const list = snapshot.data()?.statusList;
      setInstances(Array.isArray(list) ? list : []);
      setLoading(false);
    }, () => {
      setError("Failed to load class instances");
      setLoading(false);
    });
  }, [organizationId, mode]);

  useEffect(() => {
    setAvailableProgramTypes([]);
    if (!organizationId) return undefined;
    return onSnapshot(doc(db, "churches", organizationId, "leadsSettings", "programTypes"), (snapshot) => {
      const list = snapshot.data()?.statusList;
      setAvailableProgramTypes(Array.isArray(list) ? list.map(formatLeadDisplayValue).filter(Boolean) : []);
    }, () => {
      setAvailableProgramTypes([]);
    });
  }, [organizationId]);

  useEffect(() => {
    setAssignedLeads([]);
    setRosterError("");
    if (mode !== "roster" || !selectedInstance?.id) {
      setRosterLoading(false);
      return undefined;
    }
    setRosterLoading(true);
    const rosterQuery = query(collection(db, "churches", organizationId, "leads"), where("classInstanceId", "==", selectedInstance.id));
    return onSnapshot(rosterQuery, (snapshot) => {
      setAssignedLeads(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
        .sort((first, second) => String(first.name || "").localeCompare(String(second.name || ""))));
      setRosterLoading(false);
    }, () => {
      setRosterError("Failed to load assigned leads");
      setRosterLoading(false);
    });
  }, [organizationId, selectedInstance?.id, mode]);

  useEffect(() => {
    setAvailableLeads([]);
    setSelectedLeadId("");
    setLeadsError("");
    if (!["roster", "enroll"].includes(mode) || !selectedInstance?.id) {
      setLeadsLoading(false);
      return undefined;
    }
    setLeadsLoading(true);
    return onSnapshot(collection(db, "churches", organizationId, "leads"), (snapshot) => {
      setAvailableLeads(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
        .sort((first, second) => String(first.name || "").localeCompare(String(second.name || ""))));
      setLeadsLoading(false);
    }, () => {
      setLeadsError("Failed to load leads for assignment");
      setLeadsLoading(false);
    });
  }, [organizationId, selectedInstance?.id, mode]);

  const handleAssignLead = async (event) => {
    event.preventDefault();
    const lead = candidateLeads.find((entry) => entry.id === selectedLeadId);
    if (!lead || !selectedInstance || busy || leadsLoading || leadsError) return;
    if (lead.classInstanceId && !window.confirm(`Move ${lead.name || "this lead"} from their current class instance to "${selectedInstance.name}"?`)) return;
    setAssigning(true);
    try {
      await updateDoc(doc(db, "churches", organizationId, "leads", lead.id), {
        classType: selectedInstance.classType,
        ...getLeadClassAssignment({ classType: selectedInstance.classType, classInstanceId: selectedInstance.id }, assignmentInstances),
        updatedAt: serverTimestamp(),
      });
      setSelectedLeadId("");
      toast.success("Lead assigned to class instance");
    } catch (assignmentError) {
      toast.error("Failed to assign lead to class instance");
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveLead = async (lead) => {
    if (!selectedInstance || busy || lead.classInstanceId !== selectedInstance.id) return;
    if (!window.confirm(`Remove ${lead.name || "this lead"} from "${selectedInstance.name}"? The lead will not be deleted.`)) return;
    setRemovingLeadId(lead.id);
    try {
      await updateDoc(doc(db, "churches", organizationId, "leads", lead.id), {
        classInstanceId: "",
        classInstance: null,
        updatedAt: serverTimestamp(),
      });
      toast.success("Lead removed from class instance");
    } catch (removeError) {
      toast.error("Failed to remove lead from class instance");
    } finally {
      setRemovingLeadId(null);
    }
  };

  const persist = async (nextInstances) => {
    if (loading || busy || error) return false;
    setSaving(true);
    try {
      await setDoc(doc(db, "churches", organizationId, "leadsSettings", "classInstances"), { statusList: nextInstances }, { merge: true });
      return true;
    } catch (saveError) {
      toast.error("Failed to save class instances");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!isValidClassInstance(form)) {
      toast.error("Enter a name, class type, valid start date, and a positive whole number of weeks");
      return;
    }
    const invalidAssignment = form.programAssignments.some((assignment) => (
      !assignment.programType || assignment.price === "" || !Number.isFinite(Number(assignment.price)) || Number(assignment.price) < 0
    ));
    const duplicateProgramType = new Set(form.programAssignments.map((assignment) => assignment.programType).filter(Boolean)).size !== form.programAssignments.length;
    if (invalidAssignment || duplicateProgramType) {
      toast.error(duplicateProgramType ? "Each program type can only be assigned once" : "Choose a program type and enter a valid non-negative price for each assignment");
      return;
    }
    const instance = {
      id: editingId || doc(collection(db, "churches", organizationId, "leadsSettings")).id,
      name: form.name.trim(), classType: form.classType,
      startDate: form.startDate, totalWeeks: Number(form.totalWeeks),
      programAssignments: form.programAssignments.map((assignment) => ({
        programType: assignment.programType,
        price: Number(assignment.price),
      })),
    };
    const next = editingId ? instances.map((entry) => entry.id === editingId ? instance : entry) : [...instances, instance];
    if (await persist(next)) {
      setForm(EMPTY_INSTANCE);
      setEditingId(null);
      setSelectedInstanceId(instance.id);
      toast.success("Class instance saved");
    }
  };

  const handleDelete = async (instance) => {
    if (!window.confirm(`Delete "${instance.name}"? Existing leads will keep their saved assignment.`)) return;
    if (await persist(instances.filter((entry) => entry.id !== instance.id))) {
      if (selectedInstanceId === instance.id) setSelectedInstanceId("");
      if (editingId === instance.id) {
        setEditingId(null);
        setForm(EMPTY_INSTANCE);
      }
      toast.success("Class instance deleted");
    }
  };

  const change = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  const changeProgramAssignment = (index, field) => (event) => setForm((previous) => ({
    ...previous,
    programAssignments: previous.programAssignments.map((assignment, assignmentIndex) => (
      assignmentIndex === index ? { ...assignment, [field]: event.target.value } : assignment
    )),
  }));
  const addProgramAssignment = () => setForm((previous) => ({
    ...previous,
    programAssignments: [...previous.programAssignments, { programType: "", price: "" }],
  }));
  const removeProgramAssignment = (index) => setForm((previous) => ({
    ...previous,
    programAssignments: previous.programAssignments.filter((_assignment, assignmentIndex) => assignmentIndex !== index),
  }));

  const enrollmentControls = (
    <>
          <form onSubmit={handleAssignLead} className="d-flex flex-wrap gap-2 align-items-end mb-3">
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <label htmlFor="class-instance-add-lead" className="form-label">Add lead to this instance</label>
              <CreatableSelect
                inputId="class-instance-add-lead"
                options={leadOptions}
                value={leadOptions.find((option) => option.value === selectedLeadId) || null}
                onChange={(option) => setSelectedLeadId(option?.value || "")}
                onCreateOption={openNewLead}
                inputValue={leadSearch}
                onInputChange={(value) => setLeadSearch(value)}
                formatCreateLabel={(value) => `Create new lead "${value}"`}
                isValidNewOption={(value) => Boolean(value.trim()) && !findDuplicateLead({ name: value, email: value, phone: value }, availableLeads)}
                isClearable
                isLoading={leadsLoading}
                isDisabled={busy || leadsLoading || Boolean(leadsError)}
                placeholder="Search name, email or phone"
                noOptionsMessage={() => "No other leads available"}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={!selectedLeadId || busy || leadsLoading || Boolean(leadsError)}>
              {assigning ? "Assigning..." : "Assign Lead"}
            </button>
            <button type="button" className="btn btn-outline-primary" disabled={busy || leadsLoading || Boolean(leadsError)} onClick={() => openNewLead(leadSearch)}>Create New Lead</button>
          </form>
          {leadsError && <p role="alert" className="text-danger">{leadsError}</p>}
          {newLead && (
            <section aria-labelledby="instance-new-lead-heading" className="border-top border-bottom py-3 mb-4">
              <h5 id="instance-new-lead-heading" className="h6">Create Lead</h5>
              {settingsError && <p role="alert" className="text-danger">{settingsError}</p>}
              {duplicateMatch && (
                <div role="alert" className="alert alert-warning">
                  <div>Existing lead found: {duplicateMatch.lead.name || "Unnamed lead"}{duplicateMatch.lead.phone ? ` - ${duplicateMatch.lead.phone}` : ""}{duplicateMatch.lead.email ? ` - ${duplicateMatch.lead.email}` : ""}</div>
                  {duplicateMatch.lead.classInstanceId === selectedInstance?.id ? (
                    <div>Already assigned to this class instance.</div>
                  ) : (
                    <button type="button" className="btn btn-sm btn-outline-primary mt-2" disabled={busy} onClick={() => { setSelectedLeadId(duplicateMatch.lead.id); setNewLead(null); }}>Use Existing Lead</button>
                  )}
                </div>
              )}
              <form onSubmit={handleCreateLead} className="row g-2 align-items-end">
                <div className="col-md-4"><label htmlFor="instance-new-lead-name" className="form-label">Name *</label><input id="instance-new-lead-name" className="form-control" value={newLead.name} onChange={changeNewLead("name")} required disabled={creating} /></div>
                <div className="col-md-4"><label htmlFor="instance-new-lead-phone" className="form-label">Phone</label><input id="instance-new-lead-phone" type="tel" className="form-control" value={newLead.phone} onChange={changeNewLead("phone")} disabled={creating} /></div>
                <div className="col-md-4"><label htmlFor="instance-new-lead-email" className="form-label">Email</label><input id="instance-new-lead-email" type="email" className="form-control" value={newLead.email} onChange={changeNewLead("email")} disabled={creating} /></div>
                <LeadDetailFields values={newLead} options={{ ...leadSettings, programTypes: selectedInstance.programAssignments?.length ? selectedInstance.programAssignments.map((assignment) => assignment.programType) : leadSettings.programTypes, classInstances: assignmentInstances }} onChange={changeNewLead} prefix="instance-new-lead" lockClassAssignment disabled={creating || settingsLoading || Boolean(settingsError)} />
                <div className="col-sm-6 col-md-3">
                  <label htmlFor="instance-new-lead-status" className="form-label">Status</label>
                  <select id="instance-new-lead-status" className="form-select" value={newLead.status || leadSettings.statuses[0] || "New"} onChange={changeNewLead("status")} disabled={creating || settingsLoading || Boolean(settingsError)}>
                    {leadSettings.statuses.length === 0 && <option value="New">New</option>}
                    {leadSettings.statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </div>
                <div className="col-sm-6 col-md-3"><label className="form-check-label d-flex align-items-center gap-2"><input type="checkbox" className="form-check-input" checked={newLead.followUp} onChange={changeNewLead("followUp")} disabled={creating} />Follow up</label></div>
                <div className="col-12 d-flex gap-2">
                  <button type="submit" className="btn btn-primary" disabled={busy || settingsLoading || Boolean(settingsError) || Boolean(duplicateMatch) || !user?.uid}>{creating ? "Creating..." : "Create and Assign Lead"}</button>
                  <button type="button" className="btn btn-outline-secondary" disabled={creating} onClick={() => setNewLead(null)}>Cancel New Lead</button>
                </div>
              </form>
            </section>
          )}
    </>
  );

  if (mode === "enroll") return <section aria-label="Class enrollment" className="mb-4">{enrollmentControls}</section>;

  return (
    <section className="pt-3" aria-labelledby="class-instances-heading">
      <h3 id="class-instances-heading" className="h5">Class Instances</h3>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {mode === "roster" && (
      <section aria-labelledby="select-class-instance-heading" className="pb-3">
      <h4 id="select-class-instance-heading" className="h5">Select Class Instance</h4>
      <div className="mb-3">
        <label htmlFor="class-instance-roster" className="form-label">View assigned leads</label>
        <select id="class-instance-roster" className="form-select" value={selectedInstance ? selectedInstanceId : ""} onChange={(event) => setSelectedInstanceId(event.target.value)} disabled={loading || busy || Boolean(error)}>
          <option value="">Select class instance</option>
          {[...instances].sort((first, second) => first.startDate.localeCompare(second.startDate)).map((instance) => (
            <option key={instance.id} value={instance.id}>{instance.classType}: {getClassInstanceLabel(instance)}</option>
          ))}
        </select>
      </div>
      {selectedInstance && (
        <section className="mb-4" aria-label="Assigned leads">
          <h5 className="h6">{getClassInstanceLabel(selectedInstance)}</h5>
          {enrollmentControls}
          {rosterLoading ? <p role="status">Loading assigned leads...</p> : rosterError ? <p role="alert" className="text-danger">{rosterError}</p> : assignedLeads.length === 0 ? (
            <p className="text-muted">No leads assigned to this instance.</p>
          ) : (
            <>
              <p className="small text-muted">{assignedLeads.length} assigned {assignedLeads.length === 1 ? "lead" : "leads"}</p>
              <div className="table-responsive">
                <table className="table table-sm" aria-label="Class instance leads" style={{ minWidth: "1300px" }}>
                  <thead><tr>{["Name", "Phone", "Email", "Status", "City & State", "Class Type", "Program Type", "Class Instance", "Start Date", "Total Weeks", "Follow-up", "Callback Time", "Call Status", "Actions"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                  <tbody>
                    {assignedLeads.map((lead) => (
                      <tr key={lead.id}>
                        <td style={{ overflowWrap: "anywhere" }}><a href={`${leadsRoutePrefix}/${organizationId}/leads?leadId=${encodeURIComponent(lead.id)}`}>{lead.name || "Unnamed lead"}</a></td>
                        <td>{lead.phone ? <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a> : "Not provided"}</td>
                        <td style={{ overflowWrap: "anywhere" }}>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "Not provided"}</td>
                        <td>{lead.status || "No status"}</td>
                        <td>{getLeadLocation(lead) || "Not provided"}</td>
                        <td>{lead.classType || "Not assigned"}</td>
                        <td>{lead.programType || "Not assigned"}</td>
                        <td>{selectedInstance.name}</td>
                        <td>{selectedInstance.startDate}</td>
                        <td>{selectedInstance.totalWeeks}</td>
                        <td>{lead.followUp ? "Yes" : "No"}</td>
                        <td>{lead.callbackTime || "Not set"}</td>
                        <td>{lead.callbackCompleted ? "Completed" : lead.callbackTime ? "Upcoming" : "Not scheduled"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-2"
                            disabled={busy}
                            onClick={() => handleRemoveLead(lead)}
                            aria-label={`Remove ${lead.name || "lead"} from class instance`}
                            title="Remove from class instance"
                          >
                            <FaUserMinus aria-hidden="true" />
                            {removingLeadId === lead.id ? "Removing..." : "Remove"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      </section>
      )}
      {mode === "manage" && (
      <section aria-labelledby="manage-class-instances-heading" className="pt-3">
      <h4 id="manage-class-instances-heading" className="h5">Create a Class</h4>
      <form onSubmit={handleSave} className="row g-2 mb-3">
        <div className="col-sm-6">
          <label htmlFor="class-instance-name" className="form-label">Instance name</label>
          <input id="class-instance-name" className="form-control" value={form.name} onChange={change("name")} required disabled={saving || loading || Boolean(error)} />
        </div>
        <div className="col-sm-6">
          <label htmlFor="class-instance-type" className="form-label">Class type</label>
          <select id="class-instance-type" className="form-select" value={form.classType} onChange={change("classType")} required disabled={saving || loading || Boolean(error)}>
            <option value="">Select class type</option>
            {form.classType && !classTypes.includes(form.classType) && <option value={form.classType}>{form.classType}</option>}
            {classTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <div className="col-sm-6">
          <label htmlFor="class-instance-start" className="form-label">Start date</label>
          <input id="class-instance-start" type="date" className="form-control" value={form.startDate} onChange={change("startDate")} required disabled={saving || loading || Boolean(error)} />
        </div>
        <div className="col-sm-6">
          <label htmlFor="class-instance-weeks" className="form-label">Total weeks</label>
          <input id="class-instance-weeks" type="number" min="1" step="1" className="form-control" value={form.totalWeeks} onChange={change("totalWeeks")} required disabled={saving || loading || Boolean(error)} />
        </div>
        <div className="col-12">
          <fieldset className="border rounded p-3 bg-light">
            <legend className="float-none w-auto px-2 fs-6 mb-1">Program types and prices</legend>
            <p className="small text-muted">Choose the programs offered in this class and set a price for each.</p>
            {form.programAssignments.map((assignment, index) => {
              const choices = [...new Set([assignment.programType, ...availableProgramTypes].filter(Boolean))]
                .filter((programType) => programType === assignment.programType || !form.programAssignments.some((other, otherIndex) => otherIndex !== index && other.programType === programType));
              return (
                <div className="row g-2 align-items-end mb-2" key={`program-assignment-${index}`}>
                  <div className="col-md-6">
                    <label className="form-label" htmlFor={`class-program-type-${index}`}>Program type {index + 1}</label>
                    <select id={`class-program-type-${index}`} className="form-select" value={assignment.programType} onChange={changeProgramAssignment(index, "programType")} required disabled={saving || loading || Boolean(error)}>
                      <option value="">Select program type</option>
                      {choices.map((programType) => <option key={programType} value={programType}>{programType}</option>)}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label" htmlFor={`class-program-price-${index}`}>Price</label>
                    <div className="input-group"><span className="input-group-text">$</span><input id={`class-program-price-${index}`} type="number" min="0" step="0.01" className="form-control" value={assignment.price} onChange={changeProgramAssignment(index, "price")} required aria-label={`Price for program type ${index + 1}`} disabled={saving || loading || Boolean(error)} /></div>
                  </div>
                  <div className="col-md-2 d-grid">
                    <button type="button" className="btn btn-outline-danger" onClick={() => removeProgramAssignment(index)} disabled={saving || loading || Boolean(error)} aria-label={`Remove program type ${index + 1}`}>Remove</button>
                  </div>
                </div>
              );
            })}
            {availableProgramTypes.length === 0 && <p className="small text-muted">Add program types in Manage Lead Options before assigning prices.</p>}
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={addProgramAssignment} disabled={saving || loading || Boolean(error) || availableProgramTypes.length === 0 || availableProgramTypes.every((programType) => form.programAssignments.some((assignment) => assignment.programType === programType))}>Add Program Type</button>
          </fieldset>
        </div>
        <div className="col-12 d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy || loading || Boolean(error)}>{saving ? "Saving..." : editingId ? "Save Instance" : "Add Instance"}</button>
          {editingId && <button type="button" className="btn btn-outline-secondary" disabled={saving} onClick={() => { setEditingId(null); setForm(EMPTY_INSTANCE); }}>Cancel Instance Edit</button>}
        </div>
      </form>
      {loading ? <p role="status">Loading class instances...</p> : instances.length === 0 ? <p className="text-muted">No class instances.</p> : (
        <ul className="list-group">
          {[...instances].sort((first, second) => first.startDate.localeCompare(second.startDate)).map((instance) => (
            <li key={instance.id} className="list-group-item d-flex flex-wrap justify-content-between gap-2">
              <div style={{ overflowWrap: "anywhere" }}><strong>{instance.classType}</strong><div>{getClassInstanceLabel(instance)}</div>{instance.programAssignments?.length > 0 && <ul className="small mb-0 mt-2">{instance.programAssignments.map((assignment) => <li key={assignment.programType}>{assignment.programType}: ${Number(assignment.price).toFixed(2)}</li>)}</ul>}</div>
              <div className="d-flex align-items-center gap-2">
                <button type="button" className="btn btn-sm btn-outline-primary" disabled={busy} onClick={() => { setEditingId(instance.id); setForm({ ...instance, programAssignments: (instance.programAssignments || []).map((assignment) => ({ ...assignment, price: String(assignment.price) })) }); }}>Edit Instance</button>
                <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => handleDelete(instance)}>Delete Instance</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </section>
      )}
    </section>
  );
};

export default LeadClassInstances;