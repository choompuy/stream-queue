import { api } from './api.js'
import { state, dom, views, log } from './state.js'
import { withLoading } from './ui.js'
import { refreshFallbackState } from './fallback.js'
import { t } from '../i18n.js'
import { translateErrorCode } from '../shared.js'

export async function loadPlaylists() {
  try {
    const data = await api.getPlaylists()
    state.playlists = data.playlists ?? []
    renderPlaylists()
  } catch (error) {
    log('Error loading playlists:', error)
  }
}

export function renderPlaylists() {
  if (!dom.playlistsListWrapper) return
  if (dom.playlistsCount) dom.playlistsCount.textContent = state.playlists.length

  const activeId = state.config?.fallbackPlaylist?.playlistId ?? ''
  dom.playlistsListWrapper.dataset.activeId = activeId
  views.playlists.render(state.playlists)
}

export async function addPlaylist() {
  const value = dom.playlistUrlInput.value.trim()
  dom.playlistError.classList.add('hidden')
  if (!value) return

  await withLoading(dom.playlistAddBtn, async () => {
    try {
      await api.addPlaylist(value)
      dom.playlistUrlInput.value = ''
      await loadPlaylists()
    } catch (error) {
      dom.playlistError.textContent = translateErrorCode(t, error.code, error.params, error.message) || t('playlists.errorAdding')
      dom.playlistError.classList.remove('hidden')
    }
  })
}

export async function activatePlaylist(id) {
  try {
    state.config = await api.activatePlaylist(id)
    renderPlaylists()
    await refreshFallbackState()
  } catch (error) {
    log('Error activating playlist:', error)
  }
}

export async function deletePlaylist(id) {
  if (!confirm(t('playlists.deleteConfirm'))) return

  try {
    const result = await api.removePlaylist(id)
    await loadPlaylists()
    if (result?.fallbackCleared) {
      state.config = await api.getConfig()
      await refreshFallbackState()
      log('Fallback cleared - active playlist was removed')
    }
  } catch (error) {
    log('Error deleting playlist:', error)
  }
}
