/* videocall.js — group voice/video calls for 2-6 people (mesh) (WebRTC + Firebase Realtime DB signaling)
   Signaling: groupcalls/{room}/{meta, members/{peer}, signals/{toPeer}/{push}} */
(function () {
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
      // For calls across different networks/mobile data, add your own TURN server here:
      // { urls: 'turn:YOUR_TURN_HOST:443', username: 'USER', credential: 'PASS' }
    ],
    iceCandidatePoolSize: 4
  };
  // Optional TURN server(s): set window.TURN_SERVERS = [{urls:'turn:host:443',username:'u',credential:'p'}] in js/supabase-config.js
  if (Array.isArray(window.TURN_SERVERS)) rtcConfig.iceServers.push(...window.TURN_SERVERS);

  // TURN servers come from /api/turn (a Vercel function that keeps the Metered key private). Cached for 20 min.
  let turnAt = 0, turnBusy = null;
  function loadTurn() {
    if (Date.now() - turnAt < 20 * 60000) return Promise.resolve();
    if (turnBusy) return turnBusy;
    const get = fetch('/api/turn', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !Array.isArray(j.iceServers)) return;
      const keep = rtcConfig.iceServers.filter(x => !x.__turn);
      rtcConfig.iceServers = keep.concat(j.iceServers.filter(x => x && x.urls).map(x => Object.assign({ __turn: true }, x)));
      turnAt = Date.now();
    }).catch(() => {});
    turnBusy = Promise.race([get, new Promise(r => setTimeout(r, 2500))]).then(() => { turnBusy = null; });
    return turnBusy;
  }

  const MAX = 6; // full mesh: every person connects to every other, so keep it small
  const peerId = 'p_' + Math.random().toString(36).slice(2, 10);
  let localStream = null, gid = null, joined = false, peers = {};
  let listeners = [], handlers = {};

  const db = () => window.db;
  const callRef = () => db().ref('groupcalls/' + gid);
  function on(ref, evt, fn) { ref.on(evt, fn); listeners.push([ref, evt, fn]); }
  function offAll() { listeners.forEach(([r, e, f]) => r.off(e, f)); listeners = []; }

  async function getMedia(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Calls need HTTPS and a supported browser');
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 },
        video: video ? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' } : false
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') throw new Error('Allow microphone' + (video ? '/camera' : '') + ' access and try again');
      if (err.name === 'NotFoundError') throw new Error('No ' + (video ? 'camera or ' : '') + 'microphone found');
      throw err;
    }
  }

  const signal = (to, msg) => callRef().child('signals/' + to).push(Object.assign({ from: peerId }, msg));

  function makePeer(id) {
    const pc = new RTCPeerConnection(rtcConfig), p = { pc, pending: [], remote: new MediaStream() };
    peers[id] = p;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    // Quality: ~3 Mbps video (drops fps before resolution), 64 kbps audio
    pc.getSenders().forEach(sn => {
      if (!sn.track || !sn.getParameters) return;
      const isVideo = sn.track.kind === 'video', pr = sn.getParameters();
      if (!pr.encodings || !pr.encodings.length) pr.encodings = [{}];
      pr.encodings[0].maxBitrate = isVideo ? 3000000 : 64000;
      if (isVideo) { pr.degradationPreference = 'maintain-resolution'; sn.track.contentHint = 'motion'; }
      sn.setParameters(pr).catch(() => {});
    });
    pc.ontrack = e => {
      (e.streams[0] ? e.streams[0].getTracks() : [e.track]).forEach(t => { if (!p.remote.getTracks().includes(t)) p.remote.addTrack(t); });
      handlers.onRemote && handlers.onRemote(id, p.remote);
    };
    pc.onicecandidate = e => { if (e.candidate) signal(id, { type: 'candidate', data: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      handlers.onState && handlers.onState(id, pc.connectionState);
      if (pc.connectionState === 'failed') handlers.onError && handlers.onError(new Error('Connection to one person failed. A TURN server may be needed on this network'));
    };
    return p;
  }

  async function flush(p) { const l = p.pending; p.pending = []; for (const c of l) { try { await p.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {} } }

  async function onSignal(snap) {
    const m = snap.val(); snap.ref.remove();
    if (!m || !m.from || !localStream) return;
    try {
      if (m.type === 'offer') {
        const p = peers[m.from] || makePeer(m.from);
        await p.pc.setRemoteDescription(new RTCSessionDescription(m.data)); await flush(p);
        const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a);
        signal(m.from, { type: 'answer', data: { type: a.type, sdp: a.sdp } });
      } else if (m.type === 'answer') {
        const p = peers[m.from];
        if (p && p.pc.signalingState === 'have-local-offer') { await p.pc.setRemoteDescription(new RTCSessionDescription(m.data)); await flush(p); }
      } else if (m.type === 'candidate') {
        const p = peers[m.from]; if (!p) return;
        if (p.pc.remoteDescription) { try { await p.pc.addIceCandidate(new RTCIceCandidate(m.data)); } catch (_) {} } else p.pending.push(m.data);
      }
    } catch (e) { console.warn('signal', e); }
  }

  async function connectTo(id) {
    const p = makePeer(id), o = await p.pc.createOffer();
    await p.pc.setLocalDescription(o);
    signal(id, { type: 'offer', data: { type: o.type, sdp: o.sdp } });
  }

  function dropPeer(id) {
    const p = peers[id]; if (!p) return;
    p.pc.onconnectionstatechange = null; p.pc.close(); delete peers[id];
    handlers.onPeerLeft && handlers.onPeerLeft(id);
  }

  async function enter(room, withVideo, h, create) {
    gid = room; handlers = h || {};
    try {
      await loadTurn();
      localStream = await getMedia(withVideo);
      handlers.onLocal && handlers.onLocal(localStream);
      on(callRef().child('signals/' + peerId), 'child_added', onSignal);
      const me = callRef().child('members/' + peerId);
      if (create) await callRef().update({ meta: { callType: withVideo ? 'video' : 'audio', from: peerId, ts: firebase.database.ServerValue.TIMESTAMP }, ['members/' + peerId]: true });
      else await me.set(true);
      me.onDisconnect().remove(); callRef().child('signals/' + peerId).onDisconnect().remove();
      joined = true;
      // exactly one side of each pair sends the offer: the one with the larger id
      on(callRef().child('members'), 'child_added', s => { if (s.key !== peerId && peerId > s.key && !peers[s.key]) connectTo(s.key); });
      on(callRef().child('members'), 'child_removed', s => dropPeer(s.key));
      on(callRef().child('members'), 'value', s => handlers.onCount && handlers.onCount(s.numChildren()));
    } catch (err) { cleanup(); throw err; }
  }

  async function start(room, withVideo, h) {
    if (!db()) throw new Error('Database not ready');
    if (joined) throw new Error('Already in a call');
    const d = (await db().ref('groupcalls/' + room).once('value')).val();
    if (d && d.members && d.meta) { return answer(room, h); } // a call is already running: join it
    if (d) await db().ref('groupcalls/' + room).remove(); // clear stale data
    await enter(room, withVideo, h, true);
    return withVideo ? 'video' : 'audio';
  }

  async function answer(room, h) {
    if (!db()) throw new Error('Database not ready');
    if (joined) throw new Error('Already in a call');
    const d = (await db().ref('groupcalls/' + room).once('value')).val();
    if (!d || !d.meta || !d.members) throw new Error('The call has ended');
    if (Object.keys(d.members).length >= MAX) throw new Error('This call is full (' + MAX + ' people max)');
    await enter(room, d.meta.callType === 'video', h, false);
    return d.meta.callType;
  }

  // Watch for calls in one or more rooms (group id, ip~..., code~...); rings while a call is live and you are not in it
  const watchers = {};
  function watch(room, onIncoming) {
    unwatch(room);
    const ref = db().ref('groupcalls/' + room);
    const fn = snap => {
      const d = snap.val();
      if (d && d.meta && d.members && !d.members[peerId] && !joined) onIncoming({ callType: d.meta.callType || 'video', ts: d.meta.ts || 0, count: Object.keys(d.members).length });
      else onIncoming(null);
    };
    ref.on('value', fn);
    watchers[room] = [ref, fn];
  }
  function unwatch(room) {
    if (room === undefined) { Object.keys(watchers).forEach(unwatch); return; }
    const w = watchers[room];
    if (w) { w[0].off('value', w[1]); delete watchers[room]; }
  }

  function cleanup() {
    offAll();
    Object.keys(peers).forEach(id => { peers[id].pc.onconnectionstatechange = null; peers[id].pc.close(); }); peers = {};
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    joined = false;
    const h = handlers; handlers = {}; gid = null;
    h.onEnded && h.onEnded(false);
  }

  async function end() {
    const room = gid;
    cleanup();
    if (!room || !db()) return;
    try {
      const r = db().ref('groupcalls/' + room);
      await r.child('members/' + peerId).remove(); await r.child('signals/' + peerId).remove();
      const left = await r.child('members').once('value');
      if (!left.exists()) await r.remove(); // last person out closes the room
    } catch (_) {}
  }

  const toggleAudio = v => localStream && localStream.getAudioTracks().forEach(t => t.enabled = v);
  const toggleVideo = v => localStream && localStream.getVideoTracks().forEach(t => t.enabled = v);

  window.videocall = { start, answer, watch, unwatch, end, toggleAudio, toggleVideo, inCall: () => joined, max: MAX };
})();
