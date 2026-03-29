// Admin auth module
// Handles Supabase authentication for admin pages

const AdminAuth = (() => {
  const BACKEND_URL = window.BACKEND_URL || '';
  let supabaseClient = null;
  let authRequired = false;
  let currentToken = null;

  async function init() {
    try {
      const res = await fetch(BACKEND_URL + '/api/auth/config');
      const config = await res.json();

      authRequired = config.required;

      if (!authRequired) {
        showAdmin();
        socketAuth();
        return;
      }

      // Extract token from URL (set by login page redirect)
      const urlToken = new URLSearchParams(window.location.search).get('token');
      if (urlToken) {
        currentToken = urlToken;
        // Clean URL without reload
        window.history.replaceState({}, '', window.location.pathname);
      }

      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        console.error('Auth required but Supabase config missing');
        showAdmin();
        return;
      }

      supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

      // Check existing session or URL token
      if (!currentToken) {
        const {
          data: { session },
        } = await supabaseClient.auth.getSession();
        if (session) {
          currentToken = session.access_token;
        }
      }

      if (currentToken) {
        showAdmin();
        socketAuth();

        // Listen for token refresh
        supabaseClient.auth.onAuthStateChange((_event, session) => {
          if (session) currentToken = session.access_token;
        });
        return;
      }

      // No token — redirect to login
      window.location.href = '/admin/login';
    } catch (e) {
      console.error('Auth init error:', e);
      showAdmin();
    }
  }

  function showAdmin() {
    const createScreen = document.getElementById('create-screen');
    if (createScreen) createScreen.classList.add('active');
  }

  function socketAuth() {
    if (typeof socket !== 'undefined' && currentToken) {
      socket.emit('admin:auth', { token: currentToken });
    } else if (typeof socket !== 'undefined') {
      socket.emit('admin:auth', { token: '' });
    }
  }

  async function logout() {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    currentToken = null;
    window.location.href = '/admin/login';
  }

  function getToken() {
    return currentToken;
  }

  function isRequired() {
    return authRequired;
  }

  // Fetch wrapper that adds auth header
  async function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }
    const fullUrl = url.startsWith('http') ? url : BACKEND_URL + url;
    return fetch(fullUrl, { ...options, headers });
  }

  return { init, logout, getToken, isRequired, authFetch };
})();

document.addEventListener('DOMContentLoaded', () => {
  AdminAuth.init();
});
