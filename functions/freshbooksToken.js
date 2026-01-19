const functions = require('firebase-functions');
const fetch = require('node-fetch');

// Store your FreshBooks credentials in Firebase environment config
const CLIENT_ID = functions.config().freshbooks.client_id;
const CLIENT_SECRET = functions.config().freshbooks.client_secret;
const REDIRECT_URI = 'https://bible-search-frontend.vercel.app/freshbooks/callback';

const allowedOrigins = [
  "https://bible-search-frontend.vercel.app",
  "http://localhost:3000"
];

exports.freshbooksToken = functions.https.onRequest(async (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  const { code } = req.body;
  if (!code) {
    return res.status(400).send('Missing code');
  }
  try {
    console.log('FreshBooks OAuth config:', {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET ? '***' : '(missing)',
      redirect_uri: REDIRECT_URI,
    });
    const response = await fetch('https://api.freshbooks.com/auth/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const data = await response.json();
    if (data.access_token) {
      res.status(200).json(data);
    } else {
      res.status(400).json(data);
    }
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});
