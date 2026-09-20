import { api } from './api.js'
import { state, dom, log } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { refreshFallbackState } from './fallback.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

export function loadPlaylists() {
  return run('loading playlists', async () => {
    const data = await api.getPlaylists()
    state.playlists = data.playlists ?? []
    renderPlaylists()
  })
}

export function renderPlaylists() {
  if (!dom.playlistsListWrapper) return
  if (dom.playlistsCount) dom.playlistsCount.textContent = state.playlists.length

  const activeId = state.config?.fallbackPlaylist?.playlistId ?? ''
  views.playlists.render(state.playlists.map((playlist) => ({ ...playlist, isActive: playlist.id === activeId })))
}

export async function addPlaylist() {
  const value = dom.playlistUrlInput.value.trim()
  if (!value) return

  await run(
    'adding playlist',
    async () => {
      await api.addPlaylist(value)
      dom.playlistUrlInput.value = ''
      await loadPlaylists()
      toastSuccess(t('toast.playlistAdded'))
    },
    { button: dom.playlistAddBtn }
  )
}

export function activatePlaylist(id) {
  return run('activating playlist', async () => {
    state.config = await api.activatePlaylist(id)
    renderPlaylists()
    await refreshFallbackState()
    toastSuccess(t('toast.playlistActivated'))
  })
}

export async function deletePlaylist(id) {
  if (!confirm(t('playlists.deleteConfirm'))) return

  await run('deleting playlist', async () => {
    const result = await api.removePlaylist(id)
    await loadPlaylists()
    toastSuccess(t('toast.playlistDeleted'))

    if (result?.fallbackCleared) {
      state.config = await api.getConfig()
      await refreshFallbackState()
      log('Fallback cleared - active playlist was removed')
    }
  })
}

export const playlistActions = {
  'add-playlist': addPlaylist,
  'playlist-activate': (element) => activatePlaylist(element.dataset.id),
  'playlist-delete': (element) => deletePlaylist(element.dataset.id)
}
