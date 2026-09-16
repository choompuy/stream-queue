# StreamQueue

**Self-hosted YouTube song request queue for Twitch streams.** No cloud, no `.env` editing, no config files to hand-edit - everything is set up through a web control panel.

Viewers request songs in Twitch chat (via Streamer.bot), StreamQueue searches YouTube, filters out junk (views/duration/embeddability), and plays the queue through an OBS Browser Source overlay. When the queue is empty, a looping fallback YouTube playlist keeps music going between requests.

## Features

- 🎵 **Queue management** - search or paste a YouTube link/URL, duplicate detection, per-user request limits, admin bypass from the control panel
- 🎛 **Web control panel** - dashboard with live queue, play/pause/skip, all settings editable from the UI (API key, filters, overlay options) - nothing to configure by hand
- 📺 **OBS overlay** - a `/overlay` Browser Source that plays the queue and shows a "Now Playing" badge (position + size configurable), with a read-only view for any other device on the network
- 🔁 **Fallback playlist** - pick any YouTube playlist as background/filler music with shuffle and repeat, auto-refreshes to pick up new/removed tracks
- 🤖 **Streamer.bot ready** - a single REST endpoint handles `!sr <query>`; skip/pause/resume/mod actions hit existing endpoints too
- 📋 **Saved playlists** - keep a library of playlists and switch the active fallback playlist with one click
- 📈 **Activity log** - see accepted/rejected requests and why (quota, duplicate, filtered out, etc.)
- 📱 **LAN access** - QR code + IP picker so you can manage the queue from your phone without typing an address
- 🌍 **RU/EN interface**
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

- [Node.js](https://nodejs.org/) 20+ (22 recommended - matches the packaged `.exe` build target)
- A [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key (free tier is enough for normal stream traffic)

### Run in development

```bash
git clone https://github.com/choompuy/stream-queue.git
cd stream-queue
npm install
npm run dev
```

The server picks a free port starting at `3000` and opens the control panel in your browser automatically. Go to **Settings → Bot Settings** and paste your YouTube API key - it's saved to `data/secrets.json` immediately, no restart needed.

### Build a standalone Windows executable

```bash
npm run build:exe
```

Produces `dist/StreamQueue.exe` - a single file a non-technical streamer can just double-click. No Node.js installation required on the target machine.

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

`query` can be a search term or a direct YouTube URL. The response tells you whether the track was queued, started playing immediately, or rejected (and why - duplicate, queue full, user limit, filtered out, quota exceeded).

Other useful endpoints for chat commands (skip / pause / resume - meant to be gated by Twitch permissions/cooldowns _inside Streamer.bot_, not by this server):

| Action             | Endpoint                  |
| ------------------ | ------------------------- |
| Skip current track | `POST /api/player/skip`   |
| Pause playback     | `POST /api/player/pause`  |
| Resume playback    | `POST /api/player/resume` |

## Configuration

Everything below is editable from **Settings → Bot Settings** - no files to touch:

| Setting                      | Default      |
| ---------------------------- | ------------ |
| Minimum views                | 10,000       |
| Minimum duration             | 60s          |
| Maximum duration             | 480s (8 min) |
| Max queue size               | 20           |
| Max active requests per user | 4            |

Only embeddable videos in the YouTube Music category are accepted; duplicates already in the queue are rejected.

## Data & privacy

StreamQueue is designed to run **locally, on your own machine** - it's not meant to be deployed to a public host. All state (queue, settings, saved playlists, YouTube cache) is stored as JSON under `data/` and `cache/`, both git-ignored. The only outbound network calls are to the YouTube Data API.

## Tech stack

Node.js · TypeScript · Express · vanilla JS (no frontend framework) · YouTube Data API v3 · YouTube IFrame Player API

## License

[MIT](LICENSE) - © choompuy
