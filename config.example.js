// --- API Configuration ---
// Copy this file to config.js and replace the placeholder with your real key.
// config.js is excluded from version control via .gitignore.
const CONFIG = {
  GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY',
  ADSENSE_CLIENT_ID: '', // e.g. ca-pub-1234567890123456
  ADSENSE_SETUP_SLOT: '',
  // Monthly Google Maps API call limits (free-tier protection, resets each month)
  MAPS_MONTHLY_LIMITS: { geocode: 2000, nearby_search: 2000, directions: 2000, place_details: 1000 },
};
