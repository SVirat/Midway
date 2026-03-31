# Midway: Product Requirements Document

**Version:** 1.1  
**Last Updated:** March 31, 2026  
**Author:** Virat Singh  
**Live URL:** https://mway.vercel.app

---

## 1. Overview

### 1.1 Problem Statement
When a group of friends wants to meet, choosing a location is surprisingly hard. Everyone has different starting points, and the typical approach, "let's just meet at X", often means one person drives 40 minutes while another walks 5. There's no easy tool that accounts for fairness, venue quality, and group preferences simultaneously.

### 1.2 Solution
Midway is a web app that calculates the optimal meeting spot for any group. Users enter their locations, pick a vibe or category, and Midway finds real venues near the geographic sweet spot — ranked by fairness or efficiency, with real driving distances and optional AI-powered vibe matching.

### 1.3 Target Users
- Friend groups (2–12 people) planning casual meetups
- Couples deciding on date-night spots
- Remote teams meeting in-person occasionally
- Anyone coordinating group outings (food, activities, events)

---

## 2. Core Features

### 2.1 Location Input
**Description:** Users add starting locations for each person in their group.

**Input Methods:**
- Google Places Autocomplete (type an address)
- Geolocation ("Use my location" button, opt-in only)
- Google Maps link paste (short links auto-resolved via server)
- Manual coordinates (fallback)

**Behavior:**
- Minimum 2 locations required to search
- Up to 4 location inputs on Free plan, up to 12 on Pro plan
- Each input has a label field (person's name) and address field
- GPS button shows a loading spinner while acquiring location
- "Add Person" button to add more input rows
- "Invite Friends to Join" share button

### 2.2 Vibe Check System
**Description:** Users specify what kind of venue they're looking for.

**Category Tabs:**
| Category | Vibe Tags |
|----------|-----------|
| Food | Cozy Café, Healthy, Rooftop Bar, Quiet Spot, Fast Food, Party |
| Play | Sports, Court Sports, Bowling, Parks, Activities, Gaming, Adventure, Chill |
| Gigs | Cinema, Comedy, Live Music, Theatre, Art & Culture, Events |
- Free-text input: "great outdoor seating with tasty fries"
- Sends prompt to serverless AI endpoint
- AI re-ranks venue results based on the description
- Provider cascade: Gemini 2.0 Flash → GPT-4o Mini → Claude Sonnet 4
- **Smart Category Detection** — Automatically detects the best category (Food/Play/Gigs) from the user's prompt using keyword matching (e.g. "badminton" → Play, "movie tonight" → Gigs) and switches the toggle; if no match, keeps the current selection
- **Free-text keyword search** — When the prompt doesn't match a predefined vibe tag, search uses keyword-only mode (no type restriction) so niche searches like "bowling", "pickleball", or "escape room" return relevant venues
- Available to all users without sign-in

### 2.3 Mode Toggle
**Two modes for center calculation:**

| Mode | Algorithm | Optimizes For |
|------|-----------|---------------|
| **Fair** | Minimax Iterative | Minimizes the maximum distance any person travels. No outliers. |
| **Eco** | Weiszfeld (Geometric Median) | Minimizes total group travel distance. Most fuel-efficient. |

### 2.4 Venue Discovery & Ranking
**Flow:**
1. Calculate geographic center using selected algorithm
2. (If AI prompt) Send user's natural language prompt to `/api/ai-keywords` — AI extracts optimized Google Places search keyword and type
3. Search Google Places Nearby for venues using AI-extracted keywords (or VIBE_MAP/raw text fallback)
4. (If AI prompt) Fetch Google reviews for top candidates via Place Details API, send venue names + review snippets to `/api/ai-rank` for AI-based filtering — venues that don't match the prompt are deprioritized
5. Rank venues using haversine distances (free, no API calls), applying Pareto dominance determined by the selected mode (Fair/Eco)
6. Fetch real driving distances only for the #1 venue (N parallel Directions calls). Other venues fetch routes lazily on click.
7. Display top 5 venues

**AI Fallback Behavior:**
- If AI keyword extraction fails → uses raw prompt text as Google Places keyword
- If AI review filtering fails → uses keyword search results as-is
- If Google Maps quota is exceeded → shows quota popup and uses fallback venues

**Pareto Dominance Ranking:**
- A venue A dominates venue B if every person's distance to A ≤ distance to B
- Dominated venues always rank lower
- Ties broken by fairness gap (max distance − min distance)

### 2.5 Results Display
**Components:**
- **Venue Cards** — Name, rating (stars), price level, photo, distance stats
- **Interactive Map** — Leaflet.js with CARTO tiles, markers for people + venues, route polylines
- **Summary Table** — Per-person breakdown: distance, drive time, and "Travel Hero" badge for longest traveler
- **Mode Badge** — Shows which algorithm was used (Fair/Eco)
- **Weather Widget** — Current temperature and conditions at the midpoint

### 2.6 Venue Actions
Each venue card provides:
- **View** — Opens venue in Google Maps
- **Directions** — Opens Google Maps directions from user's location
- **Share** — Opens share modal for this venue

### 2.7 Share System
**Share Modal:**
- Venue photo, name, star rating, price level
- Open/Closed status with hours (via Place Details API)
- Group stats: people count, avg driving distance, avg drive time
- **Copy Message** button — Copies formatted text to clipboard:
  ```
  Venue Name (Google Maps link)
  📍 Address
  ⭐ Rating

  Found with Midway: https://mway.vercel.app
  ```
- **WhatsApp** button — Opens WhatsApp with pre-filled message

**Invite Link:**
- Clicking "Invite Friends to Join" creates a group registered in the `groups` table
- Generates a clean link: `mway.vercel.app/?group=ABC123`
- Link is copied to clipboard
- Group links auto-expire after 12 hours (server-side validation)
- Invalid or expired links show a toast notification and clean the URL

---

## 2.8 Real-Time Group Sessions
**Description:** Multiple users can collaboratively build a shared location list in real-time while independently choosing vibes and generating venue results.

**How It Works:**
1. Any user clicks "Invite Friends to Join Map" to create a group
2. A unique 6-character group code is generated and stored in the `groups` database table
3. The invite link (`?group=CODE`) is copied to clipboard for sharing
4. Friends who open the link join a Supabase Realtime Presence channel
5. Each member's locations are broadcast to all other members whenever they change
6. Remote members' locations appear as read-only rows with a green "Live" badge

**Synchronous (shared across all members):**
- The group member list and all their locations
- People count in the group bar
- New member join/leave events

**Individual (per user):**
- Vibe/category selection
- Mode toggle (Fair/Eco)
- Venue search results and rankings
- Share actions

**UX Details:**
- "This is you" popup and highlight ring on the user's own row when others are present
- Combined "This is you. Click to name." tooltip if the name hint fires simultaneously
- Toast: "New friends have been added since generation" / "Some friends have been removed since generation" if the group changes after results exist
- Placeholder text reads "Enter your location..." for the user's own row
- Hover over any named avatar shows their name; unnamed avatars show "Click to rename"
- Signed-in users' Google profile photos appear as avatars for all group members
- Signed-in users cannot rename themselves — their Google profile name is used automatically

**Technical:**
- Uses Supabase Realtime Presence (no additional server infrastructure)
- Presence payload contains a `people` array with all of a member's local locations
- On `join` events, existing members re-broadcast their state so new joiners get current data
- Groups validated against the `groups` table on join; random codes are rejected
- Expired groups (>12h) are cleaned up on access

---

## 3. Authentication & User Features

### 3.1 Google Sign-In
- OAuth 2.0 via Supabase Auth
- Profile photo displayed as avatar in navbar
- User menu dropdown (name, email, sign out)
- Unlocks: saved locations, profile sync across sessions

### 3.2 Pro Subscription
**Description:** Midway offers a paid Pro tier via Razorpay recurring subscriptions.

**Plans:**
| Plan | Price | Billing |
|------|-------|---------|
| Monthly | ₹99/month | Recurring, cancel anytime |
| Yearly | ₹999/year | Recurring, cancel anytime |

**Pro Benefits:**
| Feature | Free | Pro |
|---------|------|-----|
| Group size | 4 friends | 12 friends (3x) |
| Venue results | 5 | 10 (2x) |
| PRO badge | — | Shown next to name |

**Payment Flow:**
1. User clicks "Upgrade" button (or hits group size / venue limit)
2. If not signed in, redirected to Google sign-in first; upgrade modal opens automatically after sign-in
3. Upgrade modal shows plan toggle (monthly/yearly) and benefits list
4. User clicks "Upgrade Now" → Razorpay Subscription created server-side → Checkout.js modal opens
5. After payment, HMAC-SHA256 signature verified server-side (`payment_id|subscription_id`)
6. Subscription saved in `subscriptions` table
7. Razorpay webhook provides backup confirmation for all subscription lifecycle events

**Cancellation:**
- Users can cancel from the "Manage Subscription" dropdown item
- Calls Razorpay API with `cancel_at_cycle_end: 1` (access continues until billing period ends)
- After expiry, user reverts to free tier

### 3.3 Feature Gating
| Feature | Signed Out | Signed In (Free) | Signed In (Pro) |
|---------|-----------|----------|----------|
| Location input | ✅ (up to 4) | ✅ (up to 4) | ✅ (up to 12) |
| Category/vibe tags | ✅ | ✅ | ✅ |
| AI custom prompt | ✅ | ✅ | ✅ |
| Search venues | ✅ (5 results) | ✅ (5 results) | ✅ (10 results) |
| Load more options | ✅ | ✅ | ✅ |
| Share | ✅ | ✅ | ✅ |
| Saved locations | 🔒 | ✅ | ✅ |
| PRO badge | — | — | ✅ |

---

## 4. Algorithms

### 4.1 Fairness Mode (Minimax)
```
Goal: minimize(max(distance_i))
```
Iterative algorithm that adjusts the center point to reduce the longest individual travel distance. Ensures no single person bears an unfair burden.

### 4.2 Eco Mode (Weiszfeld)
```
Goal: minimize(sum(distance_i))
```
Computes the geometric median — the point that minimizes total Euclidean distance from all inputs. Best for minimizing overall group travel / carbon footprint.

### 4.3 AI Search Pipeline
The AI is involved at the **search layer**, not the ranking layer. Ranking is always determined by the selected mode (Fair/Eco).

**Step 1: Keyword Extraction** (`/api/ai-keywords`)
1. User's natural language prompt is sent to the serverless endpoint
2. AI extracts an optimized Google Places search `keyword` (2-5 words) and a `type` (e.g. "restaurant", "bar")
3. These are passed directly to `nearbySearch()` for more relevant initial results
4. Fallback: if AI fails, the raw prompt text is used as the keyword

**Step 2: Review-Based Filtering** (`/api/ai-rank`)
1. After venues are found, Google Reviews (up to 3 per venue, top 5 venues) are fetched via Place Details API
2. Venue names, types, ratings, and review snippets are sent to AI
3. AI returns an ordered list of venue indices that genuinely match the user's request
4. Venues whose reviews don't confirm a match are deprioritized
5. Fallback: if AI fails, the keyword search results are used as-is

**Provider Cascade (both endpoints):**
- Gemini 2.0 Flash (primary) → GPT-4o Mini (fallback 1) → Claude Sonnet 4 (fallback 2)
- Each provider's success/failure and latency are logged to analytics

### 4.4 Route Caching & Lazy Loading
- Routes cached per-session in memory (`_routeCache`)
- Key: `{origin_lat,lng}→{dest_lat,lng}`
- Prevents duplicate Google Directions API calls
- **Lazy Directions loading:** Real driving routes are fetched only for the currently viewed venue (N parallel calls, where N = group size). Other venues are ranked by haversine (free) until selected. This reduces Directions API calls from 5×N to ~N per search, cutting costs ~72% for typical usage patterns.
- A loading spinner appears in the summary area while routes are being fetched for a newly selected venue

---

## 5. Data Architecture

### 5.1 Database Tables (Supabase PostgreSQL)

| Table | Purpose | RLS |
|-------|---------|-----|
| `profiles` | User profile (name, email, avatar) | User-only read/write |
| `saved_locations` | Bookmarked addresses | User-only |
| `search_history` | Past searches (locations, mode, category) | User-only |
| `venue_interactions` | View/direction/share events per venue | Insert-only |
| `activity_logs` | High-level user actions | Insert-only |
| `analytics_events` | Detailed telemetry events | Insert-only |
| `api_calls` | External API call logging (provider, latency) | Insert-only |
| `client_logs` | Frontend console errors + unhandled exceptions | Insert-only |
| `session_metrics` | Session duration, time-to-first-action | Upsert by session_id |
| `groups` | Real-time group session codes with auto-expiry | Insert/select: anyone; delete: expired only |
| `subscriptions` | Pro subscription records (plan, status, Razorpay IDs, expiry) | User-only read; service role for webhook writes |

### 5.2 Anonymous User Tracking
- `midway_anon_id` stored in localStorage (UUID)
- Used for analytics when user is not signed in
- No personally identifiable information attached

### 5.3 Analytics Events (30+ types)
Examples: `mode_toggle`, `vibe_select`, `venues_shown`, `venue_selected`, `share_whatsapp`, `share_copy`, `search_started`, `search_completed`, `geolocation_request`, `weather_loaded`

---

## 6. API Dependencies

| API | Purpose | Auth |
|-----|---------|------|
| Google Maps JavaScript API | Autocomplete, Nearby Search, Directions, Place Details, Geocoding | API Key |
| Google Generative Language (Gemini) | AI keyword extraction + review filtering (primary) | API Key |
| OpenAI Chat Completions | AI keyword extraction + review filtering (fallback 1) | Bearer token |
| Anthropic Messages | AI keyword extraction + review filtering (fallback 2) | API key header |
| Open-Meteo | Weather at midpoint | None (free) |
| OSM Nominatim | Fallback reverse geocoding | None (free) |
| Supabase | Auth + Database + Realtime Presence | Anon key |
| Razorpay Subscriptions API | Recurring billing, subscription management | Key ID + Secret |
| Razorpay Checkout.js | Client-side payment modal | Key ID |

---

## 7. Non-Functional Requirements

### 7.1 Performance
- First meaningful paint under 2 seconds
- Venue search results in under 3 seconds (lazy Directions loading defers route fetching to venue selection)
- AI ranking adds 1–3 seconds (async, non-blocking)
- Route caching eliminates duplicate API calls
- Clicking an uncached venue fetches routes in ~300ms (N parallel Directions calls)

### 7.2 Compatibility
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Responsive design (mobile-first)
- Touch-friendly controls

### 7.3 Security
- API keys never exposed to client (AI keys server-side only)
- Google Maps key exposed in `config.js` (restricted by HTTP referrer in Google Cloud Console)
- Row-Level Security on all Supabase tables
- Input validation on all API endpoints (prompt length, URL format)
- SSRF protection on link resolver (only Google Maps domains allowed)
- **AI proxy authentication** — Client sends Supabase access token; server verifies via Supabase `/auth/v1/user` endpoint
- **Server-side rate limiting** — Sliding window on `/api/ai-rank` and `/api/ai-keywords`: 5 req/min anonymous, 20 req/min authenticated (per IP)
- **Client-side Google Maps rate limiting** — Per-service sliding window caps: geocode 30/min, nearby search 10/min, directions 30/min, place details 10/min; exceeded calls gracefully fallback (haversine, fallback venues, toasts)
- **Monthly Google Maps quota guard** — Client-side monthly usage tracker (localStorage) prevents exceeding the free-tier $200 credit; when limits are reached, a popup informs the user and API calls are declined until the quota resets next month; limits are configurable via `CONFIG.MAPS_MONTHLY_LIMITS`

### 7.4 Privacy
- Geolocation is opt-in (user must click button)
- Location coordinates rounded to ~1km precision in analytics
- No third-party ad trackers
- No cookies for tracking (Supabase uses localStorage for auth)
- See [Privacy Policy](PRIVACY_POLICY.md)

---

## 8. Deployment

| Component | Platform |
|-----------|----------|
| Static files | Vercel CDN |
| Serverless functions | Vercel Functions (Node.js) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (Google OAuth) |
| Domain | mway.vercel.app |

**Build Pipeline:**
1. `node setup.js` generates `config.js` from environment variables
2. Vercel serves static files from root
3. `api/*.js` files become serverless functions automatically

---

## 9. Future Roadmap

- [x] Real-time collaborative sessions (multiple users add locations live)
- [ ] Account deletion / data export (GDPR compliance)
- [ ] Transit mode (public transport distances)
- [ ] Saved searches and favorite venues
- [ ] Push notifications when friends join a session
- [ ] Custom domain (midw.ai)
- [ ] Mobile app (PWA)
- [ ] Family/team plans (shared Pro subscription)
