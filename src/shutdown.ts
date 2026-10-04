import { flushAllStores } from './persist.js'
import { createLogger, describeError, flushLogs } from './logger.js'

const log = createLogger('SHUTDOWN')

let shuttingDown = false

/** Saves everything that is still waiting to be written (settings, queue, logs) and then exits. Safe to call more than once. */
export async function shutdown(code = 0, exit: (code: number) => void = (c) => process.exit(c)): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  try {
    await flushAllStores()
  } catch (error) {
    log.error(`Flush failed: ${describeError(error)}`)
  }

  await flushLogs()
  exit(code)
}

/** SIGINT, SIGTERM (Ctrl+C, closing the console window, a service stop) and a crash all end the same way: saved first. */
export function installShutdownHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
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
