import { state, on } from './state.js'
import { dom } from './dom.js'

// the counters on the tabs of the dashboard follow the three lists they count
on(['fallback', 'activity', 'blocklist'], renderStats)

function renderStats() {
  dom.tabPlaylistCount.textContent = state.fallback?.sourceCount ?? 0
  dom.tabActivityCount.textContent = state.activity.length
  dom.tabBlocklistCount.textContent = state.blocklist.length
}
