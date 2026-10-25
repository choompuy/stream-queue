import { $ } from '../shared.js'

// The elements of index.html by id: dom.queueCount is document.getElementById('queueCount'), looked up when it is used,
// so nothing has to be listed here. html.test.js checks that every id the scripts use is on the page.
// An element is looked up once, and again only when it is not on the page any more (or was not found)
const found = new Map()

export const dom = new Proxy(
  {},
  {
    get(_target, id) {
      if (typeof id !== 'string') return undefined

      if (!found.get(id)?.isConnected) found.set(id, $(id))
      return found.get(id)
    }
  }
)
