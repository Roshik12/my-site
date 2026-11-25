/* Runs before first paint so the saved theme never flashes. */
(function () {
  try {
    var d = document.documentElement, m = localStorage.getItem('qs_theme'), a = localStorage.getItem('qs_accent'), st = localStorage.getItem('qs_style');
    if (m === 'light' || m === 'dark') d.setAttribute('data-theme', m);
    if (a && a !== 'blue' && /^(violet|green|orange|rose)$/.test(a)) d.setAttribute('data-accent', a);
    if (st === 'neon') { d.setAttribute('data-style', 'neon'); d.setAttribute('data-theme', 'dark'); d.removeAttribute('data-accent'); }
  } catch (e) {}
})();
