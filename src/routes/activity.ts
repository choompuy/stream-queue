import express from 'express'
import { ActivityResponse } from '../types.js'
import { ok } from '../http.js'
import { getActivity, clearActivity } from '../activity.js'

export const router = express.Router()

router.get('/', (_req, res) => {
  ok<ActivityResponse>(res, { entries: getActivity() })
})

router.post('/clear', (_req, res) => {
  clearActivity()
  ok<ActivityResponse>(res, { entries: getActivity() })
})
