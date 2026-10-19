import { dataPath, createListStore } from './persist.js'
import { onConfigChange } from './config.js'
import { emit } from './state-events.js'

export type SavedPlaylist = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
  addedAt: number
}

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

const playlists = createListStore<SavedPlaylist>({
  file: () => dataPath('playlists.json'),
  guard: isSavedPlaylist,
  topics: ['playlists']
})

// the active mark of the saved playlists is derived from the config's playlist id: it moved, the list is read again
onConfigChange((previous, next) => {
  if (previous.fallbackPlaylist.playlistId !== next.fallbackPlaylist.playlistId) emit('playlists')
})

export function getPlaylists(): SavedPlaylist[] {
  return playlists.all()
}

export function upsertPlaylist(meta: { id: string; title: string; thumbnail: string; itemCount: number }): SavedPlaylist {
  let saved!: SavedPlaylist

  playlists.update((list) => {
    const index = list.findIndex((playlist) => playlist.id === meta.id)

    saved =
      index >= 0
        ? { ...list[index], title: meta.title, thumbnail: meta.thumbnail, itemCount: meta.itemCount }
        : { ...meta, addedAt: Date.now() }

    if (index >= 0) list[index] = saved
    else list.push(saved)
  })

  return saved
}

export function removePlaylist(id: string): boolean {
  let removed = false

  playlists.update((list) => {
    const index = list.findIndex((playlist) => playlist.id === id)
    if (index === -1) return
    list.splice(index, 1)
    removed = true
  })

  return removed
}
