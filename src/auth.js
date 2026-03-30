import { createClient } from '@supabase/supabase-js';

const BACKEND_URL = import.meta.env.PROD
  ? 'https://alihoot.onrender.com'
  : '';

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

    const urlToken = new URLSearchParams(window.location.search).get('token');
    if (urlToken) {
      currentToken = urlToken;
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.error('Auth required but Supabase config missing');
      showAdmin();
      return;
    }

    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);

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

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        if (session) currentToken = session.access_token;
      });
      return;
    }

    window.location.href = '/admin/login';
  } catch (e) {
    console.error('Auth init error:', e);
    showAdmin();
  }
}

let _socketAuthResolve = null;
let _socketAuthPromise = null;

function showAdmin() {
  const createScreen = document.getElementById('create-screen');
  if (createScreen) createScreen.classList.add('active');
}

function socketAuth() {
  _socketAuthPromise = new Promise((resolve) => {
    _socketAuthResolve = resolve;
  });

  const s = window._socket;
  if (!s) return;

  if (!authRequired) {
    // No auth needed, resolve immediately
    if (_socketAuthResolve) _socketAuthResolve();
    s.emit('admin:auth', { token: '' });
    return;
  }

  if (currentToken) {
    s.emit('admin:auth', { token: currentToken });
  } else {
    s.emit('admin:auth', { token: '' });
  }

  // Listen for auth result (one-time)
  s.once('admin:auth-ok', () => {
    if (_socketAuthResolve) _socketAuthResolve();
  });
  s.once('admin:auth-error', () => {
    // Auth failed but don't block forever - resolve anyway
    // The server will reject actions with "Authentification requise"
    if (_socketAuthResolve) _socketAuthResolve();
  });

  // Timeout fallback: don't block forever if server never responds
  setTimeout(() => {
    if (_socketAuthResolve) _socketAuthResolve();
  }, 5000);
}

function waitForAuth() {
  return _socketAuthPromise || Promise.resolve();
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

async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }
  const fullUrl = url.startsWith('http') ? url : BACKEND_URL + url;
  return fetch(fullUrl, { ...options, headers });
}

export const AdminAuth = { init, logout, getToken, isRequired, authFetch, socketAuth, waitForAuth };
