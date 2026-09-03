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
    weatherCity: '',
    weatherLabel: '',
    weatherLat: null,
    weatherLon: null,
    weatherUnit: 'c',
    musicVolume: 0.7,
    musicMuted: false,
    musicIndex: 0,
  };

  const DEFAULT_STATE = {
    dials: DEFAULT_DIALS,
    settings: DEFAULT_SETTINGS,
    notes: '',
    todos: [],
    weather: null,
    tracks: [],
  };

  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function storageGet() {
    return new Promise((resolve) => {
      if (hasChromeStorage) {
        chrome.storage.local.get(['dials', 'settings', 'notes', 'todos', 'weather', 'tracks'], (res) => {
          resolve({
            dials: res.dials || DEFAULT_STATE.dials,
            settings: { ...DEFAULT_SETTINGS, ...(res.settings || {}) },
            notes: res.notes || '',
            todos: res.todos || [],
            weather: res.weather || null,
            tracks: res.tracks || [],
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
            weather: parsed.weather || null,
            tracks: parsed.tracks || [],
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
   * Local asset storage (IndexedDB — wallpaper video/image and music
   * files can be large, so they're kept out of chrome.storage.local
   * and read back as blobs). One DB, two object stores.
   * ------------------------------------------------------------------- */
  const WP_DB_NAME = 'dial-wallpaper-db';
  const WP_STORE = 'wallpaper';
  const TRACKS_STORE = 'tracks';
  let wpDbPromise = null;

  function openWpDb() {
    if (wpDbPromise) return wpDbPromise;
    wpDbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      const req = indexedDB.open(WP_DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(WP_STORE)) db.createObjectStore(WP_STORE);
        if (!db.objectStoreNames.contains(TRACKS_STORE)) db.createObjectStore(TRACKS_STORE);
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

  async function saveTrackBlob(id, blob) {
    const db = await openWpDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(TRACKS_STORE, 'readwrite');
      tx.objectStore(TRACKS_STORE).put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async function getTrackBlob(id) {
    const db = await openWpDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(TRACKS_STORE, 'readonly');
      const req = tx.objectStore(TRACKS_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async function deleteTrackBlob(id) {
    const db = await openWpDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(TRACKS_STORE, 'readwrite');
      tx.objectStore(TRACKS_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async function clearAllTrackBlobs() {
    const db = await openWpDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(TRACKS_STORE, 'readwrite');
      tx.objectStore(TRACKS_STORE).clear();
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
    music: document.getElementById('musicDrawer'),
    cleaner: document.getElementById('cleanerDrawer'),
    monitor: document.getElementById('monitorDrawer'),
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
  document.getElementById('openMusic').addEventListener('click', () => openDrawer('music'));
  document.getElementById('openCleaner').addEventListener('click', () => openDrawer('cleaner'));
  document.getElementById('openMonitor').addEventListener('click', () => openDrawer('monitor'));
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
   * Music player
   * ------------------------------------------------------------------- */
  const audioEl = document.getElementById('musicPlayer');
  const playlistEl = document.getElementById('playlist');
  const playlistEmptyHint = document.getElementById('playlistEmptyHint');
  const playerTrackName = document.getElementById('playerTrackName');
  const playerSeek = document.getElementById('playerSeek');
  const playerCurrentTime = document.getElementById('playerCurrentTime');
  const playerDuration = document.getElementById('playerDuration');
  const playerPrev = document.getElementById('playerPrev');
  const playerPlay = document.getElementById('playerPlay');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const playerNext = document.getElementById('playerNext');
  const playerMute = document.getElementById('playerMute');
  const volIcon = document.getElementById('volIcon');
  const muteIcon = document.getElementById('muteIcon');
  const playerVolume = document.getElementById('playerVolume');
  const addTracksBtn = document.getElementById('addTracksBtn');
  const tracksFile = document.getElementById('tracksFile');
  const musicDot = document.getElementById('musicDot');

  let currentTrackUrl = null;
  let isSeeking = false;

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function cleanTrackName(filename) {
    return filename.replace(/\.[^./]+$/, '');
  }

  function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlistEmptyHint.hidden = state.tracks.length > 0;
    state.tracks.forEach((track, index) => {
      const li = document.createElement('li');
      li.className = 'playlist-item' + (index === state.settings.musicIndex ? ' active' : '');

      const span = document.createElement('span');
      span.textContent = track.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'playlist-remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${track.name}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteTrackBlob(track.id);
        const wasCurrent = index === state.settings.musicIndex;
        state.tracks.splice(index, 1);
        if (wasCurrent) {
          audioEl.pause();
          releaseTrackUrl();
          audioEl.removeAttribute('src');
          playerTrackName.textContent = 'No track selected';
          state.settings.musicIndex = Math.min(index, state.tracks.length - 1);
        } else if (index < state.settings.musicIndex) {
          state.settings.musicIndex -= 1;
        }
        storageSet({ tracks: state.tracks, settings: state.settings });
        renderPlaylist();
      });

      li.appendChild(span);
      li.appendChild(removeBtn);
      li.addEventListener('click', () => loadTrackAtIndex(index, true));
      playlistEl.appendChild(li);
    });
  }

  function releaseTrackUrl() {
    if (currentTrackUrl) {
      URL.revokeObjectURL(currentTrackUrl);
      currentTrackUrl = null;
    }
  }

  async function loadTrackAtIndex(index, autoplay) {
    if (!state.tracks.length) return;
    if (index < 0) index = state.tracks.length - 1;
    if (index >= state.tracks.length) index = 0;
    const track = state.tracks[index];
    const blob = await getTrackBlob(track.id);
    if (!blob) return;
    releaseTrackUrl();
    currentTrackUrl = URL.createObjectURL(blob);
    audioEl.src = currentTrackUrl;
    playerTrackName.textContent = track.name;
    state.settings.musicIndex = index;
    storageSet({ settings: state.settings });
    renderPlaylist();
    if (autoplay) {
      try { await audioEl.play(); } catch (e) { /* blocked or interrupted */ }
      updatePlayIcon();
    }
  }

  function updatePlayIcon() {
    const playing = !audioEl.paused && !audioEl.ended;
    playIcon.classList.toggle('icon-hidden', playing);
    pauseIcon.classList.toggle('icon-hidden', !playing);
    musicDot.hidden = !playing;
  }

  function updateMuteIcon() {
    volIcon.classList.toggle('icon-hidden', audioEl.muted);
    muteIcon.classList.toggle('icon-hidden', !audioEl.muted);
  }

  playerPlay.addEventListener('click', async () => {
    if (!audioEl.src) {
      if (!state.tracks.length) return;
      await loadTrackAtIndex(state.settings.musicIndex || 0, true);
      return;
    }
    if (audioEl.paused) {
      try { await audioEl.play(); } catch (e) { /* blocked or interrupted */ }
    } else {
      audioEl.pause();
    }
    updatePlayIcon();
  });

  playerNext.addEventListener('click', () => loadTrackAtIndex(state.settings.musicIndex + 1, true));
  playerPrev.addEventListener('click', () => loadTrackAtIndex(state.settings.musicIndex - 1, true));

  audioEl.addEventListener('play', updatePlayIcon);
  audioEl.addEventListener('pause', updatePlayIcon);
  audioEl.addEventListener('ended', () => loadTrackAtIndex(state.settings.musicIndex + 1, true));

  audioEl.addEventListener('loadedmetadata', () => {
    playerDuration.textContent = formatTime(audioEl.duration);
  });

  audioEl.addEventListener('timeupdate', () => {
    if (isSeeking) return;
    playerCurrentTime.textContent = formatTime(audioEl.currentTime);
    if (audioEl.duration) playerSeek.value = (audioEl.currentTime / audioEl.duration) * 100;
  });

  playerSeek.addEventListener('input', () => { isSeeking = true; });
  playerSeek.addEventListener('change', () => {
    if (audioEl.duration) audioEl.currentTime = (playerSeek.value / 100) * audioEl.duration;
    isSeeking = false;
  });

  playerVolume.addEventListener('input', () => {
    audioEl.volume = playerVolume.value / 100;
    state.settings.musicVolume = audioEl.volume;
  });
  playerVolume.addEventListener('change', () => storageSet({ settings: state.settings }));

  playerMute.addEventListener('click', () => {
    audioEl.muted = !audioEl.muted;
    state.settings.musicMuted = audioEl.muted;
    storageSet({ settings: state.settings });
    updateMuteIcon();
  });

  addTracksBtn.addEventListener('click', () => tracksFile.click());

  tracksFile.addEventListener('change', async () => {
    const files = Array.from(tracksFile.files || []);
    if (!files.length) return;
    const wasEmpty = state.tracks.length === 0;
    for (const file of files) {
      const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await saveTrackBlob(id, file);
      state.tracks.push({ id, name: cleanTrackName(file.name) });
    }
    storageSet({ tracks: state.tracks });
    renderPlaylist();
    if (wasEmpty) loadTrackAtIndex(0, false);
    tracksFile.value = '';
  });

  /* ---------------------------------------------------------------------
   * Weather
   * ------------------------------------------------------------------- */
  const weatherChip = document.getElementById('weatherChip');
  const weatherIcon = document.getElementById('weatherIcon');
  const weatherTemp = document.getElementById('weatherTemp');
  const weatherLoc = document.getElementById('weatherLoc');
  const weatherCityInput = document.getElementById('weatherCityInput');
  const weatherCitySave = document.getElementById('weatherCitySave');
  const weatherUseLocation = document.getElementById('weatherUseLocation');
  const weatherHint = document.getElementById('weatherHint');
  const weatherUnitChips = document.querySelectorAll('[data-unit]');

  const WEATHER_CODES = {
    0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'],
    51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
    56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
    61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
    66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
    71: ['❄️', 'Light snow'], 73: ['❄️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['❄️', 'Snow grains'],
    80: ['🌦️', 'Rain showers'], 81: ['🌦️', 'Rain showers'], 82: ['⛈️', 'Violent showers'],
    85: ['🌨️', 'Snow showers'], 86: ['🌨️', 'Snow showers'],
    95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm'], 99: ['⛈️', 'Thunderstorm'],
  };

  function weatherLookup(code, isDay) {
    const entry = WEATHER_CODES[code] || ['🌡️', 'Unknown'];
    if (code === 0 && isDay === 0) return ['🌙', 'Clear'];
    return entry;
  }

  function renderWeatherChip() {
    if (!state.weather) {
      weatherTemp.textContent = 'Set location';
      weatherLoc.textContent = '';
      weatherIcon.textContent = '🌤️';
      return;
    }
    const [icon] = weatherLookup(state.weather.code, state.weather.isDay);
    const unit = state.settings.weatherUnit === 'f' ? '°F' : '°C';
    weatherIcon.textContent = icon;
    weatherTemp.textContent = `${Math.round(state.weather.temp)}${unit}`;
    weatherLoc.textContent = state.settings.weatherLabel || '';
  }

  async function fetchWeatherNow() {
    const { weatherLat: lat, weatherLon: lon, weatherUnit } = state.settings;
    if (lat == null || lon == null) return;
    try {
      const unitParam = weatherUnit === 'f' ? 'fahrenheit' : 'celsius';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&temperature_unit=${unitParam}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.current) {
        state.weather = {
          temp: data.current.temperature_2m,
          code: data.current.weather_code,
          isDay: data.current.is_day,
          fetchedAt: Date.now(),
        };
        storageSet({ weather: state.weather });
        renderWeatherChip();
        weatherHint.textContent = '';
      }
    } catch (e) {
      weatherHint.textContent = 'Could not reach the weather service.';
    }
  }

  async function geocodeAndFetch(cityName) {
    weatherHint.textContent = 'Looking up city…';
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`;
      const res = await fetch(url);
      const data = await res.json();
      const hit = data && data.results && data.results[0];
      if (!hit) {
        weatherHint.textContent = 'City not found — try a different spelling.';
        return;
      }
      state.settings.weatherCity = cityName;
      state.settings.weatherLat = hit.latitude;
      state.settings.weatherLon = hit.longitude;
      state.settings.weatherLabel = [hit.name, hit.country].filter(Boolean).join(', ');
      storageSet({ settings: state.settings });
      await fetchWeatherNow();
    } catch (e) {
      weatherHint.textContent = 'Could not reach the weather service.';
    }
  }

  weatherCitySave.addEventListener('click', () => {
    const v = weatherCityInput.value.trim();
    if (v) geocodeAndFetch(v);
  });
  weatherCityInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); weatherCitySave.click(); }
  });

  weatherUseLocation.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      weatherHint.textContent = 'Location isn\'t available in this browser.';
      return;
    }
    weatherHint.textContent = 'Requesting your location…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        state.settings.weatherLat = pos.coords.latitude;
        state.settings.weatherLon = pos.coords.longitude;
        state.settings.weatherLabel = 'My location';
        state.settings.weatherCity = '';
        weatherCityInput.value = '';
        storageSet({ settings: state.settings });
        await fetchWeatherNow();
      },
      () => { weatherHint.textContent = 'Location permission was denied.'; },
      { timeout: 10000 },
    );
  });

  weatherUnitChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      state.settings.weatherUnit = chip.dataset.unit;
      storageSet({ settings: state.settings });
      applySettingsToDom();
      fetchWeatherNow();
    });
  });

  weatherChip.addEventListener('click', () => {
    if (state.settings.weatherLat != null) fetchWeatherNow();
    else openDrawer('settings');
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

    weatherCityInput.value = state.settings.weatherCity || '';
    weatherUnitChips.forEach((c) => {
      c.classList.toggle('active', c.dataset.unit === state.settings.weatherUnit);
    });
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
    if (!confirm('Reset shortcuts, notes, to-dos, wallpaper, weather and the playlist to defaults?')) return;
    audioEl.pause();
    releaseTrackUrl();
    audioEl.removeAttribute('src');
    await clearAllTrackBlobs();
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    storageSet(state);
    await clearWallpaperBlob();
    hideWallpaperElements();
    renderDials();
    renderTodos();
    renderPlaylist();
    playerTrackName.textContent = 'No track selected';
    notesArea.value = '';
    applySettingsToDom();
    renderWeatherChip();
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

    renderPlaylist();
    audioEl.volume = state.settings.musicVolume;
    audioEl.muted = state.settings.musicMuted;
    playerVolume.value = Math.round(state.settings.musicVolume * 100);
    updateMuteIcon();
    if (state.tracks.length && state.tracks[state.settings.musicIndex]) {
      playerTrackName.textContent = state.tracks[state.settings.musicIndex].name;
    }

    renderWeatherChip();
    if (state.settings.weatherLat != null) {
      const stale = !state.weather || (Date.now() - state.weather.fetchedAt) > 30 * 60 * 1000;
      if (stale) fetchWeatherNow();
      setInterval(fetchWeatherNow, 30 * 60 * 1000);
    }

    tick();
    setInterval(tick, 1000);
    cmdInput.focus();
  }

  init();
})();
