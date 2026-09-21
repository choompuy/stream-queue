# StreamQueue

**Self-hosted YouTube song request queue for Twitch streams.** No cloud, no `.env` editing, no config files to hand-edit - everything is set up through a web control panel.

Viewers request songs in Twitch chat (via Streamer.bot), StreamQueue searches YouTube, filters out junk (views/duration/embeddability/region), and plays the queue through an OBS Browser Source overlay. When the queue is empty, a looping fallback YouTube playlist keeps music going between requests.

## Features

- 🎵 **Queue management** - search or paste a YouTube link/URL, duplicate detection, per-user request limits, admin bypass from the control panel
- 🚫 **Blocklist** - ban a track from Activity, Queue, or the fallback list with one click; blocked tracks can't be re-added, and are skipped automatically if they're already queued or come up in the fallback rotation - including the one currently playing
- 🎛 **Web control panel** - dashboard with live queue, play/pause/skip, all settings editable from the UI (API key, filters, overlay options) - nothing to configure by hand
- 📺 **OBS overlay** - a `/overlay` Browser Source that plays the queue and shows a "Now Playing" badge (position + size configurable), with a read-only view for any other device on the network
- 🔁 **Fallback playlist** - pick any YouTube playlist as background/filler music with shuffle and repeat, auto-refreshes to pick up new/removed tracks
- 🤖 **Streamer.bot ready** - REST endpoints for `!sr <query>`, skip/pause/resume, and read-only "now playing" / "queue" chat replies
- 📋 **Saved playlists** - keep a library of playlists and switch the active fallback playlist with one click
- 📈 **Activity log** - see accepted/rejected/failed requests and why (quota, duplicate, blocked, filtered out, playback error, etc.)
- 📱 **LAN access** - QR code + IP picker so you can manage the queue from your phone without typing an address
- 🌍 **RU/EN interface**
- 🖥️ **Windows tray app** _(optional)_ - a small tray icon that starts/stops the server in the background, with "open panel" / "open logs" / "restart" shortcuts, so non-technical streamers don't need a terminal window at all
- 💾 **Local-only storage** - state lives in JSON files on disk (`data/`, `cache/`), nothing leaves your machine except calls to the YouTube Data API

## How it works

```
Twitch chat "!sr never gonna give you up"
        │
        ▼
  Streamer.bot  ──POST──▶  /api/queue/request  ──▶  YouTube Data API (search + filters)
                                                              │
                                                              ▼
                                                     added to the queue
                                                              │
                                                              ▼
                                              OBS Browser Source (/overlay) plays it
```

## Getting started

### Requirements

- [Node.js](https://nodejs.org/) 20+ (22 recommended - matches the packaged build target)
- A [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key (free tier is enough for normal stream traffic)

### Run in development

```bash
git clone https://github.com/choompuy/stream-queue.git
cd stream-queue
npm install
npm run dev
```

The server picks a free port starting at `3000` and opens the control panel in your browser automatically. Go to **Settings → Bot Settings** and paste your YouTube API key - it's saved to `data/secrets.json` immediately, no restart needed.

### Running the tests

```bash
npm test             # backend unit tests (Node's built-in test runner)
npm run test:smoke   # end-to-end smoke test of the control panel UI, headless
```

### Building a standalone Windows build

```bash
npm run build:sea
```

Produces `dist-sea/Service.exe` - a single, self-contained executable (Node bundled in via Node's Single Executable Applications feature). Copy the `public/` folder next to it and it's ready to run standalone; no Node.js installation needed on the target machine.

For a proper double-click, no-terminal-window experience, there's also an optional WinForms tray launcher in `tray/` that starts `Service.exe` in the background and gives you a tray icon with Open panel / Open logs / Restart / Exit. See [`tray/README.md`](tray/README.md) for how to build and assemble it - it wraps `Service.exe`, it doesn't replace it.

Wherever it runs from, `data/`, `cache/`, and `logs/` are created **next to the executable** - the whole folder is self-contained and portable.

## OBS setup

1. Add a **Browser Source** in OBS.
2. Copy the URL from **Settings → Overlay → OBS Browser Source URL** (or scan the QR code from another device on the same network).
3. Recommended size: **362×283**.

The overlay shows the video (optional, toggle in Settings) plus a "Now Playing" badge with title, requester, and progress - position is configurable (all four corners).

## Streamer.bot integration

Point a Streamer.bot HTTP action at your local server for the `!sr` command:

**POST** `http://localhost:<port>/api/queue/request`

```json
{
  "query": "never gonna give you up",
  "requestedBy": "SomeViewer"
}
```

Every response is wrapped as `{ "success": true, "data": { ... } }` on success or `{ "success": false, "error": "...", "code": "..." }` on failure - read the actual payload from `data`. `query` can be a search term or a direct YouTube URL. `data.message` is a ready-to-echo chat line; `data` also tells you whether the track was queued or started playing immediately (`started`, `position`), or the request failed outright (duplicate, queue full, user limit, blocked, filtered out, quota exceeded - see `code`).

Other useful endpoints for chat commands (skip / pause / resume - meant to be gated by Twitch permissions/cooldowns _inside Streamer.bot_, not by this server) and read-only chat replies:

| Action                     | Endpoint                    |
| -------------------------- | --------------------------- |
| Skip current track         | `POST /api/player/skip`     |
| Pause playback             | `POST /api/player/pause`    |
| Resume playback            | `POST /api/player/resume`   |
| "Now playing" chat reply   | `GET /api/chat/now-playing` |
| "What's queued" chat reply | `GET /api/chat/queue`       |

The two `GET /api/chat/*` endpoints return a single `data.message` string already formatted and length-capped for chat - point a `!nowplaying` / `!queue` command straight at them.

## Configuration

Everything below is editable from **Settings → Bot Settings** - no files to touch:

| Setting                      | Default             |
| ---------------------------- | ------------------- |
| Minimum views                | 10,000              |
| Minimum duration             | 60s                 |
| Maximum duration             | 480s (8 min)        |
| Max queue size               | 20                  |
| Max active requests per user | 4                   |
| Region                       | none (unrestricted) |

Only embeddable videos in the YouTube Music category are accepted; duplicates and blocked tracks are rejected. Config updates are all-or-nothing - an invalid field in a request means nothing in that request is applied, and the response names which field(s) were rejected.

## Moderation

Ban a track from its **⋮** menu in Activity, Queue, or the fallback list - it's added to the blocklist, removed if it's currently playing or queued, and can never be re-added or come up in the fallback rotation again until you unblock it from the **Blocklist** tab.

## Data & privacy

StreamQueue is designed to run **locally, on your own machine** - it's not meant to be deployed to a public host. All state (queue, settings, saved playlists, blocklist, YouTube cache) is stored as JSON next to wherever the app is running from (`data/`, `cache/`), git-ignored in this repo. The only outbound network calls are to the YouTube Data API.

## Tech stack

Node.js · TypeScript · Express · vanilla JS (no frontend framework) · YouTube Data API v3 · YouTube IFrame Player API · optional C#/WinForms tray launcher for Windows

## License

[MIT](LICENSE) - © choompuy
