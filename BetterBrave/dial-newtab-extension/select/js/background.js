importScripts("resource-helpers.js");

const ALARM_NAME = "resource-check";
const HOUR = 60 * 60 * 1000;
const MAX_ACTIONS = 15;

const DEFAULT_MONITOR_SETTINGS = {
  maxTabs: 0, // 0 = off
  minFreeMemPercent: 0, // 0 = off
  autoDiscardEnabled: false,
  notifyOnDiscard: true,
};

/* ---------------------------------------------------------------------
 * Junk Cleaner: safety-scoped auto-sweep (last hour only) on startup
 * ------------------------------------------------------------------- */
async function runAutoSweep() {
  const stored = await chrome.storage.local.get([
    "cleanerAutoSweepEnabled",
    "cleanerAutoSweepCategories",
  ]);
  if (!stored.cleanerAutoSweepEnabled) return;

  const dataTypes = stored.cleanerAutoSweepCategories || { cache: true, cookies: true };
  if (Object.keys(dataTypes).length === 0) return;

  try {
    await chrome.browsingData.remove({ since: Date.now() - HOUR }, dataTypes);
  } catch (err) {
    console.error("Junk Cleaner auto-sweep failed:", err);
  }
}

/* ---------------------------------------------------------------------
 * Resource Monitor: periodic system-load check + auto-discard limiter
 * ------------------------------------------------------------------- */
async function logMonitorAction(message) {
  const stored = await chrome.storage.local.get("monitorRecentActions");
  const actions = stored.monitorRecentActions || [];
  actions.unshift({ time: Date.now(), message });
  await chrome.storage.local.set({ monitorRecentActions: actions.slice(0, MAX_ACTIONS) });
}

async function tick() {
  const [cpuPercent, mem, tabs, stored] = await Promise.all([
    sampleSystemCpuPercent(150),
    readSystemMemory(),
    chrome.tabs.query({}),
    chrome.storage.local.get("monitorSettings"),
  ]);

  const settings = { ...DEFAULT_MONITOR_SETTINGS, ...(stored.monitorSettings || {}) };

  await chrome.storage.local.set({
    monitorLatestReading: {
      time: Date.now(),
      cpuPercent,
      memUsedPercent: mem.usedPercent,
      memCapacity: mem.capacity,
      memAvailable: mem.availableCapacity,
      tabCount: tabs.length,
    },
  });

  if (!settings.autoDiscardEnabled) return;

  const picks = pickTabsToDiscard(tabs, settings, mem.usedPercent);
  for (const tab of picks) {
    try {
      await chrome.tabs.discard(tab.id);
      const title = (tab.title || tab.url || "a tab").slice(0, 40);
      await logMonitorAction(`Suspended "${title}"`);
    } catch (err) {
      // Tab may have closed or already be discarded — ignore.
    }
  }

  if (picks.length > 0 && settings.notifyOnDiscard) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "Resource Monitor",
      message: `Suspended ${picks.length} background tab${picks.length === 1 ? "" : "s"} to stay under your limits.`,
      priority: 0,
    });
  }
}

/* ---------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  tick();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  tick();
  runAutoSweep();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) tick();
});
