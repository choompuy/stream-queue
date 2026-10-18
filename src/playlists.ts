import { dataPath, createFileStore, loadList } from './persist.js'
import { createStore } from './store.js'
import { onConfigChange } from './config.js'
import { emit } from './state-events.js'

export type SavedPlaylist = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
  addedAt: number
}

const store = createFileStore<SavedPlaylist[]>(() => dataPath('playlists.json'))

// a saved playlist as the panel gets it: with the answer whether it is the one that is played
export type PlaylistEntry = SavedPlaylist & { isActive: boolean }

function isSavedPlaylist(value: unknown): value is SavedPlaylist {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>

  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.title === 'string' &&
    typeof v.thumbnail === 'string' &&
    Number.isFinite(v.itemCount) &&
    Number.isFinite(v.addedAt)
  )
}

// read from disk on first use, not when the module is imported
let loaded: SavedPlaylist[] | null = null
const current = (): SavedPlaylist[] => (loaded ??= loadList(store, isSavedPlaylist))

const changes = createStore({
  read: current,
  topics: ['playlists'],
  save: () => store.scheduleSave(current)
})

// the active mark of the saved playlists is derived from the config's playlist id: it moved, the list is read again
onConfigChange((previous, next) => {
  if (previous.fallbackPlaylist.playlistId !== next.fallbackPlaylist.playlistId) emit('playlists')
})

export function getPlaylists(): SavedPlaylist[] {
  return [...current()]
}

export function upsertPlaylist(meta: { id: string; title: string; thumbnail: string; itemCount: number }): SavedPlaylist {
  let saved!: SavedPlaylist

  changes.update(() => {
    const existing = current().find((p) => p.id === meta.id)

    if (existing) {
      saved = { ...existing, title: meta.title, thumbnail: meta.thumbnail, itemCount: meta.itemCount }
      loaded = current().map((p) => (p.id === meta.id ? saved : p))
    } else {
      saved = { ...meta, addedAt: Date.now() }
      current().push(saved)
    }
  })

  return saved
}

export function removePlaylist(id: string): boolean {
  let removed = false

  changes.update(() => {
    if (current().some((p) => p.id === id)) {
      loaded = current().filter((p) => p.id !== id)
      removed = true
    }
  })

  return removed
}
