const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors");
let twilioLib = null;
// const stripe = require('stripe')(functions.config().stripe.secret_key); // Commented out to fix deployment error
const axios = require('axios');
const crypto = require('crypto');
let sql = null;
// const { freshbooksToken } = require('./freshbooksToken'); // Temporarily commented out to fix deployment

// Load environment variables from .env file
require('dotenv').config();

// Define allowed origins for all functions
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://bible-search-frontend.vercel.app',
  'https://bible-search-frontend-git-main-sparedes88s-projects.vercel.app',
  'https://iglesiatech.app',
  'https://www.iglesiatech.app',
  'https://churchadmin.app',
  'https://www.churchadmin.app',
  'https://igletechv1.web.app',
  'https://igletechv1.firebaseapp.com'
];

// Create a reusable CORS handler function
const handleCors = (req, res) => {
  const origin = req.headers.origin;
  
  // Check if the origin is in our allowed list
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    // Credentials are only valid with a specific origin, never with wildcard.
    res.set('Access-Control-Allow-Credentials', 'true');
  } else {
    // Unknown origin — allow all but without credentials (required by the CORS spec).
    res.set('Access-Control-Allow-Origin', '*');
  }
  
  // Set other CORS headers
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept, X-Requested-With');
  
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  
  return false;
};

// Initialize Firebase Admin SDK with default credentials
if (!admin.apps.length) {
  admin.initializeApp();
}

// SQL Server Configuration
const sqlConfig = {
  user: process.env.SQL_USER || functions.config().sql?.user,
  password: process.env.SQL_PASSWORD || functions.config().sql?.password,
  server: process.env.SQL_SERVER || functions.config().sql?.server,
  port: parseInt(process.env.SQL_PORT || functions.config().sql?.port) || 1433,
  database: process.env.SQL_DATABASE || functions.config().sql?.database,
  options: {
    encrypt: true, // Use encryption
    trustServerCertificate: true, // For local development
    enableArithAbort: true,
    connectionTimeout: 30000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// SQL Server connection pool
let sqlPool = null;

// Initialize SQL Server connection pool
async function getSqlPool() {
  if (!sqlPool) {
    try {
      if (!sql) {
        sql = require('mssql');
      }
      sqlPool = await sql.connect(sqlConfig);
      console.log('✅ Connected to SQL Server');
    } catch (error) {
      console.error('❌ SQL Server connection error:', error);
      throw error;
    }
  }
  return sqlPool;
}

// Helper function to execute SQL queries
async function executeQuery(query, params = []) {
  try {
    const pool = await getSqlPool();
    const request = pool.request();
    
    // Add parameters if provided
    params.forEach((param, index) => {
      request.input(`param${index}`, param);
    });
    
    const result = await request.query(query);
    return result.recordset;
  } catch (error) {
    console.error('❌ SQL Query error:', error);
    throw error;
  }
}

// Initialize Twilio client lazily (only if credentials are available)
let twilioClient = null;
const getTwilioClient = () => {
  if (twilioClient) return twilioClient;
  const accountSid = process.env.TWILIO_ACCOUNT_SID || functions.config().twilio?.account_sid;
  const authToken = process.env.TWILIO_AUTH_TOKEN || functions.config().twilio?.auth_token;
  if (!accountSid || !authToken) return null;
  if (!twilioLib) {
    twilioLib = require('twilio');
  }
  twilioClient = twilioLib(accountSid, authToken);
  return twilioClient;
};

const getGeminiApiKey = () => {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    functions.config().gemini?.apikey ||
    functions.config().gemini?.api_key ||
    functions.config().google?.apikey ||
    functions.config().google?.api_key ||
    ""
  );
};

const normalizeText = (value) => String(value || '').trim();

let geminiModelCache = {
  names: [],
  expiresAtMs: 0,
};

const normalizeGeminiModelName = (name) => {
  const normalized = normalizeText(name);
  if (!normalized) {
    return '';
  }
  return normalized.startsWith('models/') ? normalized.slice('models/'.length) : normalized;
};

const listGeminiModelCandidates = async (geminiApiKey) => {
  const nowMs = Date.now();
  if (geminiModelCache.names.length && geminiModelCache.expiresAtMs > nowMs) {
    return geminiModelCache.names;
  }

  const response = await axios.get(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiApiKey)}`,
    {
      timeout: 30000,
    }
  );

  const models = Array.isArray(response.data?.models) ? response.data.models : [];
  const scored = models
    .map((model) => {
      const name = normalizeGeminiModelName(model?.name);
      if (!name) {
        return null;
      }

      const methods = Array.isArray(model?.supportedGenerationMethods)
        ? model.supportedGenerationMethods.map((method) => normalizeText(method).toLowerCase())
        : [];
      const supportsGenerateContent = methods.includes('generatecontent');
      if (!supportsGenerateContent) {
        return null;
      }

      const searchableText = [
        name,
        normalizeText(model?.displayName),
        normalizeText(model?.description),
      ]
        .join(' ')
        .toLowerCase();

      let score = 0;
      if (searchableText.includes('image')) score += 50;
      if (searchableText.includes('preview')) score += 10;
      if (searchableText.includes('flash')) score += 5;
      if (searchableText.includes('gemini-2.5')) score += 6;
      if (searchableText.includes('gemini-2.0')) score += 4;

      return {
        name,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const names = scored.map((entry) => entry.name);
  geminiModelCache = {
    names,
    expiresAtMs: nowMs + (10 * 60 * 1000),
  };

  return names;
};

const toInlineDataFromUrl = async (url) => {
  const normalizedUrl = normalizeText(url);
  if (!normalizedUrl) {
    return null;
  }

  const response = await axios.get(normalizedUrl, {
    responseType: 'arraybuffer',
    timeout: 45000,
    maxContentLength: 8 * 1024 * 1024,
    maxBodyLength: 8 * 1024 * 1024,
  });

  const mimeType = normalizeText(response.headers?.['content-type']) || 'image/png';
  const rawBuffer = Buffer.from(response.data);
  const data = rawBuffer.toString('base64');
  const hash = crypto.createHash('sha256').update(rawBuffer).digest('hex');

  return {
    part: {
      inlineData: {
        mimeType,
        data,
      },
    },
    hash,
  };
};

const extractGeminiText = (data) => {
  return (Array.isArray(data?.candidates) ? data.candidates : [])
    .flatMap((candidate) => (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []))
    .map((part) => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
};

const parseGeminiJson = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidateText = fencedMatch ? fencedMatch[1] : text;

  try {
    return JSON.parse(candidateText);
  } catch (error) {
    const fallbackMatch = candidateText.match(/\{[\s\S]*\}/);
    if (!fallbackMatch) {
      return null;
    }

    try {
      return JSON.parse(fallbackMatch[0]);
    } catch (parseError) {
      return null;
    }
  }
};

const buildPastortechSourceContext = (sources = []) =>
  sources
    .slice(0, 10)
    .map((source, index) => {
      const title = normalizeText(source?.title) || `Source ${index + 1}`;
      const sourceType = normalizeText(source?.sourceType) || 'text';
      const summary = normalizeText(source?.summary);
      const content = normalizeText(source?.content);
      const tags = Array.isArray(source?.tags) ? source.tags.map((tag) => normalizeText(tag)).filter(Boolean) : [];
      const excerpt = content ? content.slice(0, 1200) : '';

      return [
        `Title: ${title}`,
        `Type: ${sourceType}`,
        tags.length ? `Tags: ${tags.join(', ')}` : '',
        summary ? `Summary: ${summary}` : '',
        excerpt ? `Excerpt: ${excerpt}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');

const toCompactJsonValue = (value, depth = 0) => {
  if (depth > 3) {
    return '[max-depth]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 400 ? `${value.slice(0, 400)}...` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (error) {
      return String(value);
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => toCompactJsonValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .slice(0, 20)
      .reduce((accumulator, [key, nestedValue]) => {
        accumulator[key] = toCompactJsonValue(nestedValue, depth + 1);
        return accumulator;
      }, {});
  }

  return String(value);
};

const serializeDocSnippet = (docSnapshot) => {
  const rawData = docSnapshot?.data ? docSnapshot.data() : {};
  const compactData = toCompactJsonValue(rawData, 0);
  return {
    id: docSnapshot.id,
    data: compactData,
  };
};

const fetchCollectionDocSnippets = async (collectionRef, maxDocs = 12) => {
  try {
    const snapshot = await collectionRef.limit(maxDocs).get();
    return snapshot.docs.map((docSnapshot) => serializeDocSnippet(docSnapshot));
  } catch (error) {
    return [];
  }
};

const buildPastortechFirestoreContext = async (churchId) => {
  const db = admin.firestore();
  const churchRef = db.collection('churches').doc(churchId);
  const sections = [];

  try {
    const churchSnap = await churchRef.get();
    if (churchSnap.exists) {
      const churchData = toCompactJsonValue(churchSnap.data(), 0);
      sections.push([
        'Section: Organization root document',
        `Path: churches/${churchId}`,
        `Data: ${JSON.stringify(churchData)}`,
      ].join('\n'));
    }
  } catch (error) {
    // Ignore root doc read failure and continue with available context.
  }

  const subcollectionContexts = [];
  try {
    const subcollections = await churchRef.listCollections();
    for (const collectionRef of subcollections.slice(0, 28)) {
      const docs = await fetchCollectionDocSnippets(collectionRef, 14);
      if (!docs.length) {
        continue;
      }

      subcollectionContexts.push([
        `Section: churches/${churchId}/${collectionRef.id}`,
        `Doc count sampled: ${docs.length}`,
        `Docs: ${JSON.stringify(docs)}`,
      ].join('\n'));
    }
  } catch (error) {
    // Ignore subcollection listing failures.
  }

  if (subcollectionContexts.length) {
    sections.push(subcollectionContexts.join('\n\n'));
  }

  const scopedTopLevelCollections = [
    'groups',
    'roles',
    'events',
    'forms',
    'courses',
    'galleries',
    'teams',
    'users',
  ];

  const churchIdFields = ['churchId', 'churchID', 'organizationId', 'idIglesia'];
  const topLevelSections = [];

  for (const collectionName of scopedTopLevelCollections) {
    for (const churchIdField of churchIdFields) {
      try {
        const querySnap = await db
          .collection(collectionName)
          .where(churchIdField, '==', churchId)
          .limit(14)
          .get();

        if (querySnap.empty) {
          continue;
        }

        const docs = querySnap.docs.map((docSnapshot) => serializeDocSnippet(docSnapshot));
        topLevelSections.push([
          `Section: ${collectionName} scoped by ${churchIdField}`,
          `Doc count sampled: ${docs.length}`,
          `Docs: ${JSON.stringify(docs)}`,
        ].join('\n'));

        break;
      } catch (error) {
        // Try the next possible church field.
      }
    }
  }

  if (topLevelSections.length) {
    sections.push(topLevelSections.join('\n\n'));
  }

  const fullContext = sections.join('\n\n---\n\n');
  return fullContext.length > 32000 ? `${fullContext.slice(0, 32000)}\n\n[context truncated]` : fullContext;
};

exports.pastortechAnalyzeSource = functions.runWith({ memory: '512MB', timeoutSeconds: 120 }).https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const authHeader = normalizeText(req.headers.authorization);
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = tokenMatch ? normalizeText(tokenMatch[1]) : '';
      if (!idToken) {
        return res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      }

      try {
        await admin.auth().verifyIdToken(idToken);
      } catch (authError) {
        return res.status(401).json({ error: 'Invalid auth token.' });
      }

      const churchId = normalizeText(req.body?.churchId);
      const title = normalizeText(req.body?.title);
      const sourceType = normalizeText(req.body?.sourceType) || 'text';
      const rawText = normalizeText(req.body?.rawText);
      const notes = normalizeText(req.body?.notes);
      const fileUrl = normalizeText(req.body?.fileUrl);
      const fileName = normalizeText(req.body?.fileName);
      const fileMimeType = normalizeText(req.body?.fileMimeType).toLowerCase();

      if (!churchId) {
        return res.status(400).json({ error: 'Missing `churchId` in request body.' });
      }

      const geminiApiKey = getGeminiApiKey();
      if (!geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured on Firebase.' });
      }

      const prompt = [
        'You are PastorTech, an organization knowledge curator.',
        'Summarize the uploaded church content so it can be searched and used later in a chat assistant.',
        'Return only valid JSON with these keys:',
        '{"summary":"string","title":"string","tags":["string"],"highlights":["string"]}',
        'Rules:',
        '- Keep the summary concise but specific.',
        '- Infer useful tags from the content.',
        '- Preserve names, scripture references, and organization-specific terms.',
        '- If the content is an image or PDF, describe what is visible and any text or key concepts you can identify.',
        '- If the content is already plain text, summarize the substance directly.',
        '',
        `Source title: ${title || fileName || 'Untitled source'}`,
        `Source type: ${sourceType}`,
        notes ? `User notes: ${notes}` : '',
        rawText ? `Raw text:\n${rawText}` : '',
        fileUrl ? `File URL: ${fileUrl}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const inlineParts = [];
      if (fileUrl && [sourceType, fileMimeType].some((value) => ['image', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'pdf', 'application/pdf'].includes(value))) {
        try {
          const inlineData = await toInlineDataFromUrl(fileUrl);
          if (inlineData?.part) {
            inlineParts.push(inlineData.part);
          }
        } catch (error) {
          console.warn('PastorTech source inline fetch failed:', error?.message || error);
        }
      }

      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
          contents: [
            {
              role: 'user',
              parts: [
                ...inlineParts,
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxOutputTokens: 1024,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const rawResponseText = extractGeminiText(geminiResponse.data);
      const parsedResponse = parseGeminiJson(rawResponseText);

      return res.status(200).json({
        summary: normalizeText(parsedResponse?.summary) || rawResponseText,
        title: normalizeText(parsedResponse?.title) || title || fileName || 'Untitled source',
        tags: Array.isArray(parsedResponse?.tags) ? parsedResponse.tags.map((tag) => normalizeText(tag)).filter(Boolean) : [],
        highlights: Array.isArray(parsedResponse?.highlights)
          ? parsedResponse.highlights.map((item) => normalizeText(item)).filter(Boolean)
          : [],
      });
    } catch (error) {
      console.error('pastortechAnalyzeSource error:', error?.response?.data || error.message);
      return res.status(500).json({ error: error.message || 'Unexpected error in pastortechAnalyzeSource.' });
    }
  });
});

exports.pastortechChat = functions.runWith({ memory: '512MB', timeoutSeconds: 120 }).https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const authHeader = normalizeText(req.headers.authorization);
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = tokenMatch ? normalizeText(tokenMatch[1]) : '';
      if (!idToken) {
        return res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      }

      try {
        await admin.auth().verifyIdToken(idToken);
      } catch (authError) {
        return res.status(401).json({ error: 'Invalid auth token.' });
      }

      const churchId = normalizeText(req.body?.churchId);
      const question = normalizeText(req.body?.question);
      const organizationName = normalizeText(req.body?.organizationName) || 'this organization';
      const sources = Array.isArray(req.body?.sources) ? req.body.sources : [];

      if (!churchId) {
        return res.status(400).json({ error: 'Missing `churchId` in request body.' });
      }

      if (!question) {
        return res.status(400).json({ error: 'Missing `question` in request body.' });
      }

      const geminiApiKey = getGeminiApiKey();
      if (!geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured on Firebase.' });
      }

      const sourceContext = buildPastortechSourceContext(sources);
      const firestoreContext = await buildPastortechFirestoreContext(churchId);
      const systemPrompt = [
        `You are PastorTech, a knowledge assistant for ${organizationName}.`,
        'Use ONLY the provided organization sources/context and the user message.',
        'If the context does not contain the answer, say exactly what is missing and ask the user to teach more content.',
        'Be practical, concise, and respectful.',
        'Cite the most relevant source titles inline when possible.',
        'Return markdown only.',
      ].join(' ');

      const userPrompt = [
        `Organization: ${organizationName}`,
        sourceContext ? `Knowledge base context:\n${sourceContext}` : 'Knowledge base context: no sources have been taught yet.',
        firestoreContext ? `Firestore organization data context:\n${firestoreContext}` : 'Firestore organization data context: unavailable.',
        `User question: ${question}`,
      ].join('\n\n');

      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
          contents: [
            {
              role: 'user',
              parts: [
                { text: `${systemPrompt}\n\n${userPrompt}` },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.25,
            topP: 0.9,
            maxOutputTokens: 1800,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const answer = extractGeminiText(geminiResponse.data);
      if (!answer) {
        return res.status(502).json({ error: 'Gemini returned no response text.' });
      }

      return res.status(200).json({ answer });
    } catch (error) {
      console.error('pastortechChat error:', error?.response?.data || error.message);
      return res.status(500).json({ error: error.message || 'Unexpected error in pastortechChat.' });
    }
  });
});


const corsHandler = cors({origin: true});

exports.sendNotification = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    console.log("🔵 Received request at sendNotification");

    if (req.method !== "POST") {
      console.log("❌ Invalid request method:", req.method);
      return res.status(405).send({error: "Only POST method allowed"});
    }

    try {
      const {tokens, title, body, data} = req.body;
      console.log("🔹 Payload received:", {tokens, title, body, data});

      if (!tokens || tokens.length === 0) {
        return res.status(400).json(
            {success: false, error: "No tokens provided"},
        );
      }

      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      console.log("✅ Notification sent successfully:", response);
      res.status(200).json({success: true, response});
    } catch (error) {
      console.error("❌ Error sending notification:", error);
      res.status(500).json({success: false, error: error.message});
    }
  });
});

exports.manageUserAccount = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST method allowed" });
    }

    try {
      const authHeader = req.headers.authorization || "";
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = tokenMatch ? tokenMatch[1] : null;

      if (!idToken) {
        return res.status(401).json({ error: "Missing Authorization Bearer token" });
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const callerUid = decodedToken.uid;

      const callerSnap = await admin.firestore().doc(`users/${callerUid}`).get();
      if (!callerSnap.exists) {
        return res.status(403).json({ error: "Caller profile not found" });
      }

      const callerData = callerSnap.data() || {};
      const callerRole = String(callerData.role || "").trim().toLowerCase();
      const callerChurchId = String(
        callerData.churchId
        || callerData.churchID
        || callerData.organizationId
        || ""
      ).trim();

      const { action, targetUserId, churchId } = req.body || {};
      const normalizedAction = String(action || "").trim().toLowerCase();
      const normalizedTargetUserId = String(targetUserId || "").trim();
      const normalizedChurchId = String(churchId || "").trim();

      if (!normalizedTargetUserId || !["disable", "enable", "delete"].includes(normalizedAction)) {
        return res.status(400).json({ error: "Invalid action or targetUserId" });
      }

      if (normalizedTargetUserId === callerUid) {
        return res.status(400).json({ error: "You cannot modify your own account" });
      }

      const isGlobalAdmin = callerRole === "global_admin";
      const isAdmin = callerRole === "admin";
      const canManage = isGlobalAdmin || isAdmin;

      if (!canManage) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const targetUserSnap = await admin.firestore().doc(`users/${normalizedTargetUserId}`).get();
      const targetUserData = targetUserSnap.exists ? (targetUserSnap.data() || {}) : {};
      const targetChurchId = String(
        targetUserData.churchId
        || targetUserData.churchID
        || targetUserData.organizationId
        || normalizedChurchId
        || ""
      ).trim();

      if (!isGlobalAdmin) {
        if (!callerChurchId || !targetChurchId || callerChurchId !== targetChurchId) {
          return res.status(403).json({ error: "Admins can only manage users in their organization" });
        }
      }

      if (normalizedAction === "delete" && !isGlobalAdmin) {
        return res.status(403).json({ error: "Only global admins can delete users" });
      }

      let authUserMissing = false;

      if (normalizedAction === "disable") {
        try {
          await admin.auth().updateUser(normalizedTargetUserId, { disabled: true });
        } catch (authError) {
          if (authError?.code === "auth/user-not-found") {
            return res.status(404).json({ error: "Target Auth user not found" });
          }
          throw authError;
        }
      }

      if (normalizedAction === "enable") {
        try {
          await admin.auth().updateUser(normalizedTargetUserId, { disabled: false });
        } catch (authError) {
          if (authError?.code === "auth/user-not-found") {
            return res.status(404).json({ error: "Target Auth user not found" });
          }
          throw authError;
        }
      }

      if (normalizedAction === "delete") {
        try {
          await admin.auth().deleteUser(normalizedTargetUserId);
        } catch (authError) {
          // Treat delete as idempotent when Auth record is already gone.
          if (authError?.code === "auth/user-not-found") {
            authUserMissing = true;
          } else {
            throw authError;
          }
        }

        // Remove corresponding Firestore profile if present.
        await admin.firestore().doc(`users/${normalizedTargetUserId}`).delete().catch(() => {});
      }

      await admin.firestore().collection("userAccountAuditLogs").add({
        action: normalizedAction,
        actorUid: callerUid,
        actorRole: callerRole || null,
        actorChurchId: callerChurchId || null,
        targetUserId: normalizedTargetUserId,
        targetEmail: targetUserData.email || null,
        targetName: `${targetUserData.name || ""} ${targetUserData.lastName || ""}`.trim() || null,
        targetChurchId: targetChurchId || null,
        requestedChurchId: normalizedChurchId || null,
        sourceIp: req.headers["x-forwarded-for"] || req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({
        success: true,
        action: normalizedAction,
        targetUserId: normalizedTargetUserId,
        authUserMissing,
      });
    } catch (error) {
      console.error("manageUserAccount error:", error);
      return res.status(500).json({ error: error.message || "Internal error" });
    }
  });
});

exports.hydrateUsersFromAuth = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST method allowed" });
    }

    try {
      const authHeader = req.headers.authorization || "";
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = tokenMatch ? tokenMatch[1] : null;

      if (!idToken) {
        return res.status(401).json({ error: "Missing Authorization Bearer token" });
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const callerUid = decodedToken.uid;

      const callerSnap = await admin.firestore().doc(`users/${callerUid}`).get();
      if (!callerSnap.exists) {
        return res.status(403).json({ error: "Caller profile not found" });
      }

      const callerData = callerSnap.data() || {};
      const callerRole = String(callerData.role || "").trim().toLowerCase();
      const callerChurchId = String(
        callerData.churchId
        || callerData.churchID
        || callerData.organizationId
        || ""
      ).trim();

      if (!["global_admin", "admin"].includes(callerRole)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const { churchId, userIds } = req.body || {};
      const normalizedChurchId = String(churchId || "").trim();
      const normalizedUserIds = Array.isArray(userIds)
        ? userIds.map((uid) => String(uid || "").trim()).filter(Boolean)
        : [];

      if (!normalizedChurchId) {
        return res.status(400).json({ error: "Missing churchId" });
      }

      if (normalizedUserIds.length === 0) {
        return res.status(200).json({ success: true, updated: [], skipped: [] });
      }

      if (callerRole !== "global_admin" && callerChurchId !== normalizedChurchId) {
        return res.status(403).json({ error: "Admins can only hydrate users in their organization" });
      }

      const updated = [];
      const skipped = [];

      for (const targetUid of normalizedUserIds) {
        try {
          const userRef = admin.firestore().doc(`users/${targetUid}`);
          const userSnap = await userRef.get();
          if (!userSnap.exists) {
            skipped.push({ userId: targetUid, reason: "user-profile-not-found" });
            continue;
          }

          const userData = userSnap.data() || {};
          const targetChurchId = String(
            userData.churchId
            || userData.churchID
            || userData.organizationId
            || ""
          ).trim();

          if (targetChurchId !== normalizedChurchId) {
            skipped.push({ userId: targetUid, reason: "outside-organization" });
            continue;
          }

          const firestoreEmail = String(userData.email || "").trim();
          if (firestoreEmail) {
            skipped.push({ userId: targetUid, reason: "email-already-present" });
            continue;
          }

          let authUser;
          try {
            authUser = await admin.auth().getUser(targetUid);
          } catch (authError) {
            if (authError?.code === "auth/user-not-found") {
              skipped.push({ userId: targetUid, reason: "auth-user-not-found" });
              continue;
            }
            throw authError;
          }

          const authEmail = String(authUser.email || "").trim();
          if (!authEmail) {
            skipped.push({ userId: targetUid, reason: "auth-email-empty" });
            continue;
          }

          await userRef.set(
            {
              email: authEmail,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          updated.push({ userId: targetUid, email: authEmail });
        } catch (itemError) {
          skipped.push({ userId: targetUid, reason: itemError.message || "unknown-error" });
        }
      }

      return res.status(200).json({
        success: true,
        updated,
        skipped,
      });
    } catch (error) {
      console.error("hydrateUsersFromAuth error:", error);
      return res.status(500).json({ error: error.message || "Internal error" });
    }
  });
});

exports.sendSMS = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const { to, message, churchId, senderId, memberName, visitorId, visitorName, messageId, clientMessageId } = req.body;

      if (!to || !message) {
        return res.status(400).json({
          error: "Missing required parameters"
        });
      }

      console.log("Sending SMS message:", {
        to,
        message: message.substring(0, 30) + (message.length > 30 ? "..." : ""),
        churchId,
        senderId,
        visitorId: visitorId || "none",
        messageId: messageId || clientMessageId || "none"
      });

      // Send SMS via Twilio
      const client = getTwilioClient();
      if (!client) {
        return res.status(500).json({
          success: false,
          error: 'Twilio is not configured'
        });
      }
      const result = await client.messages.create({
        to,
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER || functions.config().twilio?.phone_number
      });

      console.log("SMS sent successfully, Twilio SID:", result.sid);

      // Prepare the base message data
      const messageData = {
        to,
        message,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        sentBy: senderId,
        status: 'sent',
        twilioMessageId: result.sid,
        twilioSid: result.sid,
        direction: 'outbound'
      };

      // If this is a visitor message
      if (visitorId) {
        console.log(`Saving visitor message to churches/${churchId}/visitorMessages for visitor ${visitorId}`);
        
        // Add visitor-specific fields
        const visitorMessageData = {
          ...messageData,
          visitorId,
          visitorName: visitorName || "Visitor",
          senderName: memberName || "Church Admin"
        };
        
        // Determine which document to update or create
        let messageDocRef;
        if (messageId) {
          messageDocRef = admin.firestore().doc(`churches/${churchId}/visitorMessages/${messageId}`);
          await messageDocRef.update({
            ...visitorMessageData,
            status: 'sent',
            twilioMessageId: result.sid
          });
        } else {
          messageDocRef = await admin.firestore().collection(`churches/${churchId}/visitorMessages`).add(visitorMessageData);
        }
        
        console.log(`Visitor message saved with ID: ${messageDocRef.id}`);
      } 
      // If this is a member message
      else {
        console.log(`Saving member message to churches/${churchId}/messages`);
        
        // Add member-specific fields
        const memberMessageData = {
          ...messageData,
          memberName: memberName || "Member",
          memberId: req.body.memberId
        };
        
        // Save to the general messages collection
        await admin.firestore().collection(`churches/${churchId}/messages`).add(memberMessageData);
      }

      // Also save to the global messages collection for tracking
      await admin.firestore().collection('messages').add({
        ...messageData,
        churchId,
        memberId: req.body.memberId,
        visitorId: visitorId,
        visitorName: visitorName,
        memberName: memberName,
        clientMessageId: clientMessageId
      });

      res.status(200).json({
        success: true,
        messageId: result.sid
      });
    } catch (error) {
      console.error('Error sending SMS:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// Add a Twilio webhook endpoint to handle SMS responses
exports.smsWebhook = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    console.log("📩 Received SMS webhook request:", req.body);
    
    try {
      // Extract the message data from the Twilio webhook
      const {
        From: from,
        To: to,
        Body: body,
        MessageSid: sid,
        SmsSid: smsSid
      } = req.body;
      
      if (!from || !body) {
        console.error("Missing required webhook parameters");
        return res.status(400).send('Missing parameters');
      }
      
      console.log(`Received SMS response from ${from} with content: ${body}`);
      
      // Format the from phone number consistently 
      const formattedPhone = from.startsWith('+') ? from : `+1${from.replace(/\D/g, '')}`;
      
      // Look up which church this belongs to
      let churchId = null;
      let memberId = null;
      let visitorId = null;
      
      // First, check in the church messages collection
      const churchesRef = admin.firestore().collection('churches');
      const churchesSnapshot = await churchesRef.get();
      
      // Search through all churches for matching phone number
      for (const churchDoc of churchesSnapshot.docs) {
        const currentChurchId = churchDoc.id;
        
        // Check members first
        const membersRef = admin.firestore().collection('users');
        const memberSnapshot = await membersRef
          .where('phone', '==', formattedPhone.replace(/^\+1/, ''))
          .where('churchId', '==', currentChurchId)
          .limit(1)
          .get();
        
        if (!memberSnapshot.empty) {
          memberId = memberSnapshot.docs[0].id;
          churchId = currentChurchId;
          console.log(`Found member: ${memberId}, church: ${churchId}`);
          break;
        }
        
        // Then check visitors
        const visitorsRef = admin.firestore().collection(`visitors/${currentChurchId}/visitors`);
        const visitorSnapshot = await visitorsRef
          .where('phone', '==', formattedPhone.replace(/^\+1/, ''))
          .limit(1)
          .get();
        
        if (!visitorSnapshot.empty) {
          visitorId = visitorSnapshot.docs[0].id;
          churchId = currentChurchId;
          console.log(`Found visitor: ${visitorId}, church: ${churchId}`);
          break;
        }
      }
      
      // Fallback: check previous messages
      if (!churchId) {
        const messagesRef = admin.firestore().collection('messages');
        const messagesSnapshot = await messagesRef
          .where('to', '==', formattedPhone)
          .orderBy('timestamp', 'desc')
          .limit(1)
          .get();
        
        if (!messagesSnapshot.empty) {
          const recentMessage = messagesSnapshot.docs[0].data();
          churchId = recentMessage.churchId;
          memberId = recentMessage.memberId;
          visitorId = recentMessage.visitorId;
          console.log(`Matched response to previous message: church: ${churchId}, member: ${memberId}, visitor: ${visitorId}`);
        }
      }
      
      if (!churchId) {
        console.log("Could not determine church for this message. Storing in general collection only.");
      }
      
      // Store the message in Firestore
      const messageData = {
        from: formattedPhone,
        to,
        message: body,
        direction: 'inbound',
        status: 'received',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        twilioSid: sid || smsSid,
        isRead: false // Mark as unread for admin
      };
      
      if (churchId) {
        messageData.churchId = churchId;
      }
      
      if (memberId) {
        messageData.memberId = memberId;
        messageData.senderId = memberId; // Mark the sender as the member
      }
      
      if (visitorId) {
        messageData.visitorId = visitorId;
        messageData.senderId = visitorId; // Mark the sender as the visitor
      }
      
      // Store in main messages collection
      const messageRef = await admin.firestore().collection('messages').add(messageData);
      console.log("Stored inbound message in messages collection with ID:", messageRef.id);
      
      // If we have a churchId, also store in church subcollection and update unread counters
      if (churchId) {
        // Store the message in the appropriate collection
        if (memberId) {
          // For members, store in the church messages collection
          await admin.firestore()
            .collection(`churches/${churchId}/messages`)
            .add(messageData);
          console.log(`Stored member message in churches/${churchId}/messages`);
          
          // Also store in the user's messages subcollection
          await admin.firestore()
            .collection(`users/${memberId}/messages`)
            .add(messageData);
          console.log(`Stored message in users/${memberId}/messages`);
          
          // Update the unread counter for members
          const unreadMembersRef = admin.firestore()
            .doc(`churches/${churchId}/adminConnect/members`);
          
          try {
            // Use a transaction to atomically update the counter
            await admin.firestore().runTransaction(async (transaction) => {
              const unreadDoc = await transaction.get(unreadMembersRef);
              const unreadData = unreadDoc.exists ? unreadDoc.data() : {};
              
              // Increment the counter for this member
              const currentCount = unreadData[memberId] || 0;
              unreadData[memberId] = currentCount + 1;
              
              if (unreadDoc.exists) {
                transaction.update(unreadMembersRef, unreadData);
              } else {
                transaction.set(unreadMembersRef, unreadData);
              }
            });
            
            console.log(`Updated unread counter for member ${memberId}`);
          } catch (error) {
            console.error("Error updating member unread counter:", error);
          }
        } else if (visitorId) {
          // For visitors, store in the visitorMessages collection
          await admin.firestore()
            .collection(`churches/${churchId}/visitorMessages`)
            .add(messageData);
          console.log(`Stored visitor message in churches/${churchId}/visitorMessages`);
          
          // Update the unread counter specifically for visitor messages
          try {
            // First, get all unread messages for this visitor
            const visitorMsgsRef = admin.firestore()
              .collection(`churches/${churchId}/visitorMessages`);
            
            const unreadMsgsQuery = query(
              visitorMsgsRef,
              where('visitorId', '==', visitorId),
              where('isRead', '==', false)
            );
            
            const unreadSnap = await admin.firestore().getCountFromServer(unreadMsgsQuery);
            const unreadCount = unreadSnap.data().count;
            
            // Store the count in the visitors unread counter map
            const visitorsUnreadRef = admin.firestore()
              .doc(`churches/${churchId}/adminConnect/visitors`);
            
            await admin.firestore().runTransaction(async (transaction) => {
              const visitorsDoc = await transaction.get(visitorsUnreadRef);
              const visitorsData = visitorsDoc.exists ? visitorsDoc.data() : {};
              
              visitorsData[visitorId] = unreadCount;
              
              if (visitorsDoc.exists) {
                transaction.update(visitorsUnreadRef, visitorsData);
              } else {
                transaction.set(visitorsUnreadRef, visitorsData);
              }
            });
            
            console.log(`Updated unread counter for visitor ${visitorId} to ${unreadCount}`);
          } catch (error) {
            console.error("Error updating visitor unread counter:", error);
          }
        } else {
          // If we don't know the source, store in general messages collection
          await admin.firestore()
            .collection(`churches/${churchId}/messages`)
            .add(messageData);
          console.log(`Stored message from unknown source in churches/${churchId}/messages`);
        }
      }
      
      // Return a TwiML response (Twilio expects this)
      res.set('Content-Type', 'text/xml');
      res.send(`
        <Response>
        </Response>
      `);
    } catch (error) {
      console.error("Error processing SMS webhook:", error);
      res.status(500).send('Error processing request');
    }
  });
});

// Add a function to check Twilio directly for messages
exports.checkTwilioMessages = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    console.log("📱 Checking Twilio for messages");
    
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    
    try {
      const { phoneNumber, churchId, memberId, visitorId } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: "Missing phone number"
        });
      }
      
      // Format phone number for Twilio (add +1 for US numbers if needed)
      const formattedPhone = phoneNumber.startsWith('+') ? 
        phoneNumber : 
        `+1${phoneNumber.replace(/\D/g, '')}`;
        
      console.log(`Checking messages for phone: ${formattedPhone}, churchId: ${churchId}, memberId: ${memberId || 'none'}, visitorId: ${visitorId || 'none'}`);
      
      // Get messages from Twilio API
      const client = getTwilioClient();
      if (!client) {
        return res.status(500).json({
          success: false,
          error: 'Twilio is not configured'
        });
      }
      const messages = await client.messages.list({
        // Look for messages sent to or from this number in the last 7 days
        to: formattedPhone,
        limit: 20
      });
      
      // Also get messages sent from this number
      const inboundMessages = await client.messages.list({
        from: formattedPhone,
        limit: 20
      });
      
      // Combine and filter messages
      const allMessages = [...messages, ...inboundMessages];
      
      // Remove duplicates (same SID)
      const uniqueMessages = [];
      const seenSids = new Set();
      
      allMessages.forEach(message => {
        if (!seenSids.has(message.sid)) {
          seenSids.add(message.sid);
          uniqueMessages.push({
            sid: message.sid,
            body: message.body,
            from: message.from,
            to: message.to,
            direction: message.direction,
            status: message.status,
            dateSent: message.dateSent
          });
        }
      });
      
      console.log(`Found ${uniqueMessages.length} messages for ${formattedPhone}`);
      
      // Store these messages in Firestore if they're not already there
      const messagesRef = admin.firestore().collection('messages');
      const messagesSnapshot = await messagesRef
        .where('twilioSid', 'in', uniqueMessages.slice(0, 10).map(m => m.sid))
        .get();
      
      // Find which messages are already in the database
      const existingSids = new Set();
      messagesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.twilioSid) {
          existingSids.add(data.twilioSid);
        }
      });
      
      // Store any new messages
      const batch = admin.firestore().batch();
      let newMessageCount = 0;
      
      for (const message of uniqueMessages) {
        // Skip if already in database
        if (existingSids.has(message.sid)) continue;
        
        // Determine if this is inbound or outbound relative to the user
        const isInbound = message.from === formattedPhone;
        
        // Create the base message data
        const baseMessageData = {
          from: message.from,
          to: message.to,
          body: message.body,
          message: message.body,
          twilioSid: message.sid,
          twilioMessageId: message.sid,
          direction: isInbound ? 'inbound' : 'outbound',
          status: message.status,
          timestamp: admin.firestore.Timestamp.fromDate(new Date(message.dateSent)),
          sentAt: admin.firestore.Timestamp.fromDate(new Date(message.dateSent)),
          churchId: churchId,
          source: 'twilio-api'
        };
        
        // Add message to the main messages collection
        const newMessageRef = messagesRef.doc();
        batch.set(newMessageRef, baseMessageData);
        
        // Also store in appropriate subcollection based on whether this is for a visitor or a member
        if (visitorId) {
          // For visitors, add to visitorMessages collection
          const visitorData = {
            ...baseMessageData,
            visitorId: visitorId
          };
          
          const visitorMessageRef = admin.firestore()
            .collection(`churches/${churchId}/visitorMessages`)
            .doc();
            
          batch.set(visitorMessageRef, visitorData);
        } else if (memberId) {
          // For members, add to members collection
          const memberData = {
            ...baseMessageData,
            memberId: memberId
          };
          
          const memberMessageRef = admin.firestore()
            .collection(`churches/${churchId}/messages`)
            .doc();
            
          batch.set(memberMessageRef, memberData);
        }
        
        newMessageCount++;
      }
      
      // Commit the batch if there are new messages
      if (newMessageCount > 0) {
        await batch.commit();
        console.log(`Added ${newMessageCount} new messages to database`);
      }
      
      // Return all messages to the client
      res.status(200).json({
        success: true,
        messages: uniqueMessages
      });
    } catch (error) {
      console.error("Error checking Twilio messages:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// Create a Stripe payment intent for processing payments
exports.createPaymentIntent = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  try {
    const { amount, churchId, currency = 'usd', description, metadata = {} } = req.body;
    
    if (!amount || !churchId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: amount and churchId"
      });
    }
    
    console.log(`Creating payment intent for church: ${churchId}, amount: ${amount}`);
    
    // Get church payment configuration from Firestore (if needed)
    admin.firestore().collection('churches').doc(churchId).get()
      .then(async (churchDoc) => {
        if (!churchDoc.exists) {
          return res.status(404).json({
            success: false,
            error: "Church not found"
          });
        }
        
        const churchData = churchDoc.data();
        
        // Create a payment intent with Stripe
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(parseFloat(amount)), // Stripe requires integer in smallest currency unit (cents)
          currency: currency,
          metadata: {
            churchId,
            type: metadata.type || 'balance_recharge',
            ...metadata
          },
          description: description || `Payment for ${churchData.name || 'Church'}`,
          // Add automatic payment methods to make it work with modern Stripe integrations
          automatic_payment_methods: {
            enabled: true,
          },
        });
        
        // Log the payment intent creation in Firestore for tracking
        await admin.firestore().collection(`churches/${churchId}/paymentIntents`).add({
          paymentIntentId: paymentIntent.id,
          amount: amount,
          status: paymentIntent.status,
          created: admin.firestore.FieldValue.serverTimestamp(),
          metadata: paymentIntent.metadata
        });
        
        console.log(`Created payment intent: ${paymentIntent.id} for $${amount/100}`);
        
        // Return the client secret to the client
        res.status(200).json({
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        });
      })
      .catch(error => {
        console.error("Error creating payment intent:", error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Confirm a payment and update the church balance
exports.confirmPayment = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  try {
    const { paymentIntentId, churchId } = req.body;
    
    if (!paymentIntentId || !churchId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: paymentIntentId and churchId"
      });
    }
    
    console.log(`Confirming payment: ${paymentIntentId} for church: ${churchId}`);
    
    // Retrieve the payment intent from Stripe to verify its status
    stripe.paymentIntents.retrieve(paymentIntentId)
      .then(async (paymentIntent) => {
        if (paymentIntent.status !== 'succeeded') {
          console.error(`Payment ${paymentIntentId} has not succeeded. Status: ${paymentIntent.status}`);
          return res.status(400).json({
            success: false,
            error: `Payment has not succeeded. Current status: ${paymentIntent.status}`
          });
        }
        
        // Verify the payment is for this church
        if (paymentIntent.metadata.churchId !== churchId) {
          console.error(`Payment ${paymentIntentId} does not belong to church ${churchId}`);
          return res.status(403).json({
            success: false,
            error: "Payment does not belong to this church"
          });
        }
        
        // Get the church document
        const churchRef = admin.firestore().collection('churches').doc(churchId);
        const churchDoc = await churchRef.get();
        
        if (!churchDoc.exists) {
          return res.status(404).json({
            success: false,
            error: "Church not found"
          });
        }
        
        // Update the church balance
        const amount = paymentIntent.amount / 100; // Convert from cents to dollars
        const currentBalance = churchDoc.data().balance || 0;
        const newBalance = currentBalance + amount;
        
        // Update the payment intent record in Firestore for tracking
        const paymentIntentsRef = admin.firestore().collection(`churches/${churchId}/paymentIntents`);
        const paymentIntentQuery = await paymentIntentsRef
          .where('paymentIntentId', '==', paymentIntentId)
          .limit(1)
          .get();
        
        if (!paymentIntentQuery.empty) {
          await paymentIntentQuery.docs[0].ref.update({
            status: paymentIntent.status,
            updated: admin.firestore.FieldValue.serverTimestamp(),
            balanceUpdated: true
          });
        }
        
        // Update the church balance in a transaction to ensure consistency
        await admin.firestore().runTransaction(async (transaction) => {
          // Get the church document again in the transaction
          const churchDocInTx = await transaction.get(churchRef);
          
          if (!churchDocInTx.exists) {
            throw new Error("Church document not found in transaction");
          }
          
          const currentBalanceInTx = churchDocInTx.data().balance || 0;
          const newBalanceInTx = currentBalanceInTx + amount;
          
          // Update the balance
          transaction.update(churchRef, { 
            balance: newBalanceInTx,
            lastBalanceUpdate: admin.firestore.FieldValue.serverTimestamp()
          });
          
          // Add a balance history record
          const historyRef = admin.firestore().collection(`churches/${churchId}/balanceHistory`).doc();
          transaction.set(historyRef, {
            amount: amount,
            type: 'credit',
            source: 'payment',
            paymentIntentId: paymentIntentId,
            balanceBefore: currentBalanceInTx,
            balanceAfter: newBalanceInTx,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            description: `Payment processed via Stripe`
          });
        });
        
        console.log(`Updated balance for church ${churchId} by +$${amount}`);
        
        // Return success
        res.status(200).json({
          success: true,
          newBalance: newBalance
        });
      })
      .catch(error => {
        console.error("Error confirming payment:", error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      });
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a function to get SMS responses for a specific phone number
exports.getSMSResponses = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  try {
    const { phone, churchId, visitorId } = req.query;
    
    if (!phone || !churchId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: phone and churchId"
      });
    }
    
    console.log(`Fetching SMS responses for phone: ${phone}, church: ${churchId}, visitor: ${visitorId || 'unknown'}`);
    
    // Format phone number consistently (ensure it has +1 for US numbers)
    const formattedPhone = phone.startsWith('+') ? 
      phone : 
      `+1${phone.replace(/\D/g, '')}`;
    
    // Get recent messages from Twilio API
    const twilioMessages = twilioClient.messages.list({
      // Look for messages to or from this number
      to: formattedPhone,
      limit: 20
    });
    
    // Also get messages sent from this number
    const inboundMessages = twilioClient.messages.list({
      from: formattedPhone,
      limit: 20
    });
    
    // Execute both promises in parallel
    Promise.all([twilioMessages, inboundMessages])
      .then(async ([toMessages, fromMessages]) => {
        // Combine and filter messages
        const allMessages = [...toMessages, ...fromMessages];
        
        // Remove duplicates (same SID)
        const uniqueMessages = [];
        const seenSids = new Set();
        
        allMessages.forEach(message => {
          if (!seenSids.has(message.sid)) {
            seenSids.add(message.sid);
            uniqueMessages.push({
              sid: message.sid,
              body: message.body,
              from: message.from,
              to: message.to,
              direction: message.direction,
              status: message.status,
              dateSent: message.dateSent
            });
          }
        });
        
        console.log(`Found ${uniqueMessages.length} messages for ${formattedPhone}`);
        
        // Check for existing messages to avoid duplicates
        const messagesRef = admin.firestore().collection('messages');
        const existingSidsQuery = await messagesRef
          .where('twilioSid', 'in', uniqueMessages.slice(0, 10).map(m => m.sid))
          .get();
        
        const existingSids = new Set();
        existingSidsQuery.forEach(doc => {
          const data = doc.data();
          if (data.twilioSid) {
            existingSids.add(data.twilioSid);
          }
        });
        
        // Store any new messages
        const batch = admin.firestore().batch();
        let newMessageCount = 0;
        
        // Process new messages
        for (const message of uniqueMessages) {
          // Skip if already in database
          if (existingSids.has(message.sid)) continue;
          
          // Determine if this is inbound or outbound relative to the user
          const isInbound = message.from === formattedPhone;
          
          // Create message data structure
          const messageData = {
            from: message.from,
            to: message.to,
            message: message.body,
            body: message.body,
            twilioSid: message.sid,
            direction: isInbound ? 'inbound' : 'outbound',
            status: message.status,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            timestamp: admin.firestore.Timestamp.fromDate(new Date(message.dateSent)),
            isRead: false,
            churchId: churchId
          };
          
          // Add the visitorId if provided
          if (visitorId) {
            messageData.visitorId = visitorId;
            messageData.senderId = isInbound ? visitorId : 'admin';
          }
          
          // Store in main messages collection
          const newMessageRef = messagesRef.doc();
          batch.set(newMessageRef, messageData);
          
          // Store in visitor messages collection if visitorId is provided
          if (visitorId) {
            const visitorMessageRef = admin.firestore()
              .collection(`churches/${churchId}/visitorMessages`)
              .doc();
              
            batch.set(visitorMessageRef, messageData);
          }
          
          newMessageCount++;
        }
        
        // Commit the batch if there are new messages
        if (newMessageCount > 0) {
          await batch.commit();
          console.log(`Added ${newMessageCount} new messages to database`);
        }
        
        // Return the messages to the client
        res.status(200).json({
          success: true,
          messages: uniqueMessages,
          newMessages: newMessageCount
        });
      })
      .catch(error => {
        console.error("Error fetching Twilio messages:", error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      });
  } catch (error) {
    console.error("Error in getSMSResponses:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Analyze leadership potential using OpenAI
 */
exports.analyzeLeadership = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const { data, prompt } = req.body;
      
      if (!data || !prompt) {
        return res.status(400).json({ error: 'Missing required data or prompt in request body' });
      }
      
      // Get OpenAI API key from environment variables
      const openAIApiKey = functions.config().openai?.apikey || process.env.OPENAI_API_KEY;
      
      if (!openAIApiKey) {
        console.error('OpenAI API key not configured');
        return res.status(500).json({ 
          error: 'OpenAI API key not configured',
          fallback: true,
          potentialLeaders: generateSimulatedLeadershipData(data)
        });
      }
      
      // Call OpenAI API
      try {
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4-turbo',
            messages: [
              { 
                role: 'system', 
                content: 'You are an AI assistant that analyzes church data to identify potential leaders. Respond with valid JSON only.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 2048,
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        // Parse JSON response from OpenAI
        const content = openaiResponse.data.choices[0].message.content;
        const parsedContent = JSON.parse(content);
        
        // Add analysis metadata
        const analysisResult = {
          ...parsedContent,
          analysisDate: new Date().toISOString(),
          source: 'openai'
        };
        
        // Store the analysis in Firestore for future reference
        if (data.churchId) {
          const db = admin.firestore();
          await db.collection('churches').doc(data.churchId).collection('leadershipAnalyses').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            data: analysisResult
          });
        }
        
        return res.status(200).json(analysisResult);
      } catch (openAIError) {
        console.error('OpenAI API Error:', openAIError);
        return res.status(200).json({
          potentialLeaders: generateSimulatedLeadershipData(data),
          analysisDate: new Date().toISOString(),
          source: 'simulation',
          error: 'Used fallback data due to OpenAI API error'
        });
      }
    } catch (error) {
      console.error('Server Error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

/**
 * Analyze form entries using OpenAI for pastoral insights
 */
exports.analyzeFormEntries = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const { formTitle, fields, entries, pastoralContext, previousAnalysis } = req.body;
      
      if (!formTitle || !fields || !entries) {
        return res.status(400).json({ error: 'Missing required form data in request body' });
      }
      
      // Get OpenAI API key from environment variables
      const openAIApiKey = functions.config().openai?.apikey || process.env.OPENAI_API_KEY;
      
      if (!openAIApiKey) {
        console.error('OpenAI API key not configured');
        return res.status(500).json({ 
          error: 'OpenAI API key not configured'
        });
      }

      // Format entries for AI analysis
      const formattedEntries = entries.map(entry => {
        const formattedEntry = {};
        fields.forEach(field => {
          formattedEntry[field.label] = entry[field.name];
        });
        return formattedEntry;
      });

      // Build context section if provided
      let contextSection = '';
      if (pastoralContext && pastoralContext.specificQuestions) {
        contextSection = `

PASTOR'S SPECIFIC QUESTIONS TO ADDRESS:
${pastoralContext.specificQuestions}

IMPORTANT: Make sure to directly address these questions in your analysis, providing clear answers and insights.
`;
      }

      // Build comparison section if previous analysis exists
      let comparisonSection = '';
      if (previousAnalysis && previousAnalysis.healthMetrics) {
        comparisonSection = `

PREVIOUS ANALYSIS (for comparison):
Date: ${previousAnalysis.createdAt || 'Unknown'}
Overall Health Score: ${previousAnalysis.healthMetrics.overall}
Previous Metrics: ${JSON.stringify(previousAnalysis.healthMetrics)}

IMPORTANT: Compare current responses with previous analysis to identify:
- Improvements (what's getting better)
- Regressions (what's declining)
- Trends (patterns over time)
- Progress toward stated goals
`;
      }

  const prompt = `You are an expert church consultant advising a senior pastor who is deeply committed to leadership development, building a healthy church, creating a long-lasting legacy, and ensuring the best outcomes for their congregation.

Your goal is to help the pastor CLEARLY UNDERSTAND what their people are saying and what improvements are needed.

Adopt a tone of excellence and servanthood: be clear, honoring, and action-oriented. Emphasize doing our best with humility and accountability.

Analyze the following form data collected from their church: "${formTitle}"
${contextSection}
${comparisonSection}

FORM CONTEXT - These are the actual questions this form asks:
${fields.map(f => `- ${f.label} (${f.type})`).join('\n')}

Based on these questions, interpret responses in the proper context. For example:
- If asking about satisfaction, provide insights on satisfaction levels
- If asking about interests, identify patterns in what people want
- If asking about needs, prioritize unmet needs
- If asking for feedback, categorize and prioritize suggestions

Responses (${entries.length} total):
${JSON.stringify(formattedEntries, null, 2)}

ANALYSIS REQUIREMENTS:
1. INTERPRET THE DATA: Explain what the responses mean in context of the form questions
2. Use DIRECT QUOTES from responses to show what people actually said
3. Identify common themes and sentiments (positive, negative, concerned, hopeful)
4. Highlight specific improvements needed based on actual feedback
5. Connect insights to the pastor's stated concerns and goals
6. Provide SPECIFIC NEXT STEPS for individual respondents based on their answers
7. Give PASTORAL AND APOSTOLIC GUIDANCE specific to this form's purpose:
   - Pastoral (care/shepherding): How to care for and support these people
   - Apostolic (mission/vision): How to mobilize and empower them toward church mission
8. Answer the pastor's specific questions directly with clear, evidence-based answers
9. If comparing to previous analysis, explicitly state what changed with numeric deltas
10. Include numbers that reflect growth or decline in key areas and explain why
11. Be specific and actionable - avoid generic advice
12. Maintain an attitude of excellence and servanthood throughout

Please provide a comprehensive analysis in the following JSON format:
{
  "executiveSummary": "Brief 2-3 sentence overview of key findings addressing pastor's concerns and interpreting what the data reveals",
  "dataInterpretation": {
    "whatTheDataTells": "Clear explanation of what these responses mean in context of the form questions",
    "underlyingPatterns": ["Hidden patterns or trends not immediately obvious"],
    "surprisingFindings": ["Unexpected insights that need attention"]
  },
  "whatPeopleAreSaying": {
    "positiveThemes": ["Theme with quote: 'actual quote'"],
    "concernsRaised": ["Concern with quote: 'actual quote'"],
    "commonRequests": ["Request with quote: 'actual quote'"],
    "emotionalTone": "overall sentiment (hopeful, concerned, frustrated, etc.)"
  },
  "improvementsNeeded": [
    {
      "area": "Specific area needing improvement",
      "issue": "Clear description of the problem based on feedback",
      "evidenceQuotes": ["quote 1", "quote 2"],
      "impact": "Why this matters for church health",
      "priority": "High/Medium/Low"
    }
  ],
  "responsesToYourSpecificQuestions": [
    {
      "question": "Exact question parsed from pastor's input",
      "answer": "Direct, clear answer in 2-4 sentences",
      "evidenceQuotes": ["quote 1", "quote 2"],
      "confidence": "High/Medium/Low"
    }
  ],
  "nextStepsForRespondents": [
    {
      "personProfile": "Description based on their responses (e.g., 'New visitor interested in small groups')",
      "responsesSummary": "Brief summary of what they said",
      "recommendedAction": "Specific action pastor should take with this person",
      "urgency": "High/Medium/Low",
      "suggestedFollowUp": "How and when to follow up"
    }
  ],
  "growthAndTrends": {
    "overallChangeNumeric": 0,
    "byArea": [
      {"area": "engagement", "previous": 72, "current": 80, "delta": 8, "trend": "up"},
      {"area": "leadership", "previous": 65, "current": 61, "delta": -4, "trend": "down"}
    ],
    "notes": ["Brief explanations for the most important movements"]
  },
  "pastoralAndApostolicGuidance": {
    "pastoral": [
      {
        "area": "Care/shepherding area (e.g., 'Disconnected members', 'Struggling families')",
        "guidance": "How to care for and support based on responses",
        "practicalSteps": ["Specific caring actions to take"],
        "scriptureRelevance": "Biblical foundation for this approach"
      }
    ],
    "apostolic": [
      {
        "area": "Mission/mobilization area (e.g., 'Gifted volunteers', 'Emerging leaders')",
        "guidance": "How to mobilize and empower toward church mission",
        "practicalSteps": ["Specific mobilization actions"],
        "visionAlignment": "How this advances church vision"
      }
    ]
  },
  "leadershipLenses": [
    {
      "lens": "Communication & Impact (e.g., TD Jakes)",
      "guidance": "How to communicate vision and address felt needs based on this data",
      "nextStep": "One high-impact next step tailored to this lens"
    },
    {
      "lens": "Kingdom Purpose & Principles (e.g., Myles Munroe)",
      "guidance": "How to align responses with purpose, identity, and governance principles",
      "nextStep": "One principle-driven step"
    },
    {
      "lens": "Church Health & Structures (e.g., Frank Damazio)",
      "guidance": "How to build systems and leadership pipelines that address findings",
      "nextStep": "One structural improvement"
    },
    {
      "lens": "Practical Discipleship & Encouragement (e.g., Joyce Meyer)",
      "guidance": "How to disciple through practical habits addressing common concerns",
      "nextStep": "One discipleship action"
    },
    {
      "lens": "Faith & Momentum Building (e.g., Steven Furtick)",
      "guidance": "How to mobilize faith and momentum in response to the data",
      "nextStep": "One momentum step"
    },
    {
      "lens": "Purpose-Driven Alignment (e.g., Rick Warren)",
      "guidance": "How to align outcomes to worship, fellowship, discipleship, ministry, and mission",
      "nextStep": "One PD-driven step"
    }
  ],
  "keyInsights": [
    "Insight 1 about leadership opportunities with supporting data",
    "Insight 2 about church health with specific examples",
    "Insight 3 about congregation engagement with quotes",
    "Insight 4 about legacy building connected to responses"
  ],
  "pastoralRecommendations": [
    {
      "recommendation": "Specific actionable step",
      "reasoning": "Why this addresses the feedback",
      "timeline": "Suggested timeframe",
      "successMetric": "How to measure success"
    }
  ],
  "excellenceAndServanthood": {
    "standards": [
      "Be early, prepared, and prayerful",
      "Close the loop on follow-ups within 48 hours",
      "Measure what matters and iterate weekly"
    ],
    "quickWins": [
      "Tighten communication templates (email/SMS) for clarity and warmth",
      "Add a simple 'You matter' follow-up step for first-time responders"
    ],
    "qualityChecklist": [
      "Is this loving and excellent?",
      "Is it simple for people to act on?",
      "Can we measure the outcome?"
    ]
  },
  "healthMetrics": {
    "overall": 85,
    "leadership": 78,
    "engagement": 92,
    "spiritual": 88,
    "community": 85
  },
  "progressComparison": ${previousAnalysis ? `{
    "overallChange": "+5 or -3 points",
    "improvements": ["What got better with evidence"],
    "regressions": ["What declined with evidence"],
    "trendAnalysis": "Overall trajectory and patterns"
  }` : 'null'},
  "statistics": {
    "totalResponses": ${entries.length},
    "completionRate": 95,
    "averageResponseTime": "3 minutes",
    "topThemes": ["theme1", "theme2", "theme3"]
  },
  "chartData": [
    {
      "title": "Response Distribution by Category",
      "type": "bar",
      "data": [
        {"label": "Category 1", "value": 45},
        {"label": "Category 2", "value": 30}
      ]
    }
  ],
  "warningFlags": [
    "Any concerning patterns or areas needing immediate attention"
  ],
  "strengthAreas": [
    "Areas where the church is doing exceptionally well"
  ]
}

Provide specific, actionable insights based on the actual data. Focus on helping the pastor make strategic decisions for leadership development, church health, legacy building, and member care. Remember to interpret responses in context of the actual form questions and provide both pastoral (care) and apostolic (mission) guidance. Avoid imitating any individual's voice; provide lens-aligned guidance that is original and respectful.`;
      
      // Call OpenAI API
      try {
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: [
              { 
                role: 'system', 
                content: 'You are an expert church consultant and data analyst specializing in helping senior pastors build healthy, thriving churches with strong leadership and lasting impact.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        // Parse JSON response from OpenAI
        const content = openaiResponse.data.choices[0].message.content;
        const analysis = JSON.parse(content);
        
        return res.status(200).json(analysis);
      } catch (openAIError) {
        console.error('OpenAI API Error:', openAIError.response?.data || openAIError.message);
        return res.status(500).json({
          error: 'Failed to analyze form entries',
          details: openAIError.response?.data || openAIError.message
        });
      }
    } catch (error) {
      console.error('Server Error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

/**
 * Analyze location data using OpenAI
 */
exports.analyzeLocations = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const { data, prompt } = req.body;
      
      if (!data || !prompt) {
        return res.status(400).json({ error: 'Missing required data or prompt in request body' });
      }
      
      // Get OpenAI API key from environment variables
      const openAIApiKey = functions.config().openai?.apikey || process.env.OPENAI_API_KEY;
      
      if (!openAIApiKey) {
        console.error('OpenAI API key not configured');
        return res.status(500).json({ 
          error: 'OpenAI API key not configured',
          fallback: true,
          recommendedLocations: generateSimulatedLocationData(data)
        });
      }
      
      // Call OpenAI API
      try {
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4-turbo',
            messages: [
              { 
                role: 'system', 
                content: 'You are an AI assistant that analyzes church location data to recommend new church plant locations. Respond with valid JSON only.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 2048,
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        // Parse JSON response from OpenAI
        const content = openaiResponse.data.choices[0].message.content;
        const parsedContent = JSON.parse(content);
        
        // Add analysis metadata
        const analysisResult = {
          ...parsedContent,
          analysisDate: new Date().toISOString(),
          source: 'openai'
        };
        
        // Store the analysis in Firestore for future reference
        if (data.churchId) {
          const db = admin.firestore();
          await db.collection('churches').doc(data.churchId).collection('locationAnalyses').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            data: analysisResult
          });
        }
        
        return res.status(200).json(analysisResult);
      } catch (openAIError) {
        console.error('OpenAI API Error:', openAIError);
        return res.status(200).json({
          recommendedLocations: generateSimulatedLocationData(data),
          analysisDate: new Date().toISOString(),
          source: 'simulation',
          error: 'Used fallback data due to OpenAI API error'
        });
      }
    } catch (error) {
      console.error('Server Error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

/**
 * Proxy endpoint to call OpenAI Chat Completions securely from the client.
 * Receives: { model, messages, temperature }
 * Returns the OpenAI response body.
 */
exports.openaiChat = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const { model = 'gpt-4', messages, temperature = 0.7, max_tokens } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Missing or invalid `messages` array in request body' });
      }

      const openAIApiKey = functions.config().openai?.apikey || process.env.OPENAI_API_KEY;
      if (!openAIApiKey) {
        console.error('OpenAI API key not configured');
        return res.status(500).json({ error: 'OpenAI API key not configured' });
      }

      try {
        const payload = {
          model,
          messages,
          temperature
        };

        if (max_tokens) payload.max_tokens = max_tokens;

        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          payload,
          {
            headers: {
              Authorization: `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          }
        );

        return res.status(200).json(openaiResponse.data);
      } catch (openAIError) {
        console.error('OpenAI proxy error:', openAIError.response?.data || openAIError.message);
        return res.status(500).json({ error: 'OpenAI request failed', details: openAIError.response?.data || openAIError.message });
      }
    } catch (error) {
      console.error('openaiChat server error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

exports.generateTimeRotateInvoiceReview = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const prompt = String(req.body?.prompt || '').trim();
      const model = String(req.body?.model || 'gemini-flash-latest').trim() || 'gemini-flash-latest';

      if (!prompt) {
        return res.status(400).json({ error: 'Missing `prompt` in request body.' });
      }

      const geminiApiKey = getGeminiApiKey();
      if (!geminiApiKey) {
        console.error('Gemini API key not configured');
        return res.status(500).json({ error: 'Gemini API key not configured on Firebase.' });
      }

      try {
        const geminiResponse = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
          {
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              topP: 0.9,
              maxOutputTokens: 2048,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          }
        );

        const responseText = (Array.isArray(geminiResponse.data?.candidates) ? geminiResponse.data.candidates : [])
          .flatMap((candidate) => (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []))
          .map((part) => String(part?.text || '').trim())
          .filter(Boolean)
          .join('\n\n');

        if (!responseText) {
          return res.status(502).json({ error: 'Gemini returned no summary text for this dataset.' });
        }

        return res.status(200).json({ text: responseText, model });
      } catch (geminiError) {
        console.error('Gemini invoice review proxy error:', geminiError.response?.data || geminiError.message);
        return res.status(500).json({
          error: 'Gemini request failed',
          details: geminiError.response?.data || geminiError.message,
        });
      }
    } catch (error) {
      console.error('generateTimeRotateInvoiceReview server error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

exports.generateDesignWithGemini = functions.runWith({ memory: "512MB", timeoutSeconds: 120 }).https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const authHeader = normalizeText(req.headers.authorization);
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = tokenMatch ? normalizeText(tokenMatch[1]) : '';

      if (!idToken) {
        return res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      }

      let decodedToken = null;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (authError) {
        return res.status(401).json({ error: 'Invalid auth token.' });
      }

      const churchId = normalizeText(req.body?.churchId);
      const prompt = normalizeText(req.body?.prompt);
      const requestedModel = normalizeGeminiModelName(req.body?.model);
      const fallbackImageModel = 'gemini-2.0-flash-exp-image-generation';
      const staticModelCandidates = [
        requestedModel,
        fallbackImageModel,
        'gemini-2.5-flash-image-preview',
        'gemini-2.0-flash-preview-image-generation',
      ].map((entry) => normalizeGeminiModelName(entry)).filter(Boolean);
      const previousImageUrl = normalizeText(req.body?.previousImageUrl);
      const referenceImageUrls = Array.isArray(req.body?.referenceImageUrls)
        ? req.body.referenceImageUrls.map((url) => normalizeText(url)).filter(Boolean)
        : [];

      if (!churchId) {
        return res.status(400).json({ error: 'Missing `churchId` in request body.' });
      }

      if (!prompt) {
        return res.status(400).json({ error: 'Missing `prompt` in request body.' });
      }

      const callerDoc = await admin.firestore().doc(`users/${decodedToken.uid}`).get();
      if (!callerDoc.exists) {
        return res.status(403).json({ error: 'Caller user profile not found.' });
      }

      const callerData = callerDoc.data() || {};
      const roleCandidates = [
        callerData.role,
        callerData.baseRole,
        callerData.systemRole,
        callerData.basedOn,
      ]
        .map((role) => normalizeText(role).toLowerCase())
        .filter(Boolean);
      const isGlobalAdmin = roleCandidates.includes('global_admin') || roleCandidates.includes('system_global_admin');

      const callerChurchCandidates = [
        callerData.churchId,
        callerData.churchID,
        callerData.organizationId,
      ]
        .map((entry) => normalizeText(entry))
        .filter(Boolean);

      let hasChurchAccess = isGlobalAdmin || callerChurchCandidates.includes(churchId);
      if (!hasChurchAccess) {
        const memberDoc = await admin
          .firestore()
          .doc(`churches/${churchId}/members/${decodedToken.uid}`)
          .get();
        hasChurchAccess = memberDoc.exists;
      }

      if (!hasChurchAccess) {
        return res.status(403).json({ error: 'You do not have access to this organization.' });
      }

      const geminiApiKey = getGeminiApiKey();
      if (!geminiApiKey) {
        console.error('Gemini API key not configured');
        return res.status(500).json({ error: 'Gemini API key not configured on Firebase.' });
      }

      let discoveredModelCandidates = [];
      try {
        discoveredModelCandidates = await listGeminiModelCandidates(geminiApiKey);
      } catch (modelDiscoveryError) {
        console.warn('Unable to list Gemini models:', modelDiscoveryError?.message || modelDiscoveryError);
      }

      const modelCandidates = Array.from(
        new Set([
          ...staticModelCandidates,
          ...discoveredModelCandidates,
        ].map((entry) => normalizeGeminiModelName(entry)).filter(Boolean))
      );

      const userParts = [];
      const inputImageHashes = new Set();
      const isRevisionRequest = Boolean(previousImageUrl);

      if (previousImageUrl) {
        try {
          const previousImageInlineData = await toInlineDataFromUrl(previousImageUrl);
          if (previousImageInlineData?.part) {
            userParts.push({ text: 'REVISION MODE: The attached image is the base design. Do NOT redesign from scratch. Keep composition, background, imagery, typography style, and color treatment the same unless explicitly instructed otherwise.' });
            userParts.push(previousImageInlineData.part);
            if (previousImageInlineData.hash) {
              inputImageHashes.add(previousImageInlineData.hash);
            }
            userParts.push({ text: 'Apply only the requested changes. Preserve at least 90% of the original design structure and visual identity.' });
          }
        } catch (imageError) {
          console.warn('Failed loading previous image for Gemini edit:', imageError.message);
        }
      }

      userParts.push({ text: prompt });

      const limitedReferenceUrls = referenceImageUrls.slice(0, 6);
      if (limitedReferenceUrls.length) {
        userParts.push({
          text: `CORPORATE IMAGE LOCK: ${limitedReferenceUrls.length} reference image(s) are attached. Treat them as mandatory style anchors. Keep brand consistency in hierarchy, spacing rhythm, typography behavior, and finishing quality. Do not drift to generic styles.`,
        });
      }
      for (const referenceUrl of limitedReferenceUrls) {
        try {
          const inlineDataPart = await toInlineDataFromUrl(referenceUrl);
          if (inlineDataPart?.part) {
            userParts.push(inlineDataPart.part);
            if (inlineDataPart.hash) {
              inputImageHashes.add(inlineDataPart.hash);
            }
          }
        } catch (referenceError) {
          console.warn('Skipping invalid reference image URL:', referenceError.message);
        }
      }
      if (limitedReferenceUrls.length) {
        userParts.push({
          text: 'REFERENCE PRIORITY: If there is a conflict between generic model tendencies and reference style language, follow the references while still generating a fresh composition.',
        });
      }

      const geminiRequestBody = {
        contents: [
          {
            role: 'user',
            parts: userParts,
          },
        ],
        generationConfig: {
          temperature: isRevisionRequest ? 0.2 : 0.8,
          topP: isRevisionRequest ? 0.7 : 0.95,
          maxOutputTokens: 2048,
          responseModalities: ['TEXT', 'IMAGE'],
        },
      };

      try {
        let geminiResponse = null;
        let resolvedModel = modelCandidates[0] || fallbackImageModel;
        let lastModelError = null;
        const attemptedModels = [];

        for (const modelCandidate of modelCandidates.length ? modelCandidates : [fallbackImageModel]) {
          attemptedModels.push(modelCandidate);
          try {
            geminiResponse = await axios.post(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelCandidate)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
              geminiRequestBody,
              {
                headers: {
                  'Content-Type': 'application/json',
                },
                timeout: 90000,
              }
            );
            resolvedModel = modelCandidate;
            lastModelError = null;
            break;
          } catch (modelError) {
            lastModelError = modelError;
            const statusCode = modelError?.response?.status;
            const isModelNotFound = statusCode === 404;
            if (isModelNotFound) {
              continue;
            }
            throw modelError;
          }
        }

        if (!geminiResponse) {
          const modelLookupError = new Error('No Gemini image model candidate was available for generateContent.');
          modelLookupError.details = {
            attemptedModels,
            upstream: lastModelError?.response?.data || lastModelError?.message || '',
          };
          throw modelLookupError;
        }

        const candidates = Array.isArray(geminiResponse.data?.candidates)
          ? geminiResponse.data.candidates
          : [];

        const candidateParts = candidates.flatMap((candidate) =>
          Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
        );

        const responseText = candidateParts
          .map((part) => normalizeText(part?.text))
          .filter(Boolean)
          .join('\n\n');

        const imagePart = candidateParts.find((part) => part?.inlineData?.data);
        if (!imagePart?.inlineData?.data) {
          return res.status(502).json({
            error: 'Gemini returned no image for this request.',
            details: responseText || 'No text explanation returned by model.',
          });
        }

        const outputBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
        const outputHash = crypto.createHash('sha256').update(outputBuffer).digest('hex');
        if (inputImageHashes.has(outputHash)) {
          return res.status(502).json({
            error: 'Gemini returned an attached image instead of a newly generated design.',
            details: 'Output matched one of the attached reference/previous images. Please retry generation.',
            code: 'OUTPUT_MATCHED_INPUT_IMAGE',
          });
        }

        return res.status(200).json({
          model: resolvedModel,
          text: responseText,
          mimeType: normalizeText(imagePart.inlineData?.mimeType) || 'image/png',
          imageBase64: imagePart.inlineData.data,
        });
      } catch (geminiError) {
        console.error('Gemini design generation proxy error:', geminiError.response?.data || geminiError.message);
        return res.status(500).json({
          error: 'Gemini request failed',
          message: normalizeText(geminiError?.response?.data?.error?.message) || normalizeText(geminiError?.message) || 'Gemini request failed',
          details: geminiError.response?.data || geminiError.message,
          attemptedModels: geminiError?.details?.attemptedModels || modelCandidates,
          discoveredModels: discoveredModelCandidates,
          upstream: geminiError?.details?.upstream || '',
        });
      }
    } catch (error) {
      console.error('generateDesignWithGemini server error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

/**
 * Generate simulated leadership data for fallback purposes
 */
function generateSimulatedLeadershipData(analysisData) {
  const topLeaders = [];
  const members = analysisData.members || [];
  for (let i = 0; i < Math.min(8, members.length); i++) {
    const member = members[i];
    const score = 70 + Math.floor(Math.random() * 25);
    const strengths = [
      ...(member.skills?.slice(0, 2) || []),
      ...(member.professions?.slice(0, 1) || [])
    ];
    if (strengths.length === 0) {
      strengths.push("Communication", "Organization");
    }
    const potentialRoles = [];
    if (member.skills?.includes('teaching') || member.skills?.includes('education')) {
      potentialRoles.push("Bible Study Teacher");
    }
    if (member.skills?.includes('leadership') || member.professions?.includes('Management')) {
      potentialRoles.push("Ministry Leader");
    }
    if (member.skills?.includes('music') || member.skills?.includes('singing')) {
      potentialRoles.push("Worship Team Leader");
    }
    if (potentialRoles.length === 0) {
      potentialRoles.push(
        ["Small Group Leader", "Youth Leader", "Discipleship Mentor", "Pastoral Candidate"][Math.floor(Math.random() * 4)]
      );
    }
    const developmentPlans = [
      `Complete advanced leadership training and mentor with current ${potentialRoles[0]}.`,
      `Assign to assistant ${potentialRoles[0]} role with increasing responsibility over 6 months.`,
      `Pair with experienced leader for 3-month mentorship and enroll in seminary courses.`,
      `Start with leading a small team and provide public speaking training.`
    ];
    topLeaders.push({
      id: member.id,
      name: member.name,
      leadershipScore: score,
      strengths: strengths,
      potentialRoles: potentialRoles,
      developmentPlan: developmentPlans[Math.floor(Math.random() * developmentPlans.length)]
    });
  }
  const visitors = analysisData.visitors || [];
  if (visitors.length > 0) {
    for (let i = 0; i < Math.min(2, visitors.length); i++) {
      const visitor = visitors[i];
      const score = 65 + Math.floor(Math.random() * 15);
      const strengths = [
        ...(visitor.skills?.slice(0, 2) || []),
        ...(visitor.professions?.slice(0, 1) || [])
      ];
      if (strengths.length === 0) {
        strengths.push("Communication", "Community Building");
      }
      const potentialRoles = ["New Visitor Liaison", "Community Outreach Coordinator"];
      topLeaders.push({
        id: visitor.id,
        name: visitor.name,
        isVisitor: true,
        leadershipScore: score,
        strengths: strengths,
        potentialRoles: potentialRoles,
        developmentPlan: "Start membership process and invite to new leader orientation. Offer opportunities to serve in outreach activities."
      });
    }
  }
  topLeaders.sort((a, b) => b.leadershipScore - a.leadershipScore);
  return topLeaders;
}

/**
 * Generate simulated location data for fallback purposes
 */
function generateSimulatedLocationData(analysisData) {
  const members = analysisData.members || [];
  const visitors = analysisData.visitors || [];
  const memberCities = [...new Set(
    members
      .filter(m => m.address?.city)
      .map(m => m.address.city)
  )];
  const visitorCities = [...new Set(
    visitors
      .filter(v => v.address?.city)
      .map(v => v.address.city)
  )];
  const allCities = [...memberCities, ...visitorCities];
  const cityCounts = allCities.reduce((acc, city) => {
    acc[city] = (acc[city] || 0) + 1;
    return acc;
  }, {});
  let recommendedLocations = [];
  if (Object.keys(cityCounts).length >= 3) {
    const sortedCities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([city]) => city);
    recommendedLocations = sortedCities.map(city => {
      const memberCount = members.filter(m => m.address?.city === city).length;
      const visitorCount = visitors.filter(v => v.address?.city === city).length;
      const visitorRatio = memberCount > 0 ? visitorCount / memberCount : 0;
      const growthPotential = visitorRatio > 1.5 ? "high" : (visitorRatio > 0.8 ? "medium" : "low");
      const languages = new Set();
      members
        .filter(m => m.address?.city === city && m.languages?.length > 0)
        .forEach(m => m.languages.forEach(lang => languages.add(lang)));
      visitors
        .filter(v => v.address?.city === city && v.languages?.length > 0)
        .forEach(v => v.languages.forEach(lang => languages.add(lang)));
      const languageInsight = languages.size > 1 
        ? `Multilingual community with ${Array.from(languages).join(', ')} speakers.` 
        : '';
      return {
        area: `${city}`,
        justification: `Strong concentration of ${memberCount} members and ${visitorCount} visitors. ${
          visitorCount > memberCount ? 'High visitor-to-member ratio indicates growth potential.' : 
          'Established member base provides leadership for a new campus.'
        }`,
        initialFocus: visitorCount > memberCount ? "Community Outreach and Visitor Integration" : "Discipleship and Leadership Development",
        memberConcentration: memberCount,
        visitorConcentration: visitorCount,
        growthPotential: growthPotential,
        demographicInsights: languageInsight || "No specific demographic insights available with current data."
      };
    });
  } else {
    recommendedLocations = [
      {
        area: "Northeast District",
        justification: "High concentration of 24 visitors with only 8 members indicates untapped potential. Many visitors travel 15+ miles to attend main campus.",
        initialFocus: "Community Outreach and Young Families Ministry",
        memberConcentration: 8,
        visitorConcentration: 24,
        growthPotential: "high",
        demographicInsights: "Growing young professional demographic with young families."
      },
      {
        area: "West Side Community",
        justification: "Strong base of 18 members already meeting in home groups. Growing population center with new housing developments.",
        initialFocus: "Small Groups and Discipleship",
        memberConcentration: 18,
        visitorConcentration: 12,
        growthPotential: "medium",
        demographicInsights: "Middle-income families with school-age children."
      },
      {
        area: "South County",
        justification: "Significant distance (25+ miles) from main campus with 15 members and 10 visitors currently commuting. University nearby provides growth opportunity.",
        initialFocus: "Young Adult Ministry and College Outreach",
        memberConcentration: 15,
        visitorConcentration: 10,
        growthPotential: "high",
        demographicInsights: "College students and recent graduates. Diverse international population."
      },
      {
        area: "Downtown Area",
        justification: "Urban core with diverse population. 7 members and 14 visitors from this area with emerging leadership potential.",
        initialFocus: "Multicultural Ministry and Community Service",
        memberConcentration: 7,
        visitorConcentration: 14,
        growthPotential: "medium",
        demographicInsights: "Diverse working professionals, multiple language groups, some socioeconomic needs."
      }
    ];
    return recommendedLocations;
  }
}

// ==========================================
// SQL SERVER BRIDGE FUNCTIONS
// ==========================================

// Get all tables from SQL Server database
exports.getSqlTables = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const query = `
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `;
    
    const tables = await executeQuery(query);
    res.json({
      success: true,
      tables: tables,
      count: tables.length
    });
  } catch (error) {
    console.error('Error fetching SQL tables:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get table schema/columns
exports.getTableSchema = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  const { tableName, schema = 'dbo' } = req.query;
  
  if (!tableName) {
    return res.status(400).json({
      success: false,
      error: 'Table name is required'
    });
  }
  
  try {
    const query = `
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @param0 AND TABLE_SCHEMA = @param1
      ORDER BY ORDINAL_POSITION
    `;
    
    const columns = await executeQuery(query, [tableName, schema]);
    res.json({
      success: true,
      table: tableName,
      schema: schema,
      columns: columns
    });
  } catch (error) {
    console.error('Error fetching table schema:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get table data with pagination
exports.getTableData = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  const { tableName, schema = 'dbo', page = 1, limit = 100, orderBy, orderDir = 'ASC' } = req.query;
  
  if (!tableName) {
    return res.status(400).json({
      success: false,
      error: 'Table name is required'
    });
  }
  
  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM [${schema}].[${tableName}]`;
    const countResult = await executeQuery(countQuery);
    const totalRecords = countResult[0].total;
    
    // Get data with pagination
    let dataQuery = `SELECT * FROM [${schema}].[${tableName}]`;
    
    if (orderBy) {
      dataQuery += ` ORDER BY [${orderBy}] ${orderDir}`;
    }
    
    dataQuery += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    
    const data = await executeQuery(dataQuery);
    
    res.json({
      success: true,
      table: tableName,
      schema: schema,
      data: data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalRecords: totalRecords,
        totalPages: Math.ceil(totalRecords / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching table data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Execute custom SQL query (READ-ONLY for safety)
exports.executeSqlQuery = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  const { query, params = [] } = req.body;
  
  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'SQL query is required'
    });
  }
  
  // Basic security check - only allow SELECT statements
  if (!query.trim().toUpperCase().startsWith('SELECT')) {
    return res.status(403).json({
      success: false,
      error: 'Only SELECT queries are allowed for security reasons'
    });
  }
  
  try {
    const result = await executeQuery(query, params);
    res.json({
      success: true,
      query: query,
      result: result,
      rowCount: result.length
    });
  } catch (error) {
    console.error('Error executing SQL query:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get database overview
exports.getDatabaseOverview = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    // Get table counts
    const tableQuery = `
      SELECT 
        t.TABLE_SCHEMA,
        t.TABLE_NAME,
        SUM(p.rows) as row_count
      FROM INFORMATION_SCHEMA.TABLES t
      LEFT JOIN sys.tables st ON t.TABLE_NAME = st.name
      LEFT JOIN sys.partitions p ON st.object_id = p.object_id AND p.index_id IN (0,1)
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
    `;
    
    const tables = await executeQuery(tableQuery);
    
    // Get database info
    const dbInfoQuery = `
      SELECT 
        DB_NAME() as database_name,
        @@VERSION as sql_version,
        GETDATE() as current_time
    `;
    
    const dbInfo = await executeQuery(dbInfoQuery);
    
    res.json({
      success: true,
      database: dbInfo[0],
      tables: tables,
      totalTables: tables.length,
      totalRecords: tables.reduce((sum, table) => sum + (table.row_count || 0), 0)
    });
  } catch (error) {
    console.error('Error fetching database overview:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Planning Center API Proxy
exports.planningCenterProxy = functions.https.onRequest(async (req, res) => {
  // Handle CORS preflight
  if (handleCors(req, res)) return;

  try {
    const { appId, secret, endpoint, method = 'GET', body } = req.body;

    if (!appId || !secret || !endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: appId, secret, and endpoint are required'
      });
    }

    // Create Basic Auth token
    const authToken = Buffer.from(`${appId}:${secret}`).toString('base64');

    // Make request to Planning Center API
    const url = `https://api.planningcenteronline.com${endpoint}`;
    
    const config = {
      method: method,
      url: url,
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json',
      }
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.data = body;
    }

    const response = await axios(config);

    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Planning Center API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.errors?.[0]?.detail || error.message,
      status: error.response?.status
    });
  }
});

const normalizeValue = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const sanitizeFieldSegment = (value) => {
  const normalized = normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'unknown';
};

const detectDeviceType = (userAgentValue) => {
  const ua = normalizeValue(userAgentValue).toLowerCase();
  if (!ua) return 'unknown';
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android/.test(ua)) return 'mobile';
  return 'desktop';
};

const isPublicIp = (ipValue) => {
  const ip = normalizeValue(ipValue);
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.')) return false;
  return true;
};

exports.logEzLinkHit = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Only GET and POST methods are allowed' });
  }

  try {
    let body = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (parseError) {
        body = {};
      }
    }

    const churchId = normalizeValue(body.churchId);
    const slug = normalizeValue(body.slug);

    if (!churchId || !slug) {
      return res.status(400).json({ success: false, error: 'Missing churchId or slug' });
    }

    const firestore = admin.firestore();
    const ezLinkRef = firestore.doc(`churches/${churchId}/ezlinks/${slug}`);
    const ezLinkSnap = await ezLinkRef.get();

    if (!ezLinkSnap.exists) {
      return res.status(404).json({ success: false, error: 'EZLink not found' });
    }

    const ezLinkData = ezLinkSnap.data() || {};
    if (ezLinkData.isActive === false) {
      return res.status(410).json({ success: false, error: 'EZLink is disabled' });
    }

    const redirectUrl = normalizeValue(
      ezLinkData.targetUrl || ezLinkData.url || ezLinkData.destinationUrl || ezLinkData.destination
    );

    if (!redirectUrl) {
      return res.status(400).json({ success: false, error: 'EZLink has no destination configured' });
    }

    const resolveOnlyRaw = normalizeValue(body.resolveOnly).toLowerCase();
    const resolveOnly = resolveOnlyRaw === '1' || resolveOnlyRaw === 'true' || resolveOnlyRaw === 'yes';
    if (resolveOnly) {
      return res.status(200).json({ success: true, redirectUrl, slug, churchId });
    }

    const userAgent = normalizeValue(req.headers['user-agent'] || body.userAgent);
    const forwardedFor = normalizeValue(req.headers['x-forwarded-for']);
    const ipAddress = normalizeValue(forwardedFor.split(',')[0]);

    let city = normalizeValue(req.headers['x-appengine-city'] || body.city);
    let region = normalizeValue(req.headers['x-appengine-region'] || body.region);
    let country = normalizeValue(req.headers['x-appengine-country'] || body.country);

    // Fallback to IP lookup when geo headers are unavailable.
    if (!city && isPublicIp(ipAddress)) {
      try {
        const geoResponse = await axios.get(`https://ipwho.is/${encodeURIComponent(ipAddress)}`, { timeout: 1200 });
        const geoData = geoResponse?.data || {};
        if (geoData.success !== false) {
          city = normalizeValue(geoData.city);
          region = normalizeValue(geoData.region || geoData.region_name);
          country = normalizeValue(geoData.country || geoData.country_code);
        }
      } catch (geoError) {
        console.warn('EZLink geo lookup failed:', geoError.message || geoError);
      }
    }

    const clientHourRaw = Number(body.clientHour);
    const hourBucket = Number.isFinite(clientHourRaw) && clientHourRaw >= 0 && clientHourRaw <= 23
      ? String(clientHourRaw).padStart(2, '0')
      : 'unknown';
    const deviceType = sanitizeFieldSegment(body.deviceType || detectDeviceType(userAgent));
    const cityKey = sanitizeFieldSegment(city || 'unknown');

    const hitLog = {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      clientTimestamp: normalizeValue(body.clientTimestamp),
      clientHour: Number.isFinite(clientHourRaw) ? clientHourRaw : null,
      timezone: normalizeValue(body.timezone),
      language: normalizeValue(body.language),
      platform: normalizeValue(body.platform),
      referrer: normalizeValue(body.referrer),
      userAgent,
      deviceType,
      city: city || null,
      region: region || null,
      country: country || null,
      ipAddress: ipAddress || null,
      screen: {
        width: Number.isFinite(Number(body?.screen?.width)) ? Number(body.screen.width) : null,
        height: Number.isFinite(Number(body?.screen?.height)) ? Number(body.screen.height) : null,
      },
    };

    await ezLinkRef.collection('hitLogs').add(hitLog);

    // NOTE: update() is required here — dot-notation nested paths only work with update(),
    // NOT with set(..., { merge: true }), which treats them as literal key names.
    const analyticsUpdate = {
      'analytics.totalHits': admin.firestore.FieldValue.increment(1),
      'analytics.lastHitAt': admin.firestore.FieldValue.serverTimestamp(),
      [`analytics.deviceCounts.${deviceType}`]: admin.firestore.FieldValue.increment(1),
      [`analytics.cityCounts.${cityKey}`]: admin.firestore.FieldValue.increment(1),
      [`analytics.hourCounts.${hourBucket}`]: admin.firestore.FieldValue.increment(1),
      'analytics.lastSeenCity': city || null,
      'analytics.lastSeenRegion': region || null,
      'analytics.lastSeenCountry': country || null,
    };

    await ezLinkRef.update(analyticsUpdate);

    return res.status(200).json({ success: true, redirectUrl, slug, churchId });
  } catch (error) {
    console.error('Failed to log EZLink hit:', error);
    return res.status(500).json({ success: false, error: error.message || 'Unexpected error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Gemini text proofreader — corrects grammar, missing words, and typos in copy
// while preserving the original intent and church marketing tone.
// ──────────────────────────────────────────────────────────────────────────────
exports.correctTextWithGemini = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const authHeader = normalizeText(req.headers.authorization);
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = tokenMatch ? normalizeText(tokenMatch[1]) : '';

      if (!idToken) {
        return res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      }

      try {
        await admin.auth().verifyIdToken(idToken);
      } catch (authError) {
        return res.status(401).json({ error: 'Invalid auth token.' });
      }

      const rawText = normalizeText(req.body?.text);
      if (!rawText) {
        return res.status(400).json({ error: 'Missing `text` in request body.' });
      }

      const geminiApiKey = getGeminiApiKey();
      if (!geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured on Firebase.' });
      }

      const systemPrompt = `You are a professional church marketing copywriter and proofreader.
Your job is to correct the user's text: fix missing words, spelling mistakes, grammar errors, and awkward phrasing.
RULES:
- Preserve the original meaning and intent EXACTLY.
- Preserve proper nouns, names, scripture references, and capitalization choices.
    - Preserve all diacritics and special characters exactly (á, é, í, ó, ú, ñ, ü, ¿, ¡, apostrophes, punctuation).
    - NEVER strip accents or replace accented letters with non-accented versions.
    - If the text contains a location/address, preserve address components and ordering exactly; do not abbreviate or rewrite addresses.
- Keep the tone appropriate for church marketing (warm, inviting, faith-based).
- Return ONLY the corrected text — no explanation, no quotation marks, no preamble.
- If the text is already correct, return it unchanged.`;

      const geminiRequestBody = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${systemPrompt}\n\nText to correct:\n${rawText}` },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 512,
        },
      };

      const textModel = 'gemini-2.0-flash';
      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        geminiRequestBody,
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );

      const candidates = geminiResponse.data?.candidates || [];
      const correctedText = normalizeText(
        candidates[0]?.content?.parts?.find((part) => part.text)?.text || rawText
      );

      return res.status(200).json({ correctedText });
    } catch (error) {
      console.error('correctTextWithGemini error:', error?.response?.data || error.message);
      return res.status(500).json({ error: error.message || 'Unexpected error in correctTextWithGemini.' });
    }
  });
});
