'use strict';
/*
 * Shared API layer for the Mobile Shop System frontend.
 * Handles token storage, Authorization header injection, 401 redirect, and
 * optional auto-login (owner convenience mode) when the backend reports
 * config.autoLogin = true (AUTO_LOGIN env not set to '0').
 */
window.api = (function () {
  const TOKEN_KEY = 'mss_token';
  const ADMIN_KEY = 'mss_admin';
  const LOGIN_URL = '/login.html';

  let autoLogin = false; // learned from /api/config

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }
  function getAdmin() {
    try { const raw = localStorage.getItem(ADMIN_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function setAdmin(a) {
    try { if (a) localStorage.setItem(ADMIN_KEY, JSON.stringify(a)); else localStorage.removeItem(ADMIN_KEY); } catch (e) { /* ignore */ }
  }

  function isLoginPage() {
    return window.location.pathname.endsWith('/login.html') || window.location.pathname === '/login';
  }
  function redirectToLogin() {
    if (isLoginPage()) return;
    // Auto-login may still be in flight — wait for it before bouncing to login.
    Promise.resolve(publicApi && publicApi.ready).then(function () {
      if (getToken()) { window.location.reload(); return; } // logged in now: re-run page guard
      const here = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(LOGIN_URL + '?next=' + here);
    });
  }
  function isOwner() {
    const a = getAdmin();
    return !!(a && a.role === 'owner');
  }
  function logout() {
    setToken(''); setAdmin(null); redirectToLogin();
  }

  // Fetch backend config; if auto-login is on and we have no token, sign in as owner.
  async function bootstrap() {
    try {
      const cfg = await fetch('/api/config').then(r => r.json()).catch(() => null);
      if (cfg && cfg.autoLogin) {
        autoLogin = true;
        if (!getToken()) {
          try {
            const r = await fetch('/api/auth/auto-login', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (r.ok) {
              const j = await r.json();
              if (j && j.token) { setToken(j.token); setAdmin(j.admin || null); }
            }
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
    return autoLogin;
  }

  async function request(method, path, body) {
    if (!getToken() && autoLogin && !path.startsWith('/api/auth/') && !path.startsWith('/api/config')) {
      await bootstrap();
    }
    const headers = { 'Accept': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try { res = await fetch(path, opts); }
    catch (networkErr) {
      const err = new Error('Network error — server may be offline');
      err.network = true; throw err;
    }

    if (res.status === 401) {
      setToken(''); setAdmin(null);
      if (autoLogin && !path.startsWith('/api/auth/') && !path.startsWith('/api/config')) {
        await bootstrap();
        if (getToken()) return request(method, path, body); // retry once with fresh token
      }
      if (!isLoginPage()) redirectToLogin();
      const e = new Error('Session expired — please log in again');
      e.status = 401; throw e;
    }

    if (res.status === 403) {
      let msg = 'Access denied (owner only)';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      const e = new Error(msg); e.status = 403; throw e;
    }

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = { _raw: text }; } }

    if (!res.ok) {
      const e = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      e.status = res.status; e.data = data; throw e;
    }
    return data;
  }

  async function get(path, { allow404 = false } = {}) {
    try { return await request('GET', path); }
    catch (e) { if (allow404 && e.status === 404) return null; throw e; }
  }
  async function post(path, body) { return request('POST', path, body); }
  async function put(path, body) { return request('PUT', path, body); }
  async function del(path) { return request('DELETE', path); }

  async function login(username, password) {
    const result = await request('POST', '/api/auth/login', { username, password });
    if (result && result.token) { setToken(result.token); setAdmin(result.admin || null); }
    return result;
  }

  const publicApi = {
    get, post, put, del, login, logout, bootstrap,
    get token() { return getToken(); },
    get admin() { return getAdmin(); },
    isOwner,
    redirectToLogin
  };
  // Kick off auto-login immediately; pages can `await api.ready` before guarding.
  publicApi.ready = bootstrap();
  return publicApi;
})();
