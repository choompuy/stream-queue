import path from 'node:path'
import { isSea } from 'node:sea'

export function isPackaged(): boolean {
  return isSea()
}

export function getAppRoot(): string {
  return isPackaged() ? path.dirname(process.execPath) : process.cwd()
}
