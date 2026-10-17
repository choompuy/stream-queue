// Only the kinds the playlistItems API can read: user playlists (PL), channel
// uploads (UU), auto-generated albums (OL). Mixes (RD), liked (LL) and
// favourites (FL) answer with an error there.
const PLAYLIST_ID = /^(?:PL|UU|OL)[\w-]+$/
const VIDEO_KINDS = new Set(['shorts', 'embed', 'v', 'live'])
const HOSTS = new Set(['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'music.youtube.com'])
// YouTube hosts written without a scheme: "youtu.be/ID", "www.youtube.com/watch?v=ID", …
const SCHEMELESS = /^(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\//

export function isValidVideoId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value)
}

export function isValidPlaylistId(value: unknown): value is string {
  return typeof value === 'string' && PLAYLIST_ID.test(value)
}

/** Parses input as a URL, prepending https:// to scheme-less YouTube hosts. Null if not a URL. */
function toUrl(input: string): URL | null {
  const s = input.trim()
  try {
    return new URL(SCHEMELESS.test(s.toLowerCase()) ? `https://${s}` : s)
  } catch {
    return null
  }
}

export function parseYouTubeUrl(input: string): { isYouTube: boolean; videoId: string | null } {
  const url = toUrl(input)
  if (!url) return { isYouTube: false, videoId: null }

  const host = url.hostname.replace(/^(?:www\.|m\.)+/, '')
  if (!HOSTS.has(host)) return { isYouTube: false, videoId: null }

  // youtu.be/<id> · /watch?v=<id> · /shorts|embed|v|live/<id> — segment must be the whole id
  const [kind, segment] = url.pathname.split('/').filter(Boolean)
  const id = host === 'youtu.be' ? kind : kind === 'watch' ? url.searchParams.get('v') : VIDEO_KINDS.has(kind) ? segment : null

  return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
}

export function parsePlaylistId(input: string): string | null {
  const s = input.trim()
  const list = toUrl(s)?.searchParams.get('list')
  // if s was a URL, it can't match PLAYLIST_ID, so the fallback only fires for bare IDs
  return isValidPlaylistId(list) ? list : isValidPlaylistId(s) ? s : null
}
