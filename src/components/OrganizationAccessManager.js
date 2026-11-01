import React, { useEffect, useState } from "react";
import Select from "react-select";
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";

const OrganizationAccessManager = ({ users, organizationId, currentUser, roleOptions = [] }) => {
  const [organizations, setOrganizations] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [membership, setMembership] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [accessMemberships, setAccessMemberships] = useState({});
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessWarning, setAccessWarning] = useState("");
  const selectedUser = users.find((member) => member.uid === selectedUserId);
  const primaryId = String(selectedUser?.churchId || selectedUser?.churchID || selectedUser?.organizationId || organizationId);
  const isPrimary = Boolean(destinationId && destinationId === primaryId);
  const roleKey = selectedUser?.customRoleId || selectedUser?.assignedRoleId || selectedUser?.role || selectedUser?.baseRole || "member";
  const matchedRole = roleOptions.find((role) => role.value === roleKey);
  const roleLabel = matchedRole?.label || selectedUser?.roleLabel || selectedUser?.roleName || selectedUser?.customRoleName
    || String(roleKey).replace(/^system_/, "").split(/[_-]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  const hasGlobalAccess = [selectedUser?.role, selectedUser?.baseRole, selectedUser?.basedOn, selectedUser?.systemRole, matchedRole?.baseRole]
    .some((role) => ["global_admin", "system_global_admin"].includes(String(role || "").toLowerCase()));
  const accessRows = selectedUser ? organizations.filter((organization) => organization.id === primaryId || accessMemberships[organization.id] || hasGlobalAccess)
    .map((organization) => ({
      ...organization,
      accessType: organization.id === primaryId ? "Primary" : accessMemberships[organization.id] ? "Additional" : "Global access",
    })) : [];
  if (selectedUser && !organizations.some((organization) => organization.id === primaryId)) {
    accessRows.unshift({ id: primaryId, nombre: primaryId, accessType: "Primary" });
  }

  useEffect(() => {
    let active = true;
    getDocs(collection(db, "churches"))
      .then((snapshot) => {
        if (!active) return;
        setOrganizations(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
          .sort((first, second) => String(first.nombre || first.name || first.id).localeCompare(String(second.nombre || second.name || second.id))));
      })
      .catch(() => {
        if (active) setError("Unable to load organizations.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setAccessMemberships({});
    setAccessWarning("");
    if (!selectedUser || loading) {
      setLoadingAccess(false);
      return undefined;
    }
    setLoadingAccess(true);
    const loadMemberships = async () => {
      const results = await Promise.all(organizations.filter((organization) => organization.id !== primaryId).map(async (organization) => {
        try {
          const snapshot = await getDoc(doc(db, "churches", organization.id, "members", selectedUser.uid));
          return { id: organization.id, membership: snapshot.exists() ? snapshot.data() : null };
        } catch (membershipError) {
          return { id: organization.id, unavailable: true };
        }
      }));
      if (!active) return;
      setAccessMemberships(Object.fromEntries(results.filter((result) => result.membership).map((result) => [result.id, result.membership])));
      if (results.some((result) => result.unavailable)) {
        setAccessWarning("Some memberships could not be verified with your current permissions.");
      }
      setLoadingAccess(false);
    };
    loadMemberships();
    return () => { active = false; };
  }, [selectedUser, organizations, primaryId, loading]);

  useEffect(() => {
    let active = true;
    setMembership(null);
    setError("");
    if (!selectedUser || !destinationId || isPrimary) {
      setChecking(false);
      return undefined;
    }
    setChecking(true);
    getDoc(doc(db, "churches", destinationId, "members", selectedUser.uid))
      .then((snapshot) => {
        if (active) setMembership(snapshot.exists() ? snapshot.data() : null);
      })
      .catch(() => {
        if (active) setError("Unable to check access. You must be an administrator of the destination organization.");
      })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [selectedUser, destinationId, isPrimary]);

  const handleAdd = async () => {
    if (!selectedUser || !destinationId || isPrimary || membership || saving || checking || loadingAccess || error) return;
    setSaving(true);
    try {
      const reference = doc(db, "churches", destinationId, "members", selectedUser.uid);
      const record = {
        userId: selectedUser.uid,
        email: selectedUser.email || "",
        name: selectedUser.name || "",
        lastName: selectedUser.lastName || "",
        sourceOrganizationId: String(organizationId),
        addedBy: currentUser.uid,
        addedAt: serverTimestamp(),
      };
      const saved = await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(reference);
        if (existing.exists()) return existing.data();
        transaction.set(reference, record);
        return record;
      });
      setMembership(saved);
      setAccessMemberships((previous) => ({ ...previous, [destinationId]: saved }));
      toast.success("Organization access added");
    } catch (saveError) {
      toast.error("Failed to add access. Check your destination organization permissions.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedUser || !destinationId || isPrimary || !membership || saving || checking || loadingAccess || error) return;
    if (!window.confirm(`Remove ${selectedUser.email || selectedUser.name}'s additional access to this organization? Their primary organization is unchanged.`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "churches", destinationId, "members", selectedUser.uid));
      setMembership(null);
      setAccessMemberships((previous) => {
        const next = { ...previous };
        delete next[destinationId];
        return next;
      });
      toast.success("Additional organization access removed");
    } catch (removeError) {
      toast.error("Failed to remove organization access");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="organization-access-heading" className="py-3" style={{ maxWidth: "760px" }}>
      <h3 id="organization-access-heading">Organization Access</h3>
      <div className="mb-3">
        <label htmlFor="organization-access-user" className="form-label">Team member</label>
        <Select
          inputId="organization-access-user"
          options={users.map((member) => ({ value: member.uid, label: `${[member.name, member.lastName].filter(Boolean).join(" ")} (${member.email || member.uid})` }))}
          value={selectedUser ? { value: selectedUser.uid, label: `${[selectedUser.name, selectedUser.lastName].filter(Boolean).join(" ")} (${selectedUser.email || selectedUser.uid})` } : null}
          onChange={(option) => { setSelectedUserId(option?.value || ""); setDestinationId(""); setError(""); }}
          isDisabled={saving}
          placeholder="Search by name or email"
        />
      </div>
      {selectedUser && (
        <div className="mb-4" aria-label="Current organization access">
          <h4 className="h5">Current Access</h4>
          {loading || loadingAccess ? <p role="status">Loading organization access...</p> : (
            <>
              {accessWarning && <p role="status" className="text-warning">{accessWarning}</p>}
              <div className="table-responsive">
                <table className="table table-sm" aria-label="Organization memberships">
                  <thead><tr><th scope="col">Organization</th><th scope="col">Access</th><th scope="col">Role</th></tr></thead>
                  <tbody>
                    {accessRows.map((organization) => (
                      <tr key={organization.id}>
                        <td style={{ overflowWrap: "anywhere" }}>{organization.nombre || organization.name || organization.churchName || organization.id} ({organization.id})</td>
                        <td>{organization.accessType}</td>
                        <td>{roleLabel}<span className="d-block text-muted small">Account role</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      <div className="mb-3">
        <label htmlFor="organization-access-destination" className="form-label">Destination organization</label>
        <select
          id="organization-access-destination"
          className="form-select"
          value={destinationId}
          onChange={(event) => setDestinationId(event.target.value)}
          disabled={loading || saving || !selectedUser}
        >
          <option value="">Select organization</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.nombre || organization.name || organization.churchName || organization.id} ({organization.id})
            </option>
          ))}
        </select>
      </div>
      {error && <div role="alert" className="alert alert-danger">{error}</div>}
      {isPrimary ? <p>This is the member's primary organization. Primary access cannot be removed here.</p> : checking ? (
        <p role="status">Checking organization access...</p>
      ) : selectedUser && destinationId && !error ? (
        <>
          <p>{membership ? "This member already has access." : "No additional membership in this organization."}</p>
          <button
            type="button"
            className={`btn ${membership ? "btn-outline-danger" : "btn-primary"}`}
            disabled={saving || loadingAccess}
            onClick={membership ? handleRemove : handleAdd}
          >
            {saving ? "Saving..." : membership ? "Remove Additional Access" : "Add to Organization"}
          </button>
        </>
      ) : null}
    </section>
  );
};

export default OrganizationAccessManager;