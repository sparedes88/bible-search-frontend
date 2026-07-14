import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes, uploadBytesResumable, deleteObject } from "firebase/storage";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import { auth, db, storage } from "../firebase";
import "./MyDesignTeam.css";

const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";

const DEFAULT_COLORS = ["#0f766e", "#0284c7", "#f59e0b"];
const MAX_REFERENCE_UPLOADS = 10;
const PLATFORM_SIZE_PRESETS = {
  instagram: [
    { label: "Post (Square) - 1080x1080", value: "1080x1080" },
    { label: "Portrait Post - 1080x1350", value: "1080x1350" },
    { label: "Story/Reel - 1080x1920", value: "1080x1920" },
    { label: "Landscape Post - 1080x566", value: "1080x566" },
  ],
  facebook: [
    { label: "Feed Post - 1200x630", value: "1200x630" },
    { label: "Story - 1080x1920", value: "1080x1920" },
    { label: "Cover Photo - 851x315", value: "851x315" },
    { label: "Event Cover - 1920x1005", value: "1920x1005" },
  ],
};
const INITIAL_FORM_STATE = {
  title: "",
  purpose: "",
  topic: "",
  bibleVerse: "",
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  platform: "",
  size: "",
  notes: "",
  exactCopy: "",
  extraTextLines: "",
  language: "English",
};

const TEMPORARY_GENERATION_MESSAGE =
  "This design is taking longer than expected. We need a little more time. Please try again in a moment.";
const RETRYABLE_GENERATION_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const normalizeColor = (value, fallback) => {
  const normalized = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
};

const sanitizeFileName = (name) =>
  String(name || "file")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 120);

const detectPlatformKey = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("instagram") || normalized === "ig") return "instagram";
  if (normalized.includes("facebook") || normalized === "fb") return "facebook";
  return "custom";
};

const dedupeUrls = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

const buildCharacterMap = (value) =>
  String(value || "")
    .split("")
    .map((char) => (char === " " ? "[space]" : char))
    .join(" | ");

const buildEditableTextPayload = (snapshot) => {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    purpose: String(source.purpose || "").trim(),
    topic: String(source.topic || "").trim(),
    title: String(source.title || "").trim(),
    bibleVerse: String(source.bibleVerse || "").trim(),
    date: String(source.date || source.dateTime || "").trim(),
    startTime: String(source.startTime || "").trim(),
    endTime: String(source.endTime || "").trim(),
    location: String(source.location || "").trim(),
    notes: String(source.notes || "").trim(),
    exactCopy: String(source.exactCopy || "").trim(),
    extraTextLines: String(source.extraTextLines || "").trim(),
    language: String(source.language || "English").trim() || "English",
  };
};

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const parseSizeToAspectRatio = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return width / height;
};

const parseSizeToDimensions = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
};

const buildRequestPrompt = ({ formState, settings, referenceNames }) => {
  const colorLine = (settings.brandColors || []).filter(Boolean).join(", ");
  const refsLine = referenceNames.length ? referenceNames.join(", ") : "none uploaded";
  const exactCopy = String(formState.exactCopy || "").trim();
  const hasExactCopy = Boolean(exactCopy);
  const extraTextLines = String(formState.extraTextLines || "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const allowedVisibleText = [
    String(formState.title || "").trim(),
    String(formState.bibleVerse || "").trim(),
    String(formState.date || "").trim(),
    String(formState.startTime || "").trim(),
    String(formState.endTime || "").trim(),
    String(formState.location || "").trim(),
    ...extraTextLines,
  ].filter(Boolean);
  const exactCopyChars = hasExactCopy
    ? buildCharacterMap(exactCopy)
    : "";
  const titleChars = formState.title ? buildCharacterMap(formState.title) : "";
  const locationChars = formState.location ? buildCharacterMap(formState.location) : "";

  return [
    `You are the Senior Brand & Marketing Manager for ${settings.organizationName || "this church"}. You oversee every piece of visual communication this organization puts out. Your job is to protect and advance the brand — every design you produce must feel like it was made by the same creative director who made every previous one.`,
    "",
    "=== BRAND IDENTITY (NON-NEGOTIABLE) ===",
    `Organization name: ${settings.organizationName || "Not specified"}`,
    `Official brand colors: ${colorLine || "Not specified"} — use ONLY these colors as the primary palette.`,
    settings.logoUrl
      ? `Logo: the provided logo image is attached — display it exactly as-is in the design, correctly proportioned, without distortion or recoloring. Do not recreate it; use it as provided.`
      : "No logo provided — leave a clean, designated logo zone.",
    referenceNames.length
      ? `Brand reference designs attached (${refsLine}): These are your style bible — study them to absorb the color palette, typography style and weight, layout structure, spacing, background treatment, decorative motifs, and overall aesthetic mood. Your output MUST feel like it was created by the same design team.`
      : "",
    referenceNames.length
      ? `REFERENCE IMAGE RULE — CRITICAL: Reference images are for STYLE INSPIRATION ONLY. You MUST NOT copy, extract, transplant, or reuse ANY element from them — no backgrounds, no photo crops, no textures, no graphic sections, no overlays, no banners, no shapes lifted from those images. Every single pixel in the output must be freshly generated from scratch. If any part of your output looks like it was physically taken from a reference image and dropped into the new design, that is a failure. Inspire, do not copy.`
      : "",
    "",
    "=== DESIGN STANDARDS ===",
    "Produce a polished, print/digital-ready design that could be published without a single edit.",
    "CORPORATE IMAGE LOCK: Preserve a consistent corporate ministry identity across all outputs. The visual language (type hierarchy, spacing rhythm, color behavior, layout discipline, and finishing quality) must remain consistent from design to design.",
    "The design must look and feel EXACTLY like the brand reference images — same aesthetic DNA, same visual language, not a generic AI-generated image. If someone compared your output to the references, they should immediately say they came from the same brand.",
    "FUNDAMENTAL STYLE BASELINE (APPLIES TO EVERY DESIGN): modern church event flyer with cinematic, high-end ministry design style.",
    "Typography baseline: bold oversized title with strong hierarchy; mix modern sans-serif and elegant script accents where appropriate.",
    "Color/atmosphere baseline: deep navy + gold light accents + white text, with soft glow, subtle particles, and light rays for spiritual atmosphere.",
    "Background baseline: dark cinematic background with soft lighting effects and controlled contrast for readability.",
    "Layout baseline: main title centered or intentionally offset as the dominant visual element; supporting text smaller and clean; date highlighted in a bold bar/box; time/location clear at the bottom.",
    "Depth baseline: layered composition with cinematic background image, soft gradient overlays for contrast, and foreground typography.",
    "Formatting baseline: professional, clean, and balanced text distribution; avoid overcrowding and awkward empty zones; maintain consistent alignment and spacing rhythm.",
    "Title dominance rule: the title is the main visual element, not the image.",
    "Glow emphasis rule: use tasteful glow accents behind key words for emphasis and readability.",
    referenceNames.length
      ? "REFERENCE EXECUTION RULE: Use references to match structure, spacing rhythm, typography hierarchy, and polish quality; generate a fresh composition that feels like the same creative team made it."
      : "",
    referenceNames.length
      ? "REFERENCE PRIORITY RULE: When there is any ambiguity, prioritize the reference-image visual language over generic model defaults."
      : "",
    "",
    "=== CREATIVE EXCELLENCE — THIS IS THE MOST IMPORTANT SECTION ===",
    "Your benchmark is world-class ministry and church creative teams: TD Jakes Ministries, Joyce Meyer Ministries, Elevation Church / Elevation Worship, Life.Church, Hillsong, Transformation Church. Study what makes their graphics stop the scroll — cinematic lighting, bold intentional typography, dramatic contrast, premium photography, sophisticated color grading, confident white space, editorial-quality composition.",
    "STOP THE SCROLL: This design must be visually arresting the moment it appears on a phone or screen. Ask yourself — would someone actually pause and look at this? If not, push the creativity harder.",
    "VISUAL DRAMA: Use cinematic depth — rich shadows, light rays, lens flares, bokeh backgrounds, atmospheric haze, dramatic lighting angles. Make the image feel like a movie poster or album cover, not a church bulletin.",
    "TYPOGRAPHY AS DESIGN: Type is not just text — it is architecture. Use bold weight contrasts (ultra-thin + ultra-heavy), creative kerning, oversized display type, editorial stacking, and typographic hierarchy that guides the eye with intention. Study how Elevation Worship titles their albums — that level of typographic confidence.",
    "PHOTOGRAPHY/IMAGERY: Use cinematic, high-contrast, professionally lit imagery (worship, prayer, cross, Bible, congregation moments). People should look aspirational and emotionally resonant. Backgrounds should have depth and texture. Soft gradient overlays are allowed for contrast and readability.",
    "COMPOSITION: Every element must have a reason to exist. Use the rule of thirds, leading lines, and negative space aggressively. The eye should travel a clear path through the design. Layers of depth (foreground / midground / background) give the design three-dimensionality.",
    "COLOR SOPHISTICATION: Colors must feel rich, intentional, and on-brand. Use tonal variation (darks, mids, highlights) and cinematic glow accents. Soft gradient overlays are permitted when they improve legibility and depth.",
    "CORPORATE POLISH: The design should look like it came out of a $500/hour design studio — no rough edges, no pixelation, no awkward crops, no default fonts, no lorem ipsum, no placeholder energy. Every detail must feel intentional and finished.",
    "Apply strong visual hierarchy: clear focal point, intentional secondary elements, breathing room.",
    "Composition must feel intentional — no random elements, no filler, no visual clutter.",
    "Every color, shape, and texture must earn its place and support the brand.",
    "NEVER produce generic stock-photo aesthetics or anything that looks like a template. This must look custom, creative, on-brand, and professionally formatted.",
    "EDGE-TO-EDGE FILL RULE (MANDATORY): The design must fill the ENTIRE image canvas from edge to edge with no exceptions. NO white borders, NO black bars, NO letterboxing, NO pillarboxing, NO padding, NO empty margins around any edge. Every single pixel from the very top to the very bottom and from the left edge to the right edge must contain design content — background, imagery, color, or texture. A white or empty border anywhere is a failure.",
    "SINGLE-DESIGN RULE (MANDATORY): Output exactly ONE final design composition in the canvas. Never create side-by-side versions, before/after comparisons, split-screen layouts, diptychs, grids, duplicated posters, or multiple variant panels in one image.",
    "CRITICAL OUTPUT RULE: The final output must be a NEWLY GENERATED image. Never return, reuse, or echo any attached reference image, logo file, or previous design image as the final output.",
    "ELEMENT THEFT RULE: Do NOT extract, crop, copy, or transplant any photo, graphic element, background section, texture, or overlay from any attached image into the output. The entire design — every background, shape, photo, and visual element — must be created fresh. Reference attachments are for style inspiration only, not source material.",
    "Real people and stock-photo imagery are encouraged when relevant. NEVER use cartoonish illustrations, anime-style art, clip-art figures, or silhouettes of people. Humans in the design must look realistic, cinematic, and photographic — aspirational, not generic stock.",
    "",
    "=== TEXT & LANGUAGE RULES (CRITICAL) ===",
    "NO INVENTED TEXT — ABSOLUTE RULE: Do NOT add, invent, assume, or fill in ANY text that is not explicitly provided in the design brief below. This includes titles, subtitles, taglines, captions, scriptures, dates, locations, slogans, body copy, labels, or any other text element. If a field is empty or not provided, leave that area of the design free of text — use only visual or decorative elements. Every single word that appears in the design must come verbatim from the fields listed below. Zero exceptions.",
    allowedVisibleText.length
      ? `EDITABLE TEXT WHITELIST (STRICT): The ONLY visible text allowed in this design is exactly the following lines: ${allowedVisibleText.map((line) => `"${line}"`).join(" | ")}. If any other text appears, remove it.`
      : "EDITABLE TEXT WHITELIST (STRICT): No visible text is allowed unless explicitly listed below. If any stray text appears, remove it.",
    `PRIMARY LANGUAGE: ALL text in this design MUST be written in ${formState.language || "English"}. This is a hard requirement — do not use any other language for any text element in the design.`,
    "DIACRITICS LOCK: Preserve every accent mark and special character exactly as provided (á, é, í, ó, ú, ñ, ü, ¿, ¡, apostrophes, and punctuation). Never remove or replace them.",
    "ADDRESS LOCK: If location/address text is provided, render it exactly character-by-character, including commas, periods, abbreviations, apartment/unit markers, and accent marks. Do not abbreviate, reformat, or rewrite it.",
    "ALL text in this design MUST be spelled correctly. Proofread every word before rendering — zero spelling mistakes are acceptable.",
    `LANGUAGE LOCK: Every single word, title, subtitle, caption, label, and scripture in this design must be in ${formState.language || "English"}. NEVER switch languages, mix languages, or auto-translate anything under any circumstances.`,
    "BIBLE VERSE RULE — CRITICAL: If a bible verse is provided, you MUST render it WORD-FOR-WORD EXACTLY as typed in the brief below — character for character, including every word, comma, colon, and quotation mark. Do NOT look it up from memory. Do NOT use any Bible translation you know. Do NOT paraphrase or alter a single character. Copy it exactly from the brief.",
    "BIBLE VERSE RULE: If NO bible verse is provided, do NOT invent, add, or assume any scripture. Leave all verse/scripture space empty.",
    hasExactCopy
      ? `LOCKED TEXT: The following wording will be added on top AFTER generation. Do NOT render any text in the design. Leave a clean, high-contrast, readable zone where this text will sit: "${exactCopy}"`
      : "Any text that does appear must be tight, readable, and on-brand — and must come only from the brief fields below.",
    hasExactCopy ? `Character accuracy map: ${exactCopyChars}` : "",
    "",
    "=== THIS DESIGN BRIEF ===",
    formState.title ? `Title text to display (render this EXACTLY as written, do not alter): "${formState.title}"` : "No title provided — do NOT add any title or heading text.",
    titleChars ? `Title character map (must match exactly): ${titleChars}` : null,
    formState.purpose ? `Design purpose / context (for visual direction only — do NOT render this as text): ${formState.purpose}` : "",
    formState.topic ? `Topic / theme (for visual direction only — do NOT render this as text): ${formState.topic}` : "",
    formState.bibleVerse
      ? `Scripture to render — TYPOGRAPHY ROLE: The Bible verse is a SMALL, quiet, supporting text element, NOT a headline. Render it in small italic serif font (roughly 40–50% the point size of the title), placed near the bottom third of the design, centered, with modest spacing. Do NOT make it large, bold, or dominant. It should feel like a subtle, elegant quote beneath the main content — the kind you see on premium ministry designs. Copy it CHARACTER FOR CHARACTER as written, do not use your memory of this verse: "${formState.bibleVerse}"\nBible verse character map (every character must match): ${buildCharacterMap(formState.bibleVerse)}`
      : "No bible verse provided — do NOT add any scripture to this design.",
    (() => {
      const datePart = formState.date ? `Date: "${formState.date}"` : null;
      const startPart = formState.startTime ? `Start time: "${formState.startTime}"` : null;
      const endPart = formState.endTime ? `End time: "${formState.endTime}"` : null;
      const parts = [datePart, startPart, endPart].filter(Boolean);
      return parts.length
        ? `Date & time to display on design (render EXACTLY as written, make them visually clear and prominent): ${parts.join(" · ")}. Display the date and start/end times together in the design as a clearly readable event schedule block.`
        : "No date or time provided — do NOT add any date or time text.";
    })(),
    formState.location ? `Location text to display (render EXACTLY as written): "${formState.location}"` : "No location provided — do NOT add any location or address text.",
    locationChars ? `Location character map (must match exactly, including accents): ${locationChars}` : null,
    extraTextLines.length
      ? `Other visible text lines allowed (render each EXACTLY as written, character-for-character):\n- ${extraTextLines.join("\n- ")}`
      : "No other visible text lines are allowed.",
    `Language for all text: ${formState.language || "English"} — use ONLY this language for every word in the design`,
    formState.platform ? `Platform / channel: ${formState.platform}` : "",
    formState.size ? `Output dimensions / aspect ratio: ${formState.size}` : "",
    formState.notes ? `Additional creative notes: ${formState.notes}` : "",
    "",
    "=== FINAL MANDATE ===",
    `This must feel unmistakably on-brand AND visually stunning. Before outputting, ask yourself: (1) Would a creative director at TD Jakes Ministries, Hillsong, or Elevation Church approve this — is it cinematic, bold, and scroll-stopping? If it looks generic, flat, or AI-generated, redo it. (2) Does this feel like it came from the same brand as the reference designs — same aesthetic DNA, same professional layout discipline, not a template? (3) Is every word spelled correctly and in the correct language? (4) Is text distribution visually balanced with clear hierarchy? (5) Is the title the strongest visual element with tasteful glow emphasis on key words? If ANY answer is no, revise before outputting.`,
  ].filter((line) => line !== null && line !== undefined).join("\n");
};

const buildRevisionPrompt = ({ editInstruction, settings, referenceNames, language, formSnapshot = {} }) => {
  const colorLine = (settings?.brandColors || []).filter(Boolean).join(", ");
  const refsLine = (referenceNames || []).length ? referenceNames.join(", ") : "see attached references";
  const isLanguageChange = Boolean(language);
  const normalizedTitle = String(formSnapshot?.title || "").trim();
  const normalizedBibleVerse = String(formSnapshot?.bibleVerse || "").trim();
  const normalizedDate = String(formSnapshot?.date || "").trim();
  const normalizedStartTime = String(formSnapshot?.startTime || "").trim();
  const normalizedEndTime = String(formSnapshot?.endTime || "").trim();
  const normalizedLocation = String(formSnapshot?.location || "").trim();
  const normalizedExtraTextLines = String(formSnapshot?.extraTextLines || "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  const authoritativeTextLines = [
    normalizedTitle ? `- Title: "${normalizedTitle}"` : "",
    normalizedBibleVerse ? `- Bible verse — SMALL italic secondary text, NOT a headline (copy EXACTLY character for character, do not use your memory): "${normalizedBibleVerse}"` : "",
    normalizedDate ? `- Date: "${normalizedDate}"` : "",
    normalizedStartTime ? `- Start time: "${normalizedStartTime}"` : "",
    normalizedEndTime ? `- End time: "${normalizedEndTime}"` : "",
    normalizedLocation ? `- Location: "${normalizedLocation}"` : "",
    ...(normalizedExtraTextLines.length
      ? normalizedExtraTextLines.map((line) => `- Extra line: "${line}"`)
      : []),
  ].filter(Boolean);

  const preserveTextRule = isLanguageChange
    ? `Preserve the layout, composition, colors, typography style, fonts, spacing, proportions, motifs, shadows, lighting, and overall visual style. The ONLY thing that changes is the language of the text — every visual element stays the same.`
    : `Preserve EVERYTHING that is NOT directly addressed by the change instruction: layout, composition, all colors, all typography styles, all fonts, spacing, proportions, motifs, shadows, lighting, and overall visual style. TEXT FIELDS: replace existing text with the exact updated values given in the instruction — do not keep the old wording for any field that has a new value specified.`;

  const languageRule = isLanguageChange
    ? [
        `=== LANGUAGE CHANGE — THIS IS THE ONLY EDIT ===`,
        `MANDATORY: Translate EVERY single piece of text in this design into ${language}. No exceptions.`,
        `This includes: the main title, all subtitles, body copy, captions, labels, dates, locations, call-to-action text, fine print, and any other text element visible in the design.`,
        `After translating, do a full scan of the design — if ANY word is still in the original language, translate it. Zero original-language text should remain.`,
        `Maintain the same font style, size, weight, color, and positioning for each text element — only the words change.`,
        `All translated text must be spelled correctly in ${language}.`,
      ]
    : [
        `=== TEXT UPDATE RULES ===`,
        `CRITICAL: The change instruction above contains updated text field values. You MUST replace the corresponding text in the design with the new values exactly as written — character for character, including capitalization, spacing, and punctuation.`,
        `Do NOT keep the old text for any field that has a new value in the instruction. The new value completely replaces the old one.`,
      `TEXT WHITELIST RULE: After applying updates, remove any visible text that is not explicitly present in the provided update fields or "Other visible text lines". No extra slogans/captions/titles are allowed.`,
        `BIBLE VERSE RULE — CRITICAL: If a bible verse is provided in the authoritative text values above, render it WORD-FOR-WORD EXACTLY as written — do NOT use your memory of this verse, do NOT change any word or punctuation. Copy it character-for-character from the values above.`,
        `PURPOSE and TOPIC fields are for design direction only — NEVER display them as visible text on the design.`,
        `All text must be spelled exactly as given. Do not correct or alter capitalization — if the value is ALL CAPS, render it ALL CAPS.`,
        `Do NOT translate any text. Render all text in the language it was given.`,
        `DIACRITICS LOCK: Preserve every accent mark and special character exactly as provided. Never strip or replace accent marks.`,
        `ADDRESS LOCK: If the instruction includes location/address updates, copy address text character-for-character with the same punctuation and ordering. Do not abbreviate or rewrite it.`,
      ];

  return [
    `You are the Senior Brand & Marketing Manager for ${settings?.organizationName || "this church"}. You are making a SURGICAL REVISION to an existing design.`,
    "",
    "=== EDIT MODE LOCK ===",
    "Treat this as image editing, not a new generation.",
    "Keep at least 90% of the previous design unchanged. Only edit the specific requested text/content.",
    "Do not replace the background, subject, composition, or art direction unless explicitly asked.",
    "",
    "=== WHAT YOU MUST DO ===",
    "The previous design is attached. Make ONLY the following change — nothing else:",
    String(editInstruction || "").trim(),
    "",
    "=== WHAT YOU MUST PRESERVE ===",
    preserveTextRule,
    "CORPORATE IMAGE LOCK (STILL APPLIES): Keep the same branded visual language and corporate quality level from the current/reference designs.",
    "VISIBLE CHANGE RULE (MANDATORY): The final image must clearly reflect the requested change. Returning an unchanged or nearly unchanged image is not acceptable.",
    "CINEMATIC STYLE RULE (STILL APPLIES): Preserve the high-end ministry flyer style with bold hierarchy, clean formatting, and professional spacing rhythm.",
    "EDGE-TO-EDGE FILL RULE (STILL APPLIES): The revised design must fill the ENTIRE canvas edge to edge with no white borders, black bars, letterboxing, or empty margins on any side.",
    "BALANCED LAYOUT RULE (STILL APPLIES): Keep text distribution visually balanced with clear hierarchy and readable separation of title, date, and event details.",
    "SOFT OVERLAY RULE (STILL APPLIES): Soft gradient overlays and glow accents are allowed only when they improve contrast and keep the look premium and clean.",
    "Do NOT reimagine, rebuild, recolor, or redesign from scratch. This is a targeted, single-point edit.",
    "SINGLE-DESIGN RULE (MANDATORY): The revised output must be one single full-canvas design only. Do NOT place original and revised versions side by side. Do NOT make comparison layouts, split screens, collages, duplicate panels, or multi-version compositions.",
    "NO INVENTED TEXT: Do NOT add, invent, or introduce any new text element that was not already present in the previous design and is not explicitly requested in the change instruction above. Never add bible verses, titles, dates, locations, slogans, or any other copy on your own.",
    "Do NOT fall back to generic AI imagery — the result must still look exactly like the same brand.",
    "CRITICAL OUTPUT RULE: Never return, reuse, or echo an attached reference image or previous design image as the final output. The output must be newly rendered.",
    "ELEMENT THEFT RULE: Do NOT copy, extract, crop, or transplant any photo, background, texture, graphic section, or visual element from any attached image into the output. Every visual element must be freshly generated.",
    "Do NOT introduce cartoonish figures, anime-style art, clip-art, or silhouettes of people — only realistic photographic-style humans are acceptable.",
    "",
    ...languageRule,
    "",
    "=== AUTHORITATIVE TEXT VALUES (MANDATORY) ===",
    "Use these as the source of truth for visible text. Replace any mismatched text with these exact values.",
    "Do not paraphrase. Do not translate unless this is a language-change request. Do not strip accents.",
    authoritativeTextLines.length ? authoritativeTextLines.join("\n") : "No authoritative text values were provided.",
    normalizedBibleVerse ? `Bible verse character map: ${buildCharacterMap(normalizedBibleVerse)}` : "",
    normalizedLocation ? `Location character map: ${buildCharacterMap(normalizedLocation)}` : "",
    "",
    "=== BRAND RULES (STILL APPLY) ===",
    `Official brand colors: ${colorLine || "as shown in the attached design"}`,
    `Brand reference designs (style reference ONLY — do not copy elements from them): ${refsLine}`,
    "REFERENCE PRIORITY RULE: Match the reference designs' visual language first (hierarchy, spacing, finish quality, color behavior) so the brand stays consistent.",
    "Use the references to preserve professional formatting quality: consistent alignment, spacing rhythm, typographic hierarchy, and cinematic ministry polish.",
    "The revised design must still look like it came from the same brand system.",
  ].filter(Boolean).join("\n");
};

const base64ToBlob = (base64, mimeType) => {
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mimeType || "image/png" });
};

const wrapCanvasText = (ctx, text, maxWidth) => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let currentLine = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const nextLine = `${currentLine} ${words[index]}`;
    if (ctx.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
    } else {
      lines.push(currentLine);
      currentLine = words[index];
    }
  }
  lines.push(currentLine);
  return lines;
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });

const loadImageFromDataUrl = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode generated image."));
    image.src = dataUrl;
  });

const addExactCopyOverlay = async (sourceBlob, exactCopy) => {
  const normalizedCopy = String(exactCopy || "").trim();
  if (!normalizedCopy) return sourceBlob;

  const dataUrl = await blobToDataUrl(sourceBlob);
  const image = await loadImageFromDataUrl(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to render locked text on image.");
  }

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const fontSize = Math.max(22, Math.round(canvas.width * 0.055));
  const lineHeight = Math.round(fontSize * 1.24);
  const maxTextWidth = Math.round(canvas.width * 0.9);

  ctx.font = `700 ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapCanvasText(ctx, normalizedCopy, maxTextWidth).slice(0, 3);
  const bottomPadding = Math.max(20, Math.round(canvas.height * 0.06));

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(15, 23, 42, 0.92)";
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.08));
  ctx.shadowColor = "rgba(15, 23, 42, 0.7)";
  ctx.shadowBlur = Math.max(5, Math.round(fontSize * 0.25));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(2, Math.round(fontSize * 0.08));

  const firstLineY = canvas.height - bottomPadding - ((lines.length - 1) * lineHeight);
  lines.forEach((line, index) => {
    const lineY = firstLineY + (index * lineHeight);
    ctx.strokeText(line, canvas.width / 2, lineY);
    ctx.fillText(line, canvas.width / 2, lineY);
  });

  const renderedBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error("Could not export locked-text image."));
        return;
      }
      resolve(result);
    }, "image/png", 0.95);
  });

  return renderedBlob;
};

const resizeBlobToDimensions = async (sourceBlob, dimensions) => {
  if (!sourceBlob || !dimensions?.width || !dimensions?.height) {
    return sourceBlob;
  }

  const dataUrl = await blobToDataUrl(sourceBlob);
  const image = await loadImageFromDataUrl(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to resize generated image.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const targetWidth = canvas.width;
  const targetHeight = canvas.height;

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = Math.round(sourceWidth * scale);
  const drawHeight = Math.round(sourceHeight * scale);
  const offsetX = Math.round((targetWidth - drawWidth) / 2);
  const offsetY = Math.round((targetHeight - drawHeight) / 2);

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  const resizedBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error("Could not export resized image."));
        return;
      }
      resolve(result);
    }, "image/png", 0.95);
  });

  return resizedBlob;
};

const MyDesignTeam = () => {
  const { id } = useParams();
  const { user } = useAuth();

  const [settings, setSettings] = useState({
    organizationName: "",
    logoUrl: "",
    brandColors: DEFAULT_COLORS,
  });
  const [logoFile, setLogoFile] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [requests, setRequests] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");

  const [references, setReferences] = useState([]);
  const [referenceFiles, setReferenceFiles] = useState([]);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [referenceUploadProgress, setReferenceUploadProgress] = useState(0);
  const [referenceUploadStatus, setReferenceUploadStatus] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationMode, setGenerationMode] = useState("new");
  const [isPreviewImageLoading, setIsPreviewImageLoading] = useState(false);
  const [previewNaturalRatio, setPreviewNaturalRatio] = useState(1);
  const [isCorrectingText, setIsCorrectingText] = useState(false);

  const [formState, setFormState] = useState(INITIAL_FORM_STATE);
  const [editInstruction, setEditInstruction] = useState("");
  const [chatLanguage, setChatLanguage] = useState("");
  const [chatResizePlatform, setChatResizePlatform] = useState("");
  const [chatResizeSize, setChatResizeSize] = useState("");
  const [chatResizeCustomInput, setChatResizeCustomInput] = useState("");
  const [pendingChangeQueue, setPendingChangeQueue] = useState([]);
  const [customSizes, setCustomSizes] = useState([]);
  const [customSizeInput, setCustomSizeInput] = useState("");
  const [isAddingCustomSize, setIsAddingCustomSize] = useState(false);
  const [inspirationFiles, setInspirationFiles] = useState([]);
  const [viewedImageRequestId, setViewedImageRequestId] = useState("");
  const lastHydratedSelectionRef = useRef("");
  const initializedRef = useRef(false);

  const platformKey = useMemo(() => detectPlatformKey(formState.platform), [formState.platform]);

  const chatResizePlatformKey = useMemo(() => detectPlatformKey(chatResizePlatform), [chatResizePlatform]);

  const sizeOptions = useMemo(() => {
    const presetOptions = PLATFORM_SIZE_PRESETS[platformKey] || [];
    const customOptions = customSizes
      .map((size) => String(size || "").trim())
      .filter(Boolean)
      .map((size) => ({ label: `Custom - ${size}`, value: size }));

    const merged = [...presetOptions, ...customOptions];
    if (formState.size && !merged.some((option) => option.value === formState.size)) {
      merged.unshift({ label: `Current - ${formState.size}`, value: formState.size });
    }

    return merged;
  }, [customSizes, formState.size, platformKey]);

  const coerceFormSnapshot = useCallback((snapshot, fallbackGoal = "") => {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    return {
      purpose: String(source.purpose || source.goal || fallbackGoal || "").trim(),
      topic: String(source.topic || source.audience || "").trim(),
      bibleVerse: String(source.bibleVerse || "").trim(),
      date: String(source.date || source.dateTime || "").trim(),
      startTime: String(source.startTime || "").trim(),
      endTime: String(source.endTime || "").trim(),
      location: String(source.location || "").trim(),
      platform: String(source.platform || "").trim(),
      size: String(source.size || "").trim(),
      notes: String(source.notes || "").trim(),
      exactCopy: String(source.exactCopy || "").trim(),
      extraTextLines: String(source.extraTextLines || "").trim(),
      language: String(source.language || "English").trim(),
      title: String(source.title || "").trim(),
    };
  }, []);

  const getTimestampValue = useCallback((value) => {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value.seconds === "number") {
      return (value.seconds * 1000) + Math.floor((Number(value.nanoseconds) || 0) / 1000000);
    }
    return 0;
  }, []);

  const resolveLatestThreadRequest = useCallback((baseRequest, allRequests) => {
    if (!baseRequest || !allRequests.length) return baseRequest;

    const byId = new Map(allRequests.map((request) => [request.id, request]));

    let rootId = String(baseRequest.rootRequestId || "").trim();
    if (!rootId) {
      let cursor = baseRequest;
      let steps = 0;
      while (cursor?.parentRequestId && steps < 50) {
        const parentId = String(cursor.parentRequestId || "").trim();
        if (!parentId) break;
        const parentRequest = byId.get(parentId);
        if (!parentRequest) {
          rootId = parentId;
          break;
        }
        cursor = parentRequest;
        rootId = String(cursor.rootRequestId || cursor.id || "").trim();
        steps += 1;
      }
    }
    if (!rootId) {
      rootId = String(baseRequest.id || "").trim();
    }

    const threadIds = new Set([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const parentId = queue.shift();
      allRequests.forEach((request) => {
        const requestId = String(request.id || "").trim();
        const requestParentId = String(request.parentRequestId || "").trim();
        const requestRootId = String(request.rootRequestId || "").trim();
        const belongsToThread =
          requestParentId === parentId ||
          requestRootId === rootId ||
          requestId === rootId;

        if (belongsToThread && requestId && !threadIds.has(requestId)) {
          threadIds.add(requestId);
          queue.push(requestId);
        }
      });
    }

    const threadRequests = allRequests.filter((request) => threadIds.has(String(request.id || "").trim()));
    if (!threadRequests.length) return baseRequest;

    return threadRequests.sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt))[0];
  }, [getTimestampValue]);

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) || requests[0] || null,
    [requests, selectedRequestId]
  );

  const previewAspectRatio = useMemo(() => {
    const selectedSize =
      selectedRequest?.formSnapshot?.size ||
      selectedRequest?.settingsSnapshot?.size ||
      selectedRequest?.size ||
      "";
    return parseSizeToAspectRatio(selectedSize) || previewNaturalRatio || 1;
  }, [previewNaturalRatio, selectedRequest?.formSnapshot?.size, selectedRequest?.settingsSnapshot?.size, selectedRequest?.size]);

  const activeRootId = useMemo(() => {
    if (!selectedRequest) return "";
    return String(selectedRequest.rootRequestId || selectedRequest.id || "").trim();
  }, [selectedRequest]);

  const threadMessages = useMemo(() => {
    if (!activeRootId) return selectedRequest ? [selectedRequest] : [];
    return requests
      .filter((r) => {
        const rid = String(r.rootRequestId || "").trim();
        // Match by rootRequestId, or if this IS the root request itself
        return rid === activeRootId || r.id === activeRootId;
      })
      .sort((a, b) => getTimestampValue(a.createdAt) - getTimestampValue(b.createdAt));
  }, [activeRootId, getTimestampValue, requests, selectedRequest]);

  const latestThreadResult = useMemo(() => {
    const completed = threadMessages.filter(
      (r) => String(r.status || "").toLowerCase() === "completed" && r.imageUrl
    );
    return completed.length ? completed[completed.length - 1] : null;
  }, [threadMessages]);

  const chatResizeSizeOptions = useMemo(() => {
    const presetOptions = PLATFORM_SIZE_PRESETS[chatResizePlatformKey] || [];
    const customOptions = customSizes
      .map((size) => String(size || "").trim())
      .filter(Boolean)
      .map((size) => ({ label: `Custom - ${size}`, value: size }));
    const merged = [...presetOptions, ...customOptions];
    const currentSize = String(latestThreadResult?.formSnapshot?.size || "").trim();
    if (currentSize && !merged.some((opt) => opt.value === currentSize)) {
      merged.unshift({ label: `Current - ${currentSize}`, value: currentSize });
    }
    return merged;
  }, [chatResizePlatformKey, customSizes, latestThreadResult]);

  const viewedMessage = useMemo(() => {
    if (viewedImageRequestId) {
      return threadMessages.find((r) => r.id === viewedImageRequestId) || latestThreadResult;
    }
    return latestThreadResult;
  }, [latestThreadResult, threadMessages, viewedImageRequestId]);

  const displayedGenerationProgress = useMemo(
    () => Math.max(0, Math.min(100, Math.round(Number(generationProgress) || 0))),
    [generationProgress]
  );

  const showImageGenerationOverlay = isGenerating && displayedGenerationProgress > 0;

  const rootRequests = useMemo(() =>
    requests
      .filter((r) => !String(r.parentRequestId || "").trim())
      .sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt)),
    [getTimestampValue, requests]
  );

  const chatThreadRef = useRef(null);

  useEffect(() => {
    setIsPreviewImageLoading(Boolean(selectedRequest?.imageUrl));
  }, [selectedRequest?.id, selectedRequest?.imageUrl]);

  useEffect(() => {
    setPreviewNaturalRatio(1);
  }, [selectedRequest?.id]);

  useEffect(() => {
    setViewedImageRequestId("");
  }, [activeRootId]);

  useEffect(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, [threadMessages.length]);

  useEffect(() => {
    if (!selectedRequestId || !requests.length) return;
    if (lastHydratedSelectionRef.current === selectedRequestId) return;

    const clickedRequest = requests.find((request) => request.id === selectedRequestId);
    if (!clickedRequest) return;

    const latestRequest = resolveLatestThreadRequest(clickedRequest, requests) || clickedRequest;
    const nextRequestId = String(latestRequest.id || "").trim() || selectedRequestId;
    const nextFormSnapshot = coerceFormSnapshot(latestRequest.formSnapshot, latestRequest.requestGoal);
    const nextEditInstruction = String(latestRequest.editInstruction || "").trim();

    setFormState({ ...INITIAL_FORM_STATE, ...nextFormSnapshot });
    setEditInstruction(nextEditInstruction);

    lastHydratedSelectionRef.current = nextRequestId;
    if (nextRequestId !== selectedRequestId) {
      setSelectedRequestId(nextRequestId);
    }
  }, [coerceFormSnapshot, requests, resolveLatestThreadRequest, selectedRequestId]);

  useEffect(() => {
    if (!id) return undefined;

    const churchDocRef = doc(db, "churches", id);
    const settingsDocRef = doc(db, "churches", id, "myDesignTeamSettings", "general");

    const loadMetadata = async () => {
      try {
        const [churchSnap, settingsSnap] = await Promise.all([
          getDoc(churchDocRef),
          getDoc(settingsDocRef),
        ]);

        const churchData = churchSnap.exists() ? churchSnap.data() || {} : {};
        const settingsData = settingsSnap.exists() ? settingsSnap.data() || {} : {};

        setSettings({
          organizationName:
            String(settingsData.organizationName || "").trim() ||
            String(churchData.nombre || churchData.name || "").trim(),
          logoUrl: String(settingsData.logoUrl || "").trim(),
          brandColors: [
            normalizeColor(settingsData.brandColors?.[0], DEFAULT_COLORS[0]),
            normalizeColor(settingsData.brandColors?.[1], DEFAULT_COLORS[1]),
            normalizeColor(settingsData.brandColors?.[2], DEFAULT_COLORS[2]),
          ],
        });
      } catch (error) {
        console.error("Failed to load My Design Team settings:", error);
        toast.error("Could not load My Design Team settings.");
      }
    };

    loadMetadata();

    // Single request stream for roots and revisions to avoid listener target contention.
    const requestsQuery = query(
      collection(db, "churches", id, "myDesignTeamRequests"),
      orderBy("createdAt", "desc"),
      limit(500)
    );

    const referencesQuery = query(
      collection(db, "churches", id, "myDesignTeamReferenceDesigns"),
      orderBy("createdAt", "desc"),
      limit(120)
    );

    const unsubRequests = onSnapshot(requestsQuery, (snapshot) => {
      const mapped = snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) }));
      setRequests((previous) => {
        const merged = new Map();
        [...mapped, ...previous].forEach((item) => {
          if (!item?.id) return;
          merged.set(item.id, item);
        });
        return Array.from(merged.values()).sort(
          (a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt)
        );
      });

      if (!initializedRef.current && mapped.length) {
        initializedRef.current = true;
        const firstId = String(mapped[0]?.id || "").trim();
        if (firstId) {
          lastHydratedSelectionRef.current = firstId;
          setSelectedRequestId(firstId);
        }
      }
    });

    const unsubReferences = onSnapshot(referencesQuery, (snapshot) => {
      const mapped = snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) }));
      setReferences(mapped);
    });

    return () => {
      unsubRequests();
      unsubReferences();
    };
  }, [db, getTimestampValue, id]);

  const handleSaveSettings = async () => {
    if (!id) return;
    setSavingSettings(true);
    try {
      let nextLogoUrl = String(settings.logoUrl || "").trim();

      if (logoFile) {
        if (!storage) {
          throw new Error("Storage is not available for logo uploads.");
        }
        const path = `churches/${id}/my-design-team/logo/${Date.now()}-${sanitizeFileName(logoFile.name)}`;
        const logoStorageRef = ref(storage, path);
        await uploadBytes(logoStorageRef, logoFile, {
          contentType: logoFile.type || "image/png",
        });
        nextLogoUrl = await getDownloadURL(logoStorageRef);
      }

      const payload = {
        organizationName: String(settings.organizationName || "").trim(),
        logoUrl: nextLogoUrl,
        brandColors: [
          normalizeColor(settings.brandColors?.[0], DEFAULT_COLORS[0]),
          normalizeColor(settings.brandColors?.[1], DEFAULT_COLORS[1]),
          normalizeColor(settings.brandColors?.[2], DEFAULT_COLORS[2]),
        ],
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || "",
      };

      await setDoc(doc(db, "churches", id, "myDesignTeamSettings", "general"), payload, { merge: true });
      setSettings((previous) => ({ ...previous, logoUrl: payload.logoUrl, brandColors: payload.brandColors }));
      setLogoFile(null);
      toast.success("My Design Team settings saved.");
    } catch (error) {
      console.error("Failed to save My Design Team settings:", error);
      toast.error(error.message || "Could not save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleUploadReferences = async () => {
    if (!id || !referenceFiles.length) {
      toast.info("Select one or more design images first.");
      return;
    }

    if (!storage) {
      toast.error("Storage is not available for reference uploads.");
      return;
    }

    setUploadingReferences(true);
    setReferenceUploadProgress(0);
    setReferenceUploadStatus("Preparing upload...");

    try {
      const filesToUpload = Array.from(referenceFiles)
        .filter((file) => String(file.type || "").startsWith("image/"))
        .slice(0, MAX_REFERENCE_UPLOADS);

      if (!filesToUpload.length) {
        toast.info("Only image files can be uploaded as references.");
        return;
      }

      const totalBytes = filesToUpload.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      let uploadedBytes = 0;

      for (const file of filesToUpload) {
        const path = `churches/${id}/my-design-team/references/${Date.now()}-${sanitizeFileName(file.name)}`;
        const referenceRef = ref(storage, path);

        await new Promise((resolve, reject) => {
          const uploadTask = uploadBytesResumable(referenceRef, file, {
            contentType: file.type || "image/png",
          });

          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const fileProgressBytes = Number(snapshot.bytesTransferred) || 0;
              const aggregateBytes = uploadedBytes + fileProgressBytes;
              const progressValue = totalBytes > 0
                ? Math.min(100, Math.round((aggregateBytes / totalBytes) * 100))
                : 0;
              setReferenceUploadProgress(progressValue);
              setReferenceUploadStatus(`Uploading ${file.name} (${progressValue}%)`);
            },
            (error) => reject(error),
            () => resolve()
          );
        });

        uploadedBytes += Number(file.size) || 0;

        const completedProgressValue = totalBytes > 0
          ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
          : 100;
        setReferenceUploadProgress(completedProgressValue);
        setReferenceUploadStatus(`Processing ${file.name} (${completedProgressValue}%)`);

        const url = await getDownloadURL(referenceRef);

        await addDoc(collection(db, "churches", id, "myDesignTeamReferenceDesigns"), {
          name: file.name,
          url,
          storagePath: path,
          size: Number(file.size) || 0,
          mimeType: file.type || "image/png",
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || "",
        });
      }

      setReferenceUploadProgress(100);
      setReferenceUploadStatus("Upload complete");
      setReferenceFiles([]);
      toast.success("Reference designs uploaded.");
    } catch (error) {
      console.error("Failed to upload reference designs:", error);
      toast.error(error.message || "Could not upload reference designs.");
    } finally {
      setUploadingReferences(false);
      window.setTimeout(() => {
        setReferenceUploadProgress(0);
        setReferenceUploadStatus("");
      }, 1500);
    }
  };

  const handleDeleteReference = useCallback(async (reference) => {
    if (!id || !reference?.id) return;
    try {
      if (reference.storagePath) {
        const storageRef = ref(storage, reference.storagePath);
        await deleteObject(storageRef).catch(() => {});
      }
      await deleteDoc(doc(db, "churches", id, "myDesignTeamReferenceDesigns", reference.id));
      setReferences((previous) => previous.filter((r) => r.id !== reference.id));
      toast.success("Reference removed.");
    } catch (error) {
      console.error("Failed to delete reference:", error);
      toast.error("Could not remove reference.");
    }
  }, [id]);

  const handleAddCustomSize = useCallback(() => {
    const normalized = String(customSizeInput || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!normalized) {
      toast.info("Enter a custom size first. Example: 1440x1800");
      return;
    }

    if (!/^\d{2,5}x\d{2,5}$/.test(normalized)) {
      toast.info("Use WidthxHeight format. Example: 1080x1350");
      return;
    }

    setCustomSizes((previous) => {
      if (previous.includes(normalized)) return previous;
      return [normalized, ...previous].slice(0, 15);
    });
    setFormState((previous) => ({ ...previous, size: normalized }));
    setCustomSizeInput("");
    setIsAddingCustomSize(false);
  }, [customSizeInput]);

  const handleDeleteThread = useCallback(async (rootRequestId) => {
    if (!window.confirm("Delete this entire design thread and all its revisions? This cannot be undone.")) return;
    try {
      const threadDocs = requests.filter((r) => {
        const rid = String(r.rootRequestId || r.id || "").trim();
        return rid === rootRequestId || r.id === rootRequestId;
      });
      const batch = writeBatch(db);
      threadDocs.forEach((r) => {
        batch.delete(doc(db, "churches", id, "myDesignTeamRequests", r.id));
      });
      await batch.commit();
      setRequests((previous) => previous.filter((r) => {
        const rid = String(r.rootRequestId || r.id || "").trim();
        return rid !== rootRequestId && r.id !== rootRequestId;
      }));
      if (activeRootId === rootRequestId) {
        setSelectedRequestId("");
      }
      toast.success("Design thread deleted.");
    } catch (error) {
      console.error("Failed to delete thread:", error);
      toast.error("Could not delete thread.");
    }
  }, [activeRootId, db, id, requests]);

  const handleCorrectText = useCallback(async () => {
    const fieldsToCorrect = [
      ["title", String(formState.title || "").trim()],
      ["bibleVerse", String(formState.bibleVerse || "").trim()],
      ["location", String(formState.location || "").trim()],
      ["extraTextLines", String(formState.extraTextLines || "").trim()],
      ["exactCopy", String(formState.exactCopy || "").trim()],
    ].filter(([, value]) => Boolean(value));

    if (!fieldsToCorrect.length) return;

    setIsCorrectingText(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Please sign in again.");

      const updates = {};
      let changedCount = 0;

      for (const [fieldKey, originalText] of fieldsToCorrect) {
        const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/correctTextWithGemini`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ text: originalText }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Text correction failed.");

        const corrected = String(payload.correctedText || "").trim();
        if (corrected && corrected !== originalText) {
          updates[fieldKey] = corrected;
          changedCount += 1;
        }
      }

      if (changedCount > 0) {
        setFormState((previous) => ({ ...previous, ...updates }));
        toast.success(`AI corrected ${changedCount} text field${changedCount !== 1 ? "s" : ""}.`);
      } else {
        toast.info("Text looks good — no changes needed.");
      }
    } catch (err) {
      toast.error(err.message || "Could not correct text.");
    } finally {
      setIsCorrectingText(false);
    }
  }, [formState.bibleVerse, formState.exactCopy, formState.extraTextLines, formState.location, formState.title]);

  const submitDesignRequest = useCallback(
    async ({ isEdit, isNewThread, overrides = {} }) => {
      if (!id) return;

      // isNewThread = create a brand-new thread using the current design as source (e.g. translated version)
      const usesRevisionMode = isEdit || isNewThread;
      const requestType = (isEdit && !isNewThread) ? "edit" : "new";

      if (usesRevisionMode && !latestThreadResult?.imageUrl) {
        toast.info("Generate a design first before requesting changes.");
        return;
      }

      const effectiveEditInstruction = overrides.editInstruction !== undefined ? overrides.editInstruction : editInstruction;

      if (usesRevisionMode && !String(effectiveEditInstruction || "").trim()) {
        toast.info("Add edit instructions for the next iteration.");
        return;
      }

      setGenerationMode(usesRevisionMode ? "revised" : "new");
      setGenerationProgress(6);
      setGenerationStatus("Preparing request...");
      setIsGenerating(true);

      let requestRef = null;
      let didSucceed = false;

      try {
        const referenceNames = references.slice(0, 10).map((item) => String(item.name || "").trim()).filter(Boolean);
        const baseFormSnapshot = coerceFormSnapshot(formState);
        // Apply any overrides (e.g. size change from chat resize panel)
        const formSnapshot = overrides.formPatch
          ? { ...baseFormSnapshot, ...overrides.formPatch }
          : baseFormSnapshot;
        const editableText = buildEditableTextPayload(formSnapshot);
        const brandReferenceUrls = dedupeUrls([
          settings.logoUrl,
          ...references.slice(0, 8).map((item) => item.url),
        ]);

        // Convert any per-design inspiration files to data URLs and append
        let allReferenceUrls = brandReferenceUrls;
        if (!usesRevisionMode && inspirationFiles.length) {
          const inspirationDataUrls = await Promise.all(
            inspirationFiles.map((file) => blobToDataUrl(file))
          );
          allReferenceUrls = dedupeUrls([...brandReferenceUrls, ...inspirationDataUrls]);
        }
        const prompt = usesRevisionMode
          ? buildRevisionPrompt({
            editInstruction: effectiveEditInstruction,
            settings,
            referenceNames,
            language: overrides.language || "",
            formSnapshot,
          })
          : buildRequestPrompt({ formState: formSnapshot, settings, referenceNames });

        requestRef = await addDoc(collection(db, "churches", id, "myDesignTeamRequests"), {
          status: "processing",
          type: requestType,
          prompt,
          requestGoal: String(formState.goal || "").trim(),
          formSnapshot,
          editableText,
          editInstruction: usesRevisionMode ? String(effectiveEditInstruction || "").trim() : "",
          parentRequestId: (isEdit && !isNewThread) ? latestThreadResult?.id || "" : "",
          rootRequestId: (isEdit && !isNewThread)
            ? String(activeRootId || latestThreadResult?.rootRequestId || latestThreadResult?.id || "").trim()
            : "",
          referenceIds: references.slice(0, 12).map((item) => item.id),
          referenceImageUrls: references.slice(0, 12).map((item) => item.url).filter(Boolean),
          settingsSnapshot: {
            organizationName: settings.organizationName || "",
            logoUrl: settings.logoUrl || "",
            brandColors: settings.brandColors || DEFAULT_COLORS,
          },
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || "",
          createdByName: user?.name || user?.displayName || user?.email || "",
        });

        const localCreatedAt = new Date();
        setRequests((previous) => {
          const draftRequest = {
            id: requestRef.id,
            status: "processing",
            type: requestType,
            prompt,
            requestGoal: String(formState.goal || "").trim(),
            formSnapshot,
            editableText,
            editInstruction: usesRevisionMode ? String(effectiveEditInstruction || "").trim() : "",
            parentRequestId: (isEdit && !isNewThread) ? latestThreadResult?.id || "" : "",
            rootRequestId: (isEdit && !isNewThread)
              ? String(activeRootId || latestThreadResult?.id || "").trim()
              : requestRef.id,
            createdAt: localCreatedAt,
            createdByUid: user?.uid || "",
            createdByName: user?.name || user?.displayName || user?.email || "",
            imageUrl: "",
            errorMessage: "",
          };

          const existingIndex = previous.findIndex((entry) => entry.id === requestRef.id);
          if (existingIndex >= 0) {
            return previous.map((entry) => (entry.id === requestRef.id ? { ...entry, ...draftRequest } : entry));
          }
          return [draftRequest, ...previous];
        });

        if (!isEdit || isNewThread) {
          await updateDoc(requestRef, {
            rootRequestId: requestRef.id,
          });
        }
        setGenerationProgress((previous) => Math.max(previous, 18));
        setGenerationStatus("Request saved. Contacting Gemini...");

        lastHydratedSelectionRef.current = requestRef.id;
        setSelectedRequestId(requestRef.id);

        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          throw new Error("Please sign in again before requesting a design.");
        }

        const exactCopy = String(formSnapshot.exactCopy || "").trim();

        const revisionSourceImageUrl = usesRevisionMode
          ? (latestThreadResult?.baseImageUrl || latestThreadResult?.imageUrl || "")
          : "";

        const requestBody = {
          churchId: id,
          model: "gemini-2.0-flash-exp-image-generation",
          prompt,
          previousImageUrl: revisionSourceImageUrl,
          referenceImageUrls: allReferenceUrls,
        };

        const maxAttempts = 3;
        let response = null;
        let payload = {};
        let composedMessage = "Gemini request failed.";

        setGenerationProgress((previous) => Math.max(previous, 34));
        setGenerationStatus("Generating design with Gemini...");

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateDesignWithGemini`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify(requestBody),
          });

          payload = await response.json().catch(() => ({}));

          if (response.ok) {
            break;
          }

          const detailsText =
            typeof payload.details === "string"
              ? payload.details
              : payload.details?.error?.message || payload.details?.message || "";
          const attemptedModels = Array.isArray(payload.attemptedModels)
            ? ` Tried models: ${payload.attemptedModels.join(", ")}.`
            : "";
          composedMessage =
            `${payload.message || payload.error || detailsText || "Gemini request failed."}${attemptedModels}`.trim();

          const retryableByStatus = RETRYABLE_GENERATION_STATUS_CODES.has(response.status);
          const retryableByMessage = /timeout|temporar|unavailable|overload|try again|no image|gateway|attached image|matched input/i.test(
            composedMessage
          );
          const shouldRetry = retryableByStatus || retryableByMessage;

          if (attempt < maxAttempts && shouldRetry) {
            setGenerationStatus(`Gemini is taking longer than expected. Retrying (${attempt + 1}/${maxAttempts})...`);
            setGenerationProgress((previous) => Math.max(previous, 34 + (attempt * 10)));
            await wait(attempt * 1200);
            continue;
          }

          throw new Error(composedMessage);
        }

        if (!response || !response.ok) {
          throw new Error(composedMessage || "Gemini request failed.");
        }
        setGenerationProgress((previous) => Math.max(previous, 60));
        setGenerationStatus("Processing Gemini response...");

        if (!payload.imageBase64) {
          throw new Error("Gemini did not return an image.");
        }

        if (!storage) {
          throw new Error("Storage is not available for generated image uploads.");
        }

        const imageMimeType = String(payload.mimeType || "image/png").toLowerCase();
        let baseBlob = base64ToBlob(payload.imageBase64, imageMimeType);

        const baseImagePath = `churches/${id}/my-design-team/generated/base-${requestRef.id}.png`;
        const baseImageRef = ref(storage, baseImagePath);
        setGenerationProgress((previous) => Math.max(previous, 72));
        setGenerationStatus("Saving base image...");
        await uploadBytes(baseImageRef, baseBlob, { contentType: "image/png" });
        const baseImageUrl = await getDownloadURL(baseImageRef);

        let blob = baseBlob;
        let finalMimeType = "image/png";
        if (exactCopy) {
          setGenerationProgress((previous) => Math.max(previous, 82));
          setGenerationStatus("Applying exact text lock...");
          blob = await addExactCopyOverlay(blob, exactCopy);
          finalMimeType = "image/png";
        }
        const extension = finalMimeType.includes("jpeg") ? "jpg" : "png";
        const imagePath = `churches/${id}/my-design-team/generated/${requestRef.id}.${extension}`;
        const imageRef = ref(storage, imagePath);
        setGenerationProgress((previous) => Math.max(previous, 88));
        setGenerationStatus("Uploading generated image...");

        await uploadBytes(imageRef, blob, { contentType: finalMimeType });
        const imageUrl = await getDownloadURL(imageRef);
        setGenerationProgress((previous) => Math.max(previous, 94));
        setGenerationStatus("Finalizing request...");

        await updateDoc(requestRef, {
          status: "completed",
          imageUrl,
          imageStoragePath: imagePath,
          baseImageUrl,
          baseImageStoragePath: baseImagePath,
          responseText: String(payload.text || "").trim(),
          model: String(payload.model || "gemini-2.0-flash-exp-image-generation"),
          outputSize: String(formSnapshot.size || "").trim(),
          editableText,
          completedAt: serverTimestamp(),
          errorMessage: "",
        });

        setRequests((previous) =>
          previous.map((entry) =>
            entry.id === requestRef.id
              ? {
                ...entry,
                status: "completed",
                imageUrl,
                imageStoragePath: imagePath,
                baseImageUrl,
                baseImageStoragePath: baseImagePath,
                responseText: String(payload.text || "").trim(),
                model: String(payload.model || "gemini-2.0-flash-exp-image-generation"),
                outputSize: String(formSnapshot.size || "").trim(),
                editableText,
                completedAt: new Date(),
                errorMessage: "",
              }
              : entry
          )
        );
        lastHydratedSelectionRef.current = requestRef.id;
        setSelectedRequestId(requestRef.id);

        didSucceed = true;
        setGenerationProgress(100);
        setGenerationStatus("Design ready.");
        setEditInstruction("");
        setInspirationFiles([]);
        toast.success("Design generated. You can now request changes.");
      } catch (error) {
        console.error("Design generation failed:", error);

        const rawMessage = String(error?.message || "").trim();
        const isTemporaryFailure = /timeout|temporar|unavailable|overload|try again|no image|gateway|request failed|attached image|matched input/i.test(
          rawMessage
        );
        const userFacingMessage = isTemporaryFailure
          ? TEMPORARY_GENERATION_MESSAGE
          : (rawMessage || "Could not generate design.");

        if (requestRef) {
          await updateDoc(requestRef, {
            status: "failed",
            errorMessage: userFacingMessage,
            failedAt: serverTimestamp(),
          }).catch(() => {
            // Ignore update failures when reporting original error.
          });

          setRequests((previous) =>
            previous.map((entry) =>
              entry.id === requestRef.id
                ? {
                  ...entry,
                  status: "failed",
                  errorMessage: userFacingMessage,
                  failedAt: new Date(),
                }
                : entry
            )
          );
        }

        setGenerationProgress(100);
        setGenerationStatus(
          isTemporaryFailure
            ? "Still working on it. We need a little more time."
            : "Generation failed."
        );
        if (isTemporaryFailure) {
          toast.info("We need a little more time for this design. Please try again shortly.");
        } else {
          toast.error(userFacingMessage);
        }
      } finally {
        setIsGenerating(false);
        window.setTimeout(
          () => {
            setGenerationProgress(0);
            setGenerationStatus("");
          },
          didSucceed ? 1200 : 2000
        );
      }
    },
    [activeRootId, coerceFormSnapshot, editInstruction, formState, id, inspirationFiles, latestThreadResult, references, settings, user]
  );

  const normalizeQueuedPayload = useCallback((payload = {}) => {
    const normalized = {
      ...payload,
      overrides: {
        ...(payload?.overrides || {}),
      },
    };

    if (normalized.overrides.formPatch && typeof normalized.overrides.formPatch === "object") {
      normalized.overrides.formPatch = { ...normalized.overrides.formPatch };
    }

    const requiresInstruction = Boolean(normalized.isEdit || normalized.isNewThread);
    if (requiresInstruction && normalized.overrides.editInstruction === undefined) {
      normalized.overrides.editInstruction = String(editInstruction || "").trim();
    }

    return normalized;
  }, [editInstruction]);

  const queueLabelFromPayload = useCallback((payload = {}) => {
    const instruction = String(payload?.overrides?.editInstruction || "").trim();
    if (!instruction) {
      if (payload?.isNewThread) return "Queued: new version";
      if (payload?.isEdit) return "Queued: revision";
      return "Queued: new design";
    }
    const firstLine = instruction.split(/\r?\n/)[0] || instruction;
    const compact = firstLine.replace(/\s+/g, " ").trim();
    return compact.length > 88 ? `${compact.slice(0, 85)}...` : compact;
  }, []);

  const enqueueDesignRequest = useCallback((payload = {}) => {
    const normalizedPayload = normalizeQueuedPayload(payload);

    if (!isGenerating) {
      submitDesignRequest(normalizedPayload);
      return;
    }

    const queueEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: queueLabelFromPayload(normalizedPayload),
      payload: normalizedPayload,
    };

    setPendingChangeQueue((previous) => [...previous, queueEntry]);
    toast.info("Change queued. It will run automatically next.");
  }, [isGenerating, normalizeQueuedPayload, queueLabelFromPayload, submitDesignRequest]);

  useEffect(() => {
    if (isGenerating || !pendingChangeQueue.length) return;
    const [nextEntry, ...rest] = pendingChangeQueue;
    setPendingChangeQueue(rest);
    submitDesignRequest(nextEntry.payload);
  }, [isGenerating, pendingChangeQueue, submitDesignRequest]);

  return (
    <div className="my-design-team-page" style={commonStyles.fullWidthContainer}>
      <ChurchHeader id={id} />

      <div className="my-design-team-shell">
        <div className="my-design-team-hero">
          <h1>My Design Team</h1>
          <p>
            Create branded designs with Gemini, iterate from image feedback, and keep a searchable
            history for your organization.
          </p>
        </div>

        <div className="my-design-team-grid">
          <section className="my-design-team-card">
            <h2>1) Brand Settings</h2>
            <label htmlFor="design-org-name">Organization name</label>
            <input
              id="design-org-name"
              value={settings.organizationName}
              onChange={(event) =>
                setSettings((previous) => ({ ...previous, organizationName: event.target.value }))
              }
              placeholder="Example: Iglesia Central"
            />

            <label htmlFor="design-logo">Logo image</label>
            <input
              id="design-logo"
              type="file"
              accept="image/*"
              onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
            />
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Organization logo" className="my-design-team-logo-preview" />
            ) : null}

            <div className="my-design-team-color-row">
              {(settings.brandColors || DEFAULT_COLORS).map((color, index) => (
                <div key={`brand-color-${index}`} className="my-design-team-color-item">
                  <label htmlFor={`brand-color-${index}`}>Brand color {index + 1}</label>
                  <input
                    id={`brand-color-${index}`}
                    type="color"
                    value={normalizeColor(color, DEFAULT_COLORS[index])}
                    onChange={(event) => {
                      const nextColors = [...(settings.brandColors || DEFAULT_COLORS)];
                      nextColors[index] = event.target.value;
                      setSettings((previous) => ({ ...previous, brandColors: nextColors }));
                    }}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleSaveSettings}
              className="my-design-team-button"
              disabled={savingSettings}
            >
              {savingSettings ? "Saving..." : "Save settings"}
            </button>
          </section>

          <section className="my-design-team-card">
            <h2>2) Reference Library</h2>
            <p className="my-design-team-muted">
              Upload previous designs so Gemini has visual context for your organization.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => setReferenceFiles(Array.from(event.target.files || []))}
            />
            <button
              type="button"
              onClick={handleUploadReferences}
              className="my-design-team-button"
              disabled={uploadingReferences}
            >
              {uploadingReferences ? "Uploading..." : "Upload references"}
            </button>

            {(uploadingReferences || referenceUploadProgress > 0) ? (
              <div className="my-design-team-upload-progress" role="status" aria-live="polite">
                <div className="my-design-team-upload-progress-track">
                  <div
                    className="my-design-team-upload-progress-fill"
                    style={{ width: `${referenceUploadProgress}%` }}
                  />
                </div>
                <div className="my-design-team-upload-progress-label">
                  {referenceUploadStatus || `Uploading... ${referenceUploadProgress}%`}
                </div>
              </div>
            ) : null}

            <div className="my-design-team-reference-grid">
              {references.slice(0, 12).map((reference) => (
                <article key={reference.id} className="my-design-team-reference-item">
                  <div className="my-design-team-reference-img-wrap">
                    <img src={reference.url} alt={reference.name || "Reference design"} />
                    <button
                      type="button"
                      className="my-design-team-reference-delete"
                      onClick={() => handleDeleteReference(reference)}
                      aria-label="Remove reference"
                      title="Remove"
                    >
                      &times;
                    </button>
                  </div>
                  <p>{reference.name || "Untitled reference"}</p>
                </article>
              ))}
              {!references.length ? <p className="my-design-team-muted">No reference designs yet.</p> : null}
            </div>
          </section>

          <section className="my-design-team-card">
            <h2>3) Start Design Request</h2>
            <label htmlFor="design-title">Design title <span className="my-design-team-optional">(optional)</span></label>
            <input
              id="design-title"
              value={formState.title || ""}
              onChange={(event) => setFormState((previous) => ({ ...previous, title: event.target.value }))}
              placeholder="Example: Easter Sunday Service"
            />

            <label htmlFor="design-language">Design language</label>
            <select
              id="design-language"
              value={formState.language || "English"}
              onChange={(event) => setFormState((previous) => ({ ...previous, language: event.target.value }))}
            >
              <option value="English">English</option>
              <option value="Spanish">Spanish (Español)</option>
              <option value="Portuguese">Portuguese (Português)</option>
              <option value="French">French (Français)</option>
              <option value="Italian">Italian (Italiano)</option>
              <option value="German">German (Deutsch)</option>
              <option value="Haitian Creole">Haitian Creole (Kreyòl)</option>
            </select>

            <label htmlFor="design-bible-verse">Bible verse <span className="my-design-team-optional">(optional)</span></label>
            <input
              id="design-bible-verse"
              value={formState.bibleVerse}
              onChange={(event) => setFormState((previous) => ({ ...previous, bibleVerse: event.target.value }))}
              placeholder="Type the FULL verse text, e.g.: For God so loved the world... — John 3:16"
            />

            <label htmlFor="design-date">Date <span className="my-design-team-optional">(optional)</span></label>
            <input
              id="design-date"
              value={formState.date}
              onChange={(event) => setFormState((previous) => ({ ...previous, date: event.target.value }))}
              placeholder="Example: Sunday, June 15, 2025"
            />

            <label htmlFor="design-start-time">Start time <span className="my-design-team-optional">(optional)</span></label>
            <input
              id="design-start-time"
              value={formState.startTime}
              onChange={(event) => setFormState((previous) => ({ ...previous, startTime: event.target.value }))}
              placeholder="Example: 10:00 AM"
            />

            <label htmlFor="design-end-time">End time <span className="my-design-team-optional">(optional)</span></label>
            <input
              id="design-end-time"
              value={formState.endTime}
              onChange={(event) => setFormState((previous) => ({ ...previous, endTime: event.target.value }))}
              placeholder="Example: 12:00 PM"
            />

            <label htmlFor="design-location">Location <span className="my-design-team-optional">(optional)</span></label>
            <input
              id="design-location"
              value={formState.location}
              onChange={(event) => setFormState((previous) => ({ ...previous, location: event.target.value }))}
              placeholder="Example: Main Sanctuary · 123 Church St"
            />

            <label htmlFor="design-platform">Platform/channel</label>
            <select
              id="design-platform"
              value={platformKey}
              onChange={(event) => {
                const selected = event.target.value;
                if (selected === "instagram") {
                  setFormState((previous) => ({ ...previous, platform: "Instagram" }));
                  return;
                }
                if (selected === "facebook") {
                  setFormState((previous) => ({ ...previous, platform: "Facebook" }));
                  return;
                }
                setFormState((previous) => ({ ...previous, platform: "" }));
              }}
            >
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="custom">Other / Custom</option>
            </select>

            {platformKey === "custom" ? (
              <input
                value={formState.platform}
                onChange={(event) =>
                  setFormState((previous) => ({ ...previous, platform: event.target.value }))
                }
                placeholder="Example: YouTube thumbnail"
              />
            ) : null}

            <label htmlFor="design-size">Size or aspect ratio</label>
            <select
              id="design-size"
              value={formState.size}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "__add_custom__") {
                  setIsAddingCustomSize(true);
                  return;
                }
                setFormState((previous) => ({ ...previous, size: nextValue }));
              }}
            >
              <option value="">Select recommended size</option>
              {sizeOptions.map((option) => (
                <option key={`${option.value}-${option.label}`} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="__add_custom__">Add custom size...</option>
            </select>

            {isAddingCustomSize ? (
              <div className="my-design-team-custom-size-row">
                <input
                  value={customSizeInput}
                  onChange={(event) => setCustomSizeInput(event.target.value)}
                  placeholder="Example: 1440x1800"
                />
                <button type="button" className="my-design-team-button" onClick={handleAddCustomSize}>
                  Add size
                </button>
              </div>
            ) : null}

            <label>Style inspiration <span className="my-design-team-optional">(optional — only for this design)</span></label>
            <div className="my-design-team-inspiration-area">
              {inspirationFiles.length > 0 ? (
                <div className="my-design-team-inspiration-thumbs">
                  {inspirationFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="my-design-team-inspiration-thumb-wrap">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="my-design-team-inspiration-thumb"
                      />
                      <button
                        type="button"
                        className="my-design-team-reference-delete"
                        onClick={() => setInspirationFiles((prev) => prev.filter((_, i) => i !== index))}
                        aria-label="Remove inspiration"
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <label htmlFor="design-inspiration-upload" className="my-design-team-inspiration-upload-label">
                + Add inspiration images
                <input
                  id="design-inspiration-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []).slice(0, 5);
                    setInspirationFiles((prev) => [...prev, ...files].slice(0, 5));
                    event.target.value = "";
                  }}
                />
              </label>
              {inspirationFiles.length > 0 ? (
                <span className="my-design-team-inspiration-hint">{inspirationFiles.length} image{inspirationFiles.length !== 1 ? "s" : ""} selected — Gemini will match this style for this generation only</span>
              ) : (
                <span className="my-design-team-inspiration-hint">Upload up to 5 images. Gemini will use their style for this generation only.</span>
              )}
            </div>

            <label htmlFor="design-notes">Additional notes</label>
            <textarea
              id="design-notes"
              rows={3}
              value={formState.notes}
              onChange={(event) => setFormState((previous) => ({ ...previous, notes: event.target.value }))}
              placeholder="Any copy, scripture, CTA, or constraints"
            />

            <label htmlFor="design-exact-copy">Exact wording to render (text lock)</label>
            <textarea
              id="design-exact-copy"
              rows={2}
              value={formState.exactCopy}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, exactCopy: event.target.value }))
              }
              placeholder="Example: JESUS LOVES YOU"
            />
            <button
              type="button"
              className="my-design-team-ai-fix-btn"
              onClick={handleCorrectText}
              disabled={isCorrectingText || !(
                formState.title.trim()
                || formState.bibleVerse.trim()
                || formState.location.trim()
                || formState.extraTextLines.trim()
                || formState.exactCopy.trim()
              )}
              title="Let Gemini fix spelling and grammar in your text fields"
            >
              {isCorrectingText ? "Fixing..." : "✦ Fix with AI"}
            </button>

            <button
              type="button"
              className="my-design-team-button"
              onClick={() => enqueueDesignRequest({ isEdit: false })}
              disabled={isGenerating}
            >
              {isGenerating ? "Generating..." : "Generate with Gemini"}
            </button>

            {(generationMode === "new" && (isGenerating || generationProgress > 0)) ? (
              <div className="my-design-team-generation-progress" role="status" aria-live="polite">
                <div className="my-design-team-generation-progress-track">
                  <div
                    className="my-design-team-generation-progress-fill"
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
                <div className="my-design-team-generation-progress-label">
                  {generationStatus || `Generating... ${generationProgress}%`}
                </div>
              </div>
            ) : null}
          </section>

          <section className="my-design-team-card my-design-team-chat-card">
            <h2>4) Chat &amp; Revise</h2>

            <div className="my-design-team-chat-thread" ref={chatThreadRef}>
              {!threadMessages.length ? (
                <p className="my-design-team-muted">Generate a design above to start a conversation here.</p>
              ) : null}
              {threadMessages.map((msg, index) => {
                const status = String(msg.status || "").toLowerCase();
                const isProcessing = status === "processing";
                const isFailed = status === "failed";
                const label = index === 0
                  ? (msg.formSnapshot?.purpose || msg.requestGoal || "Initial design")
                  : (msg.editInstruction || "Revision");
                const isActive = viewedMessage?.id === msg.id;
                return (
                  <div key={msg.id} className={`my-design-team-chat-msg${isActive ? " is-active" : ""}`}>
                    <span className="my-design-team-chat-msg-tag">{index === 0 ? "New design" : "Revision"}</span>
                    <p className="my-design-team-chat-msg-label">{label}</p>
                    {isProcessing ? (
                      <div className="my-design-team-chat-msg-processing">
                        <span className="my-design-team-image-loader-spinner" aria-hidden="true" />
                        <span>{generationStatus || "Generating..."}</span>
                      </div>
                    ) : isFailed ? (
                      <p className="my-design-team-chat-msg-failed">{msg.errorMessage || TEMPORARY_GENERATION_MESSAGE}</p>
                    ) : msg.imageUrl ? (
                      <button
                        type="button"
                        className="my-design-team-chat-msg-thumb-btn"
                        onClick={() => setViewedImageRequestId(msg.id)}
                        aria-label="View this version"
                      >
                        <img src={msg.imageUrl} alt={label} className="my-design-team-chat-msg-thumb" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {viewedMessage?.imageUrl ? (
              <>
                <div className="my-design-team-generated-image-frame">
                  <img
                    src={viewedMessage.imageUrl}
                    alt="Viewed design version"
                    className="my-design-team-generated-image"
                    onLoad={(event) => {
                      const naturalWidth = Number(event.currentTarget?.naturalWidth) || 0;
                      const naturalHeight = Number(event.currentTarget?.naturalHeight) || 0;
                      if (naturalWidth > 0 && naturalHeight > 0) {
                        setPreviewNaturalRatio(naturalWidth / naturalHeight);
                      }
                      setIsPreviewImageLoading(false);
                    }}
                    onError={() => setIsPreviewImageLoading(false)}
                  />
                  {(isPreviewImageLoading || showImageGenerationOverlay) ? (
                    <div className="my-design-team-image-loader-overlay">
                      <span className="my-design-team-image-loader-spinner" aria-hidden="true" />
                      {showImageGenerationOverlay ? (
                        <>
                          <div className="my-design-team-image-loader-text">
                            {generationStatus || "Generating design..."}
                          </div>
                          <div className="my-design-team-image-loader-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayedGenerationProgress}>
                            <div
                              className="my-design-team-image-loader-progress-fill"
                              style={{ width: `${displayedGenerationProgress}%` }}
                            />
                          </div>
                          <div className="my-design-team-image-loader-progress-label">
                            {displayedGenerationProgress}%
                          </div>
                        </>
                      ) : (
                        <div className="my-design-team-image-loader-text">Loading preview...</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <a
                  href={viewedMessage.imageUrl}
                  download={`design-${viewedMessage.id || "image"}.png`}
                  className="my-design-team-download-btn"
                  target="_blank"
                  rel="noreferrer"
                >
                  &#8595; Download image
                </a>
              </>
            ) : null}

            <details className="my-design-team-resize-panel">
              <summary className="my-design-team-resize-summary">
                &#127760; Change language
                {chatLanguage ? <span className="my-design-team-resize-badge">{chatLanguage}</span> : null}
              </summary>
              <div className="my-design-team-resize-body">
                <p className="my-design-team-resize-hint">
                  Translate all text in this design to a different language. Layout and style stay the same.
                </p>
                <div className="my-design-team-resize-row">
                  <select
                    value={chatLanguage}
                    onChange={(event) => setChatLanguage(event.target.value)}
                    disabled={!latestThreadResult}
                  >
                    <option value="">Select language…</option>
                    <option value="English">English</option>
                    <option value="Spanish">Spanish (Español)</option>
                    <option value="Portuguese">Portuguese (Português)</option>
                    <option value="French">French (Français)</option>
                    <option value="Italian">Italian (Italiano)</option>
                    <option value="German">German (Deutsch)</option>
                    <option value="Haitian Creole">Haitian Creole (Kreyòl)</option>
                  </select>
                  <button
                    type="button"
                    className="my-design-team-button my-design-team-resize-apply-btn"
                    disabled={!latestThreadResult || !chatLanguage}
                    onClick={() => {
                      enqueueDesignRequest({
                        isNewThread: true,
                        overrides: {
                          editInstruction: `Translate all text in the design to ${chatLanguage}. Keep everything else — layout, colors, fonts, imagery — exactly the same.`,
                          language: chatLanguage,
                        },
                      });
                      setChatLanguage("");
                    }}
                  >
                    {isGenerating && generationMode === "revised" ? "Translating..." : "Add Language Version"}
                  </button>
                </div>
              </div>
            </details>

            <details className="my-design-team-resize-panel">
              <summary className="my-design-team-resize-summary">
                &#8652; Resize design
                {chatResizeSize ? <span className="my-design-team-resize-badge">{chatResizeSize}</span> : null}
              </summary>
              <div className="my-design-team-resize-body">
                <p className="my-design-team-resize-hint">
                  Choose a new size and Gemini will recreate the same content and style in the new dimensions.
                </p>
                <div className="my-design-team-resize-row">
                  <select
                    value={chatResizePlatform}
                    onChange={(event) => {
                      setChatResizePlatform(event.target.value);
                      setChatResizeSize("");
                    }}
                    disabled={!latestThreadResult}
                  >
                    <option value="">Platform (optional)</option>
                    <option value="Instagram">Instagram</option>
                    <option value="Facebook">Facebook</option>
                    <option value="">Custom</option>
                  </select>
                  <select
                    value={chatResizeSize}
                    onChange={(event) => setChatResizeSize(event.target.value)}
                    disabled={!latestThreadResult}
                  >
                    <option value="">Select size…</option>
                    {chatResizeSizeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <span className="my-design-team-resize-or">or</span>
                  <input
                    type="text"
                    className="my-design-team-resize-custom-input"
                    value={chatResizeCustomInput}
                    onChange={(event) => {
                      setChatResizeCustomInput(event.target.value);
                      if (/^\d{2,5}x\d{2,5}$/.test(event.target.value.replace(/\s/g, ""))) {
                        setChatResizeSize(event.target.value.replace(/\s/g, "").toLowerCase());
                      }
                    }}
                    placeholder="e.g. 1200x628"
                    disabled={!latestThreadResult}
                  />
                  <button
                    type="button"
                    className="my-design-team-button my-design-team-resize-apply-btn"
                    disabled={!latestThreadResult || !chatResizeSize}
                    onClick={() => {
                      const currentSize = String(latestThreadResult?.formSnapshot?.size || "").trim();
                      const instruction = `Recreate this exact design at the new size ${chatResizeSize}. Keep ALL visual content, text, colors, fonts, layout composition, and style 100% identical — only adapt the proportions and spacing to fit the new dimensions. Do not change anything else. IMPORTANT: Output one single full-canvas design only. Do NOT create side-by-side versions, comparisons, split screens, or duplicate layouts.`;
                      enqueueDesignRequest({
                        isEdit: true,
                        overrides: {
                          editInstruction: instruction,
                          formPatch: { size: chatResizeSize },
                        },
                      });
                      setChatResizeSize("");
                      setChatResizeCustomInput("");
                      setChatResizePlatform("");
                    }}
                  >
                    {isGenerating && generationMode === "revised" ? "Resizing..." : "Apply Resize"}
                  </button>
                </div>
              </div>
            </details>

            <div className="my-design-team-chat-input-row">
              <textarea
                value={editInstruction}
                onChange={(event) => setEditInstruction(event.target.value)}
                placeholder="What would you like to change? Example: make the background darker and add a white glow around the title"
                rows={2}
                disabled={!latestThreadResult}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && latestThreadResult && editInstruction.trim()) {
                    event.preventDefault();
                    enqueueDesignRequest({ isEdit: true });
                    setEditInstruction("");
                  }
                }}
              />
              <button
                type="button"
                className="my-design-team-button my-design-team-button-secondary my-design-team-chat-send-btn"
                onClick={() => {
                  enqueueDesignRequest({ isEdit: true });
                  setEditInstruction("");
                }}
                disabled={!latestThreadResult || !String(editInstruction || "").trim()}
              >
                {isGenerating && generationMode === "revised" ? "..." : "Send"}
              </button>
            </div>

            {pendingChangeQueue.length ? (
              <div className="my-design-team-queue-panel" role="status" aria-live="polite">
                <div className="my-design-team-queue-title">
                  Queued changes: {pendingChangeQueue.length}
                </div>
                <ul className="my-design-team-queue-list">
                  {pendingChangeQueue.slice(0, 4).map((entry, index) => (
                    <li key={entry.id} className="my-design-team-queue-item">
                      <span className="my-design-team-queue-index">#{index + 1}</span>
                      <span className="my-design-team-queue-label">{entry.label}</span>
                    </li>
                  ))}
                  {pendingChangeQueue.length > 4 ? (
                    <li className="my-design-team-queue-more">
                      +{pendingChangeQueue.length - 4} more pending
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {latestThreadResult ? (
              <div className="my-design-team-redesign-row">
                <span className="my-design-team-redesign-label">Not happy with the result?</span>
                <button
                  type="button"
                  className="my-design-team-redesign-btn"
                  disabled={!latestThreadResult}
                  onClick={() => {
                    const snapshot = latestThreadResult?.formSnapshot || {};
                    const purpose = String(snapshot.purpose || formState.purpose || "").trim();
                    const topic = String(snapshot.topic || formState.topic || "").trim();
                    const bibleVerse = String(snapshot.bibleVerse || formState.bibleVerse || "").trim();
                    const instruction = [
                      "Discard the current design and create a completely NEW, original design from scratch using the same brief below. Do not reuse any element from the previous design — different composition, different layout, different visual treatment.",
                      purpose ? `Purpose: ${purpose}` : "",
                      topic ? `Topic: ${topic}` : "",
                      bibleVerse ? `Scripture: ${bibleVerse}` : "",
                    ].filter(Boolean).join("\n");
                    enqueueDesignRequest({
                      isNewThread: true,
                      overrides: { editInstruction: instruction },
                    });
                  }}
                >
                  &#8635; Redesign from scratch
                </button>
              </div>
            ) : null}

            {(generationMode === "revised" && (isGenerating || generationProgress > 0)) ? (
              <div className="my-design-team-generation-progress" role="status" aria-live="polite">
                <div className="my-design-team-generation-progress-track">
                  <div
                    className="my-design-team-generation-progress-fill"
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
                <div className="my-design-team-generation-progress-label">
                  {generationStatus || `Revising... ${generationProgress}%`}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <section className="my-design-team-card my-design-team-history">
          <h2>Design Threads</h2>
          <p className="my-design-team-muted">Each thread is a design conversation. Click to open it in the chat panel.</p>
          <div className="my-design-team-history-list">
            {rootRequests.map((request) => {
              const threadDocs = requests.filter((r) => {
                const rid = String(r.rootRequestId || r.id || "").trim();
                return rid === request.id;
              });
              const threadCount = threadDocs.length;
              const isActiveThread = activeRootId === request.id;
              const latestImage = [...threadDocs]
                .sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt))
                .find((r) => r.imageUrl)?.imageUrl || "";
              const label = request.formSnapshot?.purpose || request.formSnapshot?.title || request.requestGoal || "Untitled design";
              return (
                <div
                  key={request.id}
                  className={`my-design-team-history-item${isActiveThread ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="my-design-team-history-item-body"
                    onClick={() => setSelectedRequestId(request.id)}
                  >
                    {latestImage
                      ? <img src={latestImage} alt={label} className="my-design-team-history-thumb" />
                      : <div className="my-design-team-history-thumb-placeholder">🎨</div>
                    }
                    <div className="my-design-team-history-info">
                      <span className="my-design-team-history-title">{label}</span>
                      <span className="my-design-team-history-meta">
                        {String(request.status || "pending").toUpperCase()}
                        {threadCount > 1 ? ` · ${threadCount - 1} revision${threadCount - 1 === 1 ? "" : "s"}` : ""}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="my-design-team-history-delete-btn"
                    title="Delete thread"
                    onClick={(e) => { e.stopPropagation(); handleDeleteThread(request.id); }}
                  >
                    &#128465;
                  </button>
                </div>
              );
            })}
            {!rootRequests.length ? <p className="my-design-team-muted">No designs yet.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
};

export default MyDesignTeam;
