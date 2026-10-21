import { flushAllStores } from './persist.js'
import { createLogger, describeError, flushLogs } from './logger.js'
import { closeAllStreams } from './sse.js'

const log = createLogger('SHUTDOWN')

let shuttingDown = false

// The HTTP server registers itself at startup: shutdown stops accepting new requests before saving
let stopAcceptingRequests: (() => void) | null = null

// The long-lived background connections (the Twitch sockets) register the same way at startup:
// they are closed before the save, so nothing changes state while it is being written
let stopBackgroundConnections: (() => void) | null = null

/** The one hook the HTTP server needs at shutdown: close the listener so no request lands after the save starts. */
export function registerServerStop(stop: () => void): void {
  stopAcceptingRequests = stop
}

/** The one hook the background connections need at shutdown: they stop before the save starts. */
export function registerBackgroundStop(stop: () => void): void {
  stopBackgroundConnections = stop
}

// If saving never finishes (a stuck disk, a hung write) the process must still end: a crashed Node stays alive otherwise
const FORCE_EXIT_AFTER_MS = 5000

/** Saves everything that is still waiting to be written (settings, queue, logs) and then exits. Safe to call more than once. */
export async function shutdown(code = 0, exit: (code: number) => void = (c) => process.exit(c)): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  // first: an open stream holds the connection of the page, and nothing below depends on it
  closeAllStreams()

  // the server stops taking new requests: one accepted after this point would change state
  // just for its changes to be lost by the save below
  stopAcceptingRequests?.()

  // the background connections stop for the same reason: their work must not change what is being saved
  stopBackgroundConnections?.()

  // the safety net owns the exit from the moment it fires: the normal path must not add a second one
  // when its own save completes right after (a hung save can still finish, just too late)
  let forcedExitStarted = false

  const forceExit = setTimeout(() => {
    forcedExitStarted = true
    log.error(`Saving did not finish in ${FORCE_EXIT_AFTER_MS / 1000}s, exiting anyway`)
    // what already made it to the write chain is flushed, but a stuck chain must not hold the exit hostage
    // (a plain global setTimeout, so the guard is as mockable as the timer that starts it)
    const boundedFlush = new Promise<void>((resolve) => setTimeout(resolve, 1000))
    void Promise.race([flushLogs(), boundedFlush]).finally(() => exit(code))
  }, FORCE_EXIT_AFTER_MS)
  forceExit.unref()

  try {
    await flushAllStores()
  } catch (error) {
    log.error(`Flush failed: ${describeError(error)}`)
  }

  await flushLogs()

  // saved in time: the safety net must not fire a second exit later
  clearTimeout(forceExit)
  if (!forcedExitStarted) exit(code)
}

/** SIGINT (Ctrl+C), SIGTERM (a service stop), SIGHUP (Windows sends it when the console window is closed), SIGBREAK and a crash all end the same way: saved first. */
export function installShutdownHandlers(): void {
  // a stray rejected promise must not stop the music mid-stream: log it and carry on
  process.on('unhandledRejection', (reason) => {
    log.error(`Unhandled rejection: ${describeError(reason, true)}`)
  })

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(signal, () => {
      log.info(`${signal} received, saving and exiting`)
      void shutdown(0)
    })
  }

  process.on('uncaughtException', (error) => {
    // the same policy as a rejected promise (the owner's decision): a stray exception in a callback must not
    // stop the music mid-stream. The line is flushed so it survives even if the app dies later after all
    log.error(`Uncaught exception: ${describeError(error, true)}`)
    void flushLogs()
  })
}
