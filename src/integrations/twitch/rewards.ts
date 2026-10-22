import type { TwitchCreateCustomReward, TwitchCustomReward, TwitchUpdateCustomReward } from './types.js'
import { isPlain } from '../../persist.js'
import { INPUT_LIMITS } from '../../validate.js'
import { field, rules, validateUpdates, type Schema } from '../../config-helper.js'

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
const COST_MAX = INPUT_LIMITS.rewardCost

// the name of a limit in the panel, the switch that Twitch has for it, the number that goes with the switch,
// and the app-side sanity cap for that number (see INPUT_LIMITS: Twitch documents the minimum only)
const LIMITS = [
  { name: 'maxPerStream', flag: 'is_max_per_stream_enabled', value: 'max_per_stream', cap: INPUT_LIMITS.rewardMaxPerStream },
  { name: 'maxPerUserPerStream', flag: 'is_max_per_user_per_stream_enabled', value: 'max_per_user_per_stream', cap: INPUT_LIMITS.rewardMaxPerUserPerStream },
  { name: 'globalCooldownSeconds', flag: 'is_global_cooldown_enabled', value: 'global_cooldown_seconds', cap: INPUT_LIMITS.rewardGlobalCooldownSeconds }
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

// The RewardDto fields as the one schema the config-helper machinery already runs: what survives is safe to
// send to Twitch. The limits group is built from the LIMITS table, so the caps live in one place.
const limitSchema = (cap: number): Schema => ({ enabled: rules.boolean, value: rules.integer(1, cap) })

const rewardInputSchema: Schema = {
  title: field({
    normalize: (v) => (typeof v === 'string' ? v.trim() : v),
    validate: (v) => typeof v === 'string' && v.length > 0 && v.length <= TITLE_MAX_LENGTH
  }),
  cost: rules.integer(1, COST_MAX),
  prompt: field({
    normalize: (v) => (typeof v === 'string' ? v.trim() : v),
    validate: (v) => typeof v === 'string' && v.length <= PROMPT_MAX_LENGTH
  }),
  // an empty colour means "no change of the colour" and stays what it is; anything else has to be six hex
  // digits, with or without the '#', and is normalized to the bare uppercase digits
  backgroundColor: field({
    normalize: (v) => {
      if (typeof v !== 'string') return v
      const trimmed = v.trim()
      const hex = /^#?([0-9a-f]{6})$/i.exec(trimmed)?.[1]
      return hex ? hex.toUpperCase() : trimmed
    },
    validate: (v) => typeof v === 'string' && (v === '' || /^[0-9A-F]{6}$/.test(v))
  }),
  isEnabled: rules.boolean,
  limits: Object.fromEntries(LIMITS.map(({ name, cap }) => [name, limitSchema(cap)]))
}

/**
 * Puts the limits in the shape their coupled rules can be expressed in: the number of a limit counts only
 * while its switch is on (junk behind a switch that is off is not looked at at all), and a limit that is
 * not an object, or has no boolean switch, is put behind the name of its switch, where the schema refuses it.
 */
function prepareLimits(raw: unknown): Record<string, unknown> | unknown {
  if (!isPlain(raw)) return raw

  const prepared: Record<string, unknown> = {}
  for (const { name } of LIMITS) {
    const limit = raw[name]
    if (limit === undefined) continue

    if (!isPlain(limit) || typeof limit.enabled !== 'boolean') {
      prepared[name] = isPlain(limit) ? { ...limit, enabled: limit.enabled } : { enabled: limit }
      continue
    }

    // the value is only looked at with the switch on - and has to be there then
    prepared[name] = limit.enabled ? { ...limit, value: limit.value } : { enabled: false }
  }
  return prepared
}

// The small camelCase to Twitch snake_case step: what the schema accepted is renamed and packed for Helix.

// The plain fields, copied only when they arrived as their type: an update changes only what it names
function plainFields(clean: Record<string, unknown>): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {}

  if (typeof clean.title === 'string') fields.title = clean.title
  if (typeof clean.cost === 'number') fields.cost = clean.cost
  if (typeof clean.backgroundColor === 'string' && clean.backgroundColor !== '') fields.background_color = `#${clean.backgroundColor}`
  if (typeof clean.isEnabled === 'boolean') fields.is_enabled = clean.isEnabled

  return fields
}

// An empty prompt is the one field that still means something: it clears the prompt of an existing reward,
// and is nothing at all for a new one
function promptField(clean: Record<string, unknown>, requireTitleAndCost: boolean): Record<string, string | number | boolean> {
  if (typeof clean.prompt !== 'string') return {}
  if (clean.prompt === '' && requireTitleAndCost) return {}
  return { prompt: clean.prompt }
}

// A limit's switch goes out as its flag, its number only with the switch on
function limitFlags(limits: Record<string, unknown>): Record<string, string | number | boolean> {
  const flags: Record<string, string | number | boolean> = {}

  for (const { name, flag, value: valueKey } of LIMITS) {
    const limit = limits[name]
    if (!isPlain(limit) || typeof limit.enabled !== 'boolean') continue

    flags[flag] = limit.enabled
    if (limit.enabled && typeof limit.value === 'number') flags[valueKey] = limit.value
  }

  return flags
}

function toRewardPayload(clean: Record<string, unknown>, requireTitleAndCost: boolean): TwitchUpdateCustomReward {
  const payload: Record<string, string | number | boolean> = {
    ...plainFields(clean),
    ...promptField(clean, requireTitleAndCost)
  }

  if (isPlain(clean.limits)) Object.assign(payload, limitFlags(clean.limits))

  return payload as TwitchUpdateCustomReward
}

/**
 * Turns what the panel sent into the body for Twitch, and says which fields are wrong: all of them at once, by their name in the
 * RewardDto ("title", "limits.maxPerStream.value"), so the panel can mark every one. A field that is absent is left out
 * (an update changes only what it names); `requireTitleAndCost` is for a new reward.
 */
export function parseRewardInput(
  body: unknown,
  { requireTitleAndCost }: { requireTitleAndCost: boolean }
): { payload: TwitchCreateCustomReward | TwitchUpdateCustomReward; rejected: string[] } {
  // a body that is not an object can name nothing at all: a new reward is told to be missing its two
  // required fields, an update simply changes nothing
  if (!isPlain(body)) {
    return { payload: {}, rejected: requireTitleAndCost ? ['title', 'cost'] : [] }
  }

  const prepared = body.limits === undefined ? body : { ...body, limits: prepareLimits(body.limits) }
  const { clean, rejected } = validateUpdates(rewardInputSchema, prepared)

  // a new reward needs a title and a cost however valid the rest of the body is
  if (requireTitleAndCost) {
    for (const name of ['title', 'cost'] as const) {
      if (!(name in clean) && !rejected.includes(name)) rejected.push(name)
    }
  }

  return { payload: toRewardPayload(clean, requireTitleAndCost), rejected }
}
