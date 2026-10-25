# StreamQueue

**Self-hosted YouTube song request queue for Twitch streams.** No cloud, no `.env` editing, no config files to hand-edit - everything is set up through a web control panel.

Viewers request songs with a Channel Points reward (a title or a YouTube link typed into the reward), StreamQueue searches YouTube, filters out unwanted videos, manages the queue, and plays it through an OBS Browser Source overlay. Chat commands show what is playing and let moderators skip, pause and resume. When the queue is empty, a fallback YouTube playlist keeps music going between requests.

## Features

- 🎵 **Song request queue** - search YouTube or paste a video URL, duplicate detection, per-user request limits, queue size limits, and admin controls
- 📺 **Native Twitch integration** - connect Twitch directly from the control panel without Streamer.bot; configurable chat commands, permissions, cooldowns, and Channel Points redemptions
- 🎁 **Channel Points rewards** - create and edit request rewards, configure cost/limits/cooldowns/color, select the reward used for song requests, and control automatic fulfillment
- 🚫 **Blocklist** - block tracks from Activity, Queue, or the fallback list; blocked tracks cannot be re-added and are skipped automatically
- 🎛 **Web control panel** - live queue, playback controls, fallback playlist, Twitch settings, filters, overlay options, blocklist, activity, and configuration
- 📺 **OBS overlay** - a `/overlay` Browser Source that plays the queue and shows a compact Now Playing badge with configurable position and size
- 🔁 **Fallback playlist** - use any YouTube playlist as background music with shuffle and repeat, with automatic refresh; up to 250 tracks are loaded and kept on disk, and the panel shows how many of the playlist's tracks made it in
- 📋 **Saved playlists** - keep a library of playlists and switch the active fallback playlist from the control panel
- 📈 **Activity log** - see accepted, rejected, blocked, and failed requests with structured failure reasons
- 📱 **LAN access** - QR code and local network access for managing the queue from another device; the API key and the Twitch connection can be changed only on the computer that runs StreamQueue
- 🌍 **RU/EN interface**
- 🖥️ **Windows standalone build** - packaged `Service.exe` runs without Node.js installed; optional .NET 10 WinForms tray launcher provides a normal double-click workflow
- 💾 **Local storage** - queue, settings, playlists, blocklist, and the loaded fallback playlist stay on disk next to the application
- ⚡ **Real-time updates** - Server-Sent Events (SSE) push live queue and playback changes to the control panel without polling
- 🧠 **In-memory caching** - YouTube API responses cached in memory (search results for 24 hours) for faster searches and reduced quota usage
- 🔔 **Problem notices** - the Windows tray launcher shows what the server reports about itself (startup failure, busy port, missing files, lost Twitch connection) and confirms a restart
- 🔒 **Hardened reliability** - robust error handling, startup recovery, and state persistence for critical components

## How it works

```text
Twitch chat / Channel Points
          │
          ▼
   Native Twitch integration
          │
          ▼
   StreamQueue request handling
          │
          ▼
   YouTube Data API ── search + filters ──▶ queue
                                           │
                                           ▼
                              OBS Browser Source (/overlay)
```

## Getting started

### Windows release

The easiest way to run StreamQueue on Windows is the standalone ZIP release.

1. Download the latest release ZIP from GitHub Releases.
2. Extract it to a folder.
3. Run `Service.exe` or the optional `StreamQueue.exe` tray launcher.
4. Open the control panel shown by the application.
5. Go to **Settings** and add your YouTube Data API key.
6. Connect Twitch from the **Twitch** settings.
7. Add the StreamQueue `/overlay` URL as an OBS Browser Source.

The packaged build includes the Twitch client ID, so the released Windows build does not require you to create or enter a Twitch client secret.

The application is portable: `data/` (with its `logs/` folder) is created next to the executable. No Node.js installation is required.

### Requirements for development

- [Node.js](https://nodejs.org/) 24+
- A [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) on Windows if you want to build the optional tray launcher
- A [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key

### Run in development

```bash
git clone https://github.com/choompuy/stream-queue.git
cd stream-queue
npm install
npm run dev
```

The server uses port `4747`; if it is busy, the next free port is taken and remembered, so the overlay link stays the same afterwards. To pick another port, edit `data/server.json`. Configure the YouTube API key from the web control panel; it is stored locally and takes effect without a restart.

### Build the standalone Windows executable

```bash
npm run build:sea
```

This produces `dist-sea/Service.exe`, a self-contained Node.js Single Executable Application. `npm run build:release` goes one step further and assembles the `release/` folder (exe with icon and version on Windows, `public/`, license) that is ready to run or to zip. Node.js 24 or newer is needed to build.

For a no-terminal-window experience, build the optional .NET 10 WinForms tray launcher in `tray/`. It starts and stops the service in the background, provides shortcuts for opening the panel and the application folder, restarting the server (a balloon confirms it is back up), and exiting, and shows the problems the server reports about itself.

To build the tray launcher:

```bash
cd tray
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

The tray launcher is self-contained, so the published executable does not require a separate .NET runtime installation.

### Running the tests

```bash
npm test
npm run test:smoke
```

## OBS setup

1. Add a **Browser Source** in OBS.
2. Copy the URL from **Settings → Overlay → OBS Browser Source URL**.
3. Set the Browser Source size to match your overlay layout. **362×283** is a reasonable starting size.

The overlay can show the current video plus a compact Now Playing badge containing the title, requester, and progress. Its position can be configured in the control panel.

## Twitch integration

StreamQueue can connect directly to Twitch without requiring Streamer.bot.

From the control panel you can:

- connect and disconnect a Twitch account;
- configure chat commands for now-playing and queue information, skip, pause, and resume;
- configure command permissions and cooldowns;
- create and edit Channel Points rewards;
- select which configured reward creates song requests;
- configure reward limits, cooldowns, cost, color, and automatic fulfillment;
- receive request and playback status messages directly in Twitch chat.

The released Windows build contains the Twitch client ID. Twitch OAuth tokens are stored locally with the rest of the application state.

## Request flow

A viewer requests a song by redeeming the Channel Points reward you selected in the Twitch settings and typing a title or a YouTube link into it. You can also add songs from the control panel (search or URL).

StreamQueue searches YouTube, validates the result against the configured filters, and either adds it to the queue or starts playback when the queue is empty. The viewer gets a message in Twitch chat, and if the request is rejected the points are returned.

Requests can be rejected for reasons such as duplicate tracks, queue limits, user limits, blocked videos, invalid/unavailable videos, duration/view filters, or YouTube API quota limits. When YouTube reports that the daily API quota is used up, StreamQueue says so and stops sending requests until it resets (midnight Pacific Time). Responses are localized and include a structured failure reason for the control panel and integrations.

Chat commands are for information and control. By default:

```text
!sg now       what is playing        (everyone)
!sg queue     what is coming up      (everyone)
!sg skip      skip the current track (moderators)
!sg pause     pause playback         (moderators)
!sg resume    resume playback        (moderators)
```

Names, permissions and cooldowns are editable in the Twitch settings.

## Configuration

Most configuration is editable from the web control panel.

| Setting                      | Default                   |
| ---------------------------- | ------------------------- |
| Minimum views                | 10,000                    |
| Minimum duration             | 60s                       |
| Maximum duration             | 480s (8 min)              |
| Max queue size               | 20 (0 = unlimited)        |
| Max active requests per user | 4 (0 = unlimited)         |
| Region                       | none                      |
| Allow live streams           | disabled                  |
| Content                      | music only                |
| Fallback playlist            | none until configured     |

YouTube requests are restricted to music videos by default (a setting accepts any video), embeddable and syndicated, with additional validation for duration, availability, and other configured filters. Tracks of your own fallback playlist are checked only for availability (public, embeddable, region, age), not against these viewer filters.

Configuration updates support field-level validation: valid values can be saved even when another submitted field is rejected.

## Moderation

Use the **Blocklist** controls from Activity, Queue, or fallback entries to block a track.

Blocked tracks are:

- rejected when requested again;
- removed from the active queue when applicable;
- skipped when encountered during fallback playback;
- prevented from being selected again until they are unblocked.

The activity log records block and playback events so moderation actions remain visible after the fact.

## Playback and fallback reliability

StreamQueue handles common playback failures without leaving the queue in a stuck state.

- Player failures are reported with the affected video.
- Duplicate failure reports are ignored.
- Failed fallback tracks can advance to another track.
- Blocked tracks are skipped during playback.
- Playback and queue state are persisted locally.
- The overlay reports player errors back to the local service.

## Data & privacy

StreamQueue is designed to run locally on your own machine.

Application state is stored as JSON next to the executable:

```text
data/
  config.json
  settings.json
  server.json
  twitch-config.json
  playlists.json
  blocklist.json
  activity.json
  queue-state.json
  fallback-tracks.json
  secrets.json
  logs/
    app.log
```

Your YouTube API key and Twitch OAuth state are stored locally. The application communicates with external services only when needed for its integrations, primarily the YouTube Data API and Twitch APIs.

## Tech stack

Node.js · TypeScript · Express · vanilla JavaScript · Server-Sent Events (SSE) · YouTube Data API v3 · YouTube IFrame Player API · Twitch APIs · Twitch EventSub WebSocket · optional C#/WinForms tray launcher for Windows (.NET 10)

## License

[MIT](LICENSE) - © choompuy
