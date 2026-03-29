// Admin auth module
// Handles Supabase authentication for admin pages

const AdminAuth = (() => {
  let supabaseClient = null;
  let authRequired = false;
  let currentToken = null;

  async function init() {
    try {
      const res = await fetch('/api/auth/config');
      const config = await res.json();

      authRequired = config.required;

      if (!authRequired) {
        // No auth needed — show admin directly
        showAdmin();
        socketAuth();
        return;
      }

      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        console.error('Auth required but Supabase config missing');
        showAdmin();
        return;
      }

      supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

      // Check existing session
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) {
        currentToken = session.access_token;
        showAdmin();
        socketAuth();
        return;
      }

      // Listen for auth state changes (token refresh)
      supabaseClient.auth.onAuthStateChange((_event, session) => {
        if (session) {
          currentToken = session.access_token;
        } else {
          currentToken = null;
        }
      });

      // Show login screen
      showLogin();
    } catch (e) {
      console.error('Auth init error:', e);
      showAdmin();
    }
  }

  function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-screen').classList.add('active');
    document.getElementById('create-screen').classList.remove('active');
  }

  function showAdmin() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('create-screen').classList.add('active');
  }

  function socketAuth() {
    if (typeof socket !== 'undefined' && currentToken) {
      socket.emit('admin:auth', { token: currentToken });
    } else if (typeof socket !== 'undefined') {
      // No auth required, just signal
      socket.emit('admin:auth', { token: '' });
    }
  }

  async function login(email, password) {
    if (!supabaseClient) return { error: 'Auth non configuree' };

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { error: error.message };

    currentToken = data.session.access_token;
    showAdmin();
    socketAuth();
    return { ok: true };
  }

  async function logout() {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    currentToken = null;
    showLogin();
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
    return fetch(url, { ...options, headers });
  }

  return { init, login, logout, getToken, isRequired, authFetch };
})();

// Setup login form
document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('login-btn');
  const loginEmail = document.getElementById('login-email');
  const loginPassword = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');

  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const email = loginEmail.value.trim();
      const password = loginPassword.value;

      if (!email || !password) {
        loginError.textContent = 'Email et mot de passe requis';
        return;
      }

      loginBtn.disabled = true;
      loginError.textContent = '';

      const result = await AdminAuth.login(email, password);

      if (result.error) {
        loginError.textContent = result.error;
        loginBtn.disabled = false;
      }
    });

    loginPassword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginBtn.click();
    });

    loginEmail.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginPassword.focus();
    });
  }

  AdminAuth.init();
});
