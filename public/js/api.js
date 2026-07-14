'use strict';
/*
 * Shared API layer for the Mobile Shop System frontend.
 * Handles token storage, Authorization header injection, and 401 redirect.
 *
 * Usage (browser global `api`):
 *   api.get('/api/inventory')
 *   api.post('/api/sales', { ... })
 *   api.login('admin', 'pw')   -> { token, admin }
 *   api.token                  -> current bearer token (or '')
 *   api.admin                  -> { id, name, username, role } or null
 *   api.isOwner()              -> boolean
 *   api.logout()
 */
window.api = (function () {
  const TOKEN_KEY = 'mss_token';
  const ADMIN_KEY = 'mss_admin';
  // Where to send the user when the token is missing/invalid.
  const LOGIN_URL = '/login.html';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; }
    catch (e) { return ''; }
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
    catch (e) { /* storage may be unavailable */ }
  }
  function getAdmin() {
    try {
      const raw = localStorage.getItem(ADMIN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setAdmin(a) {
    try { if (a) localStorage.setItem(ADMIN_KEY, JSON.stringify(a)); else localStorage.removeItem(ADMIN_KEY); }
    catch (e) { /* ignore */ }
  }

  function isLoginPage() {
    return window.location.pathname.endsWith('/login.html') ||
           window.location.pathname === '/login';
  }

  function redirectToLogin() {
    if (isLoginPage()) return;
    // Preserve the page we came from so login can bounce back.
    const here = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(LOGIN_URL + '?next=' + here);
  }

  function isOwner() {
    const a = getAdmin();
    return !!(a && a.role === 'owner');
  }

  function logout() {
    setToken('');
    setAdmin(null);
    redirectToLogin();
  }

  async function request(method, path, body) {
    const headers = { 'Accept': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(path, opts);
    } catch (networkErr) {
      // Server not reachable at all.
      const err = new Error('Network error — server may be offline');
      err.network = true;
      throw err;
    }

    // 401 -> clear credentials and bounce to login.
    if (res.status === 401) {
      setToken('');
      setAdmin(null);
      // Only auto-redirect for data requests, not the login call itself.
      if (!path.startsWith('/api/auth/')) redirectToLogin();
      const e = new Error('Session expired — please log in again');
      e.status = 401;
      throw e;
    }

    // 403 -> role restriction (e.g. staff hitting owner-only route).
    if (res.status === 403) {
      let msg = 'Access denied (owner only)';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      const e = new Error(msg);
      e.status = 403;
      throw e;
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch (e) {
        // Non-JSON (e.g. a PDF has a JSON content-type by mistake, or HTML 404).
        data = { _raw: text };
      }
    }

    if (!res.ok) {
      const e = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  // Convenience wrappers. Returns null (instead of throwing) for 404 so the
  // UI can show "feature coming online" without crashing.
  async function get(path, { allow404 = false } = {}) {
    try {
      return await request('GET', path);
    } catch (e) {
      if (allow404 && e.status === 404) return null;
      throw e;
    }
  }
  async function post(path, body) { return request('POST', path, body); }
  async function put(path, body) { return request('PUT', path, body); }
  async function del(path) { return request('DELETE', path); }

  async function login(username, password) {
    const result = await request('POST', '/api/auth/login', { username, password });
    if (result && result.token) {
      setToken(result.token);
      setAdmin(result.admin || null);
    }
    return result;
  }

  return {
    get, post, put, del, login, logout,
    get token() { return getToken(); },
    get admin() { return getAdmin(); },
    isOwner,
    redirectToLogin
  };
})();
