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

function showAdmin() {
  const createScreen = document.getElementById('create-screen');
  if (createScreen) createScreen.classList.add('active');
}

function socketAuth() {
  if (typeof window._socket !== 'undefined' && currentToken) {
    window._socket.emit('admin:auth', { token: currentToken });
  } else if (typeof window._socket !== 'undefined') {
    window._socket.emit('admin:auth', { token: '' });
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

async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }
  const fullUrl = url.startsWith('http') ? url : BACKEND_URL + url;
  return fetch(fullUrl, { ...options, headers });
}

export const AdminAuth = { init, logout, getToken, isRequired, authFetch };
