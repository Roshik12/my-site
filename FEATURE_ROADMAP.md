# Quick-Share Feature Expansion Plan

## Phase 1: Logo & File Upload System
- [ ] Replace logo with custom SVG/PNG
- [ ] File upload UI in editor
- [ ] Local file storage (IndexedDB + Firebase Storage)
- [ ] 7-day expiry for files per IP
- [ ] File preview gallery

## Phase 2: Authentication
- [ ] Google OAuth 2.0 integration
- [ ] Cookie-based session persistence
- [ ] User profile management
- [ ] Login state UI updates

## Phase 3: Private Groups/Chat
- [ ] Group creation with ID & password
- [ ] Real-time messaging (Firebase Firestore)
- [ ] Group member management
- [ ] Message history (7-day retention)

## Phase 4: Voice & Video Calling
- [ ] WebRTC integration
- [ ] Peer-to-peer video/audio
- [ ] Call invitation system
- [ ] Screen sharing (optional)

## Technology Stack
- Frontend: HTML5, Vanilla JS
- Backend: Firebase (Realtime DB, Firestore, Storage, Authentication)
- VoIP: WebRTC + Firebase Signaling
- Auth: Google OAuth 2.0

## Files to Create/Modify
1. `logo.svg` - New branding
2. `auth.js` - Google OAuth logic
3. `fileStorage.js` - File upload/download/expiry
4. `groups.js` - Chat/group management
5. `videocall.js` - WebRTC setup
6. `index.html` - Updated UI with all features
7. `.env.example` - Environment variables template
