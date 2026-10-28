import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isSea } from 'node:sea'
import { parseEnv } from 'node:util'

function isPackaged(): boolean {
  return isSea()
}

export function getAppRoot(): string {
  return isPackaged() ? path.dirname(process.execPath) : process.cwd()
}

export const getDataDir = (): string => path.join(getAppRoot(), 'data')

// Reads `.env` from the app root (next to the exe when packaged), not from whatever cwd the process was started in.
// What the environment already holds stays. A BOM (older Windows editors write one) is cut off: left in, it would
// stick to the first name and that variable would be silently missing
export function loadEnvFile(): void {
  let text: string
  try {
    text = readFileSync(path.join(getAppRoot(), '.env'), 'utf8')
  } catch {
    return // no file is fine: the values then come from the environment, or from the build
  }

  for (const [key, value] of Object.entries(parseEnv(text.replace(/^\uFEFF/, '')))) process.env[key] ??= value
}
