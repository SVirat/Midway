/* Google AdSense loader and responsive placement controller. */
(function() {
  var clientPattern = /^ca-pub-\d+$/;
  var slotPattern = /^\d+$/;
  var placements = {
    setup: 'ADSENSE_SETUP_SLOT',
  };

  function isConfigured() {
    return typeof CONFIG !== 'undefined' && clientPattern.test(CONFIG.ADSENSE_CLIENT_ID || '');
  }

  function isPro() {
    return typeof isProUser === 'function' && isProUser();
  }

  function hideAllAds() {
    document.querySelectorAll('.ad-placement').forEach(function(placement) {
      placement.hidden = true;
    });
  }

  function loadAdSenseScript() {
    if (document.querySelector('script[data-midway-adsense]')) return;
    var script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.midwayAdsense = 'true';
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(CONFIG.ADSENSE_CLIENT_ID);
    document.head.appendChild(script);
  }

  function showPlacement(name) {
    if (!isConfigured() || isPro()) return;
    var placement = document.querySelector('[data-ad-placement="' + name + '"]');
    var slot = CONFIG[placements[name]] || '';
    if (!placement || !slotPattern.test(slot)) return;

    var unit = placement.querySelector('.adsbygoogle');
    placement.hidden = false;
    unit.dataset.adClient = CONFIG.ADSENSE_CLIENT_ID;
    unit.dataset.adSlot = slot;

    if (unit.dataset.adRequested !== 'true') {
      unit.dataset.adRequested = 'true';
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }

  function updateAdsVisibility() {
    if (!isConfigured() || isPro()) {
      hideAllAds();
      return;
    }

    loadAdSenseScript();
    showPlacement('setup');
  }

  window.updateAdsVisibility = updateAdsVisibility;

  document.addEventListener('DOMContentLoaded', updateAdsVisibility);
})();