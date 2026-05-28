/* videocall.js
   - WebRTC peer-to-peer video/audio calling
   - Firebase Realtime DB signaling
   - Screen sharing support
   - Call invitation system
*/
(function(){
  let pc = null;
  let localStream = null;
  let screenStream = null;
  let remoteStream = null;
  let currentCallId = null;
  let isScreenSharing = false;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  function getDB() {
    return window.db;
  }

  // Create peer connection
  function createPeerConnection(onTrack) {
    pc = new RTCPeerConnection(rtcConfig);
    
    pc.ontrack = (event) => {
      console.log('Remote track received:', event.track.kind);
      remoteStream = event.streams[0];
      if (onTrack) onTrack(remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const db = getDB();
        if (db && currentCallId) {
          const role = pc.signalingState === 'stable' ? 'caller' : 'callee';
          db.ref('calls/' + currentCallId + '/' + role + '_candidates').push(event.candidate.toJSON());
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
    };

    return pc;
  }

  // Start local video/audio stream
  async function startLocalStream(videoEl, audioOnly = false) {
    try {
      const constraints = {
        video: !audioOnly ? { width: { max: 1280 }, height: { max: 720 } } : false,
        audio: true
      };
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoEl && !audioOnly) {
        videoEl.srcObject = localStream;
      }
      return localStream;
    } catch (err) {
      console.error('getUserMedia error:', err);
      throw err;
    }
  }

  // Initiate a call (caller side)
  async function initiateCall(callId, remoteVideoEl, onRemoteStream) {
    currentCallId = callId;
    const db = getDB();
    if (!db) throw new Error('Database required for signaling');

    createPeerConnection(onRemoteStream);

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Create and send offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await pc.setLocalDescription(offer);

    // Store offer in database
    await db.ref('calls/' + callId).set({
      caller_offer: offer.toJSON(),
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    // Listen for answer
    const answerListener = db.ref('calls/' + callId + '/callee_offer').on('value', async snap => {
      const answer = snap.val();
      if (answer && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        db.ref('calls/' + callId + '/callee_offer').off('value', answerListener);
      }
    });

    // Listen for ICE candidates from callee
    db.ref('calls/' + callId + '/callee_candidates').on('child_added', snap => {
      const candidate = snap.val();
      if (candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
          console.error('Add ice candidate error:', err);
        });
      }
    });

    return pc;
  }

  // Answer a call (callee side)
  async function answerCall(callId, remoteVideoEl, onRemoteStream) {
    currentCallId = callId;
    const db = getDB();
    if (!db) throw new Error('Database required for signaling');

    // Get the offer
    const snap = await db.ref('calls/' + callId + '/caller_offer').once('value');
    const offerData = snap.val();
    if (!offerData) throw new Error('Offer not found');

    createPeerConnection(onRemoteStream);

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Set remote description and create answer
    await pc.setRemoteDescription(new RTCSessionDescription(offerData));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Send answer back
    await db.ref('calls/' + callId).update({
      callee_offer: answer.toJSON()
    });

    // Listen for ICE candidates from caller
    db.ref('calls/' + callId + '/caller_candidates').on('child_added', snap => {
      const candidate = snap.val();
      if (candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
          console.error('Add ice candidate error:', err);
        });
      }
    });

    return pc;
  }

  // Share screen
  async function startScreenShare(screenVideoEl) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      if (pc && localStream) {
        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(videoTrack);
          isScreenSharing = true;

          // Replace screen track with camera when screen share ends
          videoTrack.onended = async () => {
            const cameraTrack = localStream.getVideoTracks()[0];
            await sender.replaceTrack(cameraTrack);
            isScreenSharing = false;
          };

          if (screenVideoEl) {
            screenVideoEl.srcObject = screenStream;
          }
        }
      }

      return screenStream;
    } catch (err) {
      console.error('Screen share error:', err);
      throw err;
    }
  }

  // Stop screen share
  async function stopScreenShare() {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      if (pc && localStream) {
        const cameraTrack = localStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && cameraTrack) {
          await sender.replaceTrack(cameraTrack);
        }
      }
      screenStream = null;
      isScreenSharing = false;
    }
  }

  // Toggle audio
  function toggleAudio(enabled) {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // Toggle video
  function toggleVideo(enabled) {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // End call
  function endCall() {
    if (pc) {
      pc.close();
      pc = null;
    }
    if (currentCallId) {
      const db = getDB();
      if (db) {
        db.ref('calls/' + currentCallId).remove();
      }
      currentCallId = null;
    }
    remoteStream = null;
    stopScreenShare();
  }

  // Cleanup local stream
  function stopLocalStream() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
  }

  // Public API
  window.videocall = {
    startLocalStream,
    initiateCall,
    answerCall,
    startScreenShare,
    stopScreenShare,
    toggleAudio,
    toggleVideo,
    endCall,
    stopLocalStream,
    isScreenSharing: () => isScreenSharing,
    getCurrentStream: () => localStream,
    getRemoteStream: () => remoteStream
  };
})();
/**
 * WebRTC Video & Audio Calling
 * Peer-to-peer video/audio calls using Firebase signaling
 */

class VideoCall {
  constructor() {
    this.db = firebase.database();
    this.localStream = null;
    this.peerConnections = {};
    this.localPeerId = this.generatePeerId();
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
  }

  /**
   * Initialize local media (camera & microphone)
   */
  async initializeLocalMedia(videoElementId, audioOnly = false) {
    try {
      const constraints = {
        audio: true,
        video: audioOnly ? false : { width: 1280, height: 720 },
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      if (!audioOnly) {
        const videoElement = document.getElementById(videoElementId);
        videoElement.srcObject = this.localStream;
        videoElement.onloadedmetadata = () => videoElement.play();
      }

      console.log('Local media initialized');
      return this.localStream;
    } catch (error) {
      console.error('Failed to access media devices:', error);
      throw error;
    }
  }

  /**
   * Create peer connection
   */
  createPeerConnection(peerId, videoElementId) {
    const peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Add local stream tracks
    this.localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, this.localStream);
    });

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      console.log('Remote stream received');
      const videoElement = document.getElementById(videoElementId);
      videoElement.srcObject = event.streams[0];
      videoElement.onloadedmetadata = () => videoElement.play();
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage(peerId, {
          type: 'iceCandidate',
          candidate: event.candidate,
        });
      }
    };

    // Monitor connection state
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
        this.closePeerConnection(peerId);
      }
    };

    this.peerConnections[peerId] = peerConnection;
    return peerConnection;
  }

  /**
   * Initiate call (send offer)
   */
  async initiateCall(peerId, remoteVideoElementId) {
    try {
      const peerConnection = this.createPeerConnection(peerId, remoteVideoElementId);

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await peerConnection.setLocalDescription(offer);

      this.sendSignalingMessage(peerId, {
        type: 'offer',
        offer: offer,
      });

      console.log('Call offer sent to', peerId);
    } catch (error) {
      console.error('Failed to initiate call:', error);
      throw error;
    }
  }

  /**
   * Handle incoming offer
   */
  async handleOffer(peerId, offer, remoteVideoElementId) {
    try {
      const peerConnection = this.createPeerConnection(peerId, remoteVideoElementId);

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.sendSignalingMessage(peerId, {
        type: 'answer',
        answer: answer,
      });

      console.log('Call answer sent to', peerId);
    } catch (error) {
      console.error('Failed to handle offer:', error);
      throw error;
    }
  }

  /**
   * Handle incoming answer
   */
  async handleAnswer(peerId, answer) {
    try {
      const peerConnection = this.peerConnections[peerId];
      if (!peerConnection) throw new Error('Peer connection not found');

      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('Answer received from', peerId);
    } catch (error) {
      console.error('Failed to handle answer:', error);
      throw error;
    }
  }

  /**
   * Handle ICE candidate
   */
  async handleIceCandidate(peerId, candidate) {
    try {
      const peerConnection = this.peerConnections[peerId];
      if (!peerConnection) throw new Error('Peer connection not found');

      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
    }
  }

  /**
   * Send signaling message via Firebase
   */
  async sendSignalingMessage(peerId, message) {
    try {
      await this.db.ref(`calls/${this.localPeerId}/messages/${peerId}`).push({
        ...message,
        from: this.localPeerId,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to send signaling message:', error);
    }
  }

  /**
   * Listen for incoming calls
   */
  onIncomingCall(callback) {
    this.db.ref(`calls/${this.localPeerId}/messages`).on('child_added', (snapshot) => {
      const message = snapshot.val();
      if (message.type === 'offer') {
        callback({
          peerId: message.from,
          offer: message.offer,
        });
      }
    });
  }

  /**
   * Toggle audio
   */
  toggleAudio(enabled) {
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
  }

  /**
   * Toggle video
   */
  toggleVideo(enabled) {
    this.localStream.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
  }

  /**
   * End call
   */
  endCall(peerId) {
    this.closePeerConnection(peerId);
    this.sendSignalingMessage(peerId, {
      type: 'hangup',
    });
  }

  /**
   * Close peer connection
   */
  closePeerConnection(peerId) {
    const peerConnection = this.peerConnections[peerId];
    if (peerConnection) {
      peerConnection.close();
      delete this.peerConnections[peerId];
    }
  }

  /**
   * Stop all local media
   */
  stopLocalMedia() {
    this.localStream.getTracks().forEach(track => {
      track.stop();
    });
    this.localStream = null;
  }

  /**
   * Generate unique peer ID
   */
  generatePeerId() {
    return 'peer_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Share screen (bonus feature)
   */
  async shareScreen(screenElementId) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false,
      });

      const screenElement = document.getElementById(screenElementId);
      screenElement.srcObject = screenStream;
      screenElement.onloadedmetadata = () => screenElement.play();

      // Replace video track in all peer connections
      const screenTrack = screenStream.getVideoTracks()[0];
      for (const peerId in this.peerConnections) {
        const sender = this.peerConnections[peerId]
          .getSenders()
          .find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
        }
      }

      console.log('Screen shared');
      return screenStream;
    } catch (error) {
      console.error('Failed to share screen:', error);
      throw error;
    }
  }
}

const videoCall = new VideoCall();
