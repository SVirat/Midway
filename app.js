/* ========================================
   MIDWAY — App Logic (Single Page)
   Google Maps Places + Directions + Nearby
   ======================================== */

// ---------- Feature Flags ----------
const FEATURE_MORE_OPTIONS = (typeof CONFIG !== 'undefined' && CONFIG.FEATURE_MORE_OPTIONS) || false;

// ---------- State ----------
const state = {
  sessionId: null,
  mode: 'fairness',
  locations: [],       // { id, name, address, lat, lng }
  vibe: '',
  category: 'food',
  results: [],         // real places from Nearby Search
  chosenVenue: null,
  map: null,
  markers: [],
  routeLayers: [],     // L.polyline references for routes
  googleReady: false,
  autocompletes: {},   // id -> google.maps.places.Autocomplete
  userLatLng: null,    // browser geolocation for biasing
  directionsService: null,
  placesService: null, // google.maps.places.PlacesService
  _distanceData: [],
  _sortMode: 'closest',
  _allVenues: [],
  meetingTime: null,    // Date object for departure_time
  // Group / Invite
  groupId: null,
  groupCreatedAt: null,
  groupChannel: null,
  groupMembers: {},      // memberId -> { name, address, lat, lng }
  memberId: null,
  myLocationId: null,    // id of first local location ("You")
};

// Client-side route cache: key = "lat1,lng1->lat2,lng2" => route result
const _routeCache = {};
function routeCacheKey(origin, dest) {
  return origin.lat.toFixed(6) + ',' + origin.lng.toFixed(6) + '->' + dest.lat.toFixed(6) + ',' + dest.lng.toFixed(6);
}

// ---------- Client-side Google Maps Rate Limiter ----------
const _gmapsRateLimit = {
  // Per-service limits (requests per minute)
  limits: { geocode: 30, nearby_search: 10, directions: 30, place_details: 10 },
  buckets: {},  // service -> [timestamps]
  check(service) {
    const max = this.limits[service] || 20;
    const now = Date.now();
    const windowStart = now - 60000;
    const bucket = (this.buckets[service] || []).filter(t => t > windowStart);
    if (bucket.length >= max) return false;
    bucket.push(now);
    this.buckets[service] = bucket;
    return true;
  },
};

// ---------- Monthly Google Maps Quota Guard (free-tier protection) ----------
const _gmapsMonthlyQuota = {
  _storageKey: 'gmaps_monthly_usage',
  // Default monthly limits per service (stays within $200 free credit)
  _defaultLimits: { geocode: 2000, nearby_search: 2000, directions: 2000, place_details: 1000 },

  _getLimits() {
    if (typeof CONFIG !== 'undefined' && CONFIG.MAPS_MONTHLY_LIMITS) return CONFIG.MAPS_MONTHLY_LIMITS;
    return this._defaultLimits;
  },

  _load() {
    try {
      var raw = localStorage.getItem(this._storageKey);
      if (raw) {
        var data = JSON.parse(raw);
        // Reset if we're in a new month
        var now = new Date();
        var currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        if (data.month !== currentMonth) {
          return { month: currentMonth, counts: {} };
        }
        return data;
      }
    } catch (e) { /* corrupt data, reset */ }
    var now = new Date();
    return { month: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'), counts: {} };
  },

  _save(data) {
    try { localStorage.setItem(this._storageKey, JSON.stringify(data)); } catch (e) { /* quota full */ }
  },

  /** Returns true if the call is allowed, false if quota exceeded. */
  check(service) {
    var limits = this._getLimits();
    var max = limits[service];
    if (max === undefined) return true; // no limit configured for this service
    var data = this._load();
    var used = data.counts[service] || 0;
    return used < max;
  },

  /** Record a successful API call. Call this AFTER the request is made. */
  record(service) {
    var data = this._load();
    data.counts[service] = (data.counts[service] || 0) + 1;
    this._save(data);
  },

  /** Get remaining calls for a service. */
  remaining(service) {
    var limits = this._getLimits();
    var max = limits[service] || Infinity;
    var data = this._load();
    var used = data.counts[service] || 0;
    return Math.max(0, max - used);
  },
};

function showQuotaExceededPopup() {
  var overlay = document.getElementById('quotaExceededModal');
  if (overlay) overlay.classList.add('visible');
}

function hideQuotaExceededPopup(e) {
  if (e && e.target && e.target.id !== 'quotaExceededModal') return;
  var overlay = document.getElementById('quotaExceededModal');
  if (overlay) overlay.classList.remove('visible');
}

const AVATAR_COLORS = [
  '#FF6B6B', '#48DBFB', '#FECA57', '#FF9FF3', '#54A0FF',
  '#5F27CD', '#01A3A4', '#F368E0', '#EE5A24', '#6AB04C',
];

const NAMES = ['You', 'Alex', 'Jordan', 'Sam', 'Riley', 'Morgan', 'Casey', 'Taylor', 'Quinn', 'Drew'];

// Vibe → Google Places type + keyword mapping (by category)
// Only populated when FEATURE_MORE_OPTIONS is enabled (vibe preset tags are hidden otherwise)
const VIBE_MAP = FEATURE_MORE_OPTIONS ? {
  // Food
  '☕ Cozy café':      { type: 'cafe',       keyword: 'cozy cafe', category: 'food' },
  '🥗 Healthy':        { type: 'restaurant',  keyword: 'healthy salad bowl', category: 'food' },
  '🍸 Rooftop bar':    { type: 'bar',         keyword: 'rooftop bar', category: 'food' },
  '📚 Quiet spot':     { type: 'cafe',        keyword: 'quiet cafe bookstore', category: 'food' },
  '🍕 Fast food':      { type: 'restaurant',  keyword: 'casual dining', category: 'food' },
  '🎉 Party':          { type: 'night_club',  keyword: 'party lounge club', category: 'food' },
  // Play
  '⚽ Sports':         { type: 'stadium',     keyword: 'sports arena stadium', category: 'play' },
  '🏸 Court sports':   { type: 'gym',         keyword: 'badminton pickleball tennis squash court', category: 'play' },
  '🎳 Bowling':        { type: 'bowling_alley', keyword: 'bowling alley lanes', category: 'play' },
  '🌳 Parks':          { type: 'park',        keyword: 'park garden', category: 'play' },
  '🎯 Activities':     { type: 'amusement_park', keyword: 'escape room arcade', category: 'play' },
  '🎱 Gaming':         { type: 'bowling_alley', keyword: 'pool billiards gaming arcade', category: 'play' },
  '🧗 Adventure':      { type: 'gym',         keyword: 'rock climbing trampoline adventure', category: 'play' },
  '♨️ Chill':          { type: 'spa',         keyword: 'spa wellness massage', category: 'play' },
  // Gigs
  '🎬 Cinema':         { type: 'movie_theater', keyword: 'cinema movie movies theater', category: 'gigs' },
  '😂 Comedy':         { type: 'establishment', keyword: 'comedy show standup', category: 'gigs' },
  '🎵 Live music':     { type: 'night_club',  keyword: 'live music concert bar', category: 'gigs' },
  '🎭 Theatre':        { type: 'establishment', keyword: 'theatre drama performing arts', category: 'gigs' },
  '🎨 Art & Culture':  { type: 'art_gallery', keyword: 'art gallery museum exhibition', category: 'gigs' },
  '🎪 Events':         { type: 'establishment', keyword: 'events venue festival', category: 'gigs' },
} : {};

// Map from Google price_level (0-4) to display string
const PRICE_MAP = ['Free', '$', '$$', '$$$', '$$$$'];

const GENERIC_TYPES = new Set([
  'food', 'restaurant', 'cafe', 'point_of_interest', 'establishment',
  'store', 'place_of_worship', 'premise', 'political', 'locality',
  'sublocality', 'neighborhood', 'route', 'street_address',
]);

function filterGenericTypes(types) {
  const meaningful = types
    .filter(t => !GENERIC_TYPES.has(t))
    .slice(0, 2)
    .map(t => t.replace(/_/g, ' '));
  if (meaningful.length === 0) {
    // fallback: use first type cleaned up
    return types[0] ? types[0].replace(/_/g, ' ') : 'Restaurant';
  }
  return meaningful.join(', ');
}

// Icon map for place types
function getVenueIcon(types) {
  if (!types) return 'fa-utensils';
  if (types.includes('cafe')) return 'fa-mug-hot';
  if (types.includes('bar') || types.includes('night_club')) return 'fa-champagne-glasses';
  if (types.includes('bakery')) return 'fa-bread-slice';
  if (types.includes('meal_takeaway') || types.includes('meal_delivery')) return 'fa-pizza-slice';
  if (types.includes('book_store') || types.includes('library')) return 'fa-book';
  if (types.includes('park')) return 'fa-tree';
  if (types.includes('gym') || types.includes('spa')) return 'fa-dumbbell';
  if (types.includes('movie_theater')) return 'fa-film';
  if (types.includes('museum') || types.includes('art_gallery')) return 'fa-palette';
  if (types.includes('shopping_mall') || types.includes('clothing_store')) return 'fa-bag-shopping';
  if (types.includes('stadium') || types.includes('sports_complex')) return 'fa-futbol';
  if (types.includes('bowling_alley')) return 'fa-bowling-ball';
  if (types.includes('amusement_park')) return 'fa-gamepad';
  if (types.includes('zoo') || types.includes('aquarium')) return 'fa-paw';
  return 'fa-utensils';
}

const FALLBACK_COLORS = {
  'fa-mug-hot': '#D97706',
  'fa-champagne-glasses': '#7C3AED',
  'fa-bread-slice': '#EA580C',
  'fa-pizza-slice': '#DC2626',
  'fa-book': '#2563EB',
  'fa-tree': '#16A34A',
  'fa-dumbbell': '#0891B2',
  'fa-film': '#BE185D',
  'fa-palette': '#9333EA',
  'fa-bag-shopping': '#E11D48',
  'fa-utensils': '#6366F1',
  'fa-futbol': '#059669',
  'fa-bowling-ball': '#D946EF',
  'fa-gamepad': '#F97316',
  'fa-paw': '#14B8A6',
};

// ---------- Google Maps Ready Callback ----------
function onGoogleMapsReady() {
  state.googleReady = true;

  // Create a Directions Service instance
  state.directionsService = new google.maps.DirectionsService();

  // Create a PlacesService attached to an off-screen div
  const attrDiv = document.createElement('div');
  state.placesService = new google.maps.places.PlacesService(attrDiv);

  // Attach autocomplete to any existing inputs
  document.querySelectorAll('.location-row input[data-id]').forEach(input => {
    attachGoogleAutocomplete(input);
  });
}

// Lazily request browser location for autocomplete biasing (only on first interaction)
let locationBiasRequested = false;
function requestLocationBias() {
  if (locationBiasRequested || !state.googleReady || !navigator.geolocation) return;
  locationBiasRequested = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLatLng = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
      const bounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(pos.coords.latitude - 0.5, pos.coords.longitude - 0.5),
        new google.maps.LatLng(pos.coords.latitude + 0.5, pos.coords.longitude + 0.5)
      );
      Object.values(state.autocompletes).forEach(ac => ac.setBounds(bounds));
    },
    () => {} // silently ignore denial
  );
}

// Attach Google Places Autocomplete to an input
function attachGoogleAutocomplete(input) {
  if (!state.googleReady) return;
  const id = parseInt(input.dataset.id, 10);
  if (state.autocompletes[id]) return;

  const options = { types: ['geocode', 'establishment'] };
  // Bias to user's location if we have it
  if (state.userLatLng) {
    options.bounds = new google.maps.LatLngBounds(
      new google.maps.LatLng(state.userLatLng.lat() - 0.5, state.userLatLng.lng() - 0.5),
      new google.maps.LatLng(state.userLatLng.lat() + 0.5, state.userLatLng.lng() + 0.5)
    );
  }

  const ac = new google.maps.places.Autocomplete(input, options);
  ac.addListener('place_changed', () => {
    logApiCall('google_maps', 'autocomplete', true, null, null);
    const place = ac.getPlace();
    if (!place.geometry) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    const addr = place.formatted_address || place.name || input.value;
    setLocationForId(id, addr, lat, lng);
  });
  state.autocompletes[id] = ac;
}

// ---------- Session ----------
function initSession() {
  state.sessionId = generateSessionId();

  state.locations = [];
  document.getElementById('locationsList').innerHTML = '';
  locationCounter = 0;
  state.autocompletes = {};
  addLocationInput('You', true);
  state.myLocationId = locationCounter;
  addLocationInput('Friend 1');

  updateFindButton();
}

function generateSessionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// ---------- Mode Toggle ----------
document.getElementById('modeToggle').addEventListener('change', function () {
  state.mode = this.checked ? 'eco' : 'fairness';
  const desc = document.getElementById('modeDescription');
  if (state.mode === 'eco') {
    desc.innerHTML = '<strong>Eco:</strong> Minimize total distance overall';
  } else {
    desc.innerHTML = '<strong>Fair:</strong> No one has to travel too far';
  }
  trackEvent('mode_toggle', { mode: state.mode });
});

// ---------- Location Inputs ----------
let locationCounter = 0;

function addLocationInput(placeholder, showGeoBtn) {
  // Enforce group size limit: 4 free, 12 pro
  const maxLocations = (typeof isProUser === 'function' && isProUser()) ? 12 : 4;
  const currentCount = document.getElementById('locationsList').children.length;
  if (currentCount >= maxLocations) {
    if (typeof isProUser === 'function' && !isProUser()) {
      showToast('Free plan supports up to 4 friends. Upgrade to Pro for 12!');
      if (typeof showUpgradeModal === 'function') showUpgradeModal();
    } else {
      showToast('Maximum of ' + maxLocations + ' locations reached.');
    }
    return;
  }

  locationCounter++;
  const id = locationCounter;
  const idx = document.getElementById('locationsList').children.length;
  const name = placeholder || `Friend ${idx}`;
  const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const initials = name.charAt(0).toUpperCase();

  const row = document.createElement('div');
  row.className = 'location-row';
  row.dataset.id = id;
  row.style.position = 'relative';

  const geoButton = showGeoBtn
    ? `<button class="btn-geolocate" onclick="geolocateUser(${id}, this)" title="Use my location">
         <i class="fa-solid fa-crosshairs"></i>
       </button>`
    : '';

  row.innerHTML = `
    <div class="person-avatar" style="background:${color}" onclick="editPersonName(${id}, this)" title="Click to rename">${initials}</div>
    <input type="text" class="name-input" data-name-id="${id}" value="${name}"
           style="display:none" onblur="savePersonName(${id}, this)" onkeydown="if(event.key==='Enter')this.blur()" />
    <input type="text" placeholder="${name === 'You' ? 'Enter your location...' : 'Enter ' + name + "'s location..."}"
           data-id="${id}" autocomplete="off" />
    ${geoButton}
    <button class="btn-remove" onclick="removeLocation(${id})" title="Remove">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  document.getElementById('locationsList').appendChild(row);

  const input = row.querySelector('input[data-id]');
  input.addEventListener('focus', requestLocationBias, { once: true });
  input.addEventListener('paste', function(e) { handleMapLinkPaste(e, id); });
  if (state.googleReady) {
    attachGoogleAutocomplete(input);
  }

  updateFindButton();
  // Broadcast new friend to group
  if (state.groupId) broadcastMyPresence();
}

// ---------- Google Maps Link Paste Handler ----------
function isGoogleMapLink(text) {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|maps\.google\.com|google\.com\/maps)/i.test(text.trim());
}

function isShortMapLink(text) {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text.trim());
}

function handleMapLinkPaste(e, id) {
  var clipText = (e.clipboardData || window.clipboardData).getData('text');
  if (!clipText) return;
  clipText = clipText.trim();
  if (!isGoogleMapLink(clipText)) return;
  e.preventDefault();
  var input = e.target;
  input.value = 'Loading location...';
  input.disabled = true;

  if (isShortMapLink(clipText)) {
    // Resolve short link via server, then extract coords from full URL
    fetch('/api/resolve-map-link?url=' + encodeURIComponent(clipText))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.resolved) {
          var coords = extractCoordsFromMapLink(data.resolved);
          if (coords) {
            reverseGeocodeAndSet(input, id, coords);
          } else {
            // Couldn't extract coords from resolved URL — try place name from URL
            var placeName = extractPlaceNameFromUrl(data.resolved);
            if (placeName && state.googleReady) {
              geocodeByName(input, id, placeName);
            } else {
              input.disabled = false;
              input.value = '';
              showToast('Could not extract location from link');
            }
          }
        } else {
          input.disabled = false;
          input.value = '';
          showToast('Could not resolve short link');
        }
      })
      .catch(function() {
        input.disabled = false;
        input.value = '';
        showToast('Could not resolve short link');
      });
  } else {
    // Full URL — extract coords directly
    var coords = extractCoordsFromMapLink(clipText);
    if (coords) {
      reverseGeocodeAndSet(input, id, coords);
    } else {
      var placeName = extractPlaceNameFromUrl(clipText);
      if (placeName && state.googleReady) {
        geocodeByName(input, id, placeName);
      } else {
        input.disabled = false;
        input.value = '';
        showToast('Could not extract location from link');
      }
    }
  }
}

function reverseGeocodeAndSet(input, id, coords) {
  if (state.googleReady && google.maps.Geocoder) {
    if (!_gmapsMonthlyQuota.check('geocode')) {
      input.disabled = false;
      var fallback = coords.lat.toFixed(5) + ', ' + coords.lng.toFixed(5);
      input.value = fallback;
      setLocationForId(id, fallback, coords.lat, coords.lng);
      showQuotaExceededPopup();
      return;
    }
    if (!_gmapsRateLimit.check('geocode')) {
      input.disabled = false;
      var fallback = coords.lat.toFixed(5) + ', ' + coords.lng.toFixed(5);
      input.value = fallback;
      setLocationForId(id, fallback, coords.lat, coords.lng);
      showToast('Too many requests — please wait a moment');
      return;
    }
    var geocoder = new google.maps.Geocoder();
    var _gcStart = Date.now();
    geocoder.geocode({ location: { lat: coords.lat, lng: coords.lng } }, function(results, status) {
      if (status === 'OK') _gmapsMonthlyQuota.record('geocode');
      logApiCall('google_maps', 'geocode', status === 'OK', status !== 'OK' ? status : null, Date.now() - _gcStart);
      input.disabled = false;
      if (status === 'OK' && results[0]) {
        var addr = results[0].formatted_address;
        input.value = addr;
        setLocationForId(id, addr, coords.lat, coords.lng);
      } else {
        var fallback = coords.lat.toFixed(5) + ', ' + coords.lng.toFixed(5);
        input.value = fallback;
        setLocationForId(id, fallback, coords.lat, coords.lng);
      }
    });
  } else {
    input.disabled = false;
    var fallback = coords.lat.toFixed(5) + ', ' + coords.lng.toFixed(5);
    input.value = fallback;
    setLocationForId(id, fallback, coords.lat, coords.lng);
  }
}

function geocodeByName(input, id, name) {
  if (!_gmapsMonthlyQuota.check('geocode')) {
    input.disabled = false;
    input.value = '';
    showQuotaExceededPopup();
    return;
  }
  if (!_gmapsRateLimit.check('geocode')) {
    input.disabled = false;
    input.value = '';
    showToast('Too many requests — please wait a moment');
    return;
  }
  var geocoder = new google.maps.Geocoder();
  var _gcStart = Date.now();
  geocoder.geocode({ address: name }, function(results, status) {
    if (status === 'OK') _gmapsMonthlyQuota.record('geocode');
    logApiCall('google_maps', 'geocode', status === 'OK', status !== 'OK' ? status : null, Date.now() - _gcStart);
    input.disabled = false;
    if (status === 'OK' && results[0]) {
      var loc = results[0].geometry.location;
      var addr = results[0].formatted_address;
      input.value = addr;
      setLocationForId(id, addr, loc.lat(), loc.lng());
    } else {
      input.value = '';
      showToast('Could not find location from link');
    }
  });
}

function extractPlaceNameFromUrl(url) {
  // Extract place name from /maps/place/Place+Name/ pattern
  var m = url.match(/\/maps\/place\/([^/@]+)/);
  if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
  return null;
}

function extractCoordsFromMapLink(text) {
  text = text.trim();
  // Not a URL — skip
  if (!/^https?:\/\//i.test(text)) return null;

  var m;
  // google.com/maps/place/.../@lat,lng,... or google.com/maps/@lat,lng,...
  m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // google.com/maps?q=lat,lng or maps.google.com/?q=lat,lng
  m = text.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // google.com/maps?ll=lat,lng
  m = text.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // google.com/maps/dir/lat,lng/...
  m = text.match(/\/maps\/dir\/(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // plus.codes or other formats with coordinates anywhere in path
  m = text.match(/(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);
  if (m) {
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat: lat, lng: lng };
  }

  return null;
}

// ---------- Browser Geolocation ----------
function geolocateUser(id, btn) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }

  requestLocationBias();
  btn.classList.add('locating');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      btn.classList.remove('locating');
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      state.userLatLng = state.googleReady
        ? new google.maps.LatLng(lat, lng)
        : { lat: () => lat, lng: () => lng };
      reverseGeocode(id, lat, lng);
    },
    () => {
      btn.classList.remove('locating');
      showToast('Could not get your location. Please allow location access.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function reverseGeocode(id, lat, lng) {
  const input = document.querySelector(`input[data-id="${id}"]`);

  if (state.googleReady) {
    if (!_gmapsMonthlyQuota.check('geocode')) {
      input.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setLocationForId(id, input.value, lat, lng);
      showQuotaExceededPopup();
      return;
    }
    if (!_gmapsRateLimit.check('geocode')) {
      input.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setLocationForId(id, input.value, lat, lng);
      showToast('Too many requests — please wait a moment');
      return;
    }
    const geocoder = new google.maps.Geocoder();
    var _gcStart = Date.now();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK') _gmapsMonthlyQuota.record('geocode');
      logApiCall('google_maps', 'geocode', status === 'OK', status !== 'OK' ? status : null, Date.now() - _gcStart);
      if (status === 'OK' && results[0]) {
        const address = results[0].formatted_address;
        input.value = address;
        setLocationForId(id, address, lat, lng);
      } else {
        input.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setLocationForId(id, input.value, lat, lng);
      }
    });
  } else {
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json`)
      .then(r => r.json())
      .then(data => {
        const address = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        input.value = address;
        setLocationForId(id, address, lat, lng);
      })
      .catch(() => {
        input.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setLocationForId(id, input.value, lat, lng);
      });
  }
  showToast('Location detected!');
}

function setLocationForId(id, address, lat, lng) {
  const existing = state.locations.find(l => l.id === id);
  if (existing) {
    existing.address = address;
    existing.lat = lat;
    existing.lng = lng;
  } else {
    const idx = Array.from(document.getElementById('locationsList').children)
      .findIndex(r => r.dataset.id === String(id));
    state.locations.push({
      id,
      name: getPersonName(id),
      address,
      lat,
      lng,
    });
  }
  updateFindButton();
  showNameHint(id);
  trackEvent('location_set', { personName: getPersonName(id), address: address, lat: lat, lng: lng });

  // Broadcast location change to group
  if (state.groupId) broadcastMyPresence();
}

// Show a compact tooltip only on the very first address fill per page load
let nameHintFired = false;
function showNameHint(filledId) {
  if (nameHintFired) return;
  const row = document.querySelector('.location-row[data-id="' + filledId + '"]');
  if (!row) return;
  // Skip if the user already renamed this person
  const nameInput = row.querySelector('.name-input');
  const defaultNames = ['You'];
  const idx = Array.from(document.getElementById('locationsList').children)
    .findIndex(r => r.dataset.id === String(filledId));
  if (idx > 0) defaultNames.push('Friend ' + idx);
  const currentName = nameInput ? nameInput.value.trim() : '';
  if (currentName && !defaultNames.includes(currentName)) return;
  nameHintFired = true;
  const avatar = row.querySelector('.person-avatar');
  if (!avatar || avatar.querySelector('.name-hint')) return;

  // In a group, combine "This is you" with "Click to name"
  var inGroup = state.groupId && Object.keys(state.groupMembers).length > 0;
  var hintText = inGroup ? 'This is you. Click to name.' : 'Click to name';
  // If showing combined hint, skip the separate "you" popup
  if (inGroup) row.dataset.youHintShown = '1';

  const hint = document.createElement('span');
  hint.className = 'name-hint';
  hint.textContent = hintText;
  avatar.style.position = 'relative';
  avatar.appendChild(hint);
  setTimeout(function() { hint.classList.add('show'); }, 50);
  setTimeout(function() {
    hint.classList.remove('show');
    setTimeout(function() { hint.remove(); }, 300);
  }, 3000);
}

// Show "This is you" popup and highlight on the user's row when in a group
let youHintFired = false;
function showYouHint() {
  if (youHintFired || !state.groupId) return;
  if (Object.keys(state.groupMembers).length === 0) return;
  youHintFired = true;

  var row = document.querySelector('.location-row[data-id="' + state.myLocationId + '"]:not(.remote-member)');
  if (!row) return;

  // Add highlight ring
  row.classList.add('my-row-highlight');

  // If the name hint already showed a combined popup, skip
  if (row.dataset.youHintShown === '1') return;

  var avatar = row.querySelector('.person-avatar');
  if (!avatar || avatar.querySelector('.name-hint')) return;
  var hint = document.createElement('span');
  hint.className = 'name-hint';
  hint.textContent = 'This is you';
  avatar.style.position = 'relative';
  avatar.appendChild(hint);
  setTimeout(function() { hint.classList.add('show'); }, 50);
  setTimeout(function() {
    hint.classList.remove('show');
    setTimeout(function() { hint.remove(); }, 300);
  }, 4000);
}

function isDefaultName(name) {
  if (!name) return true;
  if (name === 'You' || name === 'Person') return true;
  return /^Friend\s*\d*$/.test(name);
}

function getPersonName(id) {
  const row = document.querySelector('.location-row[data-id="' + id + '"]');
  if (row) {
    const nameInput = row.querySelector('.name-input');
    if (nameInput && nameInput.value.trim()) return nameInput.value.trim();
  }
  const idx = Array.from(document.getElementById('locationsList').children)
    .findIndex(r => r.dataset.id === String(id));
  return idx === 0 ? 'You' : 'Friend ' + idx;
}

function editPersonName(id, avatar) {
  // Don't allow renaming if this is the signed-in user's own row
  if (window._isSignedIn && id === state.myLocationId) return;
  const row = avatar.closest('.location-row');
  const nameInput = row.querySelector('.name-input');
  nameInput.style.display = 'block';
  nameInput.focus();
  nameInput.select();
}

function savePersonName(id, input) {
  input.style.display = 'none';
  const newName = input.value.trim() || 'Person';
  input.value = newName;

  // Update avatar initials and hover title
  const row = input.closest('.location-row');
  const avatar = row.querySelector('.person-avatar');
  avatar.textContent = newName.charAt(0).toUpperCase();
  avatar.title = isDefaultName(newName) ? 'Click to rename' : newName;

  // Update placeholder
  const locInput = row.querySelector('input[data-id]');
  locInput.placeholder = newName === 'You' ? 'Enter your location...' : 'Enter ' + newName + "'s location...";

  // Update state
  const loc = state.locations.find(l => l.id === id);
  if (loc) loc.name = newName;

  // Broadcast name change to group
  if (state.groupId) broadcastMyPresence();
}

function removeLocation(id) {
  const row = document.querySelector(`.location-row[data-id="${id}"]`);
  if (row) {
    row.style.opacity = '0';
    row.style.transform = 'translateX(-20px)';
    row.style.transition = 'all 0.2s ease';
    setTimeout(() => {
      row.remove();
      state.locations = state.locations.filter(l => l.id !== id);
      delete state.autocompletes[id];
      updateFindButton();
      if (state.groupId) broadcastMyPresence();
    }, 200);
  }
}

// ---------- Vibe ----------
function setVibe(btn) {
  if (btn.classList.contains('active')) {
    btn.classList.remove('active');
    state.vibe = '';
    trackEvent('vibe_deselect', { category: state.category });
    return;
  }
  document.querySelectorAll('.vibe-tag').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  state.vibe = btn.textContent.trim();
  document.getElementById('vibeInput').value = '';
  trackEvent('vibe_select', { vibe: state.vibe, category: state.category });
}

function setCategory(cat, btn) {
  state.category = cat;
  state.vibe = '';
  document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderVibeTags();
  trackEvent('category_select', { category: cat });
}

function renderVibeTags() {
  var container = document.getElementById('vibeTags');
  var html = '';
  Object.keys(VIBE_MAP).forEach(function(key) {
    if (VIBE_MAP[key].category === state.category) {
      html += '<button class="vibe-tag" onclick="setVibe(this)">' + key + '</button>';
    }
  });
  container.innerHTML = html;
}

var _vibeCheckTimer = null;
function runVibeCheck() {
  const val = document.getElementById('vibeInput').value.trim();
  if (val) {
    state.vibe = val;
    document.querySelectorAll('.vibe-tag').forEach(t => t.classList.remove('active'));

    // Auto-detect category from the AI prompt
    const detectedCat = detectCategoryFromPrompt(val);
    if (detectedCat && detectedCat !== state.category) {
      state.category = detectedCat;
      document.querySelectorAll('.category-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === detectedCat);
      });
      renderVibeTags();
    }

    // Debounce analytics to avoid firing on every keystroke
    clearTimeout(_vibeCheckTimer);
    _vibeCheckTimer = setTimeout(function() {
      trackEvent('ai_prompt_input', { prompt: val, category: state.category });
    }, 800);
  } else {
    state.vibe = '';
  }
}

function detectCategoryFromPrompt(prompt) {
  const p = prompt.toLowerCase();

  const playKeywords = [
    'sport', 'badminton', 'tennis', 'cricket', 'football', 'soccer', 'basketball',
    'swim', 'pool', 'gym', 'workout', 'fitness', 'yoga', 'hike', 'hiking', 'trek',
    'climb', 'bowling', 'arcade', 'gaming', 'game', 'trampoline', 'skate', 'skating',
    'cycling', 'bike', 'park', 'garden', 'adventure', 'paintball', 'laser tag',
    'go kart', 'karting', 'spa', 'massage', 'wellness', 'escape room', 'billiard',
    'snooker', 'golf', 'mini golf', 'ping pong', 'table tennis', 'volleyball',
    'running', 'jogging', 'boxing', 'martial art', 'karate', 'judo', 'gym',
    'playground', 'outdoor', 'picnic', 'kayak', 'surf', 'pickleball', 'squash',
    'court', 'racket', 'racquet', 'turf', 'futsal', 'cricket net',
  ];

  const gigsKeywords = [
    'movie', 'cinema', 'film', 'theater', 'theatre', 'comedy', 'standup', 'stand-up',
    'concert', 'live music', 'gig', 'show', 'performance', 'drama', 'musical',
    'art', 'gallery', 'museum', 'exhibition', 'exhibit', 'festival', 'event',
    'opera', 'ballet', 'dance show', 'magic show', 'karaoke', 'open mic',
    'poetry', 'spoken word', 'jazz', 'orchestra', 'symphony',
  ];

  for (const kw of playKeywords) {
    if (p.includes(kw)) return 'play';
  }
  for (const kw of gigsKeywords) {
    if (p.includes(kw)) return 'gigs';
  }
  return null; // no match — keep current category
}

// ---------- Find Sweet Spot ----------
function showResultsLoading(message) {
  var layout = document.querySelector('.results-layout-inline');
  if (!layout) return;
  var existing = layout.querySelector('.results-loading-overlay');
  if (existing) {
    // Just update text, don't recreate the bar
    var textEl = existing.querySelector('.results-loading-text');
    if (textEl) textEl.textContent = message;
    return;
  }
  var overlay = document.createElement('div');
  overlay.className = 'results-loading-overlay';
  overlay.innerHTML = '<div class="results-loading-text">' + message + '</div><div class="results-loading-bar"><div class="results-loading-bar-fill"></div></div>';
  layout.appendChild(overlay);
  // Kick off the bar at 0 then smoothly advance
  var fill = overlay.querySelector('.results-loading-bar-fill');
  fill.offsetWidth; // force reflow
  fill.style.width = '30%';
}

function setLoadingProgress(pct) {
  var fill = document.querySelector('.results-loading-bar-fill');
  if (fill) fill.style.width = pct + '%';
}

function hideResultsLoading() {
  var fill = document.querySelector('.results-loading-bar-fill');
  if (!fill) {
    var overlay = document.querySelector('.results-loading-overlay');
    if (overlay) overlay.remove();
    return;
  }
  // Smoothly jump to 100%, then remove after transition
  fill.style.width = '100%';
  setTimeout(function () {
    var overlay = document.querySelector('.results-loading-overlay');
    if (overlay) overlay.remove();
  }, 350);
}

function updateFindButton() {
  const btn = document.getElementById('findBtn');
  btn.disabled = state.locations.length < 2;
}

function toggleMoreOptions() {
  const section = document.querySelector('.more-options-section');
  const body = document.getElementById('moreOptionsBody');
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  section.classList.toggle('open', open);
}

function onDatePicked(input) {
  const display = document.getElementById('meetDateDisplay');
  if (!input.value) {
    display.textContent = 'Today';
  } else {
    const d = new Date(input.value + 'T00:00');
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      display.textContent = 'Today';
    } else {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      display.textContent = days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
    }
  }
  updateMeetingTime();
}

function onHourPicked(sel) {
  const display = document.getElementById('meetHourDisplay');
  display.textContent = sel.options[sel.selectedIndex].text;
  updateMeetingTime();
}

function updateMeetingTime() {
  const dateVal = document.getElementById('meetDateHidden').value;
  const hourVal = document.getElementById('meetHour').value;
  if (dateVal && hourVal !== '') {
    state.meetingTime = new Date(dateVal + 'T' + String(hourVal).padStart(2, '0') + ':00');
  } else if (dateVal) {
    state.meetingTime = new Date(dateVal + 'T12:00');
  } else if (hourVal !== '') {
    const today = new Date();
    const y = today.getFullYear(), m = String(today.getMonth() + 1).padStart(2, '0'), d = String(today.getDate()).padStart(2, '0');
    state.meetingTime = new Date(y + '-' + m + '-' + d + 'T' + String(hourVal).padStart(2, '0') + ':00');
  } else {
    state.meetingTime = null;
  }
}

function findSweetSpot() {
  if (state.locations.length < 2) return;

  state._sortMode = 'closest';
  _currentShareCode = null;
  _currentShareResultsKey = null;

  const btn = document.getElementById('findBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Calculating...';

  // Log search to Supabase
  const aiPrompt = document.getElementById('vibeInput').value.trim();

  // Ensure state.vibe is set from the input (onchange/oninput may not have fired on iOS/Windows)
  if (aiPrompt && !state.vibe) {
    state.vibe = aiPrompt;
  }

  if (aiPrompt) {
    trackEvent('ai_prompt_input', { prompt: aiPrompt, category: state.category });
  }
  logSearch(state.mode, state.vibe, aiPrompt, state.locations, state.meetingTime);
  trackEvent('find_sweet_spot', {
    mode: state.mode,
    category: state.category,
    vibe: state.vibe,
    aiPrompt: aiPrompt || null,
    locationCount: state.locations.length,
    locations: state.locations.map(l => ({ name: l.name, address: l.address, lat: l.lat, lng: l.lng })),
  });

  const center = computeCenter(state.locations, state.mode);

  // Show results section
  const section = document.getElementById('resultsSection');
  section.style.display = 'block';
  document.getElementById('shareBtn').style.display = '';

  // Set mode badge
  const badge = document.getElementById('resultModeBadge');
  if (state.mode === 'eco') {
    badge.innerHTML = '<i class="fa-solid fa-leaf"></i> Eco';
    badge.className = 'results-mode-badge eco';
  } else {
    badge.innerHTML = '😊 Fair';
    badge.className = 'results-mode-badge';
  }

  // Show loading indicators
  var summaryEl = document.getElementById('resultsSummary');
  if (summaryEl) summaryEl.innerHTML = '';
  document.getElementById('resultsList').innerHTML = '';
  showResultsLoading('Searching nearby venues...');

  setTimeout(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);

  // Step 1: If user typed a free-form AI prompt, extract smart keywords first
  const aiPromptText = document.getElementById('vibeInput').value.trim();
  const vibeEntry = VIBE_MAP[state.vibe] || null;
  const isFreeTextPrompt = aiPromptText && !vibeEntry;

  const _doSearch = async function(aiKeywords) {
    // Step 2: Search for real places near center (with AI keywords if available)
    showResultsLoading('Searching nearby venues...');
    setLoadingProgress(40);
    const venues_raw = await searchNearbyPlaces(center, aiKeywords);
    if (!venues_raw || venues_raw.length === 0) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Find the midway';
      return;
    }

    // Step 2.5: If AI prompt, fetch Google reviews and let AI filter by review content
    var venues = rankVenuesByMode(venues_raw);
    if (isFreeTextPrompt && venues.length > 0) {
      showResultsLoading('AI is reading reviews...');
      setLoadingProgress(55);
      await fetchVenueReviews(venues);
      try {
        venues = await aiFilterByReviews(aiPromptText, venues);
      } catch (e) {
        console.warn('AI review filter failed, using keyword results:', e);
      }
    }

    // Step 3: Initial rank by haversine to pick top candidates
    venues = rankVenuesByMode(venues);
    const top5 = venues.slice(0, 5);
    const rest = venues.slice(5);

    // Step 4: Fetch real driving distances for top 5 venues (parallel per venue)
    showResultsLoading('Calculating real driving routes...');
    setLoadingProgress(65);
    await Promise.all(top5.map(async (v) => {
      if (v._routeData) return; // already fetched
      var routeData = await fetchRealDistances({ lat: v.lat, lng: v.lng });
      v._routeData = routeData;
      v._realDists = routeData.map(d => d.distKm);
      v._realTimes = routeData.map(d => d.durationMin);
    }));

    // Step 5: Re-rank top 5 using real driving data
    var reranked = rankVenuesByMode(top5);
    venues = reranked.concat(rest);
    venues.forEach((v, idx) => { v.id = idx + 1; });

    state._allVenues = venues;
    const venueLimit = (typeof isProUser === 'function' && isProUser()) ? 10 : 5;
    state.results = venues.slice(0, venueLimit);
    state.chosenVenue = state.results[0] || null;
    state._resultsLocationCount = state.locations.length;

    // Step 6: Use the already-fetched route data for #1
    const destination = state.chosenVenue
      ? { lat: state.chosenVenue.lat, lng: state.chosenVenue.lng }
      : center;

    let distanceData;
    if (state.chosenVenue && state.chosenVenue._routeData) {
      distanceData = state.chosenVenue._routeData;
    } else {
      distanceData = await fetchRealDistances(destination);
      if (state.chosenVenue) {
        state.chosenVenue._routeData = distanceData;
        state.chosenVenue._realDists = distanceData.map(d => d.distKm);
        state.chosenVenue._realTimes = distanceData.map(d => d.durationMin);
      }
    }
    state._distanceData = distanceData;

    setLoadingProgress(90);
    hideResultsLoading();
    renderVenueList();
    renderMap(destination, distanceData);

    trackEvent('venues_shown', {
      count: state.results.length,
      venues: state.results.map((v, i) => ({
        rank: i + 1,
        name: v.name,
        placeId: v.placeId,
        rating: v.rating,
        lat: v.lat,
        lng: v.lng,
        vicinity: v.vicinity || null,
      })),
    });

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Find the Midway';

    // Fetch AI overlap notes
    if (state.results.length > 0) {
      fetchOverlapNotes(state.results);
    }
  };

  if (isFreeTextPrompt) {
    // AI prompt detected — extract smart keywords before searching
    showResultsLoading('AI is understanding your vibe...');
    setLoadingProgress(15);
    aiExtractKeywords(aiPromptText).then(function(aiKeywords) {
      _doSearch(aiKeywords); // aiKeywords is null if AI failed (falls back to simple keyword)
    });
  } else {
    // VIBE_MAP tag selected or no prompt — go straight to keyword search
    _doSearch(null);
  }
}

// ---------- Google Places Nearby Search ----------
function searchNearbyPlaces(center, aiKeywords) {
  return new Promise((resolve) => {
    if (!state.googleReady || !state.placesService) {
      resolve(generateFallbackVenues(center));
      return;
    }

    var keyword, placeType;

    if (aiKeywords && aiKeywords.keyword) {
      // AI-extracted keywords take priority
      keyword = aiKeywords.keyword;
      placeType = aiKeywords.type || null;
    } else {
      // Fallback: existing VIBE_MAP / raw text keyword logic
      const vibeEntry = VIBE_MAP[state.vibe] || null;
      const categoryDefaults = {
        food: { type: 'restaurant', keyword: 'restaurant' },
        play: { type: 'park', keyword: 'sports park activities' },
        gigs: { type: 'movie_theater', keyword: 'cinema entertainment' },
      };
      const catDefault = categoryDefaults[state.category] || categoryDefaults.food;
      const isFreeText = state.vibe && !vibeEntry;
      placeType = vibeEntry ? vibeEntry.type : (isFreeText ? null : catDefault.type);
      keyword = vibeEntry ? vibeEntry.keyword : (state.vibe || catDefault.keyword);
    }

    function parseResults(results) {
      return results.filter(p => (p.user_ratings_total || 0) >= 50).map((p, i) => {
        const vLat = p.geometry.location.lat();
        const vLng = p.geometry.location.lng();
        var isOpen = null;
        try { isOpen = p.opening_hours ? p.opening_hours.isOpen() : null; } catch(e) {}
        return {
          id: i + 1,
          name: p.name,
          type: p.types ? filterGenericTypes(p.types) : 'Restaurant',
          rating: p.rating || 0,
          userRatingsTotal: p.user_ratings_total || 0,
          price: PRICE_MAP[p.price_level] || '$$',
          icon: getVenueIcon(p.types),
          lat: vLat,
          lng: vLng,
          address: p.vicinity || '',
          placeId: p.place_id,
          _photosObj: p.photos && p.photos[0] ? p.photos[0] : null,
          photo: p.photos && p.photos[0] ? p.photos[0].getUrl({ maxWidth: 200 }) : null,
          distance: haversine(center.lat, center.lng, vLat, vLng).toFixed(1),
          isOpen: isOpen,
          businessStatus: p.business_status || null,
        };
      });
    }

    const request = {
      location: new google.maps.LatLng(center.lat, center.lng),
      radius: 3000,
      keyword: keyword,
    };
    if (placeType) request.type = placeType;

    if (!_gmapsMonthlyQuota.check('nearby_search')) {
      showQuotaExceededPopup();
      resolve(generateFallbackVenues(center));
      return;
    }
    if (!_gmapsRateLimit.check('nearby_search')) {
      showToast('Too many searches — please wait a moment');
      resolve(generateFallbackVenues(center));
      return;
    }
    var _nsStart = Date.now();
    state.placesService.nearbySearch(request, (results, status) => {
      _gmapsMonthlyQuota.record('nearby_search');
      logApiCall('google_maps', 'nearby_search', status === google.maps.places.PlacesServiceStatus.OK, status !== google.maps.places.PlacesServiceStatus.OK ? status : null, Date.now() - _nsStart);
      if (status === google.maps.places.PlacesServiceStatus.OK && results.length > 0) {
        let venues = parseResults(results);
        venues = rankVenuesByMode(venues);
        venues.forEach((v, idx) => { v.id = idx + 1; });
        const limit = 10;

        if (venues.length < 5) {
          const widerRequest = { ...request, radius: 5000 };
          if (!_gmapsMonthlyQuota.check('nearby_search') || !_gmapsRateLimit.check('nearby_search')) {
            resolve(venues.slice(0, limit));
            return;
          }
          var _ns2Start = Date.now();
          state.placesService.nearbySearch(widerRequest, (results2, status2) => {
            _gmapsMonthlyQuota.record('nearby_search');
            logApiCall('google_maps', 'nearby_search', status2 === google.maps.places.PlacesServiceStatus.OK, status2 !== google.maps.places.PlacesServiceStatus.OK ? status2 : null, Date.now() - _ns2Start);
            if (status2 === google.maps.places.PlacesServiceStatus.OK && results2.length > 0) {
              const moreVenues = parseResults(results2);
              const seen = new Set(venues.map(v => v.placeId));
              for (const v of moreVenues) {
                if (!seen.has(v.placeId)) { venues.push(v); seen.add(v.placeId); }
              }
              venues = rankVenuesByMode(venues);
              venues.forEach((v, idx) => { v.id = idx + 1; });
            }
            resolve(venues.slice(0, limit));
          });
        } else {
          resolve(venues.slice(0, limit));
        }
      } else {
        resolve(generateFallbackVenues(center));
      }
    });
  });
}

// Rank venues by mode — uses real driving distances & times when available
// Pareto dominance: if ALL parties have shorter real distance AND shorter drive time
// to venue A than B, A always ranks higher regardless of fairness gap.
function rankVenuesByMode(venues) {
  venues.forEach(v => {
    // Use real distances if fetched, else fall back to haversine
    v._dists = v._realDists || state.locations.map(loc => haversine(v.lat, v.lng, loc.lat, loc.lng));
    v._times = v._realTimes || null;
    if (state.mode === 'eco') {
      v._score = v._dists.reduce((s, d) => s + d, 0);        // total real distance
    } else {
      v._score = Math.max(...v._dists) - Math.min(...v._dists);  // fairness gap
    }
  });

  if (state.mode === 'eco') {
    return venues.sort((a, b) => a._score - b._score);
  }

  // Fairness mode: Pareto dominance on real distances AND real drive times
  return venues.sort((a, b) => {
    // Check distance dominance
    const aDomB_dist = a._dists.every((d, i) => d <= b._dists[i]) && a._dists.some((d, i) => d < b._dists[i]);
    const bDomA_dist = b._dists.every((d, i) => d <= a._dists[i]) && b._dists.some((d, i) => d < a._dists[i]);

    // Check drive time dominance (only when both have real times)
    const hasTimes = a._times && b._times && a._times.every(t => t !== null) && b._times.every(t => t !== null);
    if (hasTimes) {
      const aDomB_time = a._times.every((t, i) => t <= b._times[i]) && a._times.some((t, i) => t < b._times[i]);
      const bDomA_time = b._times.every((t, i) => t <= a._times[i]) && b._times.some((t, i) => t < a._times[i]);
      // A dominates if shorter on both distance AND time for all parties
      const aDomB = aDomB_dist && aDomB_time;
      const bDomA = bDomA_dist && bDomA_time;
      if (aDomB && !bDomA) return -1;
      if (bDomA && !aDomB) return 1;
    } else {
      // No real times — use distance dominance only
      if (aDomB_dist && !bDomA_dist) return -1;
      if (bDomA_dist && !aDomB_dist) return 1;
    }
    return a._score - b._score;      // neither dominates — fall back to fairness gap
  });
}

// ---------- AI Vibe Ranking ----------
function buildAIPrompt(userVibe, venues) {
  const venueList = venues.map((v, i) =>
    `${i + 1}. "${v.name}" — type: ${v.type}, rating: ${v.rating} (${v.userRatingsTotal} reviews), price: ${v.price}, address: ${v.address}`
  ).join('\n');

  return `A user is looking for a place to meet friends. Their vibe request is: "${userVibe}"

Here are ${venues.length} candidate venues near the meetup location:
${venueList}

Based on the user's vibe, rank these venues from MOST to LEAST relevant. Consider the venue name, type, rating, price level, and how well it matches the described vibe.

Return ONLY a JSON array of the venue numbers in order from best to worst match, like [3,1,5,2,4]. No explanation, just the JSON array.`;
}

function buildOverlapPrompt(venues, category) {
  var catLabel = { food: 'food & dining', play: 'sports & activities', gigs: 'entertainment & events' }[category] || 'dining';
  var venueList = venues.map(function(v, i) {
    return (i + 1) + '. "' + v.name + '" — type: ' + v.type + ', address: ' + v.address;
  }).join('\n');

  return 'The user searched for ' + catLabel + ' venues. For each venue below, if it offers something notable BEYOND its primary category (e.g. a restaurant that also has live music, or a bowling alley with a great bar), write a brief 6-10 word note. If there is no notable overlap, write "none".\n\n' + venueList + '\n\nReturn ONLY a JSON array of strings, one per venue in order. Example: ["Live DJ nights on weekends", "none", "Also has mini-golf course"]. No explanation, just the JSON array.';
}

async function _getAccessToken() {
  if (!_supabaseClient) return null;
  try {
    const { data: { session } } = await _supabaseClient.auth.getSession();
    return session?.access_token || null;
  } catch { return null; }
}

// ---------- AI Keyword Extraction (search-layer AI) ----------
async function aiExtractKeywords(userPrompt) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = await _getAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api/ai-keywords', {
      method: 'POST',
      headers,
      body: JSON.stringify({ userPrompt }),
    });
    if (!res.ok) throw new Error('AI keywords HTTP ' + res.status);
    const data = await res.json();
    if (data.ai_meta && data.ai_meta.attempts) {
      data.ai_meta.attempts.forEach(function(a) {
        logApiCall(a.provider, 'ai_keywords', a.success, a.error || null, a.latency_ms || null);
      });
    }
    if (data.keyword) {
      return { keyword: data.keyword, type: data.type || null };
    }
  } catch (e) {
    console.warn('AI keyword extraction failed, falling back to simple keywords:', e.message);
  }
  return null; // fallback to existing keyword logic
}

// ---------- Fetch Google Reviews for Venues ----------
function fetchVenueReviews(venues) {
  // Fetch reviews for up to 5 venues via Place Details API
  var toFetch = venues.slice(0, 5);
  return Promise.all(toFetch.map(function(v) {
    return new Promise(function(resolve) {
      if (!v.placeId || !state.placesService) { resolve(v); return; }
      if (!_gmapsMonthlyQuota.check('place_details') || !_gmapsRateLimit.check('place_details')) { resolve(v); return; }
      var _pdStart = Date.now();
      state.placesService.getDetails(
        { placeId: v.placeId, fields: ['reviews'] },
        function(place, status) {
          if (status === google.maps.places.PlacesServiceStatus.OK) _gmapsMonthlyQuota.record('place_details');
          logApiCall('google_maps', 'place_details', status === google.maps.places.PlacesServiceStatus.OK, status !== google.maps.places.PlacesServiceStatus.OK ? status : null, Date.now() - _pdStart);
          if (status === google.maps.places.PlacesServiceStatus.OK && place && place.reviews) {
            v._reviews = place.reviews.slice(0, 3).map(function(r) { return r.text || ''; }).filter(Boolean);
          }
          resolve(v);
        }
      );
    });
  }));
}

// ---------- AI Review-Based Filtering ----------
async function aiFilterByReviews(userPrompt, venues) {
  var venuesWithReviews = venues.filter(function(v) { return v._reviews && v._reviews.length > 0; });
  if (venuesWithReviews.length === 0) return venues;

  var venueList = venues.map(function(v, i) {
    var reviewSnippets = (v._reviews || []).map(function(r) { return r.slice(0, 150); }).join(' | ');
    return (i + 1) + '. "' + v.name + '" — type: ' + v.type + ', rating: ' + v.rating + (reviewSnippets ? ', reviews: ' + reviewSnippets : '');
  }).join('\n');

  var prompt = 'A user wants: "' + userPrompt + '"\n\nHere are ' + venues.length + ' venues with their Google reviews:\n' + venueList + '\n\nBased on the reviews and venue info, return a JSON array of venue numbers (1-indexed) that genuinely match what the user wants, from BEST to WORST match. Exclude venues that clearly don\'t fit. Return ONLY the JSON array like [3,1,5]. No explanation.';

  try {
    var headers = { 'Content-Type': 'application/json' };
    var token = await _getAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch('/api/ai-rank', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ prompt: prompt }),
    });
    if (!res.ok) throw new Error('AI filter HTTP ' + res.status);
    var data = await res.json();
    if (data.ai_meta && data.ai_meta.attempts) {
      data.ai_meta.attempts.forEach(function(a) {
        logApiCall(a.provider, 'ai_review_filter', a.success, a.error || null, a.latency_ms || null);
      });
    }
    if (Array.isArray(data.ranking) && data.ranking.length > 0) {
      return applyAIRanking(venues, data.ranking);
    }
  } catch (e) {
    console.warn('AI review filtering failed:', e.message);
  }
  return venues;
}

async function aiVibeRank(userVibe, venues) {
  if (!userVibe || venues.length === 0) return venues;

  const prompt = buildAIPrompt(userVibe, venues);

  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = await _getAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api/ai-rank', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error('Proxy HTTP ' + res.status);
    const data = await res.json();
    // Log each AI provider attempt
    if (data.ai_meta && data.ai_meta.attempts) {
      data.ai_meta.attempts.forEach(function(a) {
        logApiCall(a.provider, 'ai_rank', a.success, a.error || null, a.latency_ms || null);
      });
    }
    if (Array.isArray(data.ranking) && data.ranking.length > 0) {
      return applyAIRanking(venues, data.ranking);
    }
  } catch (e) {
    console.warn('AI vibe ranking failed:', e.message);
  }

  return venues;
}

function applyAIRanking(venues, ranking) {
  const reordered = [];
  const used = new Set();
  for (const idx of ranking) {
    const v = venues[idx - 1]; // 1-indexed
    if (v && !used.has(idx)) {
      reordered.push(v);
      used.add(idx);
    }
  }
  // Append any venues not mentioned by AI
  venues.forEach((v, i) => {
    if (!used.has(i + 1)) reordered.push(v);
  });
  // Re-assign ids
  reordered.forEach((v, i) => { v.id = i + 1; });
  return reordered;
}

function fetchOverlapNotes(venues) {
  var prompt = buildOverlapPrompt(venues, state.category);
  var headers = { 'Content-Type': 'application/json' };
  _getAccessToken().then(function(token) {
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch('/api/ai-rank', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ prompt: prompt }),
    });
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (Array.isArray(data.ranking) && data.ranking.length > 0) {
      data.ranking.forEach(function(note, i) {
        if (i < venues.length && note && note !== 'none') {
          venues[i]._overlapNote = note;
        }
      });
      // Re-render to show notes
      renderVenueList();
    }
  })
  .catch(function() { /* silently ignore */ });
}

// Fallback if Google isn't loaded
function generateFallbackVenues(center) {
  const templates = [
    { name: 'Nearby Cafe', type: 'cafe', icon: 'fa-mug-hot' },
    { name: 'Local Restaurant', type: 'restaurant', icon: 'fa-utensils' },
    { name: 'Corner Bistro', type: 'bistro', icon: 'fa-wine-glass' },
  ];
  return templates.map((v, i) => {
    const angle = (i / 3) * 2 * Math.PI;
    const r = 0.005 + Math.random() * 0.01;
    return {
      ...v, id: i + 1, rating: 4.0, price: '$$',
      lat: center.lat + Math.sin(angle) * r,
      lng: center.lng + Math.cos(angle) * r,
      distance: (0.5 + Math.random() * 1.5).toFixed(1),
      userRatingsTotal: 0, address: '', placeId: null, photo: null,
    };
  });
}

// ---------- Google Directions — Real Route Distances ----------

// Fetch a single driving route from origin to destination (with cache)
function fetchOneRoute(origin, dest, retries) {
  retries = retries || 0;
  const cKey = routeCacheKey(origin, dest);
  if (_routeCache[cKey]) return Promise.resolve(_routeCache[cKey]);
  return new Promise((res) => {
    if (!state.googleReady || !state.directionsService) {
      const result = {
        distKm: haversine(dest.lat, dest.lng, origin.lat, origin.lng),
        durationMin: null,
        routePoints: [[origin.lat, origin.lng], [dest.lat, dest.lng]],
      };
      _routeCache[cKey] = result;
      res(result);
      return;
    }
    var _dirStart = Date.now();
    if (!_gmapsMonthlyQuota.check('directions')) {
      const fallback = {
        distKm: haversine(dest.lat, dest.lng, origin.lat, origin.lng),
        durationMin: null,
        routePoints: [[origin.lat, origin.lng], [dest.lat, dest.lng]],
      };
      _routeCache[cKey] = fallback;
      res(fallback);
      return;
    }
    if (!_gmapsRateLimit.check('directions')) {
      const fallback = {
        distKm: haversine(dest.lat, dest.lng, origin.lat, origin.lng),
        durationMin: null,
        routePoints: [[origin.lat, origin.lng], [dest.lat, dest.lng]],
      };
      // Don't cache rate-limited fallbacks so they can be retried
      res(fallback);
      return;
    }
    state.directionsService.route({
      origin: new google.maps.LatLng(origin.lat, origin.lng),
      destination: new google.maps.LatLng(dest.lat, dest.lng),
      travelMode: google.maps.TravelMode.DRIVING,
      drivingOptions: state.meetingTime
        ? { departureTime: state.meetingTime, trafficModel: 'bestguess' }
        : { departureTime: new Date() },
    }, (result, status) => {
      if (status === 'OK') _gmapsMonthlyQuota.record('directions');
      logApiCall('google_maps', 'directions', status === 'OK', status !== 'OK' ? status : null, Date.now() - _dirStart);
      if (status === 'OK' && result.routes[0]) {
        const leg = result.routes[0].legs[0];
        const dur = leg.duration_in_traffic
          ? Math.round(leg.duration_in_traffic.value / 60)
          : Math.round(leg.duration.value / 60);
        const routeResult = {
          distKm: leg.distance.value / 1000,
          durationMin: dur,
          routePoints: decodeOverviewPolyline(result.routes[0].overview_polyline),
        };
        _routeCache[cKey] = routeResult;
        res(routeResult);
      } else if (status === 'OVER_QUERY_LIMIT' && retries < 3) {
        setTimeout(function() {
          fetchOneRoute(origin, dest, retries + 1).then(res);
        }, 1000 * (retries + 1));
      } else {
        const fallback = {
          distKm: haversine(dest.lat, dest.lng, origin.lat, origin.lng),
          durationMin: null,
          routePoints: [[origin.lat, origin.lng], [dest.lat, dest.lng]],
        };
        _routeCache[cKey] = fallback;
        res(fallback);
      }
    });
  });
}

// Fetch real driving distances from all people to a single destination (parallel)
function fetchRealDistances(center) {
  return Promise.all(
    state.locations.map(loc =>
      fetchOneRoute(loc, center, 0).then(route => ({ loc, ...route }))
    )
  );
}

// Fetch real driving distances from all people to ALL candidate venues
// Attaches _realDists (km), _realTimes (min), _routeData to each venue
function fetchAllVenueDistances(venues) {
  return new Promise(async (resolve) => {
    for (const v of venues) {
      v._realDists = [];
      v._realTimes = [];
      v._routeData = [];
      for (const loc of state.locations) {
        const route = await fetchOneRoute(loc, v, 0);
        v._realDists.push(route.distKm);
        v._realTimes.push(route.durationMin);
        v._routeData.push({ loc, ...route });
      }
    }
    resolve(venues);
  });
}

// Decode Google's overview_polyline into an array of [lat, lng]
function decodeOverviewPolyline(overviewPolyline) {
  const encoded = overviewPolyline;
  const str = (typeof encoded === 'string') ? encoded : (encoded.points || '');
  if (!str) return [];

  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// ---------- Center Calculation ----------
function computeCenter(locations, mode) {
  if (mode === 'eco') {
    // Weiszfeld's algorithm for geometric median
    let cx = locations.reduce((s, l) => s + l.lat, 0) / locations.length;
    let cy = locations.reduce((s, l) => s + l.lng, 0) / locations.length;
    for (let iter = 0; iter < 100; iter++) {
      let numX = 0, numY = 0, den = 0;
      for (const loc of locations) {
        const dist = Math.sqrt((loc.lat - cx) ** 2 + (loc.lng - cy) ** 2);
        if (dist < 1e-10) continue;
        const w = 1 / dist;
        numX += w * loc.lat;
        numY += w * loc.lng;
        den += w;
      }
      if (den === 0) break;
      cx = numX / den;
      cy = numY / den;
    }
    return { lat: cx, lng: cy };
  } else {
    // Minimax iterative for fairness
    let cx = locations.reduce((s, l) => s + l.lat, 0) / locations.length;
    let cy = locations.reduce((s, l) => s + l.lng, 0) / locations.length;
    for (let iter = 0; iter < 50; iter++) {
      let maxDist = 0, farthest = null;
      for (const loc of locations) {
        const dist = haversine(cx, cy, loc.lat, loc.lng);
        if (dist > maxDist) { maxDist = dist; farthest = loc; }
      }
      if (!farthest) break;
      cx += (farthest.lat - cx) * 0.1;
      cy += (farthest.lng - cy) * 0.1;
    }
    return { lat: cx, lng: cy };
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}



// ---------- Render Venue List ----------
function renderVenueList() {
  if (state.results.length === 0) {
    document.getElementById('resultsList').innerHTML =
      '<div style="text-align:center;padding:24px;color:#9CA3AF;">No venues found nearby.</div>';
    return;
  }

  const sortHtml = `
    <div class="sort-bar">
      <button class="sort-btn ${state._sortMode === 'closest' ? 'active' : ''}" onclick="sortVenues('closest')">Closest</button>
      <button class="sort-btn ${state._sortMode === 'rating' ? 'active' : ''}" onclick="sortVenues('rating')">Highest Rated</button>
      <button class="sort-btn ${state._sortMode === 'cheapest' ? 'active' : ''}" onclick="sortVenues('cheapest')">Cheapest</button>
    </div>
  `;

  const listHtml = getSortedVenues().map((v, i) => `
    <div class="venue-card ${i === 0 ? 'top-pick' : ''} ${v.id === (state.chosenVenue ? state.chosenVenue.id : state.results[0].id) ? 'active' : ''}" data-vid="${v.id}" onclick="selectVenue(${v.id})">
      <div class="venue-photo-placeholder${v.photo ? ' photo-loading' : ''}" data-photo-vid="${v.id}" style="background:${FALLBACK_COLORS[v.icon] || '#6366F1'};cursor:pointer" onclick="event.stopPropagation(); ${v.placeId ? 'openGoogleMapsPlace(\'' + v.placeId + '\')' : 'bookVenue(\'' + encodeURIComponent(v.name) + '\')'}"><i class="fa-solid ${v.photo ? 'fa-spinner fa-spin' : v.icon}"></i></div>
      <div class="venue-rank">${i + 1}</div>
      <div class="venue-info">
        <div class="venue-name">${escapeHtml(v.name)}</div>
        <div class="venue-type"><i class="fa-solid ${v.icon}"></i> ${escapeHtml(v.type)}</div>
        <div class="venue-meta">
          ${v.rating ? '<span class="stars"><i class="fa-solid fa-star"></i> ' + v.rating + '</span>' : ''}
          ${v.userRatingsTotal ? '<span>(' + v.userRatingsTotal + ')</span>' : ''}
          <span>${escapeHtml(v.price)}</span>
        </div>
        ${v._overlapNote ? '<div class="venue-overlap-note"><i class="fa-solid fa-sparkles"></i> ' + escapeHtml(v._overlapNote) + '</div>' : ''}
      </div>
      <div class="venue-actions">
        ${v.placeId
          ? '<button class="btn-tiny" onclick="event.stopPropagation(); openGoogleMapsPlace(\'' + v.placeId + '\')">View</button>'
          : '<button class="btn-tiny" onclick="event.stopPropagation(); bookVenue(\'' + encodeURIComponent(v.name) + '\')">Search</button>'
        }
        <button class="btn-tiny book" onclick="event.stopPropagation(); selectVenue(${v.id}); showShareModal()"><i class="fa-solid fa-share-nodes"></i> Share</button>
      </div>
    </div>
  `).join('');

  const canLoadMore = state._allVenues.length > state.results.length;
  const moreBtn = canLoadMore ? `
    <div class="find-more-wrap">
      <button class="btn-find-more" id="findMoreBtn" onclick="loadMoreOptions()">
        <i class="fa-solid fa-plus"></i> Find more options
      </button>
    </div>
  ` : '';

  document.getElementById('resultsList').innerHTML = sortHtml + listHtml + moreBtn;

  // Toggle expanded mode: scroll only when showing more than 5
  const layout = document.querySelector('.results-layout-inline');
  if (layout) {
    if (state.results.length > 5) layout.classList.add('expanded');
    else layout.classList.remove('expanded');
  }

  // Load photos via DOM
  getSortedVenues().forEach(v => {
    var photoUrl = null;
    if (v._photosObj) {
      try { photoUrl = v._photosObj.getUrl({ maxWidth: 200 }); } catch(e) {}
    }
    if (!photoUrl && v.photo) photoUrl = v.photo;
    if (!photoUrl) return;
    const placeholder = document.querySelector('[data-photo-vid="' + v.id + '"]');
    if (!placeholder) return;
    const img = document.createElement('img');
    img.className = 'venue-photo';
    img.alt = v.name;
    img.referrerPolicy = 'no-referrer';
    img.style.cursor = 'pointer';
    img.onclick = function(e) {
      e.stopPropagation();
      if (v.placeId) openGoogleMapsPlace(v.placeId);
      else bookVenue(v.name);
    };
    img.onload = function() {
      var el = document.querySelector('[data-photo-vid="' + v.id + '"]');
      if (el) el.replaceWith(img);
    };
    img.onerror = function() {
      var el = document.querySelector('[data-photo-vid="' + v.id + '"]');
      if (el) {
        el.classList.remove('photo-loading');
        el.innerHTML = '<i class="fa-solid ' + v.icon + '"></i>';
      }
    };
    img.src = photoUrl;
  });
}

function handlePhotoError(img, icon, color) {
  const div = document.createElement('div');
  div.className = 'venue-photo-placeholder';
  div.style.background = color;
  div.innerHTML = '<i class="fa-solid ' + icon + '"></i>';
  img.replaceWith(div);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function selectVenue(vid) {
  state.chosenVenue = state.results.find(v => v.id === vid);
  _currentShareCode = null;
  _currentShareResultsKey = null;
  document.querySelectorAll('.venue-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector('.venue-card[data-vid="' + vid + '"]');
  if (card) card.classList.add('active');
  if (!state.chosenVenue) return;
  logVenueInteraction(state.chosenVenue, 'select', {
    venue_rating: state.chosenVenue.rating || null,
    venue_rank: state.results.findIndex(v => v.id === vid) + 1,
  });

  // Use cached route data if available and has real driving data, otherwise fetch
  const dest = { lat: state.chosenVenue.lat, lng: state.chosenVenue.lng };
  var hasRealRoutes = state.chosenVenue._routeData &&
    state.chosenVenue._routeData.every(function(d) { return d.durationMin !== null; });
  if (hasRealRoutes) {
    state._distanceData = state.chosenVenue._routeData;
    renderMap(dest, state._distanceData);
  } else {
    // Fetch (or re-fetch) real driving routes
    fetchRealDistances(dest).then(distanceData => {
      state._distanceData = distanceData;
      state.chosenVenue._routeData = distanceData;
      state.chosenVenue._realDists = distanceData.map(d => d.distKm);
      state.chosenVenue._realTimes = distanceData.map(d => d.durationMin);
      renderMap(dest, distanceData);
    });
  }
}

// ---------- Venue Sorting ----------
function getSortedVenues() {
  const venues = [...state.results];
  switch (state._sortMode) {
    case 'rating':
      return venues.sort((a, b) => b.rating - a.rating);
    case 'cheapest':
      return venues.sort((a, b) => {
        const priceOrder = { 'Free': 0, '$': 1, '$$': 2, '$$$': 3, '$$$$': 4 };
        return (priceOrder[a.price] ?? 2) - (priceOrder[b.price] ?? 2);
      });
    case 'closest':
    default:
      return venues.sort((a, b) => a._score - b._score);
  }
}

function sortVenues(mode) {
  state._sortMode = mode;
  renderVenueList();
  // Re-render map so venue marker ranks match the new sidebar order
  if (state.chosenVenue && state._distanceData) {
    renderMap({ lat: state.chosenVenue.lat, lng: state.chosenVenue.lng }, state._distanceData);
  }
}

async function loadMoreOptions() {
  // Pro-only feature
  if (typeof isProUser === 'function' && !isProUser()) {
    showToast('Upgrade to Pro for more venue options!');
    if (typeof showUpgradeModal === 'function') showUpgradeModal();
    return;
  }
  trackEvent('find_more_click', { currentCount: state.results.length });
  const more = state._allVenues.slice(0, 10);
  if (more.length <= state.results.length) return;

  // Rank all venues by haversine (real routes fetched lazily when a venue is selected)
  const ranked = rankVenuesByMode(more);
  ranked.forEach((v, idx) => { v.id = idx + 1; });
  state._allVenues = ranked.concat(state._allVenues.slice(10));
  state.results = ranked;

  renderVenueList();
  renderMap(
    state.chosenVenue ? { lat: state.chosenVenue.lat, lng: state.chosenVenue.lng } : computeCenter(state.locations, state.mode),
    state._distanceData
  );
  // Leaflet needs to recalculate after layout height change
  setTimeout(function() { if (state.map) state.map.invalidateSize(); }, 100);
}

function openGoogleMapsPlace(placeId) {
  const venue = state.results.find(v => v.placeId === placeId);
  const query = venue ? encodeURIComponent(venue.name) : '';
  var a = document.createElement('a');
  a.href = 'https://www.google.com/maps/search/?api=1&query=' + query + '&query_place_id=' + encodeURIComponent(placeId);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (venue) {
    logVenueInteraction(venue, 'view');
    trackEvent('venue_view', { venueName: venue.name, venuePlaceId: placeId });
    if (typeof recordFirstVenueAction === 'function') recordFirstVenueAction();
  }
}

function bookVenue(name) {
  const decoded = decodeURIComponent(name);
  const q = encodeURIComponent(decoded + ' restaurant reservation');
  window.open('https://www.google.com/search?q=' + q, '_blank', 'noopener,noreferrer');
}

function getDirections(lat, lng) {
  window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng, '_blank', 'noopener,noreferrer');
  const venue = state.results.find(v => v.lat === lat && v.lng === lng);
  if (venue) {
    logVenueInteraction(venue, 'directions');
    trackEvent('venue_directions', { venueName: venue.name, venuePlaceId: venue.placeId });
    if (typeof recordFirstVenueAction === 'function') recordFirstVenueAction();
  }
}

// ---------- Map ----------
function renderMap(center, distanceData) {
  if (state.map) {
    state.map.remove();
    state.map = null;
  }

  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
  }).setView([center.lat, center.lng], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
  }).addTo(state.map);

  state.markers = [];
  state.routeLayers = [];

  // Track currently highlighted route for dismissal
  var activeRoutePopup = null;
  var activeRouteLine = null;

  function highlightRoute(routeLine, d, latlng) {
    // Dismiss any previously active route popup
    dismissActiveRoute();

    // Highlight: thicken, raise opacity, bring to front
    routeLine.setStyle({ weight: 6, opacity: 1 });
    routeLine.bringToFront();
    activeRouteLine = routeLine;

    // Build popup content
    var popupContent = '<div class="route-popup">' +
      '<strong>' + escapeHtml(d.loc.name) + '</strong>' +
      '<div class="route-popup-stats">' +
      '<span>' + d.distKm.toFixed(1) + ' km</span>' +
      (d.durationMin !== null ? '<span>' + d.durationMin + ' min drive</span>' : '') +
      '</div></div>';

    activeRoutePopup = L.popup({ closeButton: false, className: 'route-info-popup', offset: [0, -4] })
      .setLatLng(latlng)
      .setContent(popupContent)
      .openOn(state.map);
  }

  function dismissActiveRoute() {
    if (activeRouteLine) {
      var idx = state.routeLayers.indexOf(activeRouteLine);
      var origColor = AVATAR_COLORS[(idx >= 0 ? idx : 0) % AVATAR_COLORS.length];
      activeRouteLine.setStyle({ weight: 3, opacity: 0.6, color: origColor });
      activeRouteLine = null;
    }
    if (activeRoutePopup) {
      state.map.closePopup(activeRoutePopup);
      activeRoutePopup = null;
    }
  }

  // Dismiss route popup when clicking on the map background
  state.map.on('click', function () {
    dismissActiveRoute();
  });

  // Draw real routes from each person to the center
  distanceData.forEach((d, i) => {
    const color = AVATAR_COLORS[i % AVATAR_COLORS.length];

    // Draw route polyline (real road path or straight line fallback)
    const routeLine = L.polyline(d.routePoints, {
      color: color,
      weight: 3,
      opacity: 0.6,
    }).addTo(state.map);

    // On mobile/touch devices, add a wider invisible hit-area polyline for easier tapping
    var isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      var hitArea = L.polyline(d.routePoints, {
        color: color,
        weight: 24,
        opacity: 0,
        interactive: true,
      }).addTo(state.map);
      hitArea.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        highlightRoute(routeLine, d, e.latlng);
      });
    }

    // Route hover/click interaction: show popup with friend info
    routeLine.on('mouseover', function (e) {
      highlightRoute(routeLine, d, e.latlng);
    });
    routeLine.on('mouseout', function () {
      dismissActiveRoute();
    });
    // Mobile: tap to show, tap elsewhere to dismiss
    routeLine.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      highlightRoute(routeLine, d, e.latlng);
    });

    state.routeLayers.push(routeLine);

    // Person marker
    const icon = L.divIcon({
      className: '',
      html: '<div class="custom-marker" style="background:' + color + '">' + escapeHtml(d.loc.name.charAt(0)) + '</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    const marker = L.marker([d.loc.lat, d.loc.lng], { icon: icon })
      .addTo(state.map)
      .bindPopup('<strong>' + escapeHtml(d.loc.name) + '</strong><br>' + escapeHtml(d.loc.address) + '<br>' + d.distKm.toFixed(1) + ' km' + (d.durationMin !== null ? ' &middot; ' + d.durationMin + ' min drive' : ''));

    // Highlight route when hovering/clicking the friend's icon
    marker.on('mouseover', function () {
      var mid = Math.floor(d.routePoints.length / 2);
      var latlng = L.latLng(d.routePoints[mid][0], d.routePoints[mid][1]);
      highlightRoute(routeLine, d, latlng);
    });
    marker.on('mouseout', function () {
      dismissActiveRoute();
    });
    marker.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      var mid = Math.floor(d.routePoints.length / 2);
      var latlng = L.latLng(d.routePoints[mid][0], d.routePoints[mid][1]);
      highlightRoute(routeLine, d, latlng);
    });

    state.markers.push(marker);
  });

  // Venue markers — use sorted order to match sidebar ranks
  var sortedVenues = getSortedVenues();
  sortedVenues.forEach((v, i) => {
    const vIcon = L.divIcon({
      className: '',
      html: '<div class="venue-marker">' + (i + 1) + '</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    L.marker([v.lat, v.lng], { icon: vIcon })
      .addTo(state.map)
      .bindPopup('<strong>' + escapeHtml(v.name) + '</strong><br>' + escapeHtml(v.type) + (v.rating ? '<br>&#11088; ' + v.rating : ''));
  });

  // Fit bounds to all points
  const allPoints = [
    ...state.locations.map(l => [l.lat, l.lng]),
    [center.lat, center.lng],
  ];
  state.map.fitBounds(allPoints, { padding: [50, 50], maxZoom: 14 });

  // Weather widget — only if locations are close enough
  fetchWeatherForMap(center);
}

// ---------- Weather Widget ----------
function fetchWeatherForMap(center) {
  // Skip if locations are spread > 50 km apart
  const locs = state.locations;
  for (let i = 0; i < locs.length; i++) {
    for (let j = i + 1; j < locs.length; j++) {
      if (haversine(locs[i].lat, locs[i].lng, locs[j].lat, locs[j].lng) > 50) return;
    }
  }

  const meetDate = state.meetingTime || new Date();
  const dateStr = meetDate.toISOString().slice(0, 10);
  const hour = meetDate.getHours();
  const isToday = dateStr === new Date().toISOString().slice(0, 10);

  let url;
  if (isToday && !state.meetingTime) {
    // Use current weather
    url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&current=temperature_2m,weather_code,is_day&timezone=auto`;
  } else {
    // Use hourly forecast for the selected date + hour
    url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&hourly=temperature_2m,weather_code,is_day&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;
  }

  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (!state.map) return;
      let temp, unit, code, isDay;

      if (data.current) {
        temp = Math.round(data.current.temperature_2m);
        unit = data.current_units?.temperature_2m || '°C';
        code = data.current.weather_code;
        isDay = data.current.is_day === 1;
      } else if (data.hourly) {
        const idx = Math.min(hour, data.hourly.time.length - 1);
        temp = Math.round(data.hourly.temperature_2m[idx]);
        unit = data.hourly_units?.temperature_2m || '°C';
        code = data.hourly.weather_code[idx];
        isDay = data.hourly.is_day[idx] === 1;
      } else {
        return;
      }

      const { html: icon, label } = getWeatherIcon(code, isDay);

      // Remove existing widget
      const existing = document.querySelector('.weather-widget');
      if (existing) existing.remove();

      const WeatherControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function() {
          const div = L.DomUtil.create('div', 'weather-widget');
          div.innerHTML = `
            <div class="weather-icon-wrap" title="${label}">${icon}</div>
            <div class="weather-temp">${temp}${unit}</div>
          `;
          L.DomEvent.disableClickPropagation(div);
          return div;
        }
      });
      new WeatherControl().addTo(state.map);
    })
    .catch(() => {});
}

function getWeatherIcon(code, isDay) {
  // WMO weather codes → animated HTML icons
  if (code === 0 || code === 1) {
    if (!isDay)
      return { html: '<div class="w-moon"><div class="w-moon-body"></div><div class="w-moon-stars"><i></i><i></i><i></i></div></div>', label: 'Night' };
    return { html: '<div class="w-sun"><div class="w-sun-core"></div><div class="w-sun-rays"></div></div>', label: 'Sunny' };
  }
  if (code === 2 || code === 3)
    return { html: '<div class="w-cloud"><div class="w-cloud-body"></div></div>', label: 'Cloudy' };
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82)
    return { html: '<div class="w-rain"><div class="w-cloud-body small"></div><div class="w-drops"><i></i><i></i><i></i></div></div>', label: 'Rainy' };
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86)
    return { html: '<div class="w-snow"><div class="w-cloud-body small"></div><div class="w-flakes"><i></i><i></i><i></i></div></div>', label: 'Snowy' };
  if (code >= 95)
    return { html: '<div class="w-storm"><div class="w-cloud-body small"></div><div class="w-bolt">&#9889;</div></div>', label: 'Stormy' };
  // Fog / other
  return { html: '<div class="w-cloud"><div class="w-cloud-body"></div></div>', label: 'Cloudy' };
}

// ---------- Share ----------
function _renderStars(rating) {
  var full = Math.floor(rating);
  var half = rating - full >= 0.25 && rating - full < 0.75 ? 1 : 0;
  var extra = rating - full >= 0.75 ? 1 : 0;
  full += extra;
  var html = '';
  for (var i = 0; i < full; i++) html += '<i class="fa-solid fa-star"></i>';
  if (half) html += '<i class="fa-solid fa-star-half-stroke"></i>';
  for (var j = full + half; j < 5; j++) html += '<i class="fa-regular fa-star"></i>';
  return html;
}

function _getStatusInfo(v, placeDetail) {
  // Use Place Details periods if available
  if (placeDetail && placeDetail.opening_hours) {
    var oh = placeDetail.opening_hours;
    var isOpen = false;
    try { isOpen = oh.isOpen(); } catch(e) {}
    var nextText = '';
    if (oh.periods && oh.periods.length > 0) {
      var now = new Date();
      var dayOfWeek = now.getDay(); // 0=Sun
      var currentMin = now.getHours() * 60 + now.getMinutes();
      if (isOpen) {
        // Find today's closing time
        for (var i = 0; i < oh.periods.length; i++) {
          var p = oh.periods[i];
          if (p.close && p.close.day === dayOfWeek) {
            var closeMin = p.close.hours * 60 + p.close.minutes;
            if (closeMin > currentMin) {
              nextText = 'until ' + _fmtTime(p.close.hours, p.close.minutes);
              // closing soon = within 60 min
              if (closeMin - currentMin <= 60) {
                return { label: 'Closing Soon', cls: 'closing', extra: nextText };
              }
              break;
            }
          }
        }
        return { label: 'Open', cls: 'open', extra: nextText };
      } else {
        // Find next opening time
        for (var d = 0; d <= 7; d++) {
          var checkDay = (dayOfWeek + d) % 7;
          for (var j = 0; j < oh.periods.length; j++) {
            var po = oh.periods[j];
            if (po.open && po.open.day === checkDay) {
              var openMin = po.open.hours * 60 + po.open.minutes;
              if (d === 0 && openMin <= currentMin) continue;
              var dayLabel = d === 0 ? 'today' : d === 1 ? 'tomorrow' : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][checkDay];
              nextText = 'opens ' + dayLabel + ' ' + _fmtTime(po.open.hours, po.open.minutes);
              return { label: 'Closed', cls: 'closed', extra: nextText };
            }
          }
        }
        return { label: 'Closed', cls: 'closed', extra: '' };
      }
    }
    return { label: isOpen ? 'Open' : 'Closed', cls: isOpen ? 'open' : 'closed', extra: '' };
  }
  // Fallback to basic isOpen from Nearby Search
  if (v.businessStatus === 'CLOSED_TEMPORARILY') return { label: 'Temporarily Closed', cls: 'closed', extra: '' };
  if (v.businessStatus === 'CLOSED_PERMANENTLY') return { label: 'Permanently Closed', cls: 'closed', extra: '' };
  if (v.isOpen === true) return { label: 'Open Now', cls: 'open', extra: '' };
  if (v.isOpen === false) return { label: 'Closed', cls: 'closed', extra: '' };
  return null;
}

function _fmtTime(h, m) {
  var ampm = h >= 12 ? 'PM' : 'AM';
  var hr = h % 12 || 12;
  return hr + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

function showShareModal() {
  const modal = document.getElementById('shareModal');
  modal.classList.add('visible');
  document.getElementById('sharePreview').style.display = 'none';
  trackEvent('share_modal_open', {
    venueName: state.chosenVenue ? state.chosenVenue.name : null,
  });

  const v = state.chosenVenue || (state.results[0] || null);
  _populateShareCard(v, null);

  // Fetch Place Details for opening hours
  if (v && v.placeId && state.placesService && _gmapsMonthlyQuota.check('place_details') && _gmapsRateLimit.check('place_details')) {
    var _pdStart = Date.now();
    state.placesService.getDetails(
      { placeId: v.placeId, fields: ['opening_hours', 'business_status', 'utc_offset_minutes'] },
      function(place, detailStatus) {
        if (detailStatus === google.maps.places.PlacesServiceStatus.OK) _gmapsMonthlyQuota.record('place_details');
        logApiCall('google_maps', 'place_details', detailStatus === google.maps.places.PlacesServiceStatus.OK, detailStatus !== google.maps.places.PlacesServiceStatus.OK ? detailStatus : null, Date.now() - _pdStart);
        if (detailStatus === google.maps.places.PlacesServiceStatus.OK && place) {
          _populateShareCard(v, place);
        }
      }
    );
  }
}

function _populateShareCard(v, placeDetail) {
  const card = document.getElementById('fairnessCard');
  const dd = state._distanceData || [];
  const numPeople = state.locations.length;
  const totalDist = dd.reduce((s, d) => s + d.distKm, 0);
  const hasDurations = dd.some(d => d.durationMin !== null);
  const totalDuration = hasDurations ? dd.reduce((s, d) => s + (d.durationMin || 0), 0) : null;
  const avgDist = numPeople > 0 ? (totalDist / numPeople).toFixed(1) : '—';
  const avgTime = totalDuration !== null && numPeople > 0 ? Math.round(totalDuration / numPeople) : null;

  if (!v) {
    card.innerHTML = '<div class="fc-empty">No venue selected</div>';
    return;
  }

  var photoUrl = '';
  if (v._photosObj) {
    try { photoUrl = v._photosObj.getUrl({ maxWidth: 400 }); } catch(e) {}
  }
  if (!photoUrl && v.photo) photoUrl = v.photo;

  var statusInfo = _getStatusInfo(v, placeDetail);

  card.innerHTML = `
    <div class="fc-hero">
      <div class="fc-photo" style="${photoUrl ? '' : 'background:' + (FALLBACK_COLORS[v.icon] || '#6366F1')}">
        ${photoUrl ? '<img src="' + photoUrl.replace(/"/g, '&quot;') + '" alt="" referrerpolicy="no-referrer" class="fc-photo-img" />' : '<i class="fa-solid ' + v.icon + '"></i>'}
      </div>
      <div class="fc-hero-info">
        <div class="fc-venue-name">${escapeHtml(v.name)}</div>
        <div class="venue-actions fc-hero-actions">
          ${v.placeId ? '<button class="btn-tiny" onclick="event.stopPropagation(); openGoogleMapsPlace(\'' + v.placeId + '\')">View</button>' : ''}
          <button class="btn-tiny" onclick="event.stopPropagation(); getDirections(${v.lat}, ${v.lng})"><i class="fa-solid fa-diamond-turn-right"></i> Directions</button>
        </div>
      </div>
    </div>
    <div class="fc-details">
      <div class="fc-meta-row">
        ${v.rating ? '<span class="fc-stars">' + _renderStars(v.rating) + ' <b>' + v.rating + '</b></span>' : ''}
        ${v.price ? '<span class="fc-price">' + escapeHtml(v.price) + '</span>' : ''}
        ${statusInfo ? '<span class="fc-status ' + statusInfo.cls + '">' + statusInfo.label + (statusInfo.extra ? ' · ' + escapeHtml(statusInfo.extra) : '') + '</span>' : ''}
      </div>
    </div>
    <div class="fc-stats">
      <div class="fc-stat">
        <div class="fc-stat-val"><i class="fa-solid fa-users"></i> ${numPeople}</div>
        <div class="fc-stat-label">people</div>
      </div>
      <div class="fc-stat">
        <div class="fc-stat-val"><i class="fa-solid fa-road"></i> ${avgDist} km</div>
        <div class="fc-stat-label">avg distance</div>
      </div>
      <div class="fc-stat">
        <div class="fc-stat-val"><i class="fa-solid fa-clock"></i> ${avgTime !== null ? avgTime + ' min' : '—'}</div>
        <div class="fc-stat-label">avg drive</div>
      </div>
    </div>
  `;
}

function hideShareModal(e) {
  if (e && e.target !== document.getElementById('shareModal')) return;
  document.getElementById('shareModal').classList.remove('visible');
}

// ---------- Share Snapshot ----------
function generateShareCode() {
  // 5-char lowercase alphanumeric, distinct from 6-char uppercase group codes
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  var code = '';
  for (var i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function buildShareSnapshot() {
  var v = state.chosenVenue || (state.results[0] || null);
  return {
    locations: state.locations.map(function(l) {
      return { name: l.name, address: l.address, lat: l.lat, lng: l.lng };
    }),
    mode: state.mode,
    category: state.category,
    vibe: state.vibe,
    results: state.results.map(function(rv) {
      return {
        name: rv.name, type: rv.type, rating: rv.rating,
        userRatingsTotal: rv.userRatingsTotal, price: rv.price,
        icon: rv.icon, lat: rv.lat, lng: rv.lng, address: rv.address,
        placeId: rv.placeId, photo: rv.photo, isOpen: rv.isOpen,
        businessStatus: rv.businessStatus, distance: rv.distance,
        _overlapNote: rv._overlapNote || null,
        _realDists: rv._realDists || null,
        _realTimes: rv._realTimes || null,
      };
    }),
    chosenVenueIndex: v ? state.results.findIndex(function(r) { return r === v; }) : 0,
    distanceData: (state._distanceData || []).map(function(d) {
      return { locName: d.loc.name, distKm: d.distKm, durationMin: d.durationMin, routePoints: d.routePoints || [] };
    }),
    sortMode: state._sortMode,
  };
}

async function saveShareSnapshot() {
  if (!_supabaseClient) return null;
  var code = generateShareCode();
  var snapshot = buildShareSnapshot();
  var { error } = await _supabaseClient.from('shared_sessions').insert({
    code: code,
    snapshot: snapshot,
  });
  if (error) {
    console.warn('Failed to save share snapshot:', error.message);
    return null;
  }
  return code;
}

// Cached share code for the current results so we don't create duplicates
var _currentShareCode = null;
var _currentShareResultsKey = null;

async function getOrCreateShareCode() {
  // Cache key: hash of chosen venue + locations
  var v = state.chosenVenue || (state.results[0] || null);
  var key = (v ? v.placeId || v.name : '') + '|' + state.locations.map(function(l) { return l.lat + ',' + l.lng; }).join(';');
  if (_currentShareCode && _currentShareResultsKey === key) return _currentShareCode;
  var code = await saveShareSnapshot();
  if (code) {
    _currentShareCode = code;
    _currentShareResultsKey = key;
  }
  return code;
}

function getShareLink(shareCode) {
  var origin = window.location.origin || 'https://mway.vercel.app';
  return origin + window.location.pathname + '?s=' + shareCode;
}

function getShareMessage(shareLink) {
  const v = state.chosenVenue || (state.results[0] || null);
  let msg = 'Hey! How does this look?\n' + (v ? v.name : '');
  if (v && v.placeId) msg += ' (https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.name) + '&query_place_id=' + encodeURIComponent(v.placeId) + ')';
  if (v && v.address) msg += '\n📍 ' + v.address;
  if (v && v.rating) msg += '\n⭐ ' + v.rating + (v.userRatingsTotal ? ' (' + v.userRatingsTotal + ' reviews)' : '');
  msg += '\n\nFind more options: ' + shareLink;
  return msg;
}

async function shareToWhatsApp() {
  var code = await getOrCreateShareCode();
  var link = code ? getShareLink(code) : (window.location.origin || 'https://mway.vercel.app');
  const text = encodeURIComponent(getShareMessage(link));
  window.open('https://wa.me/?text=' + text, '_blank', 'noopener,noreferrer');
  trackEvent('share_whatsapp', { venueName: state.chosenVenue ? state.chosenVenue.name : null, shareCode: code });
}

async function copyShareMessage() {
  var code = await getOrCreateShareCode();
  var link = code ? getShareLink(code) : (window.location.origin || 'https://mway.vercel.app');
  const msg = getShareMessage(link);
  navigator.clipboard.writeText(msg).then(function() {
    showToast('Message copied!');
    trackEvent('share_copy', { venueName: state.chosenVenue ? state.chosenVenue.name : null, shareCode: code });
    const preview = document.getElementById('sharePreview');
    var textEl = document.getElementById('sharePreviewText');
    textEl.textContent = msg;
    preview.style.display = '';
    // Select all text so it appears highlighted
    var range = document.createRange();
    range.selectNodeContents(textEl);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function copyInviteLink() {
  if (!state.groupId) {
    if (!_supabaseClient) {
      var fallback = window.location.origin || 'https://mway.vercel.app';
      navigator.clipboard.writeText(fallback).then(function() { showToast('Invite link copied!'); });
      return;
    }
    createGroup();
  }
  var link = window.location.origin + window.location.pathname + '?group=' + state.groupId;
  navigator.clipboard.writeText(link).then(function() {
    showToast('Invite link copied! Share it with your friends.');
  });
}

// ---------- Load Shared Session ----------
async function loadSharedSession() {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('s');
  if (!code || !/^[a-z0-9]{5}$/.test(code)) return;

  if (!_supabaseClient) return;

  var { data, error } = await _supabaseClient
    .from('shared_sessions')
    .select('snapshot, created_at')
    .eq('code', code)
    .maybeSingle();

  if (error || !data) {
    showToast('This share link is invalid or has expired.');
    var url = new URL(window.location.href);
    url.searchParams.delete('s');
    window.history.replaceState({}, '', url);
    return;
  }

  // Check 12-hour expiry
  var created = new Date(data.created_at).getTime();
  if (Date.now() - created > 12 * 60 * 60 * 1000) {
    showToast('This share link has expired.');
    var url = new URL(window.location.href);
    url.searchParams.delete('s');
    window.history.replaceState({}, '', url);
    _supabaseClient.from('shared_sessions').delete().eq('code', code).then(function() {});
    return;
  }

  var snap = data.snapshot;
  if (!snap || !snap.results || snap.results.length === 0) return;

  // Restore state from snapshot
  state.mode = snap.mode || 'fairness';
  state.category = snap.category || 'food';
  state.vibe = snap.vibe || '';
  state._sortMode = snap.sortMode || 'closest';

  // Set mode toggle
  var modeToggle = document.getElementById('modeToggle');
  if (modeToggle) modeToggle.checked = state.mode === 'eco';
  var desc = document.getElementById('modeDescription');
  if (desc) {
    desc.innerHTML = state.mode === 'eco'
      ? '<strong>Eco:</strong> Minimize total distance overall'
      : '<strong>Fair:</strong> No one has to travel too far';
  }

  // Rebuild locations list: show shared locations (without "You") + add blank "You" at top
  state.locations = [];
  document.getElementById('locationsList').innerHTML = '';
  locationCounter = 0;

  // Add a blank "You" field with geolocate button
  addLocationInput('You', true);
  state.myLocationId = locationCounter;

  // Add the shared people's locations (pre-filled, not named "You")
  (snap.locations || []).forEach(function(loc) {
    var displayName = loc.name === 'You' ? 'Friend' : loc.name;
    addLocationInput(displayName);
    var id = locationCounter;
    var row = document.querySelector('.location-row[data-id="' + id + '"]');
    if (row) {
      var input = row.querySelector('input[data-id]');
      if (input) input.value = loc.address || '';
      var nameInput = row.querySelector('.name-input');
      if (nameInput) nameInput.value = displayName;
    }
    state.locations.push({ id: id, name: displayName, address: loc.address, lat: loc.lat, lng: loc.lng });
  });

  // Rebuild results
  state.results = snap.results.map(function(rv, i) {
    rv.id = i + 1;
    return rv;
  });
  state._allVenues = state.results.slice();
  state.chosenVenue = state.results[snap.chosenVenueIndex || 0] || state.results[0];

  // Rebuild distance data (using snapshot distances, keyed to shared locations)
  var venueLat = state.chosenVenue.lat;
  var venueLng = state.chosenVenue.lng;
  var sharedLocs = snap.locations || [];
  state._distanceData = (snap.distanceData || []).map(function(d, i) {
    var srcLoc = sharedLocs[i] || {};
    var srcLat = srcLoc.lat || 0;
    var srcLng = srcLoc.lng || 0;
    return {
      loc: { name: d.locName, address: srcLoc.address || '', lat: srcLat, lng: srcLng },
      distKm: d.distKm,
      durationMin: d.durationMin,
      routePoints: (d.routePoints && d.routePoints.length > 0) ? d.routePoints : [[srcLat, srcLng], [venueLat, venueLng]],
    };
  });

  // Show results section
  var section = document.getElementById('resultsSection');
  section.style.display = 'block';
  document.getElementById('shareBtn').style.display = '';

  var badge = document.getElementById('resultModeBadge');
  if (state.mode === 'eco') {
    badge.innerHTML = '<i class="fa-solid fa-leaf"></i> Eco';
    badge.className = 'results-mode-badge eco';
  } else {
    badge.innerHTML = '\uD83D\uDE0A Fair';
    badge.className = 'results-mode-badge';
  }

  // Render from snapshot data
  renderVenueList();
  renderMap(
    { lat: state.chosenVenue.lat, lng: state.chosenVenue.lng },
    state._distanceData
  );

  // Auto-scroll to results
  setTimeout(function() {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);

  // Clean share param from URL
  var cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('s');
  window.history.replaceState({}, '', cleanUrl);

  trackEvent('shared_session_loaded', { shareCode: code });
}

// ---------- Group / Invite (Real-time) ----------
function generateGroupCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function getOrCreateMemberId() {
  var id = localStorage.getItem('midway_member_id');
  if (!id) {
    id = 'mid_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    localStorage.setItem('midway_member_id', id);
  }
  return id;
}

var GROUP_EXPIRY_MS = 12 * 60 * 60 * 1000; // 12 hours

function initGroup() {
  var params = new URLSearchParams(window.location.search);
  var groupId = params.get('group');
  if (!groupId || !/^[A-Za-z0-9]{4,12}$/.test(groupId)) return;

  function clearGroupUrl() {
    var url = new URL(window.location.href);
    url.searchParams.delete('group');
    window.history.replaceState({}, '', url);
  }

  // Verify group actually exists in database
  if (_supabaseClient) {
    _supabaseClient.from('groups').select('code, created_at').eq('code', groupId).maybeSingle()
      .then(function(result) {
        if (!result.data) {
          showToast('That link does not exist.');
          clearGroupUrl();
          return;
        }
        // Server-side expiry check
        var serverCreated = new Date(result.data.created_at).getTime();
        if (Date.now() - serverCreated > GROUP_EXPIRY_MS) {
          showToast('This group link has expired.');
          clearGroupUrl();
          _supabaseClient.from('groups').delete().eq('code', groupId).then(function() {});
          return;
        }
        state.groupId = groupId;
        state.groupCreatedAt = serverCreated;
        state.memberId = getOrCreateMemberId();
        joinGroupChannel();
        updateInviteUI();
      });
  }
}

function createGroup() {
  state.groupId = generateGroupCode();
  state.groupCreatedAt = Date.now();
  state.memberId = getOrCreateMemberId();
  var url = new URL(window.location.href);
  url.searchParams.set('group', state.groupId);
  window.history.replaceState({}, '', url);

  // Register group in database
  if (_supabaseClient) {
    _supabaseClient.from('groups').insert({ code: state.groupId, created_by: state.memberId }).then(function() {});
  }

  joinGroupChannel();
  updateInviteUI();
  trackEvent('group_create', { groupId: state.groupId });
}

function joinGroupChannel() {
  if (!_supabaseClient || !state.groupId || !state.memberId) return;

  if (state.groupChannel) {
    _supabaseClient.removeChannel(state.groupChannel);
  }

  state.groupChannel = _supabaseClient.channel('group-' + state.groupId, {
    config: { presence: { key: state.memberId } }
  });

  state.groupChannel
    .on('presence', { event: 'sync' }, function() {
      var presenceState = state.groupChannel.presenceState();
      syncGroupMembers(presenceState);
    })
    .on('presence', { event: 'join' }, function() {
      // When someone new joins, re-broadcast so they get our latest state
      broadcastMyPresence();
    })
    .subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        broadcastMyPresence();
      }
    });
}

function broadcastMyPresence() {
  if (!state.groupChannel) return;
  var localLocs = state.locations.filter(function(l) { return !l.remote; });
  // Get signed-in user's avatar URL if available
  var avatarUrl = null;
  var signedInName = null;
  if (window._isSignedIn && currentUser) {
    var meta = currentUser.user_metadata || {};
    avatarUrl = meta.avatar_url || meta.picture || null;
    signedInName = meta.full_name || meta.name || null;
  }
  // Ensure the user's own row is always included even without a location
  var hasMyRow = localLocs.some(function(l) { return l.id === state.myLocationId; });
  if (!hasMyRow) {
    localLocs.unshift({
      id: state.myLocationId,
      name: signedInName || getPersonName(state.myLocationId),
      address: null,
      lat: null,
      lng: null,
    });
  }
  var people = localLocs.map(function(l) {
    var person = {
      id: l.id,
      name: l.name || getPersonName(l.id),
      address: l.address || null,
      lat: l.lat || null,
      lng: l.lng || null,
    };
    // Attach avatar URL to the user's own location
    if (l.id === state.myLocationId && avatarUrl) {
      person.avatarUrl = avatarUrl;
    }
    // Use signed-in name for the user's own location
    if (l.id === state.myLocationId && signedInName) {
      person.name = signedInName;
    }
    return person;
  });
  state.groupChannel.track({ people: people });
}

function syncGroupMembers(presenceState) {
  // Remove old remote locations from state
  state.locations = state.locations.filter(function(l) { return !l.remote; });

  var newMembers = {};
  Object.keys(presenceState).forEach(function(key) {
    if (key === state.memberId) return;
    var presences = presenceState[key];
    var p = presences[0];
    var people = p.people || [];
    // Backwards compat: if no people array, treat as single person
    if (people.length === 0 && p.name) {
      people = [{ name: p.name, address: p.address, lat: p.lat, lng: p.lng }];
    }
    newMembers[key] = people;
    people.forEach(function(person, idx) {
      if (person.lat && person.lng) {
        state.locations.push({
          id: 'remote_' + key + '_' + idx,
          name: person.name || 'Friend',
          address: person.address || '',
          lat: person.lat,
          lng: person.lng,
          remote: true,
        });
      }
    });
  });

  state.groupMembers = newMembers;
  renderGroupMembers();
  updateFindButton();
  updateGroupMemberCount();
  showYouHint();

  // Warn if results exist but group has changed since generation
  if (state.results.length > 0 && typeof state._resultsLocationCount === 'number') {
    var currentCount = state.locations.length;
    if (currentCount > state._resultsLocationCount) {
      showToast('New friends have been added since generation');
      state._resultsLocationCount = currentCount;
    } else if (currentCount < state._resultsLocationCount) {
      showToast('Some friends have been removed since generation');
      state._resultsLocationCount = currentCount;
    }
  }
}

function renderGroupMembers() {
  document.querySelectorAll('.location-row.remote-member').forEach(function(r) { r.remove(); });

  var list = document.getElementById('locationsList');
  var memberKeys = Object.keys(state.groupMembers);
  var localRowCount = document.querySelectorAll('.location-row:not(.remote-member)').length;
  var colorOffset = localRowCount;

  memberKeys.forEach(function(memberId) {
    var people = state.groupMembers[memberId];
    people.forEach(function(person, idx) {
      var row = document.createElement('div');
      row.className = 'location-row remote-member';
      row.dataset.memberId = memberId;

      var colorIdx = (colorOffset++) % AVATAR_COLORS.length;
      var color = AVATAR_COLORS[colorIdx];
      var initials = (person.name || 'F').charAt(0).toUpperCase();
      var locationText = person.address || 'Waiting for location...';
      var statusClass = person.address ? 'remote-set' : 'remote-waiting';

      var personName = person.name || 'Friend';
      var avatarTitle = isDefaultName(personName) ? '' : personName;
      var hasPhoto = person.avatarUrl;

      var avatarHtml;
      if (hasPhoto) {
        avatarHtml = '<div class="person-avatar" style="background:none;overflow:hidden"' +
          (avatarTitle ? ' title="' + avatarTitle.replace(/"/g, '&quot;') + '"' : '') + '>' +
          '<img src="' + person.avatarUrl.replace(/"/g, '&quot;') + '" alt="' + initials + '" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />' +
          '</div>';
      } else {
        avatarHtml = '<div class="person-avatar" style="background:' + color + '"' +
          (avatarTitle ? ' title="' + avatarTitle.replace(/"/g, '&quot;') + '"' : '') + '>' + initials + '</div>';
      }

      row.innerHTML =
        avatarHtml +
        '<input type="text" value="' + locationText.replace(/"/g, '&quot;') + '" disabled class="' + statusClass + '" />' +
        '<span class="remote-badge"><i class="fa-solid fa-wifi"></i> Live</span>';

      list.appendChild(row);
    });
  });
}

function updateInviteUI() {
  var bar = document.querySelector('.invite-bar');
  if (!bar) return;

  if (state.groupId) {
    var personCount = document.querySelectorAll('.location-row:not(.remote-member)').length;
    Object.keys(state.groupMembers).forEach(function(key) {
      personCount += (state.groupMembers[key].length || 1);
    });
    bar.innerHTML =
      '<div class="group-active-bar">' +
        '<span class="group-badge"><i class="fa-solid fa-users"></i> Group: ' + state.groupId + '</span>' +
        '<span class="group-member-count" id="groupMemberCount">' + personCount + (personCount === 1 ? ' person' : ' people') + '</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="copyInviteLink()">' +
          '<i class="fa-solid fa-copy"></i> Copy Link' +
        '</button>' +
      '</div>' +
      '<p class="invite-subtext">Add friends together while still searching independently.</p>';
  }
}

function updateGroupMemberCount() {
  var el = document.getElementById('groupMemberCount');
  if (!el) return;
  var count = 1; // this user
  Object.keys(state.groupMembers).forEach(function(key) {
    count += (state.groupMembers[key].length || 1);
  });
  el.textContent = count + (count === 1 ? ' person' : ' people');
}

// ---------- Test Mode ----------
const TEST_LOCATIONS = [
  { name: 'You',      address: 'Connaught Place, New Delhi',  lat: 28.6315, lng: 77.2167 },
  { name: 'Friend 1', address: 'Hauz Khas, New Delhi',        lat: 28.5494, lng: 77.2001 },
  { name: 'Friend 2', address: 'Saket, New Delhi',            lat: 28.5244, lng: 77.2090 },
  { name: 'Friend 3', address: 'Noida Sector 18',             lat: 28.5706, lng: 77.3218 },
];

function startTestMode() {
  // Reset state
  state.locations = [];
  const list = document.getElementById('locationsList');
  list.innerHTML = '';
  locationCounter = 0;
  state.autocompletes = {};

  TEST_LOCATIONS.forEach((loc, i) => {
    addLocationInput(loc.name, i === 0);
    const id = locationCounter;
    const input = document.querySelector('input[data-id="' + id + '"]');
    if (input) input.value = loc.address;
    setLocationForId(id, loc.address, loc.lat, loc.lng);
  });

  // Set a default vibe
  const tags = document.querySelectorAll('.vibe-tag');
  if (tags[0]) { tags[0].classList.add('active'); state.vibe = tags[0].textContent.trim(); }

  showToast('Test mode loaded with 4 locations. Click Find the Midway!');
}

// ---------- Toast ----------
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

// ---------- Init ----------
function loadGoogleMaps() {
  if (typeof CONFIG === 'undefined' || !CONFIG.GOOGLE_MAPS_API_KEY || CONFIG.GOOGLE_MAPS_API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY') {
    console.warn('Google Maps API key not set. Create config.js from config.example.js.');
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(CONFIG.GOOGLE_MAPS_API_KEY) + '&libraries=places&callback=onGoogleMapsReady';
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

// ---------- Cycling Placeholder for AI Agent ----------
function initCyclingPlaceholder() {
  var phrases = [
    '\u201Cgreat outdoor seating with tasty fries\u201D',
    '\u201Cquiet place to get work done\u201D',
    '\u201Cbowling and arcade!\u201D',
    '\u201Chealthy salads, matcha, earthy vibes\u201D'
  ];
  var index = 0;
  var container = document.getElementById('cyclingPlaceholder');
  var textEl = container.querySelector('.cycling-placeholder-text');
  var input = document.getElementById('vibeInput');
  var intervalId = null;

  function updateVisibility() {
    if (input.value.length > 0) {
      container.classList.add('hidden');
    } else {
      container.classList.remove('hidden');
    }
  }

  input.addEventListener('input', updateVisibility);
  input.addEventListener('focus', updateVisibility);
  input.addEventListener('blur', updateVisibility);

  function cycle() {
    // Slide current text out to the left
    textEl.classList.add('slide-out');

    setTimeout(function() {
      // Move to next phrase
      index = (index + 1) % phrases.length;
      textEl.textContent = phrases[index];

      // Position offscreen right (no transition)
      textEl.classList.remove('slide-out');
      textEl.classList.add('slide-in-prep');

      // Force reflow so the browser registers the position change
      void textEl.offsetWidth;

      // Slide in from right
      textEl.classList.remove('slide-in-prep');
      textEl.classList.add('slide-in');

      setTimeout(function() {
        textEl.classList.remove('slide-in');
      }, 500);
    }, 500);
  }

  intervalId = setInterval(cycle, 5000);

  // Pause cycling when input has focus and user is typing
  input.addEventListener('focus', function() {
    clearInterval(intervalId);
  });
  input.addEventListener('blur', function() {
    updateVisibility();
    if (input.value.length === 0) {
      intervalId = setInterval(cycle, 3000);
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  initSession();
  renderVibeTags();
  loadGoogleMaps();
  initSupabase();
  initGroup();
  loadSharedSession();

  // Feature flag: More Options section
  if (FEATURE_MORE_OPTIONS) {
    var moreOpts = document.getElementById('moreOptionsSection');
    if (moreOpts) moreOpts.style.display = '';
    var vibeMore = document.getElementById('vibeMoreOptions');
    if (vibeMore) vibeMore.style.display = '';
  }

  // Show test mode button only if feature flag is on
  if (typeof CONFIG !== 'undefined' && CONFIG.TEST_MODE) {
    var btn = document.getElementById('testModeBtn');
    if (btn) btn.style.display = '';
  }

  // Global Enter key triggers Find the Midway (unless in a location autocomplete input)
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    var active = document.activeElement;
    // Skip if focused on a location autocomplete input (has data-id for Places Autocomplete)
    if (active && active.matches('input[data-id]')) return;
    var findBtn = document.getElementById('findBtn');
    if (findBtn && !findBtn.disabled) {
      e.preventDefault();
      findBtn.click();
    }
  });

  // Cycling placeholder for AI Agent vibe input
  initCyclingPlaceholder();
});
