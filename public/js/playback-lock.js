const LOCK_NAME = 'stream-queue-playback'

// Two overlays opened on this computer (a second OBS scene, a browser tab) would both play the music. The lock is held by
// exactly one page; the others wait for it and take over when the holder is closed (which also covers OBS refreshing a
// source: the new page gets the lock as soon as the old one is gone)
export function claimPlayback(onGranted, locks = globalThis.navigator?.locks) {
  // a browser without Web Locks (or an insecure context): every page plays, as before
  if (!locks) {
    onGranted()
    return
  }

  // never settles: the lock is held until the page is closed
  locks.request(LOCK_NAME, () => {
    onGranted()
    return new Promise(() => {})
  })
}
