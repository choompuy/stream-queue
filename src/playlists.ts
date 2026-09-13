import { PLAYLISTS_PATH, createFileStore } from './persist.js'

export type SavedPlaylist = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
  addedAt: number
}

const store = createFileStore<SavedPlaylist[]>(PLAYLISTS_PATH)
let playlists: SavedPlaylist[] = store.load([])

function save(): void {
  store.scheduleSave(
    () => playlists,
    (error) => console.error('[PLAYLISTS] Failed to save:', error instanceof Error ? error.message : error)
  )
}

export function getPlaylists(): SavedPlaylist[] {
  return [...playlists]
}

export function upsertPlaylist(meta: { id: string; title: string; thumbnail: string; itemCount: number }): SavedPlaylist {
  const existing = playlists.find((p) => p.id === meta.id)

  if (existing) {
    existing.title = meta.title
    existing.thumbnail = meta.thumbnail
    existing.itemCount = meta.itemCount
    save()
    return existing
  }

  const created: SavedPlaylist = { ...meta, addedAt: Date.now() }
  playlists.push(created)
  save()
  return created
}

export function removePlaylist(id: string): boolean {
  const before = playlists.length
  playlists = playlists.filter((p) => p.id !== id)

  if (playlists.length !== before) {
    save()
    return true
  }

  return false
}
