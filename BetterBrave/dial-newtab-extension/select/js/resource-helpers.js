// Shared helpers for reading system load and deciding which tabs to
// suspend. Loaded by js/background.js (via importScripts) and by
// newtab.html (via <script>) for the Resource Monitor widget.

/**
 * Takes two chrome.system.cpu.getInfo() snapshots `intervalMs` apart and
 * returns the average CPU usage across all cores as a 0-100 percentage.
 * This is SYSTEM-WIDE usage (everything running on the machine), not just
 * the browser's own usage — Chromium/Brave doesn't expose per-browser CPU
 * accounting to extensions.
 */
async function sampleSystemCpuPercent(intervalMs = 200) {
  const a = await chrome.system.cpu.getInfo();
  await new Promise((r) => setTimeout(r, intervalMs));
  const b = await chrome.system.cpu.getInfo();

  let busyDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < a.processors.length && i < b.processors.length; i++) {
    const u1 = a.processors[i].usage;
    const u2 = b.processors[i].usage;
    busyDelta += (u2.user - u1.user) + (u2.kernel - u1.kernel);
    totalDelta += u2.total - u1.total;
  }
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (busyDelta / totalDelta) * 100));
}

/**
 * Reads system-wide memory capacity/availability. Again: system-wide, not
 * browser-specific — there's no public extension API for "how much RAM is
 * Brave itself using".
 */
async function readSystemMemory() {
  const info = await chrome.system.memory.getInfo();
  const usedPercent = ((info.capacity - info.availableCapacity) / info.capacity) * 100;
  return {
    capacity: info.capacity,
    availableCapacity: info.availableCapacity,
    usedPercent,
  };
}

/**
 * Given the current tabs and settings, decides which background tabs to
 * suspend (chrome.tabs.discard) this tick. Never touches pinned, active,
 * audible, or already-discarded tabs. Returns the list of tabs chosen.
 */
function pickTabsToDiscard(tabs, settings, memUsedPercent) {
  const eligible = tabs.filter(
    (t) => !t.pinned && !t.active && !t.audible && !t.discarded
  );
  eligible.sort((x, y) => (x.lastAccessed || 0) - (y.lastAccessed || 0));

  const picks = [];
  const maxPerTick = 5;

  if (settings.maxTabs > 0 && tabs.length > settings.maxTabs) {
    const excess = tabs.length - settings.maxTabs;
    picks.push(...eligible.slice(0, Math.min(excess, maxPerTick)));
  }

  if (
    settings.minFreeMemPercent > 0 &&
    100 - memUsedPercent < settings.minFreeMemPercent
  ) {
    for (const t of eligible) {
      if (picks.length >= maxPerTick) break;
      if (!picks.includes(t)) picks.push(t);
    }
  }

  return picks;
}
