const resizeTVImage = bytes => require('sharp')(bytes).resize(1920, 1080, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();

const calculateDesignCost = (model, usage) => {
  const supported = /^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/.test(model) || /^gpt-image-2\.5-(sunburst|flare)(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
  const inputTextTokens = usage?.input_tokens_details?.text_tokens;
  const inputImageTokens = usage?.input_tokens_details?.image_tokens;
  const outputImageTokens = usage?.output_tokens_details?.image_tokens ?? usage?.output_tokens;
  const counters = [inputTextTokens, inputImageTokens, outputImageTokens];
  if (!supported || counters.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0) || (usage?.output_tokens_details?.text_tokens || 0) > 0) {
    return { usd: null, currency: 'USD', kind: 'unavailable' };
  }
  const rates = { inputTextPerMillion: 5, inputImagePerMillion: 8, outputImagePerMillion: 30 };
  return {
    usd: Number(((inputTextTokens * rates.inputTextPerMillion + inputImageTokens * rates.inputImagePerMillion + outputImageTokens * rates.outputImagePerMillion) / 1000000).toFixed(8)),
    currency: 'USD',
    kind: 'usage_estimate',
    usage: { inputTextTokens, inputImageTokens, outputImageTokens },
    rates,
    pricingAsOf: '2026-10-29',
    pricingSource: 'https://developers.openai.com/api/docs/pricing',
  };
};

const createOpenAIDesignHandler = ({ admin, axios, getApiKey, getModel, projectId, resizeImage = resizeTVImage }) => async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Please sign in before generating a design.' });
  let identity;
  try {
    identity = await admin.auth().verifyIdToken(token);
  } catch (error) {
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
  try {
    const churchId = String(req.body?.churchId || '').trim();
    const eventId = String(req.body?.eventId || '').trim();
    const prompt = String(req.body?.prompt || '').trim();
    if (!churchId || churchId.includes('/') || !eventId || eventId.includes('/') || !prompt || prompt.length > 24000) {
      return res.status(400).json({ error: 'Provide a valid organization, event and a design brief under 24,000 characters.' });
    }
    const profileSnapshot = await admin.firestore().doc(`users/${identity.uid}`).get();
    const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
    const roles = [profile.role, profile.baseRole, profile.basedOn, profile.systemRole].map(value => String(value || '').toLowerCase());
    const globalAdmin = roles.includes('global_admin') || roles.includes('system_global_admin');
    const organizationIds = [profile.churchId, profile.churchID, profile.organizationId].map(value => String(value || ''));
    if (!globalAdmin && !(roles.includes('admin') && organizationIds.includes(churchId))) {
      return res.status(403).json({ error: 'Only organization administrators can generate event designs.' });
    }
    const eventReference = admin.firestore().doc(`eventInstances/${eventId}`);
    const eventSnapshot = await eventReference.get();
    if (!eventSnapshot.exists || String(eventSnapshot.data().churchId) !== churchId) {
      return res.status(404).json({ error: 'Event not found in this organization.' });
    }
    const apiKey = getApiKey();
    if (!apiKey) return res.status(503).json({ error: 'OpenAI is not configured. Set OPENAI_API_KEY on the Firebase server.' });
    const model = getModel();
    const references = Array.isArray(req.body.referenceImageUrls) ? req.body.referenceImageUrls.filter(Boolean) : [];
    const urls = [...new Set([req.body.previousImageUrl, ...references].filter(Boolean))];
    if (urls.length > 5) return res.status(400).json({ error: 'Use at most three uploaded images plus the organization logo and selected design.' });
    const images = [];
    for (const source of urls) {
      let url;
      try { url = new URL(source); } catch (error) { return res.status(400).json({ error: 'Invalid reference image URL.' }); }
      const allowedBuckets = [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
      const storagePath = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || !storagePath || !allowedBuckets.includes(storagePath[1])) {
        return res.status(400).json({ error: 'Reference images must come from this application\'s Firebase Storage.' });
      }
      const response = await axios.get(url.href, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: 10 * 1024 * 1024, maxBodyLength: 10 * 1024 * 1024, maxRedirects: 0 });
      const mimeType = String(response.headers?.['content-type'] || '').split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) return res.status(400).json({ error: 'Reference images must be PNG, JPEG, or WebP.' });
      images.push({ bytes: Buffer.from(response.data), mimeType });
    }
    const parameters = { model, prompt, size: '1920x1088', quality: 'high', output_format: 'jpeg', output_compression: 90, n: 1 };
    let body = parameters;
    let endpoint = 'generations';
    if (images.length) {
      endpoint = 'edits';
      body = new FormData();
      Object.entries(parameters).forEach(([name, value]) => body.append(name, String(value)));
      images.forEach((image, index) => body.append('image[]', new Blob([image.bytes], { type: image.mimeType }), `reference-${index}.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'}`));
    }
    const response = await axios.post(`https://api.openai.com/v1/images/${endpoint}`, body, {
      headers: { Authorization: `Bearer ${apiKey}` }, timeout: 240000, maxBodyLength: 40 * 1024 * 1024, maxContentLength: 30 * 1024 * 1024,
    });
    const billing = calculateDesignCost(model, response.data?.usage);
    try {
      const increment = admin.firestore.FieldValue.increment;
      await eventReference.update({
        'announcementGenerationCost.usd': increment(billing.usd ?? 0),
        'announcementGenerationCost.generations': increment(1),
        'announcementGenerationCost.unknownGenerations': increment(billing.usd === null ? 1 : 0),
      });
      billing.tracked = true;
    } catch (error) {
      billing.tracked = false;
      console.error('Could not record event design usage cost');
    }
    const imageBase64 = response.data?.data?.[0]?.b64_json;
    if (!imageBase64) return res.status(502).json({ error: 'OpenAI returned no image. Please retry.' });
    const image = await resizeImage(Buffer.from(imageBase64, 'base64'));
    if (image.length >= 5 * 1024 * 1024) return res.status(502).json({ error: 'The generated image exceeds the upload limit. Please regenerate it.' });
    return res.status(200).json({ imageBase64: image.toString('base64'), mimeType: 'image/jpeg', model, provider: 'openai', width: 1920, height: 1080, billing });
  } catch (error) {
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;
    console.error('OpenAI design request failed', { status: status || null, code: code || null });
    if (status === 401) return res.status(503).json({ error: 'The server OpenAI API key was rejected. Update the server-side key.' });
    if (status === 403) return res.status(503).json({ error: 'This OpenAI project does not have access to the image model. Check model access and organization verification.' });
    if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return res.status(429).json({ error: 'OpenAI API credits are unavailable. Check your API project billing and usage limits.' });
    if (code === 'content_policy_violation' || code === 'moderation_blocked') return res.status(400).json({ error: 'OpenAI could not generate this content. Please revise the design brief.' });
    if (status === 429) return res.status(429).json({ error: 'OpenAI is rate-limiting this project. Please retry later.' });
    return res.status(502).json({ error: 'OpenAI could not complete the design request. Please retry.' });
  }
};

module.exports = { createOpenAIDesignHandler, resizeTVImage, calculateDesignCost };