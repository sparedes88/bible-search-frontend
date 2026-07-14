import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

const normalizeValue = (value) => (value === null || value === undefined ? "" : String(value).trim());

const ensureHttpUrl = (value) => {
  const normalized = normalizeValue(value);
  if (!normalized) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return normalized;
  if (normalized.startsWith("//") && typeof window !== "undefined") {
    return `${window.location.protocol}${normalized}`;
  }
  if (normalized.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${normalized}`;
  }
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
};

const isSameDestination = (currentUrl, nextUrl) => {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl, current.origin);
    return (
      current.origin === next.origin &&
      current.pathname === next.pathname &&
      current.search === next.search
    );
  } catch {
    return false;
  }
};

const navigateWithFallback = (nextUrl) => {
  const destination = String(nextUrl || "").trim();
  if (!destination || typeof window === "undefined") return;

  // Some mobile scanner webviews ignore replace/assign intermittently.
  window.location.replace(destination);

  window.setTimeout(() => {
    window.location.assign(destination);
  }, 500);

  window.setTimeout(() => {
    window.open(destination, "_self");
  }, 1200);
};

const resolveEzLinkTarget = async ({ churchId, slug }) => {
  const baseUrl = getCloudFunctionsBaseUrl();
  const url = `${baseUrl}/logEzLinkHit?${new URLSearchParams({
    churchId,
    slug,
    resolveOnly: "true",
  }).toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const message = normalizeValue(payload?.error) || "Could not resolve EZLink destination.";
    throw new Error(message);
  }

  const resolved = ensureHttpUrl(payload?.redirectUrl);
  if (!resolved) {
    throw new Error("This EZLink has no destination configured.");
  }

  return resolved;
};

const getCloudFunctionsBaseUrl = () => {
  const normalized = normalizeValue(process.env.REACT_APP_CLOUD_FUNCTIONS_BASE_URL);
  if (normalized) return normalized.replace(/\/$/, "");
  return "https://us-central1-igletechv1.cloudfunctions.net";
};

const getDeviceType = (userAgentValue) => {
  const ua = normalizeValue(userAgentValue).toLowerCase();
  if (!ua) return "unknown";
  if (/ipad|tablet|playbook|silk/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/.test(ua)) return "mobile";
  return "desktop";
};

const postEzLinkHit = async ({ churchId, slug }) => {
  if (!churchId || !slug || typeof window === "undefined") return;

  const clientNow = new Date();
  const payload = {
    churchId,
    slug,
    clientTimestamp: clientNow.toISOString(),
    clientHour: clientNow.getHours(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    language: navigator.language || "",
    platform: navigator.platform || "",
    referrer: document.referrer || "",
    userAgent: navigator.userAgent || "",
    deviceType: getDeviceType(navigator.userAgent || ""),
    screen: {
      width: window.screen?.width || null,
      height: window.screen?.height || null,
    },
  };

  const url = `${getCloudFunctionsBaseUrl()}/logEzLinkHit`;
  const query = new URLSearchParams({
    churchId,
    slug,
    clientTimestamp: payload.clientTimestamp,
    clientHour: String(payload.clientHour),
    timezone: payload.timezone,
    language: payload.language,
    platform: payload.platform,
    referrer: payload.referrer,
    deviceType: payload.deviceType,
  }).toString();

  const getUrl = `${url}?${query}`;

  // sendBeacon is most reliable when navigating away immediately after tracking.
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const asBlob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const sent = navigator.sendBeacon(url, asBlob);
    if (sent) return;
  }

  // Fire a GET pixel-style request as a low-friction fallback that avoids preflight.
  const pixel = new Image();
  pixel.src = `${getUrl}&_cb=${Date.now()}`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  });
};

const EzLinkRedirect = () => {
  const { id, slug } = useParams();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Redirecting...");

  useEffect(() => {
    const runRedirect = async () => {
      if (!id || !slug) {
        setStatus("error");
        setMessage("Missing EZLink information.");
        return;
      }

      try {
        let nextUrl = "";

        // Resolve through Cloud Function first so public scans do not rely on Firestore auth rules.
        try {
          nextUrl = await resolveEzLinkTarget({ churchId: id, slug });
        } catch (resolveError) {
          console.warn("Cloud resolve failed, attempting Firestore fallback:", resolveError);
          const linkRef = doc(db, "churches", id, "ezlinks", slug);
          const linkSnap = await getDoc(linkRef);

          if (!linkSnap.exists()) {
            setStatus("error");
            setMessage("This EZLink was not found.");
            return;
          }

          const data = linkSnap.data() || {};
          if (data.isActive === false) {
            setStatus("error");
            setMessage("This EZLink is currently disabled.");
            return;
          }

          nextUrl = ensureHttpUrl(
            data.targetUrl || data.url || data.destinationUrl || data.destination
          );
        }

        if (!nextUrl) {
          setStatus("error");
          setMessage("This EZLink has no destination configured.");
          return;
        }

        if (typeof window !== "undefined" && isSameDestination(window.location.href, nextUrl)) {
          setStatus("error");
          setMessage("This EZLink points to itself. Update the destination URL.");
          return;
        }

        setStatus("redirecting");
        setMessage("Redirecting now...");

        // Kick analytics and move quickly to the destination URL.
        try {
          postEzLinkHit({ churchId: id, slug });
        } catch (analyticsError) {
          console.warn("EZLink analytics log skipped:", analyticsError);
        }

        navigateWithFallback(nextUrl);
      } catch (error) {
        console.error("Failed to resolve EZLink redirect:", error);
        setStatus("error");
        setMessage("Could not complete redirect.");
      }
    };

    runRedirect();
  }, [id, slug]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "20px",
        background: "linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: "12px",
          padding: "20px",
          textAlign: "center",
        }}
      >
        <h1 style={{ marginTop: 0, color: "#1E293B" }}>My EZLink</h1>
        <p style={{ color: "#475569" }}>{message}</p>
        {status === "error" ? (
          <Link to={`/organization/${id}/mi-organizacion`} style={{ color: "#1D4ED8", fontWeight: 700 }}>
            Go to organization
          </Link>
        ) : null}
      </div>
    </div>
  );
};

export default EzLinkRedirect;