# Midway: Product Requirements Document

**Version:** 1.0  
**Last Updated:** March 21, 2026  
**Author:** Virat Singh  
**Live URL:** https://mway.vercel.app

---

## 1. Overview

### 1.1 Problem Statement
When a group of friends wants to meet, choosing a location is surprisingly hard. Everyone has different starting points, and the typical approach — "let's just meet at X" — often means one person drives 40 minutes while another walks 5. There's no easy tool that accounts for fairness, venue quality, and group preferences simultaneously.

### 1.2 Solution
Midway is a web app that calculates the optimal meeting spot for any group. Users enter their locations, pick a vibe or category, and Midway finds real venues near the geographic sweet spot — ranked by fairness or efficiency, with real driving distances and optional AI-powered vibe matching.

### 1.3 Target Users
- Friend groups (2–8 people) planning casual meetups
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
- Up to 8 location inputs supported
- Each input has a label field (person's name) and address field
- GPS button shows a loading spinner while acquiring location
- "Add Person" button to add more input rows
- "Invite Friends to Join Map" share button

### 2.2 Vibe Check System
**Description:** Users specify what kind of venue they're looking for.

**Category Tabs:**
| Category | Vibe Tags |
|----------|-----------|
| Food | Coffee, Brunch, Lunch, Dinner, Dessert, Drinks, Late Night, Healthy |
| Play | Bowling, Arcade, Board Games, Mini Golf, Escape Room, Paintball |
| Gigs | Live Music, Comedy, Theatre, Open Mic, DJ Night, Karaoke |

**AI Agent Mode (sign-in required):**
- Free-text input: "great outdoor seating with tasty pastries"
- Sends prompt to serverless AI endpoint
- AI re-ranks venue results based on the description
- Provider cascade: Gemini 2.0 Flash → GPT-4o Mini → Claude Sonnet 4
- Locked behind Google sign-in (feature gate)

### 2.3 Mode Toggle
**Two modes for center calculation:**

| Mode | Algorithm | Optimizes For |
|------|-----------|---------------|
| **Fair** | Minimax Iterative | Minimizes the maximum distance any person travels. No outliers. |
| **Eco** | Weiszfeld (Geometric Median) | Minimizes total group travel distance. Most fuel-efficient. |

### 2.4 Venue Discovery & Ranking
**Flow:**
1. Calculate geographic center using selected algorithm
2. Search Google Places Nearby for venues matching the selected category/vibes
3. Fetch real driving distances from every person to every venue (Google Directions)
4. Rank venues using Pareto dominance on distances and drive times
5. (Optional) Re-rank with AI vibe matching if user provided a prompt
6. Display top 5 venues

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
- Generates `mway.vercel.app/join/{sessionId}` link
- Copies to clipboard for sharing with friends

---

## 3. Authentication & User Features

### 3.1 Google Sign-In
- OAuth 2.0 via Supabase Auth
- Profile photo displayed as avatar in navbar
- User menu dropdown (name, email, sign out)
- Unlocks: AI vibe input, animated gradient border on AI field

### 3.2 Feature Gating
| Feature | Signed Out | Signed In |
|---------|-----------|-----------|
| Location input | ✅ | ✅ |
| Category/vibe tags | ✅ | ✅ |
| AI custom prompt | 🔒 Locked | ✅ |
| Search venues | ✅ | ✅ |
| Share | ✅ | ✅ |
| Saved locations | 🔒 | ✅ |

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

### 4.3 AI Vibe Ranking
1. Constructs a prompt with venue names, ratings, types, and the user's vibe description
2. Sends to serverless `/api/ai-rank` endpoint
3. AI returns a reordered array of venue indices
4. Client applies the new ordering
5. Falls back to original ranking if all AI providers fail

### 4.4 Route Caching
- Routes cached per-session in memory (`state.routeCache`)
- Key: `{origin_lat,lng}→{dest_lat,lng}`
- Prevents duplicate Google Directions API calls

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
| Google Generative Language (Gemini) | AI venue ranking (primary) | API Key |
| OpenAI Chat Completions | AI venue ranking (fallback 1) | Bearer token |
| Anthropic Messages | AI venue ranking (fallback 2) | API key header |
| Open-Meteo | Weather at midpoint | None (free) |
| OSM Nominatim | Fallback reverse geocoding | None (free) |
| Supabase | Auth + Database | Anon key |

---

## 7. Non-Functional Requirements

### 7.1 Performance
- First meaningful paint under 2 seconds
- Venue search results in under 5 seconds
- AI ranking adds 1–3 seconds (async, non-blocking)
- Route caching eliminates duplicate API calls

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

- [ ] Real-time collaborative sessions (multiple users add locations live)
- [ ] Account deletion / data export (GDPR compliance)
- [ ] Transit mode (public transport distances)
- [ ] Saved searches and favorite venues
- [ ] Push notifications when friends join a session
- [ ] Custom domain (midw.ai)
- [ ] Mobile app (PWA)
