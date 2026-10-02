import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getDataDir } from './runtime.js'

type Level = 'debug' | 'info' | 'warn' | 'error'

const WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_FILE_BYTES = 1024 * 1024
const KEPT_ROTATED_FILES = 3

// LOG_LEVEL=debug / info / warn / error (default info)
function minWeight(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase() ?? ''
  return Object.hasOwn(WEIGHT, raw) ? WEIGHT[raw as Level] : WEIGHT.info
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function describeError(error: unknown, withStack = false): string {
  if (error instanceof Error) return withStack ? (error.stack ?? error.message) : error.message
  return String(error)
}

// File output is opt-in (the server turns it on): importing this module never touches the disk
let logFile: string | null = null
let fileSize: number | null = null
let writeChain: Promise<void> = Promise.resolve()

export function enableFileLogging(): void {
  logFile = join(getDataDir(), 'logs', 'app.log')
  fileSize = null
}

export function flushLogs(): Promise<void> {
  return writeChain
}

async function rotate(file: string): Promise<void> {
  await rm(`${file}.${KEPT_ROTATED_FILES}`, { force: true })

  for (let n = KEPT_ROTATED_FILES - 1; n >= 1; n--) {
    await rename(`${file}.${n}`, `${file}.${n + 1}`).catch(() => {})
  }

  await rename(file, `${file}.1`).catch(() => {})
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
    await rotate(file)
    fileSize = 0
  }

  await appendFile(file, line, 'utf8')
  fileSize += bytes
}

function write(level: Level, tag: string, msg: string): void {
  if (WEIGHT[level] < minWeight()) return

  const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg}`

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
    log: (msg: string) => write('info', tag, msg),
    warn: (msg: string) => write('warn', tag, msg),
    error: (msg: string) => write('error', tag, msg)
  }
}
