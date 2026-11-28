/* Call effects: neon air-drawing + hookah smoke, driven by hand/face tracking.
   The result is composited onto your camera and sent to everyone in the call.
   MediaPipe loads only when you first use it. */
(function () {
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/';
  const COLORS = ['#00f3ff', '#ff00e6', '#39ff14', '#fff01f', '#ff5e00', '#bc13fe'], ERASE_R = 44;
  let color = COLORS[0], size = 7, mode = 'DRAW';
  let hands, face, vid, cv, cx, ink, ix, track, raf, ui, st, on = false, busy = false, tf = 0;
  let last = null, cur = null, buf = [], hand = null, mouth = null, charge = 0, smoke = [];
  const libs = {};

  const load = (name, file) => libs[name] || (libs[name] = new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = CDN + name + '/' + file; s.crossOrigin = 'anonymous';
    s.onload = ok; s.onerror = () => { delete libs[name]; no(new Error('Could not load ' + name)); };
    document.head.appendChild(s);
  }));
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');

  // index up = draw, open palm = erase, anything else = pause
  function gesture(l) {
    const d = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2, w = l[0];
    const up = (t, p) => d(l[t], w) > d(l[p], w) * 1.15;
    const f = [up(8, 6), up(12, 10), up(16, 14), up(20, 18)];
    if (f.filter(Boolean).length >= 4) return 'ERASE';
    return f[0] && !f[1] && !f[2] && !f[3] ? 'DRAW' : 'PAUSE';
  }

  function onHand(r) {
    const l = r.multiHandLandmarks && r.multiHandLandmarks[0];
    if (!l) { last = cur = hand = null; buf = []; return say(false); }
    const W = cv.width, H = cv.height;
    const gx = (l[5].x * .45 + l[9].x * .35 + l[2].x * .2) * W, gy = (l[5].y * .45 + l[9].y * .35 + l[2].y * .2) * H;
    const ang = Math.atan2(gy - l[0].y * H, gx - l[0].x * W), L = H * .16;
    hand = { gx, gy, ang, L, tx: gx + Math.cos(ang) * L, ty: gy + Math.sin(ang) * L };
    say(true);
    if (mode !== 'DRAW') return;
    buf.push(gesture(l)); if (buf.length > 4) buf.shift();
    const g = ['ERASE', 'DRAW', 'PAUSE'].sort((a, b) => buf.filter(v => v === b).length - buf.filter(v => v === a).length)[0];
    const p = g === 'ERASE' ? l[9] : l[8], x = p.x * W, y = p.y * H;
    const s = last ? { x: last.x + (x - last.x) * .5, y: last.y + (y - last.y) * .5 } : { x, y };
    cur = { x: s.x, y: s.y, g };
    if (g === 'DRAW') {
      ix.save(); ix.lineCap = ix.lineJoin = 'round'; ix.strokeStyle = color; ix.lineWidth = size;
      ix.shadowColor = color; ix.shadowBlur = size * 2.2;
      ix.beginPath(); ix.moveTo((last || s).x, (last || s).y); ix.lineTo(s.x, s.y); ix.stroke(); ix.restore();
      ix.save(); ix.strokeStyle = '#fff'; ix.lineWidth = Math.max(1.5, size * .34); ix.lineCap = 'round'; // white-hot core
      ix.beginPath(); ix.moveTo((last || s).x, (last || s).y); ix.lineTo(s.x, s.y); ix.stroke(); ix.restore();
      last = s;
    } else {
      last = null;
      if (g === 'ERASE') { ix.save(); ix.globalCompositeOperation = 'destination-out'; ix.beginPath(); ix.arc(s.x, s.y, ERASE_R, 0, 7); ix.fill(); ix.restore(); }
    }
  }

  function onFace(r) {
    const l = r.multiFaceLandmarks && r.multiFaceLandmarks[0];
    if (!l) { mouth = null; return; }
    const W = cv.width, H = cv.height, u = l[13], d = l[14];
    const fh = Math.hypot((l[152].x - l[10].x) * W, (l[152].y - l[10].y) * H) || 1;
    mouth = { x: (u.x + d.x) / 2 * W, y: (u.y + d.y) / 2 * H, open: Math.hypot((d.x - u.x) * W, (d.y - u.y) * H) / fh };
  }

  function hookah() {
    const W = cv.width, H = cv.height, near = hand && mouth && Math.hypot(hand.tx - mouth.x, hand.ty - mouth.y) < H * .11;
    if (near) charge = Math.min(100, charge + 1.4);
    else if (mouth && mouth.open > .03 && charge > 3) {
      for (let i = 0; i < 3; i++) smoke.push({ x: mouth.x + (Math.random() - .5) * 14, y: mouth.y, vx: (Math.random() - .5) * 2.4, vy: -1 - Math.random() * 2.2, r: 12 + Math.random() * 14, max: 60 + Math.random() * 50, life: 0, maxLife: 70 + Math.random() * 60 });
      charge -= 1.6;
    } else charge = Math.max(0, charge - .05);
    const c = rgb(color);
    smoke = smoke.filter(p => ++p.life < p.maxLife);
    smoke.forEach(p => {
      p.vx *= .985; p.vy = p.vy * .985 - .02; p.x += p.vx; p.y += p.vy;
      const k = p.life / p.maxLife, r = p.r + (p.max - p.r) * Math.pow(k, .65), a = .42 * Math.min(1, k * 5) * (1 - Math.pow(k, 1.5));
      const g = cx.createRadialGradient(p.x, p.y, r * .1, p.x, p.y, r);
      g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
      cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.fill();
    });
    if (!hand) return;
    const gr = H * .07, bx = hand.gx - Math.cos(hand.ang) * gr, by = hand.gy - Math.sin(hand.ang) * gr;
    cx.save(); cx.lineCap = 'round'; // hose sagging to the bottom corner
    cx.beginPath(); cx.moveTo(bx, by); cx.quadraticCurveTo((bx + W * .88) / 2, H * 1.05, W * .88, H);
    cx.strokeStyle = '#1e1b2e'; cx.lineWidth = 12; cx.stroke(); cx.strokeStyle = color; cx.globalAlpha = .5; cx.lineWidth = 4; cx.setLineDash([9, 8]); cx.stroke(); cx.restore();
    cx.save(); cx.translate(hand.gx, hand.gy); cx.rotate(hand.ang); cx.lineWidth = 2;
    cx.fillStyle = '#7e22ce'; cx.strokeStyle = '#fbbf24'; cx.fillRect(-gr, -H * .014, gr + hand.L * .3, H * .028); cx.strokeRect(-gr, -H * .014, gr + hand.L * .3, H * .028);
    cx.fillStyle = '#d6b36a'; cx.fillRect(hand.L * .3, -H * .008, hand.L * .55, H * .016);
    cx.fillStyle = near ? color : '#f8fafc'; if (near) { cx.shadowColor = color; cx.shadowBlur = 16; }
    cx.fillRect(hand.L * .85, -H * .01, hand.L * .15, H * .02); cx.restore();
  }

  function say(h) { if (st) st.textContent = h ? 'Hand ✓' + (mode === 'HOOKAH' ? ' · puff ' + Math.round(charge) + '%' : '') : 'Show your hand to the camera'; }

  function tick() {
    if (!on) return;
    cx.drawImage(vid, 0, 0, cv.width, cv.height);
    if (mode === 'DRAW') {
      cx.drawImage(ink, 0, 0);
      if (cur) { cx.beginPath(); cx.arc(cur.x, cur.y, cur.g === 'ERASE' ? ERASE_R : size + 4, 0, 7); cx.strokeStyle = cur.g === 'ERASE' ? '#fb7185' : cur.g === 'DRAW' ? color : '#fbbf24'; cx.lineWidth = 2; cx.stroke(); }
    } else hookah();
    if (!busy) {
      busy = true;
      (async () => {
        try { await hands.send({ image: vid }); if (mode === 'HOOKAH' && face && (tf++ & 1) === 0) await face.send({ image: vid }); } catch (_) {}
        busy = false;
      })();
    }
    raf = requestAnimationFrame(tick);
  }

  async function setMode(m) {
    mode = m; last = cur = null; buf = [];
    if (ui) ui.querySelectorAll('[data-mode]').forEach(b => { b.style.background = b.dataset.mode === m ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.1)'; });
    if (m === 'HOOKAH' && !face) {
      if (st) st.textContent = 'Loading face tracking…';
      try {
        await load('face_mesh', 'face_mesh.js');
        face = new window.FaceMesh({ locateFile: f => CDN + 'face_mesh/' + f });
        face.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: .55, minTrackingConfidence: .55 });
        face.onResults(onFace);
      } catch (e) { mode = 'DRAW'; if (st) st.textContent = e.message; }
    }
  }

  function panel() {
    if (ui) return ui;
    ui = document.createElement('div');
    ui.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:92px;z-index:2147483000;display:none;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;max-width:94vw;padding:8px 12px;border-radius:16px;background:rgba(15,15,25,.88);border:1px solid rgba(255,255,255,.18);color:#fff;font:12px system-ui,sans-serif';
    const mk = (t, fn, extra) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; b.style.cssText = 'border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:5px 9px;font:inherit;cursor:pointer'; Object.assign(b.dataset, extra || {}); return b; };
    const sw = COLORS.map(c => { const b = document.createElement('button'); b.setAttribute('aria-label', 'Color ' + c); b.style.cssText = `width:22px;height:22px;padding:0;border-radius:50%;cursor:pointer;background:${c};border:2px solid ${c === color ? '#fff' : '#fff3'}`; b.onclick = () => { color = c; sw.forEach(x => x.style.borderColor = x === b ? '#fff' : '#fff3'); }; return b; });
    const rg = document.createElement('input'); rg.type = 'range'; rg.min = 2; rg.max = 24; rg.value = size; rg.style.width = '70px'; rg.setAttribute('aria-label', 'Brush size'); rg.oninput = () => { size = +rg.value; };
    st = document.createElement('span'); st.style.opacity = '.8';
    ui.append(...sw, rg, mk('✏️ Neon', () => setMode('DRAW'), { mode: 'DRAW' }), mk('💨 Hookah', () => setMode('HOOKAH'), { mode: 'HOOKAH' }), mk('Clear', () => { ix && ix.clearRect(0, 0, ink.width, ink.height); smoke = []; }), st);
    document.body.appendChild(ui);
    return ui;
  }

  async function toggle() {
    if (on) { stop(); return false; }
    const cam = window.videocall && videocall.cameraTrack();
    if (!cam) throw new Error('Start a video call first');
    await load('hands', 'hands.js');
    if (!hands) {
      hands = new window.Hands({ locateFile: f => CDN + 'hands/' + f });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: .6, minTrackingConfidence: .6 });
      hands.onResults(onHand);
    }
    vid = document.createElement('video'); vid.muted = true; vid.playsInline = true;
    vid.srcObject = new MediaStream([cam]); await vid.play();
    cv = document.createElement('canvas'); cv.width = vid.videoWidth || 1280; cv.height = vid.videoHeight || 720;
    ink = document.createElement('canvas'); ink.width = cv.width; ink.height = cv.height;
    cx = cv.getContext('2d'); ix = ink.getContext('2d');
    track = cv.captureStream(30).getVideoTracks()[0]; track.contentHint = 'motion';
    on = true; last = cur = hand = mouth = null; buf = []; charge = 0; smoke = [];
    panel().style.display = 'flex'; setMode(mode); say(false);
    videocall.setVideoTrack(track);
    tick();
    return true;
  }

  // silent=true when the whole call is ending (videocall handles its own tracks)
  function stop(silent) {
    if (!on && !track) return;
    on = false; cancelAnimationFrame(raf);
    if (ui) ui.style.display = 'none';
    if (!silent && window.videocall) { const cam = videocall.cameraTrack(); if (cam) videocall.setVideoTrack(cam); }
    if (track) { track.stop(); track = null; }
    if (vid) { vid.srcObject = null; vid = null; }
  }

  window.callfx = { toggle, reset: () => stop(true), isOn: () => on };
})();
