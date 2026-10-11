import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const jsdom = new JSDOM('<!doctype html><html><head></head><body></body></html>')

globalThis.window = jsdom.window
globalThis.document = jsdom.window.document

const scripts = () => [...document.head.querySelectorAll('script')]
const failLoading = () => scripts()[0].dispatchEvent(new jsdom.window.Event('error'))

test('loadYouTubeApi', async (t) => {
  await t.test('adds the API script once, however many callers ask', async () => {
    const { loadYouTubeApi } = await import('../../public/js/youtube-api.js?fresh')
    const ready = loadYouTubeApi()

    assert.equal(loadYouTubeApi(), ready)
    assert.equal(scripts().length, 1)
    assert.equal(scripts()[0].src, 'https://www.youtube.com/iframe_api')

    jsdom.window.YT = { Player: class {} }
    jsdom.window.onYouTubeIframeAPIReady()

    assert.equal(await ready, jsdom.window.YT)
  })

  await t.test('a failed load is tried again, with growing pauses', async () => {
    delete jsdom.window.YT
    scripts().forEach((tag) => tag.remove())
    mock.timers.enable({ apis: ['setTimeout'] })

    try {
      const { loadYouTubeApi } = await import('../../public/js/youtube-api.js?retry')
      loadYouTubeApi()
      assert.equal(scripts().length, 1)

      failLoading()
      assert.equal(scripts().length, 0, 'the failed tag is removed')
      mock.timers.tick(1999)
      assert.equal(scripts().length, 0)
      mock.timers.tick(1)
      assert.equal(scripts().length, 1, 'tried again after 2 s')

      failLoading()
      mock.timers.tick(3999)
      assert.equal(scripts().length, 0)
      mock.timers.tick(1)
      assert.equal(scripts().length, 1, 'then after 4 s')
    } finally {
      mock.timers.reset()
    }
  })

  await t.test('resolves at once when the API is already there, without adding a script', async () => {
    scripts().forEach((tag) => tag.remove())
    jsdom.window.YT = { Player: class {} }

    const { loadYouTubeApi } = await import('../../public/js/youtube-api.js?loaded')

    assert.equal(await loadYouTubeApi(), jsdom.window.YT)
    assert.equal(scripts().length, 0)
  })
})
