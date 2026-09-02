# Dial — Custom New Tab

A speed-dial / dashboard replacement for Brave's new tab page, in the spirit of Opera GX's speed dial: a live clock, a quick search bar, a drag-to-reorder shortcut grid, plus notes and to-do drawers — all stored locally and fully yours to re-theme.

## Install (unpacked, for personal use)

Brave doesn't allow installing arbitrary extensions from the Web Store submission flow without review, but loading your own **unpacked** extension is fully supported and is how you'll use this:

1. Open `brave://extensions` in Brave.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder (`gx-dial/`) — the one containing `manifest.json`.
5. Open a new tab. Your dashboard replaces the default page immediately.

If you ever want another extension's new-tab page back, just disable or remove this one from `brave://extensions`.

## What's included

- **Live clock + date + greeting** — the greeting adapts to time of day, and to an optional name you set in Settings.
- **Command bar** — type a search term or a URL. Picks Brave Search, Google, DuckDuckGo, or Bing per your default (or per-search using the dropdown).
- **Speed dial grid** — click **Add** to create a shortcut (favicon is pulled automatically from the site, with a letter-tile fallback). Hover a tile and click the pencil to edit or delete it. Drag tiles to reorder.
- **Notes drawer** — a persistent scratchpad (bottom-right dock icon).
- **To-do drawer** — a simple checklist (bottom-right dock icon).
- **Settings drawer** — pick an accent theme (magenta/cyan, lime/cyan, sunset, violet), a background style, your default search engine, and your name. Also export/import your shortcuts as JSON, or reset everything to defaults.
- **Live wallpapers** — under Background, choose **Image** or **Live video** and pick a file from your computer. Video loops silently behind the dashboard (like a Wallpaper Engine background); a dim-overlay slider keeps the clock and tiles readable over busy footage. The file is stored locally in the browser's IndexedDB (not `chrome.storage`, since videos can be large) and reloads automatically next time you open a new tab.

Everything is saved with `chrome.storage.local`, so it persists across restarts and stays local to your browser — nothing is sent anywhere.

## Customizing further

- Colors and type live at the top of `css/style.css` as CSS variables (`--void`, `--panel`, `--accent-a`, `--accent-b`, fonts) — tweak those, or add another entry to the `body[data-accent="..."]` block and to the `ACCENTS` array in `js/newtab.js` to add a new theme swatch.
- Default starter shortcuts are in `DEFAULT_DIALS` near the top of `js/newtab.js`.
- Icons were generated as simple PNGs in `icons/`; swap them for your own 16/48/128px art if you'd like a different toolbar icon.

## Notes on permissions

The extension requests only the `storage` permission, used solely to save your shortcuts, notes, to-dos, and settings on your own machine.
