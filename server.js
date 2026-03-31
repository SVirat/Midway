const express = require('express');
const path = require('path');

// Load .env
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  });
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || env.CLAUDE_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET || '';
const RAZORPAY_PLAN_MONTHLY = process.env.RAZORPAY_PLAN_MONTHLY || env.RAZORPAY_PLAN_MONTHLY || '';
const RAZORPAY_PLAN_YEARLY = process.env.RAZORPAY_PLAN_YEARLY || env.RAZORPAY_PLAN_YEARLY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ---------- Rate Limiting (in-memory sliding window) ----------
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_ANON = 5;              // anonymous: 5 req/min
const RATE_LIMIT_AUTH = 20;             // authenticated: 20 req/min
const rateLimitMap = new Map();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, timestamps] of rateLimitMap) {
    const filtered = timestamps.filter(t => t > cutoff);
    if (filtered.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, filtered);
  }
}, 5 * 60 * 1000);

function checkRateLimit(key, maxRequests) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitMap.get(key) || []).filter(t => t > windowStart);
  if (timestamps.length >= maxRequests) return false;
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return true;
}

// ---------- Supabase Token Verification ----------
async function verifySupabaseToken(token) {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

// ---------- AI Proxy Endpoint ----------
app.post('/api/ai-rank', async (req, res) => {
  // --- Auth & rate limiting ---
  const ip = getClientIp(req);
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const isAuthenticated = token ? await verifySupabaseToken(token) : false;
  const limit = isAuthenticated ? RATE_LIMIT_AUTH : RATE_LIMIT_ANON;

  if (!checkRateLimit(ip, limit)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 5000) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  const providerNames = [];
  const providers = [];
  if (GEMINI_API_KEY)  { providerNames.push('gemini');  providers.push(() => callGemini(prompt)); }
  if (OPENAI_API_KEY)  { providerNames.push('openai');  providers.push(() => callOpenAI(prompt)); }
  if (CLAUDE_API_KEY)  { providerNames.push('claude');  providers.push(() => callClaude(prompt)); }

  if (providers.length === 0) {
    return res.status(503).json({ error: 'No AI providers configured' });
  }

  const attempts = [];
  for (let i = 0; i < providers.length; i++) {
    const start = Date.now();
    try {
      const ranking = await providers[i]();
      const latency = Date.now() - start;
      attempts.push({ provider: providerNames[i], success: true, latency_ms: latency });
      if (Array.isArray(ranking) && ranking.length > 0) {
        return res.json({ ranking, ai_meta: { provider: providerNames[i], attempts } });
      }
      attempts[attempts.length - 1].success = false;
      attempts[attempts.length - 1].error = 'Empty ranking';
    } catch (e) {
      attempts.push({ provider: providerNames[i], success: false, latency_ms: Date.now() - start, error: e.message });
      console.warn('AI provider failed, trying next:', e.message);
    }
  }

  res.status(502).json({ error: 'All AI providers failed', ai_meta: { attempts } });
});

// ---------- AI Provider Calls ----------
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('Gemini HTTP ' + resp.status + ': ' + body);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseRankingJSON(text);
}

async function callOpenAI(prompt) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 200,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('OpenAI HTTP ' + resp.status + ': ' + body);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseRankingJSON(text);
}

async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('Claude HTTP ' + resp.status + ': ' + body);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  return parseRankingJSON(text);
}

function parseRankingJSON(text) {
  // Try to find a JSON array (numbers or strings)
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('No JSON array found in AI response');
  return JSON.parse(match[0]);
}

// ---------- AI Keyword Extraction Endpoint ----------
app.post('/api/ai-keywords', async (req, res) => {
  const ip = getClientIp(req);
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const isAuthenticated = token ? await verifySupabaseToken(token) : false;
  const limit = isAuthenticated ? RATE_LIMIT_AUTH : RATE_LIMIT_ANON;

  if (!checkRateLimit(ip, limit)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { userPrompt } = req.body;
  if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.length > 500) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  const systemPrompt = 'You are a search keyword extractor for Google Places API. Given a user\'s natural language description of the kind of place they want, extract the best Google Places search parameters.\n\nRules:\n- "keyword" should be 2-5 words optimized for Google Places nearbySearch. Focus on the MOST important aspects of what the user wants.\n- "type" should be ONE Google Places type from this list ONLY: restaurant, cafe, bar, night_club, park, gym, stadium, bowling_alley, movie_theater, amusement_park, spa, art_gallery, establishment. Pick the closest match, or use null if none fits well.\n- If the user mentions multiple activities (e.g. "fries and golf"), prioritize the primary venue type and include other aspects in the keyword.\n\nReturn ONLY a JSON object like: {"keyword": "sports bar fries", "type": "bar"}\nNo explanation, just the JSON object.';

  const fullPrompt = `User request: "${userPrompt}"\n\nExtract the best Google Places search keyword and type.`;

  const providerNames = [];
  const providers = [];
  if (GEMINI_API_KEY) {
    providerNames.push('gemini');
    providers.push(async () => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 100 },
        }),
      });
      if (!resp.ok) throw new Error('Gemini HTTP ' + resp.status);
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return parseKeywordsJSON(text);
    });
  }
  if (OPENAI_API_KEY) {
    providerNames.push('openai');
    providers.push(async () => {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_API_KEY },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: fullPrompt }],
          temperature: 0.2, max_tokens: 100,
        }),
      });
      if (!resp.ok) throw new Error('OpenAI HTTP ' + resp.status);
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || '';
      return parseKeywordsJSON(text);
    });
  }
  if (CLAUDE_API_KEY) {
    providerNames.push('claude');
    providers.push(async () => {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 100,
          system: systemPrompt,
          messages: [{ role: 'user', content: fullPrompt }],
        }),
      });
      if (!resp.ok) throw new Error('Claude HTTP ' + resp.status);
      const data = await resp.json();
      const text = data.content?.[0]?.text || '';
      return parseKeywordsJSON(text);
    });
  }

  if (providers.length === 0) {
    return res.status(503).json({ error: 'No AI providers configured' });
  }

  const attempts = [];
  for (let i = 0; i < providers.length; i++) {
    const start = Date.now();
    try {
      const result = await providers[i]();
      const latency = Date.now() - start;
      attempts.push({ provider: providerNames[i], success: true, latency_ms: latency });
      if (result && result.keyword) {
        return res.json({ keyword: result.keyword, type: result.type || null, ai_meta: { provider: providerNames[i], attempts } });
      }
      attempts[attempts.length - 1].success = false;
      attempts[attempts.length - 1].error = 'Empty result';
    } catch (e) {
      attempts.push({ provider: providerNames[i], success: false, latency_ms: Date.now() - start, error: e.message });
      console.warn('AI keywords provider failed, trying next:', e.message);
    }
  }

  res.status(502).json({ error: 'All AI providers failed', ai_meta: { attempts } });
});

function parseKeywordsJSON(text) {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('No JSON object found in AI response');
  const obj = JSON.parse(match[0]);
  if (!obj.keyword || typeof obj.keyword !== 'string') throw new Error('Missing keyword field');
  return { keyword: obj.keyword.slice(0, 100), type: obj.type || null };
}

// ---------- Resolve short map links ----------
app.get('/api/resolve-map-link', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });
  // Only allow Google Maps short links
  if (!/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url)) {
    return res.status(400).json({ error: 'Not a supported short link' });
  }
  try {
    const resolved = await followRedirects(url);
    res.json({ resolved });
  } catch (e) {
    res.status(500).json({ error: 'Failed to resolve link' });
  }
});

function followRedirects(url, maxRedirects) {
  if (maxRedirects === undefined) maxRedirects = 10;
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        followRedirects(resp.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      } else {
        resolve(url);
      }
      resp.resume(); // consume response body
    }).on('error', reject);
  });
}

// ---------- Create Razorpay Subscription ----------
app.post('/api/create-subscription', async (req, res) => {
  const { plan, user_id } = req.body;
  if (!plan || !['monthly', 'yearly'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  if (!user_id) {
    return res.status(400).json({ error: 'User ID required' });
  }
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return res.status(503).json({ error: 'Payment not configured' });
  }

  const planId = plan === 'yearly' ? RAZORPAY_PLAN_YEARLY : RAZORPAY_PLAN_MONTHLY;
  if (!planId) {
    return res.status(503).json({ error: 'Razorpay plan not configured' });
  }

  const auth = Buffer.from(RAZORPAY_KEY_ID + ':' + RAZORPAY_KEY_SECRET).toString('base64');

  try {
    const resp = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + auth,
      },
      body: JSON.stringify({
        plan_id: planId,
        total_count: plan === 'yearly' ? 10 : 120, // max billing cycles
        quantity: 1,
        notes: { plan: plan, user_id: user_id },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.status(resp.status).json({ error: 'Razorpay subscription creation failed: ' + body });
    }
    const sub = await resp.json();
    return res.json({ subscription_id: sub.id, key_id: RAZORPAY_KEY_ID });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// ---------- Verify Razorpay Subscription Payment ----------
app.post('/api/verify-payment', async (req, res) => {
  const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment parameters' });
  }

  if (!RAZORPAY_KEY_SECRET) {
    return res.status(503).json({ error: 'Payment verification not configured' });
  }

  const crypto = require('crypto');
  const payload = razorpay_payment_id + '|' + razorpay_subscription_id;
  const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(payload).digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid payment signature', verified: false });
  }

  return res.json({ verified: true, razorpay_payment_id, razorpay_subscription_id });
});

// ---------- Cancel Razorpay Subscription ----------
app.post('/api/cancel-subscription', async (req, res) => {
  const { razorpay_subscription_id } = req.body;
  if (!razorpay_subscription_id) {
    return res.status(400).json({ error: 'Missing subscription ID' });
  }

  // Verify the user is authenticated
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || !(await verifySupabaseToken(token))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const auth = Buffer.from(RAZORPAY_KEY_ID + ':' + RAZORPAY_KEY_SECRET).toString('base64');

  try {
    const resp = await fetch('https://api.razorpay.com/v1/subscriptions/' + encodeURIComponent(razorpay_subscription_id) + '/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + auth,
      },
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.status(resp.status).json({ error: 'Razorpay cancel failed: ' + body });
    }
    const result = await resp.json();
    return res.json({ cancelled: true, ends_at: result.current_end || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// ---------- Razorpay Webhook ----------
app.post('/api/razorpay-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured' });

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) return res.status(400).json({ error: 'Missing signature' });

  const crypto = require('crypto');
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

  if (expected !== signature) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const eventType = event.event;

  // Helper to upsert subscription in DB
  async function upsertSub(userId, plan, status, paymentId, rzpSubId, expiresAt) {
    if (!userId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
    const amount = plan === 'yearly' ? 999 : 99;
    try {
      // Try to update existing row by razorpay_subscription_id first
      const updateResp = await fetch(SUPABASE_URL + '/rest/v1/subscriptions?razorpay_subscription_id=eq.' + encodeURIComponent(rzpSubId), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          status: status,
          razorpay_payment_id: paymentId,
          expires_at: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        }),
      });
      const updated = await updateResp.json();
      if (Array.isArray(updated) && updated.length > 0) return; // updated existing

      // No existing row — insert new
      await fetch(SUPABASE_URL + '/rest/v1/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          user_id: userId,
          plan: plan,
          status: status,
          razorpay_payment_id: paymentId,
          razorpay_subscription_id: rzpSubId,
          amount: amount,
          currency: 'INR',
          started_at: new Date().toISOString(),
          expires_at: expiresAt ? new Date(expiresAt * 1000).toISOString() : new Date(Date.now() + (plan === 'yearly' ? 365 : 30) * 86400000).toISOString(),
        }),
      });
    } catch (e) {
      console.error('Webhook DB upsert error:', e.message);
    }
  }

  if (eventType === 'subscription.activated' || eventType === 'subscription.charged') {
    const sub = event.payload.subscription ? event.payload.subscription.entity : null;
    const payment = event.payload.payment ? event.payload.payment.entity : null;
    if (sub) {
      const notes = sub.notes || {};
      await upsertSub(notes.user_id, notes.plan || 'monthly', 'active', payment ? payment.id : null, sub.id, sub.current_end);
    }
  } else if (eventType === 'subscription.cancelled' || eventType === 'subscription.halted' || eventType === 'subscription.completed') {
    const sub = event.payload.subscription ? event.payload.subscription.entity : null;
    if (sub) {
      const notes = sub.notes || {};
      await upsertSub(notes.user_id, notes.plan || 'monthly', 'cancelled', null, sub.id, sub.current_end || sub.ended_at);
    }
  }

  res.json({ status: 'ok' });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Midway server running at http://localhost:${PORT}`);
});
