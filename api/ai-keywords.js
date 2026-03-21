const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// ---------- Rate Limiting (in-memory sliding window) ----------
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_ANON = 5;
const RATE_LIMIT_AUTH = 20;
const rateLimitMap = new Map();

function checkRateLimit(key, maxRequests) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitMap.get(key) || []).filter(t => t > windowStart);
  if (timestamps.length >= maxRequests) return false;
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return true;
}

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

const SYSTEM_PROMPT = `You are a search keyword extractor for Google Places API. Given a user's natural language description of the kind of place they want, extract the best Google Places search parameters.

Rules:
- "keyword" should be 2-5 words optimized for Google Places nearbySearch. Focus on the MOST important aspects of what the user wants.
- "type" should be ONE Google Places type from this list ONLY: restaurant, cafe, bar, night_club, park, gym, stadium, bowling_alley, movie_theater, amusement_park, spa, art_gallery, establishment. Pick the closest match, or use null if none fits well.
- If the user mentions multiple activities (e.g. "fries and golf"), prioritize the primary venue type and include other aspects in the keyword.

Return ONLY a JSON object like: {"keyword": "sports bar fries", "type": "bar"}
No explanation, just the JSON object.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const isAuthenticated = token ? await verifySupabaseToken(token) : false;
  const limit = isAuthenticated ? RATE_LIMIT_AUTH : RATE_LIMIT_ANON;

  if (!checkRateLimit(ip, limit)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { userPrompt } = req.body || {};
  if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.length > 500) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  const fullPrompt = `User request: "${userPrompt}"\n\nExtract the best Google Places search keyword and type.`;

  const providerNames = [];
  const providers = [];
  if (GEMINI_API_KEY)  { providerNames.push('gemini');  providers.push(() => callGemini(fullPrompt)); }
  if (OPENAI_API_KEY)  { providerNames.push('openai');  providers.push(() => callOpenAI(fullPrompt)); }
  if (CLAUDE_API_KEY)  { providerNames.push('claude');  providers.push(() => callClaude(fullPrompt)); }

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
    }
  }

  res.status(502).json({ error: 'All AI providers failed', ai_meta: { attempts } });
};

function parseKeywordsJSON(text) {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('No JSON object found in AI response');
  const obj = JSON.parse(match[0]);
  if (!obj.keyword || typeof obj.keyword !== 'string') throw new Error('Missing keyword field');
  return { keyword: obj.keyword.slice(0, 100), type: obj.type || null };
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 100 },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('Gemini HTTP ' + resp.status + ': ' + body);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseKeywordsJSON(text);
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
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 100,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('OpenAI HTTP ' + resp.status + ': ' + body);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseKeywordsJSON(text);
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
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('Claude HTTP ' + resp.status + ': ' + body);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  return parseKeywordsJSON(text);
}
