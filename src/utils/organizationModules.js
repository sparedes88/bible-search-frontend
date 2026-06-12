export const MODULE_VISIBILITY_FIELD = "miOrganizacionModuleVisibility";
export const MODULE_LAYOUT_FIELD = "miOrganizacionModuleLayout";
export const MODULE_VISIBILITY_ROLES = ["global_admin", "member"];
export const MODULE_SETTINGS_SUBCOLLECTION = "settings";
export const MODULE_VISIBILITY_DOC_ID = "miOrganizacionModuleVisibility";
export const MODULE_LAYOUT_DOC_ID = "miOrganizacionModuleLayout";
export const MODULE_METADATA_DOC_ID = "miOrganizacionModuleMeta";

const SYSTEM_ROLE_ALIASES = {
  system_global_admin: "global_admin",
  system_admin: "global_admin",
  system_member: "member",
};

const LEGACY_MODULE_ID_ALIASES = {
  timerotate: "time-rotate",
  timeRotate: "time-rotate",
  time_rotate: "time-rotate",
};

const normalizeStoredModuleId = (moduleId) =>
  LEGACY_MODULE_ID_ALIASES[moduleId] || moduleId;

const normalizeRoleKey = (role) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!normalizedRole) {
    return "";
  }

  return SYSTEM_ROLE_ALIASES[normalizedRole] || normalizedRole;
};

const getUniqueRoles = (roles = []) => {
  const seen = new Set();

  return roles.reduce((accumulator, role) => {
    const normalizedRole = normalizeRoleKey(role);
    if (!normalizedRole || seen.has(normalizedRole)) {
      return accumulator;
    }

    seen.add(normalizedRole);
    accumulator.push(normalizedRole);
    return accumulator;
  }, []);
};

export const getModuleVisibilityRoleKeys = ({
  storedVisibilitySettings,
  storedLayoutSettings,
  availableRoles,
} = {}) => {
  const storedVisibilityRoles = Object.keys(storedVisibilitySettings || {});
  const storedLayoutRoles = Object.keys(storedLayoutSettings || {});

  return getUniqueRoles([
    ...MODULE_VISIBILITY_ROLES,
    ...(availableRoles || []),
    ...storedVisibilityRoles,
    ...storedLayoutRoles,
  ]);
};

const normalizeVisibilityRoleSettings = (roleSettings = {}) =>
  Object.entries(roleSettings).reduce((accumulator, [moduleId, isVisible]) => {
    accumulator[normalizeStoredModuleId(moduleId)] = isVisible;
    return accumulator;
  }, {});

const normalizeLayoutRoleModules = (roleModules = {}) =>
  Object.entries(roleModules).reduce((accumulator, [moduleId, moduleSettings]) => {
    const normalizedModuleId = normalizeStoredModuleId(moduleId);
    const previousSettings = accumulator[normalizedModuleId] || {};

    accumulator[normalizedModuleId] = {
      ...previousSettings,
      ...(moduleSettings || {}),
    };

    return accumulator;
  }, {});

const createModule = ({
  id,
  title,
  description,
  icon,
  buildPath,
  openInNewTab,
  requiresPermission,
  defaultVisibilityByRole,
}) => ({
  id,
  title,
  description,
  icon,
  buildPath,
  openInNewTab: Boolean(openInNewTab),
  requiresPermission,
  defaultVisibilityByRole: {
    global_admin: true,
    member: false,
    ...(defaultVisibilityByRole || {}),
  },
});

const organizationModuleDefinitions = [
  {
    id: "coordination",
    title: "Coordination",
    cards: [
      createModule({
        id: "my-sunday",
        title: "My Sunday",
        description: "Plan Sunday services with sections, files, and notes",
        icon: "📖",
        buildPath: (organizationId) => `/organization/${organizationId}/my-sunday`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "all-events",
        title: "Events",
        description: "Manage and coordinate organization events",
        icon: "📅",
        buildPath: (organizationId) => `/organization/${organizationId}/all-events`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "easy-projector",
        title: "EasyProjector",
        description: "Create and manage presentations",
        icon: "🎥",
        buildPath: (organizationId) => `/organization/${organizationId}/easy-projector`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "teams",
        title: "Teams",
        description: "Organize serving teams",
        icon: "👥",
        buildPath: (organizationId) => `/organization/${organizationId}/teams`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "discipleship",
        title: "Discipleship",
        description: "See who is discipling who and assign new disciples",
        icon: "🧭",
        buildPath: (organizationId) => `/organization/${organizationId}/discipleship`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "evangelism-outreach",
        title: "Evangelism Outreach",
        description: "Add outreach contacts and search people you have met",
        icon: "📣",
        buildPath: (organizationId) => `/organization/${organizationId}/evangelism-outreach`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "song-manager",
        title: "Song Manager",
        description: "Create and edit songs for presentations",
        icon: "🎵",
        buildPath: (organizationId) => `/organization/${organizationId}/song-manager`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "admin-connect",
        title: "Connection Center",
        description: "Manage visitors and connections",
        icon: "🔗",
        buildPath: (organizationId) => `/organization/${organizationId}/admin-connect`,
      }),
    ],
  },
  {
    id: "tools",
    title: "Tools",
    cards: [
      createModule({
        id: "user-dashboard",
        title: "Personal BI Dashboard",
        description: "Track your progress and get AI-powered growth insights",
        icon: "📊",
        buildPath: (organizationId) => `/organization/${organizationId}/user-dashboard`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "rooms",
        title: "Rooms",
        description: "Manage organization rooms and spaces",
        icon: "🏠",
        buildPath: (organizationId) => `/organization/${organizationId}/rooms`,
      }),
      createModule({
        id: "campuses",
        title: "Campuses",
        description: "Manage campus locations and addresses",
        icon: "🏫",
        buildPath: (organizationId) => `/organization/${organizationId}/campuses`,
      }),
      createModule({
        id: "inventory",
        title: "Inventory",
        description: "Track equipment and supplies",
        icon: "📦",
        buildPath: (organizationId) => `/organization/${organizationId}/inventory`,
      }),
      createModule({
        id: "finances",
        title: "Finances",
        description: "Manage income and expenses",
        icon: "💰",
        buildPath: (organizationId) => `/organization/${organizationId}/finances`,
      }),
      createModule({
        id: "budget",
        title: "Budget",
        description: "Plan and track organization budgets",
        icon: "📒",
        buildPath: (organizationId) => `/organization/${organizationId}/budget`,
      }),
      createModule({
        id: "maintenance",
        title: "Maintenance",
        description: "Track repairs and improvements",
        icon: "🔧",
        buildPath: (organizationId) => `/organization/${organizationId}/maintenance`,
      }),
      createModule({
        id: "build-my-church",
        title: "Build my Organization",
        description: "Post and track building tasks and improvements",
        icon: "🏗️",
        buildPath: (organizationId) => `/organization/${organizationId}/build-my-church`,
      }),
      createModule({
        id: "asistente-pastoral",
        title: "AI Assistant",
        description: "Use AI to help with pastoral tasks",
        icon: "🤖",
        buildPath: (organizationId) => `/organization/${organizationId}/asistente-pastoral`,
      }),
      createModule({
        id: "pastortech",
        title: "PastorTech",
        description: "Teach Gemini from organization docs, images, and notes, then chat with the knowledge base",
        icon: "🧠",
        buildPath: (organizationId) => `/organization/${organizationId}/pastortech`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "donors",
        title: "Donors",
        description: "Upload and manage donor lists",
        icon: "🧾",
        buildPath: (organizationId) => `/organization/${organizationId}/donors`,
      }),
      createModule({
        id: "course-analytics",
        title: "Course Analytics",
        description: "View congregation progress statistics and insights",
        icon: "📊",
        buildPath: (organizationId) => `/organization/${organizationId}/course-analytics`,
      }),
      createModule({
        id: "leica",
        title: "Leica",
        description: "Upload and analyze CSV or text files",
        icon: "📁",
        buildPath: (organizationId) => `/organization/${organizationId}/leica`,
      }),
      createModule({
        id: "bim",
        title: "BIM Projects",
        description: "Create BIM projects and upload Excel data as cards",
        icon: "🏢",
        buildPath: (organizationId) => `/organization/${organizationId}/bim`,
      }),
      createModule({
        id: "project-issue-dashboard",
        title: "Project Issue Dashboard",
        description: "Track and review project issues by status and owner",
        icon: "🧩",
        buildPath: (organizationId) => `/organization/${organizationId}/project-issue-dashboard`,
      }),
      createModule({
        id: "project-lists-issues",
        title: "Project Lists and Issues",
        description: "Create projects, lists, and issue # entries with full CRUD",
        icon: "🗂️",
        buildPath: (organizationId) => `/organization/${organizationId}/project-lists-issues`,
        openInNewTab: true,
      }),
      createModule({
        id: "e2-agile-board",
        title: "E2 Agile Board",
        description: "Track E2 status updates and agile assignments",
        icon: "📌",
        buildPath: (organizationId) => `/organization/${organizationId}/e2-agile-board`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "agile-data-table-module",
        title: "Agile Data Table Module",
        description: "Review E2 Agile Board cards in a searchable data table",
        icon: "📋",
        buildPath: (organizationId) => `/organization/${organizationId}/agile-data-table-module`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "time-rotate",
        title: "TimeRotate",
        description: "List all E2 Agile Board cards currently set to Production",
        icon: "🌀",
        buildPath: (organizationId) => `/organization/${organizationId}/time-rotate`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "time-rotate-progress",
        title: "TimeRotate Progress",
        description: "Track all users progress and time logs",
        icon: "📈",
        buildPath: (organizationId) => `/organization/${organizationId}/time-rotate-progress`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "time-rotate-card-hours",
        title: "TimeRotate Card Hours",
        description: "Review card-level hours and user time entries",
        icon: "🕒",
        buildPath: (organizationId) => `/organization/${organizationId}/time-rotate-card-hours`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "pay-everyone",
        title: "Pay Everyone",
        description: "Review line-item hours with card, project, user, and time ranges",
        icon: "💵",
        buildPath: (organizationId) => `/organization/${organizationId}/pay-everyone`,
        defaultVisibilityByRole: { member: false },
      }),
      createModule({
        id: "time-rotate-notes",
        title: "TimeRotate Notes",
        description: "View in-progress notes with timestamps",
        icon: "🗒️",
        buildPath: (organizationId) => `/organization/${organizationId}/time-rotate-notes`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "time-tracker",
        title: "Time Tracker",
        description: "Track time and manage tasks with daily progress",
        icon: "⏱️",
        buildPath: (organizationId) => `/organization/${organizationId}/time-tracker`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "my-design-team",
        title: "My Design Team",
        description: "Request branded AI designs, iterate edits, and keep request history",
        icon: "🎨",
        buildPath: (organizationId) => `/organization/${organizationId}/my-design-team`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "quick-links",
        title: "Quick Links",
        description: "Share a video-first link hub with tappable mobile buttons",
        icon: "🔗",
        buildPath: (organizationId) => `/organization/${organizationId}/quick-links`,
        defaultVisibilityByRole: { member: true },
      }),
      createModule({
        id: "my-ezlink",
        title: "My EZLink",
        description: "Create multiple QR links and track scans with analytics",
        icon: "📊",
        buildPath: (organizationId) => `/organization/${organizationId}/my-ezlink`,
        defaultVisibilityByRole: { member: false },
      }),
    ],
  },
  {
    id: "manage-plan",
    title: "Manage your Plan",
    cards: [
      createModule({
        id: "balance",
        title: "Message Balance",
        description: "Manage SMS messaging credits",
        icon: "💬",
        buildPath: (organizationId) => `/organization/${organizationId}/balance`,
      }),
    ],
  },
  {
    id: "manage",
    title: "Manage",
    cards: [
      createModule({
        id: "user-management",
        title: "User Management",
        description: "Manage organization users and roles",
        icon: "👤",
        buildPath: (organizationId) => `/admin/${organizationId}`,
      }),
      createModule({
        id: "role-manager",
        title: "Role Manager",
        description: "Create and manage custom roles with permissions",
        icon: "🔐",
        buildPath: (organizationId) => `/organization/${organizationId}/role-manager`,
      }),
      createModule({
        id: "user-role-assignment",
        title: "User Role Assignment",
        description: "Assign roles to organization members",
        icon: "👥",
        buildPath: (organizationId) => `/organization/${organizationId}/user-role-assignment`,
      }),
      createModule({
        id: "course-admin",
        title: "Content Admin",
        description: "Manage organization content and courses",
        icon: "📝",
        buildPath: (organizationId) => `/organization/${organizationId}/course-admin`,
      }),
      createModule({
        id: "gallery-admin",
        title: "Gallery Management",
        description: "Create and manage photo galleries",
        icon: "🖼️",
        buildPath: (organizationId) => `/organization/${organizationId}/gallery-admin`,
      }),
      createModule({
        id: "church-app",
        title: "Organization App",
        description: "Customize organization mobile app",
        icon: "📱",
        buildPath: (organizationId) => `/organization/${organizationId}/church-app`,
      }),
      createModule({
        id: "forms",
        title: "Forms",
        description: "Create and manage custom forms with unlimited fields",
        icon: "📋",
        buildPath: (organizationId) => `/organization/${organizationId}/forms`,
        requiresPermission: "forms",
      }),
      createModule({
        id: "manage-groups",
        title: "Manage Groups",
        description: "Create and manage organization groups",
        icon: "👪",
        buildPath: (organizationId) => `/organization/${organizationId}/manage-groups`,
      }),
      createModule({
        id: "invoices",
        title: "Invoices",
        description: "Create and manage invoices",
        icon: "📝",
        buildPath: (organizationId) => `/organization/${organizationId}/invoices`,
      }),
      createModule({
        id: "social-media",
        title: "Social Media",
        description: "Schedule and track social media posts",
        icon: "📱",
        buildPath: (organizationId) => `/organization/${organizationId}/social-media`,
      }),
      createModule({
        id: "global-organization-manager",
        title: "Global",
        description: "Manage all organizations globally",
        icon: "🌎",
        buildPath: () => "/global-organization-manager",
      }),
    ],
  },
];

const buildSectionsWithPaths = (organizationId) =>
  organizationModuleDefinitions.map((section) => ({
    ...section,
    cards: section.cards.map((card, index) => ({
      ...card,
      defaultSectionId: section.id,
      defaultSectionTitle: section.title,
      defaultOrder: index,
      path: card.buildPath(organizationId),
    })),
  }));

export const getBaseOrganizationModuleSections = (organizationId) =>
  buildSectionsWithPaths(organizationId);

export const getDefaultOrganizationSections = () =>
  organizationModuleDefinitions.map((section, index) => ({
    id: section.id,
    title: section.title,
    order: index,
    isVisible: true,
    isCustom: false,
  }));

export const getAllOrganizationModules = (organizationId) =>
  buildSectionsWithPaths(organizationId).flatMap((section) => section.cards);

export const getDefaultModuleVisibilitySettings = (roleKeys = MODULE_VISIBILITY_ROLES) => {
  const defaults = {};
  const normalizedRoleKeys = getUniqueRoles(roleKeys);

  normalizedRoleKeys.forEach((role) => {
    defaults[role] = {};
  });

  getAllOrganizationModules().forEach((module) => {
    normalizedRoleKeys.forEach((role) => {
      const defaultRole = role === "global_admin" ? "global_admin" : "member";
      defaults[role][module.id] = module.defaultVisibilityByRole?.[defaultRole] !== false;
    });
  });

  return defaults;
};

export const mergeModuleVisibilitySettings = (storedSettings, roleKeys = null) => {
  const resolvedRoleKeys = roleKeys
    ? getUniqueRoles(roleKeys)
    : getModuleVisibilityRoleKeys({ storedVisibilitySettings: storedSettings });
  const defaults = getDefaultModuleVisibilitySettings(resolvedRoleKeys);
  const merged = {};

  resolvedRoleKeys.forEach((role) => {
    merged[role] = {
      ...defaults[role],
      ...normalizeVisibilityRoleSettings((storedSettings && storedSettings[role]) || {}),
    };
  });

  return merged;
};

export const getDefaultModuleLayoutSettings = (roleKeys = MODULE_VISIBILITY_ROLES) => {
  const defaults = {};
  const defaultSections = getDefaultOrganizationSections();
  const defaultModules = getAllOrganizationModules();
  const normalizedRoleKeys = getUniqueRoles(roleKeys);

  normalizedRoleKeys.forEach((role) => {
    defaults[role] = {
      sections: defaultSections.reduce((accumulator, section) => {
        accumulator[section.id] = {
          title: section.title,
          order: section.order,
          isVisible: true,
          isCustom: false,
        };
        return accumulator;
      }, {}),
      modules: defaultModules.reduce((accumulator, module) => {
        accumulator[module.id] = {
          title: module.title,
          sectionId: module.defaultSectionId,
          order: module.defaultOrder,
        };
        return accumulator;
      }, {}),
    };
  });

  return defaults;
};

export const mergeModuleLayoutSettings = (storedSettings, roleKeys = null) => {
  const resolvedRoleKeys = roleKeys
    ? getUniqueRoles(roleKeys)
    : getModuleVisibilityRoleKeys({ storedLayoutSettings: storedSettings });
  const defaults = getDefaultModuleLayoutSettings(resolvedRoleKeys);
  const merged = {};

  resolvedRoleKeys.forEach((role) => {
    const storedRoleSections = (storedSettings && storedSettings[role] && storedSettings[role].sections) || {};
    const storedRoleModules = normalizeLayoutRoleModules(
      (storedSettings && storedSettings[role] && storedSettings[role].modules) || {}
    );
    const mergedSections = {
      ...defaults[role].sections,
      ...storedRoleSections,
    };

    Object.keys(mergedSections).forEach((sectionId) => {
      const defaultSection = defaults[role].sections[sectionId];
      const storedSection = storedRoleSections[sectionId] || {};

      mergedSections[sectionId] = {
        title: storedSection.title || defaultSection?.title || sectionId,
        order: Number.isFinite(Number(storedSection.order))
          ? Number(storedSection.order)
          : defaultSection?.order || 0,
        isVisible: storedSection.isVisible !== false,
        isCustom: storedSection.isCustom === true || !defaultSection,
      };
    });

    merged[role] = {
      sections: mergedSections,
      modules: {
        ...defaults[role].modules,
        ...storedRoleModules,
      },
    };
  });

  return merged;
};

export const normalizeModuleVisibilityRole = (role) => {
  return normalizeRoleKey(role);
};

export const isModuleVisibleForRole = (moduleId, role, settings) => {
  const normalizedRole = normalizeModuleVisibilityRole(role);
  const mergedSettings = mergeModuleVisibilitySettings(settings);
  const fallbackRole = mergedSettings[normalizedRole]
    ? normalizedRole
    : normalizedRole === "global_admin"
    ? "global_admin"
    : "member";

  return mergedSettings[fallbackRole]?.[moduleId] !== false;
};

export const getResolvedOrganizationModuleSections = (
  organizationId,
  role,
  visibilitySettings,
  layoutSettings
) => {
  const baseSections = getBaseOrganizationModuleSections(organizationId);
  const normalizedRole = normalizeModuleVisibilityRole(role);
  const mergedVisibilitySettings = mergeModuleVisibilitySettings(visibilitySettings);
  const mergedLayoutSettings = mergeModuleLayoutSettings(layoutSettings);
  const resolvedRole = mergedLayoutSettings[normalizedRole]
    ? normalizedRole
    : normalizedRole === "global_admin"
    ? "global_admin"
    : "member";
  const roleLayout = mergedLayoutSettings[resolvedRole] || {
    sections: {},
    modules: {},
  };
  const roleSections = roleLayout.sections || {};
  const validSectionIds = new Set(Object.keys(roleSections));

  const sectionMap = Object.entries(roleSections).reduce((accumulator, [sectionId, section]) => {
    accumulator[sectionId] = {
      id: sectionId,
      title: section.title || sectionId,
      order: Number.isFinite(Number(section.order)) ? Number(section.order) : 0,
      isVisible: section.isVisible !== false,
      isCustom: section.isCustom === true,
      cards: [],
    };
    return accumulator;
  }, {});

  baseSections.forEach((section) => {
    section.cards.forEach((module) => {
      if (mergedVisibilitySettings[resolvedRole]?.[module.id] === false) {
        return;
      }

      const roleModule = roleLayout.modules?.[module.id] || {};
      const sectionId = validSectionIds.has(roleModule.sectionId)
        ? roleModule.sectionId
        : module.defaultSectionId;

      sectionMap[sectionId].cards.push({
        ...module,
        title: roleModule.title || module.title,
        order: Number.isFinite(Number(roleModule.order)) ? Number(roleModule.order) : module.defaultOrder,
      });
    });
  });

  return Object.values(sectionMap)
    .map((section) => ({
      ...section,
      cards: section.cards.sort((left, right) => left.order - right.order),
    }))
    .filter((section) => section.isVisible !== false && section.cards.length > 0)
    .sort((left, right) => left.order - right.order);
};