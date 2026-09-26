export function createLogger(tag: string) {
  return {
    log: (msg: string) => console.log(`[${tag}] ${msg}`),
    warn: (msg: string) => console.warn(`[${tag}] ${msg}`),
    error: (msg: string) => console.error(`[${tag}] ${msg}`)
  }
}
