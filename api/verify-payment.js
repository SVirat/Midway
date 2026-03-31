const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

  const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment parameters' });
  }

  if (!RAZORPAY_KEY_SECRET) {
    return res.status(503).json({ error: 'Payment verification not configured' });
  }

  // Verify signature: HMAC-SHA256(payment_id|subscription_id, secret)
  const payload = razorpay_payment_id + '|' + razorpay_subscription_id;
  const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(payload).digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid payment signature', verified: false });
  }

  return res.json({ verified: true, razorpay_payment_id, razorpay_subscription_id });
};
