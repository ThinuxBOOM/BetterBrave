(() => {
  'use strict';

  /* ---------------------------------------------------------------------
   * Storage
   * ------------------------------------------------------------------- */
  const DEFAULT_DIALS = [
    { id: 'd1', name: 'YouTube', url: 'https://youtube.com' },
    { id: 'd2', name: 'GitHub', url: 'https://github.com' },
    { id: 'd3', name: 'Gmail', url: 'https://mail.google.com' },
    { id: 'd4', name: 'Reddit', url: 'https://reddit.com' },
    { id: 'd5', name: 'Wikipedia', url: 'https://wikipedia.org' },
  ];

  const DEFAULT_SETTINGS = {
    accent: 'magenta',
    background: 'grid',
    engine: 'brave',
    userName: '',
    wallpaperDim: 0.45,
  };

  const DEFAULT_STATE = {
    dials: DEFAULT_DIALS,
    settings: DEFAULT_SETTINGS,
    notes: '',
    todos: [],
  };

  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function storageGet() {
    return new Promise((resolve) => {
      if (hasChromeStorage) {
        chrome.storage.local.get(['dials', 'settings', 'notes', 'todos'], (res) => {
          resolve({
            dials: res.dials || DEFAULT_STATE.dials,
            settings: { ...DEFAULT_SETTINGS, ...(res.settings || {}) },
            notes: res.notes || '',
            todos: res.todos || [],
          });
        });
      } else {
        // Fallback for previewing outside an installed extension context.
        try {
          const raw = window.localStorage.getItem('gx-dial-state');
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({
            dials: parsed.dials || DEFAULT_STATE.dials,
            settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
            notes: parsed.notes || '',
            todos: parsed.todos || [],
          });
        } catch (e) {
          resolve(DEFAULT_STATE);
        }
      }
    });
  }

  function storageSet(partial) {
    if (hasChromeStorage) {
      chrome.storage.local.set(partial);
    } else {
      try {
        const raw = window.localStorage.getItem('gx-dial-state');
        const current = raw ? JSON.parse(raw) : {};
        window.localStorage.setItem('gx-dial-state', JSON.stringify({ ...current, ...partial }));
      } catch (e) { /* ignore */ }
    }
  }

  let state = DEFAULT_STATE;

  /* ---------------------------------------------------------------------
   * Wallpaper storage (IndexedDB — video/image files can be large,
   * so they're kept out of chrome.storage.local and read as blobs).
   * ------------------------------------------------------------------- */
  const WP_DB_NAME = 'dial-wallpaper-db';
  const WP_STORE = 'wallpaper';
  let wpDbPromise = null;

  function openWpDb() {
    if (wpDbPromise) return wpDbPromise;
    wpDbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      const req = indexedDB.open(WP_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(WP_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return wpDbPromise;
  }

  async function saveWallpaperBlob(blob, kind) {
    const db = await openWpDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(WP_STORE, 'readwrite');
      tx.objectStore(WP_STORE).put({ blob, kind }, 'current');
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async function loadWallpaperBlob() {
    const db = await openWpDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(WP_STORE, 'readonly');
      const req = tx.objectStore(WP_STORE).get('current');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async function clearWallpaperBlob() {
    const db = await openWpDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(WP_STORE, 'readwrite');
      tx.objectStore(WP_STORE).delete('current');
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  /* ---------------------------------------------------------------------
   * Clock + greeting
   * ------------------------------------------------------------------- */
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('dateLine');
  const greetingEl = document.getElementById('greeting');

  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm}:${ss}`;
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric',
    });

    const h = now.getHours();
    const period = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    const name = state.settings.userName ? `, ${state.settings.userName}` : '';
    greetingEl.textContent = `Good ${period}${name}`;
  }

  /* ---------------------------------------------------------------------
   * Command bar
   * ------------------------------------------------------------------- */
  const cmdForm = document.getElementById('cmdForm');
  const cmdInput = document.getElementById('cmdInput');
  const engineSelect = document.getElementById('engineSelect');

  const ENGINE_URLS = {
    brave: 'https://search.brave.com/search?q=',
    google: 'https://www.google.com/search?q=',
    ddg: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q=',
  };

  function looksLikeUrl(v) {
    if (/^https?:\/\//i.test(v)) return true;
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(v) && !v.includes(' ')) return true;
    return false;
  }

  cmdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = cmdInput.value.trim();
    if (!raw) return;
    if (looksLikeUrl(raw)) {
      window.location.href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    } else {
      const base = ENGINE_URLS[engineSelect.value] || ENGINE_URLS.brave;
      window.location.href = base + encodeURIComponent(raw);
    }
  });

  /* ---------------------------------------------------------------------
   * Dial grid
   * ------------------------------------------------------------------- */
  const dialGrid = document.getElementById('dialGrid');
  let dragFromIndex = null;
  let editingId = null;

  function hostnameOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  function faviconFor(url) {
    const host = hostnameOf(url);
    return host ? `https://www.google.com/s2/favicons?sz=64&domain=${host}` : '';
  }

  function renderDials() {
    dialGrid.innerHTML = '';
    state.dials.forEach((dial, index) => {
      const tile = document.createElement('a');
      tile.className = 'dial-tile';
      tile.href = dial.url;
      tile.draggable = true;
      tile.dataset.index = String(index);
      tile.style.animationDelay = `${Math.min(index, 10) * 0.03}s`;

      const favWrap = document.createElement('div');
      favWrap.className = 'dial-favicon';
      const favUrl = faviconFor(dial.url);
      if (favUrl) {
        const img = document.createElement('img');
        img.src = favUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => { favWrap.textContent = (dial.name || '?').charAt(0).toUpperCase(); };
        favWrap.appendChild(img);
      } else {
        favWrap.textContent = (dial.name || '?').charAt(0).toUpperCase();
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'dial-name';
      nameEl.textContent = dial.name || hostnameOf(dial.url) || 'Untitled';

      const editBtn = document.createElement('button');
      editBtn.className = 'dial-edit';
      editBtn.type = 'button';
      editBtn.setAttribute('aria-label', `Edit ${dial.name}`);
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDialModal(dial);
      });

      tile.appendChild(editBtn);
      tile.appendChild(favWrap);
      tile.appendChild(nameEl);

      tile.addEventListener('dragstart', () => {
        dragFromIndex = index;
        tile.classList.add('dragging');
      });
      tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
      tile.addEventListener('dragover', (e) => e.preventDefault());
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFromIndex === null || dragFromIndex === index) return;
        const moved = state.dials.splice(dragFromIndex, 1)[0];
        state.dials.splice(index, 0, moved);
        dragFromIndex = null;
        storageSet({ dials: state.dials });
        renderDials();
      });

      dialGrid.appendChild(tile);
    });

    const addTile = document.createElement('button');
    addTile.className = 'dial-tile dial-add';
    addTile.type = 'button';
    addTile.setAttribute('aria-label', 'Add shortcut');
    addTile.innerHTML = `<div class="dial-favicon">+</div><div class="dial-name">Add</div>`;
    addTile.addEventListener('click', () => openDialModal(null));
    dialGrid.appendChild(addTile);
  }

  /* ---- Add / edit modal ---- */
  const dialModalOverlay = document.getElementById('dialModalOverlay');
  const dialModalTitle = document.getElementById('dialModalTitle');
  const dialNameInput = document.getElementById('dialName');
  const dialUrlInput = document.getElementById('dialUrl');
  const dialSaveBtn = document.getElementById('dialSave');
  const dialCancelBtn = document.getElementById('dialCancel');
  const dialDeleteBtn = document.getElementById('dialDelete');

  function openDialModal(dial) {
    editingId = dial ? dial.id : null;
    dialModalTitle.textContent = dial ? 'Edit shortcut' : 'Add shortcut';
    dialNameInput.value = dial ? dial.name : '';
    dialUrlInput.value = dial ? dial.url : '';
    dialDeleteBtn.hidden = !dial;
    dialModalOverlay.classList.add('show');
    setTimeout(() => dialNameInput.focus(), 0);
  }

  function closeDialModal() {
    dialModalOverlay.classList.remove('show');
    editingId = null;
  }

  function normalizeUrl(v) {
    v = v.trim();
    if (!v) return '';
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  }

  dialSaveBtn.addEventListener('click', () => {
    const name = dialNameInput.value.trim();
    const url = normalizeUrl(dialUrlInput.value);
    if (!url) { dialUrlInput.focus(); return; }

    if (editingId) {
      const target = state.dials.find((d) => d.id === editingId);
      if (target) {
        target.name = name || hostnameOf(url);
        target.url = url;
      }
    } else {
      state.dials.push({
        id: 'd' + Date.now().toString(36),
        name: name || hostnameOf(url),
        url,
      });
    }
    storageSet({ dials: state.dials });
    renderDials();
    closeDialModal();
  });

  dialDeleteBtn.addEventListener('click', () => {
    state.dials = state.dials.filter((d) => d.id !== editingId);
    storageSet({ dials: state.dials });
    renderDials();
    closeDialModal();
  });

  dialCancelBtn.addEventListener('click', closeDialModal);
  dialModalOverlay.addEventListener('click', (e) => {
    if (e.target === dialModalOverlay) closeDialModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialModalOverlay.classList.contains('show')) closeDialModal();
  });

  /* ---------------------------------------------------------------------
   * Drawers (notes / todo / settings)
   * ------------------------------------------------------------------- */
  const scrim = document.getElementById('scrim');
  const drawers = {
    notes: document.getElementById('notesDrawer'),
    todo: document.getElementById('todoDrawer'),
    settings: document.getElementById('settingsDrawer'),
  };

  function openDrawer(key) {
    Object.values(drawers).forEach((d) => d.classList.remove('open'));
    drawers[key].classList.add('open');
    scrim.classList.add('show');
  }
  function closeDrawers() {
    Object.values(drawers).forEach((d) => d.classList.remove('open'));
    scrim.classList.remove('show');
  }

  document.getElementById('openNotes').addEventListener('click', () => openDrawer('notes'));
  document.getElementById('openTodo').addEventListener('click', () => openDrawer('todo'));
  document.getElementById('openSettings').addEventListener('click', () => openDrawer('settings'));
  scrim.addEventListener('click', closeDrawers);
  document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeDrawers));

  /* ---- Notes ---- */
  const notesArea = document.getElementById('notesArea');
  let notesTimer = null;
  notesArea.addEventListener('input', () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => storageSet({ notes: notesArea.value }), 300);
  });

  /* ---- Todo ---- */
  const todoForm = document.getElementById('todoForm');
  const todoInput = document.getElementById('todoInput');
  const todoList = document.getElementById('todoList');

  function renderTodos() {
    todoList.innerHTML = '';
    state.todos.forEach((todo) => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (todo.done ? ' done' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = todo.done;
      checkbox.addEventListener('change', () => {
        todo.done = checkbox.checked;
        storageSet({ todos: state.todos });
        renderTodos();
      });

      const span = document.createElement('span');
      span.textContent = todo.text;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'todo-remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', 'Remove task');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        state.todos = state.todos.filter((t) => t.id !== todo.id);
        storageSet({ todos: state.todos });
        renderTodos();
      });

      li.appendChild(checkbox);
      li.appendChild(span);
      li.appendChild(removeBtn);
      todoList.appendChild(li);
    });
  }

  todoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;
    state.todos.push({ id: 't' + Date.now().toString(36), text, done: false });
    todoInput.value = '';
    storageSet({ todos: state.todos });
    renderTodos();
  });

  /* ---------------------------------------------------------------------
   * Settings
   * ------------------------------------------------------------------- */
  const accentSwatches = document.getElementById('accentSwatches');
  const bgOptions = document.getElementById('bgOptions');
  const engineOptions = document.getElementById('engineOptions');
  const userNameInput = document.getElementById('userName');
  const ACCENTS = ['magenta', 'lime', 'sunset', 'violet'];

  const wallpaperControls = document.getElementById('wallpaperControls');
  const wallpaperHint = document.getElementById('wallpaperHint');
  const wallpaperUploadBtn = document.getElementById('wallpaperUploadBtn');
  const wallpaperRemoveBtn = document.getElementById('wallpaperRemoveBtn');
  const wallpaperFile = document.getElementById('wallpaperFile');
  const wallpaperDim = document.getElementById('wallpaperDim');
  const dimValue = document.getElementById('dimValue');
  const bgVideo = document.getElementById('bgVideo');
  const bgImage = document.getElementById('bgImage');

  let currentWallpaperUrl = null;

  function setWallpaperDimVar() {
    document.documentElement.style.setProperty('--wallpaper-dim', state.settings.wallpaperDim);
  }

  function releaseWallpaperUrl() {
    if (currentWallpaperUrl) {
      URL.revokeObjectURL(currentWallpaperUrl);
      currentWallpaperUrl = null;
    }
  }

  function showWallpaperElement(kind, blob) {
    releaseWallpaperUrl();
    currentWallpaperUrl = URL.createObjectURL(blob);
    if (kind === 'video') {
      bgImage.hidden = true;
      bgImage.removeAttribute('src');
      bgVideo.src = currentWallpaperUrl;
      bgVideo.hidden = false;
      bgVideo.play().catch(() => {});
    } else {
      bgVideo.hidden = true;
      bgVideo.removeAttribute('src');
      bgImage.src = currentWallpaperUrl;
      bgImage.hidden = false;
    }
  }

  function hideWallpaperElements() {
    releaseWallpaperUrl();
    bgVideo.hidden = true;
    bgVideo.pause();
    bgVideo.removeAttribute('src');
    bgImage.hidden = true;
    bgImage.removeAttribute('src');
  }

  async function refreshWallpaperFromDb() {
    const bg = state.settings.background;
    if (bg !== 'image' && bg !== 'video') { hideWallpaperElements(); return; }
    const record = await loadWallpaperBlob();
    if (record && record.blob) {
      showWallpaperElement(record.kind, record.blob);
    } else {
      hideWallpaperElements();
    }
  }

  function applySettingsToDom() {
    document.body.dataset.accent = state.settings.accent;
    document.body.dataset.bg = state.settings.background;
    engineSelect.value = state.settings.engine;
    userNameInput.value = state.settings.userName;
    setWallpaperDimVar();

    accentSwatches.querySelectorAll('.swatch').forEach((s) => {
      s.classList.toggle('active', s.dataset.swatch === state.settings.accent);
    });
    bgOptions.querySelectorAll('.option-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.bg === state.settings.background);
    });
    engineOptions.querySelectorAll('.option-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.engine === state.settings.engine);
    });

    const isWallpaper = state.settings.background === 'image' || state.settings.background === 'video';
    wallpaperControls.hidden = !isWallpaper;
    if (isWallpaper) {
      wallpaperHint.textContent = state.settings.background === 'video'
        ? 'Choose a video file to loop as your background.'
        : 'Choose an image file as your background.';
      wallpaperFile.accept = state.settings.background === 'video' ? 'video/*' : 'image/*';
    }
    dimValue.textContent = Math.round(state.settings.wallpaperDim * 100) + '%';
    wallpaperDim.value = Math.round(state.settings.wallpaperDim * 100);
  }

  function buildSwatches() {
    accentSwatches.innerHTML = '';
    ACCENTS.forEach((name) => {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.dataset.swatch = name;
      btn.type = 'button';
      btn.setAttribute('aria-label', `${name} accent`);
      btn.addEventListener('click', () => {
        state.settings.accent = name;
        storageSet({ settings: state.settings });
        applySettingsToDom();
      });
      accentSwatches.appendChild(btn);
    });
  }

  bgOptions.querySelectorAll('.option-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.settings.background = chip.dataset.bg;
      storageSet({ settings: state.settings });
      applySettingsToDom();
      refreshWallpaperFromDb();
    });
  });

  wallpaperUploadBtn.addEventListener('click', () => wallpaperFile.click());

  wallpaperFile.addEventListener('change', async () => {
    const file = wallpaperFile.files[0];
    if (!file) return;
    const kind = state.settings.background === 'video' ? 'video' : 'image';
    await saveWallpaperBlob(file, kind);
    showWallpaperElement(kind, file);
    wallpaperFile.value = '';
  });

  wallpaperRemoveBtn.addEventListener('click', async () => {
    await clearWallpaperBlob();
    hideWallpaperElements();
  });

  wallpaperDim.addEventListener('input', () => {
    state.settings.wallpaperDim = Number(wallpaperDim.value) / 100;
    dimValue.textContent = wallpaperDim.value + '%';
    setWallpaperDimVar();
  });
  wallpaperDim.addEventListener('change', () => {
    storageSet({ settings: state.settings });
  });

  engineOptions.querySelectorAll('.option-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.settings.engine = chip.dataset.engine;
      storageSet({ settings: state.settings });
      applySettingsToDom();
    });
  });

  let nameTimer = null;
  userNameInput.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      state.settings.userName = userNameInput.value.trim();
      storageSet({ settings: state.settings });
      tick();
    }, 300);
  });

  /* ---- Export / import / reset ---- */
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ dials: state.dials }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dial-shortcuts.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (Array.isArray(parsed.dials)) {
          state.dials = parsed.dials.map((d, i) => ({
            id: d.id || 'd' + Date.now().toString(36) + i,
            name: d.name || '',
            url: normalizeUrl(d.url || ''),
          })).filter((d) => d.url);
          storageSet({ dials: state.dials });
          renderDials();
        }
      } catch (e) { /* ignore malformed file */ }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset shortcuts, notes, to-dos and the wallpaper to defaults?')) return;
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    storageSet(state);
    await clearWallpaperBlob();
    hideWallpaperElements();
    renderDials();
    renderTodos();
    notesArea.value = '';
    applySettingsToDom();
  });

  /* ---------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------- */
  async function init() {
    state = await storageGet();
    buildSwatches();
    applySettingsToDom();
    await refreshWallpaperFromDb();
    renderDials();
    renderTodos();
    notesArea.value = state.notes;
    tick();
    setInterval(tick, 1000);
    cmdInput.focus();
  }

  init();
})();
