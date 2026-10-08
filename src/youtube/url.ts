export function isValidVideoId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(value)
}

const VIDEO_PATH_KINDS = new Set(['shorts', 'embed', 'v', 'live'])

export function parseYouTubeUrl(input: string): { isYouTube: boolean; videoId: string | null } {
  let url: URL

  try {
    url = new URL(input)
  } catch {
    return { isYouTube: false, videoId: null }
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '')

  const isYouTube = hostname === 'youtube.com' || hostname === 'youtube-nocookie.com' || hostname === 'youtu.be' || hostname === 'music.youtube.com'

  if (!isYouTube) return { isYouTube: false, videoId: null }

  if (hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v')
    return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
  }

  // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>: the whole segment has to be an id, not just its first 11 characters
  const [kind, segment] = url.pathname.split('/').filter(Boolean)
  const id = kind && VIDEO_PATH_KINDS.has(kind) ? segment : undefined
  return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
}

// Only the kinds the playlistItems API can read: user playlists (PL), channel uploads (UU), auto-generated albums (OL).
// Mixes (RD), liked videos (LL) and favourites (FL) answer with an error there
const PLAYLIST_ID_PATTERN = /^(PL|UU|OL)[A-Za-z0-9_-]+$/

export function isValidPlaylistId(value: unknown): value is string {
  return typeof value === 'string' && PLAYLIST_ID_PATTERN.test(value)
}

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  try {
    const url = new URL(trimmed)
    const listParam = url.searchParams.get('list')
    if (listParam) {
      return PLAYLIST_ID_PATTERN.test(listParam) ? listParam : null
    }
    return null
  } catch {
    // not a URL - assume it's already a bare ID
  }

  return PLAYLIST_ID_PATTERN.test(trimmed) ? trimmed : null
}
