import { flushAllStores } from './persist.js'
import { createLogger, describeError, flushLogs } from './logger.js'
import { closeAllStreams } from './sse.js'

const log = createLogger('SHUTDOWN')

let shuttingDown = false

// If saving never finishes (a stuck disk, a hung write) the process must still end: a crashed Node stays alive otherwise
const FORCE_EXIT_AFTER_MS = 5000

/** Saves everything that is still waiting to be written (settings, queue, logs) and then exits. Safe to call more than once. */
export async function shutdown(code = 0, exit: (code: number) => void = (c) => process.exit(c)): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  setTimeout(() => {
    log.error(`Saving did not finish in ${FORCE_EXIT_AFTER_MS / 1000}s, exiting anyway`)
    exit(code)
  }, FORCE_EXIT_AFTER_MS).unref()

  closeAllStreams()

  try {
    await flushAllStores()
  } catch (error) {
    log.error(`Flush failed: ${describeError(error)}`)
  }

  await flushLogs()
  exit(code)
}

/** SIGINT (Ctrl+C), SIGTERM (a service stop), SIGHUP (Windows sends it when the console window is closed), SIGBREAK and a crash all end the same way: saved first. */
export function installShutdownHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(signal, () => {
      log.log(`${signal} received, saving and exiting`)
      void shutdown(0)
    })
  }

  process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception: ${describeError(error, true)}`)
    void shutdown(1)
  })
}
