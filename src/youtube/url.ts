export function isValidVideoId(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{11}$/.test(value))
}

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

  const isYouTube = hostname === 'youtube.com' || hostname === 'youtube-nocookie.com' || hostname === 'youtu.be'

  if (!isYouTube) return { isYouTube: false, videoId: null }

  if (hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v')
    return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
  }

  const pathMatch = url.pathname.match(/^\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/)
  return { isYouTube: true, videoId: pathMatch ? pathMatch[1] : null }
}

const PLAYLIST_ID_PATTERN = /^(PL|RD|UU|LL|FL|OL)[A-Za-z0-9_-]+$/

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
    // не URL - считаем, что это уже голый ID
  }

  return PLAYLIST_ID_PATTERN.test(trimmed) ? trimmed : null
}
