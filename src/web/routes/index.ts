import express from 'express'
import { fail } from '../http.js'
import { createLogger } from '../infra/logger.js'
import { router as systemRouter } from './system.js'
import { router as settingsRouter } from '../core/settings.js'
import { router as playlistsRouter } from '../core/playlists.js'
import { router as blocklistRouter } from '../core/blocklist.js'
import { router as searchRouter } from './search.js'
import { router as activityRouter } from '../core/activity.js'
import { router as queueRouter } from '../core/queue.js'
import { router as playerRouter } from '../core/player.js'
import { router as fallbackRouter } from '../core/fallback.js'
import { router as chatRouter } from './chat.js'
import { router as twitchRouter } from './twitch.js'
import { router as eventsRouter } from './events.js'

const log = createLogger('API')

export const apiRouter = express.Router()

apiRouter.use(systemRouter)
apiRouter.use(settingsRouter)
apiRouter.use(eventsRouter)

apiRouter.use('/playlists', playlistsRouter)
apiRouter.use('/blocklist', blocklistRouter)
apiRouter.use('/search', searchRouter)
apiRouter.use('/activity', activityRouter)
apiRouter.use('/queue', queueRouter)
apiRouter.use('/player', playerRouter)
apiRouter.use('/fallback', fallbackRouter)
apiRouter.use('/chat', chatRouter)
apiRouter.use('/integrations/twitch', twitchRouter)

apiRouter.use((req, res) => {
  log.warn(`Unknown endpoint: ${req.method} ${req.originalUrl}`)
  fail(res, 'API endpoint not found', 'NOT_FOUND', 404)
})
