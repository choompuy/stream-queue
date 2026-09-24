import express from 'express'
import { fail } from '../http.js'
import { router as systemRouter } from './system.js'
import { router as settingsRouter } from './settings.js'
import { router as playlistsRouter } from './playlists.js'
import { router as blocklistRouter } from './blocklist.js'
import { router as searchRouter } from './search.js'
import { router as activityRouter } from './activity.js'
import { router as queueRouter } from './queue.js'
import { router as playerRouter } from './player.js'
import { router as fallbackRouter } from './fallback.js'
import { router as chatRouter } from './chat.js'
import { router as twitchRouter } from './twitch.js'

export const apiRouter = express.Router()

apiRouter.use(systemRouter)
apiRouter.use(settingsRouter)

apiRouter.use('/playlists', playlistsRouter)
apiRouter.use('/blocklist', blocklistRouter)
apiRouter.use('/search', searchRouter)
apiRouter.use('/activity', activityRouter)
apiRouter.use('/queue', queueRouter)
apiRouter.use('/player', playerRouter)
apiRouter.use('/fallback', fallbackRouter)
apiRouter.use('/chat', chatRouter)
apiRouter.use('/integrations/twitch', twitchRouter)

apiRouter.use((_req, res) => {
  fail(res, 'API endpoint not found', 'NOT_FOUND', 404)
})
