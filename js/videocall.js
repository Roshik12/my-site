/* videocall.js — group-scoped 1:1 voice/video calls (WebRTC + Firebase Realtime DB signaling)
   Signaling path: groupcalls/{groupId}  { offer, answer, callType, from, callerCandidates, calleeCandidates } */
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

  const peerId = 'p_' + Math.random().toString(36).slice(2, 10);
  let pc = null, localStream = null, gid = null, role = null;
  let pendingCandidates = [], listeners = [], handlers = {};

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
        audio: { echoCancellation: true, noiseSuppression: true },
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') throw new Error('Allow microphone' + (video ? '/camera' : '') + ' access and try again');
      if (err.name === 'NotFoundError') throw new Error('No ' + (video ? 'camera or ' : '') + 'microphone found');
      throw err;
    }
  }

  function makePC() {
    pc = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const remote = new MediaStream();
    pc.ontrack = e => {
      (e.streams[0] ? e.streams[0].getTracks() : [e.track]).forEach(t => {
        if (!remote.getTracks().includes(t)) remote.addTrack(t);
      });
      handlers.onRemote && handlers.onRemote(remote);
    };
    pc.onicecandidate = e => {
      if (e.candidate) {
        const path = role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
        callRef().child(path).push(e.candidate.toJSON());
      }
    };
    pc.onconnectionstatechange = () => {
      handlers.onState && handlers.onState(pc.connectionState);
      if (pc.connectionState === 'failed') {
        handlers.onError && handlers.onError(new Error('Connection failed — a TURN server may be needed on this network'));
      }
    };
  }

  async function addCandidate(c) {
    if (!pc) return;
    if (!pc.remoteDescription) { pendingCandidates.push(c); return; }
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('ICE add failed', e); }
  }
  async function flushCandidates() {
    const list = pendingCandidates; pendingCandidates = [];
    for (const c of list) await addCandidate(c);
  }

  // Ends locally when the call node disappears (remote hung up)
  function watchHangup() {
    on(callRef(), 'value', snap => { if (!snap.exists()) cleanup(true); });
  }

  async function start(groupId, withVideo, h) {
    if (!db()) throw new Error('Database not ready');
    if (pc) throw new Error('Already in a call');
    gid = groupId; role = 'caller'; handlers = h || {};
    const existing = await callRef().once('value');
    const ex = existing.val();
    if (ex && ex.offer && !ex.answer && ex.from !== peerId) { gid = null; throw new Error('Someone is already calling — accept their call'); }
    try {
      if (ex) await callRef().remove(); // clear any stale call data
      localStream = await getMedia(withVideo);
      handlers.onLocal && handlers.onLocal(localStream);
      makePC();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await callRef().update({ // update (not set) so ICE candidates gathered meanwhile are kept
        offer: { type: offer.type, sdp: offer.sdp },
        callType: withVideo ? 'video' : 'audio',
        from: peerId,
        ts: firebase.database.ServerValue.TIMESTAMP
      });
      callRef().onDisconnect().remove();
      on(callRef().child('answer'), 'value', async snap => {
        const a = snap.val();
        if (a && pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(a));
          flushCandidates();
        }
      });
      on(callRef().child('calleeCandidates'), 'child_added', s => addCandidate(s.val()));
      watchHangup();
    } catch (err) { cleanup(false); throw err; }
  }

  async function answer(groupId, h) {
    if (!db()) throw new Error('Database not ready');
    if (pc) throw new Error('Already in a call');
    gid = groupId; role = 'callee'; handlers = h || {};
    try {
      const snap = await callRef().once('value');
      const data = snap.val();
      if (!data || !data.offer) throw new Error('The call has ended');
      localStream = await getMedia(data.callType === 'video');
      handlers.onLocal && handlers.onLocal(localStream);
      makePC();
      on(callRef().child('callerCandidates'), 'child_added', s => addCandidate(s.val()));
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      await flushCandidates();
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await callRef().child('answer').set({ type: ans.type, sdp: ans.sdp, from: peerId });
      watchHangup();
      return data.callType;
    } catch (err) { cleanup(false); throw err; }
  }

  // Watch for incoming calls in one or more rooms (group id, ip~..., code~...)
  const watchers = {};
  function watch(room, onIncoming) {
    unwatch(room);
    const ref = db().ref('groupcalls/' + room);
    const fn = snap => {
      const d = snap.val();
      if (d && d.offer && !d.answer && d.from !== peerId && !pc) onIncoming({ callType: d.callType || 'video' });
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

  function cleanup(remoteEnded) {
    offAll();
    if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    pendingCandidates = [];
    const h = handlers; handlers = {}; gid = null; role = null;
    h.onEnded && h.onEnded(!!remoteEnded);
  }

  function end() {
    if (gid && db()) { try { callRef().remove(); } catch (_) {} }
    cleanup(false);
  }

  function toggleAudio(on_) { localStream && localStream.getAudioTracks().forEach(t => t.enabled = on_); }
  function toggleVideo(on_) { localStream && localStream.getVideoTracks().forEach(t => t.enabled = on_); }

  window.videocall = { start, answer, watch, unwatch, end, toggleAudio, toggleVideo, inCall: () => !!pc };
})();
