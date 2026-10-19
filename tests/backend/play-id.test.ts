import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('../../src/queue.js')
const { getState } = await import('../../src/player.js')

const item = (videoId: string) => ({
  videoId,
  title: `Track ${videoId[0]}`,
  channelTitle: 'C',
  thumbnail: '',
  duration: 100,
  views: 1,
  url: 'u',
  requestedBy: 'someone'
})

test('the play id of the state', async (t) => {
  await t.test('is a new number for every track that starts, also when it is the same song again', () => {
    const first = queue.getPlayId()

    queue.setCurrent(item('aaaaaaaaaaa'))
    const a = queue.getPlayId()
    queue.setCurrent(item('aaaaaaaaaaa'))
    const again = queue.getPlayId()

    assert.notEqual(a, first)
    assert.notEqual(again, a)
  })

  await t.test('stays while the same track goes on: pausing, a state that is asked for again, the same item set again', () => {
    const playing = item('bbbbbbbbbbb')
    queue.setCurrent(playing)
    const id = getState().playId

    queue.setPaused(true)
    queue.setPaused(false)
    queue.setCurrent(playing)

    assert.equal(getState().playId, id)
    assert.equal(getState().playId, id)
  })

  await t.test('is not changed by nothing playing, and the next start is a new one', () => {
    queue.setCurrent(item('ccccccccccc'))
    const id = queue.getPlayId()

    queue.setCurrent(null)
    assert.equal(queue.getPlayId(), id)

    queue.setCurrent(item('ccccccccccc'))
    assert.notEqual(queue.getPlayId(), id)
  })
})
