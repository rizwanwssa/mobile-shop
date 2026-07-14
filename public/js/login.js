'use strict';
/* Login page logic. */
(function () {
  const form = document.getElementById('loginForm');
  const errBox = document.getElementById('err');
  const submitBtn = document.getElementById('submitBtn');

  function goNext() {
    const next = new URLSearchParams(location.search).get('next');
    location.replace(next || '/index.html');
  }

  // If already logged in, skip to dashboard.
  if (api.token && api.admin) { goNext(); return; }

  // Auto-login mode: sign in as owner silently, then enter the app.
  api.bootstrap().then(function () {
    if (api.token && api.admin) { goNext(); return; }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errBox.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    try {
      const res = await api.login(username, password);
      if (res && res.token) { goNext(); }
      else { throw new Error('Unexpected response from server'); }
    } catch (err) {
      errBox.textContent = (err && err.message) ? err.message : 'Login failed';
      errBox.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
})();
