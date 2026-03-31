const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!RAZORPAY_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing signature' });
  }

  // Vercel may parse the body; we need the raw string for HMAC
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');

  if (expected !== signature) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const eventType = event.event;

  // Helper to upsert a subscription row
  async function upsertSub(userId, plan, status, paymentId, subscriptionId, expiresAt) {
    if (!userId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
    const amount = plan === 'yearly' ? 999 : 99;
    try {
      // Try update first
      const upResp = await fetch(
        SUPABASE_URL + '/rest/v1/subscriptions?razorpay_subscription_id=eq.' + encodeURIComponent(subscriptionId),
        {
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
        }
      );
      const updated = await upResp.json();
      if (Array.isArray(updated) && updated.length > 0) return;

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
          razorpay_subscription_id: subscriptionId,
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

  return res.json({ status: 'ok' });
};
