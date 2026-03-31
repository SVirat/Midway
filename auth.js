/* ========================================
   MIDWAY — Auth & Data Layer (Supabase)
   ======================================== */

// ---------- Supabase Client ----------
let _supabaseClient = null;
let currentUser = null;

function initSupabase() {
  if (typeof CONFIG === 'undefined' || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    console.warn('Supabase not configured. Sign-in features disabled.');
    document.getElementById('authArea').style.display = 'none';
    return;
  }

  // The CDN build exposes supabase.createClient or supabase.supabase.createClient
  const createClient = (window.supabase && window.supabase.createClient)
    || (window.supabase && window.supabase.supabase && window.supabase.supabase.createClient)
    || null;

  if (!createClient) {
    console.error('Supabase JS library not loaded. Check CDN script.');
    document.getElementById('authArea').style.display = 'none';
    return;
  }

  _supabaseClient = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  // Listen for auth state changes
  _supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      currentUser = session.user;
      onSignedIn(session.user);
    } else {
      currentUser = null;
      onSignedOut();
    }
  });

  // Check for existing session
  _supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      currentUser = session.user;
      onSignedIn(session.user);
    }
  });

  // Start analytics, client log capture & session metrics
  _initClientLogCapture();
  _initSessionMetrics();
  trackEvent('session_start', { referrer: document.referrer });
}

// ---------- Google Sign-In ----------
async function signInWithGoogle() {
  if (!_supabaseClient) {
    showToast('Sign-in is not configured yet.');
    return;
  }

  const { error } = await _supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname + window.location.search,
    },
  });

  if (error) {
    console.error('Sign-in error:', error);
    showToast('Sign-in failed. Please try again.');
  }
}

async function signOutUser() {
  if (!_supabaseClient) return;
  closeUserDropdown();
  const { error } = await _supabaseClient.auth.signOut();
  if (error) {
    console.error('Sign-out error:', error);
  }
  showToast('Signed out.');
}

// ---------- Auth UI ----------
function onSignedIn(user) {
  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name || user.email || 'User';
  const avatar = meta.avatar_url || meta.picture || '';
  const email = user.email || '';

  document.getElementById('googleSignInBtn').style.display = 'none';
  document.getElementById('userMenu').style.display = '';

  const avatarImg = document.getElementById('userAvatar');
  const dropdownImg = document.getElementById('dropdownAvatar');
  if (avatar) {
    avatarImg.src = avatar;
    avatarImg.referrerPolicy = 'no-referrer';
    dropdownImg.src = avatar;
    dropdownImg.referrerPolicy = 'no-referrer';
  } else {
    avatarImg.style.display = 'none';
    dropdownImg.style.display = 'none';
  }
  avatarImg.alt = name.charAt(0);
  document.getElementById('dropdownName').textContent = name;
  document.getElementById('dropdownEmail').textContent = email;

  // Update or create profile
  upsertProfile(user);

  // Show auth-only buttons
  document.querySelectorAll('.auth-only').forEach(el => el.style.display = '');
  window._isSignedIn = true;

  // Update "You" avatar in location list with profile photo and signed-in name
  if (avatar || name) {
    var firstRow = document.querySelector('#locationsList .location-row');
    if (firstRow) {
      var personAvatar = firstRow.querySelector('.person-avatar');
      if (personAvatar) {
        // Set profile photo
        if (avatar) {
          personAvatar.innerHTML = '';
          personAvatar.style.background = 'none';
          personAvatar.style.overflow = 'hidden';
          var img = document.createElement('img');
          img.src = avatar;
          img.referrerPolicy = 'no-referrer';
          img.alt = name.charAt(0);
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
          personAvatar.appendChild(img);
        }
        // Show name on hover, remove click-to-rename
        personAvatar.title = name;
        personAvatar.removeAttribute('onclick');
        personAvatar.style.cursor = 'default';
      }
      // Update the name input and state
      var nameInput = firstRow.querySelector('.name-input');
      if (nameInput) nameInput.value = name;
      if (typeof state !== 'undefined' && state.myLocationId) {
        var loc = state.locations.find(function(l) { return l.id === state.myLocationId; });
        if (loc) loc.name = name;
      }
    }
  }

  // Re-broadcast to group with signed-in profile
  if (typeof state !== 'undefined' && state.groupId && typeof broadcastMyPresence === 'function') {
    broadcastMyPresence();
  }

  // Fetch subscription status and update upgrade button + pro badge
  fetchUserSubscription().then(function() {
    updateUpgradeButton();
    updateProBadge();
    updateManageSubItem();

    // If user was trying to upgrade before sign-in, auto-open the flow
    var pendingUpgrade = false;
    try { pendingUpgrade = sessionStorage.getItem('_pendingUpgrade') === '1'; sessionStorage.removeItem('_pendingUpgrade'); } catch(e) {}
    if (pendingUpgrade) {
      setTimeout(function() { showUpgradeModal(); }, 500);
    }
  });

  // Log sign-in event
  logActivity('sign_in', { provider: 'google' });
  trackEvent('sign_in', { provider: 'google', email: user.email });
}

function onSignedOut() {
  document.getElementById('googleSignInBtn').style.display = '';
  document.getElementById('userMenu').style.display = 'none';
  closeUserDropdown();

  // Hide auth-only buttons
  document.querySelectorAll('.auth-only').forEach(el => el.style.display = 'none');
  window._isSignedIn = false;

  // Restore "You" avatar to default initial
  var firstRow = document.querySelector('#locationsList .location-row');
  if (firstRow) {
    var personAvatar = firstRow.querySelector('.person-avatar');
    if (personAvatar) {
      var name = personAvatar.closest('.location-row').querySelector('.name-input');
      var initial = name ? name.value.charAt(0).toUpperCase() : 'Y';
      personAvatar.innerHTML = initial;
      personAvatar.style.background = '';
      personAvatar.style.overflow = '';
      // Re-apply the default color
      var idx = 0;
      personAvatar.style.background = typeof AVATAR_COLORS !== 'undefined' ? AVATAR_COLORS[0] : '#6366F1';
    }
  }

  // Reset subscription state
  _userSubscription = null;
  updateUpgradeButton();
  updateProBadge();
  updateManageSubItem();
}

function toggleUserDropdown() {
  const dd = document.getElementById('userDropdown');
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : '';

  if (!isOpen) {
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closeDropdownOnOutsideClick, { once: true });
    }, 0);
  }
}

function closeDropdownOnOutsideClick(e) {
  const menu = document.getElementById('userMenu');
  if (!menu.contains(e.target)) {
    closeUserDropdown();
  }
}

function closeUserDropdown() {
  document.getElementById('userDropdown').style.display = 'none';
}

// ---------- Profile ----------
async function upsertProfile(user) {
  if (!_supabaseClient || !user) return;
  const meta = user.user_metadata || {};
  const { error } = await _supabaseClient.from('profiles').upsert({
    id: user.id,
    display_name: meta.full_name || meta.name || null,
    avatar_url: meta.avatar_url || meta.picture || null,
    email: user.email,
  }, { onConflict: 'id' });

  if (error) console.warn('Profile upsert error:', error.message);
}

// ---------- Saved Locations ----------
async function saveLocation(label, address, lat, lng, isFavorite) {
  if (!_supabaseClient || !currentUser) { showToast('Sign in to save locations.'); return; }

  const { error } = await _supabaseClient.from('saved_locations').insert({
    user_id: currentUser.id,
    label: label,
    address: address,
    lat: lat,
    lng: lng,
    is_favorite: isFavorite || false,
  });

  if (error) {
    console.error('Save location error:', error);
    showToast('Failed to save location.');
  } else {
    showToast('Location saved!');
    logActivity('save_location', { label, address });
  }
}

async function getSavedLocations() {
  if (!_supabaseClient || !currentUser) return [];
  const { data, error } = await _supabaseClient
    .from('saved_locations')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('Fetch saved locations error:', error); return []; }
  return data || [];
}

async function deleteSavedLocation(id) {
  if (!_supabaseClient || !currentUser) return;
  const { error } = await _supabaseClient
    .from('saved_locations')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) console.error('Delete location error:', error);
}

async function toggleLocationFavorite(id, isFav) {
  if (!_supabaseClient || !currentUser) return;
  await _supabaseClient
    .from('saved_locations')
    .update({ is_favorite: isFav })
    .eq('id', id)
    .eq('user_id', currentUser.id);
}

// ---------- Venue Interactions (selections, favorites, views, directions) ----------
async function logVenueInteraction(venue, type, extra) {
  if (!_supabaseClient) return;

  const row = {
    session_id: _getSessionId(),
    anon_id: _getOrCreateAnonId(),
    user_id: currentUser ? currentUser.id : null,
    venue_name: venue.name,
    venue_place_id: venue.placeId || null,
    venue_address: venue.address || venue.vicinity || '',
    venue_lat: venue.lat || null,
    venue_lng: venue.lng || null,
    interaction_type: type,
  };
  if (extra) Object.assign(row, extra);

  const { error } = await _supabaseClient.from('venue_interactions').insert(row);
  if (error) console.warn('Venue interaction log error:', error.message);
}

async function getFavoriteVenues() {
  if (!_supabaseClient || !currentUser) return [];
  const { data, error } = await _supabaseClient
    .from('venue_interactions')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('interaction_type', 'favorite')
    .order('created_at', { ascending: false });

  if (error) { console.error('Fetch favorites error:', error); return []; }
  return data || [];
}

async function removeFavoriteVenue(id) {
  if (!_supabaseClient || !currentUser) return;
  await _supabaseClient
    .from('venue_interactions')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);
}

async function isVenueFavorited(placeId) {
  if (!_supabaseClient || !currentUser || !placeId) return false;
  const { data } = await _supabaseClient
    .from('venue_interactions')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('place_id', placeId)
    .eq('interaction_type', 'favorite')
    .limit(1);

  return data && data.length > 0;
}

// ---------- Search History ----------
async function logSearch(mode, vibe, aiPrompt, locations, meetingTime) {
  if (!_supabaseClient) return;

  const { error } = await _supabaseClient.from('search_history').insert({
    session_id: _getSessionId(),
    anon_id: _getOrCreateAnonId(),
    user_id: currentUser ? currentUser.id : null,
    mode: mode,
    vibe: vibe || null,
    ai_prompt: aiPrompt || null,
    locations: locations.map(l => ({ name: l.name, address: l.address, lat: l.lat, lng: l.lng })),
    meeting_time: meetingTime ? meetingTime.toISOString() : null,
  });

  if (error) console.warn('Search history log error:', error.message);
}

// ---------- Activity Logs ----------
async function logActivity(eventType, eventData) {
  if (!_supabaseClient || !currentUser) return;

  const { error } = await _supabaseClient.from('activity_logs').insert({
    user_id: currentUser.id,
    event_type: eventType,
    event_data: eventData || {},
  });

  if (error) console.warn('Activity log error:', error.message);
}

// ---------- Analytics (anonymous + signed-in) ----------
let _userGeoLocation = null;

function _getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenWidth: screen.width,
    screenHeight: screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    touchScreen: 'ontouchstart' in window,
    timestamp: new Date().toISOString(),
  };
}

function _getSessionId() {
  return (typeof state !== 'undefined' && state.sessionId) ? state.sessionId : 'unknown';
}

function _getOrCreateAnonId() {
  var key = 'midway_anon_id';
  var id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));
    localStorage.setItem(key, id);
  }
  return id;
}

function _requestGeoLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      _userGeoLocation = {
        lat: Math.round(pos.coords.latitude * 100) / 100,
        lng: Math.round(pos.coords.longitude * 100) / 100,
      };
    },
    function() { /* user denied or unavailable */ },
    { timeout: 5000, maximumAge: 300000 }
  );
}

async function trackEvent(eventType, eventData) {
  if (!_supabaseClient) return;

  try {
    await _supabaseClient.from('analytics_events').insert({
      session_id: _getSessionId(),
      anon_id: _getOrCreateAnonId(),
      user_id: currentUser ? currentUser.id : null,
      event_type: eventType,
      event_data: eventData || {},
      device_info: _getDeviceInfo(),
      user_location: _userGeoLocation,
      page_url: window.location.pathname,
    });
  } catch (e) {
    // silently fail — analytics should never break the app
  }
}

// ---------- API Call Logging ----------
async function logApiCall(provider, apiType, success, errorMessage, latencyMs) {
  if (!_supabaseClient) return;
  try {
    await _supabaseClient.from('api_calls').insert({
      session_id: _getSessionId(),
      anon_id: _getOrCreateAnonId(),
      user_id: currentUser ? currentUser.id : null,
      provider: provider,
      api_type: apiType,
      success: success,
      error_message: errorMessage || null,
      latency_ms: latencyMs || null,
    });
  } catch (e) { /* silent */ }
}

// ---------- Client Log Capture ----------
var _origConsoleLog, _origConsoleWarn, _origConsoleError;

function _initClientLogCapture() {
  _origConsoleLog = console.log;
  _origConsoleWarn = console.warn;
  _origConsoleError = console.error;

  console.log = function() {
    _sendClientLog('log', Array.from(arguments).map(String).join(' '));
  };
  console.warn = function() {
    _sendClientLog('warn', Array.from(arguments).map(String).join(' '));
  };
  console.error = function() {
    _sendClientLog('error', Array.from(arguments).map(String).join(' '));
  };

  // Catch unhandled errors
  window.addEventListener('error', function(e) {
    _sendClientLog('error', e.message, e.error ? e.error.stack : null, {
      filename: e.filename, lineno: e.lineno, colno: e.colno,
    });
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    _sendClientLog('error', 'Unhandled rejection: ' + String(e.reason), null, null);
  });
}

async function _sendClientLog(level, message, stack, context) {
  if (!_supabaseClient) return;
  try {
    await _supabaseClient.from('client_logs').insert({
      session_id: _getSessionId(),
      anon_id: _getOrCreateAnonId(),
      user_id: currentUser ? currentUser.id : null,
      log_level: level,
      message: (message || '').substring(0, 2000),
      stack: stack ? stack.substring(0, 4000) : null,
      context: context || null,
      page_url: window.location.pathname,
    });
  } catch (e) { /* silent — don't recurse */ }
}

// ---------- Session Metrics (active time + time-to-first-action) ----------
var _sessionStartTime = Date.now();
var _activeAccumulatedMs = 0;
var _lastVisibleAt = Date.now();
var _isTabVisible = true;
var _firstActionRecorded = false;
var _firstActionTtfaSec = null;

function _initSessionMetrics() {
  _sendClientLog('info', '[SM] _initSessionMetrics called. sessionId=' + _getSessionId() + ' startTime=' + _sessionStartTime);

  // Track visibility changes
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      // Tab went hidden — accumulate time spent visible
      if (_isTabVisible) {
        _activeAccumulatedMs += Date.now() - _lastVisibleAt;
      }
      _isTabVisible = false;
    } else {
      // Tab became visible again
      _lastVisibleAt = Date.now();
      _isTabVisible = true;
    }
  });

  // Periodic heartbeat every 30s
  setInterval(function() {
    _sendClientLog('info', '[SM] heartbeat: activeSec=' + _getActiveDurationSec() + ' ttfa=' + _firstActionTtfaSec + ' firstActionRecorded=' + _firstActionRecorded);
    _flushSessionMetrics();
  }, 30000);

  // Flush on page unload
  window.addEventListener('beforeunload', function() {
    _flushSessionMetrics(true);
  });

  // Initial insert
  _flushSessionMetrics();
}

function _getActiveDurationSec() {
  var total = _activeAccumulatedMs;
  if (_isTabVisible) {
    total += Date.now() - _lastVisibleAt;
  }
  return Math.round(total / 1000);
}

function recordFirstVenueAction() {
  _sendClientLog('info', '[SM] recordFirstVenueAction called. alreadyRecorded=' + _firstActionRecorded + ' activeSec=' + _getActiveDurationSec());
  if (_firstActionRecorded) return;
  _firstActionRecorded = true;
  _firstActionTtfaSec = _getActiveDurationSec();
  _sendClientLog('info', '[SM] TTFA captured: ' + _firstActionTtfaSec + 's. Flushing now.');
  // Flush immediately so TTFA is saved
  _flushSessionMetrics();
}

async function _flushSessionMetrics(isUnload) {
  if (!_supabaseClient) {
    _sendClientLog('warn', '[SM] flush skipped — no supabase client');
    return;
  }
  var activeSec = _getActiveDurationSec();
  var ttfaSec = _firstActionTtfaSec;

  var row = {
    session_id: _getSessionId(),
    anon_id: _getOrCreateAnonId(),
    user_id: currentUser ? currentUser.id : null,
    active_duration_sec: activeSec,
    time_to_first_action_sec: ttfaSec,
    started_at: new Date(_sessionStartTime).toISOString(),
    last_heartbeat_at: new Date().toISOString(),
  };

  _sendClientLog('info', '[SM] flush: sessionId=' + row.session_id + ' activeSec=' + activeSec + ' ttfaSec=' + ttfaSec + ' isUnload=' + !!isUnload);

  try {
    var res = await _supabaseClient.from('session_metrics')
      .upsert(row, { onConflict: 'session_id' });
    if (res.error) {
      _sendClientLog('error', '[SM] upsert failed: ' + res.error.message + ' | code=' + res.error.code + ' | details=' + res.error.details);
    } else {
      _sendClientLog('info', '[SM] upsert success');
    }
  } catch (e) {
    _sendClientLog('error', '[SM] flush exception: ' + e.message);
  }
}

// ---------- Side Panel UI ----------
function closeSidePanel() {
  document.getElementById('sidePanel').classList.remove('open');
  document.getElementById('sidePanelOverlay').classList.remove('open');
}

function openSidePanel(title) {
  document.getElementById('sidePanelTitle').textContent = title;
  document.getElementById('sidePanel').classList.add('open');
  document.getElementById('sidePanelOverlay').classList.add('open');
  closeUserDropdown();
}

async function showSavedLocations() {
  openSidePanel('Saved Locations');
  const body = document.getElementById('sidePanelBody');
  body.innerHTML = '<div class="sp-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  const locations = await getSavedLocations();

  if (locations.length === 0) {
    body.innerHTML = '<div class="sp-empty"><i class="fa-solid fa-bookmark"></i><p>No saved locations yet.</p><p class="sp-hint">Use the <i class="fa-solid fa-bookmark"></i> button on location inputs to save them.</p></div>';
    return;
  }

  body.innerHTML = locations.map(loc => `
    <div class="sp-card">
      <div class="sp-card-info">
        <div class="sp-card-name">${escapeHtml(loc.label)}</div>
        <div class="sp-card-detail">${escapeHtml(loc.address)}</div>
      </div>
      <div class="sp-card-actions">
        <button class="btn-tiny" onclick="useLocationFromSaved('${escapeHtml(loc.label)}', '${escapeHtml(loc.address)}', ${loc.lat}, ${loc.lng})" title="Use in session">
          <i class="fa-solid fa-location-dot"></i>
        </button>
        <button class="btn-tiny ${loc.is_favorite ? 'fav-active' : ''}" onclick="toggleSavedLocFav(${loc.id}, ${!loc.is_favorite})" title="${loc.is_favorite ? 'Unfavorite' : 'Favorite'}">
          <i class="fa-solid fa-heart"></i>
        </button>
        <button class="btn-tiny danger" onclick="deleteSavedLocAndRefresh(${loc.id})" title="Delete">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

async function showFavoriteVenues() {
  openSidePanel('Favorite Venues');
  const body = document.getElementById('sidePanelBody');
  body.innerHTML = '<div class="sp-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  const favs = await getFavoriteVenues();

  if (favs.length === 0) {
    body.innerHTML = '<div class="sp-empty"><i class="fa-solid fa-heart"></i><p>No favorite venues yet.</p><p class="sp-hint">Click the <i class="fa-solid fa-heart"></i> on venue cards to favorite them.</p></div>';
    return;
  }

  body.innerHTML = favs.map(f => `
    <div class="sp-card">
      <div class="sp-card-info">
        <div class="sp-card-name">${escapeHtml(f.venue_name)}</div>
        <div class="sp-card-detail">${escapeHtml(f.address || '')}</div>
      </div>
      <div class="sp-card-actions">
        ${f.place_id ? '<button class="btn-tiny" onclick="openGoogleMapsPlace(\'' + f.place_id + '\')" title="View">View</button>' : ''}
        <button class="btn-tiny danger" onclick="removeFavAndRefresh(${f.id})" title="Remove">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// Side panel action helpers
function useLocationFromSaved(label, address, lat, lng) {
  closeSidePanel();
  // Find first empty location input or add a new one
  const inputs = document.querySelectorAll('.location-row input[data-id]');
  let targetId = null;
  for (const input of inputs) {
    if (!input.value.trim()) {
      targetId = parseInt(input.dataset.id, 10);
      input.value = address;
      break;
    }
  }
  if (targetId === null) {
    addLocationInput(label);
    targetId = locationCounter;
    const newInput = document.querySelector('input[data-id="' + targetId + '"]');
    if (newInput) newInput.value = address;
  }
  setLocationForId(targetId, address, lat, lng);
  showToast('Location loaded: ' + label);
}


async function toggleSavedLocFav(id, isFav) {
  await toggleLocationFavorite(id, isFav);
  showSavedLocations(); // refresh
}

async function deleteSavedLocAndRefresh(id) {
  await deleteSavedLocation(id);
  showSavedLocations();
}

async function removeFavAndRefresh(id) {
  await removeFavoriteVenue(id);
  showFavoriteVenues();
}

// ---------- Save/Favorite Buttons for Location Rows ----------
function saveCurrentLocation(id) {
  if (!currentUser) { showToast('Sign in to save locations.'); return; }
  const loc = state.locations.find(l => l.id === id);
  if (!loc || !loc.address) { showToast('Enter a location first.'); return; }
  saveLocation(loc.name, loc.address, loc.lat, loc.lng, false);
}

// ---------- Favorite Venue Toggle ----------
async function toggleVenueFavorite(venueId, btn) {
  if (!currentUser) { showToast('Sign in to favorite venues.'); return; }
  const venue = state.results.find(v => v.id === venueId);
  if (!venue) return;

  if (btn.classList.contains('fav-active')) {
    // Remove favorite
    if (venue.placeId) {
      const { data } = await _supabaseClient
        .from('venue_interactions')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('place_id', venue.placeId)
        .eq('interaction_type', 'favorite')
        .limit(1);
      if (data && data[0]) {
        await removeFavoriteVenue(data[0].id);
      }
    }
    btn.classList.remove('fav-active');
    showToast('Removed from favorites.');
  } else {
    await logVenueInteraction(venue, 'favorite');
    btn.classList.add('fav-active');
    showToast('Added to favorites!');
  }
}

// ============================================
// Subscription / Upgrade Logic
// ============================================
let _userSubscription = null; // cached active subscription

function isProUser() {
  if (currentUser && currentUser.email === 'svirat@gmail.com') return true;
  return !!(_userSubscription && (_userSubscription.status === 'active' || _userSubscription.status === 'cancelled') && new Date(_userSubscription.expires_at) > new Date());
}

async function fetchUserSubscription() {
  if (!_supabaseClient || !currentUser) { _userSubscription = null; return null; }
  const { data, error } = await _supabaseClient
    .from('subscriptions')
    .select('*')
    .eq('user_id', currentUser.id)
    .in('status', ['active', 'cancelled'])
    .gte('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1);
  if (error) { console.warn('Subscription fetch error:', error.message); _userSubscription = null; return null; }
  _userSubscription = (data && data[0]) || null;
  return _userSubscription;
}

async function saveSubscription(plan, paymentId, subscriptionId) {
  if (!_supabaseClient || !currentUser) return;
  const amount = plan === 'yearly' ? 999 : 99;
  const now = new Date();
  const expiresAt = new Date(now);
  if (plan === 'yearly') {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }
  const { error } = await _supabaseClient.from('subscriptions').insert({
    user_id: currentUser.id,
    plan: plan,
    status: 'active',
    razorpay_payment_id: paymentId || null,
    razorpay_subscription_id: subscriptionId || null,
    amount: amount,
    currency: 'INR',
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (error) { console.error('Subscription save error:', error); return; }
  await fetchUserSubscription();
  updateUpgradeButton();
  trackEvent('subscription_created', { plan, amount });
}

function updateUpgradeButton() {
  var btn = document.getElementById('upgradeBtn');
  if (!btn) return;
  if (isProUser()) {
    btn.innerHTML = '<i class="fa-solid fa-crown"></i> Pro';
    btn.classList.add('is-pro');
  } else {
    btn.innerHTML = '<i class="fa-solid fa-gem"></i> Upgrade';
    btn.classList.remove('is-pro');
  }
}

function updateProBadge() {
  var show = isProUser();
  var avatarBadge = document.getElementById('proBadgeAvatar');
  var dropdownBadge = document.getElementById('proBadgeDropdown');
  if (avatarBadge) avatarBadge.style.display = show ? '' : 'none';
  if (dropdownBadge) dropdownBadge.style.display = show ? 'inline' : 'none';
}

// ---------- Upgrade Modal ----------
function showUpgradeModal() {
  if (isProUser()) {
    showToast('You are already a Pro user!');
    return;
  }
  document.getElementById('upgradeModal').classList.add('visible');
  // Reset toggle to monthly
  document.getElementById('planToggle').checked = false;
  onPlanToggle();
}

function hideUpgradeModal(e) {
  if (e && e.target && e.target.id !== 'upgradeModal') return;
  document.getElementById('upgradeModal').classList.remove('visible');
}

function onPlanToggle() {
  var isYearly = document.getElementById('planToggle').checked;
  var priceEl = document.getElementById('upgradePrice');
  var monthlyLabel = document.getElementById('planLabelMonthly');
  var yearlyLabel = document.getElementById('planLabelYearly');
  if (isYearly) {
    priceEl.innerHTML = '<span class="price-amount">₹999</span><span class="price-period">/year</span>';
    monthlyLabel.classList.remove('active');
    yearlyLabel.classList.add('active');
  } else {
    priceEl.innerHTML = '<span class="price-amount">₹99</span><span class="price-period">/month</span>';
    monthlyLabel.classList.add('active');
    yearlyLabel.classList.remove('active');
  }
}

function startUpgradeFlow() {
  // Must be signed in
  if (!currentUser) {
    hideUpgradeModal();
    showToast('Please sign in to upgrade.');
    try { sessionStorage.setItem('_pendingUpgrade', '1'); } catch(e) {}
    signInWithGoogle();
    return;
  }

  if (currentUser.email === 'svirat@gmail.com') {
    hideUpgradeModal();
    showToast('Pro activated!');
    return;
  }

  var isYearly = document.getElementById('planToggle').checked;
  var plan = isYearly ? 'yearly' : 'monthly';

  // Disable button while creating subscription
  var ctaBtn = document.getElementById('upgradeCta');
  if (ctaBtn) { ctaBtn.disabled = true; ctaBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...'; }

  // Step 1: Create a Razorpay subscription on the server
  fetch('/api/create-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: plan, user_id: currentUser.id }),
  })
  .then(function(resp) { return resp.json(); })
  .then(function(data) {
    if (!data.subscription_id) {
      showToast(data.error || 'Could not create subscription.');
      if (ctaBtn) { ctaBtn.disabled = false; ctaBtn.innerHTML = '<i class="fa-solid fa-gem"></i> Upgrade Now'; }
      return;
    }

    // Step 2: Open Razorpay Checkout modal with subscription
    var options = {
      key: data.key_id,
      subscription_id: data.subscription_id,
      name: 'Midway Pro',
      description: plan === 'yearly' ? 'Yearly Plan — ₹999/year' : 'Monthly Plan — ₹99/month',
      handler: function(response) {
        // Step 3: Verify payment server-side
        _verifyRazorpayPayment(response.razorpay_subscription_id, response.razorpay_payment_id, response.razorpay_signature, plan);
      },
      prefill: {
        name: (currentUser.user_metadata || {}).full_name || '',
        email: currentUser.email || '',
      },
      theme: { color: '#F59E0B' },
      modal: {
        ondismiss: function() {
          if (ctaBtn) { ctaBtn.disabled = false; ctaBtn.innerHTML = '<i class="fa-solid fa-gem"></i> Upgrade Now'; }
        },
      },
    };

    var rzp = new Razorpay(options);
    rzp.on('payment.failed', function(response) {
      showToast('Payment failed: ' + (response.error.description || 'Please try again.'));
      if (ctaBtn) { ctaBtn.disabled = false; ctaBtn.innerHTML = '<i class="fa-solid fa-gem"></i> Upgrade Now'; }
    });
    rzp.open();
    hideUpgradeModal();
  })
  .catch(function(err) {
    console.error('Create subscription error:', err);
    showToast('Could not initiate payment. Please try again.');
    if (ctaBtn) { ctaBtn.disabled = false; ctaBtn.innerHTML = '<i class="fa-solid fa-gem"></i> Upgrade Now'; }
  });
}

async function _verifyRazorpayPayment(subscriptionId, paymentId, signature, plan) {
  showToast('Verifying payment...');
  try {
    var resp = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_subscription_id: subscriptionId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      }),
    });
    var data = await resp.json();
    if (data.verified) {
      await saveSubscription(plan, paymentId, subscriptionId);
      showToast('Pro plan activated! Enjoy Midway Pro.');
    } else {
      showToast('Payment verification failed: ' + (data.error || 'Invalid signature'));
    }
  } catch (e) {
    console.error('Payment verification error:', e);
    showToast('Could not verify payment. Please contact support.');
  }
  var ctaBtn = document.getElementById('upgradeCta');
  if (ctaBtn) { ctaBtn.disabled = false; ctaBtn.innerHTML = '<i class="fa-solid fa-gem"></i> Upgrade Now'; }
}

// ---------- Manage / Cancel Subscription ----------
function updateManageSubItem() {
  var item = document.getElementById('manageSubItem');
  if (!item) return;
  item.style.display = isProUser() ? '' : 'none';
}

function showCancelSubConfirm() {
  closeUserDropdown();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay visible';
  overlay.id = 'cancelSubModal';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var plan = _userSubscription ? _userSubscription.plan : '';
  var expiresDate = _userSubscription && _userSubscription.expires_at ? new Date(_userSubscription.expires_at) : null;
  var expires = expiresDate && !isNaN(expiresDate) ? expiresDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'the end of your billing cycle';

  overlay.innerHTML = '<div class="modal payment-confirm-modal" onclick="event.stopPropagation()">' +
    '<button class="modal-close" onclick="document.getElementById(\'cancelSubModal\').remove()"><i class="fa-solid fa-xmark"></i></button>' +
    '<div style="text-align:center;padding:8px 0 16px">' +
    '<i class="fa-solid fa-circle-exclamation" style="font-size:2.5rem;color:var(--warning)"></i>' +
    '<h3 style="margin:12px 0 8px">Cancel Subscription?</h3>' +
    '<p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:6px">Your <strong>' + plan + '</strong> Pro plan will remain active until <strong>' + expires + '</strong>.</p>' +
    '<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:20px">After that, you\'ll switch back to the free plan.</p>' +
    '<div style="display:flex;gap:8px;justify-content:center">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'cancelSubModal\').remove()">Keep Plan</button>' +
    '<button class="btn btn-primary" style="background:var(--danger)" onclick="confirmCancelSubscription()">Cancel Subscription</button>' +
    '</div></div></div>';
  document.body.appendChild(overlay);
}

async function confirmCancelSubscription() {
  var modal = document.getElementById('cancelSubModal');
  if (modal) modal.remove();

  if (!_supabaseClient || !currentUser || !_userSubscription) return;

  // Call server to cancel on Razorpay (stops future renewals)
  try {
    var session = (await _supabaseClient.auth.getSession()).data.session;
    var resp = await fetch('/api/cancel-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (session ? session.access_token : ''),
      },
      body: JSON.stringify({ razorpay_subscription_id: _userSubscription.razorpay_subscription_id }),
    });
    var data = await resp.json();
    if (!resp.ok) {
      showToast(data.error || 'Failed to cancel. Please try again.');
      return;
    }
  } catch (e) {
    console.error('Cancel subscription error:', e);
    showToast('Failed to cancel. Please try again.');
    return;
  }

  // Update local DB status
  await _supabaseClient
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', _userSubscription.id)
    .eq('user_id', currentUser.id);

  _userSubscription.status = 'cancelled';
  updateUpgradeButton();
  updateProBadge();
  updateManageSubItem();
  showToast('Subscription cancelled. Pro access remains until ' + new Date(_userSubscription.expires_at).toLocaleDateString() + '.');
  trackEvent('subscription_cancelled', { plan: _userSubscription.plan });
}
