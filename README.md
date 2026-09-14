# Twitch YouTube Song Request

Minimal Song Request backend + web player for Twitch/Streamer.bot.

## Default rules

- minimum 10,000 views
- maximum 8 minutes (480 seconds)
- maximum 20 queued songs
- maximum 4 active requests per user
- only embeddable + syndicated YouTube videos
- YouTube Music category
- duplicate videos are rejected

## Setup

1. Create a YouTube Data API v3 key.
2. Install dependencies and start the server:

```bash
npm install
npm run dev
```

3. Open `http://localhost:3000`, go to the **Bot Settings** tab and paste the key into **API Key**.

The key is stored locally in `data/secrets.json` (not in an `.env` file) and is picked up immediately, no restart needed.

## Streamer.bot flow

For `!sr <query>`:

HTTP POST `http://localhost:3000/api/queue/request`

JSON body:

```json
{
  "query": "<text or YouTube URL>",
  "requestedBy": "<TwitchUsername>"
}
```

The backend automatically detects whether the query is a YouTube URL or a search term, searches YouTube, validates the video, and adds it to the queue or starts playing immediately if the queue is empty.

The web player consumes the queue and automatically starts the next item when YouTube reports `ENDED`.

## Important

YouTube Data API `search.list` cannot directly express an exact 8-minute limit: its duration filters are `<4 min`, `4–20 min`, and `>20 min`. Therefore the implementation searches the 4–20 minute bucket and then applies the exact 480-second limit using `videos.list` duration data.

Views are also checked after search using `videos.list(statistics)`.

## Tech stack

- Backend: Node.js, TypeScript, Express
- Frontend: vanilla JS (no framework/build step), served as static files
- Persistence: local JSON files under `data/` and `cache/` (no database)

## Interface language

The control panel UI supports Russian and English (`public/locales/*.json`, switchable in **Settings → Language**). Backend console logs and API responses are in English.

## License

[MIT](./LICENSE) © choompuy
