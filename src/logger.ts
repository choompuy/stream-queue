import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getDataDir } from './runtime.js'
import { AppError } from './types.js'

type Level = 'debug' | 'info' | 'warn' | 'error'

const WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_FILE_BYTES = 1024 * 1024
const KEPT_ROTATED_FILES = 3

// LOG_LEVEL=debug / info / warn / error (default info); read once - it is a startup setting, not a per-line lookup
const MIN_WEIGHT = (() => {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase() ?? ''
  return Object.hasOwn(WEIGHT, raw) ? WEIGHT[raw as Level] : WEIGHT.info
})()

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function describeError(error: unknown, withStack = false): string {
  if (error instanceof AppError) {
    const params = error.params && Object.keys(error.params).length > 0 ? ` ${JSON.stringify(error.params)}` : ''
    // the default message repeats the code: printing both says the same thing twice
    const detail = error.message === error.code ? '' : `: ${error.message}`
    const described = `AppError ${error.code}${detail}${params}`
    return withStack ? `${described}\n${error.stack ?? ''}` : described
  }

  if (error instanceof Error) {
    // the class name tells a network failure from a bug; a plain Error has nothing to add
    const described = error.name === 'Error' ? error.message : `${error.name}: ${error.message}`
    return withStack ? (error.stack ?? described) : described
  }

  return String(error)
}

// File output is opt-in (the server turns it on): importing this module never touches the disk
let logFile: string | null = null
let fileSize: number | null = null
let writeChain: Promise<void> = Promise.resolve()

// a rotation that keeps failing (the file is locked by an antivirus, a viewer) is retried at most this often:
// every line over the limit must not turn into another full rename cycle while the lock holds
const ROTATION_RETRY_INTERVAL_MS = 30_000
let lastFailedRotationAt = 0

export function enableFileLogging(): void {
  logFile = join(getDataDir(), 'logs', 'app.log')
  fileSize = null
}

export function flushLogs(): Promise<void> {
  return writeChain
}

async function rotate(file: string): Promise<boolean> {
  await rm(`${file}.${KEPT_ROTATED_FILES}`, { force: true })

  for (let n = KEPT_ROTATED_FILES - 1; n >= 1; n--) {
    await rename(`${file}.${n}`, `${file}.${n + 1}`).catch(() => {})
  }

  return rename(file, `${file}.1`).then(
    () => true,
    // a locked file (Windows: an antivirus, a viewer) must not silently pass for rotated
    () => false
  )
}

async function appendToFile(file: string, line: string): Promise<void> {
  if (fileSize === null) {
    await mkdir(dirname(file), { recursive: true })
    fileSize = await stat(file).then(
      (info) => info.size,
      () => 0
    )
  }

  const bytes = Buffer.byteLength(line)

  if (fileSize > 0 && fileSize + bytes > MAX_FILE_BYTES) {
    // retried once per interval, not once per line: between the attempts the log keeps growing and this
    // size keeps counting, so the limit condition stays honest and the next attempt lands on the first
    // line over the limit after the pause
    if (Date.now() - lastFailedRotationAt >= ROTATION_RETRY_INTERVAL_MS) {
      if (await rotate(file)) {
        lastFailedRotationAt = 0
        fileSize = 0
      } else {
        lastFailedRotationAt = Date.now()
        // re-read the real size: the log keeps growing, and the next line over the limit retries the
        // rotation instead of counting a nonexistent empty file
        fileSize = await stat(file).then(
          (info) => info.size,
          () => 0
        )
      }
    }
  }

  await appendFile(file, line, 'utf8')
  fileSize += bytes
}

function write(level: Level, tag: string, msg: string): void {
  if (WEIGHT[level] < MIN_WEIGHT) return

  // an outside string (a video title, a nickname) must not be able to forge log entries
  const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg.replace(/[\r\n]+/g, '\\n')}`

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  if (logFile) {
    const file = logFile
    // a failing log file must never take the app down or block playback
    writeChain = writeChain.then(() => appendToFile(file, `${line}\n`)).catch(() => {})
  }
}

export function createLogger(tag: string) {
  return {
    debug: (msg: string) => write('debug', tag, msg),
    info: (msg: string) => write('info', tag, msg),
    warn: (msg: string) => write('warn', tag, msg),
    error: (msg: string) => write('error', tag, msg)
  }
}
