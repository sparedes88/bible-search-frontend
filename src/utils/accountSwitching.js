const ACCOUNT_SWITCH_STORAGE_KEY = "quickSwitchAccountsByOrganization";
const MAX_SWITCH_ACCOUNTS_PER_ORG = 8;
const SWITCH_DEVICE_SECRET_KEY = "quickSwitchDeviceSecretV1";
const SWITCH_CIPHER_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

const safeParse = (value) => {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
};

const normalizeOrgId = (organizationId) => String(organizationId || "").trim();

const normalizeIdentifier = (identifier) => String(identifier || "").trim();

const normalizeSwitchAccount = (account = {}) => {
  const identifier = normalizeIdentifier(account.identifier);
  if (!identifier) return null;

  return {
    identifier,
    email: normalizeIdentifier(account.email),
    uid: normalizeIdentifier(account.uid),
    passwordCipher: normalizeIdentifier(account.passwordCipher),
    passwordUpdatedAt: Number.isFinite(account.passwordUpdatedAt)
      ? account.passwordUpdatedAt
      : 0,
    lastUsedAt: Number.isFinite(account.lastUsedAt)
      ? account.lastUsedAt
      : Date.now(),
  };
};

const hasWebCrypto = () => (
  isBrowser()
  && typeof window.crypto !== "undefined"
  && typeof window.crypto.getRandomValues === "function"
  && typeof window.crypto.subtle !== "undefined"
);

const isSecureContextForSwitching = () => (
  isBrowser()
  && (window.isSecureContext || window.location?.hostname === "localhost")
);

const canUseEncryptedSwitchSecrets = () => hasWebCrypto() && isSecureContextForSwitching();

const bytesToBase64 = (bytes) => {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const base64ToBytes = (base64Value) => {
  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const getOrCreateDeviceSecret = () => {
  if (!isBrowser()) return "";

  const existingSecret = localStorage.getItem(SWITCH_DEVICE_SECRET_KEY);
  if (existingSecret) return existingSecret;

  if (!hasWebCrypto()) return "";

  const randomBytes = new Uint8Array(32);
  window.crypto.getRandomValues(randomBytes);
  const createdSecret = bytesToBase64(randomBytes);
  localStorage.setItem(SWITCH_DEVICE_SECRET_KEY, createdSecret);
  return createdSecret;
};

const getEncryptionKey = async () => {
  if (!canUseEncryptedSwitchSecrets()) return null;

  const deviceSecret = getOrCreateDeviceSecret();
  if (!deviceSecret) return null;

  const keyMaterial = `${window.location.origin}|${deviceSecret}`;
  const encodedMaterial = new TextEncoder().encode(keyMaterial);
  const keyHash = await window.crypto.subtle.digest("SHA-256", encodedMaterial);

  return window.crypto.subtle.importKey(
    "raw",
    keyHash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
};

const isCipherExpired = (passwordUpdatedAt) => {
  if (!Number.isFinite(passwordUpdatedAt) || passwordUpdatedAt <= 0) {
    return true;
  }

  return Date.now() - passwordUpdatedAt > SWITCH_CIPHER_TTL_MS;
};

export const encodeSwitchPassword = async (rawPassword) => {
  const normalizedPassword = String(rawPassword || "");
  if (!normalizedPassword) return "";

  if (!canUseEncryptedSwitchSecrets()) return "";

  try {
    const key = await getEncryptionKey();
    if (!key) return "";

    const iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);
    const payload = new TextEncoder().encode(normalizedPassword);
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      payload
    );

    const cipherBytes = new Uint8Array(encryptedBuffer);
    return `${bytesToBase64(iv)}.${bytesToBase64(cipherBytes)}`;
  } catch (error) {
    return "";
  }
};

export const decodeSwitchPassword = async (passwordCipher) => {
  const normalizedCipher = String(passwordCipher || "");
  if (!normalizedCipher) return "";

  if (!canUseEncryptedSwitchSecrets()) return "";

  try {
    const [ivBase64, cipherBase64] = normalizedCipher.split(".");
    if (!ivBase64 || !cipherBase64) return "";

    const key = await getEncryptionKey();
    if (!key) return "";

    const iv = base64ToBytes(ivBase64);
    const cipherBytes = base64ToBytes(cipherBase64);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (error) {
    return "";
  }
};

const readAllSwitchAccounts = () => {
  if (!isBrowser()) return {};
  return safeParse(localStorage.getItem(ACCOUNT_SWITCH_STORAGE_KEY));
};

const writeAllSwitchAccounts = (allAccounts) => {
  if (!isBrowser()) return;
  localStorage.setItem(ACCOUNT_SWITCH_STORAGE_KEY, JSON.stringify(allAccounts || {}));
};

export const getSwitchAccountsForOrganization = (organizationId) => {
  const orgId = normalizeOrgId(organizationId);
  if (!orgId) return [];

  const allAccounts = readAllSwitchAccounts();
  const orgAccounts = Array.isArray(allAccounts[orgId]) ? allAccounts[orgId] : [];

  return orgAccounts
    .map((account) => normalizeSwitchAccount(account))
    .filter(Boolean)
    .map((account) => (
      isCipherExpired(account.passwordUpdatedAt)
        ? { ...account, passwordCipher: "" }
        : account
    ))
    .sort((left, right) => Number(right.lastUsedAt || 0) - Number(left.lastUsedAt || 0));
};

export const saveSwitchAccountForOrganization = (organizationId, account) => {
  const orgId = normalizeOrgId(organizationId);
  const normalizedAccount = normalizeSwitchAccount(account);

  if (!orgId || !normalizedAccount) return;

  const allAccounts = readAllSwitchAccounts();
  const currentAccounts = getSwitchAccountsForOrganization(orgId);
  const dedupedAccounts = currentAccounts.filter((existingAccount) => {
    const matchesIdentifier =
      existingAccount.identifier.toLowerCase() === normalizedAccount.identifier.toLowerCase();
    const matchesEmail =
      normalizedAccount.email
      && existingAccount.email
      && existingAccount.email.toLowerCase() === normalizedAccount.email.toLowerCase();
    const matchesUid =
      normalizedAccount.uid
      && existingAccount.uid
      && existingAccount.uid === normalizedAccount.uid;

    return !(matchesIdentifier || matchesEmail || matchesUid);
  });

  allAccounts[orgId] = [normalizedAccount, ...dedupedAccounts].slice(0, MAX_SWITCH_ACCOUNTS_PER_ORG);
  writeAllSwitchAccounts(allAccounts);
};

export const removeSwitchAccountForOrganization = (organizationId, identifier) => {
  const orgId = normalizeOrgId(organizationId);
  const normalizedIdentifier = normalizeIdentifier(identifier).toLowerCase();
  if (!orgId || !normalizedIdentifier) return;

  const allAccounts = readAllSwitchAccounts();
  const currentAccounts = getSwitchAccountsForOrganization(orgId);
  const filteredAccounts = currentAccounts.filter(
    (account) => account.identifier.toLowerCase() !== normalizedIdentifier
  );

  allAccounts[orgId] = filteredAccounts;
  writeAllSwitchAccounts(allAccounts);
};

export const clearSwitchAccountsForOrganization = (organizationId) => {
  const orgId = normalizeOrgId(organizationId);
  if (!orgId) return;

  const allAccounts = readAllSwitchAccounts();
  if (!(orgId in allAccounts)) return;

  delete allAccounts[orgId];
  writeAllSwitchAccounts(allAccounts);
};
