import type { TwitchCreateCustomReward, TwitchCustomReward, TwitchUpdateCustomReward } from './types.js'
import { isPlain } from '../../persist.js'
import { INPUT_LIMITS } from '../../validate.js'

// What the panel sends and what it gets back is the same object, so a form can be filled with a reward and sent as it is
// (public/js/control/form.js: the name of an input is the path of its value in this object).
export type RewardLimit = { enabled: boolean; value: number | null }
export type RewardDto = {
  id: string
  title: string
  cost: number
  prompt: string
  backgroundColor: string
  isEnabled: boolean
  limits: {
    maxPerStream: RewardLimit
    maxPerUserPerStream: RewardLimit
    globalCooldownSeconds: RewardLimit
  }
}

const TITLE_MAX_LENGTH = INPUT_LIMITS.rewardTitle
const PROMPT_MAX_LENGTH = INPUT_LIMITS.rewardPrompt

// the name of a limit in the panel, the switch that Twitch has for it, and the number that goes with the switch
const LIMITS = [
  { name: 'maxPerStream', flag: 'is_max_per_stream_enabled', value: 'max_per_stream' },
  { name: 'maxPerUserPerStream', flag: 'is_max_per_user_per_stream_enabled', value: 'max_per_user_per_stream' },
  { name: 'globalCooldownSeconds', flag: 'is_global_cooldown_enabled', value: 'global_cooldown_seconds' }
] as const

export function toRewardDto(reward: TwitchCustomReward): RewardDto {
  const limit = (setting: { is_enabled: boolean } & Record<string, number | boolean> | undefined, value: string): RewardLimit => ({
    enabled: Boolean(setting?.is_enabled),
    value: setting?.is_enabled ? (setting[value] as number) || null : null
  })

  return {
    id: reward.id,
    title: reward.title,
    cost: reward.cost,
    prompt: reward.prompt || '',
    backgroundColor: (reward.background_color || '').toUpperCase(),
    isEnabled: Boolean(reward.is_enabled),
    limits: {
      maxPerStream: limit(reward.max_per_stream_setting, 'max_per_stream'),
      maxPerUserPerStream: limit(reward.max_per_user_per_stream_setting, 'max_per_user_per_stream'),
      globalCooldownSeconds: limit(reward.global_cooldown_setting, 'global_cooldown_seconds')
    }
  }
}

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1

/**
 * Turns what the panel sent into the body for Twitch, and says which fields are wrong: all of them at once, by their name in the
 * RewardDto ("title", "limits.maxPerStream.value"), so the panel can mark every one. A field that is absent is left out
 * (an update changes only what it names); `requireTitleAndCost` is for a new reward.
 */
export function parseRewardInput(
  body: unknown,
  { requireTitleAndCost }: { requireTitleAndCost: boolean }
): { payload: TwitchCreateCustomReward | TwitchUpdateCustomReward; rejected: string[] } {
  const input = isPlain(body) ? body : {}
  const payload: Record<string, string | number | boolean> = {}
  const rejected: string[] = []
  const reject = (name: string) => rejected.push(name)

  if (input.title !== undefined || requireTitleAndCost) {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (title && title.length <= TITLE_MAX_LENGTH) payload.title = title
    else reject('title')
  }

  if (input.cost !== undefined || requireTitleAndCost) {
    if (isPositiveInteger(input.cost)) payload.cost = input.cost
    else reject('cost')
  }

  if (input.prompt !== undefined) {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : null

    if (prompt === null || prompt.length > PROMPT_MAX_LENGTH) reject('prompt')
    // an empty prompt clears the one of an existing reward, and is nothing at all for a new one
    else if (prompt || !requireTitleAndCost) payload.prompt = prompt
  }

  if (input.backgroundColor !== undefined) {
    const color = typeof input.backgroundColor === 'string' ? input.backgroundColor.trim() : null
    const hex = color === null ? null : /^#?([0-9a-f]{6})$/i.exec(color)?.[1]

    if (color === null || (color && !hex)) reject('backgroundColor')
    else if (hex) payload.background_color = `#${hex.toUpperCase()}`
  }

  if (input.isEnabled !== undefined) {
    if (typeof input.isEnabled === 'boolean') payload.is_enabled = input.isEnabled
    else reject('isEnabled')
  }

  if (input.limits !== undefined && !isPlain(input.limits)) reject('limits')
  const limits = isPlain(input.limits) ? input.limits : {}

  for (const { name, flag, value } of LIMITS) {
    const limit = limits[name]
    if (limit === undefined) continue

    if (!isPlain(limit) || typeof limit.enabled !== 'boolean') {
      reject(`limits.${name}.enabled`)
      continue
    }

    payload[flag] = limit.enabled

    // the number counts only while its switch is on, and has to be a whole number above 0 then
    if (!limit.enabled) continue
    if (isPositiveInteger(limit.value)) payload[value] = limit.value
    else reject(`limits.${name}.value`)
  }

  return { payload, rejected }
}
