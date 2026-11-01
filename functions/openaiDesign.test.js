const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAIDesignHandler, resizeTVImage, calculateDesignCost } = require('./openaiDesign');

const setup = (overrides = {}) => {
  const calls = [];
  const updates = [];
  const admin = {
    auth: () => ({ verifyIdToken: async () => ({ uid: 'admin' }) }),
    firestore: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ role: 'admin', churchId: 'org' }) }), update: async changes => updates.push(changes) }) }),
  };
  admin.firestore.FieldValue = { increment: value => ({ increment: value }) };
  const axios = {
    get: async () => ({ data: Buffer.from('logo'), headers: { 'content-type': 'image/png' } }),
    post: async (...args) => { calls.push(args); return { data: { data: [{ b64_json: 'image-data' }], usage: { input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 300 } } }; },
  };
  const handler = createOpenAIDesignHandler({ admin, axios, getApiKey: () => 'server-secret', getModel: () => 'gpt-image-2.5-sunburst', projectId: 'project', resizeImage: async () => Buffer.from('tv-image'), ...overrides });
  const req = { method: 'POST', headers: { authorization: 'Bearer session' }, body: { churchId: 'org', eventId: 'event-one', prompt: 'Create a professional announcement' } };
  const res = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  return { handler, req, res, calls, admin, axios, updates };
};

test('creates an image using a server-side key and fixed model parameters', async () => {
  const { handler, req, res, calls } = setup();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0][0], 'https://api.openai.com/v1/images/generations');
  assert.equal(calls[0][1].size, '1920x1088');
  assert.equal(calls[0][1].quality, 'high');
  assert.equal(res.body.provider, 'openai');
  assert.equal(res.body.billing.usd, 0.0111);
  assert.equal(res.body.billing.kind, 'usage_estimate');
  assert.equal(res.body.billing.tracked, true);
  assert.equal(res.body.width, 1920);
  assert.equal(res.body.height, 1080);
  assert.equal(Buffer.from(res.body.imageBase64, 'base64').toString(), 'tv-image');
  assert.equal(JSON.stringify(res.body).includes('server-secret'), false);
});

test('uses multipart image editing when an official logo or previous design is provided', async () => {
  const { handler, req, res, calls } = setup();
  req.body.referenceImageUrls = ['https://firebasestorage.googleapis.com/v0/b/project.firebasestorage.app/o/logo.png?alt=media'];
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0][0], 'https://api.openai.com/v1/images/edits');
  assert.equal(calls[0][1].get('model'), 'gpt-image-2.5-sunburst');
  assert.equal(calls[0][1].get('size'), '1920x1088');
  assert.equal(calls[0][1].getAll('image[]').length, 1);
});

test('rejects unauthenticated requests before contacting OpenAI', async () => {
  const { handler, req, res, calls } = setup();
  req.headers = {};
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('rejects non-administrators before contacting OpenAI', async () => {
  const { handler, req, res, calls, admin } = setup();
  admin.firestore = () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ role: 'member', churchId: 'org' }) }) }) });
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('reports missing server credentials without making a paid request', async () => {
  const { handler, req, res, calls } = setup({ getApiKey: () => '' });
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(calls.length, 0);
});

test('rejects arbitrary image URLs to prevent server-side request forgery', async () => {
  const { handler, req, res, calls } = setup();
  req.body.previousImageUrl = 'http://169.254.169.254/metadata';
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('sanitizes provider authentication errors', async () => {
  const { handler, req, res, axios } = setup();
  axios.post = async () => { throw { response: { status: 401, data: { error: { message: 'Rejected server-secret', code: 'invalid_api_key' } } } }; };
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.stringify(res.body).includes('server-secret'), false);
});

test('exports an exact full-HD JPEG without cropping the artwork', async () => {
  const sharp = require('sharp');
  const input = await sharp({ create: { width: 1920, height: 1088, channels: 3, background: '#ff7b00' } }).png().toBuffer();
  const output = await resizeTVImage(input);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
  assert.equal(metadata.format, 'jpeg');
});

test('uses published input and output token rates without image-API cache discounts', () => {
  const billing = calculateDesignCost('gpt-image-2.5-sunburst', { input_tokens_details: { text_tokens: 1000000, image_tokens: 1000000, cached_tokens: 1000000 }, output_tokens: 1000000 });
  assert.equal(billing.usd, 43);
  assert.equal(billing.currency, 'USD');
});

test('never reports missing usage or an unsupported model as a free generation', () => {
  assert.equal(calculateDesignCost('gpt-image-2.5-sunburst', null).usd, null);
  assert.equal(calculateDesignCost('unknown-model', { input_tokens_details: { text_tokens: 1, image_tokens: 1 }, output_tokens: 1 }).usd, null);
});

test('tracks billable responses atomically before an image export fails', async () => {
  const { handler, req, res, updates } = setup({ resizeImage: async () => { throw new Error('Export failed'); } });
  await handler(req, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(updates[0]['announcementGenerationCost.usd'], { increment: 0.0111 });
  assert.deepEqual(updates[0]['announcementGenerationCost.generations'], { increment: 1 });
});

test('marks unknown usage instead of recording a zero-priced generation', async () => {
  const { handler, req, res, updates, axios } = setup();
  axios.post = async () => ({ data: { data: [{ b64_json: 'image-data' }] } });
  await handler(req, res);
  assert.equal(res.body.billing.usd, null);
  assert.deepEqual(updates[0]['announcementGenerationCost.unknownGenerations'], { increment: 1 });
});

test('does not make a paid request or attach costs to another organization\'s event', async () => {
  const { handler, req, res, calls, admin } = setup();
  admin.firestore = () => ({ doc: path => ({ get: async () => ({ exists: true, data: () => path.startsWith('users/') ? { role: 'admin', churchId: 'org' } : { churchId: 'other-org' } }) }) });
  await handler(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls.length, 0);
});

test('accepts three uploaded images alongside the logo and selected design', async () => {
  const { handler, req, res, calls } = setup();
  const imageUrl = name => `https://firebasestorage.googleapis.com/v0/b/project.firebasestorage.app/o/${name}.png?alt=media`;
  req.body.previousImageUrl = imageUrl('selected');
  req.body.referenceImageUrls = ['logo', 'photo-one', 'photo-two', 'reference'].map(imageUrl);
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0][1].getAll('image[]').length, 5);
});

test('rejects excess image attachments without calling OpenAI', async () => {
  const { handler, req, res, calls } = setup();
  req.body.referenceImageUrls = Array.from({ length: 6 }, (_value, index) => `https://firebasestorage.googleapis.com/v0/b/project.firebasestorage.app/o/image-${index}.png?alt=media`);
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});