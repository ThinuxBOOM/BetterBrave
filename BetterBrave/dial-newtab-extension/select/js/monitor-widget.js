(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const DEFAULT_SETTINGS = {
    maxTabs: 0,
    minFreeMemPercent: 0,
    autoDiscardEnabled: false,
    notifyOnDiscard: true,
  };

  function ringColor(pct) {
    if (pct >= 85) return 'var(--danger)';
    if (pct >= 60) return 'var(--warn)';
    return 'var(--ok)';
  }

  function setGauge(ringEl, valEl, pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    ringEl.style.setProperty('--pct', clamped.toFixed(0));
    ringEl.style.setProperty('--ring-color', ringColor(clamped));
    valEl.textContent = `${clamped.toFixed(0)}%`;
  }

  function bytesToGB(bytes) {
    return (bytes / 1024 ** 3).toFixed(1);
  }

  async function refreshReading() {
    const [cpuPercent, mem, tabs] = await Promise.all([
      sampleSystemCpuPercent(150),
      readSystemMemory(),
      chrome.tabs.query({}),
    ]);

    setGauge($('mon-cpu-ring'), $('mon-cpu-val'), cpuPercent);
    setGauge($('mon-mem-ring'), $('mon-mem-val'), mem.usedPercent);

    $('mon-mem-detail').textContent =
      `${bytesToGB(mem.capacity - mem.availableCapacity)} GB used of ${bytesToGB(mem.capacity)} GB`;

    $('mon-stat-tabs').textContent = tabs.length;
    $('mon-stat-discarded').textContent = tabs.filter((t) => t.discarded).length;
    $('mon-stat-updated').textContent = 'now';
  }

  function labelMaxTabs(v) { return v === 0 ? 'Off' : String(v); }
  function labelMinFreeMem(v) { return v === 0 ? 'Off' : `${v}%`; }

  async function loadSettings() {
    const stored = await chrome.storage.local.get('monitorSettings');
    return { ...DEFAULT_SETTINGS, ...(stored.monitorSettings || {}) };
  }

  async function saveSettings(patch) {
    const current = await loadSettings();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ monitorSettings: next });
    return next;
  }

  function initSettingsUI(settings) {
    const autoToggle = $('mon-auto-toggle');
    const maxTabs = $('mon-max-tabs');
    const maxTabsVal = $('mon-max-tabs-val');
    const minFreeMem = $('mon-min-free-mem');
    const minFreeMemVal = $('mon-min-free-mem-val');
    const notifyToggle = $('mon-notify-toggle');

    autoToggle.checked = settings.autoDiscardEnabled;
    maxTabs.value = settings.maxTabs;
    maxTabsVal.textContent = labelMaxTabs(settings.maxTabs);
    minFreeMem.value = settings.minFreeMemPercent;
    minFreeMemVal.textContent = labelMinFreeMem(settings.minFreeMemPercent);
    notifyToggle.checked = settings.notifyOnDiscard;

    autoToggle.addEventListener('change', () => {
      saveSettings({ autoDiscardEnabled: autoToggle.checked });
    });
    maxTabs.addEventListener('input', () => {
      maxTabsVal.textContent = labelMaxTabs(Number(maxTabs.value));
    });
    maxTabs.addEventListener('change', () => {
      saveSettings({ maxTabs: Number(maxTabs.value) });
    });
    minFreeMem.addEventListener('input', () => {
      minFreeMemVal.textContent = labelMinFreeMem(Number(minFreeMem.value));
    });
    minFreeMem.addEventListener('change', () => {
      saveSettings({ minFreeMemPercent: Number(minFreeMem.value) });
    });
    notifyToggle.addEventListener('change', () => {
      saveSettings({ notifyOnDiscard: notifyToggle.checked });
    });
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  async function renderLog() {
    const stored = await chrome.storage.local.get('monitorRecentActions');
    const actions = stored.monitorRecentActions || [];
    const list = $('mon-log-list');
    if (actions.length === 0) {
      list.innerHTML = '<li class="log-empty">Nothing suspended yet.</li>';
      return;
    }
    list.innerHTML = actions
      .slice(0, 8)
      .map((a) => `<li><span>${a.message}</span><span class="time">${timeAgo(a.time)}</span></li>`)
      .join('');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const settings = await loadSettings();
    initSettingsUI(settings);

    const drawer = document.getElementById('monitorDrawer');
    const isOpen = () => drawer.classList.contains('open');

    // Only poll while the drawer is actually open — this tab can stay
    // open all day, so there's no point sampling CPU in the background.
    let wasOpen = false;
    const maybeRefresh = async () => {
      if (!isOpen()) return;
      await refreshReading();
      await renderLog();
    };

    new MutationObserver(() => {
      const open = isOpen();
      if (open && !wasOpen) maybeRefresh();
      wasOpen = open;
    }).observe(drawer, { attributes: true, attributeFilter: ['class'] });

    setInterval(maybeRefresh, 5000);
  });
})();
