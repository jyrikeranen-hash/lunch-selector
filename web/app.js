(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    places: [],
    filter: readPref('filter', 'all'),
    search: '',
    menus: new Map(), // id -> {loading, data}
    openMenus: new Set(),
    editingId: null,
    visitId: null,
    rating: 0,
  };

  // ---------------------------------------------------------------- helpers

  function readPref(key, fallback) {
    try { return localStorage.getItem('lunch.' + key) || fallback; } catch { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem('lunch.' + key, value); } catch { /* ignore */ }
  }

  async function api(path, options = {}) {
    const res = await fetch('/api/' + path, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      location.href = '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(location.pathname);
      throw new Error('Not signed in');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setStatus(msg) { $('#status').textContent = msg || ''; }

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '';
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

  // ---------------------------------------------------------------- render

  function matches(p) {
    if (state.filter === 'todo' && p.visited) return false;
    if (state.filter === 'visited' && !p.visited) return false;
    if (!state.search) return true;
    const hay = [p.name, p.address, p.notes, p.lastComment].join(' ').toLowerCase();
    return hay.includes(state.search);
  }

  function render() {
    const total = state.places.length;
    const visited = state.places.filter((p) => p.visited).length;
    $('#visited-count').textContent = visited;
    $('#total-count').textContent = total;
    $('#progress-bar').style.width = total ? `${(visited / total) * 100}%` : '0';
    $('#empty').hidden = total > 0;
    $$('.segmented button').forEach((b) => b.classList.toggle('active', b.dataset.filter === state.filter));

    const list = $('#list');
    list.replaceChildren(...state.places.filter(matches).map(renderCard));
  }

  function renderCard(p) {
    const li = $('#card').content.firstElementChild.cloneNode(true);
    li.dataset.id = p.id;
    li.classList.toggle('visited', !!p.visited);

    const nameEl = $('.name', li);
    if (p.url) {
      const a = document.createElement('a');
      a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = p.name;
      nameEl.append(a);
    } else {
      nameEl.textContent = p.name;
    }

    if (p.address) {
      const a = document.createElement('a');
      a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.address);
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = p.address;
      $('.address', li).append(a);
    }

    if (p.visited) {
      $('.badge', li).textContent = p.visitCount > 1 ? `Visited ×${p.visitCount}` : 'Visited';
      const bits = [`Last: ${fmtDate(p.lastVisitedAt)}`];
      if (p.lastVisitedBy && p.lastVisitedBy !== 'anonymous') bits.push(`by ${p.lastVisitedBy}`);
      if (p.rating) bits.push(stars(p.rating));
      if (p.lastComment) bits.push(`“${p.lastComment}”`);
      $('.meta', li).textContent = bits.join(' · ');
    }
    $('.notes', li).textContent = p.notes || '';

    $('.visit', li).textContent = p.visited ? 'Went again' : 'We went';
    $('.unvisit', li).hidden = !p.visited;
    $('.menu-toggle', li).hidden = !p.menuUrl;

    if (state.openMenus.has(p.id)) fillMenu(li, p.id);
    return li;
  }

  function fillMenu(li, id) {
    const box = $('.menu', li);
    box.hidden = false;
    const entry = state.menus.get(id);
    const text = $('.menu-text', box);
    const note = $('.menu-note', box);
    if (!entry || entry.loading) {
      text.textContent = 'Loading…';
      note.textContent = '';
      return;
    }
    const d = entry.data;
    text.textContent = d.text || (d.error ? '' : 'No menu text found.');
    const fetched = d.fetchedAt ? `Fetched ${new Date(d.fetchedAt).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}` : '';
    note.textContent = [d.error, fetched].filter(Boolean).join(' · ');
  }

  // ---------------------------------------------------------------- data

  async function loadPlaces() {
    try {
      setStatus('Loading…');
      state.places = await api('places');
      setStatus('');
    } catch (e) {
      setStatus('Could not load places: ' + e.message);
    }
    render();
  }

  function replacePlace(updated) {
    const i = state.places.findIndex((p) => p.id === updated.id);
    if (i >= 0) state.places[i] = updated;
    else state.places.push(updated);
    state.places.sort((a, b) => a.name.localeCompare(b.name, 'fi'));
    render();
  }

  async function loadMenu(id, refresh = false) {
    state.openMenus.add(id);
    state.menus.set(id, { loading: true });
    render();
    try {
      const data = await api(`places/${id}/menu${refresh ? '?refresh=1' : ''}`);
      state.menus.set(id, { loading: false, data });
    } catch (e) {
      state.menus.set(id, { loading: false, data: { error: e.message } });
    }
    render();
  }

  async function loadAllMenus() {
    const ids = state.places.filter((p) => p.menuUrl && matches(p)).map((p) => p.id);
    if (!ids.length) { setStatus('No visible places have a menu URL.'); return; }
    setStatus(`Fetching ${ids.length} menus…`);
    const queue = [...ids];
    const worker = async () => { while (queue.length) await loadMenu(queue.shift()); };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    setStatus('');
  }

  // ---------------------------------------------------------------- dialogs

  function openPlaceDialog(place) {
    state.editingId = place ? place.id : null;
    const form = $('#place-form');
    form.reset();
    $('#place-error').textContent = '';
    $('#place-dialog-title').textContent = place ? 'Edit place' : 'Add place';
    if (place) {
      for (const f of ['name', 'address', 'url', 'menuUrl', 'menuSelector', 'notes']) form.elements[f].value = place[f] || '';
      form.elements.menuSliceByDay.checked = place.menuSliceByDay !== false;
    }
    $('#place-dialog').showModal();
  }

  async function savePlace(e) {
    e.preventDefault();
    const form = e.target;
    const body = Object.fromEntries(
      ['name', 'address', 'url', 'menuUrl', 'menuSelector', 'notes'].map((f) => [f, form.elements[f].value]),
    );
    body.menuSliceByDay = form.elements.menuSliceByDay.checked;
    try {
      const saved = state.editingId
        ? await api(`places/${state.editingId}`, { method: 'PUT', body })
        : await api('places', { method: 'POST', body });
      if (state.editingId) state.menus.delete(state.editingId);
      $('#place-dialog').close();
      replacePlace(saved);
    } catch (err) {
      $('#place-error').textContent = err.message;
    }
  }

  function buildStars() {
    const box = $('#stars');
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = '★'; b.dataset.value = i; b.setAttribute('aria-label', `${i} stars`);
      b.addEventListener('click', () => { state.rating = state.rating === i ? 0 : i; paintStars(); });
      box.append(b);
    }
  }
  function paintStars() {
    $$('#stars button').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) <= state.rating));
  }

  function openVisitDialog(place) {
    state.visitId = place.id;
    state.rating = place.rating || 0;
    $('#visit-form').reset();
    $('#visit-name').textContent = place.name;
    paintStars();
    $('#visit-dialog').showModal();
  }

  async function saveVisit(e) {
    e.preventDefault();
    const body = { comment: e.target.elements.comment.value, rating: state.rating || undefined };
    try {
      const updated = await api(`places/${state.visitId}/visit`, { method: 'POST', body });
      $('#visit-dialog').close();
      replacePlace(updated);
    } catch (err) {
      setStatus(err.message);
    }
  }

  // ---------------------------------------------------------------- events

  function onListClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const li = btn.closest('.card');
    const place = state.places.find((p) => p.id === li.dataset.id);
    if (!place) return;

    if (btn.classList.contains('visit')) openVisitDialog(place);
    else if (btn.classList.contains('edit')) openPlaceDialog(place);
    else if (btn.classList.contains('refresh')) loadMenu(place.id, true);
    else if (btn.classList.contains('menu-toggle')) {
      if (state.openMenus.has(place.id)) { state.openMenus.delete(place.id); render(); }
      else if (state.menus.get(place.id)?.data) { state.openMenus.add(place.id); render(); }
      else loadMenu(place.id);
    } else if (btn.classList.contains('unvisit')) {
      if (!confirm(`Clear the visited mark for ${place.name}?`)) return;
      api(`places/${place.id}/visit`, { method: 'DELETE' }).then(replacePlace).catch((err) => setStatus(err.message));
    } else if (btn.classList.contains('delete')) {
      if (!confirm(`Delete ${place.name}?`)) return;
      api(`places/${place.id}`, { method: 'DELETE' })
        .then(() => { state.places = state.places.filter((p) => p.id !== place.id); render(); })
        .catch((err) => setStatus(err.message));
    }
  }

  function surpriseMe() {
    const pool = state.places.filter((p) => !p.visited);
    if (!pool.length) { setStatus(state.places.length ? "You've been everywhere! Add more places." : 'Add some places first.'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    state.filter = 'all'; state.search = ''; $('#search').value = '';
    render();
    const li = $(`.card[data-id="${CSS.escape(pick.id)}"]`);
    setStatus(`How about ${pick.name}?`);
    if (li) {
      li.classList.add('highlight');
      li.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => li.classList.remove('highlight'), 2500);
    }
  }

  async function showUser() {
    try {
      const res = await fetch('/.auth/me');
      const { clientPrincipal } = await res.json();
      if (clientPrincipal) {
        $('#user').textContent = clientPrincipal.userDetails;
        $('#logout').hidden = false;
      }
    } catch { /* running without SWA auth (e.g. plain static server) */ }
  }

  function init() {
    buildStars();
    $('#add').addEventListener('click', () => openPlaceDialog(null));
    $('#place-form').addEventListener('submit', savePlace);
    $('#visit-form').addEventListener('submit', saveVisit);
    $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $('#list').addEventListener('click', onListClick);
    $('#random').addEventListener('click', surpriseMe);
    $('#load-menus').addEventListener('click', loadAllMenus);
    $('#search').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });
    $$('.segmented button').forEach((b) =>
      b.addEventListener('click', () => { state.filter = b.dataset.filter; writePref('filter', state.filter); render(); }),
    );
    showUser();
    loadPlaces();
  }

  init();
})();
