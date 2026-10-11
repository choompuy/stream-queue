import { $ } from '../shared.js'

// The elements of index.html by id: dom.queueCount is document.getElementById('queueCount'), looked up when it is used,
// so nothing has to be listed here. html.test.js checks that every id the scripts use is on the page.
export const dom = new Proxy({}, { get: (_target, id) => (typeof id === 'string' ? $(id) : undefined) })
