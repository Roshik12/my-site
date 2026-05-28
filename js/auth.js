/* auth.js
   - Google OAuth 2.0 integration
   - Cookie-based session persistence
   - User profile management
*/
(function () {
  const COOKIE_NAME = 'qs_user_session';
  const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

  let currentUser = null;

  // ===== COOKIE HELPERS =====
  function setCookie(name, value, maxAge = COOKIE_MAX_AGE) {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; samesite=lax`;
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp(`${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function deleteCookie(name) {
    setCookie(name, '', 0);
  }

  // ===== USER SESSION =====
  function saveUserSession(user) {
    const data = JSON.stringify({
      uid: user.uid || user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      ts: Date.now()
    });
    setCookie(COOKIE_NAME, data);
    currentUser = user;
  }

  function loadUserSession() {
    const data = getCookie(COOKIE_NAME);
    if (!data) return null;
    try {
      const user = JSON.parse(data);
      const age = Date.now() - user.ts;
      if (age > COOKIE_MAX_AGE * 1000) {
        deleteCookie(COOKIE_NAME);
        return null;
      }
      currentUser = user;
      return user;
    } catch {
      deleteCookie(COOKIE_NAME);
      return null;
    }
  }

  function clearUserSession() {
    deleteCookie(COOKIE_NAME);
    currentUser = null;
  }

  // ===== GOOGLE SIGN-IN CALLBACK =====
  window.handleCredentialResponse = function (response) {
    // Decode JWT (note: in production, verify token server-side)
    const base64Url = response.credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);

    const user = {
      uid: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };

    saveUserSession(user);
    updateUIAfterLogin(user);
    if (window.onUserSignedIn) window.onUserSignedIn(user);
  };

  // ===== UI UPDATES =====
  function updateUIAfterLogin(user) {
    const btn = document.getElementById('googleSignInButton');
    const avatar = document.getElementById('userAvatar');
    const navRight = document.querySelector('.nav-right');

    if (btn) btn.style.display = 'none';
    if (avatar) {
      avatar.style.display = 'flex';
      avatar.title = user.email;
      avatar.innerHTML = user.picture
        ? `<img src="${user.picture}" alt="${user.name}" style="width:100%; height:100%; border-radius:50%;">`
        : user.name.charAt(0).toUpperCase();
    }

    // Render sign-out button
    if (navRight && !navRight.querySelector('#signOutBtn')) {
      const signOutBtn = document.createElement('button');
      signOutBtn.id = 'signOutBtn';
      signOutBtn.className = 'btn';
      signOutBtn.textContent = '🚪 Sign out';
      signOutBtn.style.marginLeft = '12px';
      signOutBtn.addEventListener('click', signOut);
      navRight.appendChild(signOutBtn);
    }
  }

  function updateUIAfterLogout() {
    const btn = document.getElementById('googleSignInButton');
    const avatar = document.getElementById('userAvatar');
    const signOutBtn = document.getElementById('signOutBtn');

    if (btn) btn.style.display = 'block';
    if (avatar) avatar.style.display = 'none';
    if (signOutBtn) signOutBtn.remove();
  }

  // ===== SIGN OUT =====
  function signOut() {
    clearUserSession();
    updateUIAfterLogout();
    if (window.google) {
      window.google.accounts.id.disableAutoSelect();
    }
    if (window.onUserSignedOut) window.onUserSignedOut();
  }

  // ===== INIT GOOGLE SIGN-IN BUTTON =====
  function initGoogleSignIn(clientId) {
    if (!window.google || !clientId) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: window.handleCredentialResponse,
      auto_select: false,
      itp_support: true
    });

    const btn = document.getElementById('googleSignInButton');
    if (btn) {
      window.google.accounts.id.renderButton(btn, {
        theme: 'dark',
        size: 'medium',
        type: 'standard'
      });
    }
  }

  // ===== PUBLIC API =====
  window.auth = {
    initGoogleSignIn,
    getCurrentUser: () => currentUser,
    loadSession: loadUserSession,
    signOut,
    saveUserSession,
    clearUserSession
  };

  // ===== AUTO-LOAD SESSION ON PAGE LOAD =====
  window.addEventListener('load', () => {
    const user = loadUserSession();
    if (user) {
      updateUIAfterLogin(user);
    }
  });
})();
