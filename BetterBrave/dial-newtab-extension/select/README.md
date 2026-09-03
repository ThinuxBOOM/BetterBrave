# Dial — Custom New Tab

A speed-dial / dashboard replacement for Brave's new tab page, in the spirit of Opera GX's speed dial: a live clock, a quick search bar, a drag-to-reorder shortcut grid, weather, background music, notes, to-dos, a junk cleaner, and a live CPU/RAM monitor — all stored locally and fully yours to re-theme.

## Install (unpacked, for personal use)

Brave doesn't allow installing arbitrary extensions from the Web Store submission flow without review, but loading your own **unpacked** extension is fully supported and is how you'll use this:

1. Open `brave://extensions` in Brave.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder (`gx-dial/`) — the one containing `manifest.json`.
5. Open a new tab. Your dashboard replaces the default page immediately.

If you already had an earlier version loaded, just click the reload icon for it on `brave://extensions` instead of loading it again.

If you ever want another extension's new-tab page back, just disable or remove this one from `brave://extensions`.

## What's included

- **Live clock + date + greeting** — the greeting adapts to time of day, and to an optional name you set in Settings.
- **Command bar** — type a search term or a URL. Picks Brave Search, Google, DuckDuckGo, or Bing per your default (or per-search using the dropdown).
- **Speed dial grid** — click **Add** to create a shortcut (favicon is pulled automatically from the site, with a letter-tile fallback). Hover a tile and click the pencil to edit or delete it. Drag tiles to reorder.
- **Notes drawer** — a persistent scratchpad (bottom-right dock icon).
- **To-do drawer** — a simple checklist (bottom-right dock icon).
- **Music player** — click **Add tracks** to build a playlist from audio files on your device (nothing is streamed from the web). Play/pause, skip, seek, volume, and a dedicated mute toggle. Playback stops if you close that tab — it's not a persistent background service.
- **Weather** — a chip in the top-left corner shows current temperature and conditions. Set it under Settings → Weather, by city or **Use my location**. Data comes from the free, no-key [Open-Meteo](https://open-meteo.com) API and refreshes every 30 minutes.
- **Junk Cleaner** — clears cache, cookies, history, downloads, autofill data, service workers, and storage, scoped to a time window you pick (last hour up to everything). Also lists and closes "stale" tabs you haven't touched in a while, and can optionally auto-sweep (last hour only) each time Brave starts.
- **Resource Monitor** — live system-wide CPU/RAM gauges and an optional auto-suspend limiter that discards your least-recently-used background tabs (never the active, pinned, or audible ones) to keep the browser's footprint down, with a small activity log.
- **Live wallpapers** — under Settings → Background, choose **Image** or **Live video** and pick a file from your computer; a dim-overlay slider keeps everything readable.
- **Settings drawer** — accent theme, background style, default search engine, your name, JSON export/import for shortcuts, and a full reset.

Everything is saved with `chrome.storage.local` or, for larger files (wallpaper video/images, playlist tracks), the browser's local IndexedDB — nothing leaves your machine except the two things noted below.

## Notes on permissions

This version needs considerably more than the original dial-and-notes build, because of the two newest widgets:

- `storage` — saves your shortcuts, notes, to-dos, settings, and (via IndexedDB) wallpaper/playlist files, all locally.
- `system.cpu`, `system.memory` — read by the Resource Monitor to draw the CPU/RAM gauges. These are **system-wide** figures; Brave doesn't expose the browser's own process usage to extensions.
- `tabs` — lets the Resource Monitor list/discard background tabs, and lets the Junk Cleaner count and close stale tabs.
- `alarms`, `notifications` — the Resource Monitor's periodic background check, and the optional "tab suspended" notification.
- `browsingData` — what the Junk Cleaner actually uses to clear cache/cookies/history/downloads/etc. within the time range you choose.
- `history`, `downloads`, `cookies` — used only to show counts in the Junk Cleaner's stats row (how many history items, downloads, cookies you currently have) before you decide what to clear.
- `host_permissions: <all_urls>` — required by the `cookies` API to enumerate/count cookies across every site rather than one at a time.
- A background service worker (`js/background.js`) runs the Resource Monitor's periodic check and the optional auto-sweep on browser startup; it does no network requests of its own.

I read through every line of the Cleaner/Monitor code before merging it in: there's no `fetch`, no remote endpoints, no analytics — everything reads/writes only through the browser's own local extension APIs. That said, `<all_urls>` + `cookies` + `history` is real access, worth knowing about even though nothing here misuses it. If that trade-off isn't worth it for you, the safest fix is to remove the Cleaner/Monitor drawers, their dock buttons, and the `js/cleaner-widget.js` / `js/monitor-widget.js` / `js/resource-helpers.js` / `js/background.js` script tags from `newtab.html`, then trim `manifest.json` back down to just `"permissions": ["storage"]` with no `background` block or `host_permissions` — happy to do that split for you if you'd rather run two lighter extensions instead of one with broad access.

The weather widget makes direct requests to Open-Meteo's public API from the page (no key, no tracking), and — only if you click "Use my location" — asks your browser for location access the same way any website would.

## Customizing further

- Colors and type live at the top of `css/style.css` as CSS variables (`--void`, `--panel`, `--accent-a`, `--accent-b`, fonts) — tweak those, or add another entry to the `body[data-accent="..."]` block and to the `ACCENTS` array in `js/newtab.js` to add a new theme swatch.
- Default starter shortcuts are in `DEFAULT_DIALS` near the top of `js/newtab.js`.
- Icons were generated as simple PNGs in `icons/`; swap them for your own 16/48/128px art if you'd like a different toolbar icon.
