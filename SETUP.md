# QuickShare Setup & Testing

## Current Status ✅

All features are working **without requiring Google OAuth login**. Chat, files, and calls all work independently.

### Firebase Database Connected
- ✅ Real-time chat via Firebase Realtime DB
- ✅ File storage via Firebase Storage
- ✅ Group management stored in Firebase

### Google OAuth (Optional)
- ⚠️ Currently disabled (placeholder client ID)
- To enable: Replace `YOUR_GOOGLE_CLIENT_ID` in `index.html` line 1383 with your actual Google OAuth client ID

---

## How to Test

### 1. **Open the App**
```
Open index.html in your browser
```

### 2. **Create/Join a Chat Group**
- Scroll to the right panel (Chat)
- Enter a Group ID (e.g., `testgroup`)
- Leave password empty (or set one)
- Click "Join Group"

### 3. **Test Chat**
- Type a message and press Enter or click Send
- Messages appear with your IP as author
- Timestamps auto-format (HH:MM)
- Old messages (>7 days) auto-delete

### 4. **Upload Files**
- Drag files into the left section or click the upload zone
- Files appear in a gallery grid
- Auto-delete after 7 days

### 5. **Video Calls** (Bottom section)
- Click the ☎️ button to start
- Allow camera/mic access
- Share your call ID with someone else to connect

---

## Troubleshooting

### "Chat won't send messages"
- Check browser console (F12 → Console tab)
- Should see: `✓ Firebase initialized`
- Try creating a test group first: `groups.createGroup('test', '')`

### "Firebase database error"
- Network issue or invalid credentials
- Check Firebase config in index.html (lines 1029-1038)
- Contact Firebase support or reset project

### "Google login not showing"
- This is expected without a valid Google client ID
- Chat and all other features work without login

---

## To Enable Google OAuth

1. Get a Google OAuth client ID from [Google Cloud Console](https://console.cloud.google.com/)
2. Open `index.html`
3. Find line ~1383: `const clientId = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';`
4. Replace with your actual client ID
5. Refresh the page - login button will appear

---

## File Structure
```
/Users/roshik/try web/qwick chat/1/
├── index.html              (Main app)
├── logo.svg                (Brand logo)
├── .env.example            (Environment template)
├── js/
│   ├── auth.js             (Google OAuth + session)
│   ├── fileStorage.js      (File upload + IndexedDB)
│   ├── groups.js           (Chat groups + messaging)
│   └── videocall.js        (WebRTC calls + screen share)
└── SETUP.md                (This file)
```

---

## API Quick Reference

### Chat
```javascript
// Create a group
await groups.createGroup('groupid', 'password');

// Join a group
await groups.joinGroup('groupid', 'password');

// Send message
groups.sendMessage('Hello!');

// Listen to messages
groups.listenToMessages((msg) => console.log(msg));
```

### Files
```javascript
// Upload file
fileStorage.uploadFile(file, (progress) => {});

// List files
const files = await fileStorage.listMeta();

// Render gallery
fileStorage.renderFilesGrid();
```

### Calls
```javascript
// Start camera
videocall.startLocalStream(videoElement);

// Make call
videocall.initiateCall(callId, videoEl, onRemoteStream);

// Answer call
videocall.answerCall(callId, videoEl, onRemoteStream);

// End call
videocall.endCall();
```

---

**Last updated:** May 26, 2026
