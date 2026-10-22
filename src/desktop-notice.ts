import { setTimeout as sleep } from 'node:timers/promises'
import { onNotice, notify, type DesktopNotice, type DesktopNoticeCode } from './state-events.js'
import { NoFreePortError } from './app.js'
import { hasKey, t } from './i18n.js'
import { getSettings } from './settings.js'
import { describeError } from './logger.js'

// The tray reads the server's stdout line by line. These lines are the channel to the desktop user: they work
// before the HTTP server is up (startup failures), and need no port and no authorization

const NOTICE_PREFIX = '::notice:: '
const READY_PREFIX = '::ready:: '

/** One window for every code together: the tray deduplicates on its own minute as well, this keeps the stream quiet */
export const DESKTOP_NOTICE_DEDUP_MS = 10 * 60 * 1000

// the shutdown path waits for the startup-failure line, but never longer than this
const STARTUP_NOTICE_WAIT_MS = 1000

// `STARTUP_FAILED` becomes `startupFailed`, the same shape as the API error keys
function codeToI18nKey(code: DesktopNoticeCode): string {
  return `desktop.${code.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())}`
}

// The language of the panel is the language of the desktop user. Unreadable settings must not turn every notice into an error of its own
function uiLocale(): string {
  try {
    return getSettings().locale
  } catch {
    return 'en'
  }
}

function noticeText(notice: DesktopNotice): string {
  const locale = uiLocale()
  const key = codeToI18nKey(notice.code)
  // a missing folder of locales or a missing key: the message of the event, or at least its code, still reaches the tray
  if (hasKey(locale, key)) return t(locale, key, notice.params ?? {})
  return notice.message ?? notice.code
}

// JSON.stringify keeps even a text with line breaks on a single line: the line-by-line reader on the other side depends on that
function noticeLine(notice: DesktopNotice): string {
  return `${NOTICE_PREFIX}${JSON.stringify({
    level: notice.level,
    code: notice.code,
    text: noticeText(notice),
    fatal: notice.fatal ?? false
  })}`
}

/** Writes one line to stdout. Through a pipe (the tray on Windows) the write is asynchronous: the promise settles once the line is handed over */
function writeStdoutLine(line: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(`${line}\n`, 'utf8', () => resolve())
  })
}

/** The line the tray waits for instead of parsing the log: written once the server is listening */
export function writeDesktopReadyLine(port: number): Promise<void> {
  return writeStdoutLine(`${READY_PREFIX}${JSON.stringify({ port })}`)
}

let inFlight: Promise<void> = Promise.resolve()

/** Resolves once the notice lines written so far have been handed to stdout: the exit path waits for its line here (bounded) */
export function settleDesktopNotices(): Promise<void> {
  return inFlight
}

/**
 * Subscribes to the desktop notices and writes them as protocol lines (to stdout, or to the injected `write`,
 * which the tests collect with). One and the same code is written at most once per window; a fatal notice
 * always goes out. Returns the unsubscribe function
 */
export function installDesktopNotices(write: (line: string) => Promise<void> = writeStdoutLine): () => void {
  const sentAt = new Map<DesktopNoticeCode, number>()

  return onNotice((notice) => {
    if (notice.type !== 'desktop') return

    if (!notice.fatal) {
      const last = sentAt.get(notice.code)
      if (last !== undefined && Date.now() - last < DESKTOP_NOTICE_DEDUP_MS) return
    }
    sentAt.set(notice.code, Date.now())

    // a failing write must never throw back into the emitter's call stack
    inFlight = write(noticeLine(notice)).catch(() => {})
  })
}

/**
 * Reports the failure that ended main(): the tray shows it instead of a silent dead icon. Awaits the line
 * (bounded), so the process does not exit before the tray has read it
 */
export async function reportStartupFailure(error: unknown): Promise<void> {
  const described = describeError(error)

  notify(
    error instanceof NoFreePortError
      ? { type: 'desktop', level: 'error', code: 'NO_FREE_PORT', fatal: true, params: { from: error.from, to: error.to } }
      : { type: 'desktop', level: 'error', code: 'STARTUP_FAILED', fatal: true, params: { message: described }, message: described }
  )

  await Promise.race([settleDesktopNotices(), sleep(STARTUP_NOTICE_WAIT_MS)])
}
