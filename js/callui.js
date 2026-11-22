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
  const titles = {};

  function build() {
    if ($('cuOverlay')) return;
    const d = document.createElement('div');
    d.className = 'cm'; d.id = 'cuOverlay'; d.hidden = true;
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'cuTitle');
    d.innerHTML = `<div class="cm-stage">
        <video id="cuRemote" autoplay playsinline></video>
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
      if (window.__cuReturnFocus) { try { window.__cuReturnFocus.focus(); } catch (_) {} window.__cuReturnFocus = null; } $('cuLocal').srcObject = null; $('cuRemote').srcObject = null; incomingRoom = null; }
  }

  const handlers = () => ({
    onLocal: st => { $('cuLocal').srcObject = st; },
    onRemote: st => { const v = $('cuRemote'); v.srcObject = st; v.play().catch(() => {}); },
    onState: st => {
      if (st === 'connected') { $('cuStatus').textContent = 'Connected'; $('cuOverlay').classList.add('live'); }
      else if (st === 'connecting') $('cuStatus').textContent = 'Connecting…';
      else if (st === 'disconnected') $('cuStatus').textContent = 'Connection unstable…';
    },
    onError: e => toast(e.message),
    onEnded: remote => { ui('idle'); if (remote) toast('Call ended'); }
  });

  async function start(r, o) {
    o = o || {}; build();
    room = r; title = o.title || 'Call'; audioOnly = !!o.audioOnly;
    $('cuTitle').textContent = title;
    $('cuStatus').textContent = o.status || 'Calling… waiting for someone to join';
    ui('ringing', audioOnly);
    try { await videocall.start(r, !audioOnly, handlers()); }
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
    else { if (incomingRoom) window.db.ref('groupcalls/' + incomingRoom).remove(); ui('idle'); }
  }

  function watch(r, t) {
    build(); titles[r] = t || r;
    videocall.watch(r, info => {
      if (videocall.inCall()) return;
      if (info) {
        incomingRoom = r; audioOnly = info.callType !== 'video';
        $('cuTitle').textContent = titles[r];
        $('cuStatus').textContent = 'Incoming ' + (audioOnly ? 'voice' : 'video') + ' call';
        ui('incoming', audioOnly);
      } else if (incomingRoom === r && !$('cuOverlay').hidden) ui('idle');
    });
  }

  window.callUI = { start, join, watch, unwatch: r => videocall.unwatch(r) };
})();
