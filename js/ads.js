/* ads.js — Google AdSense slots.
   HOW TO TURN ADS ON: put your AdSense publisher id in `client` and an ad-unit id for each slot you want.
   Slots with no id stay hidden (no empty boxes). Ads never load on localhost. */
(function () {
  var CONFIG = {
    client: '',                // e.g. 'ca-pub-1234567890123456'
    slots: {
      'home-mid': '',          // between Calls and Files on the home page
      'home-bottom': '',       // bottom of the home page
      'page-bottom': '',       // bottom of About / Contact / Privacy
      'chat-sidebar': ''       // under the group list on the chat page (desktop only)
    }
  };
  if (!CONFIG.client || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
  var used = false;
  document.querySelectorAll('.ad-slot[data-ad]').forEach(function (el) {
    var id = CONFIG.slots[el.getAttribute('data-ad')]; if (!id) return;
    el.innerHTML = '<span class="ad-label">Advertisement</span><div class="ad-box"><ins class="adsbygoogle" style="display:block" data-ad-client="' + CONFIG.client +
      '" data-ad-slot="' + id + '" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
    el.hidden = false; used = true;
    var ins = el.querySelector('ins');
    new MutationObserver(function () { if (ins.getAttribute('data-ad-status') === 'unfilled') el.hidden = true; }).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
  });
  if (!used) return;
  var s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(CONFIG.client);
  s.onload = function () {
    document.querySelectorAll('.ad-slot:not([hidden]) ins.adsbygoogle').forEach(function () { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {} });
  };
  document.head.appendChild(s);
})();
