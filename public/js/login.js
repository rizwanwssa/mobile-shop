'use strict';
/* Login page logic. */
(function () {
  const form = document.getElementById('loginForm');
  const errBox = document.getElementById('err');
  const submitBtn = document.getElementById('submitBtn');

  // If already logged in, skip to dashboard.
  if (api.token && api.admin) {
    const next = new URLSearchParams(location.search).get('next');
    location.replace(next || '/index.html');
    return;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errBox.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    try {
      const res = await api.login(username, password);
      if (res && res.token) {
        const next = new URLSearchParams(location.search).get('next');
        location.replace(next || '/index.html');
      } else {
        throw new Error('Unexpected response from server');
      }
    } catch (err) {
      errBox.textContent = (err && err.message) ? err.message : 'Login failed';
      errBox.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
})();
