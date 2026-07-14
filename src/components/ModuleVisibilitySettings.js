import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { toast } from "react-toastify";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import commonStyles from "../pages/commonStyles";
import {
  MODULE_LAYOUT_DOC_ID,
  MODULE_LAYOUT_FIELD,
  MODULE_METADATA_DOC_ID,
  MODULE_SETTINGS_SUBCOLLECTION,
  MODULE_VISIBILITY_DOC_ID,
  MODULE_VISIBILITY_FIELD,
  MODULE_VISIBILITY_ROLES,
  getAllOrganizationModules,
  getModuleVisibilityRoleKeys,
  mergeModuleLayoutSettings,
  mergeModuleVisibilitySettings,
} from "../utils/organizationModules";

const roleLabels = {
  global_admin: "Global Admin",
  admin: "Admin",
  member: "Member",
};

const getRoleNameFromDoc = (roleDocData = {}) => {
  return String(
    roleDocData?.name
    || roleDocData?.roleName
    || roleDocData?.title
    || roleDocData?.displayName
    || ""
  ).trim();
};

const normalizeCustomRoleKey = (roleId) => String(roleId || "").trim().toLowerCase();

const isLikelyFirestoreId = (value) => /^[a-z0-9]{16,}$/i.test(String(value || ""));

const formatRoleLabel = (roleId, roleNameMap = {}) => {
  if (!roleId) {
    return "Unknown Role";
  }

  const mappedName = String(roleNameMap[roleId] || "").trim();
  if (mappedName && mappedName !== roleId) {
    return mappedName;
  }

  if (roleLabels[roleId]) {
    return roleLabels[roleId];
  }

  const fallback = String(roleId).replace(/[_-]+/g, " ").trim();
  if (!fallback || isLikelyFirestoreId(fallback)) {
    return "Custom Role";
  }

  return fallback;
};

const parseOrderValue = (value, fallbackValue) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};

const cloneRoleLayout = (roleLayout = {}) => {
  const sections = Object.entries(roleLayout?.sections || {}).reduce((accumulator, [sectionId, sectionData]) => {
    accumulator[sectionId] = { ...sectionData };
    return accumulator;
  }, {});

  const modules = Object.entries(roleLayout?.modules || {}).reduce((accumulator, [moduleId, moduleData]) => {
    accumulator[moduleId] = { ...moduleData };
    return accumulator;
  }, {});

  return {
    ...roleLayout,
    sections,
    modules,
  };
};

const createSectionId = (label) => {
  const normalizedLabel = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `custom-${normalizedLabel || Date.now()}`;
};

const moveItem = (items, itemId, direction) => {
  const currentIndex = items.findIndex((item) => item.id === itemId);
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(currentIndex, 1);
  nextItems.splice(nextIndex, 0, movedItem);

  return nextItems.map((item, index) => ({
    ...item,
    order: index,
  }));
};

const formatSyncTime = (value) => {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  }).format(value);
};

const ModuleVisibilitySettings = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const normalizedRole = String(user?.role || user?.customRole || "").trim().toLowerCase();
  const isGlobalAdminUser = ["global_admin", "system_global_admin"].includes(normalizedRole);
  const isAdminUser = isGlobalAdminUser || ["admin", "system_admin"].includes(normalizedRole);
  const sameOrganization = String(user?.churchId || "") === String(id || "");
  const canManageSettings = Boolean(
    user && (isGlobalAdminUser || (isAdminUser && (!user?.churchId || sameOrganization)))
  );
  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeRole, setActiveRole] = useState("global_admin");
  const [availableRoles, setAvailableRoles] = useState(MODULE_VISIBILITY_ROLES);
  const [roleNameMap, setRoleNameMap] = useState({ ...roleLabels });
  const [customRoleIds, setCustomRoleIds] = useState([]);
  const [customRoleDocIdByKey, setCustomRoleDocIdByKey] = useState({});
  const [customRoleBaseRoleMap, setCustomRoleBaseRoleMap] = useState({});
  const [visibilitySettings, setVisibilitySettings] = useState(() => mergeModuleVisibilitySettings());
  const [layoutSettings, setLayoutSettings] = useState(() => mergeModuleLayoutSettings());
  const [newSectionName, setNewSectionName] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleBaseRole, setNewRoleBaseRole] = useState("member");
  const [editingRoleId, setEditingRoleId] = useState("");
  const [editingRoleName, setEditingRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [savingRoleEdit, setSavingRoleEdit] = useState(false);
  const [deletingRoleId, setDeletingRoleId] = useState("");
  const [copySourceRole, setCopySourceRole] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const allModules = useMemo(() => getAllOrganizationModules(id), [id]);

  const loadSettings = async ({ showToast = false } = {}) => {
    if (!id) {
      setLoading(false);
      return;
    }

    if (!canManageSettings) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [
        churchSnap,
        visibilitySnap,
        layoutSnap,
        metadataSnap,
        customRolesByChurchIdSnapshot,
        customRolesByChurchIDSnapshot,
        customRolesByOrganizationIdSnapshot,
        allRolesSnapshot,
      ] = await Promise.all([
        getDoc(doc(db, "churches", id)),
        getDoc(doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_VISIBILITY_DOC_ID)),
        getDoc(doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_LAYOUT_DOC_ID)),
        getDoc(doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_METADATA_DOC_ID)),
        getDocs(query(collection(db, "roles"), where("churchId", "==", id))),
        getDocs(query(collection(db, "roles"), where("churchID", "==", id))),
        getDocs(query(collection(db, "roles"), where("organizationId", "==", id))),
        getDocs(collection(db, "roles")),
      ]);

      const customRolesMap = new Map();
      [
        ...customRolesByChurchIdSnapshot.docs,
        ...customRolesByChurchIDSnapshot.docs,
        ...customRolesByOrganizationIdSnapshot.docs,
      ].forEach((roleDoc) => {
        const roleData = roleDoc.data() || {};
        const resolvedName = getRoleNameFromDoc(roleData);
        const roleKey = normalizeCustomRoleKey(roleDoc.id);
        customRolesMap.set(roleKey, {
          id: roleDoc.id,
          key: roleKey,
          name: resolvedName,
          baseRole: String(roleData?.baseRole || roleData?.basedOn || "member").trim().toLowerCase(),
        });
      });

      allRolesSnapshot.docs.forEach((roleDoc) => {
        const roleData = roleDoc.data() || {};
        const scopedChurchId = String(
          roleData?.churchId
          || roleData?.churchID
          || roleData?.organizationId
          || roleData?.idIglesia
          || ""
        ).trim();

        if (String(scopedChurchId) !== String(id)) {
          return;
        }

        const roleKey = normalizeCustomRoleKey(roleDoc.id);
        if (!customRolesMap.has(roleKey)) {
          customRolesMap.set(roleKey, {
            id: roleDoc.id,
            key: roleKey,
            name: getRoleNameFromDoc(roleData),
            baseRole: String(roleData?.baseRole || roleData?.basedOn || "member").trim().toLowerCase(),
          });
        }
      });

      const customRoles = Array.from(customRolesMap.values());
      const customRoleKeyByLower = customRoles.reduce((accumulator, roleData) => {
        accumulator[normalizeCustomRoleKey(roleData.id)] = roleData.key;
        return accumulator;
      }, {});
      const normalizeResolvedRoleKey = (roleKey) => {
        const normalizedKey = String(roleKey || "").trim();
        if (!normalizedKey) {
          return "";
        }

        if (MODULE_VISIBILITY_ROLES.includes(normalizedKey)) {
          return normalizedKey;
        }

        const mappedCustomRoleKey = customRoleKeyByLower[normalizedKey.toLowerCase()];
        if (mappedCustomRoleKey) {
          return mappedCustomRoleKey;
        }

        return "";
      };

      const nextRoleNameMap = customRoles.reduce(
        (accumulator, roleData) => {
          if (!roleData.name) {
            return accumulator;
          }

          return {
            ...accumulator,
            [roleData.key]: roleData.name,
          };
        },
        { ...roleLabels }
      );

      const nextCustomRoleDocIdByKey = customRoles.reduce((accumulator, roleData) => {
        accumulator[roleData.key] = roleData.id;
        return accumulator;
      }, {});

      const nextCustomRoleBaseRoleMap = customRoles.reduce((accumulator, roleData) => {
        accumulator[roleData.key] = String(roleData.baseRole || "member").trim().toLowerCase() || "member";
        return accumulator;
      }, {});

      setRoleNameMap(nextRoleNameMap);
      setCustomRoleIds(customRoles.map((roleData) => roleData.key));
      setCustomRoleDocIdByKey(nextCustomRoleDocIdByKey);
      setCustomRoleBaseRoleMap(nextCustomRoleBaseRoleMap);

      if (churchSnap.exists()) {
        const churchData = churchSnap.data();

        const visibilityData = visibilitySnap.exists()
          ? visibilitySnap.data()?.settings
          : churchData?.[MODULE_VISIBILITY_FIELD];
        const layoutData = layoutSnap.exists()
          ? layoutSnap.data()?.settings
          : churchData?.[MODULE_LAYOUT_FIELD];

        const resolvedRoles = getModuleVisibilityRoleKeys({
          storedVisibilitySettings: visibilityData,
          storedLayoutSettings: layoutData,
          availableRoles: customRoles.map((roleData) => roleData.key),
        });

        const filteredRoles = Array.from(
          new Set(
            resolvedRoles
              .map((roleKey) => normalizeResolvedRoleKey(roleKey))
              .filter(Boolean)
          )
        );

        setAvailableRoles(filteredRoles);
        setVisibilitySettings(mergeModuleVisibilitySettings(visibilityData, filteredRoles));
        setLayoutSettings(mergeModuleLayoutSettings(layoutData, filteredRoles));

        const syncedTimestamp = metadataSnap.exists()
          ? metadataSnap.data()?.updatedAt
          : null;
        setLastSyncedAt(syncedTimestamp?.toDate ? syncedTimestamp.toDate() : new Date());
      } else {
        const resolvedRoles = getModuleVisibilityRoleKeys({
          availableRoles: customRoles.map((roleData) => roleData.key),
        });

        const normalizedRoles = Array.from(
          new Set(
            resolvedRoles
              .map((roleKey) => normalizeResolvedRoleKey(roleKey))
              .filter(Boolean)
          )
        );

        setAvailableRoles(normalizedRoles);
        setVisibilitySettings(mergeModuleVisibilitySettings({}, normalizedRoles));
        setLayoutSettings(mergeModuleLayoutSettings({}, normalizedRoles));
        setLastSyncedAt(new Date());
      }

      if (showToast) {
        toast.success("Settings refreshed from Firestore.");
      }
    } catch (error) {
      console.error("Error loading module settings:", error);
      toast.error("Failed to load module settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [canManageSettings, id]);

  useEffect(() => {
    if (!availableRoles.includes(activeRole)) {
      setActiveRole(availableRoles[0] || "global_admin");
    }
  }, [activeRole, availableRoles]);

  useEffect(() => {
    const sourceRoleOptions = availableRoles.filter((role) => role !== activeRole);
    if (sourceRoleOptions.length === 0) {
      setCopySourceRole("");
      return;
    }

    if (!copySourceRole || copySourceRole === activeRole || !sourceRoleOptions.includes(copySourceRole)) {
      setCopySourceRole(sourceRoleOptions[0]);
    }
  }, [activeRole, availableRoles, copySourceRole]);

  const activeRoleSections = useMemo(() => {
    const roleSections = layoutSettings[activeRole]?.sections || {};

    return Object.entries(roleSections)
      .map(([sectionId, section]) => ({
        id: sectionId,
        title: section.title || sectionId,
        order: parseOrderValue(section.order, 0),
        isVisible: section.isVisible !== false,
        isCustom: section.isCustom === true,
      }))
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
  }, [activeRole, layoutSettings]);

  const activeRoleModules = useMemo(() => {
    const roleLayout = layoutSettings[activeRole]?.modules || {};
    const roleVisibility = visibilitySettings[activeRole] || {};
    const sectionOrderMap = activeRoleSections.reduce((accumulator, section) => {
      accumulator[section.id] = section.order;
      return accumulator;
    }, {});

    return allModules
      .map((module) => {
        const moduleLayout = roleLayout[module.id] || {};
        const resolvedSectionId = activeRoleSections.some((section) => section.id === moduleLayout.sectionId)
          ? moduleLayout.sectionId
          : module.defaultSectionId;

        return {
          ...module,
          customTitle: moduleLayout.title || module.title,
          sectionId: resolvedSectionId,
          order: parseOrderValue(moduleLayout.order, module.defaultOrder),
          visible: roleVisibility[module.id] !== false,
          sectionOrder: parseOrderValue(sectionOrderMap[resolvedSectionId], 999),
        };
      })
      .sort((left, right) => {
        if (left.sectionOrder !== right.sectionOrder) {
          return left.sectionOrder - right.sectionOrder;
        }

        if (left.order !== right.order) {
          return left.order - right.order;
        }

        return left.customTitle.localeCompare(right.customTitle);
      });
  }, [activeRole, activeRoleSections, allModules, layoutSettings, visibilitySettings]);

  const visibleActiveRoleSections = useMemo(
    () => activeRoleSections.filter((section) => section.isVisible !== false),
    [activeRoleSections]
  );

  const hiddenActiveRoleSections = useMemo(
    () => activeRoleSections.filter((section) => section.isVisible === false),
    [activeRoleSections]
  );

  const activeRoleSectionTitleMap = useMemo(() => {
    return activeRoleSections.reduce((accumulator, section) => {
      accumulator[section.id] = section.title || section.id;
      return accumulator;
    }, {});
  }, [activeRoleSections]);

  const hiddenModules = useMemo(() => {
    const hiddenSectionIds = new Set(hiddenActiveRoleSections.map((section) => section.id));

    return activeRoleModules
      .map((module) => {
        const hiddenBySection = hiddenSectionIds.has(module.sectionId);
        const hiddenByModuleToggle = module.visible === false;

        return {
          ...module,
          hiddenBySection,
          hiddenByModuleToggle,
        };
      })
      .filter((module) => module.hiddenBySection || module.hiddenByModuleToggle)
      .sort((left, right) => {
        if (left.hiddenBySection !== right.hiddenBySection) {
          return left.hiddenBySection ? -1 : 1;
        }

        if (left.hiddenByModuleToggle !== right.hiddenByModuleToggle) {
          return left.hiddenByModuleToggle ? -1 : 1;
        }

        return left.customTitle.localeCompare(right.customTitle);
      });
  }, [activeRoleModules, hiddenActiveRoleSections]);

  const getReassignTargetSections = (moduleData) => {
    const currentSectionId = moduleData?.sectionId;
    const options = activeRoleSections.filter((section) => section.isVisible !== false || section.id === currentSectionId);

    if (options.length > 0) {
      return options;
    }

    return activeRoleSections;
  };

  const activeRoleSectionsWithModules = useMemo(() => {
    return visibleActiveRoleSections.map((section) => ({
      ...section,
      modules: activeRoleModules.filter((module) => module.sectionId === section.id),
    }));
  }, [activeRoleModules, visibleActiveRoleSections]);

  const customRoles = useMemo(() => {
    return customRoleIds
      .map((roleId) => ({
        id: roleId,
        label: formatRoleLabel(roleId, roleNameMap),
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [customRoleIds, roleNameMap]);

  const handleCreateRole = async () => {
    const trimmedRoleName = newRoleName.trim();

    if (!trimmedRoleName) {
      toast.error("Enter a role name first.");
      return;
    }

    if (!id || creatingRole) {
      return;
    }

    const duplicateRole = Object.entries(roleNameMap).some(([, value]) =>
      String(value || "").trim().toLowerCase() === trimmedRoleName.toLowerCase()
    );

    if (duplicateRole) {
      toast.error("A role with that name already exists.");
      return;
    }

    setCreatingRole(true);

    try {
      const roleRef = await addDoc(collection(db, "roles"), {
        name: trimmedRoleName,
        baseRole: newRoleBaseRole || "member",
        description: "",
        permissions: {},
        churchId: id,
        createdBy: user?.uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setRoleNameMap((current) => ({
        ...current,
        [normalizeCustomRoleKey(roleRef.id)]: trimmedRoleName,
      }));
      setCustomRoleDocIdByKey((current) => ({
        ...current,
        [normalizeCustomRoleKey(roleRef.id)]: roleRef.id,
      }));
      setCustomRoleBaseRoleMap((current) => ({
        ...current,
        [normalizeCustomRoleKey(roleRef.id)]: String(newRoleBaseRole || "member").trim().toLowerCase(),
      }));
      setCustomRoleIds((current) => {
        const roleKey = normalizeCustomRoleKey(roleRef.id);
        return current.includes(roleKey) ? current : [...current, roleKey];
      });
      setAvailableRoles((current) =>
        current.includes(normalizeCustomRoleKey(roleRef.id))
          ? current
          : [...current, normalizeCustomRoleKey(roleRef.id)]
      );
      setActiveRole(normalizeCustomRoleKey(roleRef.id));

      setNewRoleName("");
      setNewRoleBaseRole("member");
      await loadSettings({ showToast: false });
      toast.success(`Role \"${trimmedRoleName}\" created.`);
    } catch (error) {
      console.error("Error creating role from module settings:", error);
      toast.error("Failed to create role.");
    } finally {
      setCreatingRole(false);
    }
  };

  const handleStartRoleEdit = (roleId) => {
    if (!customRoleIds.includes(roleId)) {
      toast.info("Built-in roles cannot be renamed.");
      return;
    }

    setEditingRoleId(roleId);
    setEditingRoleName(String(roleNameMap[roleId] || "").trim());
  };

  const handleCancelRoleEdit = () => {
    setEditingRoleId("");
    setEditingRoleName("");
  };

  const handleSaveRoleEdit = async () => {
    const trimmedName = String(editingRoleName || "").trim();

    if (!editingRoleId) {
      return;
    }

    if (!trimmedName) {
      toast.error("Role name cannot be empty.");
      return;
    }

    const duplicateRole = Object.entries(roleNameMap).some(([mapKey, value]) => {
      if (String(mapKey) === String(editingRoleId) || String(mapKey).toLowerCase() === String(editingRoleId).toLowerCase()) {
        return false;
      }
      return String(value || "").trim().toLowerCase() === trimmedName.toLowerCase();
    });

    if (duplicateRole) {
      toast.error("A role with that name already exists.");
      return;
    }

    setSavingRoleEdit(true);
    try {
      const roleDocId = customRoleDocIdByKey[editingRoleId] || editingRoleId;
      await updateDoc(doc(db, "roles", roleDocId), {
        name: trimmedName,
        updatedAt: serverTimestamp(),
      });

      setRoleNameMap((current) => ({
        ...current,
        [editingRoleId]: trimmedName,
      }));

      toast.success("Role renamed successfully.");
      handleCancelRoleEdit();
    } catch (error) {
      console.error("Error renaming custom role:", error);
      toast.error("Failed to rename role.");
    } finally {
      setSavingRoleEdit(false);
    }
  };

  const handleDeleteCustomRole = async (roleId) => {
    if (!customRoleIds.includes(roleId)) {
      toast.info("Built-in roles cannot be removed.");
      return;
    }

    const roleLabel = formatRoleLabel(roleId, roleNameMap);
    const confirmed = window.confirm(`Delete role "${roleLabel}"? This removes it from module visibility settings.`);
    if (!confirmed) {
      return;
    }

    setDeletingRoleId(roleId);
    try {
      const roleDocId = customRoleDocIdByKey[roleId] || roleId;
      await deleteDoc(doc(db, "roles", roleDocId));

      setAvailableRoles((current) => current.filter((role) => role !== roleId));
      setCustomRoleIds((current) => current.filter((role) => role !== roleId));
      setRoleNameMap((current) => {
        const nextMap = { ...current };
        delete nextMap[roleId];
        return nextMap;
      });
      setCustomRoleDocIdByKey((current) => {
        const nextMap = { ...current };
        delete nextMap[roleId];
        return nextMap;
      });
      setCustomRoleBaseRoleMap((current) => {
        const nextMap = { ...current };
        delete nextMap[roleId];
        return nextMap;
      });
      setVisibilitySettings((current) => {
        const nextSettings = { ...current };
        delete nextSettings[roleId];
        return nextSettings;
      });
      setLayoutSettings((current) => {
        const nextSettings = { ...current };
        delete nextSettings[roleId];
        return nextSettings;
      });

      if (activeRole === roleId) {
        setActiveRole("global_admin");
      }

      setSaveState("dirty");
      toast.success("Role removed.");
      if (editingRoleId === roleId) {
        handleCancelRoleEdit();
      }
    } catch (error) {
      console.error("Error deleting custom role:", error);
      toast.error("Failed to delete role.");
    } finally {
      setDeletingRoleId("");
    }
  };

  const handleVisibilityChange = (role, moduleId) => {
    setSaveState("dirty");
    setVisibilitySettings((current) => ({
      ...current,
      [role]: {
        ...current[role],
        [moduleId]: !(current[role]?.[moduleId] !== false),
      },
    }));
  };

  const handleSectionChange = (role, sectionId, field, value, fallbackValue) => {
    setSaveState("dirty");
    setLayoutSettings((current) => ({
      ...current,
      [role]: {
        ...current[role],
        sections: {
          ...current[role].sections,
          [sectionId]: {
            ...current[role].sections[sectionId],
            [field]: field === "order" ? parseOrderValue(value, fallbackValue) : value,
          },
        },
      },
    }));
  };

  const handleToggleSectionVisibility = (role, sectionId, isVisible) => {
    setSaveState("dirty");
    setLayoutSettings((current) => ({
      ...current,
      [role]: {
        ...current[role],
        sections: {
          ...current[role].sections,
          [sectionId]: {
            ...current[role].sections[sectionId],
            isVisible: isVisible !== false,
          },
        },
      },
    }));
  };

  const handleAddSection = () => {
    const trimmedName = newSectionName.trim();
    if (!trimmedName) {
      toast.error("Enter a section name first.");
      return;
    }

    let sectionId = createSectionId(trimmedName);
    let suffix = 1;

    while (layoutSettings[activeRole]?.sections?.[sectionId]) {
      suffix += 1;
      sectionId = `${createSectionId(trimmedName)}-${suffix}`;
    }

    const nextOrder = activeRoleSections.length;

    setSaveState("dirty");
    setLayoutSettings((current) => ({
      ...current,
      [activeRole]: {
        ...current[activeRole],
        sections: {
          ...current[activeRole].sections,
          [sectionId]: {
            title: trimmedName,
            order: nextOrder,
            isVisible: true,
            isCustom: true,
          },
        },
      },
    }));

    setNewSectionName("");
  };

  const handleDeleteSection = (role, sectionId) => {
    const sectionData = layoutSettings[role]?.sections?.[sectionId];
    if (!sectionData) {
      return;
    }

    if (sectionData.isCustom !== true) {
      toast.info("Only custom sections can be removed.");
      return;
    }

    const roleSections = Object.entries(layoutSettings[role]?.sections || {})
      .map(([idKey, section]) => ({
        id: idKey,
        title: section?.title || idKey,
        order: parseOrderValue(section?.order, 0),
      }))
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));

    if (roleSections.length <= 1) {
      toast.error("At least one section must remain.");
      return;
    }

    const fallbackSection = roleSections.find((section) => section.id !== sectionId);
    if (!fallbackSection) {
      toast.error("No destination section is available.");
      return;
    }

    const modulesInSection = activeRoleModules.filter((module) => module.sectionId === sectionId);
    const sectionLabel = String(sectionData?.title || sectionId);
    const confirmMessage = modulesInSection.length > 0
      ? `Delete section "${sectionLabel}"? ${modulesInSection.length} module${modulesInSection.length === 1 ? "" : "s"} will be moved to "${fallbackSection.title}".`
      : `Delete section "${sectionLabel}"?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setSaveState("dirty");
    setLayoutSettings((current) => {
      const roleLayout = current[role] || { sections: {}, modules: {} };
      const nextSections = { ...(roleLayout.sections || {}) };
      const nextModules = { ...(roleLayout.modules || {}) };

      delete nextSections[sectionId];

      const normalizedSections = Object.entries(nextSections)
        .map(([idKey, section]) => ({
          id: idKey,
          title: section?.title || idKey,
          order: parseOrderValue(section?.order, 0),
          raw: section || {},
        }))
        .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
        .reduce((accumulator, section, index) => {
          accumulator[section.id] = {
            ...section.raw,
            order: index,
          };
          return accumulator;
        }, {});

      Object.entries(nextModules).forEach(([moduleId, moduleData]) => {
        if (moduleData?.sectionId === sectionId) {
          nextModules[moduleId] = {
            ...moduleData,
            sectionId: fallbackSection.id,
          };
        }
      });

      return {
        ...current,
        [role]: {
          ...roleLayout,
          sections: normalizedSections,
          modules: nextModules,
        },
      };
    });

    toast.success(`Section "${sectionLabel}" removed.`);
  };

  const handleMoveSection = (role, sectionId, direction) => {
    const reorderedSections = moveItem(activeRoleSections, sectionId, direction);

    setSaveState("dirty");

    setLayoutSettings((current) => ({
      ...current,
      [role]: {
        ...current[role],
        sections: reorderedSections.reduce((accumulator, section) => {
          accumulator[section.id] = {
            ...current[role].sections[section.id],
            title: current[role].sections[section.id]?.title || section.title,
            order: section.order,
          };
          return accumulator;
        }, { ...current[role].sections }),
      },
    }));
  };

  const handleModuleChange = (role, moduleId, field, value, fallbackValue) => {
    setSaveState("dirty");
    setLayoutSettings((current) => ({
      ...current,
      [role]: {
        ...current[role],
        modules: {
          ...current[role].modules,
          [moduleId]: {
            ...current[role].modules[moduleId],
            [field]: field === "order" ? parseOrderValue(value, fallbackValue) : value,
          },
        },
      },
    }));
  };

  const handleHiddenModuleReassign = (role, moduleData, targetSectionId) => {
    if (!moduleData?.id || !targetSectionId) {
      return;
    }

    if (moduleData.sectionId === targetSectionId) {
      toast.info("This module is already assigned to that section.");
      return;
    }

    const moduleLabel = moduleData.customTitle || moduleData.title || moduleData.id;
    const currentSectionLabel = activeRoleSectionTitleMap[moduleData.sectionId] || moduleData.sectionId;
    const targetSectionLabel = activeRoleSectionTitleMap[targetSectionId] || targetSectionId;

    const confirmMessage = moduleData.hiddenByModuleToggle
      ? `Reassign "${moduleLabel}" from "${currentSectionLabel}" to "${targetSectionLabel}"? The module is still hidden by the Show toggle until you enable Show.`
      : `Reassign "${moduleLabel}" from "${currentSectionLabel}" to "${targetSectionLabel}"?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    handleModuleChange(role, moduleData.id, "sectionId", targetSectionId, moduleData.order);
    toast.success(`Reassigned "${moduleLabel}" to "${targetSectionLabel}".`);
  };

  const handleMoveModule = (role, moduleId, direction) => {
    const targetModule = activeRoleModules.find((module) => module.id === moduleId);
    if (!targetModule) {
      return;
    }

    const sectionModules = activeRoleModules
      .filter((module) => module.sectionId === targetModule.sectionId)
      .sort((left, right) => left.order - right.order);
    const reorderedModules = moveItem(sectionModules, moduleId, direction);

    setSaveState("dirty");

    setLayoutSettings((current) => ({
      ...current,
      [role]: {
        ...current[role],
        modules: reorderedModules.reduce((accumulator, module) => {
          accumulator[module.id] = {
            ...current[role].modules[module.id],
            title: current[role].modules[module.id]?.title || module.customTitle,
            sectionId: current[role].modules[module.id]?.sectionId || module.sectionId,
            order: module.order,
          };
          return accumulator;
        }, { ...current[role].modules }),
      },
    }));
  };

  const handleCopySettingsFromRole = () => {
    if (!copySourceRole) {
      toast.error("Select a source role first.");
      return;
    }

    if (copySourceRole === activeRole) {
      toast.error("Choose a different source role.");
      return;
    }

    const sourceRoleLabel = formatRoleLabel(copySourceRole, roleNameMap);
    const targetRoleLabel = formatRoleLabel(activeRole, roleNameMap);
    const confirmed = window.confirm(
      `Copy all module visibility and layout settings from "${sourceRoleLabel}" to "${targetRoleLabel}"?`
    );

    if (!confirmed) {
      return;
    }

    const sourceVisibility = visibilitySettings[copySourceRole] || {};
    const sourceLayout = layoutSettings[copySourceRole] || {};

    setSaveState("dirty");
    setVisibilitySettings((current) => ({
      ...current,
      [activeRole]: { ...sourceVisibility },
    }));
    setLayoutSettings((current) => ({
      ...current,
      [activeRole]: cloneRoleLayout(sourceLayout),
    }));

    toast.success(`Copied settings from ${sourceRoleLabel} to ${targetRoleLabel}.`);
  };

  const persistSettings = async ({ successMessage, refreshAfterSave = false } = {}) => {
    if (!id) {
      return false;
    }

    const updatedBy = {
      uid: user?.uid || "",
      email: user?.email || "",
    };

    await Promise.all([
      setDoc(
        doc(db, "churches", id),
        {
          [MODULE_VISIBILITY_FIELD]: visibilitySettings,
          [MODULE_LAYOUT_FIELD]: layoutSettings,
          miOrganizacionRoleNameMap: roleNameMap,
          miOrganizacionRoleBaseRoleMap: {
            global_admin: "global_admin",
            admin: "admin",
            member: "member",
            ...customRoleBaseRoleMap,
          },
        },
        { merge: true }
      ),
      setDoc(
        doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_VISIBILITY_DOC_ID),
        {
          settings: visibilitySettings,
          updatedAt: serverTimestamp(),
          updatedBy,
        },
        { merge: true }
      ),
      setDoc(
        doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_LAYOUT_DOC_ID),
        {
          settings: layoutSettings,
          updatedAt: serverTimestamp(),
          updatedBy,
        },
        { merge: true }
      ),
      setDoc(
        doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_METADATA_DOC_ID),
        {
          updatedAt: serverTimestamp(),
          updatedBy,
          schemaVersion: 2,
          source: "module-visibility-settings",
          roleNameMap,
          roleBaseRoleMap: {
            global_admin: "global_admin",
            admin: "admin",
            member: "member",
            ...customRoleBaseRoleMap,
          },
        },
        { merge: true }
      ),
    ]);

    if (refreshAfterSave) {
      await loadSettings();
    } else {
      setLastSyncedAt(new Date());
    }
    setSaveState("saved");

    if (successMessage) {
      toast.success(successMessage);
    }

    return true;
  };

  const navigateBackToOrganization = async () => {
    if (!id) {
      navigate(`${routePrefix}/${id}/mi-organizacion`);
      return;
    }

    if (saving) {
      toast.info("Saving in progress. Please wait a moment...");
      return;
    }

    if (saveState === "dirty") {
      setSaving(true);

      try {
        await persistSettings();
      } catch (error) {
        console.error("Error saving before leaving settings:", error);
        toast.error("Could not save the latest changes. Staying on this page.");
        return;
      } finally {
        setSaving(false);
      }
    }

    navigate(`${routePrefix}/${id}/mi-organizacion`);
  };

  const handleSaveNow = async () => {
    if (saving) {
      toast.info("Saving in progress. Please wait a moment...");
      return;
    }

    if (saveState !== "dirty") {
      toast.info("No pending changes to save.");
      return;
    }

    setSaving(true);
    try {
      await persistSettings({ successMessage: "Changes saved." });
    } catch (error) {
      console.error("Error saving module settings:", error);
      toast.error("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!canManageSettings || !id || saveState !== "dirty" || saving || loading) {
      return;
    }

    const timer = setTimeout(async () => {
      setSaving(true);

      try {
        await persistSettings();
      } catch (error) {
        console.error("Error auto-saving module settings:", error);
        toast.error("Failed to auto-save module settings.");
      } finally {
        setSaving(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [canManageSettings, id, layoutSettings, loading, saveState, saving, visibilitySettings]);

  useEffect(() => {
    const hasUnsavedChanges = saveState === "dirty" || saving;
    if (!hasUnsavedChanges) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveState, saving]);

  if (!canManageSettings) {
    return (
      <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem" }}>
        <button
          type="button"
          onClick={navigateBackToOrganization}
          style={{
            ...commonStyles.backButtonLink,
            border: "none",
            background: "transparent",
            color: "#1D4ED8",
            width: "auto",
            padding: 0,
            marginBottom: "12px",
            textDecoration: "underline",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ← Back to My Organization
        </button>
        <div
          style={{
            backgroundColor: "white",
            border: "1px solid #E5E7EB",
            borderRadius: "16px",
            padding: "24px",
            marginTop: "2rem",
            boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
          }}
        >
          <h1 style={{ ...commonStyles.title, marginBottom: "12px" }}>Module Layout Settings</h1>
          <p style={{ color: "#475569", margin: 0 }}>
            You do not have permission to manage module layout settings for this organization.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...commonStyles.fullWidthContainer, paddingTop: "2rem", paddingBottom: "3rem" }}>
      <button
        type="button"
        onClick={navigateBackToOrganization}
        style={{
          ...commonStyles.backButtonLink,
          border: "none",
          background: "transparent",
          color: "#1D4ED8",
          width: "auto",
          padding: 0,
          marginBottom: "12px",
          textDecoration: "underline",
          fontWeight: 700,
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.75 : 1,
        }}
        disabled={saving}
      >
        ← Back to My Organization
      </button>

      <div
        style={{
          background: "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)",
          border: "1px solid #E2E8F0",
          borderRadius: "20px",
          padding: "24px",
          marginTop: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ ...commonStyles.title, marginBottom: "8px" }}>Module Layout Settings</h1>
            <p style={{ color: "#475569", maxWidth: "760px", margin: 0 }}>
              Reorder sections, rename section headings, rename modules, move modules between sections, and control visibility for built-in and custom roles. New modules added to the shared registry will appear here automatically.
            </p>
            <div style={{ marginTop: "10px", fontSize: "0.92rem", color: saveState === "saved" ? "#047857" : "#475569", fontWeight: 600 }}>
              {saving
                ? "Saving changes..."
                : saveState === "saved"
                ? `Saved to Firestore${lastSyncedAt ? ` at ${formatSyncTime(lastSyncedAt)}` : ""}.`
                : saveState === "dirty"
                ? "Changes detected. Auto-save starts shortly..."
                : lastSyncedAt
                ? `Last refreshed from Firestore at ${formatSyncTime(lastSyncedAt)}.`
                : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleSaveNow}
              disabled={saving || loading}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: "none",
                backgroundColor: saving || loading ? "#94A3B8" : "#0F766E",
                cursor: saving || loading ? "not-allowed" : "pointer",
                color: "white",
                fontWeight: 700,
                opacity: saving || loading ? 0.8 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={() => loadSettings({ showToast: true })}
              disabled={saving || loading}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: "1px solid #CBD5E1",
                backgroundColor: "#F8FAFC",
                cursor: saving || loading ? "not-allowed" : "pointer",
                color: "#0F172A",
                fontWeight: 600,
                opacity: saving || loading ? 0.7 : 1,
              }}
            >
              Refresh Saved Settings
            </button>
            <button
              onClick={navigateBackToOrganization}
              disabled={saving}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: "1px solid #CBD5E1",
                backgroundColor: "white",
                cursor: saving ? "not-allowed" : "pointer",
                color: "#0F172A",
                fontWeight: 600,
                opacity: saving ? 0.75 : 1,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {availableRoles.map((role) => {
          const isActive = activeRole === role;
          const isCustomRole = customRoleIds.includes(role);

          return (
            <div
              key={role}
              style={{
                display: "inline-flex",
                alignItems: "center",
                overflow: "hidden",
                borderRadius: "999px",
                border: isActive ? "1px solid #1D4ED8" : "1px solid #CBD5E1",
                backgroundColor: isActive ? "#DBEAFE" : "white",
              }}
            >
              <button
                type="button"
                onClick={() => setActiveRole(role)}
                style={{
                  padding: "10px 14px",
                  border: "none",
                  backgroundColor: "transparent",
                  color: isActive ? "#1D4ED8" : "#0F172A",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {formatRoleLabel(role, roleNameMap)}
              </button>
              {isCustomRole && (
                <button
                  type="button"
                  onClick={() => handleDeleteCustomRole(role)}
                  disabled={deletingRoleId === role}
                  title={`Delete ${formatRoleLabel(role, roleNameMap)}`}
                  style={{
                    border: "none",
                    borderLeft: "1px solid rgba(0, 0, 0, 0.08)",
                    backgroundColor: deletingRoleId === role ? "#FCA5A5" : "#FEE2E2",
                    color: deletingRoleId === role ? "white" : "#B91C1C",
                    padding: "10px 10px",
                    fontWeight: 800,
                    cursor: deletingRoleId === role ? "not-allowed" : "pointer",
                  }}
                >
                  {deletingRoleId === role ? "..." : "x"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {activeRole && customRoleIds.includes(activeRole) && (
        <div
          style={{
            marginTop: "-0.75rem",
            marginBottom: "1.25rem",
            backgroundColor: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: "12px",
            padding: "12px",
            display: "flex",
            gap: "8px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 600, color: "#334155" }}>Edit Role:</div>
          {editingRoleId === activeRole ? (
            <>
              <input
                type="text"
                value={editingRoleName}
                onChange={(event) => setEditingRoleName(event.target.value)}
                placeholder="Role name"
                style={{
                  flex: "1 1 240px",
                  minWidth: "220px",
                  padding: "9px 10px",
                  borderRadius: "8px",
                  border: "1px solid #CBD5E1",
                  backgroundColor: "white",
                }}
              />
              <button
                type="button"
                onClick={handleSaveRoleEdit}
                disabled={savingRoleEdit}
                style={{
                  padding: "9px 14px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: savingRoleEdit ? "#94A3B8" : "#1D4ED8",
                  color: "white",
                  fontWeight: 700,
                  cursor: savingRoleEdit ? "not-allowed" : "pointer",
                }}
              >
                {savingRoleEdit ? "Saving..." : "Save Name"}
              </button>
              <button
                type="button"
                onClick={handleCancelRoleEdit}
                style={{
                  padding: "9px 14px",
                  borderRadius: "8px",
                  border: "1px solid #CBD5E1",
                  backgroundColor: "white",
                  color: "#334155",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleStartRoleEdit(activeRole)}
                style={{
                  padding: "9px 14px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#1D4ED8",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Rename Role
              </button>
              <button
                type="button"
                onClick={() => handleDeleteCustomRole(activeRole)}
                disabled={deletingRoleId === activeRole}
                style={{
                  padding: "9px 14px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: deletingRoleId === activeRole ? "#FCA5A5" : "#DC2626",
                  color: "white",
                  fontWeight: 700,
                  cursor: deletingRoleId === activeRole ? "not-allowed" : "pointer",
                }}
              >
                {deletingRoleId === activeRole ? "Removing..." : "Delete Role"}
              </button>
            </>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: "-0.5rem",
          marginBottom: "1.25rem",
          backgroundColor: "#F8FAFC",
          border: "1px solid #E2E8F0",
          borderRadius: "12px",
          padding: "12px",
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 600, color: "#334155" }}>Add Role:</div>
        <input
          type="text"
          value={newRoleName}
          onChange={(event) => setNewRoleName(event.target.value)}
          placeholder="Role name (e.g. Team Lead)"
          style={{
            flex: "1 1 260px",
            minWidth: "220px",
            padding: "9px 10px",
            borderRadius: "8px",
            border: "1px solid #CBD5E1",
            backgroundColor: "white",
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleCreateRole();
            }
          }}
        />
        <select
          value={newRoleBaseRole}
          onChange={(event) => setNewRoleBaseRole(event.target.value)}
          style={{
            flex: "0 0 200px",
            minWidth: "180px",
            padding: "9px 10px",
            borderRadius: "8px",
            border: "1px solid #CBD5E1",
            backgroundColor: "white",
          }}
        >
          <option value="member">Based On: Member</option>
          <option value="admin">Based On: Admin</option>
          <option value="global_admin">Based On: Global Admin</option>
        </select>
        <button
          type="button"
          onClick={handleCreateRole}
          disabled={creatingRole}
          style={{
            padding: "9px 14px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: creatingRole ? "#94A3B8" : "#0F766E",
            color: "white",
            fontWeight: 700,
            cursor: creatingRole ? "not-allowed" : "pointer",
          }}
        >
          {creatingRole ? "Creating..." : "Create Role"}
        </button>
      </div>

      <div
        style={{
          marginTop: "-0.5rem",
          marginBottom: "1.25rem",
          backgroundColor: "#F8FAFC",
          border: "1px solid #E2E8F0",
          borderRadius: "12px",
          padding: "12px",
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 600, color: "#334155" }}>Copy Exact Settings:</div>
        <select
          value={copySourceRole}
          onChange={(event) => setCopySourceRole(event.target.value)}
          disabled={availableRoles.filter((role) => role !== activeRole).length === 0}
          style={{
            flex: "1 1 260px",
            minWidth: "220px",
            padding: "9px 10px",
            borderRadius: "8px",
            border: "1px solid #CBD5E1",
            backgroundColor: "white",
          }}
        >
          {availableRoles
            .filter((role) => role !== activeRole)
            .map((role) => (
              <option key={role} value={role}>
                {formatRoleLabel(role, roleNameMap)}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={handleCopySettingsFromRole}
          disabled={!copySourceRole || saving || loading || availableRoles.filter((role) => role !== activeRole).length === 0}
          style={{
            padding: "9px 14px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: !copySourceRole || saving || loading ? "#94A3B8" : "#2563EB",
            color: "white",
            fontWeight: 700,
            cursor: !copySourceRole || saving || loading ? "not-allowed" : "pointer",
          }}
        >
          Copy To {formatRoleLabel(activeRole, roleNameMap)}
        </button>
      </div>

      <div
        style={{
          marginTop: "-0.5rem",
          marginBottom: "1.25rem",
          backgroundColor: "#F8FAFC",
          border: "1px solid #E2E8F0",
          borderRadius: "12px",
          padding: "12px",
        }}
      >
        <div style={{ fontWeight: 700, color: "#334155", marginBottom: "10px" }}>Custom Roles</div>
        {customRoles.length === 0 ? (
          <div style={{ color: "#64748B", fontSize: "0.92rem" }}>
            No custom roles created yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: "8px" }}>
            {customRoles.map((roleItem) => (
              <div
                key={roleItem.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  backgroundColor: "white",
                  border: "1px solid #E2E8F0",
                  borderRadius: "8px",
                  padding: "9px 10px",
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveRole(roleItem.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#0F172A",
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                    padding: 0,
                  }}
                >
                  {roleItem.label}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteCustomRole(roleItem.id)}
                  disabled={deletingRoleId === roleItem.id}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: deletingRoleId === roleItem.id ? "#FCA5A5" : "#DC2626",
                    color: "white",
                    fontWeight: 700,
                    cursor: deletingRoleId === roleItem.id ? "not-allowed" : "pointer",
                  }}
                >
                  {deletingRoleId === roleItem.id ? "Removing..." : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div
          style={{
            backgroundColor: "white",
            border: "1px solid #E5E7EB",
            borderRadius: "16px",
            padding: "24px",
            color: "#64748B",
          }}
        >
          Loading module settings...
        </div>
      ) : (
        <>
          <div
            style={{
              backgroundColor: "white",
              border: "1px solid #E5E7EB",
              borderRadius: "18px",
              padding: "20px",
              marginBottom: "1.5rem",
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "1.15rem", color: "#0F172A" }}>
                Module Layout for {formatRoleLabel(activeRole, roleNameMap)}
            </h2>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
              <input
                type="text"
                value={newSectionName}
                onChange={(event) => setNewSectionName(event.target.value)}
                placeholder="Add a new section"
                style={{
                  flex: "1 1 260px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #CBD5E1",
                }}
              />
              <button
                type="button"
                onClick={handleAddSection}
                style={{
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#0F766E",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Add Section
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
              {activeRoleSections.map((section, index) => (
                <div
                  key={section.id}
                  style={{
                    border: "1px solid #E2E8F0",
                    borderRadius: "14px",
                    padding: "14px",
                    backgroundColor: "#F8FAFC",
                  }}
                >
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", marginBottom: "8px" }}>
                    Section {index + 1}{section.isCustom ? " • Custom" : ""}
                  </div>
                  <label style={{ display: "block", marginBottom: "10px" }}>
                    <div style={{ fontSize: "0.84rem", color: "#334155", marginBottom: "6px", fontWeight: 600 }}>
                      Section Title
                    </div>
                    <input
                      type="text"
                      value={section.title}
                      onChange={(event) =>
                        handleSectionChange(activeRole, section.id, "title", event.target.value, section.order)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <input
                      type="checkbox"
                      checked={section.isVisible !== false}
                      onChange={(event) =>
                        handleToggleSectionVisibility(activeRole, section.id, event.target.checked)
                      }
                      style={{ width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "0.9rem", color: "#334155", fontWeight: 600 }}>
                      Show this section
                    </span>
                  </label>
                  <div style={{ fontSize: "0.8rem", color: "#64748B", marginBottom: "10px" }}>
                    Section visibility is applied on My Organization automatically after changes are saved.
                  </div>
                  {section.isCustom === true && (
                    <div style={{ marginBottom: "10px" }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteSection(activeRole, section.id)}
                        style={{
                          width: "100%",
                          padding: "9px 12px",
                          borderRadius: "8px",
                          border: "1px solid #FECACA",
                          backgroundColor: "#FEF2F2",
                          color: "#B91C1C",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Remove Section
                      </button>
                    </div>
                  )}
                  <label style={{ display: "block" }}>
                    <div style={{ fontSize: "0.84rem", color: "#334155", marginBottom: "6px", fontWeight: 600 }}>
                      Section Position
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => handleMoveSection(activeRole, section.id, "up")}
                        disabled={index === 0}
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "8px",
                          border: "1px solid #CBD5E1",
                          backgroundColor: index === 0 ? "#E2E8F0" : "white",
                          cursor: index === 0 ? "not-allowed" : "pointer",
                          fontSize: "1rem",
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveSection(activeRole, section.id, "down")}
                        disabled={index === activeRoleSections.length - 1}
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "8px",
                          border: "1px solid #CBD5E1",
                          backgroundColor: index === activeRoleSections.length - 1 ? "#E2E8F0" : "white",
                          cursor: index === activeRoleSections.length - 1 ? "not-allowed" : "pointer",
                          fontSize: "1rem",
                        }}
                      >
                        ↓
                      </button>
                      <div style={{ color: "#475569", fontWeight: 600 }}>#{index + 1}</div>
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>

          {hiddenModules.length > 0 && (
            <div
              style={{
                backgroundColor: "#FFF7ED",
                border: "1px solid #FED7AA",
                borderRadius: "18px",
                padding: "20px",
                marginBottom: "1.5rem",
                boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
              }}
            >
              <div style={{ marginBottom: "10px" }}>
                <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#9A3412" }}>
                  Hidden Modules
                </h2>
              </div>
              <p style={{ marginTop: 0, marginBottom: "12px", color: "#7C2D12" }}>
                This list includes modules hidden by section visibility and modules hidden with the Show toggle.
              </p>
              {visibleActiveRoleSections.length === 0 && (
                <div style={{ color: "#7C2D12", fontWeight: 600, marginBottom: "12px" }}>
                  All sections are hidden. Make at least one section visible before reassigning modules.
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "white", borderRadius: "12px" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "12px 14px", color: "#9A3412", minWidth: "220px" }}>Module</th>
                      <th style={{ textAlign: "left", padding: "12px 14px", color: "#9A3412", minWidth: "210px" }}>Hidden Because</th>
                      <th style={{ textAlign: "left", padding: "12px 14px", color: "#9A3412", minWidth: "190px" }}>Current Section</th>
                      <th style={{ textAlign: "left", padding: "12px 14px", color: "#9A3412", minWidth: "200px" }}>Reassign To</th>
                      <th style={{ textAlign: "center", padding: "12px 14px", color: "#9A3412", minWidth: "120px" }}>Show</th>
                      <th style={{ textAlign: "center", padding: "12px 14px", color: "#9A3412", minWidth: "140px" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hiddenModules.map((module, index) => {
                      const reassignTargetSections = getReassignTargetSections(module);
                      const hiddenReasons = [
                        module.hiddenBySection ? "Section hidden" : "",
                        module.hiddenByModuleToggle ? "Module hidden" : "",
                      ].filter(Boolean).join(" + ");

                      return (
                        <tr key={`hidden-module-${module.id}`} style={{ borderTop: index === 0 ? "none" : "1px solid #FED7AA" }}>
                          <td style={{ padding: "14px" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                              <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>{module.icon}</span>
                              <div>
                                <div style={{ fontWeight: 700, color: "#7C2D12", marginBottom: "4px" }}>{module.customTitle || module.title}</div>
                                <div style={{ color: "#9A3412", fontSize: "0.9rem" }}>{module.description}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "14px", color: "#9A3412", fontWeight: 600 }}>
                            {hiddenReasons}
                          </td>
                          <td style={{ padding: "14px", color: "#9A3412", fontWeight: 600 }}>
                            {activeRoleSectionTitleMap[module.sectionId] || module.sectionId}
                          </td>
                          <td style={{ padding: "14px" }}>
                            <select
                              value={module.sectionId}
                              disabled={reassignTargetSections.length <= 1}
                              onChange={(event) =>
                                handleHiddenModuleReassign(activeRole, module, event.target.value)
                              }
                              style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #FDBA74", backgroundColor: "white" }}
                            >
                              {reassignTargetSections.map((targetSection) => (
                                <option key={targetSection.id} value={targetSection.id}>
                                  {targetSection.title}{targetSection.isVisible === false ? " (hidden)" : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "14px", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={module.visible}
                              onChange={() => handleVisibilityChange(activeRole, module.id)}
                              style={{ width: "18px", height: "18px", cursor: "pointer" }}
                            />
                          </td>
                          <td style={{ padding: "14px", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={handleSaveNow}
                              disabled={saving || loading}
                              style={{
                                padding: "8px 12px",
                                borderRadius: "8px",
                                border: "none",
                                backgroundColor: saving || loading ? "#94A3B8" : "#0F766E",
                                color: "white",
                                fontWeight: 700,
                                cursor: saving || loading ? "not-allowed" : "pointer",
                                opacity: saving || loading ? 0.8 : 1,
                              }}
                              title={saveState !== "dirty" ? "No pending changes" : "Save now"}
                            >
                              {saving ? "Saving..." : "Apply"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div
            style={{
              backgroundColor: "white",
              border: "1px solid #E5E7EB",
              borderRadius: "18px",
              padding: "20px",
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <h2 style={{ margin: 0, fontSize: "1.15rem", color: "#0F172A" }}>
                Module Layout for {formatRoleLabel(activeRole, roleNameMap)}
              </h2>
            </div>
            <div style={{ display: "grid", gap: "16px" }}>
              {activeRoleSectionsWithModules.map((section) => (
                <div
                  key={section.id}
                  style={{
                    border: "1px solid #E2E8F0",
                    borderRadius: "16px",
                    overflow: "hidden",
                    backgroundColor: section.isVisible === false ? "#F8FAFC" : "white",
                  }}
                >
                  <div
                    style={{
                      padding: "14px 16px",
                      borderBottom: "1px solid #E5E7EB",
                      backgroundColor: section.isVisible === false ? "#F1F5F9" : "#F8FAFC",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: "1 1 280px" }}>
                      <label style={{ display: "block", marginBottom: "6px" }}>
                        <div style={{ fontSize: "0.78rem", color: "#64748B", fontWeight: 700, marginBottom: "6px" }}>
                          Section Name
                        </div>
                        <input
                          type="text"
                          value={section.title}
                          onChange={(event) =>
                            handleSectionChange(activeRole, section.id, "title", event.target.value, section.order)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          style={{
                            width: "100%",
                            maxWidth: "320px",
                            padding: "9px 10px",
                            borderRadius: "8px",
                            border: "1px solid #CBD5E1",
                            backgroundColor: "white",
                            fontWeight: 600,
                            color: "#0F172A",
                          }}
                        />
                      </label>
                      <div style={{ fontSize: "0.84rem", color: "#64748B" }}>
                        {section.modules.length} module{section.modules.length === 1 ? "" : "s"}
                        {section.isVisible === false ? " • hidden section" : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: "0.84rem", color: "#64748B", fontWeight: 600 }}>
                      Section #{section.order + 1}
                    </div>
                  </div>

                  {section.modules.length === 0 ? (
                    <div style={{ padding: "16px", color: "#64748B" }}>
                      No modules assigned to this section yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "14px 16px", color: "#334155", minWidth: "220px" }}>Module</th>
                            <th style={{ textAlign: "center", padding: "14px 16px", color: "#334155", minWidth: "90px" }}>Show</th>
                            <th style={{ textAlign: "left", padding: "14px 16px", color: "#334155", minWidth: "220px" }}>Display Name</th>
                            <th style={{ textAlign: "left", padding: "14px 16px", color: "#334155", minWidth: "180px" }}>Move To</th>
                            <th style={{ textAlign: "left", padding: "14px 16px", color: "#334155", minWidth: "150px" }}>Position</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.modules.map((module, index) => (
                            <tr key={module.id} style={{ borderTop: index === 0 ? "none" : "1px solid #E5E7EB" }}>
                              <td style={{ padding: "16px" }}>
                                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                                  <span style={{ fontSize: "1.25rem", lineHeight: 1 }}>{module.icon}</span>
                                  <div>
                                    <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "4px" }}>{module.title}</div>
                                    <div style={{ color: "#64748B", fontSize: "0.92rem" }}>{module.description}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: "16px", textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={module.visible}
                                  onChange={() => handleVisibilityChange(activeRole, module.id)}
                                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
                                />
                              </td>
                              <td style={{ padding: "16px" }}>
                                <input
                                  type="text"
                                  value={module.customTitle}
                                  onChange={(event) =>
                                    handleModuleChange(activeRole, module.id, "title", event.target.value, module.order)
                                  }
                                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                                />
                              </td>
                              <td style={{ padding: "16px" }}>
                                <select
                                  value={module.sectionId}
                                  onChange={(event) =>
                                    handleModuleChange(activeRole, module.id, "sectionId", event.target.value, module.order)
                                  }
                                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", backgroundColor: "white" }}
                                >
                                  {activeRoleSections.map((targetSection) => (
                                    <option key={targetSection.id} value={targetSection.id}>
                                      {targetSection.title}{targetSection.isVisible === false ? " (hidden)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: "16px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveModule(activeRole, module.id, "up")}
                                    disabled={index === 0}
                                    style={{
                                      width: "40px",
                                      height: "40px",
                                      borderRadius: "8px",
                                      border: "1px solid #CBD5E1",
                                      backgroundColor: index === 0 ? "#E2E8F0" : "white",
                                      cursor: index === 0 ? "not-allowed" : "pointer",
                                      fontSize: "1rem",
                                    }}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveModule(activeRole, module.id, "down")}
                                    disabled={index === section.modules.length - 1}
                                    style={{
                                      width: "40px",
                                      height: "40px",
                                      borderRadius: "8px",
                                      border: "1px solid #CBD5E1",
                                      backgroundColor: index === section.modules.length - 1 ? "#E2E8F0" : "white",
                                      cursor: index === section.modules.length - 1 ? "not-allowed" : "pointer",
                                      fontSize: "1rem",
                                    }}
                                  >
                                    ↓
                                  </button>
                                  <div style={{ color: "#475569", fontWeight: 600 }}>#{index + 1}</div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ModuleVisibilitySettings;