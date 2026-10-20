import { api } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { setValue } from '../shared.js'

export function loadPlaylists(silent = false) {
  return run(
    'loading playlists',
    async () => {
      state.playlists = (await api.getPlaylists()).playlists
      renderPlaylists()
    },
    { silent }
  )
}

// every playlist says whether it is the active one
export function renderPlaylists() {
  views.playlists.render(state.playlists)
}

export function addPlaylist() {
  const value = dom.playlistUrlInput.value.trim()
  if (!value) return undefined

  return run('adding playlist', async () => {
    await api.addPlaylist(value)
    setValue(dom.playlistUrlInput, '')
    toastSuccess(t('toast.playlistAdded'))
  })
}

export function activatePlaylist(id) {
  return run('activating playlist', async () => {
    const playlist = state.playlists.find(p => p.id === id)
    const wasActive = playlist?.isActive
    await api.activatePlaylist(id)
    toastSuccess(wasActive ? t('toast.playlistDeactivated') : t('toast.playlistActivated'))
  })
}

export function deletePlaylist(id) {
  return run('deleting playlist', async () => {
    await api.removePlaylist(id)
    toastSuccess(t('toast.playlistDeleted'))
  })
}

export const playlistActions = {
  'add-playlist': addPlaylist,
  'playlist-activate': (element) => activatePlaylist(element.dataset.id),
  'playlist-delete': (element) => deletePlaylist(element.dataset.id)
}
