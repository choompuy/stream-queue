import express from 'express'
import { ActivityResponse } from '../../shared/types.js'
import { ok } from '../router.js'
import { getActivity, clearActivity } from '../../core/activity/service.js'

export const router = express.Router()

router.get('/', (_req, res) => {
  ok<ActivityResponse>(res, { entries: getActivity() })
})

router.post('/clear', (_req, res) => {
  clearActivity()
  ok<ActivityResponse>(res, { entries: getActivity() })
})
