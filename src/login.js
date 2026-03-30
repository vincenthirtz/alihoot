import { createClient } from '@supabase/supabase-js';

const BACKEND_URL = import.meta.env.PROD ? 'https://alihoot.onrender.com' : '';

(async () => {
  const configRes = await fetch(BACKEND_URL + '/api/auth/config');
  const config = await configRes.json();

  if (!config.required) {
    window.location.href = '/admin';
    return;
  }

  const sb = createClient(config.supabaseUrl, config.supabaseAnonKey);

  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session) {
    window.location.href = '/admin?token=' + session.access_token;
    return;
  }

  const loginBtn = document.getElementById('login-btn');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');

  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      errorEl.textContent = 'Email et mot de passe requis';
      return;
    }

    loginBtn.disabled = true;
    errorEl.textContent = '';

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = error.message;
      loginBtn.disabled = false;
      return;
    }

    window.location.href = '/admin?token=' + data.session.access_token;
  });

  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') passwordInput.focus();
  });
})();
