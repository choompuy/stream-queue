// The inputs of the overlay settings: `key` is the name in the saved settings, `dom` a key of `dom`. An 'integer' is read with
// parseInt, so that an empty input is not a number (and not a 0); `fallback` fills the input when the server sent nothing
export const OVERLAY_FIELDS = [
  { key: 'showVideo', dom: 'showVideo', type: 'checkbox' },
  { key: 'hideOverlayInfo', dom: 'hideOverlayInfo', type: 'checkbox' },
  { key: 'opacity', dom: 'overlayOpacity', type: 'integer', fallback: 100 },
  { key: 'position', dom: 'badgePosition', type: 'text', fallback: 'bottom-right' }
]
