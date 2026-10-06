import { setText } from '../../shared.js'
import { dom } from '../dom.js'
import { state } from '../state.js'

export function renderStats() {
  setText(dom.tabPlaylistCount, state.fallback?.sourceCount ?? 0)
  setText(dom.tabActivityCount, state.activity.length)
  setText(dom.tabBlocklistCount, state.blocklist.length)
}
