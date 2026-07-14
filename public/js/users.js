'use strict';
/* Users (Module 8). Owner-only. Shows live users if /api/users exists, else static roles. */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const content = document.getElementById('content');
  const denied = document.getElementById('denied');
  const body = document.getElementById('userBody');

  if (!api.isOwner()) {
    content.classList.add('hidden');
    denied.classList.remove('hidden');
    return;
  }

  async function load() {
    try {
      const data = await api.get('/api/users', { allow404: true });
      if (data === null) {
        // Backend users endpoint not built yet — show placeholder.
        body.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:18px;">' +
          'No live user list yet — the backend /api/users endpoint is coming online. See the roles reference below.</td></tr>';
        return;
      }
      const list = ui.toArray(data);
      ui.renderList(body, list, function (u) {
        return '<tr><td>' + ui.esc(u.name || '—') + '</td><td>' + ui.esc(u.username || '—') +
          '</td><td><span class="badge badge--' + ui.esc(u.role) + '">' + ui.esc(u.role) + '</span></td></tr>';
      }, 'No users found.');
    } catch (e) {
      ui.showComingOnline(body.closest('.card'), 'User list is coming online — backend route /api/users is not ready yet.');
    }
  }

  load();
})();
