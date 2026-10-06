import express from 'express'
import { hostCheck } from '../host-check.js'
import { handleEvents } from '../sse.js'

export const router = express.Router()

router.get('/events', hostCheck, (req, res) => {
  handleEvents(req, res)
})
