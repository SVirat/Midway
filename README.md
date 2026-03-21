<p align="center">
  <img src="assets/icon.png" alt="Midway Logo" width="80" />
</p>

<h1 align="center">Midway</h1>

<p align="center">
  <strong>Find the perfect meeting spot for your group: fair, fast, and AI-powered.</strong>
</p>

<p align="center">
  <a href="https://mway.vercel.app">Live App</a> · <a href="docs/PRD.md">Product Spec</a> · <a href="docs/PRIVACY_POLICY.md">Privacy Policy</a>
</p>

---

## What is Midway?

Midway helps groups of friends find the best place to meet. Enter everyone's starting locations, pick a vibe, and Midway calculates the fairest or most efficient midpoint — then shows real venues nearby with driving distances, ratings, and directions.

## Features

### Core
- **Smart Midpoint Calculation** — Two algorithms: **Fair** mode (minimax — no one travels too far) and **Eco** mode (Weiszfeld geometric median — minimizes total travel)
- **Real Venue Discovery** — Searches Google Places for restaurants, cafés, activities, and more near the calculated center
- **Driving Distances** — Real route distances and drive times for every person to every venue via Google Directions API
- **Interactive Map** — Leaflet.js map with markers for people, venues, and routes

### Vibe Check
- **Category Tabs** — Food, Play, Gigs — each with curated vibe tags (e.g. "Rooftop Bar", "Court Sports", "Live Music") (available when `FEATURE_MORE_OPTIONS` is enabled)
- **AI-Powered Search** — Describe what you want in plain English (e.g. "great fries with live music and golf") and an AI agent extracts optimal Google Places search keywords before the venue search begins (Gemini → OpenAI → Claude fallback chain)
- **Review-Based AI Filtering** — After venues are found, Google reviews are fetched and sent to AI to validate which venues genuinely match your request — not just keyword matches
- **Smart Category Detection** — AI agent auto-detects the best category from your prompt (e.g. "badminton" → Play, "movie" → Gigs) and switches the toggle automatically
- **Free-text Search** — When using the AI prompt, venues are found by keyword rather than fixed type, so niche searches (bowling, pickleball, escape rooms) work correctly
- **Graceful AI Fallback** — If AI tokens are exhausted, the app falls back to simple keyword search automatically — no interruption
- **No sign-in required** — AI features and all venue options are available to everyone

### Sharing
- **Share Card** — Venue photo, stars, price, open/closed status, group stats
- **Copy Message** — One-tap clipboard copy with Google Maps link
- **WhatsApp Share** — Direct share button
- **Invite Link** — Share a link so friends can join the map session

### Real-Time Group Sessions
- **Invite Friends** — Creates a unique group link (e.g. `mway.vercel.app/?group=ABC123`) that can be shared with friends
- **Live Sync** — Friends who open the link join the session in real-time via Supabase Presence; all locations sync across browsers instantly
- **Independent Searches** — Vibes, categories, and venue results remain individual per user; only the group's locations are shared
- **Profile Photos in Groups** — Signed-in users' Google profile photos and names are shown to all group members
- **"This is you" Indicator** — Highlighted row and popup to identify your own location field when multiple people are in the session
- **Stale Results Warning** — Toast notification if the group changes after you've generated venue results
- **Auto-Expiry** — Group links expire after 12 hours; expired/invalid links show a toast and redirect to a fresh session
- **Verified Groups** — Groups are registered in the database; random/guessed codes will not work

### Extras
- **Weather Widget** — Live weather at the midpoint via Open-Meteo
- **Geolocation** — "Use my location" button (opt-in, not on page load)
- **Google Sign-In** — Save locations, profile photo avatar (signed-in users' names are locked and shown on hover)
- **Pareto Dominance Ranking** — Venues where everyone benefits equally rank higher
- **Travel Hero Badge** — Shows who travels the farthest

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, HTML5, CSS3 |
| Maps | Leaflet.js 1.9.4 + CARTO tiles |
| Places | Google Maps JavaScript API (Autocomplete, Nearby Search, Directions, Place Details, Geocoding) |
| AI | Gemini 2.0 Flash, GPT-4o Mini, Claude Sonnet 4 (serverless cascade for keyword extraction + review filtering) |
| Auth & DB | Supabase (PostgreSQL + Google OAuth + Row-Level Security + Realtime Presence) |
| Security | Rate limiting (server + client), Supabase token auth on AI proxy |
| Weather | Open-Meteo API |
| Backend | Vercel Serverless Functions (Node.js) |
| Deployment | Vercel |
| Icons | Font Awesome 6.5 |

## Getting Started

### Prerequisites
- Node.js 18+
- A Google Cloud project with Maps JavaScript API enabled
- A Supabase project
- (Optional) API keys for Gemini, OpenAI, and/or Anthropic

### Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/SVirat/midway.git
   cd midway
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in your API keys in `.env`:
   ```
   GOOGLE_MAPS_API_KEY=your_key
   SUPABASE_URL=your_url
   SUPABASE_ANON_KEY=your_key
   GEMINI_API_KEY=your_key        # optional
   OPENAI_API_KEY=your_key        # optional
   CLAUDE_API_KEY=your_key        # optional
   ```

4. **Generate config**
   ```bash
   node setup.js
   ```

5. **Set up the database**
   Run `supabase-schema.sql` in your Supabase SQL editor. All statements are idempotent.

6. **Start the server**
   ```bash
   node server.js
   ```
   Open [http://localhost:3000](http://localhost:3000)

### Deploy to Vercel

The project is Vercel-ready with serverless functions in `api/`:

1. Push to GitHub
2. Import the repo on [vercel.com](https://vercel.com)
3. Add all environment variables from `.env`
4. Deploy — build command runs `node setup.js` automatically

## Project Structure

```
├── index.html          # Single-page app
├── styles.css          # All styles
├── app.js              # Client-side logic (maps, venues, algorithms, UI)
├── auth.js             # Supabase auth, analytics, session metrics
├── config.js           # Auto-generated by setup.js (gitignored)
├── setup.js            # Reads .env / process.env → generates config.js
├── server.js           # Express server (local dev)
├── api/
│   ├── ai-rank.js      # Vercel serverless: AI ranking/filtering endpoint
│   ├── ai-keywords.js  # Vercel serverless: AI keyword extraction from prompts
│   └── resolve-map-link.js  # Vercel serverless: Google Maps link resolver
├── assets/             # Logo, favicons, webmanifest
├── vercel.json         # Vercel deployment config
├── supabase-schema.sql # Database schema (idempotent)
└── docs/
    ├── PRD.md          # Product requirements document
    └── PRIVACY_POLICY.md
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_MAPS_API_KEY` | Yes | Google Maps JavaScript API key |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public key |
| `GEMINI_API_KEY` | No | Google Gemini API key (AI features) |
| `OPENAI_API_KEY` | No | OpenAI API key (AI fallback) |
| `CLAUDE_API_KEY` | No | Anthropic API key (AI fallback) |
| `TEST_MODE` | No | Enable test mode button (`true`/`false`) |
| `FEATURE_MORE_OPTIONS` | No | Show "More Options" section (`true`/`false`) |
| `RAZORPAY_SUPPORT_URL` | No | "Support the developer" link |

## License

This project is proprietary — see [LICENSE.md](LICENSE.md). Source code is viewable for educational purposes only.

## Privacy

See our [Privacy Policy](docs/PRIVACY_POLICY.md) for details on data collection and handling.

---

<p align="center">Made with ❤️ in Hyderabad</p>
