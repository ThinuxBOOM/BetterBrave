(() => {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  const LEVEL_SINCE = {
    hour: () => Date.now() - HOUR,
    week: () => Date.now() - 7 * 24 * HOUR,
    month: () => Date.now() - 28 * 24 * HOUR,
    all: () => 0,
  };

  const $ = (id) => document.getElementById(id);
  let selectedLevel = 'week';

  async function loadStats() {
    try {
      const tabs = await chrome.tabs.query({});
      $('cln-stat-tabs').textContent = tabs.length;
    } catch { $('cln-stat-tabs').textContent = '–'; }

    try {
      const items = await chrome.history.search({
        text: '',
        startTime: Date.now() - 7 * 24 * HOUR,
        maxResults: 100000,
      });
      $('cln-stat-history').textContent = items.length;
    } catch { $('cln-stat-history').textContent = '–'; }

    try {
      const downloads = await chrome.downloads.search({});
      $('cln-stat-downloads').textContent = downloads.length;
    } catch { $('cln-stat-downloads').textContent = '–'; }

    try {
      const cookies = await chrome.cookies.getAll({});
      $('cln-stat-cookies').textContent = cookies.length;
    } catch { $('cln-stat-cookies').textContent = '–'; }
  }

  function initLevels() {
    const buttons = document.querySelectorAll('#cln-levels .level');
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.level === selectedLevel);
      btn.addEventListener('click', () => {
        selectedLevel = btn.dataset.level;
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  }

  function initChecks() {
    const toggleBtn = $('cln-toggle-all');
    const boxes = () => Array.from(document.querySelectorAll('#cln-checks input'));
    toggleBtn.addEventListener('click', () => {
      const all = boxes();
      const allChecked = all.every((b) => b.checked);
      all.forEach((b) => (b.checked = !allChecked));
      toggleBtn.textContent = allChecked ? 'Select all' : 'Deselect all';
    });
  }

  function getSelectedDataTypes() {
    const boxes = Array.from(document.querySelectorAll('#cln-checks input:checked'));
    const dataTypes = {};
    boxes.forEach((b) => (dataTypes[b.value] = true));
    return dataTypes;
  }

  async function runClean() {
    const dataTypes = getSelectedDataTypes();
    const keys = Object.keys(dataTypes);
    if (keys.length === 0) {
      $('cln-result').textContent = 'Pick at least one category first.';
      return;
    }

    const btn = $('cln-clean-btn');
    const label = $('cln-clean-btn-label');
    btn.disabled = true;
    label.textContent = 'Cleaning…';
    $('cln-result').textContent = '';

    try {
      await chrome.browsingData.remove({ since: LEVEL_SINCE[selectedLevel]() }, dataTypes);
      $('cln-result').textContent = `Cleared ${keys.length} categor${keys.length === 1 ? 'y' : 'ies'} — done.`;
      await loadStats();
    } catch (err) {
      $('cln-result').textContent = 'Something went wrong: ' + err.message;
    } finally {
      btn.disabled = false;
      label.textContent = 'Clean now';
    }
  }

  function initStaleSlider() {
    const slider = $('cln-stale-threshold');
    const val = $('cln-stale-threshold-val');
    const update = () => { val.textContent = `${slider.value}h`; };
    slider.addEventListener('input', update);
    update();
    refreshStaleCount();
    slider.addEventListener('change', refreshStaleCount);
  }

  async function getStaleTabs() {
    const thresholdMs = Number($('cln-stale-threshold').value) * HOUR;
    const cutoff = Date.now() - thresholdMs;
    const tabs = await chrome.tabs.query({});
    return tabs.filter((t) => {
      if (t.pinned || t.audible || t.active) return false;
      if (typeof t.lastAccessed !== 'number') return false;
      return t.lastAccessed < cutoff;
    });
  }

  async function refreshStaleCount() {
    try {
      const stale = await getStaleTabs();
      $('cln-stale-count').textContent = stale.length;
    } catch { $('cln-stale-count').textContent = '0'; }
  }

  async function closeStaleTabs() {
    const btn = $('cln-close-stale-btn');
    btn.disabled = true;
    try {
      const stale = await getStaleTabs();
      if (stale.length === 0) {
        $('cln-result').textContent = 'No stale tabs at this threshold.';
      } else {
        await chrome.tabs.remove(stale.map((t) => t.id));
        $('cln-result').textContent = `Closed ${stale.length} stale tab${stale.length === 1 ? '' : 's'}.`;
      }
      await loadStats();
      await refreshStaleCount();
    } catch (err) {
      $('cln-result').textContent = "Couldn't close tabs: " + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function initAutoSweep() {
    const toggle = $('cln-auto-sweep-toggle');
    const stored = await chrome.storage.local.get('cleanerAutoSweepEnabled');
    toggle.checked = Boolean(stored.cleanerAutoSweepEnabled);
    toggle.addEventListener('change', async () => {
      await chrome.storage.local.set({
        cleanerAutoSweepEnabled: toggle.checked,
        cleanerAutoSweepCategories: getSelectedDataTypes(),
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLevels();
    initChecks();
    initStaleSlider();
    initAutoSweep();
    loadStats();

    $('cln-clean-btn').addEventListener('click', runClean);
    $('cln-close-stale-btn').addEventListener('click', closeStaleTabs);
  });
})();
