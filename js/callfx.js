/* Call effects: hand-tracking neon "air canvas". Your drawing is composited onto your camera
   and sent to everyone in the call. MediaPipe loads only when you first turn it on. */
(function () {
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/';
  const COLOR = '#00f3ff', SIZE = 7, ERASE_R = 44;
  let hands, vid, cv, cx, ink, ix, track, raf, loading, on = false, busy = false;
  let last = null, cur = null, buf = [];

  function load() { // lazy-load the AI library once
    return loading || (loading = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = CDN + 'hands.js'; s.crossOrigin = 'anonymous';
      s.onload = ok; s.onerror = () => { loading = null; no(new Error('Could not load hand tracking')); };
      document.head.appendChild(s);
    }));
  }

  // index up = draw, open palm = erase, anything else = pause
  function gesture(l) {
    const d = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2, w = l[0];
    const up = (t, p) => d(l[t], w) > d(l[p], w) * 1.15;
    const idx = up(8, 6), mid = up(12, 10), ring = up(16, 14), pink = up(20, 18);
    if ([idx, mid, ring, pink].filter(Boolean).length >= 4) return 'ERASE';
    return idx && !mid && !ring && !pink ? 'DRAW' : 'PAUSE';
  }

  function onResults(r) {
    const l = r.multiHandLandmarks && r.multiHandLandmarks[0];
    if (!l) { last = cur = null; buf = []; return; }
    buf.push(gesture(l)); if (buf.length > 4) buf.shift();
    const g = buf.sort((a, b) => buf.filter(v => v === b).length - buf.filter(v => v === a).length)[0];
    const p = g === 'ERASE' ? l[9] : l[8];
    const x = p.x * cv.width, y = p.y * cv.height;
    const s = last ? { x: last.x + (x - last.x) * 0.5, y: last.y + (y - last.y) * 0.5 } : { x, y }; // light smoothing
    cur = { x: s.x, y: s.y, g };
    if (g === 'DRAW') {
      ix.save(); ix.lineCap = ix.lineJoin = 'round'; ix.strokeStyle = COLOR; ix.lineWidth = SIZE;
      ix.shadowColor = COLOR; ix.shadowBlur = SIZE * 2.2;
      ix.beginPath(); ix.moveTo((last || s).x, (last || s).y); ix.lineTo(s.x, s.y); ix.stroke(); ix.restore();
      last = s;
    } else {
      last = null;
      if (g === 'ERASE') { ix.save(); ix.globalCompositeOperation = 'destination-out'; ix.beginPath(); ix.arc(s.x, s.y, ERASE_R, 0, 7); ix.fill(); ix.restore(); }
    }
  }

  function tick() {
    if (!on) return;
    cx.drawImage(vid, 0, 0, cv.width, cv.height);
    cx.drawImage(ink, 0, 0);
    if (cur) { cx.beginPath(); cx.arc(cur.x, cur.y, cur.g === 'ERASE' ? ERASE_R : 9, 0, 7); cx.strokeStyle = cur.g === 'ERASE' ? '#fb7185' : cur.g === 'DRAW' ? COLOR : '#fbbf24'; cx.lineWidth = 2; cx.stroke(); }
    if (!busy) { busy = true; hands.send({ image: vid }).catch(() => {}).then(() => { busy = false; }); }
    raf = requestAnimationFrame(tick);
  }

  async function toggle() {
    if (on) { stop(); return false; }
    const cam = window.videocall && videocall.cameraTrack();
    if (!cam) throw new Error('Start a video call first');
    await load();
    if (!hands) {
      hands = new window.Hands({ locateFile: f => CDN + f });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
      hands.onResults(onResults);
    }
    vid = document.createElement('video'); vid.muted = true; vid.playsInline = true;
    vid.srcObject = new MediaStream([cam]); await vid.play();
    cv = document.createElement('canvas'); cv.width = vid.videoWidth || 1280; cv.height = vid.videoHeight || 720;
    ink = document.createElement('canvas'); ink.width = cv.width; ink.height = cv.height;
    cx = cv.getContext('2d'); ix = ink.getContext('2d');
    track = cv.captureStream(30).getVideoTracks()[0];
    track.contentHint = 'motion';
    on = true; last = cur = null; buf = [];
    videocall.setVideoTrack(track);
    tick();
    return true;
  }

  // silent=true when the call itself is ending (videocall handles its own tracks)
  function stop(silent) {
    if (!on && !track) return;
    on = false; cancelAnimationFrame(raf);
    if (!silent && window.videocall) { const cam = videocall.cameraTrack(); if (cam) videocall.setVideoTrack(cam); }
    if (track) { track.stop(); track = null; }
    if (vid) { vid.srcObject = null; vid = null; }
  }

  window.callfx = { toggle, reset: () => stop(true), isOn: () => on };
})();
