import path from 'node:path'
import { isSea } from 'node:sea'
import { config as loadDotenv } from 'dotenv'

export function isPackaged(): boolean {
  return isSea()
}

export function getAppRoot(): string {
  return isPackaged() ? path.dirname(process.execPath) : process.cwd()
}

export const getDataDir = (): string => path.join(getAppRoot(), 'data')
export const getCacheDir = (): string => path.join(getAppRoot(), 'cache')

// Reads `.env` from the app root (next to the exe when packaged), not from whatever cwd the process was started in
export function loadEnvFile(): void {
  loadDotenv({ path: path.join(getAppRoot(), '.env'), quiet: true })
}
