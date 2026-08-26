/**
 * The script, executed.
 *
 * A page whose script throws at load is a page where nothing works, and it looks
 * completely normal. This runs it against a document that records what it is
 * asked for, and then drives the three things nothing else in this repository
 * can check: the camera arithmetic, the drag, and the keyboard.
 *
 * The camera is worth the trouble. Pan, zoom and drag are the only real code on
 * this page and there is no library under them — every node editor worth copying
 * is React, which is unreachable from a page an artifact authored — so the
 * arithmetic here is the arithmetic, and a sign error in it is a canvas that runs
 * away from the pointer.
 */
const t = require('bare-tap')
const assert = require('bare-assert')

const kit = require('artifact-kit').build({}, {})

const { screen } = require('../lib/screen')
const { BEHAVIOUR } = require('../lib/behaviour')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

/**
 * A document with no layout, which records what the script asks of it.
 *
 * @param {string} html
 * @param {string[]} [extra]  selectors the fetched fragments would have added
 */
function fakeDocument (html, extra = []) {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
  // Both spellings. A valueless attribute — `data-aside`, `data-graph` — is a
  // real selector and matched nothing here, because the pattern required an `=`.
  // Every case that depended on one passed by not running.
  const data = new Set([...html.matchAll(/\s(data-[a-z-]+)(?=[=\s>])/g)].map((m) => m[1]))
  for (const one of extra) {
    const named = /\[(data-[a-z-]+)/.exec(one)
    if (named) data.add(named[1])
  }

  /** @type {{ calls: string[], fetches: { path: string, sent: any }[], fire?: any, at?: any }} */
  const seen = { calls: [], fetches: [] }
  /** @type {Map<string, Function>} */
  const handlers = new Map()

  /** @type {Map<string, any>} */
  const kept = new Map()

  const build = (/** @type {string} */ what) => {
    /** @type {any} */
    const el = {
      what,
      value: '',
      checked: false,
      hidden: false,
      textContent: '',
      innerHTML: '',
      options: [],
      selectedIndex: -1,
      clientWidth: 800,
      clientHeight: 600,
      // Everything the camera reads back off an element it moved.
      style: { left: '0px', top: '0px', width: '220px', height: '100px', transform: '' },
      attrs: /** @type {Record<string, string>} */ ({}),
      // Recorded rather than swallowed: a layout this page switches by class is a
      // layout no case could check against a fake that forgets.
      classes: /** @type {string[]} */ ([]),
      classList: {
        toggle (/** @type {string} */ c, /** @type {boolean} */ on) {
          const at = el.classes.indexOf(c)
          if (on === false || (on === undefined && at >= 0)) { if (at >= 0) el.classes.splice(at, 1) } else if (at < 0) el.classes.push(c)
        },
        add (/** @type {string} */ c) { if (!el.classes.includes(c)) el.classes.push(c) },
        remove (/** @type {string} */ c) { const at = el.classes.indexOf(c); if (at >= 0) el.classes.splice(at, 1) }
      },
      addEventListener (/** @type {string} */ event, /** @type {Function} */ fn) {
        seen.calls.push(what + ':' + event)
        handlers.set(what + ':' + event, fn)
      },
      removeAttribute (/** @type {string} */ a) { delete el.attrs[a] },
      setAttribute (/** @type {string} */ a, /** @type {string} */ v) { el.attrs[a] = v },
      getAttribute: (/** @type {string} */ a) => {
        if (a in el.attrs) return el.attrs[a]
        const named = new RegExp('\\[' + a + '="([^"]+)"').exec(what)
        if (named !== null) return named[1]
        // A bare `[data-view]` selector matched *something* on the page, so the
        // honest answer is the first value the page carries for that attribute.
        // Returning '' instead is a fake that makes every router look broken.
        if (what.includes('[' + a + ']')) {
          const first = new RegExp(a + '="([^"]+)"').exec(html)
          return first === null ? '' : first[1]
        }
        return ''
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture () {},
      releasePointerCapture () {},
      querySelector: (/** @type {string} */ q) => query(q),
      querySelectorAll: (/** @type {string} */ q) => queryAll(q),
      closest: (/** @type {string} */ q) => (what.includes(q.replace(/\[|\]/g, '')) ? el : null),
      focus () {},
      dispatchEvent () {}
    }
    return el
  }

  // One element per selector, kept — a fresh object per lookup is a page where
  // every control is permanently in its default state and no drag ever lands.
  const element = (/** @type {string} */ what, /** @type {number} */ nth = 0) => {
    const key = what + ' ' + nth
    if (!kept.has(key)) kept.set(key, build(what))
    return kept.get(key)
  }

  const matches = (/** @type {string} */ q) => {
    if (extra.includes(q)) return true
    const byValue = /\[(data-[a-z-]+)="([^"]*)"\]/.exec(q)
    if (byValue) {
      // The empty value has to be answered `false`, and a fake that answers it
      // by substring match answers `true` — every string contains ''. The router
      // asks `[data-view=""]` on a page with no address, and a yes there sends it
      // to a view that does not exist, silently, with nothing drawn. This fake
      // said yes for an afternoon.
      if (byValue[2] === '') return false
      return html.includes(byValue[1] + '="' + byValue[2] + '"') || extra.some((e) => e.includes(byValue[2]))
    }
    const byData = /\[(data-[a-z-]+)/.exec(q)
    if (byData) return data.has(byData[1])
    const byId = /^#([A-Za-z0-9_-]+)/.exec(q)
    if (byId) return ids.has(byId[1])
    return true
  }

  const query = (/** @type {string} */ q) => (matches(q) ? element(q) : null)
  const queryAll = (/** @type {string} */ q) => (matches(q) ? [element(q, 0), element(q, 1)] : [])

  const document = {
    getElementById: (/** @type {string} */ id) => (ids.has(id) ? element('#' + id) : null),
    querySelector: query,
    querySelectorAll: queryAll,
    addEventListener (/** @type {string} */ event, /** @type {Function} */ fn) {
      seen.calls.push('document:' + event)
      handlers.set('document:' + event, fn)
    },
    createElement: () => build('created')
  }

  seen.at = (/** @type {string} */ selector) => element(selector)
  seen.fire = (/** @type {string} */ key, /** @type {any} */ event) => {
    const fn = handlers.get(key)
    if (!fn) throw new Error('nothing listened for ' + key)
    return fn(event || { target: element(key.split(':')[0]) })
  }

  return { document, seen }
}

/**
 * Execute the script with a fake window around it.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {string} [opts.hash]
 * @param {string[]} [opts.extra]
 * @param {any} [opts.answer]
 */
function run (html, { hash = '', extra = [], answer = {} } = {}) {
  const { document, seen } = fakeDocument(html, extra)

  const fetch = (/** @type {string} */ path, /** @type {any} */ init) => {
    seen.fetches.push({ path, sent: JSON.parse((init && init.body) || '{}') })
    return Promise.resolve({
      json: () => Promise.resolve({ ok: true, html: '', note: '', nodes: 0, edges: 0, kept: true, ...answer })
    })
  }

  const window = {
    location: { hash },
    addEventListener: () => {},
    setTimeout: (/** @type {() => void} */ fn) => { fn(); return 0 },
    clearTimeout: () => {}
  }

  const go = new Function('document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'Event', BEHAVIOUR)
  go(document, window, fetch, (/** @type {() => void} */ fn) => { fn(); return 0 }, () => {},
    function Event () { return {} })

  return seen
}

/**
 * Let the load path's fetches settle.
 *
 * `draw()` paints only once its answer comes back, so a case that reads the
 * camera before the first drawing lands reads an unpainted one — which is the
 * page a person sees for a few milliseconds and never the page they use.
 */
const settle = () => new Promise((resolve) => setTimeout(() => resolve(null), 0))

/** The page every case below runs against. */
let HTML = ''

/** The selectors the canvas fragment adds once it has been fetched. */
const DRAWN = [
  '[data-graph-world]', '[data-graph-viewport]', '[data-graph-scale]',
  '[data-node]', '[data-edge]', '[data-node="studio"]'
]

/**
 * The value, or a failure that names what was missing.
 *
 * `assert.ok` proves a thing is there and does not narrow its type, so a case
 * that checks for something and then reads it needs a cast — and a cast in a
 * case reads as "trust me" exactly where the case is supposed to be checking.
 * This asserts and narrows in one.
 *
 * @template T
 * @param {T | null | undefined} value
 * @param {string} why
 * @returns {T}
 */
function must (value, why) {
  if (value === null || value === undefined) throw new Error(why)
  return value
}

/* ------------------------------------------------------------------------- */

it('the script runs to the end of its load path', async () => {
  const seen = run(HTML)
  // `route()` is the last thing the script does, and it draws — so a fetch of
  // the canvas is proof the whole file ran rather than throwing halfway.
  assert.ok(seen.fetches.some((f) => f.path === '/canvas'), seen.fetches.map((f) => f.path).join(', '))
  for (const event of ['document:click', 'document:pointerdown', 'document:pointermove', 'document:pointerup', 'document:keydown', 'document:wheel']) {
    assert.ok(seen.calls.includes(event), `nothing listened for ${event}`)
  }
})

it('an address decides which screen loads and what it asks for', async () => {
  const problems = run(HTML, { hash: '#/problems' })
  assert.ok(problems.fetches.some((f) => f.path === '/problems'), problems.fetches.map((f) => f.path).join(', '))
  assert.strictEqual(problems.fetches.some((f) => f.path === '/canvas'), false, 'the problems screen drew a canvas')

  const instances = run(HTML, { hash: '#/instances' })
  assert.ok(instances.fetches.some((f) => f.path === '/instances'))
})

it('a node address focuses the canvas rather than replacing it', async () => {
  // The reason a node is a panel and not a screen: the picture that shows why
  // you opened a node has to still be there when you do.
  const seen = run(HTML, { hash: '#/node/studio' })

  const canvas = must(seen.fetches.find((f) => f.path === '/canvas'), 'opening a node did not draw the canvas')
  assert.equal(canvas.sent.focus, 'studio', 'the canvas was drawn without the focus')

  const node = must(seen.fetches.find((f) => f.path === '/node'), 'opening a node did not open the node')
  assert.equal(node.sent.id, 'studio')
})

it('the rail opens on a node, closes on a list, and closes on Escape', async () => {
  // The rail is the other half of "the canvas is the panel": it is about what is
  // selected, so it has no width until something is — and it has to give the
  // width back, or the canvas stays 26rem short of the panel for the rest of the
  // session.
  const seen = run(HTML, { hash: '#/node/studio', extra: DRAWN, answer: { id: 'studio' } })
  await settle()

  // The checkbox is the state, the same as the left rail's — so `checked` is
  // collapsed and a selection un-checks it.
  assert.strictEqual(seen.at('#k-aside-toggle').checked, false, 'opening a node did not open the rail')
  assert.equal(seen.at('.k-sidebar-right [data-sidebar-name]').textContent, 'studio',
    'the rail does not name what it is about')

  // And it named *that* rail. Both rails are the same component, so both carry
  // the hook — and the unscoped query took the first one, which is the left: the
  // application's own name and network were overwritten with whichever node had
  // last been opened, on every selection.
  assert.strictEqual(seen.at('[data-sidebar-name]').textContent, '',
    'writing the right rail\'s brand reached into the left one')

  // Switching to a list closes it: there is no selected node on a table.
  const list = run(HTML, { hash: '#/instances', extra: DRAWN })
  await settle()
  assert.strictEqual(list.at('#k-aside-toggle').checked, true,
    'the rail stayed open on a screen with nothing selected')

  // And the canvas is only flush on the canvas.
  assert.strictEqual(list.at('.k-inset').classes.includes('k-inset-flush'), false,
    'a list of rows was given the canvas layout')
})

it('a filter is sent with every drawing, and a filter nobody set is empty', async () => {
  const seen = run(HTML)
  const canvas = must(seen.fetches.find((f) => f.path === '/canvas'), 'nothing drew the canvas')
  for (const key of ['focus', 'depth', 'artifact', 'find', 'fold', 'faults']) {
    assert.ok(key in canvas.sent, `the canvas was drawn without ${key}`)
  }
  assert.equal(canvas.sent.focus, '')
  assert.equal(canvas.sent.fold, '')
})

it('zooming keeps the point under the pointer under the pointer', async () => {
  // The arithmetic that makes a canvas feel steady. Zooming about the origin
  // instead is what makes one feel like it is running away from you.
  const seen = run(HTML, { extra: DRAWN })
  const world = seen.at('[data-graph-world]')

  /** The graph coordinate currently under a viewport point. @param {number} px @param {number} py */
  const under = (px, py) => {
    const m = must(/translate\((-?[0-9.]+)px,(-?[0-9.]+)px\) scale\(([0-9.]+)\)/.exec(world.style.transform),
      `no transform was painted: ${JSON.stringify(world.style.transform)}`)
    const [x, y, scale] = m.slice(1).map(Number)
    return { x: (px - x) / scale, y: (py - y) / scale }
  }

  seen.fire('document:wheel', {
    target: seen.at('[data-graph-viewport]'),
    deltaY: -1,
    clientX: 300,
    clientY: 200,
    preventDefault () {}
  })
  const before = under(300, 200)

  seen.fire('document:wheel', {
    target: seen.at('[data-graph-viewport]'),
    deltaY: -1,
    clientX: 300,
    clientY: 200,
    preventDefault () {}
  })
  const after = under(300, 200)

  assert.ok(Math.abs(after.x - before.x) < 0.001, `the point under the pointer moved from ${before.x} to ${after.x}`)
  assert.ok(Math.abs(after.y - before.y) < 0.001, `the point under the pointer moved from ${before.y} to ${after.y}`)
})

it('zoom stops rather than running to nothing or to everything', async () => {
  const seen = run(HTML, { extra: DRAWN })
  const world = seen.at('[data-graph-world]')
  const viewport = seen.at('[data-graph-viewport]')
  const scale = () => Number(must(/scale\(([0-9.]+)\)/.exec(world.style.transform), 'nothing painted a scale')[1])

  for (let i = 0; i < 60; i++) {
    seen.fire('document:wheel', { target: viewport, deltaY: -1, clientX: 0, clientY: 0, preventDefault () {} })
  }
  assert.ok(scale() <= 2, `zoomed in to ${scale()}`)

  for (let i = 0; i < 120; i++) {
    seen.fire('document:wheel', { target: viewport, deltaY: 1, clientX: 0, clientY: 0, preventDefault () {} })
  }
  assert.ok(scale() >= 0.2, `zoomed out to ${scale()}`)
})

it('a drag moves the node it grabbed and tells the store where it went', async () => {
  const seen = run(HTML, { extra: DRAWN })
  const node = seen.at('[data-node="studio"]')
  node.setAttribute('data-node', 'studio')

  seen.fire('document:pointerdown', { target: node, clientX: 100, clientY: 100, pointerId: 1 })
  seen.fire('document:pointermove', { target: node, clientX: 260, clientY: 180, pointerId: 1 })
  seen.fire('document:pointerup', { target: node, pointerId: 1 })

  assert.equal(node.style.left, '160px', `the node landed at ${node.style.left}`)
  assert.equal(node.style.top, '80px', `the node landed at ${node.style.top}`)

  const placed = must(seen.fetches.find((f) => f.path === '/place'), 'a drag was never told to anything')
  assert.equal(placed.sent.id, 'studio')
  assert.equal(placed.sent.x, 160)
})

it('a drag is not a click, and a click is not a drag', async () => {
  // A node opens its page on click. If a drag also counted as one, every
  // rearrangement would navigate away from the arrangement.
  const seen = run(HTML, { extra: DRAWN })
  const node = seen.at('[data-node="studio"]')
  node.setAttribute('data-node', 'studio')

  seen.fire('document:pointerdown', { target: node, clientX: 100, clientY: 100, pointerId: 1 })
  seen.fire('document:pointermove', { target: node, clientX: 260, clientY: 180, pointerId: 1 })

  const before = seen.fetches.filter((f) => f.path === '/node').length
  seen.fire('document:click', { target: node })
  assert.equal(seen.fetches.filter((f) => f.path === '/node').length, before,
    'a drag ended by opening the node it was moving')
})

it('the canvas can be driven with no pointer at all', async () => {
  // A canvas nobody can reach without a mouse is not finished.
  const seen = run(HTML, { extra: DRAWN })
  await settle()
  const world = seen.at('[data-graph-world]')
  const viewport = seen.at('[data-graph-viewport]')
  const at = () => must(/translate\((-?[0-9.]+)px,(-?[0-9.]+)px\)/.exec(world.style.transform),
    'nothing painted a position').slice(1).map(Number)

  const [x0, y0] = at()
  seen.fire('document:keydown', { target: viewport, key: 'ArrowRight', preventDefault () {} })
  const [x1] = at()
  assert.ok(x1 < x0, 'ArrowRight did not move the view')

  seen.fire('document:keydown', { target: viewport, key: 'ArrowDown', preventDefault () {} })
  assert.ok(at()[1] < y0, 'ArrowDown did not move the view')

  const scale = () => Number(must(/scale\(([0-9.]+)\)/.exec(world.style.transform), 'nothing painted a scale')[1])
  const before = scale()
  seen.fire('document:keydown', { target: viewport, key: '+', preventDefault () {} })
  assert.ok(scale() > before, '+ did not zoom in')
  seen.fire('document:keydown', { target: viewport, key: '-', preventDefault () {} })
  assert.ok(scale() < scale() + 1)
})

it('a spline follows the node it is attached to', async () => {
  // Recomputed on the page rather than refetched, because a round trip per
  // pointer move is a canvas that lags behind the hand — so the curve here has
  // to be the same curve the layout draws, or an edge would snap into a new
  // shape the moment anything redrew.
  const seen = run(HTML, { extra: DRAWN })
  const node = seen.at('[data-node="studio"]')
  node.setAttribute('data-node', 'studio')

  const edges = seen.at('[data-edge]')
  edges.setAttribute('data-edge', 'studio links links-qr shortlink')
  edges.setAttribute('d', 'M0 0C0 0 0 0 500 300')

  seen.fire('document:pointerdown', { target: node, clientX: 0, clientY: 0, pointerId: 1 })
  seen.fire('document:pointermove', { target: node, clientX: 400, clientY: 200, pointerId: 1 })

  const d = edges.getAttribute('d')
  assert.ok(d.startsWith('M400 '), `the spline did not follow its node: ${d}`)
  assert.ok(d.includes('C'), 'the spline stopped being a curve')
})

it('dragging a provider takes its edges with it, from the right socket', async () => {
  // The other end of the same problem. A dragged *consumer* moves the start of a
  // spline and a dragged *provider* moves its end — and which end, on a node
  // that answers to two contracts, is decided by the contract. That is why the
  // contract rides on the edge: the page has no graph to look it up in.
  const seen = run(HTML, { extra: [...DRAWN, '[data-out]', '[data-out="links-go shortlink"]'] })
  await settle()

  const node = seen.at('[data-node="studio"]')
  node.setAttribute('data-node', 'links-go')
  node.style.width = '220px'
  node.style.height = '160px'

  // The socket the contract lands on, 100px down the node.
  const socket = seen.at('[data-out="links-go shortlink"]')
  socket.style.top = '100px'

  const edge = seen.at('[data-edge]')
  edge.setAttribute('data-edge', 'studio links links-go shortlink')
  edge.setAttribute('d', 'M600 40C560 40 40 80 0 80')

  seen.fire('document:pointerdown', { target: node, clientX: 0, clientY: 0, pointerId: 1 })
  seen.fire('document:pointermove', { target: node, clientX: 300, clientY: 200, pointerId: 1 })

  const d = edge.getAttribute('d')
  const ends = /([0-9.]+) ([0-9.]+)$/.exec(d)
  if (ends === null) throw new Error(`the spline is not a curve any more: ${d}`)

  // Right edge of the node at its new place, and the socket's own row — not the
  // middle of the node, which is where this used to put every edge.
  assert.equal(Number(ends[1]), 300 + 220, `the spline ends at ${ends[1]}, not the node's right edge`)
  assert.equal(Number(ends[2]), 200 + 100, `the spline ends at ${ends[2]}, not on the socket`)
  assert.notEqual(Number(ends[2]), 200 + 80, 'the spline went back to the middle of the node')
})

async function main () {
  HTML = await screen({ kit, script: BEHAVIOUR, network: 'test', artifacts: ['kit', 'shortlink'] })
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
