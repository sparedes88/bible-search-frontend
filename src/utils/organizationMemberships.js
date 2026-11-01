import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";

const getPrimaryOrganizationIds = (user) => new Set(
  [user?.churchId, user?.churchID, user?.organizationId]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String)
);

export const hasOrganizationAccess = async (user, organizationId, isGlobalAdmin = false) => {
  if (!user?.uid || !organizationId) return false;
  if (isGlobalAdmin || getPrimaryOrganizationIds(user).has(String(organizationId))) return true;
  const membership = await getDoc(doc(db, "churches", String(organizationId), "members", user.uid));
  return membership.exists();
};

export const getAccessibleOrganizations = async (user, isGlobalAdmin = false) => {
  if (!user?.uid) return [];
  const snapshot = await getDocs(collection(db, "churches"));
  const organizations = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
  if (isGlobalAdmin) return organizations;
  const access = await Promise.all(organizations.map((organization) => hasOrganizationAccess(user, organization.id)));
  return organizations.filter((_organization, index) => access[index]);
};