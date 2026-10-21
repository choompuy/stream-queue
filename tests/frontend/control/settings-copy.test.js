import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

const panel = setupPanel({ url: 'http://localhost:4747/' })

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const { copyOverlayUrl, renderOverlayUrl, renderQrUrl } = await import('../../../public/js/control/settings.js')

renderOverlayUrl()
const url = panel.$('#overlayUrl').href

const useClipboard = (clipboard) => Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true })

test('copying the overlay link', async (t) => {
  await t.test('uses the clipboard of the browser and says so', async () => {
    const written = []
    useClipboard({ writeText: async (text) => written.push(text) })

    await copyOverlayUrl()

    assert.deepEqual(written, [url])
    assert.ok(panel.toasts().includes('Copied'))
  })

  await t.test('selects and copies the text where the browser has no clipboard (a page opened by the LAN address)', async () => {
    useClipboard(undefined)
    const commands = []
    document.execCommand = (name) => commands.push(name) > 0

    await copyOverlayUrl()

    assert.deepEqual(commands, ['copy'])
    assert.equal(window.getSelection().toString(), panel.$('#overlayUrl').textContent)
  })

  await t.test('says so when it cannot copy, whichever way it tried', async () => {
    useClipboard({ writeText: async () => Promise.reject(new Error('denied')) })
    await copyOverlayUrl()
    assert.ok(panel.toasts().includes('Could not copy: select the link and copy it by hand'))

    // the same message is not shown twice at once, so what is checked here is that the refused command ended in the message too
    useClipboard(undefined)
    let tried = 0
    document.execCommand = () => (tried++, false)
    const copied = () => panel.toasts().filter((text) => text === 'Copied').length
    const before = copied()

    await copyOverlayUrl()

    assert.equal(tried, 1)
    assert.equal(copied(), before, 'a copy that was refused does not say "Copied"')
  })
})

test('the QR code', async (t) => {
  await t.test('a script that did not load is tried again the next time, and the failure is not left unhandled', async () => {
    state.selectedIp = '192.168.0.5'
    state.network = { ips: ['192.168.0.5'], port: 4747 }
    panel.$('#controlPanelQr').classList.remove('hidden')

    let loads = 0
    document.head.appendChild = (script) => {
      loads++
      queueMicrotask(() => script.onerror())
      return script
    }

    await renderQrUrl()
    await renderQrUrl()

    assert.equal(loads, 2)
  })
})
