import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { LEAD_MODULE_TABS, LEAD_OPTION_LISTS } from "../utils/leadOptions";
import LeadClassInstances from "./LeadClassInstances";
import ClassInstanceAttendance from "./ClassInstanceAttendance";

const LeadsStatusManager = () => {
  const { id, tab = "statuses" } = useParams();
  const location = useLocation();
  const activeTab = LEAD_MODULE_TABS.find((entry) => entry.path === tab);
  const activeListId = activeTab?.id || "statuses";
  const activeList = LEAD_OPTION_LISTS.find((list) => list.id === activeListId)
    || LEAD_OPTION_LISTS.find((list) => list.id === "classTypes");
  const [statuses, setStatuses] = useState(LEAD_OPTION_LISTS[0].defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editingValue, setEditingValue] = useState("");

  const routePrefix =
    location.pathname.startsWith("/church/")
      ? "/church"
      : "/organization";

  useEffect(() => {
    if (!id) return undefined;
    setLoading(true);
    setStatuses(activeList.defaults);
    setNewStatus("");
    setEditingIndex(-1);
    const statusRef = doc(db, "churches", id, "leadsSettings", activeList.id);
    const unsubscribe = onSnapshot(
      statusRef,
      (snapshot) => {
        const list = snapshot.data()?.statusList;
        setStatuses(Array.isArray(list) ? list : activeList.defaults);
        setLoading(false);
      },
      (error) => {
        console.error("Error loading lead options:", error);
        toast.error(`Failed to load ${activeList.label.toLowerCase()}`);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [id, activeList]);

  const persistStatuses = async (nextStatuses, successMessage) => {
    if (!id || saving || loading) return false;
    try {
      setSaving(true);
      const statusRef = doc(db, "churches", id, "leadsSettings", activeList.id);
      await setDoc(statusRef, { statusList: nextStatuses }, { merge: true });
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (error) {
      console.error("Error saving lead options:", error);
      toast.error(`Failed to save ${activeList.label.toLowerCase()}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAddStatus = async (event) => {
    event.preventDefault();
    const value = newStatus.trim();
    if (!value) return;
    if (statuses.some((status) => status.toLowerCase() === value.toLowerCase())) {
      toast.error(`That ${activeList.singular} already exists`);
      return;
    }
    if (await persistStatuses([...statuses, value], "Option added")) {
      setNewStatus("");
    }
  };

  const handleStartEdit = (index) => {
    setEditingIndex(index);
    setEditingValue(statuses[index]);
  };

  const handleSaveEdit = async (index) => {
    const value = editingValue.trim();
    if (!value) {
      toast.error("Option name cannot be empty");
      return;
    }
    if (
      statuses.some(
        (status, statusIndex) =>
          statusIndex !== index && status.toLowerCase() === value.toLowerCase()
      )
    ) {
      toast.error(`That ${activeList.singular} already exists`);
      return;
    }
    const nextStatuses = statuses.map((status, statusIndex) =>
      statusIndex === index ? value : status
    );
    if (await persistStatuses(nextStatuses, "Option updated")) {
      setEditingIndex(-1);
      setEditingValue("");
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(-1);
    setEditingValue("");
  };

  const handleDeleteStatus = async (index) => {
    const status = statuses[index];
    if (!window.confirm(`Delete ${activeList.singular} "${status}"? Existing leads will keep their saved value until edited.`)) return;
    const nextStatuses = statuses.filter((_, statusIndex) => statusIndex !== index);
    await persistStatuses(nextStatuses, "Option deleted");
  };

  const handleMove = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= statuses.length) return;
    const nextStatuses = [...statuses];
    [nextStatuses[index], nextStatuses[targetIndex]] = [
      nextStatuses[targetIndex],
      nextStatuses[index],
    ];
    await persistStatuses(nextStatuses);
  };

  if (!activeTab) return <Navigate to={`${routePrefix}/${id}/leads/statuses`} replace />;

  return (
    <div style={{ ...commonStyles.fullWidthContainer, position: "relative" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organizacion
      </Link>

      <ChurchHeader id={id} applyShadow={false} compact />

      <div style={{ width: "100%", maxWidth: ["classInstances", "attendance"].includes(activeListId) ? "1400px" : "700px", margin: "0 auto", textAlign: "left" }}>
      <div className="d-flex flex-wrap justify-content-between align-items-center my-3 gap-2">
        <h2 className="mb-0">Manage Lead Options</h2>
        <Link to={`${routePrefix}/${id}/leads`} className="btn btn-outline-secondary">
          Back to Leads
        </Link>
      </div>

      <div className="nav nav-tabs flex-wrap mb-3" role="tablist" aria-label="Lead option lists">
        {LEAD_MODULE_TABS.map((list) => (
          <Link
            key={list.id}
            to={`${routePrefix}/${id}/leads/${list.path}`}
            role="tab"
            aria-selected={activeListId === list.id}
            className={`nav-link ${activeListId === list.id ? "active" : ""}`}
            aria-disabled={saving}
            tabIndex={saving ? -1 : 0}
            onClick={(event) => { if (saving) event.preventDefault(); }}
          >
            {list.label}
          </Link>
        ))}
      </div>

      {activeListId === "attendance" ? (
        <ClassInstanceAttendance organizationId={id} />
      ) : ["classInstances", "manageClassInstances"].includes(activeListId) ? (
        loading ? <p role="status">Loading class types...</p> : <LeadClassInstances key={activeListId} organizationId={id} classTypes={statuses} mode={activeListId === "manageClassInstances" ? "manage" : "roster"} />
      ) : (
      <>
      <h3 className="h5">{activeList.label}</h3>
      <div className="mb-4">
          <form onSubmit={handleAddStatus} className="input-group">
            <input
              type="text"
              className="form-control"
              value={newStatus}
              onChange={(event) => setNewStatus(event.target.value)}
              aria-label={`New ${activeList.singular}`}
              placeholder={`New ${activeList.singular}`}
              disabled={saving || loading}
            />
            <button type="submit" className="btn btn-primary" disabled={saving || loading}>
              Add
            </button>
          </form>
      </div>

      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : statuses.length === 0 ? (
        <div className="alert alert-info">No {activeList.label.toLowerCase()} defined.</div>
      ) : (
        <ul className="list-group">
          {statuses.map((status, index) => (
            <li
              key={`${status}-${index}`}
              className="list-group-item d-flex flex-wrap gap-2 justify-content-between align-items-center"
            >
              {editingIndex === index ? (
                <input
                  type="text"
                  className="form-control form-control-sm me-2"
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSaveEdit(index);
                    }
                    if (event.key === "Escape") handleCancelEdit();
                  }}
                  autoFocus
                />
              ) : (
                <span className="fw-semibold" style={{ overflowWrap: "anywhere" }}>{status}</span>
              )}
              <span className="d-flex gap-1">
                {editingIndex === index ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-success"
                      onClick={() => handleSaveEdit(index)}
                      disabled={saving}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0 || saving}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => handleMove(index, 1)}
                      disabled={index === statuses.length - 1 || saving}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => handleStartEdit(index)}
                      disabled={saving}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => handleDeleteStatus(index)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      </>
      )}
      </div>
    </div>
  );
};

export default LeadsStatusManager;
