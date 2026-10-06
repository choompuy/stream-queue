import express from 'express'
import { ActivityResponse } from '../core/types.js'
import { ok } from '../http.js'
import { getActivity, clearActivity } from '../core/activity.js'

export const router = express.Router()

router.get('/', (_req, res) => {
  ok<ActivityResponse>(res, { entries: getActivity() })
})

router.post('/clear', (_req, res) => {
  clearActivity()
  ok<ActivityResponse>(res, { entries: getActivity() })
})
