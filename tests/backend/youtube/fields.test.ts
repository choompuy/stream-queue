import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VideoItem } from '../../../src/youtube/types.js'

// updateConfig() saves to data/config.json under the working directory: use a throwaway one, not the real one
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { checkFilters, VIDEO_DETAILS_FIELDS } = await import('../../../src/youtube/filters.js')
const { videoToSong, fetchPlaylistMeta } = await import('../../../src/youtube/mapper.js')
const { fetchVideos } = await import('../../../src/youtube/client.js')
const { searchSongs, fetchPlaylistSongs } = await import('../../../src/youtube/index.js')
const { updateSecrets } = await import('../../../src/secrets.js')
const { updateConfig, getConfig } = await import('../../../src/config.js')
updateSecrets({ youtubeApiKey: 'test-key' })

// ---- YouTube's `fields` syntax, enough of it for the selectors in the code: "a,b/c,d(e,f/g)" ----

type Json = Record<string, unknown>

function splitTop(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '(') depth++
    else if (selector[i] === ')') depth--
    else if (selector[i] === ',' && depth === 0) {
      parts.push(selector.slice(start, i))
      start = i + 1
    }
  }
  parts.push(selector.slice(start))
  return parts
}

// What one term of a selector picks; a path runs through arrays element by element, as YouTube does
function pick(value: unknown, path: string[], sub: string | null): unknown {
  if (Array.isArray(value)) return value.map((item) => pick(item, path, sub))
  if (path.length === 0) return sub === null ? value : project(value, sub)
  if (value === null || typeof value !== 'object' || !(path[0] in (value as Json))) return undefined

  const inner = pick((value as Json)[path[0]], path.slice(1), sub)
  return inner === undefined ? undefined : { [path[0]]: inner }
}

function mergeInto(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((item, i) => mergeInto(item, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Json = { ...(a as Json) }
    for (const [key, value] of Object.entries(b as Json)) out[key] = key in out ? mergeInto(out[key], value) : value
    return out
  }
  return b
}

function project(value: unknown, selector: string): unknown {
  if (Array.isArray(value)) return value.map((item) => project(item, selector))
  if (value === null || typeof value !== 'object') return value

  let out: unknown = {}
  for (const term of splitTop(selector)) {
    const open = term.indexOf('(')
    const path = (open === -1 ? term : term.slice(0, open)).split('/')
    const sub = open === -1 ? null : term.slice(open + 1, term.lastIndexOf(')'))
    const picked = pick(value, path, sub)
    if (picked !== undefined) out = mergeInto(out, picked)
  }
  return out
}

test('the selector language used here', () => {
  const full = { a: 1, b: { c: 2, d: 3, e: { f: 4, g: 5 } }, list: [{ x: 1, y: 2 }, { x: 3, y: 4 }], z: 9 }
  assert.deepEqual(project(full, 'a,b/c,b/e/f,list(x)'), { a: 1, b: { c: 2, e: { f: 4 } }, list: [{ x: 1 }, { x: 3 }] })
  assert.deepEqual(project(full, 'b(c,e/g)'), { b: { c: 2, e: { g: 5 } } })
  assert.deepEqual(project(full, 'missing,a'), { a: 1 })
  // a path through an array keeps the array, and cuts every element
  assert.deepEqual(project({ items: [{ id: { videoId: 'x', k: 1 }, t: 2 }, { id: { videoId: 'y' } }], page: 'p' }, 'items/id/videoId'), { items: [{ id: { videoId: 'x' } }, { id: { videoId: 'y' } }] })
  assert.deepEqual(project({ nextPageToken: 't', items: [{ snippet: { resourceId: { videoId: 'x', kind: 'k' }, title: 'n' } }] }, 'nextPageToken,items/snippet/resourceId/videoId'), { nextPageToken: 't', items: [{ snippet: { resourceId: { videoId: 'x' } } }] })
})

// ---- answers as YouTube sends them: with the description, the tags and the rest nobody here reads ----

const NOISE = {
  etag: 'etag-noise',
  kind: 'youtube#video'
}

function fatVideo(id: string, overrides: Json = {}): VideoItem {
  const base = {
    ...NOISE,
    id,
    snippet: {
      publishedAt: '2024-01-01T00:00:00Z',
      channelId: 'UC1',
      title: `Track ${id}`,
      description: 'A very long description. '.repeat(200),
      channelTitle: 'Some Channel',
      tags: ['tag one', 'tag two'],
      categoryId: '10',
      liveBroadcastContent: 'none',
      localized: { title: `Track ${id}`, description: 'localized description' },
      thumbnails: { default: { url: 'd' }, medium: { url: `https://img/${id}.jpg`, width: 320 }, high: { url: 'h' } }
    },
    contentDetails: { duration: 'PT3M30S', dimension: '2d', definition: 'hd', caption: 'false', licensedContent: true, projection: 'rectangular' },
    status: { uploadStatus: 'processed', privacyStatus: 'public', license: 'youtube', embeddable: true, publicStatsViewable: true, madeForKids: false },
    statistics: { viewCount: '500000', likeCount: '100', commentCount: '5' },
    topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Music'], relevantTopicIds: ['/m/04rlf'] }
  }
  return deepMerge(base, overrides) as unknown as VideoItem
}

function deepMerge(base: Json, extra: Json): Json {
  const out: Json = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    const current = out[key]
    out[key] = current && value && typeof current === 'object' && typeof value === 'object' && !Array.isArray(value) ? deepMerge(current as Json, value as Json) : value
  }
  return out
}

const FIXTURES: Record<string, VideoItem> = {
  music: fatVideo('aaaaaaaaaaa'),
  ageRestricted: fatVideo('bbbbbbbbbbb', { contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } }),
  regionBlocked: fatVideo('ccccccccccc', { contentDetails: { regionRestriction: { blocked: ['DE', 'US'] } } }),
  regionAllowedOnly: fatVideo('ddddddddddd', { contentDetails: { regionRestriction: { allowed: ['JP'] } } }),
  live: fatVideo('eeeeeeeeeee', { snippet: { liveBroadcastContent: 'live' }, contentDetails: { duration: 'P0D' } }),
  upcoming: fatVideo('fffffffffff', { snippet: { liveBroadcastContent: 'upcoming' }, contentDetails: { duration: 'P0D' } }),
  private: fatVideo('ggggggggggg', { status: { privacyStatus: 'private' } }),
  unprocessed: fatVideo('hhhhhhhhhhh', { status: { uploadStatus: 'uploaded' } }),
  notEmbeddable: fatVideo('iiiiiiiiiii', { status: { embeddable: false } }),
  lowViews: fatVideo('jjjjjjjjjjj', { statistics: { viewCount: '5' } }),
  tooLong: fatVideo('kkkkkkkkkkk', { contentDetails: { duration: 'PT1H' } }),
  notMusic: fatVideo('lllllllllll', { snippet: { categoryId: '24' }, topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Gaming'] } }),
  musicByTopicOnly: fatVideo('mmmmmmmmmmm', { snippet: { categoryId: '24' } })
}

test('cutting an answer down by the fields selector changes nothing the code decides', async (t) => {
  const configs = [
    { name: 'defaults', updates: {} },
    { name: 'any content, a region set', updates: { contentMode: 'any', regionCode: 'DE' } }
  ] as const

  for (const { name, updates } of configs) {
    updateConfig(updates as Parameters<typeof updateConfig>[0])
    const config = getConfig()

    for (const [label, raw] of Object.entries(FIXTURES)) {
      await t.test(`${label} (${name})`, () => {
        // the selector is for the whole answer, {items: [...]}, as YouTube applies it
        const cutVideo = (project({ items: [raw] }, VIDEO_DETAILS_FIELDS) as { items: VideoItem[] }).items

        assert.deepEqual(videoToSong(cutVideo[0]), videoToSong(raw))
        for (const guardOnly of [false, true]) {
          const full = checkFilters(videoToSong(raw), raw, config, guardOnly)
          const small = checkFilters(videoToSong(cutVideo[0]), cutVideo[0], config, guardOnly)
          assert.equal(small?.code ?? null, full?.code ?? null)
        }
        // what was cut off is really gone: that is the point of asking
        assert.equal(cutVideo[0].snippet && 'description' in cutVideo[0].snippet, false)
        assert.equal(cutVideo[0].snippet && 'tags' in cutVideo[0].snippet, false)
      })
    }
  }
})

// ---- a YouTube that keeps to what it is asked for ----

type Request = { endpoint: string; params: URLSearchParams }
const requests: Request[] = []
let inFlight = 0
let maxInFlight = 0
let delayFor: (index: number) => number = () => 0

const realFetch = globalThis.fetch

const PLAYLIST_IDS = [FIXTURES.music, FIXTURES.ageRestricted, FIXTURES.live, FIXTURES.lowViews].map((video) => video.id)

function answer(url: URL): unknown {
  const endpoint = url.pathname.split('/').pop()!
  if (endpoint === 'search') {
    return { kind: 'youtube#searchListResponse', etag: 'x', items: [FIXTURES.music, FIXTURES.notEmbeddable].map((video) => ({ kind: 'youtube#searchResult', etag: 'x', id: { kind: 'youtube#video', videoId: video.id }, snippet: { title: 'noise', description: 'noise' } })) }
  }
  if (endpoint === 'playlistItems') {
    const second = url.searchParams.get('pageToken') === 'page2'
    const ids = second ? PLAYLIST_IDS.slice(2) : PLAYLIST_IDS.slice(0, 2)
    return {
      kind: 'youtube#playlistItemListResponse',
      etag: 'x',
      ...(second ? {} : { nextPageToken: 'page2' }),
      pageInfo: { totalResults: PLAYLIST_IDS.length },
      items: ids.map((id) => ({ kind: 'youtube#playlistItem', etag: 'x', id: `item-${id}`, snippet: { title: 'noise', description: 'noise', resourceId: { kind: 'youtube#video', videoId: id } } }))
    }
  }
  if (endpoint === 'playlists') {
    return { items: [{ kind: 'youtube#playlist', id: url.searchParams.get('id'), snippet: { title: 'My Mix', description: 'noise', thumbnails: { medium: { url: 'https://img/mix.jpg' } }, localized: { title: 'noise' } }, contentDetails: { itemCount: 12 } }] }
  }
  // videos: every id asked for that is known, in an order of YouTube's own (reversed here)
  const ids = (url.searchParams.get('id') ?? '').split(',')
  const known = new Map(Object.values(FIXTURES).map((video) => [video.id, video]))
  return { kind: 'youtube#videoListResponse', etag: 'x', items: ids.flatMap((id) => known.get(id) ?? []).reverse() }
}

function installYouTube(): void {
  requests.length = 0
  inFlight = 0
  maxInFlight = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const index = requests.push({ endpoint: url.pathname.split('/').pop()!, params: url.searchParams }) - 1
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, delayFor(index)))
    inFlight--

    const fields = url.searchParams.get('fields')
    const body = answer(url)
    return new Response(JSON.stringify(fields ? project(body, fields) : body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

test('every request names the fields it reads, and the code works on exactly those', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
    delayFor = () => 0
  })
  updateConfig({ contentMode: 'any', regionCode: '' })

  await t.test('a search: ids only, then the videos with their selector', async () => {
    installYouTube()
    const songs = await searchSongs('fields search query one')

    assert.deepEqual(requests.map((r) => r.endpoint), ['search', 'videos'])
    assert.equal(requests[0].params.get('fields'), 'items/id/videoId')
    assert.equal(requests[1].params.get('fields'), VIDEO_DETAILS_FIELDS)
    // the embeddable one is dropped by the filters, as it would be on the full answer
    assert.deepEqual(songs.map((song) => song.videoId), [FIXTURES.music.id])
    assert.equal(songs[0].thumbnail, `https://img/${FIXTURES.music.id}.jpg`)
  })

  await t.test('a playlist: two pages, its videos, its declared size', async () => {
    installYouTube()
    const loaded = await fetchPlaylistSongs('PLaaaaaaaaaaaaaaaa')

    assert.deepEqual(requests.filter((r) => r.endpoint === 'playlistItems').map((r) => r.params.get('fields')), ['nextPageToken,items/snippet/resourceId/videoId', 'nextPageToken,items/snippet/resourceId/videoId'])
    assert.equal(requests.find((r) => r.endpoint === 'playlists')?.params.get('fields'), 'items(id,snippet(title,thumbnails/medium/url),contentDetails/itemCount)')
    assert.equal(loaded.itemCount, 12)
    // the playlist keeps to the guard rules only: the age-restricted one is out, the live and the low-view ones stay
    assert.deepEqual(loaded.songs.map((song) => song.videoId), [FIXTURES.music.id, FIXTURES.live.id, FIXTURES.lowViews.id])
  })

  await t.test('the size of a playlist, alone', async () => {
    installYouTube()
    assert.deepEqual(await fetchPlaylistMeta('PLaaaaaaaaaaaaaaaa'), { id: 'PLaaaaaaaaaaaaaaaa', title: 'My Mix', thumbnail: 'https://img/mix.jpg', itemCount: 12 })
  })
})

test('the batches of a long list go out together, and the order of the list is kept', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
    delayFor = () => 0
  })

  // 120 ids are three batches; the first batch answers last
  const ids = Array.from({ length: 120 }, (_, i) => `id${String(i).padStart(9, '0')}`)
  const known = new Map(ids.map((id) => [id, fatVideo(id)]))
  installYouTube()
  delayFor = (index) => (3 - index) * 25
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const index = requests.push({ endpoint: 'videos', params: url.searchParams }) - 1
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, delayFor(index)))
    inFlight--
    const asked = (url.searchParams.get('id') ?? '').split(',')
    return new Response(JSON.stringify({ items: asked.flatMap((id) => known.get(id) ?? []) }), { status: 200 })
  }) as typeof fetch

  const videos = await fetchVideos(ids)

  assert.equal(requests.length, 3)
  assert.equal(maxInFlight, 3, 'all three were in flight at once')
  assert.deepEqual(videos.map((video) => video.id), ids)
  assert.deepEqual(requests.map((r) => r.params.get('id')!.split(',').length), [50, 50, 20])
})

test('a failing batch fails the whole fetch, as the one-by-one version did', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })

  let n = 0
  globalThis.fetch = (async () => {
    n++
    return n === 2 ? new Response('{}', { status: 400 }) : new Response(JSON.stringify({ items: [] }), { status: 200 })
  }) as typeof fetch

  await assert.rejects(fetchVideos(Array.from({ length: 120 }, (_, i) => `id${String(i).padStart(9, '0')}`)), (error: { code?: string }) => error.code === 'YOUTUBE_ERROR')
})
