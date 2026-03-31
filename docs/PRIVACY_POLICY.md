# Privacy Policy

**Effective Date:** March 21, 2026  
**Last Updated:** March 31, 2026  
**App:** Midway  
**URL:** https://mway.vercel.app  
**Developer:** Virat Singh

---

## 1. Introduction

Midway ("we", "our", "the app") is a web application that helps groups find a fair meeting location. This Privacy Policy explains what data we collect, how we use it, and your rights regarding that data.

We are committed to protecting your privacy. We do not sell your data, we do not use third-party ad trackers, and we collect only what is necessary to provide and improve the service.

---

## 2. Data We Collect

### 2.1 Data You Provide

| Data | When | Purpose |
|------|------|---------|
| **Location addresses** | When you type or paste an address | To calculate the meeting midpoint and find nearby venues |
| **Geolocation coordinates** | When you click "Use my location" (opt-in only) | To auto-fill your starting location |
| **Vibe preferences** | When you select category tags or type an AI prompt | To filter and rank venue results |
| **Google account info** | When you sign in with Google | To save your locations and enable AI features |
| **Subscription choice** | When you subscribe to Pro | To activate your subscription and manage billing |

### 2.2 Data We Collect Automatically

| Data | Purpose |
|------|---------|
| **Anonymous session ID** | Stored in localStorage; used to group analytics events. Not linked to your identity unless you sign in. |
| **Session metrics** | Active session duration and time-to-first-action, to understand engagement. |
| **Analytics events** | Aggregated usage events (e.g., "search started", "venue shared"). No personal content is included. |
| **Device info** | Browser name, screen size, platform. Used for compatibility monitoring. |
| **Client errors** | JavaScript errors and unhandled exceptions. Used for debugging. |
| **API call logs** | Which external APIs were called, response times, and success/failure. No user content is logged. |

### 2.3 Data We Do NOT Collect
- We do **not** use cookies for tracking
- We do **not** fingerprint your device
- We do **not** record your browsing history outside the app
- We do **not** collect or store payment card details (all payment processing is handled entirely by Razorpay; we only receive subscription IDs and payment confirmation tokens)
- We do **not** access your Google contacts, calendar, or any data beyond your basic profile

---

## 3. How We Use Your Data

| Use Case | Data Used |
|----------|-----------|
| Calculate meeting midpoints | Location addresses, coordinates |
| Find and rank venues | Addresses, vibe preferences, AI prompts |
| Display weather | Midpoint coordinates (passed to Open-Meteo, a free weather API) |
| Authenticate you | Google OAuth token, profile name/email/photo |
| Manage your subscription | Subscription plan choice, Razorpay subscription/payment IDs (no card details) |
| Save your locations | Addresses (only if signed in) |
| Improve the app | Aggregated analytics, session metrics, error logs |
| AI venue ranking | Your vibe prompt text is sent to our server, then to AI providers. The prompt contains venue names and your description — no personal information. |

---

## 4. Third-Party Services

We use the following third-party services. Each has its own privacy policy:

| Service | What It Receives | Privacy Policy |
|---------|-----------------|----------------|
| **Google Maps Platform** | Addresses, coordinates (for autocomplete, directions, place details) | [Google Privacy Policy](https://policies.google.com/privacy) |
| **Google OAuth** (via Supabase) | Your Google account info during sign-in | [Google Privacy Policy](https://policies.google.com/privacy) |
| **Supabase** | User profile, saved data, analytics events (our database host) | [Supabase Privacy Policy](https://supabase.com/privacy) |
| **Google Gemini API** | AI prompts containing venue names and your vibe description | [Google AI Privacy](https://policies.google.com/privacy) |
| **OpenAI API** | AI prompts (fallback provider) | [OpenAI Privacy Policy](https://openai.com/privacy) |
| **Anthropic API** | AI prompts (fallback provider) | [Anthropic Privacy Policy](https://www.anthropic.com/privacy) |
| **Open-Meteo** | Midpoint coordinates (for weather data) | [Open-Meteo Terms](https://open-meteo.com/en/terms) |
| **Vercel** | Hosts the app; standard web server logs (IP, user agent) | [Vercel Privacy Policy](https://vercel.com/legal/privacy-policy) |
| **Razorpay** | Subscription plan choice, payment confirmation IDs (Razorpay handles all card/UPI data directly; we never see or store payment credentials) | [Razorpay Privacy Policy](https://razorpay.com/privacy/) |

---

## 5. Data Storage & Security

- **Database:** Your data is stored in Supabase (PostgreSQL) with Row-Level Security (RLS) enabled. Signed-in users can only access their own data.
- **Anonymous data:** Analytics events are associated with a random anonymous ID stored in your browser's localStorage. This ID is not linked to your real identity unless you sign in.
- **Location precision:** When your coordinates appear in analytics, they are rounded to approximately 1 km precision.
- **API keys:** Sensitive API keys (AI providers) are stored server-side and never exposed to your browser.
- **Payments:** All payment processing is handled by Razorpay. We never receive, transmit, or store your card number, UPI ID, or bank details. We only store Razorpay subscription IDs and payment confirmation tokens to manage your subscription status.
- **Encryption:** All data in transit is encrypted via HTTPS/TLS.

---

## 6. Data Retention

| Data Type | Retention |
|-----------|-----------|
| Analytics events | Retained indefinitely for aggregate analysis |
| Session metrics | Retained indefinitely |
| Client error logs | Retained indefinitely |
| Saved locations | Until you delete them or your account |
| Search history | Retained indefinitely (associated with your user ID if signed in) |
| Subscription records | Retained for the duration of the subscription and a reasonable period after cancellation for billing dispute resolution |

---

## 7. Your Rights

You have the right to:

- **Access** your data — contact us and we will provide a copy of your stored data
- **Delete** your data — contact us to request deletion of your account and all associated data
- **Opt out of analytics** — disable JavaScript or use browser privacy tools; the app's core features require JavaScript but analytics events will not fire if blocked
- **Revoke Google access** — remove Midway from your Google account's connected apps at [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
- **Clear local data** — clear your browser's localStorage to remove your anonymous session ID

---

## 8. Children's Privacy

Midway is not directed at children under the age of 13. We do not knowingly collect personal information from children. If you believe a child has provided us with personal data, please contact us and we will delete it.

---

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected by updating the "Last Updated" date at the top of this page. Continued use of the app after changes constitutes acceptance of the updated policy.

---

## 10. Contact

For privacy questions, data requests, or concerns:

- **Developer:** Virat Singh
- **Email:** Contact via GitHub — [github.com/SVirat](https://github.com/SVirat)
- **App:** [mway.vercel.app](https://mway.vercel.app)
