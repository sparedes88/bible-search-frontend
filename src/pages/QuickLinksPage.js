import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FaArrowDown,
  FaArrowUp,
  FaChevronLeft,
  FaChevronRight,
  FaEdit,
  FaFacebook,
  FaGlobe,
  FaInstagram,
  FaLink,
  FaMapMarkerAlt,
  FaPalette,
  FaPlay,
  FaPlus,
  FaShareAlt,
  FaTrash,
  FaWhatsapp,
  FaWpforms,
  FaYoutube,
} from "react-icons/fa";
import { collection, doc, getDocs, getDocsFromServer, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getChurchData } from "../api/church";
import { useAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";

const pageConfig = {
  title: "Quick Links",
  subtitle: "Watch featured videos first, then tap the links below.",
  logoBorderWidth: 4,
  logoBorderColor: "#FFFFFF",
  videos: [
    {
      title: "Featured Video",
      description: "Replace this embed with your latest announcement or sermon clip.",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    },
    {
      title: "Next Watch",
      description: "Use this slot for a second video, playlist, or short update.",
      embedUrl: "https://www.youtube.com/embed/9bZkp7q19f0",
    },
  ],
  links: [
    {
      label: "Visit Website",
      description: "Open the main site",
      url: "https://example.com",
      iconKey: "globe",
    },
    {
      label: "Watch on YouTube",
      description: "Go to the video channel",
      url: "https://youtube.com",
      iconKey: "youtube",
    },
    {
      label: "Instagram",
      description: "See recent photos and updates",
      url: "https://instagram.com",
      iconKey: "instagram",
    },
    {
      label: "Facebook",
      description: "Follow for community news",
      url: "https://facebook.com",
      iconKey: "facebook",
    },
    {
      label: "WhatsApp",
      description: "Send a quick message",
      url: "https://wa.me/15555555555",
      iconKey: "whatsapp",
    },
    {
      label: "More Links",
      description: "Add anything else you want to share",
      url: "https://example.com/links",
      iconKey: "link",
    },
  ],
};

const DEFAULT_THEME_COLORS = {
  primary: "#0F766E",
  secondary: "#1D4ED8",
  accent: "#F97316",
};

const DEFAULT_EDITOR_VIDEO = {
  title: "",
  description: "",
  type: "video",
  embedUrl: "",
  imageUrl: "",
  ctaText: "",
  ctaUrl: "",
  ctaFormId: "",
};

const DEFAULT_EDITOR_LINK = {
  label: "",
  description: "",
  url: "https://",
  iconKey: "link",
  buttonColor: "",
  customIconUrl: "",
  formId: "",
};

const DEFAULT_EDITOR_LINK_SECTION = {
  title: "New Section",
  subtitle: "",
  links: [{ ...DEFAULT_EDITOR_LINK }],
};

const DEFAULT_SECTION_TEXTS = {
  pageTitle: pageConfig.title,
  pageSubtitle: pageConfig.subtitle,
  locationTitle: "Visit Us",
  locationAddress: "",
};

const LINK_BUTTON_BACKGROUNDS = {
  globe: "linear-gradient(135deg, #00A6FB, #0E5EFF)",
  youtube: "linear-gradient(135deg, #FF2A2A, #CC0000)",
  instagram: "linear-gradient(135deg, #F58529, #DD2A7B, #8134AF)",
  facebook: "linear-gradient(135deg, #1877F2, #1459BA)",
  whatsapp: "linear-gradient(135deg, #25D366, #0E9F50)",
  form: "linear-gradient(135deg, #06B6D4, #2563EB)",
  map: "linear-gradient(135deg, #EF4444, #F97316)",
  link: "linear-gradient(135deg, #3B82F6, #2563EB)",
};

const LINK_TYPE_URL_TEMPLATES = {
  globe: "https://",
  youtube: "https://youtube.com/",
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
  whatsapp: "https://wa.me/",
  map: "",
  form: "",
  link: "https://",
};

const LINK_TYPE_OPTIONS = [
  { value: "link", label: "Generic Link" },
  { value: "globe", label: "Website" },
  { value: "youtube", label: "YouTube" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "map", label: "Map" },
  { value: "form", label: "Form" },
];

const LINK_ICON_MAP = {
  globe: FaGlobe,
  youtube: FaYoutube,
  instagram: FaInstagram,
  facebook: FaFacebook,
  whatsapp: FaWhatsapp,
  map: FaMapMarkerAlt,
  form: FaWpforms,
  link: FaLink,
};

const inputStyle = {
  width: "100%",
  border: "1px solid #CBD5E1",
  borderRadius: "12px",
  padding: "10px 12px",
  fontSize: "0.95rem",
  color: "#0F172A",
  background: "#FFFFFF",
  boxSizing: "border-box",
};

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "92px",
};

const sectionCardStyle = (palette) => ({
  borderRadius: "24px",
  border: `1px solid ${palette.surfaceBorder}`,
  background: "rgba(255, 255, 255, 0.9)",
  boxShadow: palette.sectionCardShadow,
  backdropFilter: "blur(12px)",
});

const cleanText = (value) => String(value || "").trim();

const isHexColor = (value) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "").trim());

const normalizeHexColor = (value, fallback) => {
  const normalized = String(value || "").trim();
  if (isHexColor(normalized)) {
    return normalized.length === 4
      ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`.toUpperCase()
      : normalized.toUpperCase();
  }
  return fallback;
};

const withAlpha = (hex, alpha) => {
  const normalized = normalizeHexColor(hex, "#000000").replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((item) => item + item).join("") : normalized;
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const inferIconKeyFromUrl = (url, formId) => {
  if (cleanText(formId)) {
    return "form";
  }

  const normalized = cleanText(url).toLowerCase();
  if (!normalized) {
    return "link";
  }
  if (normalized.includes("youtube.com") || normalized.includes("youtu.be")) return "youtube";
  if (normalized.includes("instagram.com")) return "instagram";
  if (normalized.includes("facebook.com") || normalized.includes("fb.com")) return "facebook";
  if (normalized.includes("wa.me") || normalized.includes("whatsapp")) return "whatsapp";
  if (normalized.includes("google.com/maps") || normalized.includes("maps.apple.com")) return "map";
  return normalized.startsWith("http") ? "globe" : "link";
};

const resolveEmbedUrl = (value) => {
  const input = cleanText(value);
  if (!input) {
    return "";
  }

  if (input.includes("youtube.com/embed/")) {
    return input;
  }

  const watchMatch = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^?&/]+)/i);
  if (watchMatch?.[1]) {
    return `https://www.youtube.com/embed/${watchMatch[1]}`;
  }

  const vimeoMatch = input.match(/vimeo\.com\/(\d+)/i);
  if (vimeoMatch?.[1]) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  return input;
};

const normalizeVideo = (video = {}) => {
  const embedUrl = resolveEmbedUrl(video.embedUrl || video.url || "");
  const imageUrl = cleanText(video.imageUrl || video.image || "");
  const type = cleanText(video.type || "") === "image" || (imageUrl && !embedUrl) ? "image" : "video";

  return {
    ...DEFAULT_EDITOR_VIDEO,
    ...video,
    title: cleanText(video.title),
    description: cleanText(video.description),
    type,
    embedUrl,
    imageUrl,
    ctaText: cleanText(video.ctaText),
    ctaUrl: cleanText(video.ctaUrl),
    ctaFormId: cleanText(video.ctaFormId),
  };
};

const normalizeLink = (link = {}) => {
  const formId = cleanText(link.formId);
  const url = cleanText(link.url);
  return {
    ...DEFAULT_EDITOR_LINK,
    ...link,
    label: cleanText(link.label),
    description: cleanText(link.description),
    url,
    iconKey: cleanText(link.iconKey) || inferIconKeyFromUrl(url, formId),
    buttonColor: cleanText(link.buttonColor),
    customIconUrl: cleanText(link.customIconUrl),
    formId,
  };
};

const normalizeSection = (section = {}, fallbackTitle = "Quick Links") => ({
  ...DEFAULT_EDITOR_LINK_SECTION,
  ...section,
  title: cleanText(section.title) || fallbackTitle,
  subtitle: cleanText(section.subtitle),
  links: Array.isArray(section.links) && section.links.length > 0 ? section.links.map(normalizeLink) : [{ ...DEFAULT_EDITOR_LINK }],
});

const normalizeSectionTexts = (texts = {}) => ({
  ...DEFAULT_SECTION_TEXTS,
  ...texts,
  pageTitle: cleanText(texts.pageTitle) || DEFAULT_SECTION_TEXTS.pageTitle,
  pageSubtitle: cleanText(texts.pageSubtitle) || DEFAULT_SECTION_TEXTS.pageSubtitle,
  locationTitle: cleanText(texts.locationTitle) || DEFAULT_SECTION_TEXTS.locationTitle,
  locationAddress: cleanText(texts.locationAddress),
});

const buildInitialContentState = (churchData = {}) => {
  const config = churchData.quickLinksConfig || {};
  const sectionTexts = normalizeSectionTexts(config.sectionTexts || {});

  const videos = Array.isArray(config.videos) && config.videos.length > 0
    ? config.videos.map(normalizeVideo)
    : pageConfig.videos.map(normalizeVideo);

  let linkSections = [];

  if (Array.isArray(config.linkSections) && config.linkSections.length > 0) {
    linkSections = config.linkSections.map((section, index) =>
      normalizeSection(section, section.title || `Section ${index + 1}`)
    );
  } else if (Array.isArray(config.links) && config.links.length > 0) {
    linkSections = [
      normalizeSection(
        {
          title: "Quick Links",
          subtitle: "Tap a button below",
          links: config.links,
        },
        "Quick Links"
      ),
    ];
  } else {
    linkSections = [
      normalizeSection(
        {
          title: "Stay Connected",
          subtitle: "Everything people need in one place",
          links: pageConfig.links,
        },
        "Stay Connected"
      ),
    ];
  }

  return {
    videos,
    linkSections,
    sectionTexts,
    links: linkSections.flatMap((section) => section.links),
  };
};

const cloneContentState = (contentState) => ({
  videos: (contentState?.videos || []).map((video) => ({ ...normalizeVideo(video) })),
  linkSections: (contentState?.linkSections || []).map((section) => ({
    ...normalizeSection(section),
    links: (section.links || []).map((link) => ({ ...normalizeLink(link) })),
  })),
  sectionTexts: normalizeSectionTexts(contentState?.sectionTexts || {}),
  links: (contentState?.linkSections || []).flatMap((section) => (section.links || []).map((link) => ({ ...normalizeLink(link) }))),
});

const buildSanitizedContentState = (videos, linkSections, sectionTexts) => {
  const nextVideos = (videos || [])
    .map(normalizeVideo)
    .filter((video) => video.title || video.description || video.embedUrl || video.imageUrl || video.ctaText || video.ctaUrl || video.ctaFormId);

  const nextLinkSections = (linkSections || [])
    .map((section, index) => ({
      ...normalizeSection(section, section.title || `Section ${index + 1}`),
      links: (section.links || [])
        .map(normalizeLink)
        .filter((link) => link.label || link.description || link.url || link.formId),
    }))
    .filter((section) => section.title || section.subtitle || section.links.length > 0);

  const ensuredSections = nextLinkSections.length > 0
    ? nextLinkSections
    : [
        normalizeSection(
          {
            title: "Quick Links",
            subtitle: "Tap a button below",
            links: [{ ...DEFAULT_EDITOR_LINK }],
          },
          "Quick Links"
        ),
      ];

  const nextSectionTexts = normalizeSectionTexts(sectionTexts);

  return {
    videos: nextVideos.length > 0 ? nextVideos : pageConfig.videos.map(normalizeVideo),
    linkSections: ensuredSections,
    sectionTexts: nextSectionTexts,
    links: ensuredSections.flatMap((section) => section.links),
  };
};

const getVideoMediaUrl = (video = {}) => (video.type === "image" ? cleanText(video.imageUrl) : resolveEmbedUrl(video.embedUrl));

const getLinkTypeHelperText = (iconKey) => {
  if (iconKey === "form") return "Choose a form below and the button will open it automatically.";
  if (iconKey === "map") return "Use a map address or maps URL so the button opens directions.";
  if (iconKey === "whatsapp") return "Use a WhatsApp number or chat URL.";
  return "Paste the full URL for this button.";
};

const getLinkUrlPlaceholder = (iconKey) => {
  if (iconKey === "map") return "1600 Amphitheatre Parkway, Mountain View, CA";
  if (iconKey === "form") return "Form links are generated from the selected form";
  return LINK_TYPE_URL_TEMPLATES[iconKey] || "https://";
};

const getButtonBackground = (link) => {
  const customColor = cleanText(link.buttonColor);
  if (customColor) {
    return customColor;
  }
  return LINK_BUTTON_BACKGROUNDS[link.iconKey] || LINK_BUTTON_BACKGROUNDS[inferIconKeyFromUrl(link.url, link.formId)] || LINK_BUTTON_BACKGROUNDS.link;
};

const getCustomIconUrl = (link) => cleanText(link.customIconUrl);

const isAppleMobileDevice = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = String(navigator.userAgent || "").toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
};

const QuickLinksPage = () => {
  const { id } = useParams();
  const { user, isAdmin, isGlobalAdmin } = useAuth();

  const [churchData, setChurchData] = useState(null);
  const [isQuickLinksLoading, setIsQuickLinksLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [availableForms, setAvailableForms] = useState([]);
  const [editableVideos, setEditableVideos] = useState(pageConfig.videos.map(normalizeVideo));
  const [editableLinkSections, setEditableLinkSections] = useState([
    normalizeSection({ title: "Stay Connected", subtitle: "Everything people need in one place", links: pageConfig.links }),
  ]);
  const [editableSectionTexts, setEditableSectionTexts] = useState(DEFAULT_SECTION_TEXTS);
  const [savedContentState, setSavedContentState] = useState(
    buildSanitizedContentState(pageConfig.videos.map(normalizeVideo), [normalizeSection({ title: "Stay Connected", subtitle: "Everything people need in one place", links: pageConfig.links })], DEFAULT_SECTION_TEXTS)
  );
  const [themeColors, setThemeColors] = useState(DEFAULT_THEME_COLORS);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState("videos");
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(null);
  const [selectedMediaPreviewIndex, setSelectedMediaPreviewIndex] = useState(null);
  const [selectedLinkSectionIndex, setSelectedLinkSectionIndex] = useState(null);
  const [selectedLinkSectionPreviewIndex, setSelectedLinkSectionPreviewIndex] = useState(null);
  const [selectedLinkIndex, setSelectedLinkIndex] = useState(null);
  const [selectedLinkPreviewIndex, setSelectedLinkPreviewIndex] = useState(null);
  const [uploadingImageIndex, setUploadingImageIndex] = useState(null);
  const [imageUploadFeedback, setImageUploadFeedback] = useState({ index: null, type: "", text: "" });
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [swipeHintOffset, setSwipeHintOffset] = useState(0);
  const [hasMediaInteraction, setHasMediaInteraction] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");

  const editorSectionId = "quick-links-content-editor";

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/") ? "/church" : "/organization";

  const getOrganizationFormUrl = (formId = "") => {
    const normalizedFormId = cleanText(formId);
    if (!normalizedFormId || !id) {
      return "";
    }
    return `${routePrefix}/${id}/form/${normalizedFormId}`;
  };

  const appendReturnToQueryIfFormUrl = (urlValue = "") => {
    const normalizedUrl = cleanText(urlValue);
    if (!normalizedUrl || typeof window === "undefined") {
      return normalizedUrl;
    }

    const quickLinksPath = id ? `${routePrefix}/${id}/quick-links` : "";
    if (!quickLinksPath) {
      return normalizedUrl;
    }

    try {
      const parsedUrl = new URL(normalizedUrl, window.location.origin);
      const isInternalFormPath = /^\/(organization|church)\/[^/]+\/form\/[^/?#]+\/?$/i.test(parsedUrl.pathname);
      if (!isInternalFormPath) {
        return normalizedUrl;
      }

      if (!parsedUrl.searchParams.get("returnTo")) {
        parsedUrl.searchParams.set("returnTo", quickLinksPath);
      }

      if (/^https?:\/\//i.test(normalizedUrl)) {
        return parsedUrl.toString();
      }

      const query = parsedUrl.searchParams.toString();
      return `${parsedUrl.pathname}${query ? `?${query}` : ""}${parsedUrl.hash || ""}`;
    } catch (error) {
      return normalizedUrl;
    }
  };

  const canEditContent = Boolean(user) && (isGlobalAdmin() || isAdmin() || String(user?.churchId || "") === String(id || ""));
  const canEditTheme = canEditContent;
  const canShowBackButton = Boolean(user?.uid) && Boolean(cleanText(user?.role));

  const palette = useMemo(() => {
    const primary = normalizeHexColor(themeColors.primary, DEFAULT_THEME_COLORS.primary);
    const secondary = normalizeHexColor(themeColors.secondary, DEFAULT_THEME_COLORS.secondary);
    const accent = normalizeHexColor(themeColors.accent, DEFAULT_THEME_COLORS.accent);

    return {
      primary,
      secondary,
      accent,
      pageBackground: `radial-gradient(circle at top, ${withAlpha(primary, 0.24)} 0, ${withAlpha(secondary, 0.16)} 32%, rgba(248, 250, 252, 0) 64%), linear-gradient(180deg, #F8FAFC 0%, ${withAlpha(secondary, 0.12)} 100%)`,
      logoGradient: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
      surfaceBorder: withAlpha(secondary, 0.18),
      headingIconBg: withAlpha(primary, 0.14),
      headingIconColor: primary,
      secondaryHeadingIconBg: withAlpha(secondary, 0.14),
      secondaryHeadingIconColor: secondary,
      actionBg: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
      actionText: "#FFFFFF",
      dotInactive: withAlpha(secondary, 0.3),
      linkIconBg: `linear-gradient(135deg, ${withAlpha(accent, 0.14)} 0%, ${withAlpha(secondary, 0.2)} 100%)`,
      linkIconColor: accent,
      backLinkColor: primary,
      videoShell: withAlpha(secondary, 0.9),
      sectionCardShadow: `0 10px 22px ${withAlpha(secondary, 0.12)}`,
    };
  }, [themeColors]);

  const sanitizedCurrentState = useMemo(
    () => buildSanitizedContentState(editableVideos, editableLinkSections, editableSectionTexts),
    [editableVideos, editableLinkSections, editableSectionTexts]
  );

  const hasUnsavedContentChanges = useMemo(
    () => JSON.stringify(sanitizedCurrentState) !== JSON.stringify(savedContentState),
    [sanitizedCurrentState, savedContentState]
  );

  const visibleVideos = useMemo(
    () => editableVideos.filter((video) => !!getVideoMediaUrl(video)),
    [editableVideos]
  );

  const hasMultipleVideos = visibleVideos.length > 1;
  const activeVideo = visibleVideos[activeVideoIndex] || visibleVideos[0] || null;

  const selectedLinkSection =
    selectedLinkSectionIndex !== null ? editableLinkSections[selectedLinkSectionIndex] || null : null;
  const selectedEditorLink =
    selectedLinkSection && selectedLinkIndex !== null ? (selectedLinkSection.links || [])[selectedLinkIndex] || null : null;
  const selectedEditableVideo = selectedMediaIndex !== null ? editableVideos[selectedMediaIndex] || null : null;

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareText = `${editableSectionTexts.pageTitle} ${shareUrl}`.trim();

  useEffect(() => {
    let isMounted = true;

    const loadQuickLinks = async () => {
      if (!id) {
        setIsQuickLinksLoading(false);
        return;
      }

      try {
        setIsQuickLinksLoading(true);
        setLoadError("");
        const data = await getChurchData(id);
        if (!isMounted) {
          return;
        }

        if (!data) {
          setLoadError("We could not find this organization.");
          setChurchData(null);
          return;
        }

        const contentState = buildInitialContentState(data);
        const theme = data.quickLinksTheme?.colors || {};

        setChurchData(data);
        setEditableVideos(contentState.videos);
        setEditableLinkSections(contentState.linkSections);
        setEditableSectionTexts(contentState.sectionTexts);
        setSavedContentState(cloneContentState(contentState));
        setThemeColors({
          primary: normalizeHexColor(theme.primary, DEFAULT_THEME_COLORS.primary),
          secondary: normalizeHexColor(theme.secondary, DEFAULT_THEME_COLORS.secondary),
          accent: normalizeHexColor(theme.accent, DEFAULT_THEME_COLORS.accent),
        });
      } catch (error) {
        console.error("Error loading quick links page:", error);
        if (isMounted) {
          setLoadError("We could not load this Quick Links page right now.");
        }
      } finally {
        if (isMounted) {
          setIsQuickLinksLoading(false);
        }
      }
    };

    loadQuickLinks();

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    let isMounted = true;

    const loadForms = async () => {
      if (!id) {
        setAvailableForms([]);
        return;
      }

      try {
        const formsCollection = collection(db, "churches", id, "forms");
        let snapshot;

        // Prefer server data so the selector reflects latest permissions/auth state.
        try {
          snapshot = await getDocsFromServer(formsCollection);
        } catch (serverError) {
          snapshot = await getDocs(formsCollection);
        }

        if (!isMounted) {
          return;
        }

        const forms = snapshot.docs
          .map((entry) => ({
            id: entry.id,
            ...entry.data(),
          }))
          .sort((a, b) => {
            const aLabel = cleanText(a.title) || cleanText(a.name) || a.id;
            const bLabel = cleanText(b.title) || cleanText(b.name) || b.id;
            return aLabel.localeCompare(bLabel);
          });

        setAvailableForms(forms);
      } catch (error) {
        console.error("Error loading forms for quick links:", error);
        if (isMounted) {
          setAvailableForms([]);
        }
      }
    };

    loadForms();

    return () => {
      isMounted = false;
    };
  }, [id, user?.uid]);

  useEffect(() => {
    if (visibleVideos.length === 0 && activeVideoIndex !== 0) {
      setActiveVideoIndex(0);
      return;
    }

    if (activeVideoIndex > visibleVideos.length - 1) {
      setActiveVideoIndex(Math.max(0, visibleVideos.length - 1));
    }
  }, [activeVideoIndex, visibleVideos.length]);

  useEffect(() => {
    if (!hasMultipleVideos || hasMediaInteraction) {
      setSwipeHintOffset(0);
      return undefined;
    }

    const pattern = [0, -12, 12, -8, 8, 0];
    let step = 0;
    const intervalId = window.setInterval(() => {
      step = (step + 1) % pattern.length;
      setSwipeHintOffset(pattern[step]);
    }, 260);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasMediaInteraction, hasMultipleVideos]);

  useEffect(() => {
    if (!isEditorOpen || editorTab !== "videos") {
      setSelectedMediaIndex(null);
      setSelectedMediaPreviewIndex(null);
    }
  }, [editorTab, isEditorOpen]);

  useEffect(() => {
    if (selectedMediaIndex !== null && !editableVideos[selectedMediaIndex]) {
      setSelectedMediaIndex(null);
    }
    if (selectedMediaPreviewIndex !== null && !editableVideos[selectedMediaPreviewIndex]) {
      setSelectedMediaPreviewIndex(null);
    }
  }, [editableVideos, selectedMediaIndex, selectedMediaPreviewIndex]);

  useEffect(() => {
    if (!isEditorOpen || editorTab !== "links") {
      setSelectedLinkSectionIndex(null);
      setSelectedLinkSectionPreviewIndex(null);
      setSelectedLinkIndex(null);
      setSelectedLinkPreviewIndex(null);
      return;
    }

    if (selectedLinkSectionIndex !== null && !editableLinkSections[selectedLinkSectionIndex]) {
      setSelectedLinkSectionIndex(null);
      setSelectedLinkIndex(null);
    }

    if (selectedLinkSectionPreviewIndex !== null && !editableLinkSections[selectedLinkSectionPreviewIndex]) {
      setSelectedLinkSectionPreviewIndex(null);
    }

    if (selectedLinkSectionIndex !== null && selectedLinkIndex !== null) {
      const links = editableLinkSections[selectedLinkSectionIndex]?.links || [];
      if (!links[selectedLinkIndex]) {
        setSelectedLinkIndex(null);
      }
    }

    if (selectedLinkSectionIndex !== null && selectedLinkPreviewIndex !== null) {
      const links = editableLinkSections[selectedLinkSectionIndex]?.links || [];
      if (!links[selectedLinkPreviewIndex]) {
        setSelectedLinkPreviewIndex(null);
      }
    }
  }, [
    editableLinkSections,
    editorTab,
    isEditorOpen,
    selectedLinkIndex,
    selectedLinkPreviewIndex,
    selectedLinkSectionIndex,
    selectedLinkSectionPreviewIndex,
  ]);

  const goToNextVideo = () => {
    if (!hasMultipleVideos) return;
    setHasMediaInteraction(true);
    setActiveVideoIndex((currentIndex) => (currentIndex + 1) % visibleVideos.length);
  };

  const goToPreviousVideo = () => {
    if (!hasMultipleVideos) return;
    setHasMediaInteraction(true);
    setActiveVideoIndex((currentIndex) => (currentIndex - 1 + visibleVideos.length) % visibleVideos.length);
  };

  const handleSelectVideo = (index) => {
    setHasMediaInteraction(true);
    setActiveVideoIndex(index);
  };

  const handleTouchStart = (event) => {
    setTouchStartX(event.changedTouches[0]?.clientX ?? null);
  };

  const handleTouchEnd = (event) => {
    if (!hasMultipleVideos || touchStartX === null) {
      setTouchStartX(null);
      return;
    }

    const touchEndX = event.changedTouches[0]?.clientX ?? touchStartX;
    const delta = touchStartX - touchEndX;
    const swipeThreshold = 32;

    if (Math.abs(delta) >= swipeThreshold) {
      setHasMediaInteraction(true);
      if (delta > 0) {
        goToNextVideo();
      } else {
        goToPreviousVideo();
      }
    }

    setTouchStartX(null);
  };

  const handleInstagramShare = async () => {
    if (!shareUrl || typeof navigator === "undefined" || !navigator.clipboard) {
      setShareFeedback("Copy not supported in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareFeedback("Link copied for Instagram.");
    } catch (error) {
      setShareFeedback("Could not copy link. Please copy from address bar.");
    }
  };

  const handleOpenEditor = (tab = "videos") => {
    setEditorTab(tab);
    setIsEditorOpen(true);
  };

  useEffect(() => {
    if (!isEditorOpen) {
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      const editorElement = document.getElementById(editorSectionId);
      if (editorElement) {
        editorElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 60);

    return () => {
      window.clearTimeout(scrollTimer);
    };
  }, [editorSectionId, isEditorOpen, editorTab]);

  const handleCloseContentEditor = () => {
    setIsEditorOpen(false);
    setSelectedMediaIndex(null);
    setSelectedMediaPreviewIndex(null);
    setSelectedLinkSectionIndex(null);
    setSelectedLinkSectionPreviewIndex(null);
    setSelectedLinkIndex(null);
    setSelectedLinkPreviewIndex(null);
  };

  const handleDiscardContentChanges = () => {
    const restored = cloneContentState(savedContentState);
    setEditableVideos(restored.videos);
    setEditableLinkSections(restored.linkSections);
    setEditableSectionTexts(restored.sectionTexts);
    handleCloseContentEditor();
  };

  const handleThemeColorChange = (key, value) => {
    setThemeColors((previous) => ({
      ...previous,
      [key]: normalizeHexColor(value, previous[key] || DEFAULT_THEME_COLORS[key]),
    }));
  };

  const handleResetTheme = () => {
    setThemeColors(DEFAULT_THEME_COLORS);
  };

  const handleSaveTheme = async () => {
    if (!id || !canEditTheme) {
      return;
    }

    try {
      setIsSavingTheme(true);
      await updateDoc(doc(db, "churches", id), {
        quickLinksTheme: {
          colors: {
            primary: palette.primary,
            secondary: palette.secondary,
            accent: palette.accent,
          },
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid || null,
        },
      });
    } catch (error) {
      console.error("Error saving quick links theme:", error);
    } finally {
      setIsSavingTheme(false);
    }
  };

  const handleVideoFieldChange = (index, field, value) => {
    setEditableVideos((previous) =>
      previous.map((video, videoIndex) =>
        videoIndex === index
          ? {
              ...video,
              [field]: value,
            }
          : video
      )
    );
  };

  const handleVideoTypeChange = (index, type) => {
    setEditableVideos((previous) =>
      previous.map((video, videoIndex) =>
        videoIndex === index
          ? {
              ...video,
              type,
              embedUrl: type === "image" ? "" : video.embedUrl,
              imageUrl: type === "video" ? "" : video.imageUrl,
            }
          : video
      )
    );
  };

  const handleAddVideo = (type = "video") => {
    setEditableVideos((previous) => {
      const nextIndex = previous.length;
      setSelectedMediaPreviewIndex(nextIndex);
      setSelectedMediaIndex(nextIndex);
      return [...previous, { ...DEFAULT_EDITOR_VIDEO, type }];
    });
  };

  const handleDeleteVideo = (index) => {
    setEditableVideos((previous) => previous.filter((_, videoIndex) => videoIndex !== index));

    setSelectedMediaIndex((previous) => {
      if (previous === null) return previous;
      if (previous === index) return null;
      if (previous > index) return previous - 1;
      return previous;
    });

    setSelectedMediaPreviewIndex((previous) => {
      if (previous === null) return previous;
      if (previous === index) return null;
      if (previous > index) return previous - 1;
      return previous;
    });
  };

  const handleMoveVideo = (index, direction) => {
    setEditableVideos((previous) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });

    setSelectedMediaIndex((previous) => {
      if (previous === null) return previous;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (previous === index) return targetIndex;
      if (previous === targetIndex) return index;
      return previous;
    });

    setSelectedMediaPreviewIndex((previous) => {
      if (previous === null) return previous;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (previous === index) return targetIndex;
      if (previous === targetIndex) return index;
      return previous;
    });
  };

  const handleVideoCtaFormChange = (index, formId) => {
    const formUrl = getOrganizationFormUrl(formId);
    setEditableVideos((previous) =>
      previous.map((video, videoIndex) =>
        videoIndex === index
          ? {
              ...video,
              ctaFormId: formId,
              ctaUrl: formUrl || video.ctaUrl,
            }
          : video
      )
    );
  };

  const handleLinkSectionFieldChange = (sectionIndex, field, value) => {
    setEditableLinkSections((previous) =>
      previous.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              [field]: value,
            }
          : section
      )
    );
  };

  const handleLinkFieldChange = (sectionIndex, linkIndex, field, value) => {
    setEditableLinkSections((previous) =>
      previous.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              links: (section.links || []).map((link, currentLinkIndex) => {
                if (currentLinkIndex !== linkIndex) {
                  return link;
                }

                if (field !== "iconKey") {
                  return {
                    ...link,
                    [field]: value,
                  };
                }

                const nextIconKey = cleanText(value) || "link";
                const currentUrl = cleanText(link.url);
                const knownTemplates = new Set(Object.values(LINK_TYPE_URL_TEMPLATES).map((template) => cleanText(template)));
                const isTemplateUrl = knownTemplates.has(currentUrl);

                let nextUrl = currentUrl;
                if ((nextIconKey === "map" || nextIconKey === "form") && (isTemplateUrl || !currentUrl)) {
                  nextUrl = "";
                }
                if (nextIconKey !== "map" && nextIconKey !== "form" && !currentUrl) {
                  nextUrl = LINK_TYPE_URL_TEMPLATES[nextIconKey] || "https://";
                }

                return {
                  ...link,
                  iconKey: nextIconKey,
                  url: nextUrl,
                };
              }),
            }
          : section
      )
    );
  };

  const handleApplyLinkTypeTemplate = (sectionIndex, linkIndex, iconKey) => {
    const template = LINK_TYPE_URL_TEMPLATES[iconKey] || "https://";
    handleLinkFieldChange(sectionIndex, linkIndex, "url", template);
  };

  const handleAddLink = (sectionIndex) => {
    setEditableLinkSections((previous) =>
      previous.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              links: [...(section.links || []), { ...DEFAULT_EDITOR_LINK }],
            }
          : section
      )
    );
  };

  const handleDeleteLink = (sectionIndex, linkIndex) => {
    setEditableLinkSections((previous) =>
      previous.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              links: (section.links || []).filter((_, currentLinkIndex) => currentLinkIndex !== linkIndex),
            }
          : section
      )
    );

    if (selectedLinkSectionIndex === sectionIndex) {
      setSelectedLinkIndex((previous) => {
        if (previous === null) return previous;
        if (previous === linkIndex) return null;
        if (previous > linkIndex) return previous - 1;
        return previous;
      });

      setSelectedLinkPreviewIndex((previous) => {
        if (previous === null) return previous;
        if (previous === linkIndex) return null;
        if (previous > linkIndex) return previous - 1;
        return previous;
      });
    }
  };

  const handleMoveLinkToSection = (fromSectionIndex, linkIndex, toSectionIndex) => {
    if (fromSectionIndex === toSectionIndex) {
      return;
    }

    setEditableLinkSections((previous) => {
      const fromSection = previous[fromSectionIndex];
      const toSection = previous[toSectionIndex];
      if (!fromSection || !toSection) {
        return previous;
      }

      const linkToMove = (fromSection.links || [])[linkIndex];
      if (!linkToMove) {
        return previous;
      }

      return previous.map((section, index) => {
        if (index === fromSectionIndex) {
          return {
            ...section,
            links: (section.links || []).filter((_, currentLinkIndex) => currentLinkIndex !== linkIndex),
          };
        }

        if (index === toSectionIndex) {
          return {
            ...section,
            links: [...(section.links || []), linkToMove],
          };
        }

        return section;
      });
    });

    if (selectedLinkSectionIndex === fromSectionIndex) {
      setSelectedLinkIndex(null);
      setSelectedLinkPreviewIndex(null);
    }
  };

  const handleAddLinkSection = () => {
    setEditableLinkSections((previous) => [...previous, { ...DEFAULT_EDITOR_LINK_SECTION, links: [{ ...DEFAULT_EDITOR_LINK }] }]);
  };

  const handleMoveLinkSection = (sectionIndex, direction) => {
    setEditableLinkSections((previous) => {
      const targetIndex = direction === "up" ? sectionIndex - 1 : sectionIndex + 1;
      if (targetIndex < 0 || targetIndex >= previous.length) {
        return previous;
      }

      const next = [...previous];
      const [movedSection] = next.splice(sectionIndex, 1);
      next.splice(targetIndex, 0, movedSection);
      return next;
    });

    setSelectedLinkSectionIndex((previous) => {
      if (previous === null) return previous;
      const targetIndex = direction === "up" ? sectionIndex - 1 : sectionIndex + 1;
      if (previous === sectionIndex) return targetIndex;
      if (previous === targetIndex) return sectionIndex;
      return previous;
    });

    setSelectedLinkSectionPreviewIndex((previous) => {
      if (previous === null) return previous;
      const targetIndex = direction === "up" ? sectionIndex - 1 : sectionIndex + 1;
      if (previous === sectionIndex) return targetIndex;
      if (previous === targetIndex) return sectionIndex;
      return previous;
    });
  };

  const handleMoveLinkWithinSection = (sectionIndex, linkIndex, direction) => {
    setEditableLinkSections((previous) =>
      previous.map((section, index) => {
        if (index !== sectionIndex) {
          return section;
        }

        const links = [...(section.links || [])];
        const targetIndex = direction === "up" ? linkIndex - 1 : linkIndex + 1;
        if (targetIndex < 0 || targetIndex >= links.length) {
          return section;
        }

        const [movedLink] = links.splice(linkIndex, 1);
        links.splice(targetIndex, 0, movedLink);

        return {
          ...section,
          links,
        };
      })
    );

    if (selectedLinkSectionIndex === sectionIndex) {
      setSelectedLinkIndex((previous) => {
        if (previous === null) return previous;
        const targetIndex = direction === "up" ? linkIndex - 1 : linkIndex + 1;
        if (previous === linkIndex) return targetIndex;
        if (previous === targetIndex) return linkIndex;
        return previous;
      });

      setSelectedLinkPreviewIndex((previous) => {
        if (previous === null) return previous;
        const targetIndex = direction === "up" ? linkIndex - 1 : linkIndex + 1;
        if (previous === linkIndex) return targetIndex;
        if (previous === targetIndex) return linkIndex;
        return previous;
      });
    }
  };

  const handleDeleteLinkSection = (sectionIndex) => {
    setEditableLinkSections((previous) => previous.filter((_, index) => index !== sectionIndex));

    setSelectedLinkSectionIndex((previous) => {
      if (previous === null) return previous;
      if (previous === sectionIndex) return null;
      if (previous > sectionIndex) return previous - 1;
      return previous;
    });

    setSelectedLinkSectionPreviewIndex((previous) => {
      if (previous === null) return previous;
      if (previous === sectionIndex) return null;
      if (previous > sectionIndex) return previous - 1;
      return previous;
    });

    setSelectedLinkIndex(null);
    setSelectedLinkPreviewIndex(null);
  };

  const handleLinkFormChange = (sectionIndex, linkIndex, formId) => {
    const formUrl = getOrganizationFormUrl(formId);
    setEditableLinkSections((previous) =>
      previous.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              links: (section.links || []).map((link, currentLinkIndex) =>
                currentLinkIndex === linkIndex
                  ? {
                      ...link,
                      formId,
                      url: formUrl || link.url,
                    }
                  : link
              ),
            }
          : section
      )
    );
  };

  const handleSectionTextChange = (field, value) => {
    setEditableSectionTexts((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleImageUpload = async (index, file) => {
    setImageUploadFeedback({ index: null, type: "", text: "" });

    if (!file || !id || !canEditContent || !storage) {
      let message = "Image upload is not available right now.";
      if (!id) message = "Missing organization ID for upload.";
      if (!canEditContent) message = "You do not have permission to upload images.";
      if (!storage) message = "Firebase Storage is not configured.";
      setImageUploadFeedback({ index, type: "error", text: message });
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      setImageUploadFeedback({ index, type: "error", text: "Please choose a valid image file." });
      return;
    }

    try {
      setUploadingImageIndex(index);

      const safeFileName = String(file.name || "image")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 120);
      const filePath = `quick-links/${id}/media/${Date.now()}_${safeFileName}`;
      const storageRef = ref(storage, filePath);
      const metadata = {
        contentType: file.type,
        customMetadata: {
          uploadedBy: user?.uid || "unknown",
          churchId: id,
          feature: "quick-links",
        },
      };

      await uploadBytes(storageRef, file, metadata);
      const downloadUrl = await getDownloadURL(storageRef);

      const nextVideos = editableVideos.map((video, videoIndex) =>
        videoIndex === index
          ? {
              ...video,
              type: "image",
              imageUrl: downloadUrl,
              embedUrl: "",
            }
          : video
      );

      setEditableVideos(nextVideos);

      const sanitizedContentState = buildSanitizedContentState(nextVideos, editableLinkSections, editableSectionTexts);

      await updateDoc(doc(db, "churches", id), {
        quickLinksConfig: {
          videos: sanitizedContentState.videos,
          links: sanitizedContentState.links,
          linkSections: sanitizedContentState.linkSections,
          sectionTexts: sanitizedContentState.sectionTexts,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid || null,
        },
      });

      setSavedContentState(cloneContentState(sanitizedContentState));
      setImageUploadFeedback({ index, type: "success", text: "Image uploaded and saved." });
    } catch (error) {
      console.error("Error uploading quick links image:", error);
      setImageUploadFeedback({
        index,
        type: "error",
        text: `Upload failed: ${error?.message || "Unknown error"}`,
      });
    } finally {
      setUploadingImageIndex(null);
    }
  };

  const handleSaveQuickLinksContent = async () => {
    if (!id || !canEditContent) {
      return;
    }

    try {
      setIsSavingContent(true);
      const nextState = buildSanitizedContentState(editableVideos, editableLinkSections, editableSectionTexts);
      await updateDoc(doc(db, "churches", id), {
        quickLinksConfig: {
          videos: nextState.videos,
          links: nextState.links,
          linkSections: nextState.linkSections,
          sectionTexts: nextState.sectionTexts,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid || null,
        },
      });

      setEditableVideos(nextState.videos);
      setEditableLinkSections(nextState.linkSections);
      setEditableSectionTexts(nextState.sectionTexts);
      setSavedContentState(cloneContentState(nextState));
    } catch (error) {
      console.error("Error saving quick links content:", error);
    } finally {
      setIsSavingContent(false);
    }
  };

  const getResolvedCtaUrl = (video) => {
    if (!video) return "";

    const mappedFormUrl = getOrganizationFormUrl(video.ctaFormId);
    if (mappedFormUrl) {
      return appendReturnToQueryIfFormUrl(mappedFormUrl);
    }

    return appendReturnToQueryIfFormUrl(cleanText(video.ctaUrl));
  };

  const getResolvedLinkHref = (link) => {
    if (!link) return "";
    if (link.iconKey === "form" || cleanText(link.formId)) {
      return appendReturnToQueryIfFormUrl(getOrganizationFormUrl(link.formId) || cleanText(link.url));
    }
    if (link.iconKey === "map") {
      const value = cleanText(link.url);
      if (!value) {
        return "";
      }
      if (value.startsWith("http://") || value.startsWith("https://")) {
        return value;
      }

      if (isAppleMobileDevice()) {
        return `https://maps.apple.com/?q=${encodeURIComponent(value)}`;
      }

      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
    }
    return appendReturnToQueryIfFormUrl(cleanText(link.url));
  };

  const renderLinkIcon = (link) => {
    const customIconUrl = getCustomIconUrl(link);
    if (customIconUrl) {
      return <img src={customIconUrl} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />;
    }

    const Icon = LINK_ICON_MAP[link.iconKey] || FaLink;
    return <Icon />;
  };

  if (isQuickLinksLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "20px 16px 36px" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <div style={{ ...sectionCardStyle({ surfaceBorder: "#E2E8F0", sectionCardShadow: "0 20px 40px rgba(15, 23, 42, 0.08)" }), padding: "24px 18px" }}>
            <div style={{ display: "grid", placeItems: "center", gap: "14px", marginBottom: "22px" }}>
              <div style={{ width: "clamp(150px, 42vw, 216px)", height: "clamp(150px, 42vw, 216px)", borderRadius: "999px", background: "linear-gradient(90deg, #E2E8F0 0%, #F1F5F9 50%, #E2E8F0 100%)" }} />
              <div style={{ width: "min(340px, 80%)", height: "34px", borderRadius: "10px", background: "linear-gradient(90deg, #E2E8F0 0%, #F1F5F9 50%, #E2E8F0 100%)" }} />
              <div style={{ width: "min(520px, 92%)", height: "18px", borderRadius: "8px", background: "linear-gradient(90deg, #E2E8F0 0%, #F1F5F9 50%, #E2E8F0 100%)" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ minHeight: "100vh", background: "#F8FAFC", display: "grid", placeItems: "center", padding: "24px" }}>
        <div style={{ ...sectionCardStyle(palette), maxWidth: "560px", padding: "28px", textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.8rem", color: "#0F172A" }}>Quick Links</h1>
          <p style={{ margin: "12px 0 0", color: "#475569" }}>{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: palette.pageBackground, color: "#0F172A" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "20px 16px 36px" }}>
        {canShowBackButton && (
          <div style={{ marginBottom: "16px" }}>
            <Link to={`${routePrefix}/${id}/mi-organizacion`} style={{ color: palette.backLinkColor, textDecoration: "none", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "8px" }}>
              <FaChevronLeft />
              Back
            </Link>
          </div>
        )}

        <section style={{ ...sectionCardStyle(palette), padding: "24px 20px", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: "14px", justifyItems: "center", textAlign: "center", flex: "1 1 260px" }}>
              <div style={{ width: "clamp(92px, 28vw, 170px)", height: "clamp(92px, 28vw, 170px)", borderRadius: "999px", padding: `${pageConfig.logoBorderWidth}px`, background: pageConfig.logoBorderColor, boxShadow: `0 16px 30px ${withAlpha(palette.primary, 0.28)}` }}>
                <div style={{ width: "100%", height: "100%", borderRadius: "999px", background: palette.logoGradient, display: "grid", placeItems: "center", overflow: "hidden" }}>
                  {churchData?.logo ? (
                    <img
                      src={churchData.logo}
                      alt={churchData?.name ? `${churchData.name} logo` : "Organization logo"}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        padding: "12%",
                        boxSizing: "border-box",
                        background: "#FFFFFF",
                        borderRadius: "999px",
                      }}
                    />
                  ) : (
                    <span style={{ color: "#FFFFFF", fontWeight: 800, fontSize: "2rem", letterSpacing: "0.04em" }}>
                      {cleanText(churchData?.name).slice(0, 2).toUpperCase() || "QL"}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
                <div style={{ color: "#64748B", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.75rem" }}>
                  {churchData?.name || "Organization"}
                </div>
                <h1 style={{ margin: 0, fontSize: "clamp(2rem, 6vw, 3.1rem)", lineHeight: 1.05 }}>{editableSectionTexts.pageTitle}</h1>
                <p style={{ margin: 0, color: "#475569", fontSize: "1.02rem", lineHeight: 1.65, maxWidth: "56ch" }}>{editableSectionTexts.pageSubtitle}</p>
              </div>
            </div>

            {canEditContent && (
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end", flex: "1 1 200px" }}>
                <button type="button" onClick={() => handleOpenEditor("videos")} style={{ border: "none", borderRadius: "999px", padding: "10px 16px", background: isEditorOpen ? "#0369A1" : palette.actionBg, color: "#FFFFFF", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px", boxShadow: isEditorOpen ? "0 0 0 3px rgba(3, 105, 161, 0.22)" : "none" }}>
                  <FaEdit />
                  {isEditorOpen ? "Editor Open" : "Edit Content"}
                </button>
                <button type="button" onClick={() => handleOpenEditor("theme")} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "10px 16px", background: "#FFFFFF", color: palette.primary, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <FaPalette />
                  Theme
                </button>
              </div>
            )}
          </div>
        </section>

        {!!activeVideo && (
          <section style={{ ...sectionCardStyle(palette), marginTop: "28px", padding: "20px", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "12px", display: "grid", placeItems: "center", background: palette.headingIconBg, color: palette.headingIconColor }}>
                <FaPlay />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.45rem" }}>{activeVideo.title || "Featured Media"}</h2>
                {activeVideo.description && <p style={{ margin: "4px 0 0", color: "#64748B" }}>{activeVideo.description}</p>}
              </div>
            </div>

            <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={{ position: "relative" }}>
              <div style={{ position: "relative", borderRadius: "22px", overflow: "hidden", background: palette.videoShell, aspectRatio: "16 / 9", transform: `translateX(${swipeHintOffset}px)`, transition: "transform 180ms ease" }}>
                {activeVideo.type === "image" ? (
                  <img src={activeVideo.imageUrl} alt={activeVideo.title || "Quick links media"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <iframe src={resolveEmbedUrl(activeVideo.embedUrl)} title={activeVideo.title || "Quick links video"} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen style={{ width: "100%", height: "100%", border: 0 }} />
                )}
              </div>

              {hasMultipleVideos && (
                <>
                  <button type="button" onClick={goToPreviousVideo} aria-label="Previous media" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", width: "42px", height: "42px", borderRadius: "999px", border: "none", background: "rgba(15, 23, 42, 0.55)", color: "#FFFFFF", display: "grid", placeItems: "center", cursor: "pointer" }}>
                    <FaChevronLeft />
                  </button>
                  <button type="button" onClick={goToNextVideo} aria-label="Next media" style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", width: "42px", height: "42px", borderRadius: "999px", border: "none", background: "rgba(15, 23, 42, 0.55)", color: "#FFFFFF", display: "grid", placeItems: "center", cursor: "pointer" }}>
                    <FaChevronRight />
                  </button>
                </>
              )}
            </div>

            {!!getResolvedCtaUrl(activeVideo) && (
              <div style={{ marginTop: "16px" }}>
                <a href={getResolvedCtaUrl(activeVideo)} target={getResolvedCtaUrl(activeVideo).startsWith("http") ? "_blank" : undefined} rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "220px", padding: "12px 18px", borderRadius: "999px", textDecoration: "none", background: palette.actionBg, color: "#FFFFFF", fontWeight: 800 }}>
                  {activeVideo.ctaText || "Open"}
                </a>
              </div>
            )}

            {hasMultipleVideos && (
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap", marginTop: "18px" }}>
                {visibleVideos.map((video, index) => (
                  <button key={`video-dot-${index}`} type="button" onClick={() => handleSelectVideo(index)} aria-label={`Show media ${index + 1}`} style={{ width: activeVideoIndex === index ? "38px" : "12px", height: "12px", borderRadius: "999px", border: "none", background: activeVideoIndex === index ? palette.primary : palette.dotInactive, cursor: "pointer", transition: "all 180ms ease" }} />
                ))}
              </div>
            )}
          </section>
        )}

        <div style={{ display: "grid", gap: "28px", marginTop: "28px" }}>
          {editableLinkSections.map((section, sectionIndex) => (
            <section key={`public-section-${sectionIndex}`} style={{ ...sectionCardStyle(palette), padding: "22px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <div style={{ width: "42px", height: "42px", borderRadius: "12px", display: "grid", placeItems: "center", background: palette.secondaryHeadingIconBg, color: palette.secondaryHeadingIconColor }}>
                  <FaLink />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.55rem", lineHeight: 1.1 }}>{section.title || `Section ${sectionIndex + 1}`}</h2>
                  {section.subtitle && <p style={{ margin: "4px 0 0", color: "#64748B" }}>{section.subtitle}</p>}
                </div>
              </div>

              <div style={{ display: "grid", gap: "14px" }}>
                {(section.links || []).map((link, linkIndex) => {
                  const href = getResolvedLinkHref(link);
                  const background = getButtonBackground(link);
                  const isExternal = href.startsWith("http://") || href.startsWith("https://");
                  return (
                    <a
                      key={`public-link-${sectionIndex}-${linkIndex}`}
                      href={href || "#"}
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noreferrer" : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        borderRadius: "18px",
                        padding: "15px 16px",
                        textDecoration: "none",
                        background,
                        color: "#FFFFFF",
                        boxShadow: "0 16px 30px rgba(15, 23, 42, 0.14)",
                      }}
                    >
                      <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "rgba(255,255,255,0.16)", display: "grid", placeItems: "center", fontSize: "1.2rem", flexShrink: 0 }}>
                        {renderLinkIcon(link)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{link.label || `Link ${linkIndex + 1}`}</div>
                        {link.description && <div style={{ marginTop: "3px", fontSize: "0.88rem", color: "rgba(255,255,255,0.86)" }}>{link.description}</div>}
                      </div>
                      <FaChevronRight style={{ flexShrink: 0 }} />
                    </a>
                  );
                })}
              </div>
            </section>
          ))}

          {(editableSectionTexts.locationTitle || editableSectionTexts.locationAddress) && (
            <section style={{ ...sectionCardStyle(palette), padding: "22px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <div style={{ width: "42px", height: "42px", borderRadius: "12px", display: "grid", placeItems: "center", background: withAlpha(palette.accent, 0.16), color: palette.accent }}>
                  <FaMapMarkerAlt />
                </div>
                <h2 style={{ margin: 0, fontSize: "1.45rem" }}>{editableSectionTexts.locationTitle || "Visit Us"}</h2>
              </div>
              {editableSectionTexts.locationAddress && <p style={{ margin: 0, color: "#475569", lineHeight: 1.65 }}>{editableSectionTexts.locationAddress}</p>}
              {editableSectionTexts.locationAddress && (
                <div style={{ marginTop: "16px" }}>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(editableSectionTexts.locationAddress)}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: "999px", padding: "10px 16px", textDecoration: "none", background: LINK_BUTTON_BACKGROUNDS.map, color: "#FFFFFF", fontWeight: 800 }}>
                    <FaMapMarkerAlt />
                    Open Map
                  </a>
                </div>
              )}
            </section>
          )}

          <section style={{ ...sectionCardStyle(palette), padding: "22px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "12px", display: "grid", placeItems: "center", background: withAlpha(palette.primary, 0.14), color: palette.primary }}>
                <FaShareAlt />
              </div>
              <h2 style={{ margin: 0, fontSize: "1.4rem" }}>Share This Page</h2>
            </div>
            <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", borderRadius: "12px", padding: "10px 12px", textDecoration: "none", background: LINK_BUTTON_BACKGROUNDS.whatsapp, color: "#FFFFFF", fontWeight: 700 }}>
                <FaWhatsapp />
                WhatsApp
              </a>
              <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", borderRadius: "12px", padding: "10px 12px", textDecoration: "none", background: LINK_BUTTON_BACKGROUNDS.facebook, color: "#FFFFFF", fontWeight: 700 }}>
                <FaFacebook />
                Facebook
              </a>
              <a href={`sms:?&body=${encodeURIComponent(shareText)}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", borderRadius: "12px", padding: "10px 12px", textDecoration: "none", background: LINK_BUTTON_BACKGROUNDS.globe, color: "#FFFFFF", fontWeight: 700 }}>
                <FaLink />
                SMS
              </a>
              <button type="button" onClick={handleInstagramShare} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", borderRadius: "12px", border: "none", padding: "10px 12px", background: LINK_BUTTON_BACKGROUNDS.instagram, color: "#FFFFFF", fontWeight: 700, cursor: "pointer" }}>
                <FaInstagram />
                Instagram
              </button>
            </div>
            {!!shareFeedback && <div style={{ marginTop: "8px", fontSize: "0.85rem", color: "#334155", fontWeight: 700 }}>{shareFeedback}</div>}
          </section>
        </div>

        {isEditorOpen && canEditContent && (
          <section id={editorSectionId} style={{ ...sectionCardStyle(palette), marginTop: "28px", padding: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.5rem" }}>Content Editor</h2>
                <p style={{ margin: "4px 0 0", color: "#64748B" }}>Make a selection first, then open the item you want to edit.</p>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {[
                  { key: "videos", label: "Media" },
                  { key: "links", label: "Links" },
                  { key: "text", label: "Text" },
                  { key: "theme", label: "Theme" },
                ].map((tab) => (
                  <button key={tab.key} type="button" onClick={() => setEditorTab(tab.key)} style={{ border: "none", borderRadius: "999px", padding: "8px 14px", background: editorTab === tab.key ? palette.actionBg : "#E2E8F0", color: editorTab === tab.key ? "#FFFFFF" : "#334155", fontWeight: 700, cursor: "pointer" }}>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: "14px", marginTop: "18px" }}>
              {editorTab === "videos" && (
                <>
                  {selectedEditableVideo === null && (
                    <div style={{ display: "grid", gap: "12px" }}>
                      {editableVideos.map((video, index) => {
                        const isSelected = selectedMediaPreviewIndex === index;
                        const mediaUrl = getVideoMediaUrl(video);
                        return (
                          <div key={`media-preview-${index}`} role="button" tabIndex={0} onClick={() => setSelectedMediaPreviewIndex(index)} onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedMediaPreviewIndex(index);
                            }
                          }} style={{ border: isSelected ? "2px solid #0284C7" : `1px solid ${palette.surfaceBorder}`, borderRadius: "16px", padding: "14px", background: isSelected ? "#F0F9FF" : "#FFFFFF", boxShadow: isSelected ? "0 0 0 2px rgba(2,132,199,0.15)" : "none", cursor: "pointer", display: "grid", gap: "10px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                              <div>
                                <div style={{ fontWeight: 800 }}>{video.title || `Media Item ${index + 1}`}</div>
                                <div style={{ color: "#64748B", fontSize: "0.88rem" }}>{video.type === "image" ? "Image" : "Video"}</div>
                              </div>
                              {isSelected && <span style={{ borderRadius: "999px", padding: "3px 8px", background: "#0C4A6E", color: "#FFFFFF", fontWeight: 700, fontSize: "0.72rem" }}>Selected</span>}
                            </div>
                            <div style={{ color: "#475569", fontSize: "0.9rem" }}>{video.description || "No description yet"}</div>
                            <div style={{ color: mediaUrl ? "#0F766E" : "#B91C1C", fontWeight: 700, fontSize: "0.83rem" }}>{mediaUrl ? "Media attached" : "No media attached yet"}</div>
                          </div>
                        );
                      })}

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => {
                          if (selectedMediaPreviewIndex === null) return;
                          setSelectedMediaIndex(selectedMediaPreviewIndex);
                        }} disabled={selectedMediaPreviewIndex === null} style={{ border: "none", borderRadius: "999px", padding: "10px 14px", background: selectedMediaPreviewIndex === null ? "#E2E8F0" : "#0369A1", color: selectedMediaPreviewIndex === null ? "#94A3B8" : "#FFFFFF", fontWeight: 700, cursor: selectedMediaPreviewIndex === null ? "not-allowed" : "pointer" }}>
                          {selectedMediaPreviewIndex === null ? "Select Media First" : "Open Selected Item"}
                        </button>
                        <button type="button" onClick={() => handleAddVideo("video")} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "10px 14px", background: "#FFFFFF", color: "#0F172A", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaPlus />
                          Add Video
                        </button>
                        <button type="button" onClick={() => handleAddVideo("image")} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "10px 14px", background: "#FFFFFF", color: "#0F172A", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaPlus />
                          Add Image
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedEditableVideo !== null && (
                    <div style={{ display: "grid", gap: "12px" }}>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => setSelectedMediaIndex(null)} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "8px 12px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}>
                          Back To Media List
                        </button>
                        <button type="button" onClick={() => handleMoveVideo(selectedMediaIndex, "up")} disabled={selectedMediaIndex === 0} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: selectedMediaIndex === 0 ? "#E2E8F0" : "#DBEAFE", color: selectedMediaIndex === 0 ? "#94A3B8" : "#1D4ED8", fontWeight: 700, cursor: selectedMediaIndex === 0 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaArrowUp />
                          Move Up
                        </button>
                        <button type="button" onClick={() => handleMoveVideo(selectedMediaIndex, "down")} disabled={selectedMediaIndex === editableVideos.length - 1} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: selectedMediaIndex === editableVideos.length - 1 ? "#E2E8F0" : "#DBEAFE", color: selectedMediaIndex === editableVideos.length - 1 ? "#94A3B8" : "#1D4ED8", fontWeight: 700, cursor: selectedMediaIndex === editableVideos.length - 1 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaArrowDown />
                          Move Down
                        </button>
                        <button type="button" onClick={() => handleDeleteVideo(selectedMediaIndex)} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: "#FEE2E2", color: "#B91C1C", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaTrash />
                          Delete
                        </button>
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Title</label>
                        <input value={selectedEditableVideo.title} onChange={(event) => handleVideoFieldChange(selectedMediaIndex, "title", event.target.value)} placeholder="Media title" style={inputStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Description</label>
                        <textarea value={selectedEditableVideo.description} onChange={(event) => handleVideoFieldChange(selectedMediaIndex, "description", event.target.value)} placeholder="Optional description" style={textareaStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Media Type</label>
                        <select value={selectedEditableVideo.type} onChange={(event) => handleVideoTypeChange(selectedMediaIndex, event.target.value)} style={inputStyle}>
                          <option value="video">Video</option>
                          <option value="image">Image</option>
                        </select>
                      </div>

                      {selectedEditableVideo.type === "video" ? (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <label style={{ fontWeight: 700 }}>Video URL</label>
                          <input value={selectedEditableVideo.embedUrl} onChange={(event) => handleVideoFieldChange(selectedMediaIndex, "embedUrl", event.target.value)} placeholder="https://youtube.com/watch?v=..." style={inputStyle} />
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: "10px" }}>
                          {selectedEditableVideo.imageUrl ? (
                            <div style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "14px", padding: "10px", background: "#F8FAFC", display: "grid", gap: "8px" }}>
                              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#334155" }}>Image Preview</div>
                              <img
                                src={selectedEditableVideo.imageUrl}
                                alt={selectedEditableVideo.title || "Selected media preview"}
                                style={{ width: "100%", maxHeight: "220px", objectFit: "cover", borderRadius: "10px", background: "#E2E8F0" }}
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            </div>
                          ) : null}
                          <div style={{ display: "grid", gap: "8px" }}>
                            <label style={{ fontWeight: 700 }}>Image URL (optional)</label>
                            <input value={selectedEditableVideo.imageUrl} onChange={(event) => handleVideoFieldChange(selectedMediaIndex, "imageUrl", event.target.value)} placeholder="https://..." style={inputStyle} />
                          </div>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: "999px", padding: "10px 14px", background: "#DBEAFE", color: "#1D4ED8", fontWeight: 700, cursor: uploadingImageIndex === selectedMediaIndex ? "progress" : "pointer", width: "fit-content" }}>
                            <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingImageIndex === selectedMediaIndex} onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                handleImageUpload(selectedMediaIndex, file);
                              }
                              event.target.value = "";
                            }} />
                            {uploadingImageIndex === selectedMediaIndex ? "Uploading..." : "Upload Image"}
                          </label>
                          {imageUploadFeedback.index === selectedMediaIndex && imageUploadFeedback.text && (
                            <div style={{ color: imageUploadFeedback.type === "error" ? "#B91C1C" : "#0F766E", fontWeight: 700, fontSize: "0.86rem" }}>{imageUploadFeedback.text}</div>
                          )}
                        </div>
                      )}

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>CTA Button Text</label>
                        <input value={selectedEditableVideo.ctaText} onChange={(event) => handleVideoFieldChange(selectedMediaIndex, "ctaText", event.target.value)} placeholder="Watch Now / Fill Out Form / Learn More" style={inputStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>CTA URL</label>
                        <input value={selectedEditableVideo.ctaUrl} onChange={(event) => handleVideoFieldChange(selectedMediaIndex, "ctaUrl", event.target.value)} placeholder="https://..." style={inputStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Or Link To A Form</label>
                        <select value={selectedEditableVideo.ctaFormId || ""} onChange={(event) => handleVideoCtaFormChange(selectedMediaIndex, event.target.value)} style={inputStyle}>
                          <option value="">No form selected</option>
                          {availableForms.map((form) => (
                            <option key={form.id} value={form.id}>{cleanText(form.title) || cleanText(form.name) || form.id}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {editorTab === "links" && (
                <>
                  {selectedLinkSection === null && (
                    <div style={{ display: "grid", gap: "12px" }}>
                      {editableLinkSections.map((section, sectionIndex) => {
                        const isSelected = selectedLinkSectionPreviewIndex === sectionIndex;
                        return (
                          <div key={`link-section-overview-${sectionIndex}`} role="button" tabIndex={0} onClick={() => {
                            setSelectedLinkSectionPreviewIndex(sectionIndex);
                            setSelectedLinkPreviewIndex(null);
                          }} onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedLinkSectionPreviewIndex(sectionIndex);
                              setSelectedLinkPreviewIndex(null);
                            }
                          }} style={{ border: isSelected ? "2px solid #0284C7" : `1px solid ${palette.surfaceBorder}`, borderRadius: "16px", padding: "14px", background: isSelected ? "#F0F9FF" : "#FFFFFF", boxShadow: isSelected ? "0 0 0 2px rgba(2,132,199,0.15)" : "none", cursor: "pointer", display: "grid", gap: "8px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                              <div style={{ fontWeight: 800, color: "#0F172A" }}>{section.title || `Section ${sectionIndex + 1}`}</div>
                              {isSelected && <span style={{ borderRadius: "999px", padding: "3px 8px", background: "#0C4A6E", color: "#FFFFFF", fontWeight: 700, fontSize: "0.72rem" }}>Selected</span>}
                            </div>
                            <div style={{ color: "#64748B", fontSize: "0.86rem" }}>{section.subtitle || "No subtitle yet"}</div>
                            <div style={{ color: "#334155", fontSize: "0.82rem", fontWeight: 700 }}>{(section.links || []).length} link{(section.links || []).length === 1 ? "" : "s"}</div>
                          </div>
                        );
                      })}

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => {
                          if (selectedLinkSectionPreviewIndex === null) return;
                          setSelectedLinkSectionIndex(selectedLinkSectionPreviewIndex);
                          setSelectedLinkIndex(null);
                          setSelectedLinkPreviewIndex(null);
                        }} disabled={selectedLinkSectionPreviewIndex === null} style={{ border: "none", borderRadius: "999px", padding: "10px 14px", background: selectedLinkSectionPreviewIndex === null ? "#E2E8F0" : "#0369A1", color: selectedLinkSectionPreviewIndex === null ? "#94A3B8" : "#FFFFFF", fontWeight: 700, cursor: selectedLinkSectionPreviewIndex === null ? "not-allowed" : "pointer" }}>
                          {selectedLinkSectionPreviewIndex === null ? "Select Section First" : "Open Section"}
                        </button>
                        <button type="button" onClick={handleAddLinkSection} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "10px 14px", background: "#FFFFFF", color: "#0F172A", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaPlus />
                          Add Section
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedLinkSection !== null && selectedEditorLink === null && (
                    <div style={{ display: "grid", gap: "12px" }}>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => {
                          setSelectedLinkSectionIndex(null);
                          setSelectedLinkIndex(null);
                          setSelectedLinkPreviewIndex(null);
                        }} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "8px 12px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}>
                          Back To Sections
                        </button>
                        <button type="button" onClick={() => handleMoveLinkSection(selectedLinkSectionIndex, "up")} disabled={selectedLinkSectionIndex === 0} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: selectedLinkSectionIndex === 0 ? "#E2E8F0" : "#DBEAFE", color: selectedLinkSectionIndex === 0 ? "#94A3B8" : "#1D4ED8", fontWeight: 700, cursor: selectedLinkSectionIndex === 0 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaArrowUp />
                          Move Up
                        </button>
                        <button type="button" onClick={() => handleMoveLinkSection(selectedLinkSectionIndex, "down")} disabled={selectedLinkSectionIndex === editableLinkSections.length - 1} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: selectedLinkSectionIndex === editableLinkSections.length - 1 ? "#E2E8F0" : "#DBEAFE", color: selectedLinkSectionIndex === editableLinkSections.length - 1 ? "#94A3B8" : "#1D4ED8", fontWeight: 700, cursor: selectedLinkSectionIndex === editableLinkSections.length - 1 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaArrowDown />
                          Move Down
                        </button>
                        <button type="button" onClick={() => handleDeleteLinkSection(selectedLinkSectionIndex)} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: "#FEE2E2", color: "#B91C1C", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaTrash />
                          Delete Section
                        </button>
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Section Title</label>
                        <input value={selectedLinkSection.title} onChange={(event) => handleLinkSectionFieldChange(selectedLinkSectionIndex, "title", event.target.value)} placeholder="Section title" style={inputStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Section Subtitle</label>
                        <textarea value={selectedLinkSection.subtitle} onChange={(event) => handleLinkSectionFieldChange(selectedLinkSectionIndex, "subtitle", event.target.value)} placeholder="Section subtitle" style={textareaStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        {(selectedLinkSection.links || []).map((link, linkIndex) => {
                          const isSelected = selectedLinkPreviewIndex === linkIndex;
                          return (
                            <button key={`link-row-${selectedLinkSectionIndex}-${linkIndex}`} type="button" onClick={() => setSelectedLinkPreviewIndex(linkIndex)} style={{ display: "grid", gap: "4px", textAlign: "left", border: isSelected ? "2px solid #0284C7" : `1px solid ${palette.surfaceBorder}`, borderRadius: "12px", background: isSelected ? "#F0F9FF" : "#FFFFFF", color: "#0F172A", padding: "12px", cursor: "pointer", boxShadow: isSelected ? "0 0 0 2px rgba(2,132,199,0.15)" : "none" }}>
                              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                                <span style={{ fontWeight: 800 }}>{link.label || `Link ${linkIndex + 1}`}</span>
                                {isSelected && <span style={{ borderRadius: "999px", padding: "2px 7px", background: "#0C4A6E", color: "#FFFFFF", fontWeight: 700, fontSize: "0.7rem" }}>Selected</span>}
                              </span>
                              <span style={{ color: "#64748B", fontSize: "0.82rem" }}>{link.description || "No description yet"}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => {
                          if (selectedLinkPreviewIndex === null) return;
                          setSelectedLinkIndex(selectedLinkPreviewIndex);
                        }} disabled={selectedLinkPreviewIndex === null} style={{ border: "none", borderRadius: "999px", padding: "10px 14px", background: selectedLinkPreviewIndex === null ? "#E2E8F0" : "#0369A1", color: selectedLinkPreviewIndex === null ? "#94A3B8" : "#FFFFFF", fontWeight: 700, cursor: selectedLinkPreviewIndex === null ? "not-allowed" : "pointer" }}>
                          {selectedLinkPreviewIndex === null ? "Select Link First" : "Open Selected Link"}
                        </button>
                        <button type="button" onClick={() => handleAddLink(selectedLinkSectionIndex)} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "10px 14px", background: "#FFFFFF", color: "#0F172A", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaPlus />
                          Add Link
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedLinkSection !== null && selectedEditorLink !== null && (
                    <div style={{ display: "grid", gap: "12px" }}>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => {
                          setSelectedLinkIndex(null);
                          setSelectedLinkPreviewIndex(null);
                        }} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "8px 12px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}>
                          Back To Links
                        </button>
                        <button type="button" onClick={() => handleMoveLinkWithinSection(selectedLinkSectionIndex, selectedLinkIndex, "up")} disabled={selectedLinkIndex === 0} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: selectedLinkIndex === 0 ? "#E2E8F0" : "#DBEAFE", color: selectedLinkIndex === 0 ? "#94A3B8" : "#1D4ED8", fontWeight: 700, cursor: selectedLinkIndex === 0 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaArrowUp />
                          Move Up
                        </button>
                        <button type="button" onClick={() => handleMoveLinkWithinSection(selectedLinkSectionIndex, selectedLinkIndex, "down")} disabled={selectedLinkIndex === (selectedLinkSection.links || []).length - 1} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: selectedLinkIndex === (selectedLinkSection.links || []).length - 1 ? "#E2E8F0" : "#DBEAFE", color: selectedLinkIndex === (selectedLinkSection.links || []).length - 1 ? "#94A3B8" : "#1D4ED8", fontWeight: 700, cursor: selectedLinkIndex === (selectedLinkSection.links || []).length - 1 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaArrowDown />
                          Move Down
                        </button>
                        <button type="button" onClick={() => handleDeleteLink(selectedLinkSectionIndex, selectedLinkIndex)} style={{ border: "none", borderRadius: "999px", padding: "8px 12px", background: "#FEE2E2", color: "#B91C1C", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <FaTrash />
                          Delete Link
                        </button>
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Label</label>
                        <input value={selectedEditorLink.label} onChange={(event) => handleLinkFieldChange(selectedLinkSectionIndex, selectedLinkIndex, "label", event.target.value)} placeholder="Button label" style={inputStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Description</label>
                        <textarea value={selectedEditorLink.description} onChange={(event) => handleLinkFieldChange(selectedLinkSectionIndex, selectedLinkIndex, "description", event.target.value)} placeholder="Optional description" style={textareaStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Link Type</label>
                        <select value={selectedEditorLink.iconKey} onChange={(event) => handleLinkFieldChange(selectedLinkSectionIndex, selectedLinkIndex, "iconKey", event.target.value)} style={inputStyle}>
                          {LINK_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <div style={{ color: "#64748B", fontSize: "0.84rem" }}>{getLinkTypeHelperText(selectedEditorLink.iconKey)}</div>
                      </div>

                      {selectedEditorLink.iconKey !== "form" && (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <label style={{ fontWeight: 700 }}>URL</label>
                          <input value={selectedEditorLink.url} onChange={(event) => handleLinkFieldChange(selectedLinkSectionIndex, selectedLinkIndex, "url", event.target.value)} placeholder={getLinkUrlPlaceholder(selectedEditorLink.iconKey)} style={inputStyle} />
                        </div>
                      )}

                      {selectedEditorLink.iconKey === "form" && (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <label style={{ fontWeight: 700 }}>Select Form</label>
                          <select value={selectedEditorLink.formId || ""} onChange={(event) => handleLinkFormChange(selectedLinkSectionIndex, selectedLinkIndex, event.target.value)} style={inputStyle}>
                            <option value="">No form selected</option>
                            {availableForms.map((form) => (
                              <option key={form.id} value={form.id}>{cleanText(form.title) || cleanText(form.name) || form.id}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Custom Button Color</label>
                        <input value={selectedEditorLink.buttonColor || ""} onChange={(event) => handleLinkFieldChange(selectedLinkSectionIndex, selectedLinkIndex, "buttonColor", event.target.value)} placeholder="Leave blank to use social color" style={inputStyle} />
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Custom Icon URL</label>
                        <input value={selectedEditorLink.customIconUrl || ""} onChange={(event) => handleLinkFieldChange(selectedLinkSectionIndex, selectedLinkIndex, "customIconUrl", event.target.value)} placeholder="Optional icon URL" style={inputStyle} />
                      </div>

                      {selectedEditorLink.iconKey !== "map" && selectedEditorLink.iconKey !== "form" && (
                        <button type="button" onClick={() => handleApplyLinkTypeTemplate(selectedLinkSectionIndex, selectedLinkIndex, selectedEditorLink.iconKey)} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "10px 14px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer", width: "fit-content" }}>
                          Apply Suggested URL Format
                        </button>
                      )}

                      <div style={{ display: "grid", gap: "8px" }}>
                        <label style={{ fontWeight: 700 }}>Move To Section</label>
                        <select value={selectedLinkSectionIndex} onChange={(event) => handleMoveLinkToSection(selectedLinkSectionIndex, selectedLinkIndex, Number(event.target.value))} style={inputStyle}>
                          {editableLinkSections.map((section, index) => (
                            <option key={`move-section-${index}`} value={index}>{section.title || `Section ${index + 1}`}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {editorTab === "text" && (
                <div style={{ display: "grid", gap: "12px" }}>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <label style={{ fontWeight: 700 }}>Page Title</label>
                    <input value={editableSectionTexts.pageTitle} onChange={(event) => handleSectionTextChange("pageTitle", event.target.value)} placeholder="Quick Links" style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <label style={{ fontWeight: 700 }}>Page Subtitle</label>
                    <textarea value={editableSectionTexts.pageSubtitle} onChange={(event) => handleSectionTextChange("pageSubtitle", event.target.value)} placeholder="Short intro text" style={textareaStyle} />
                  </div>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <label style={{ fontWeight: 700 }}>Location Title</label>
                    <input value={editableSectionTexts.locationTitle} onChange={(event) => handleSectionTextChange("locationTitle", event.target.value)} placeholder="Visit Us" style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <label style={{ fontWeight: 700 }}>Location Address</label>
                    <textarea value={editableSectionTexts.locationAddress} onChange={(event) => handleSectionTextChange("locationAddress", event.target.value)} placeholder="Location address for maps (optional)" style={textareaStyle} />
                  </div>
                </div>
              )}

              {editorTab === "theme" && (
                <div style={{ display: "grid", gap: "12px" }}>
                  {[
                    { key: "primary", label: "Primary" },
                    { key: "secondary", label: "Secondary" },
                    { key: "accent", label: "Accent" },
                  ].map((color) => (
                    <div key={color.key} style={{ display: "grid", gap: "8px" }}>
                      <label style={{ fontWeight: 700 }}>{color.label}</label>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <input type="color" value={themeColors[color.key]} onChange={(event) => handleThemeColorChange(color.key, event.target.value)} style={{ width: "54px", height: "42px", border: "none", background: "transparent" }} />
                        <input value={themeColors[color.key]} onChange={(event) => handleThemeColorChange(color.key, event.target.value)} style={inputStyle} />
                      </div>
                    </div>
                  ))}

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button type="button" onClick={handleResetTheme} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "10px 14px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}>
                      Reset Theme
                    </button>
                    <button type="button" onClick={handleSaveTheme} disabled={isSavingTheme} style={{ border: "none", borderRadius: "999px", padding: "10px 14px", background: palette.actionBg, color: "#FFFFFF", fontWeight: 700, cursor: isSavingTheme ? "not-allowed" : "pointer", opacity: isSavingTheme ? 0.7 : 1 }}>
                      {isSavingTheme ? "Saving Theme..." : "Save Theme"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap", marginTop: "18px" }}>
              <button type="button" onClick={handleCloseContentEditor} style={{ border: `1px solid ${palette.surfaceBorder}`, borderRadius: "999px", padding: "8px 14px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}>
                Close Editor
              </button>
              <button type="button" onClick={handleDiscardContentChanges} disabled={!hasUnsavedContentChanges || isSavingContent} style={{ border: "none", borderRadius: "999px", padding: "8px 14px", background: "#FEE2E2", color: "#B91C1C", fontWeight: 700, cursor: !hasUnsavedContentChanges || isSavingContent ? "not-allowed" : "pointer", opacity: !hasUnsavedContentChanges || isSavingContent ? 0.65 : 1 }}>
                Discard Changes
              </button>
              <button type="button" onClick={handleSaveQuickLinksContent} disabled={isSavingContent} style={{ border: "none", borderRadius: "999px", padding: "8px 14px", background: palette.actionBg, color: "#FFFFFF", fontWeight: 700, cursor: isSavingContent ? "not-allowed" : "pointer", opacity: isSavingContent ? 0.7 : 1 }}>
                {isSavingContent ? "Saving..." : "Save Content"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default QuickLinksPage;
