import type { Request, Response } from 'express'
import { createLogger } from '../infra/logger.js'
import { on, type Topic } from '../infra/state-events.js'

const log = createLogger('SSE')

const MAX_CLIENTS = 20
const PING_EVERY_MS = 25_000
const DEBOUNCE_MS = 50

type Client = {
  res: Response
  topics: Set<Topic>
  lastSeq: Map<Topic, number>
  pendingEvents: Map<Topic, boolean>
  debounceTimers: Map<Topic, ReturnType<typeof setTimeout>>
  pingTimer: ReturnType<typeof setTimeout>
}

let clients = new Set<Client>()
let seqNumbers = new Map<Topic, number>()

// Initialize sequence numbers
for (const topic of ['state', 'activity', 'fallback', 'twitch'] as Topic[]) {
  seqNumbers.set(topic, 0)
}

function getNextSeq(topic: Topic): number {
  const seq = (seqNumbers.get(topic) ?? 0) + 1
  seqNumbers.set(topic, seq)
  return seq
}

function sendEvent(client: Client, topic: Topic): void {
  const seq = getNextSeq(topic)
  client.res.write(`event: changed\ndata: {"topic":"${topic}","seq":${seq}}\n\n`)
  client.lastSeq.set(topic, seq)
  client.pendingEvents.set(topic, false)
}

function debouncedSend(client: Client, topic: Topic): void {
  const existing = client.debounceTimers.get(topic)
  if (existing) {
    clearTimeout(existing)
  }

  client.pendingEvents.set(topic, true)

  const timer = setTimeout(() => {
    if (client.pendingEvents.get(topic)) {
      sendEvent(client, topic)
    }
    client.debounceTimers.delete(topic)
  }, DEBOUNCE_MS)

  client.debounceTimers.set(topic, timer)
}

function startPing(client: Client): void {
  client.pingTimer = setInterval(() => {
    try {
      client.res.write(': ping\n\n')
    } catch (error) {
      log.error('Failed to send ping:', error)
      removeClient(client)
    }
  }, PING_EVERY_MS)
}

function removeClient(client: Client): void {
  clearInterval(client.pingTimer)
  for (const timer of client.debounceTimers.values()) {
    clearTimeout(timer)
  }
  clients.delete(client)
  log.log(`Client removed, ${clients.size} active`)
}

function handleTopicEvent(topic: Topic): void {
  for (const client of clients) {
    if (client.topics.has(topic)) {
      debouncedSend(client, topic)
    }
  }
}

export function handleEvents(req: Request, res: Response): void {
  if (clients.size >= MAX_CLIENTS) {
    res.status(503).send('Too many SSE connections')
    return
  }

  const topicsParam = req.query.topics as string | undefined
  const topics = topicsParam
    ? (topicsParam.split(',') as Topic[]).filter((t): t is Topic => ['state', 'activity', 'fallback', 'twitch'].includes(t))
    : (['state', 'activity', 'fallback', 'twitch'] as Topic[])

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // Send retry first
  res.write(`retry: 3000\n\n`)

  const client: Client = {
    res,
    topics: new Set(topics),
    lastSeq: new Map(),
    pendingEvents: new Map(),
    debounceTimers: new Map(),
    pingTimer: null as any
  }

  clients.add(client)
  log.log(`Client added, ${clients.size} active, topics: ${topics.join(', ')}`)

  // Subscribe to topics
  const unsubscribers = topics.map((topic) =>
    on(topic, () => {
      handleTopicEvent(topic)
    })
  )

  // Send initial events for all subscribed topics
  for (const topic of topics) {
    sendEvent(client, topic)
  }

  startPing(client)

  req.on('close', () => {
    log.log('Client disconnected')
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    removeClient(client)
  })
}

export function closeAllStreams(): void {
  log.log(`Closing ${clients.size} SSE streams`)
  for (const client of clients) {
    try {
      client.res.end()
    } catch (error) {
      log.error('Failed to close stream:', error)
    }
  }
  clients.clear()
}
