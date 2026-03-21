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

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Midway server running at http://localhost:${PORT}`);
});
