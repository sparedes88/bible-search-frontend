# OpenAI API Key Issue - Resolution Guide

## Problem
The OpenAI API key currently configured is **invalid or expired**. The error from OpenAI API:
```
"Incorrect API key provided: sk-proj-***...pUgA"
```

## Why This Happens
- OpenAI API keys can expire
- Project keys (sk-proj-*) have specific requirements
- Keys may have been revoked or regenerated
- Account billing issues can invalidate keys

## Solution: Get a New API Key

### Step 1: Generate New Key from OpenAI
1. Visit: https://platform.openai.com/api-keys
2. Sign in to your OpenAI account
3. Click "Create new secret key"
4. Copy the new key (it will only be shown once!)

### Step 2: Update the Key (Easy Method)
Run the provided PowerShell script:
```powershell
.\update-openai-key.ps1 "sk-your-new-api-key-here"
```

This will automatically:
- Update `.env` file
- Update `functions/.env` file
- Update Firebase Functions config

### Step 3: Deploy
```powershell
firebase deploy --only functions:analyzeFormEntries
```

### Step 4: Test
1. Refresh your browser
2. Go to a form entries page
3. Click "AI Analysis" button
4. Should now work!

---

## Manual Update Method (if script doesn't work)

### Update Frontend .env
File: `c:\Projects\iglesiatech restore\bible-search-frontend\bible-search-frontend\.env`
```env
REACT_APP_OPENAI_API_KEY=sk-your-new-key-here
```

### Update Functions .env
File: `c:\Projects\iglesiatech restore\bible-search-frontend\bible-search-frontend\functions\.env`
```env
OPENAI_API_KEY=sk-your-new-key-here
```

### Update Firebase Config
```powershell
firebase functions:config:set openai.apikey="sk-your-new-key-here"
```

### Deploy
```powershell
firebase deploy --only functions:analyzeFormEntries
```

---

## Verify Key is Valid
Test your new key before deploying:
```powershell
$headers = @{ "Authorization" = "Bearer sk-your-new-key" }
Invoke-RestMethod -Uri "https://api.openai.com/v1/models" -Headers $headers -Method Get
```

If valid, you'll see a list of available models.
If invalid, you'll get an error message.

---

## Important Notes

1. **Never commit API keys to git** - They are in `.env` files which should be in `.gitignore`
2. **Keep keys secure** - Don't share them publicly
3. **Monitor usage** - Check OpenAI dashboard for API usage and costs
4. **Set usage limits** - In OpenAI dashboard, set monthly spending limits to avoid surprises

---

## Current Implementation

The AI Analysis feature:
- ✅ Frontend code is ready
- ✅ Firebase Function is deployed
- ✅ UI is complete
- ❌ Waiting for valid OpenAI API key

Once you update the key, the feature will provide:
- Church health scores
- Pastoral recommendations
- Key insights from form responses
- Visual charts and statistics
- Warning flags and strength areas

All tailored specifically for senior pastors focused on leadership, church health, and legacy building.
