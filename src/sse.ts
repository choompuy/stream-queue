import type { Request, Response } from 'express'
import { fail } from './http.js'
import { createLogger } from './logger.js'
import { on, TOPICS, type Topic } from './state-events.js'

const log = createLogger('SSE')

export type EventStreamOptions = {
  // above this the answer is 503: a few forgotten tabs must not use up every connection of the server
  maxClients?: number
  // a quiet connection is kept alive (proxies, antivirus and OBS drop silent ones) and the page can tell it is still there
  pingEveryMs?: number
  // changes of one topic that follow each other are one event: queue.ts reports several per operation
  coalesceMs?: number
  // sent first: how long a browser waits before it reconnects on its own
  retryMs?: number
}

type Client = { res: Response; topics: Set<Topic>; ping: ReturnType<typeof setInterval> }

function requestedTopics(query: unknown): Set<Topic> {
  const names = typeof query === 'string' ? query.split(',').map((name) => name.trim()) : []
  const known = TOPICS.filter((topic) => names.includes(topic))

  // nothing (or nothing known) asked for: all of them
  return new Set(known.length > 0 ? known : TOPICS)
}

/**
 * GET /api/events?topics=state,activity. A frame only says "this topic changed, read it again": the data stays behind
 * the GET endpoints, so there is one format and an event can never overtake the state it announces
 */
export function createEventStreams({ maxClients = 20, pingEveryMs = 25_000, coalesceMs = 50, retryMs = 3000 }: EventStreamOptions = {}) {
  const clients = new Set<Client>()
  const sequence: Record<Topic, number> = { state: 0, activity: 0, fallback: 0, twitch: 0 }
  const timers = new Map<Topic, ReturnType<typeof setTimeout>>()
  let unsubscribe: (() => void) | null = null

  function send(client: Client, frame: string): void {
    try {
      client.res.write(frame)
    } catch (error) {
      log.warn(`Dropping a stream that cannot be written to: ${error instanceof Error ? error.message : error}`)
      close(client)
    }
  }

  function broadcast(topic: Topic): void {
    const frame = `event: changed\ndata: ${JSON.stringify({ topic, seq: ++sequence[topic] })}\n\n`

    for (const client of [...clients]) {
      if (client.topics.has(topic)) send(client, frame)
    }
  }

  function schedule(topic: Topic): void {
    if (timers.has(topic)) return

    const timer = setTimeout(() => {
      timers.delete(topic)
      broadcast(topic)
    }, coalesceMs)
    timer.unref()
    timers.set(topic, timer)
  }

  // listening costs nothing while nobody is connected
  function subscribe(): void {
    const offs = TOPICS.map((topic) => on(topic, () => schedule(topic)))
    unsubscribe = () => offs.forEach((off) => off())
  }

  function close(client: Client): void {
    if (!clients.delete(client)) return

    clearInterval(client.ping)
    client.res.end()

    if (clients.size === 0) {
      unsubscribe?.()
      unsubscribe = null
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }

  function handle(req: Request, res: Response): void {
    if (clients.size >= maxClients) {
      fail(res, 'too many open event streams', 'SERVER_ERROR', 503)
      return
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // a reverse proxy must not hold the frames back
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders()
    res.write(`retry: ${retryMs}\n\n`)

    // a real event and not a ": comment": a browser does not show comments to the page, which could then never tell a quiet
    // connection from a dead one
    const ping = setInterval(() => send(client, 'event: ping\ndata: {}\n\n'), pingEveryMs)
    ping.unref()

    const client: Client = { res, topics: requestedTopics(req.query.topics), ping }
    clients.add(client)
    if (clients.size === 1) subscribe()

    res.on('close', () => close(client))
  }

  function closeAll(): void {
    for (const client of [...clients]) close(client)
  }

  return { handle, closeAll, clientCount: () => clients.size }
}

const streams = createEventStreams()

export const handleEvents = streams.handle

/** An open stream keeps server.close() waiting forever: shutdown ends them first */
export const closeAllStreams = streams.closeAll
