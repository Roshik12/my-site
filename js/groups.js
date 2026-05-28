/* groups.js
   - Group creation with ID + password
   - Real-time messaging with Firebase Realtime DB
   - 7-day message retention
   - Group member management
*/
(function(){
  let currentGroupId = null;
  let currentGroupPassword = null;
  let messageListener = null;
  let groupListener = null;

  // Get Firebase database reference
  function getDB() {
    if (window.db && typeof window.db.ref === 'function') {
      console.log('[groups.js] Using window.db');
      return window.db;
    }
    console.error('[groups.js] Database not initialized');
    return null;
  }

  // Create a new group with ID and password
  async function createGroup(groupId, password) {
    console.log('[groups.js] createGroup called with:', groupId);
    const db = getDB();
    if (!db) {
      console.error('[groups.js] Database not initialized');
      throw new Error('Database not initialized');
    }
    
    const groupData = {
      id: groupId,
      password: password || '',
      created: new Date().toISOString(),
      createdBy: window.auth?.getCurrentUser?.()?.email || 'anonymous',
      members: [],
      messageCount: 0
    };

    try {
      console.log('[groups.js] Creating group at:', 'groups/' + groupId);
      await db.ref('groups/' + groupId).set(groupData);
      console.log('[groups.js] Successfully created group:', groupId);
      return groupData;
    } catch (err) {
      console.error('[groups.js] Create group error:', err);
      throw err;
    }
  }

  // Join a group (verify password if set)
  async function joinGroup(groupId, password) {
    console.log('[groups.js] joinGroup called with:', groupId);
    const db = getDB();
    if (!db) {
      console.error('[groups.js] Database not initialized');
      throw new Error('Database not initialized');
    }

    try {
      console.log('[groups.js] Attempting to read group:', 'groups/' + groupId);
      const snap = await db.ref('groups/' + groupId).once('value');
      const groupData = snap.val();
      console.log('[groups.js] Group data retrieved:', groupData);
      
      if (!groupData) throw new Error('Group not found');
      if (groupData.password && groupData.password !== password) {
        throw new Error('Invalid password');
      }
      currentGroupId = groupId;
      currentGroupPassword = password;
      console.log('[groups.js] Successfully joined group:', groupId);
      return groupData;
    } catch (err) {
      console.error('[groups.js] Join group error:', err);
      throw err;
    }
  }

  // Send a message to current group
  function sendMessage(text) {
    const db = getDB();
    if (!db || !currentGroupId) return;

    const user = window.auth?.getCurrentUser?.() || null;
    const msg = {
      author: user?.email || 'Anonymous',
      authorName: user?.name || 'Anonymous User',
      text: text.trim(),
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      serverTimestamp: new Date().toISOString()
    };

    try {
      db.ref('groups/' + currentGroupId + '/messages').push(msg);
    } catch (err) {
      console.error('[groups.js] Send message error:', err);
    }
  }

  // Listen to messages and clean up old ones (> 7 days)
  function listenToMessages(callback) {
    const db = getDB();
    if (!db || !currentGroupId) return;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let processedKeys = new Set();

    messageListener = db.ref('groups/' + currentGroupId + '/messages').on('child_added', snap => {
      const msg = snap.val();
      const key = snap.key;

      if (!msg || processedKeys.has(key)) return;
      processedKeys.add(key);

      // Auto-cleanup messages older than 7 days
      const msgTime = msg.timestamp || (new Date(msg.serverTimestamp).getTime());
      if (msgTime < sevenDaysAgo) {
        db.ref('groups/' + currentGroupId + '/messages/' + key).remove();
        return;
      }

      callback({ ...msg, key });
    });
  }

  // Stop listening
  function stopListening() {
    const db = getDB();
    if (!db || !currentGroupId) return;
    if (messageListener) {
      db.ref('groups/' + currentGroupId + '/messages').off('child_added', messageListener);
      messageListener = null;
    }
  }

  // Get list of groups (optional)
  async function listGroups() {
    const db = getDB();
    if (!db) return [];

    try {
      const snap = await db.ref('groups').once('value');
      const groups = snap.val() || {};
      return Object.entries(groups).map(([id, data]) => ({ id, ...data }));
    } catch (err) {
      console.error('[groups.js] List groups error:', err);
      return [];
    }
  }

  // Get current group info
  function getCurrentGroup() {
    return currentGroupId;
  }

  // Public API
  window.groups = {
    createGroup,
    joinGroup,
    sendMessage,
    listenToMessages,
    stopListening,
    listGroups,
    getCurrentGroup
  };
})();
