import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRewardInput, toRewardDto } from '../../src/integrations/twitch/rewards.js'
import { INPUT_LIMITS } from '../../src/validate.js'
import type { TwitchCustomReward } from '../../src/integrations/twitch/types.js'

const create = (body: unknown) => parseRewardInput(body, { requireTitleAndCost: true })
const update = (body: unknown) => parseRewardInput(body, { requireTitleAndCost: false })

const off = { enabled: false, value: null }

test('a new reward', async (t) => {
  await t.test('needs a title and a cost, and a body that is not an object has neither', () => {
    assert.deepEqual(create({}).rejected, ['title', 'cost'])
    assert.deepEqual(create(null).rejected, ['title', 'cost'])
    assert.deepEqual(create('title').rejected, ['title', 'cost'])
  })

  await t.test('trims the title and keeps only what it needs', () => {
    assert.deepEqual(create({ title: '  Song request  ', cost: 100 }), { payload: { title: 'Song request', cost: 100 }, rejected: [] })
  })

  await t.test('names every wrong field at once, not the first one only', () => {
    const { rejected } = create({
      title: ' ',
      cost: 0,
      prompt: 'x'.repeat(201),
      backgroundColor: 'red',
      isEnabled: 'yes',
      limits: { maxPerStream: { enabled: true, value: null }, globalCooldownSeconds: { enabled: 'on', value: 5 } }
    })

    assert.deepEqual(rejected, ['title', 'cost', 'prompt', 'backgroundColor', 'isEnabled', 'limits.maxPerStream.value', 'limits.globalCooldownSeconds.enabled'])
  })

  await t.test('a prompt of the documented maximum length passes', () => {
    // the API reference caps the prompt at 200 characters - it was capped at 140 here before
    const { payload, rejected } = create({ title: 'a', cost: 1, prompt: 'x'.repeat(200) })

    assert.deepEqual(rejected, [])
    assert.equal(payload.prompt, 'x'.repeat(200))
  })

  await t.test('an empty prompt and an empty colour are nothing at all', () => {
    assert.deepEqual(create({ title: 'a', cost: 1, prompt: '  ', backgroundColor: '' }).payload, { title: 'a', cost: 1 })
  })
})

test('the title and the cost', async (t) => {
  await t.test('a title of 45 characters is fine, 46 is not', () => {
    assert.deepEqual(create({ title: 'x'.repeat(45), cost: 1 }).rejected, [])
    assert.deepEqual(create({ title: 'x'.repeat(46), cost: 1 }).rejected, ['title'])
  })

  await t.test('a cost is a whole number above 0: not a fraction, not zero, not text, not nothing', () => {
    for (const cost of [0, -5, 2.5, '100', null, Number.NaN]) assert.deepEqual(create({ title: 'a', cost }).rejected, ['cost'], String(cost))
    assert.deepEqual(create({ title: 'a', cost: 1 }).rejected, [])
  })

  await t.test('a cost over the sanity cap is refused by its own name, not left for Twitch to refuse', () => {
    assert.deepEqual(create({ title: 'a', cost: INPUT_LIMITS.rewardCost }).rejected, [])
    assert.deepEqual(create({ title: 'a', cost: INPUT_LIMITS.rewardCost + 1 }).rejected, ['cost'])
  })
})

test('an update', async (t) => {
  await t.test('changes only what it names', () => {
    assert.deepEqual(update({ cost: 50 }), { payload: { cost: 50 }, rejected: [] })
    assert.deepEqual(update({}), { payload: {}, rejected: [] })
  })

  await t.test('what it names has to be valid: a title that is empty or a cost that is empty is refused', () => {
    assert.deepEqual(update({ title: '' }).rejected, ['title'])
    assert.deepEqual(update({ cost: null }).rejected, ['cost'])
  })

  await t.test('an empty prompt is sent to clear the prompt of the reward', () => {
    assert.deepEqual(update({ prompt: '  ' }), { payload: { prompt: '' }, rejected: [] })
  })
})

test('the colour', async (t) => {
  await t.test('is taken with or without #, in any case, and sent as #RRGGBB', () => {
    assert.equal(update({ backgroundColor: 'ff00aa' }).payload.background_color, '#FF00AA')
    assert.equal(update({ backgroundColor: ' #ff00aa ' }).payload.background_color, '#FF00AA')
  })

  await t.test('is refused when it is not six hex digits', () => {
    for (const color of ['#fff', 'ff00a', 'gg00aa', '#ff00aa00', 7, null]) assert.deepEqual(update({ backgroundColor: color }).rejected, ['backgroundColor'], String(color))
  })
})

test('the limits', async (t) => {
  await t.test('a switch that is on sends its number, one that is off sends only the switch', () => {
    const { payload, rejected } = update({
      limits: {
        maxPerStream: { enabled: true, value: 10 },
        maxPerUserPerStream: { enabled: false, value: 3 },
        globalCooldownSeconds: { enabled: true, value: 60 }
      }
    })

    assert.deepEqual(rejected, [])
    assert.deepEqual(payload, {
      is_max_per_stream_enabled: true,
      max_per_stream: 10,
      is_max_per_user_per_stream_enabled: false,
      is_global_cooldown_enabled: true,
      global_cooldown_seconds: 60
    })
  })

  await t.test('a switch that is on needs a whole number above 0', () => {
    for (const value of [null, 0, 1.5, '5']) {
      assert.deepEqual(update({ limits: { maxPerStream: { enabled: true, value } } }).rejected, ['limits.maxPerStream.value'], String(value))
    }
  })

  await t.test('a limit over its cap is refused by its own name, not left for Twitch to refuse', () => {
    const caps = {
      maxPerStream: INPUT_LIMITS.rewardMaxPerStream,
      maxPerUserPerStream: INPUT_LIMITS.rewardMaxPerUserPerStream,
      globalCooldownSeconds: INPUT_LIMITS.rewardGlobalCooldownSeconds
    }

    assert.deepEqual(update({ limits: { maxPerStream: { enabled: true, value: caps.maxPerStream } } }).rejected, [])
    for (const [name, cap] of Object.entries(caps)) {
      assert.deepEqual(
        update({ limits: { [name]: { enabled: true, value: cap + 1 } } }).rejected,
        [`limits.${name}.value`],
        name
      )
    }
  })

  await t.test('a number behind a switch that is off is not looked at', () => {
    assert.deepEqual(update({ limits: { maxPerStream: { enabled: false, value: 'junk' } } }).rejected, [])
  })

  await t.test('a limit that is not an object, or has no boolean switch, is refused by the name of its switch', () => {
    assert.deepEqual(update({ limits: { maxPerStream: 5 } }).rejected, ['limits.maxPerStream.enabled'])
    assert.deepEqual(update({ limits: { maxPerStream: { value: 5 } } }).rejected, ['limits.maxPerStream.enabled'])
    assert.deepEqual(update({ limits: 'all' }).rejected, ['limits'])
  })
})

test('a reward as the panel gets it', async (t) => {
  const twitch = (extra: Partial<TwitchCustomReward> = {}): TwitchCustomReward => ({
    id: 'abc',
    title: 'Song',
    cost: 100,
    prompt: 'Paste a link',
    is_enabled: true,
    is_user_input_required: true,
    background_color: '#9146ff',
    ...extra
  })

  await t.test('takes the limits out of the *_setting objects of Twitch, and the number only while the switch is on', () => {
    const dto = toRewardDto(
      twitch({
        max_per_stream_setting: { is_enabled: true, max_per_stream: 10 },
        max_per_user_per_stream_setting: { is_enabled: false, max_per_user_per_stream: 3 },
        global_cooldown_setting: { is_enabled: true, global_cooldown_seconds: 60 }
      })
    )

    assert.deepEqual(dto, {
      id: 'abc',
      title: 'Song',
      cost: 100,
      prompt: 'Paste a link',
      backgroundColor: '#9146FF',
      isEnabled: true,
      limits: { maxPerStream: { enabled: true, value: 10 }, maxPerUserPerStream: off, globalCooldownSeconds: { enabled: true, value: 60 } }
    })
  })

  await t.test('a reward without limits, prompt and colour has them empty, not missing', () => {
    const dto = toRewardDto(twitch({ prompt: undefined as unknown as string, background_color: undefined, is_enabled: false }))

    assert.equal(dto.prompt, '')
    assert.equal(dto.backgroundColor, '')
    assert.equal(dto.isEnabled, false)
    assert.deepEqual(dto.limits, { maxPerStream: off, maxPerUserPerStream: off, globalCooldownSeconds: off })
  })

  await t.test('what the panel gets can be sent back as it is: it is valid', () => {
    const dto = toRewardDto(twitch({ max_per_stream_setting: { is_enabled: true, max_per_stream: 10 } }))
    const { id, ...body } = dto

    assert.ok(id)
    assert.deepEqual(update(body).rejected, [])
    assert.deepEqual(create(body).rejected, [])
  })
})
