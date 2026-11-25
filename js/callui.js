/* callui.js — shared full-screen call UI for every page.
   callUI.start(room, {audioOnly, title, status})  place a call in a room
   callUI.join(room, {title})                       answer a call in a room
   callUI.watch(room, title) / unwatch(room)        ring on incoming calls
   Rooms: a group id, 'ip~<ip>' (everyone on your network) or 'code~<CODE>' */
(function () {
  const $ = id => document.getElementById(id);
  const I = n => window.icon(n);
  const toast = m => (window.toast || window.showToast || console.log)(m);
  let room = null, title = '', audioOnly = false, audioOn = true, videoOn = true, incomingRoom = null;
  const titles = {}, dismissed = {}, lastTs = {};

  function build() {
    if ($('cuOverlay')) return;
    const d = document.createElement('div');
    d.className = 'cm'; d.id = 'cuOverlay'; d.hidden = true;
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'cuTitle');
    d.innerHTML = `<div class="cm-stage">
        <div class="cm-grid" id="cuGrid"></div>
        <video id="cuLocal" class="cm-self" autoplay muted playsinline></video>
        <div class="cm-info"><div class="cm-avatar">${I('message-circle')}</div><h2 id="cuTitle">Call</h2><p id="cuStatus" role="status" aria-live="polite">Ready</p></div>
      </div>
      <div class="cm-bar">
        <button class="cm-btn cm-ok" id="cuAccept" aria-label="Accept call" hidden>${I('phone')}</button>
        <button class="cm-btn" id="cuMute" aria-label="Mute microphone" aria-pressed="false">${I('mic')}</button>
        <button class="cm-btn" id="cuCam" aria-label="Turn camera off" aria-pressed="false">${I('video')}</button>
        <button class="cm-btn cm-end" id="cuEnd" aria-label="End or decline call">${I('phone-off')}</button>
      </div>`;
    document.body.appendChild(d);
    $('cuAccept').onclick = accept;
    $('cuEnd').onclick = hangup;
    $('cuMute').onclick = () => { audioOn = !audioOn; videocall.toggleAudio(audioOn); $('cuMute').innerHTML = I(audioOn ? 'mic' : 'mic-off'); $('cuMute').classList.toggle('off', !audioOn); $('cuMute').setAttribute('aria-pressed', String(!audioOn)); $('cuMute').setAttribute('aria-label', audioOn ? 'Mute microphone' : 'Unmute microphone'); };
    $('cuCam').onclick = () => { videoOn = !videoOn; videocall.toggleVideo(videoOn); $('cuCam').innerHTML = I(videoOn ? 'video' : 'video-off'); $('cuCam').classList.toggle('off', !videoOn); $('cuCam').setAttribute('aria-pressed', String(!videoOn)); $('cuCam').setAttribute('aria-label', videoOn ? 'Turn camera off' : 'Turn camera on'); };
    addEventListener('beforeunload', () => { if (videocall.inCall()) videocall.end(); });
  }

  function ui(state, ao) {
    build();
    if (state !== 'idle' && !window.__cuReturnFocus && document.activeElement && document.activeElement !== document.body) window.__cuReturnFocus = document.activeElement;
    const ov = $('cuOverlay');
    ov.hidden = state === 'idle';
    if (state !== 'idle') setTimeout(() => { const f = state === 'incoming' ? $('cuAccept') : $('cuEnd'); f && f.focus(); }, 0);
    ov.classList.toggle('audio', !!ao);
    ov.classList.toggle('live', state === 'live');
    ov.classList.toggle('incoming', state === 'incoming');
    $('cuAccept').hidden = state !== 'incoming';
    $('cuMute').hidden = state === 'incoming';
    $('cuCam').hidden = state === 'incoming' || !!ao;
    audioOn = videoOn = true;
    $('cuMute').innerHTML = I('mic'); $('cuCam').innerHTML = I('video');
    $('cuMute').classList.remove('off'); $('cuCam').classList.remove('off');
    if (state === 'idle') {
      if (window.__cuReturnFocus) { try { window.__cuReturnFocus.focus(); } catch (_) {} window.__cuReturnFocus = null; } $('cuLocal').srcObject = null; $('cuGrid').innerHTML = ''; incomingRoom = null; }
  }

  const handlers = () => ({
    onLocal: st => { $('cuLocal').srcObject = st; },
    onRemote: (id, st) => {
      const g = $('cuGrid'); let v = g.querySelector('[data-peer="' + id + '"]');
      if (!v) { v = document.createElement('video'); v.dataset.peer = id; v.autoplay = true; v.playsInline = true; g.appendChild(v); }
      v.srcObject = st; v.play().catch(() => {});
    },
    onPeerLeft: id => { const v = $('cuGrid').querySelector('[data-peer="' + id + '"]'); if (v) v.remove(); },
    onCount: n => { $('cuStatus').textContent = n > 1 ? n + ' people in this call' : 'Waiting for others to join…'; },
    onState: (id, st) => {
      if (st === 'connected') $('cuOverlay').classList.add('live');
    },
    onError: e => toast(e.message),
    onEnded: () => ui('idle')
  });

  async function start(r, o) {
    o = o || {}; build();
    room = r; title = o.title || 'Call'; audioOnly = !!o.audioOnly;
    $('cuTitle').textContent = title;
    $('cuStatus').textContent = o.status || 'Calling… waiting for someone to join';
    ui('ringing', audioOnly);
    try { const t = await videocall.start(r, !audioOnly, handlers()); if ((t === 'video') === audioOnly) { audioOnly = t !== 'video'; ui('ringing', audioOnly); } }
    catch (err) { ui('idle'); toast(err.message); }
  }

  async function join(r, o) {
    o = o || {}; build();
    room = r; title = o.title || 'Call';
    $('cuTitle').textContent = title; $('cuStatus').textContent = 'Connecting…';
    ui('ringing', false);
    try {
      const type = await videocall.answer(r, handlers());
      audioOnly = type !== 'video'; ui('ringing', audioOnly);
    } catch (err) { ui('idle'); toast((err.message === 'The call has ended' ? 'No active call found for that code' : err.message)); }
  }

  async function accept() { await join(incomingRoom, { title: titles[incomingRoom] }); }

  function hangup() {
    if (videocall.inCall()) videocall.end();
    else { if (incomingRoom) dismissed[incomingRoom] = lastTs[incomingRoom]; ui('idle'); }
  }

  function watch(r, t) {
    build(); titles[r] = t || r;
    videocall.watch(r, info => {
      if (videocall.inCall()) return;
      if (info) lastTs[r] = info.ts;
      if (info && dismissed[r] === info.ts) info = null;
      if (info) {
        incomingRoom = r; audioOnly = info.callType !== 'video';
        $('cuTitle').textContent = titles[r];
        $('cuStatus').textContent = 'Incoming ' + (audioOnly ? 'voice' : 'video') + ' call' + (info.count > 1 ? ' · ' + info.count + ' people' : '');
        ui('incoming', audioOnly);
      } else if (incomingRoom === r && !$('cuOverlay').hidden) ui('idle');
    });
  }

  window.callUI = { start, join, watch, unwatch: r => videocall.unwatch(r) };
})();
