module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
  const RAZORPAY_PLAN_MONTHLY = process.env.RAZORPAY_PLAN_MONTHLY || '';
  const RAZORPAY_PLAN_YEARLY = process.env.RAZORPAY_PLAN_YEARLY || '';

  const { plan, user_id } = req.body || {};
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
    return res.status(503).json({ error: 'Plan not configured' });
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
        total_count: plan === 'yearly' ? 10 : 120,
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
};
