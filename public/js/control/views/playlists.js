import { PAUSE_ICON, PLAY_ICON, DELETE_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../state.js'
import { createListView, row, rowMenu } from './primitives.js'

export const playlistsView = createListView(dom.playlistsListWrapper, {
  getKey: (items) => items.map((playlist) => [playlist.id, playlist.title, playlist.thumbnail, playlist.itemCount, playlist.isActive].join(':')).join('|'),
  renderRow: (playlist) =>
    row({
      className: playlist.isActive ? 'row-active' : '',
      thumbnail: playlist.thumbnail,
      title: playlist.title,
      subtitle: t('playlists.tracks', { count: playlist.itemCount }),
      actions: rowMenu([
        {
          action: 'playlist-activate',
          data: { id: playlist.id },
          icon: playlist.isActive ? PAUSE_ICON : PLAY_ICON,
          label: playlist.isActive ? t('playlists.pause') : t('playlists.activate')
        },
        { action: 'playlist-delete', data: { id: playlist.id }, icon: DELETE_ICON, label: t('playlists.delete'), danger: true }
      ])
    })
})
