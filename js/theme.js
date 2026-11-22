/* theme.js — light / dark / system mode + accent colour themes, remembered per browser. */
(function () {
  var root = document.documentElement;
  var ACC = [
    { id: 'blue', name: 'Ocean', p: '#0b63e5', s: '#7c3aed' }, { id: 'violet', name: 'Orchid', p: '#6d3df0', s: '#a21caf' },
    { id: 'green', name: 'Forest', p: '#047857', s: '#0e7490' }, { id: 'orange', name: 'Ember', p: '#c2410c', s: '#b45309' },
    { id: 'rose', name: 'Rose', p: '#be123c', s: '#7c3aed' }
  ];
  var MODES = [{ id: 'system', name: 'System', icon: 'monitor' }, { id: 'light', name: 'Light', icon: 'sun' }, { id: 'dark', name: 'Dark', icon: 'moon' }];
  var get = function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  var put = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var mode = get('qs_theme', 'system'), acc = get('qs_accent', 'blue');
  if (!MODES.some(function (m) { return m.id === mode; })) mode = 'system';
  if (!ACC.some(function (a) { return a.id === acc; })) acc = 'blue';
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var effective = function () { return mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode; };
  var btn, pop;

  function apply() {
    if (mode === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
    if (acc === 'blue') root.removeAttribute('data-accent'); else root.setAttribute('data-accent', acc);
    var icons = document.querySelectorAll('link[rel="icon"]');
    for (var i = 1; i < icons.length; i++) icons[i].remove();
    if (icons[0]) { icons[0].removeAttribute('media'); icons[0].href = effective() === 'dark' ? 'favicon-dark.png' : 'favicon.png'; }
    if (btn) btn.innerHTML = window.icon(effective() === 'dark' ? 'moon' : 'sun');
  }

  function build() {
    var host = document.querySelector('.nav-right'); if (!host) return;
    btn = document.createElement('button');
    btn.className = 'theme-btn'; btn.type = 'button';
    btn.setAttribute('aria-label', 'Appearance: light, dark and colour themes');
    btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'themePop');
    pop = document.createElement('div');
    pop.id = 'themePop'; pop.className = 'theme-pop'; pop.hidden = true;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Appearance');
    pop.innerHTML =
      '<div class="grp"><h2 id="tpMode">Mode</h2><div class="seg" role="radiogroup" aria-labelledby="tpMode">' +
      MODES.map(function (m) { return '<button type="button" role="radio" data-mode="' + m.id + '" aria-checked="false">' + window.icon(m.icon) + m.name + '</button>'; }).join('') +
      '</div></div><div class="grp"><h2 id="tpColor">Color theme</h2><div class="swatches" role="radiogroup" aria-labelledby="tpColor">' +
      ACC.map(function (a) { return '<button type="button" class="swatch" role="radio" data-acc="' + a.id + '" aria-label="' + a.name + '" title="' + a.name + '" aria-checked="false" style="--p:' + a.p + ';--s:' + a.s + '">' + window.icon('check') + '</button>'; }).join('') +
      '</div><div class="swatch-name" aria-live="polite"></div></div>';
    host.insertBefore(btn, host.firstChild); host.appendChild(pop);
    btn.addEventListener('click', function () { pop.hidden ? open() : close(true); });
    pop.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]'), a = e.target.closest('[data-acc]');
      if (m) { mode = m.getAttribute('data-mode'); put('qs_theme', mode); }
      if (a) { acc = a.getAttribute('data-acc'); put('qs_accent', acc); }
      if (m || a) { apply(); sync(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) close(true); });
    document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(false); });
    (mq.addEventListener ? mq.addEventListener('change', function () { if (mode === 'system') apply(); }) : 0);
    sync(); apply();
  }
  function sync() {
    pop.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-mode') === mode)); });
    pop.querySelectorAll('[data-acc]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-acc') === acc)); });
    var cur = ACC.filter(function (a) { return a.id === acc; })[0];
    pop.querySelector('.swatch-name').textContent = cur ? cur.name : '';
  }
  function open() { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); var f = pop.querySelector('[aria-checked="true"]'); f && f.focus(); }
  function close(ret) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (ret) btn.focus(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
