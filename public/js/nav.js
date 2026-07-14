'use strict';
/*
 * Renders the responsive top navigation and highlights the active page.
 * Also injects the current admin's name + a logout button.
 * Browser global `nav`. Call nav.mount() after the <header data-nav> element exists.
 */
window.nav = (function () {
  const PAGES = [
    { href: '/index.html',      label: 'Dashboard',      icon: '▣' },
    { href: '/inventory.html',  label: 'Inventory',      icon: '▤' },
    { href: '/customers.html',  label: 'Customers',      icon: '☺' },
    { href: '/used.html',       label: 'Used Buying',    icon: '⟲' },
    { href: '/repair.html',     label: 'Repairs',        icon: '🔧' },
    { href: '/installments.html', label: 'Installments', icon: '📒' },
    { href: '/expenses.html',   label: 'Expenses',       icon: '💸' },
    { href: '/users.html',      label: 'Users',          icon: '👤' }
  ];

  function currentPath() {
    const p = window.location.pathname;
    if (p === '/' || p === '') return '/index.html';
    return p;
  }

  function mount() {
    const host = document.querySelector('[data-nav]');
    if (!host) return;

    const admin = (window.api && api.admin) || null;
    const here = currentPath();

    const links = PAGES.map(function (p) {
      const active = (p.href === here) ? ' is-active' : '';
      return '<a class="nav__link' + active + '" href="' + p.href + '">' +
             '<span class="nav__icon" aria-hidden="true">' + p.icon + '</span>' +
             '<span class="nav__label">' + p.label + '</span></a>';
    }).join('');

    const who = admin
      ? esc(admin.name || admin.username) + ' · ' + esc(admin.role || '')
      : 'Not signed in';

    host.innerHTML =
      '<div class="nav__bar">' +
        '<a class="nav__brand" href="/index.html">📱 Mobile Shop</a>' +
        '<div class="nav__who">' + who + '</div>' +
        '<button class="nav__toggle" aria-label="Toggle menu" aria-expanded="false">☰</button>' +
      '</div>' +
      '<nav class="nav__links" id="navLinks">' + links +
        '<button class="nav__link nav__logout" id="navLogout">⎋ Logout</button>' +
      '</nav>';

    const toggle = host.querySelector('.nav__toggle');
    const linksEl = host.querySelector('.nav__links');
    toggle.addEventListener('click', function () {
      const open = linksEl.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    const logoutBtn = host.querySelector('#navLogout');
    logoutBtn.addEventListener('click', function () {
      if (window.api && api.logout) api.logout();
    });
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { mount };
})();
