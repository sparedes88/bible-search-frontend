import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import NotAuthorized from './NotAuthorized';
import { db } from '../firebase';
import {
  getAllOrganizationModules,
  getModuleVisibilityRoleKeys,
  isModuleVisibleForRole,
  mergeModuleLayoutSettings,
  mergeModuleVisibilitySettings,
  MODULE_METADATA_DOC_ID,
  MODULE_LAYOUT_DOC_ID,
  MODULE_LAYOUT_FIELD,
  MODULE_SETTINGS_SUBCOLLECTION,
  MODULE_VISIBILITY_DOC_ID,
  MODULE_VISIBILITY_FIELD,
} from '../utils/organizationModules';

const ROLE_ALIASES = {
  system_global_admin: 'global_admin',
  system_admin: 'admin',
  system_member: 'member',
};

const normalizeRoleAlias = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const isGenericCustomRoleValue = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return ['custom role', 'custom', 'role'].includes(normalizedValue);
};

const resolveUserRoleKey = (userData = {}) => {
  const roleCandidates = [
    userData?.customRoleId,
    userData?.customRole,
    userData?.customRoleName,
    userData?.customRoleLabel,
    userData?.assignedRoleId,
    userData?.assignedRoleName,
    userData?.assignedRoleLabel,
    userData?.roleName,
    userData?.roleLabel,
    userData?.role,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => !isGenericCustomRoleValue(value));

  if (roleCandidates.length > 0) {
    return roleCandidates[0];
  }

  const fallbackRole = [
    userData?.customRoleId,
    userData?.customRole,
    userData?.customRoleName,
    userData?.customRoleLabel,
    userData?.assignedRoleId,
    userData?.assignedRoleName,
    userData?.assignedRoleLabel,
    userData?.roleName,
    userData?.roleLabel,
    userData?.role,
  ].find((value) => String(value || '').trim());

  return fallbackRole ? String(fallbackRole).trim() : '';
};

const normalizeBaseRoleAlias = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase();
  if (!normalizedValue) {
    return 'member';
  }

  if (normalizedValue === 'system_global_admin') return 'global_admin';
  if (normalizedValue === 'system_admin') return 'admin';
  if (normalizedValue === 'system_member') return 'member';
  if (['global_admin', 'admin', 'member'].includes(normalizedValue)) return normalizedValue;
  return 'member';
};

const getRoleCandidates = (userData = {}) => {
  const candidates = [
    userData?.customRoleId,
    userData?.customRole,
    userData?.customRoleName,
    userData?.customRoleLabel,
    userData?.assignedRoleId,
    userData?.assignedRoleName,
    userData?.assignedRoleLabel,
    userData?.roleName,
    userData?.roleLabel,
    userData?.role,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => !isGenericCustomRoleValue(value));

  return Array.from(new Set(candidates));
};

const resolveVisibilityRoleKey = (
  visibilitySettings,
  roleNameMap = {},
  roleBaseRoleMap = {},
  userData = {},
  normalizedRole = 'member'
) => {
  const roleKeys = Object.keys(mergeModuleVisibilitySettings(visibilitySettings || {}));
  const customRoleKeys = roleKeys.filter((roleKey) => !['global_admin', 'member'].includes(roleKey));
  const candidates = [
    ...getRoleCandidates(userData),
    normalizedRole,
  ].filter(Boolean);

  const exactMatch = candidates.find((candidate) => roleKeys.includes(candidate));
  if (exactMatch) return exactMatch;

  const candidateAliases = candidates.map(normalizeRoleAlias).filter(Boolean);
  const fuzzyMatch = roleKeys.find((roleKey) => candidateAliases.includes(normalizeRoleAlias(roleKey)));
  if (fuzzyMatch) return fuzzyMatch;

  const normalizedRoleNameMap = Object.entries(roleNameMap || {}).reduce((accumulator, [roleKey, roleName]) => {
    accumulator[String(roleKey || '').trim()] = normalizeRoleAlias(roleName);
    return accumulator;
  }, {});
  const normalizedRoleBaseRoleMap = Object.entries(roleBaseRoleMap || {}).reduce((accumulator, [roleKey, baseRole]) => {
    accumulator[String(roleKey || '').trim()] = normalizeBaseRoleAlias(baseRole);
    return accumulator;
  }, {});

  const explicitBaseRole = normalizeBaseRoleAlias(
    userData?.baseRole
    || userData?.basedOn
    || userData?.roleBase
    || userData?.systemRole
  );

  // Bridge role ID -> role label -> stored visibility key.
  const mappedRoleByCandidateKey = candidates.find((candidate) => {
    const candidateKey = String(candidate || '').trim();
    if (!candidateKey) return false;

    const candidateLabelAlias = normalizedRoleNameMap[candidateKey];
    if (!candidateLabelAlias) return false;

    return roleKeys.some((roleKey) => normalizeRoleAlias(roleKey) === candidateLabelAlias);
  });
  if (mappedRoleByCandidateKey) {
    const candidateLabelAlias = normalizedRoleNameMap[String(mappedRoleByCandidateKey).trim()];
    const matchedRoleKey = roleKeys.find((roleKey) => normalizeRoleAlias(roleKey) === candidateLabelAlias);
    if (matchedRoleKey) return matchedRoleKey;
  }

  if (explicitBaseRole === 'global_admin' || explicitBaseRole === 'admin') {
    return explicitBaseRole === 'admin' && roleKeys.includes('global_admin')
      ? 'global_admin'
      : explicitBaseRole;
  }

  const mappedRoleByLabel = roleKeys.find((roleKey) => {
    const mappedLabelAlias = normalizedRoleNameMap[roleKey];
    return mappedLabelAlias && candidateAliases.includes(mappedLabelAlias);
  });
  if (mappedRoleByLabel) return mappedRoleByLabel;

  const mappedBaseRoleByLabel = Object.entries(normalizedRoleNameMap).find(([, roleLabelAlias]) =>
    roleLabelAlias && candidateAliases.includes(roleLabelAlias)
  );
  if (mappedBaseRoleByLabel) {
    const mappedBaseRole = normalizedRoleBaseRoleMap[mappedBaseRoleByLabel[0]];
    if (mappedBaseRole === 'global_admin' || mappedBaseRole === 'admin') {
      return mappedBaseRole === 'admin' && roleKeys.includes('global_admin')
        ? 'global_admin'
        : mappedBaseRole;
    }
  }

  const baseRoleMatch = Object.entries(roleBaseRoleMap || {}).find(([roleKey]) =>
    candidateAliases.includes(normalizeRoleAlias(roleKey))
  );
  if (baseRoleMatch) {
    const normalizedBaseRole = normalizeBaseRoleAlias(baseRoleMatch[1]);
    if (['global_admin', 'admin', 'member'].includes(normalizedBaseRole)) {
      return normalizedBaseRole;
    }
  }

  if (normalizedRole === 'admin' && roleKeys.includes('global_admin')) {
    return 'global_admin';
  }

  if (!['global_admin', 'member'].includes(normalizedRole) && customRoleKeys.length === 1) {
    return customRoleKeys[0];
  }

  if (!['global_admin', 'admin', 'member'].includes(normalizedRole) && customRoleKeys.length > 0) {
    return 'member';
  }

  return normalizedRole;
};

const MODULE_PATH_ALIASES = [
  {
    match: /^\/organization\/[^/]+\/time-tracking(\/|$)/,
    moduleId: 'time-tracker',
  },
  {
    match: /^\/(organization|church)\/[^/]+\/time-rotate-office-status(\/|$)/,
    moduleId: 'time-rotate',
  },
  {
    match: /^\/(organization|church)\/[^/]+\/time-rotate-tracker(\/|$)/,
    moduleId: 'time-rotate',
  },
];

const PrivateRoute = ({ children, roles = [], moduleId = '' }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const pathParts = location.pathname.split('/');
  const routeType = pathParts[1]; // 'organization' or 'church'
  const churchId = pathParts[2];
  const resolvedRole = resolveUserRoleKey(user).toLowerCase();
  const normalizedRole = ROLE_ALIASES[resolvedRole] || resolvedRole;
  const allowedRoles = roles.map((role) => String(role).trim().toLowerCase());
  const [moduleAccessLoading, setModuleAccessLoading] = useState(false);
  const [userRoleLoading, setUserRoleLoading] = useState(false);
  const [hasModuleAccess, setHasModuleAccess] = useState(true);
  const [effectiveNormalizedRole, setEffectiveNormalizedRole] = useState(normalizedRole);

  useEffect(() => {
    setEffectiveNormalizedRole(normalizedRole);
  }, [normalizedRole]);

  const autoDetectedModuleId = useMemo(() => {
    if (!churchId) return '';
    const canonicalPath = routeType === 'church'
      ? `/organization/${churchId}/${pathParts.slice(3).join('/')}`
      : location.pathname;

    const aliasMatch = MODULE_PATH_ALIASES.find((entry) => entry.match.test(canonicalPath));
    if (aliasMatch) {
      return aliasMatch.moduleId;
    }

    const modules = getAllOrganizationModules(churchId);
    const matchingModuleByPrefix = modules.find((module) => {
      const basePath = String(module.path || '').trim();
      return basePath && (canonicalPath === basePath || canonicalPath.startsWith(`${basePath}/`));
    });
    if (matchingModuleByPrefix) {
      return matchingModuleByPrefix.id;
    }

    return '';
  }, [churchId, location.pathname, pathParts, routeType]);

  const targetModuleId = String(moduleId || autoDetectedModuleId || '').trim();

  useEffect(() => {
    let active = true;

    if (!user || !churchId || !targetModuleId) {
      setHasModuleAccess(true);
      setModuleAccessLoading(false);
      setUserRoleLoading(false);
      return () => {
        active = false;
      };
    }

    setModuleAccessLoading(true);
    setUserRoleLoading(true);

    const visibilityRef = doc(db, 'churches', churchId, MODULE_SETTINGS_SUBCOLLECTION, MODULE_VISIBILITY_DOC_ID);
    const layoutRef = doc(db, 'churches', churchId, MODULE_SETTINGS_SUBCOLLECTION, MODULE_LAYOUT_DOC_ID);
    const metadataRef = doc(db, 'churches', churchId, MODULE_SETTINGS_SUBCOLLECTION, MODULE_METADATA_DOC_ID);
    const churchRef = doc(db, 'churches', churchId);
    const userRef = doc(db, 'users', user.uid);

    let latestVisibilitySnap = null;
    let latestLayoutSnap = null;
    let latestMetadataSnap = null;
    let latestChurchSnap = null;
    let latestUserSnap = null;

    const evaluateAccess = () => {
      if (!active || !latestChurchSnap || latestUserSnap === null) {
        return;
      }

      try {
        const resolvedUserData = latestUserSnap?.exists()
          ? { ...user, ...(latestUserSnap.data() || {}) }
          : user;
        const resolvedRoleValue = resolveUserRoleKey(resolvedUserData).toLowerCase();
        const resolvedNormalizedRole = ROLE_ALIASES[resolvedRoleValue] || resolvedRoleValue;
        setEffectiveNormalizedRole(resolvedNormalizedRole);

        const churchData = latestChurchSnap.exists() ? latestChurchSnap.data() : {};
        const visibilityData = latestVisibilitySnap?.exists()
          ? latestVisibilitySnap.data()?.settings
          : churchData?.[MODULE_VISIBILITY_FIELD] || {};
        const layoutData = latestLayoutSnap?.exists()
          ? latestLayoutSnap.data()?.settings
          : churchData?.[MODULE_LAYOUT_FIELD] || {};

        const roleNameMap = {
          ...(churchData?.miOrganizacionRoleNameMap || {}),
          ...(latestMetadataSnap?.exists() ? (latestMetadataSnap.data()?.roleNameMap || {}) : {}),
        };
        const roleBaseRoleMap = {
          ...(churchData?.miOrganizacionRoleBaseRoleMap || {}),
          ...(latestMetadataSnap?.exists() ? (latestMetadataSnap.data()?.roleBaseRoleMap || {}) : {}),
        };

        const roleKeyForVisibility = resolveVisibilityRoleKey(
          visibilityData,
          roleNameMap,
          roleBaseRoleMap,
          resolvedUserData,
          resolvedNormalizedRole || 'member'
        );

        if (!roleKeyForVisibility) {
          setHasModuleAccess(false);
          setModuleAccessLoading(false);
          return;
        }

        const moduleInfo = getAllOrganizationModules(churchId).find((module) => module.id === targetModuleId);
        const roleKeys = getModuleVisibilityRoleKeys({
          storedVisibilitySettings: visibilityData,
          storedLayoutSettings: layoutData,
        });
        const mergedLayoutSettings = mergeModuleLayoutSettings(layoutData, roleKeys);
        const fallbackLayoutRole = mergedLayoutSettings[roleKeyForVisibility]
          ? roleKeyForVisibility
          : roleKeyForVisibility === 'global_admin'
          ? 'global_admin'
          : 'member';
        const roleLayout = mergedLayoutSettings[fallbackLayoutRole] || { sections: {}, modules: {} };
        const roleModuleLayout = roleLayout.modules?.[targetModuleId] || {};
        const sectionId = roleModuleLayout.sectionId || moduleInfo?.defaultSectionId;
        const sectionVisible = sectionId
          ? roleLayout.sections?.[sectionId]?.isVisible !== false
          : true;

        const visible = isModuleVisibleForRole(targetModuleId, roleKeyForVisibility, visibilityData || {})
          && sectionVisible;

        setHasModuleAccess(Boolean(visible));
      } catch (error) {
        console.error('Error checking module visibility access:', error);
        setHasModuleAccess(false);
      } finally {
        setModuleAccessLoading(false);
        setUserRoleLoading(false);
      }
    };

    const handleSnapshotError = (error) => {
      console.error('Error listening for module visibility updates:', error);
      if (!active) return;
      setHasModuleAccess(false);
      setModuleAccessLoading(false);
    };

    const unsubVisibility = onSnapshot(visibilityRef, (snap) => {
      latestVisibilitySnap = snap;
      evaluateAccess();
    }, handleSnapshotError);

    const unsubLayout = onSnapshot(layoutRef, (snap) => {
      latestLayoutSnap = snap;
      evaluateAccess();
    }, handleSnapshotError);

    const unsubMetadata = onSnapshot(metadataRef, (snap) => {
      latestMetadataSnap = snap;
      evaluateAccess();
    }, handleSnapshotError);

    const unsubChurch = onSnapshot(churchRef, (snap) => {
      latestChurchSnap = snap;
      evaluateAccess();
    }, handleSnapshotError);

    const unsubUser = onSnapshot(userRef, (snap) => {
      latestUserSnap = snap;
      evaluateAccess();
    }, (error) => {
      console.error('Error listening for user role updates:', error);
      if (!active) return;
      setHasModuleAccess(false);
      setModuleAccessLoading(false);
      setUserRoleLoading(false);
    });

    return () => {
      active = false;
      unsubVisibility();
      unsubLayout();
      unsubMetadata();
      unsubChurch();
      unsubUser();
    };
  }, [churchId, targetModuleId, user]);

  if (loading || moduleAccessLoading || userRoleLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)'
      }}>
        <div style={{
          textAlign: 'center',
          padding: '2rem'
        }}>
          <div style={{
            width: '50px',
            height: '50px',
            border: '4px solid #E5E7EB',
            borderTop: '4px solid #4F46E5',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem'
          }} />
          <p style={{ color: '#6b7280', fontSize: '1.1rem' }}>Loading...</p>
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!user) {
    const returnUrl = `${location.pathname}${location.search}`;
    const loginBasePath = routeType === 'church'
      ? `/church/${churchId}/login`
      : `/organization/${churchId}/login`;
    return <Navigate to={`${loginBasePath}?returnUrl=${encodeURIComponent(returnUrl)}`} replace />;
  }

  const isCustomRole = Boolean(effectiveNormalizedRole) && !['global_admin', 'admin', 'member'].includes(effectiveNormalizedRole);
  const memberRouteAllowed = allowedRoles.includes('member');
  const roleAllowed = roles.length === 0
    || allowedRoles.includes(effectiveNormalizedRole)
    || (isCustomRole && memberRouteAllowed);

  if (!roleAllowed) {
    return <NotAuthorized message="You don't have permission to access this page." showLogin={false} />;
  }

  if (!hasModuleAccess) {
    return <NotAuthorized message="This module is disabled for your role in Manage Module settings." showLogin={false} />;
  }

  return children;
};

export default PrivateRoute;