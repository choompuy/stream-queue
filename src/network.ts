import os from 'node:os'

// The one place that knows this machine's network identity: addresses, the hostname, the loopback question.
// Enumerating interfaces and reading the hostname are syscalls, and host-check asks on every request:
// everything here is cached with a short TTL, so the answers are one memory read while they are fresh.

const ADDRESSES_TTL_MS = 5000

let cached: { at: number; addresses: Set<string>; lan: string[]; hostname: string } = {
  at: 0,
  addresses: new Set(),
  lan: [],
  hostname: ''
}

function refresh(): void {
  const now = Date.now()
  if (now - cached.at < ADDRESSES_TTL_MS) return

  const addresses = new Set<string>()
  const lan: string[] = []
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces ?? []) {
      addresses.add(withoutMappedPrefix(iface.address.split('%')[0]))
      if (iface.family === 'IPv4' && !iface.internal) lan.push(iface.address)
    }
  }

  cached = { at: now, addresses, lan, hostname: os.hostname().toLowerCase() }
}

export function withoutMappedPrefix(address: string): string {
  return address.replace(/^::ffff:/i, '').toLowerCase()
}

export function ownAddresses(): Set<string> {
  refresh()
  return cached.addresses
}

/** The IPv4 addresses the outside world can point at this machine on. */
export function lanAddresses(): string[] {
  refresh()
  return [...cached.lan]
}

/** The computer's hostname, lowercase - what host-check compares the Host header against. */
export function computerHostname(): string {
  refresh()
  return cached.hostname
}

function isLoopbackAddress(normalized: string): boolean {
  return normalized === '::1' || normalized.startsWith('127.')
}

/** Whether the request socket address belongs to this machine: loopback or one of its own interfaces. */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = withoutMappedPrefix(address.split('%')[0])
  return isLoopbackAddress(normalized) || ownAddresses().has(normalized)
}
