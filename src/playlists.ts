import { dataPath, createFileStore } from './persist.js'
import { createLogger, describeError } from './logger.js'

export type SavedPlaylist = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
  addedAt: number
}

const log = createLogger('PLAYLISTS')
const store = createFileStore<SavedPlaylist[]>(() => dataPath('playlists.json'))

// read from disk on first use, not when the module is imported
let loaded: SavedPlaylist[] | null = null
const current = (): SavedPlaylist[] => (loaded ??= store.load([]))

function save(): void {
  store.scheduleSave(
    () => current(),
    (error) => log.error(`Failed to save: ${describeError(error)}`)
  )
}

export function getPlaylists(): SavedPlaylist[] {
  return [...current()]
}

export function upsertPlaylist(meta: { id: string; title: string; thumbnail: string; itemCount: number }): SavedPlaylist {
  const existing = current().find((p) => p.id === meta.id)

  if (existing) {
    const updated: SavedPlaylist = { ...existing, title: meta.title, thumbnail: meta.thumbnail, itemCount: meta.itemCount }
    loaded = current().map((p) => (p.id === meta.id ? updated : p))
    save()
    return updated
  }

  const created: SavedPlaylist = { ...meta, addedAt: Date.now() }
  current().push(created)
  save()
  return created
}

export function removePlaylist(id: string): boolean {
  const before = current().length
  loaded = current().filter((p) => p.id !== id)

  if (current().length !== before) {
    save()
    return true
  }

  return false
}
