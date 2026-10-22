import { api } from './api.js'
import { state, on } from './state.js'
import { dom } from './dom.js'
import { views } from './views/index.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { setValue } from '../shared.js'

on('playlists', () => views.playlists.render(state.playlists))

// The playlists topic: the data is written to the store and the drawing is a subscriber; the watcher logs a read that fails
export function readPlaylists() {
  return api.getPlaylists().then((data) => {
    state.playlists = data.playlists
  })
}

export async function addPlaylist() {
  const value = dom.playlistUrlInput.value.trim()
  if (!value) return undefined

  await api.addPlaylist(value)
  setValue(dom.playlistUrlInput, '')
  toastSuccess(t('toast.playlistAdded'))
}

export async function activatePlaylist(id) {
  const playlist = state.playlists.find((p) => p.id === id)
  const wasActive = playlist?.isActive

  await api.activatePlaylist(id)
  toastSuccess(wasActive ? t('toast.playlistDeactivated') : t('toast.playlistActivated'))
}

export async function deletePlaylist(id) {
  await api.removePlaylist(id)
  toastSuccess(t('toast.playlistDeleted'))
}

export const playlistActions = {
  'add-playlist': addPlaylist,
  'playlist-activate': (element) => activatePlaylist(element.dataset.id),
  'playlist-delete': (element) => deletePlaylist(element.dataset.id)
}
