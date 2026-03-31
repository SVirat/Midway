module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  // Verify the user is authenticated via Supabase JWT
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Validate token with Supabase
  const userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!userResp.ok) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { razorpay_subscription_id } = req.body || {};
  if (!razorpay_subscription_id) {
    return res.status(400).json({ error: 'Missing subscription ID' });
  }

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return res.status(503).json({ error: 'Payment not configured' });
  }

  const auth = Buffer.from(RAZORPAY_KEY_ID + ':' + RAZORPAY_KEY_SECRET).toString('base64');

  try {
    const resp = await fetch(
      'https://api.razorpay.com/v1/subscriptions/' + encodeURIComponent(razorpay_subscription_id) + '/cancel',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + auth,
        },
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      }
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.status(resp.status).json({ error: 'Razorpay cancel failed: ' + body });
    }
    const result = await resp.json();
    return res.json({ cancelled: true, ends_at: result.current_end || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
};
