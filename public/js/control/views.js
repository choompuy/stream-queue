import { escapeHtml, formatDuration, translateErrorCode } from '../shared.js'
import { PLUS_ICON, PLAY_ICON, PAUSE_ICON, DELETE_ICON, BLOCK_ICON } from '../icons.js'
import { createListView, formatRelativeTime } from './ui.js'
import { t } from '../i18n.js'
import { MORE_ICON } from '../icons.js'

function row({ index, thumbnail, title, subtitle, meta = '', extra = '', actions = '', className = '', attributes = '' }) {
  return `
    <div class="row-item ${className}" ${attributes}>
      ${index != null ? `<span class="row-index text-sm text-secondary text-bold">${index + 1}</span>` : ''}
      ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" class="thumbnail" alt="${escapeHtml(title)}">` : ''}
      <div class="row-info">
        <div class="text-sm text-primary truncate">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="text-xs text-secondary truncate">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      ${extra}
      ${meta ? `<span class="text-sm text-secondary">${meta}</span>` : ''}
      ${actions ? `<div class="row-ctrl">${actions}</div>` : ''}
    </div>
  `
}

function rowMenu(items) {
  return `
    <div class="row-menu">
      <button class="btn btn-sm btn-icon" data-action="toggle-menu" title="${t('common.more')}">
        ${MORE_ICON()}
      </button>
      <div class="row-menu-dropdown hidden">
        ${items
          .map(
            (item) => `
          <button class="row-menu-item btn btn-secondary${item.danger ? ' btn-danger' : ''}" data-action="${item.action}"${item.attrs || ''}>
            <span>${item.label}</span>
            <span class="row-menu-icon">${item.icon ? item.icon(20) : ''}</span>
          </button>
        `
          )
          .join('')}
      </div>
    </div>
  `
}

export function createViews(dom) {
  const search = createListView(dom.searchListWrapper, {
    cache: false,
    renderRow: (song) =>
      row({
        thumbnail: song.thumbnail,
        title: song.title,
        subtitle: song.channelTitle,
        meta: formatDuration(song.duration),
        actions: `
          <button
            class="btn btn-sm btn-icon"
            data-action="search-add"
            data-video-id="${escapeHtml(song.videoId)}"
            title="${t('search.addToQueue')}"
          >
            ${PLUS_ICON()}
          </button>
        `
      })
  })

  const queue = createListView(dom.queueListWrapper, {
    getKey: (items) =>
      items.map((item) => [item.videoId, item.requestedBy, item.title, item.thumbnail, item.duration, item.isBlocked].join(':')).join('|'),
    renderRow: (item, index) =>
      row({
        className: item.isBlocked ? 'row-blocked' : '',
        index,
        thumbnail: item.thumbnail,
        title: item.title,
        subtitle: item.channelTitle,
        extra: `
          <span class="text-sm text-green">
            @${escapeHtml(item.requestedBy)}
          </span>
          ${item.isBlocked ? `<span class="text-xs text-bold status-pill rejected">${t('blocklist.blockedLabel')}</span>` : ''}
        `,
        meta: formatDuration(item.duration),
        actions: rowMenu(
          item.isBlocked
            ? [
                {
                  action: 'unblock-track',
                  attrs: ` data-video-id="${escapeHtml(item.videoId)}"`,
                  icon: PLUS_ICON,
                  label: t('blocklist.unblock')
                },
                {
                  action: 'queue-remove',
                  attrs: ` data-index="${index}"`,
                  icon: DELETE_ICON,
                  label: t('queue.remove'),
                  danger: true
                }
              ]
            : [
                {
                  action: 'block-track',
                  attrs: ` data-video-id="${escapeHtml(item.videoId)}" data-title="${escapeHtml(item.title)}"`,
                  icon: BLOCK_ICON,
                  label: t('blocklist.block'),
                  danger: true
                },
                {
                  action: 'queue-remove',
                  attrs: ` data-index="${index}"`,
                  icon: DELETE_ICON,
                  label: t('queue.remove'),
                  danger: true
                }
              ]
        ),
        attributes: `data-queue-index="${index}"`
      })
  })

  const fallbackList = dom.fallbackListWrapper.querySelector('.row-list')
  const fallback = createListView(dom.fallbackListWrapper, {
    getKey: (items) => {
      const activeId = fallbackList.dataset.activeVideoId || ''
      return [activeId, ...items.map((item) => `${item.videoId}:${item.isBlocked}`)].join('|')
    },
    renderRow: (track) => {
      const isActive = track.videoId === fallbackList.dataset.activeVideoId
      const rowClass = [isActive ? 'row-active' : '', track.isBlocked ? 'row-blocked' : ''].filter(Boolean).join(' ')

      return row({
        className: rowClass,
        attributes: `data-video-id="${escapeHtml(track.videoId)}"`,
        thumbnail: track.thumbnail,
        title: track.title,
        subtitle: track.channelTitle,
        meta: formatDuration(track.duration),
        extra: track.isBlocked ? `<span class="text-xs text-bold status-pill rejected">${t('blocklist.blockedLabel')}</span>` : '',
        actions: rowMenu(
          track.isBlocked
            ? [
                {
                  action: 'unblock-track',
                  attrs: ` data-video-id="${escapeHtml(track.videoId)}"`,
                  icon: PLUS_ICON,
                  label: t('blocklist.unblock')
                }
              ]
            : [
                {
                  action: 'fallback-enqueue',
                  attrs: ` data-video-id="${escapeHtml(track.videoId)}"`,
                  icon: PLUS_ICON,
                  label: t('fallback.addToQueue')
                },
                {
                  action: 'fallback-play',
                  attrs: ` data-video-id="${escapeHtml(track.videoId)}"`,
                  icon: PLAY_ICON,
                  label: t('fallback.playNow')
                },
                {
                  action: 'block-track',
                  attrs: ` data-video-id="${escapeHtml(track.videoId)}" data-title="${escapeHtml(track.title)}"`,
                  icon: BLOCK_ICON,
                  label: t('blocklist.block'),
                  danger: true
                }
              ]
        )
      })
    }
  })

  const activity = createListView(dom.activityListWrapper, {
    getKey: (items) => {
      const minute = Math.floor(Date.now() / 60000)
      return [
        minute,
        ...items.map((entry) => [entry.at, entry.status, entry.title, entry.videoId, entry.query, entry.requestedBy, entry.reasonCode].join(':'))
      ].join('|')
    },
    renderRow: (entry) => {
      const title = entry.title || entry.query
      const statusKey = entry.status === 'accepted' ? 'activity.accepted' : entry.status === 'failed' ? 'activity.failed' : 'activity.rejected'
      return row({
        thumbnail: entry.videoId ? `https://i.ytimg.com/vi/${entry.videoId}/mqdefault.jpg` : '',
        title,
        subtitle: translateErrorCode(t, entry.reasonCode, entry.reasonParams),
        extra: `
          <div class="text-sm text-secondary">
            ${formatRelativeTime(entry.at)}
          </div>
          <div class="text-sm text-green">
            @${escapeHtml(entry.requestedBy)}
          </div>
          <span class="text-xs text-bold status-pill ${escapeHtml(entry.status)}">
            ${t(statusKey)}
          </span>
        `,
        actions: entry.videoId
          ? rowMenu([
              {
                action: 'block-track',
                attrs: ` data-video-id="${escapeHtml(entry.videoId)}" data-title="${escapeHtml(title)}"`,
                icon: BLOCK_ICON,
                label: t('blocklist.block'),
                danger: true
              }
            ])
          : ''
      })
    }
  })

  const blocklist = createListView(dom.blocklistListWrapper, {
    getKey: (items) => items.map((entry) => [entry.videoId, entry.title, entry.blockedAt].join(':')).join('|'),
    renderRow: (entry) =>
      row({
        thumbnail: `https://i.ytimg.com/vi/${entry.videoId}/mqdefault.jpg`,
        title: entry.title,
        subtitle: formatRelativeTime(entry.blockedAt),
        actions: rowMenu([
          {
            action: 'unblock-track',
            attrs: ` data-video-id="${escapeHtml(entry.videoId)}"`,
            icon: PLUS_ICON,
            label: t('blocklist.unblock')
          }
        ])
      })
  })

  const playlists = createListView(dom.playlistsListWrapper, {
    getKey: (items) => {
      const activeId = dom.playlistsListWrapper.dataset.activeId || ''
      return [activeId, ...items.map((playlist) => [playlist.id, playlist.title, playlist.thumbnail, playlist.itemCount].join(':'))].join('|')
    },

    renderRow: (playlist) => {
      const activeId = dom.playlistsListWrapper.dataset.activeId
      const isActive = playlist.id === activeId

      return row({
        className: isActive ? 'row-active' : '',
        thumbnail: playlist.thumbnail,
        title: playlist.title,
        subtitle: t('playlists.tracks', { count: playlist.itemCount }),
        actions: rowMenu([
          {
            action: 'playlist-activate',
            attrs: ` data-id="${escapeHtml(playlist.id)}"`,
            icon: isActive ? PAUSE_ICON : PLAY_ICON,
            label: isActive ? t('playlists.pause') : t('playlists.activate')
          },
          {
            action: 'playlist-delete',
            attrs: ` data-id="${escapeHtml(playlist.id)}"`,
            icon: DELETE_ICON,
            label: t('playlists.delete'),
            danger: true
          }
        ])
      })
    }
  })

  return {
    queue,
    fallback,
    search,
    activity,
    blocklist,
    playlists
  }
}
