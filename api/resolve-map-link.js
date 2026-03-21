const http = require('http');
const https = require('https');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const url = req.query.url;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

  if (!/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url)) {
    return res.status(400).json({ error: 'Not a supported short link' });
  }

  try {
    const resolved = await followRedirects(url);
    res.json({ resolved });
  } catch (e) {
    res.status(500).json({ error: 'Failed to resolve link' });
  }
};

function followRedirects(url, maxRedirects) {
  if (maxRedirects === undefined) maxRedirects = 10;
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        followRedirects(resp.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      } else {
        resolve(url);
      }
      resp.resume();
    }).on('error', reject);
  });
}
