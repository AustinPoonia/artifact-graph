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

  /** @type {{ calls: string[], fetches: { path: string, sent: any }[], fire?: any, at?: any, where?: any,
   *   copied?: string[], selected?: number, nest?: any, listen?: any }} */
  const seen = { calls: [], fetches: [] }
  /** @type {Map<string, Function[]>} */
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
        const key = what + ':' + event
        const held = handlers.get(key)
        if (held) held.push(fn)
        else handlers.set(key, [fn])
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
      // Recorded rather than ignored: an element the page *makes* and hangs on
      // the document is one no selector in the markup can find, so the only way
      // a case can see it is to watch it being attached.
      children: /** @type {any[]} */ ([]),
      appendChild (/** @type {any} */ child) { el.children.push(child); return child },
      setPointerCapture () {},
      releasePointerCapture () {},
      querySelector: (/** @type {string} */ q) => query(q),
      querySelectorAll: (/** @type {string} */ q) => queryAll(q),
      // Real containment, because half of what this page does is decided by what
      // an element is *inside*: a port is inside a node, a drawer is inside the
      // viewport. Without it `closest` only ever matched the element itself, and
      // two cases about exactly that containment passed with the code deleted.
      ancestors: /** @type {any[]} */ ([]),
      closest: (/** @type {string} */ q) => {
        const want = q.replace(/\[|\]/g, '')
        // An attribute a case *set* counts as much as one in the selector the
        // element was built from. Without this an element is only ever what it
        // was named, so a second node in a case could never be a `[data-node]`
        // — and the case that needed one silently measured nothing.
        const is = (/** @type {any} */ one) =>
          String(one.what).includes(want) || Object.prototype.hasOwnProperty.call(one.attrs, want)
        if (is(el)) return el
        for (const up of el.ancestors) if (is(up)) return up
        return null
      },
      focus () {},
      opened: false,
      showModal () { el.opened = true; el.open = true },
      close () { el.open = false },
      scrollIntoView () {},
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
      // Appended, not replaced. A page may listen for one event more than once —
      // this one has two `keydown` handlers, a canvas camera and a command menu
      // — and a fake that keeps the last silently deleted the first. Every case
      // about panning went on passing until the second listener was added, and
      // then failed for a reason that had nothing to do with panning.
      seen.calls.push('document:' + event)
      const key = 'document:' + event
      const held = handlers.get(key)
      if (held) held.push(fn)
      else handlers.set(key, [fn])
    },
    createElement: () => build('created'),
    // The edges layer is SVG, so the page builds its live wire with the
    // namespaced call — a fake with only `createElement` throws the moment
    // anybody drags a wire.
    createElementNS: () => build('created-svg'),
    createRange: () => ({ selectNodeContents () {} }),
    // Through `element`, not `build`, so `seen.at('body')` is the same object the
    // page hung something on. A second one looks identical and has no children.
    get body () { return element('body') }
  }

  // Exposed so the *window*'s listeners land in the same map as the document's:
  // its `addEventListener` was `() => {}`, so the router's own `hashchange`
  // listener went nowhere and no case could drive the page the way the address
  // bar drives it.
  seen.listen = (/** @type {string} */ key, /** @type {Function} */ fn) => {
    seen.calls.push(key)
    const held = handlers.get(key)
    if (held) held.push(fn)
    else handlers.set(key, [fn])
  }

  seen.at = (/** @type {string} */ selector) => element(selector)
  /** Put one element inside others, outermost last. */
  seen.nest = (/** @type {string} */ selector, /** @type {string[]} */ within) => {
    element(selector).ancestors = within.map((/** @type {string} */ one) => element(one))
    return element(selector)
  }
  seen.fire = (/** @type {string} */ key, /** @type {any} */ event) => {
    const held = handlers.get(key)
    if (!held) throw new Error('nothing listened for ' + key)
    const sent = event || { target: element(key.split(':')[0]) }
    // Every listener, in the order they registered, exactly as a real target
    // dispatches. Returning the last one's value keeps the existing callers.
    let out
    for (const fn of held) out = fn(sent)
    return out
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
 * @param {boolean} [opts.clipboard]  false for a window that has none
 */
function run (html, { hash = '', extra = [], answer = {}, clipboard = true } = {}) {
  const { document, seen } = fakeDocument(html, extra)

  const fetch = (/** @type {string} */ path, /** @type {any} */ init) => {
    seen.fetches.push({ path, sent: JSON.parse((init && init.body) || '{}') })
    return Promise.resolve({
      json: () => Promise.resolve({ ok: true, html: '', note: '', nodes: 0, edges: 0, kept: true, ...answer })
    })
  }

  // Exposed, because a command that navigates is checked by where it navigated
  // to. The fake fires no `hashchange`, so `goTo` sets the address and the
  // router does not follow — which is the fake's limit, not the page's, and
  // asserting on the address rather than the fetch keeps the case about the
  // command instead of about the router.
  const where = { hash }
  seen.where = where
  const window = {
    location: where,
    // Recorded, not swallowed. This was `() => {}`, so the router's own
    // `hashchange` listener went nowhere and no case could drive the page the
    // way the address bar drives it — every navigation was checked by asserting
    // on the address and hoping.
    addEventListener (/** @type {string} */ event, /** @type {Function} */ fn) {
      seen.listen('window:' + event, fn)
    },
    setTimeout: (/** @type {() => void} */ fn) => { fn(); return 0 },
    clearTimeout: () => {},
    getSelection: () => ({ removeAllRanges () {}, addRange () { seen.selected = (seen.selected || 0) + 1 } })
  }

  /** What the page put on the clipboard, and how often it fell back to a selection. */
  const copied = /** @type {string[]} */ ([])
  seen.copied = copied
  seen.selected = 0

  // Passed in rather than left to the global, so a case can take it away. The
  // script names `navigator` and a browser always has one; this shadows it.
  const navigator = clipboard
    ? { clipboard: { writeText: (/** @type {string} */ what) => { copied.push(what); return Promise.resolve() } } }
    : {}

  const go = new Function('document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'Event', 'navigator', BEHAVIOUR)
  go(document, window, fetch, (/** @type {() => void} */ fn) => { fn(); return 0 }, () => {},
    function Event () { return {} }, navigator)

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
/** The same page under a document that may work a change out. */
let PLANNING = ''

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
  for (const key of ['focus', 'depth', 'artifact', 'fold', 'faults']) {
    assert.ok(key in canvas.sent, `the canvas was drawn without ${key}`)
  }
  assert.equal(canvas.sent.focus, '')
  assert.equal(canvas.sent.fold, '')

  // No `find`. Searching is the command menu, and it opens what you name rather
  // than narrowing the canvas — a box that filtered the drawing and a box that
  // jumped to a node were two answers to one question.
  assert.strictEqual('find' in canvas.sent, false, 'the canvas is still being drawn with a find filter')
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

it('the command menu opens, filters, and runs what an item names', async () => {
  const seen = run(HTML, { extra: [...DRAWN, '[data-command-item]', '[data-command-find]', '[data-command-group]', '[data-command-empty]'] })
  await settle()

  const box = seen.at('#palette')
  box.open = false
  seen.fire('document:click', { target: seen.at('#do-palette') })
  assert.strictEqual(box.calls, undefined)
  assert.ok(box.opened, 'the search button did not open the command menu')

  // ⌘K and Ctrl-K, because a command menu that only answers one of them is one
  // half of a keyboard's users cannot reach.
  box.opened = false
  box.open = false
  seen.fire('document:keydown', { key: 'k', metaKey: true, preventDefault () {} })
  assert.ok(box.opened, 'meta-K did not open it')
  box.opened = false
  box.open = false
  seen.fire('document:keydown', { key: 'k', ctrlKey: true, preventDefault () {} })
  assert.ok(box.opened, 'ctrl-K did not open it')

  // An item runs by what it says, not by where it is.
  const item = seen.at('[data-command-item]')
  item.setAttribute('data-run', 'open:studio')
  seen.fire('document:click', { target: item })
  assert.equal(seen.where.hash, '#/node/studio', `running an open command went to ${seen.where.hash}`)
  assert.strictEqual(box.open, false, 'the menu stayed open after running a command')

  // Clicking the grey outside it. A dialog paints its own backdrop and swallows
  // the click rather than dismissing itself, so this is the page's job — and the
  // tell is that the click lands on the dialog element, its children covering it
  // completely.
  box.open = true
  seen.fire('document:click', { target: box })
  assert.strictEqual(box.open, false, 'clicking outside the menu did not close it')

  // And a click *inside* it does not, or the menu closes on the way to an item.
  box.open = true
  seen.fire('document:click', { target: seen.at('[data-command-find]') })
  assert.strictEqual(box.open, true, 'clicking the search field closed the menu')
})

it('hovering a socket says what it is, and the browser is not asked to', async () => {
  const seen = run(HTML, { extra: [...DRAWN, '[data-tip]'] })
  await settle()

  const socket = seen.at('[data-tip]')
  socket.setAttribute('data-tip', 'links — wants shortlink ^1.3.0, takes any number.\n\nBound to links-qr.')
  socket.setAttribute('title', 'links — wants shortlink ^1.3.0, takes any number.\n\nBound to links-qr.')

  seen.fire('document:pointerover', { target: socket, clientX: 100, clientY: 120 })

  // The page draws it. The native one waits about a second before appearing,
  // which on a canvas somebody sweeps a pointer across means it mostly does not.
  const box = seen.at('body').children.find((/** @type {any} */ c) => c.classes.includes('k-tip') ||
    String(c.className || '') === 'k-tip')
  if (box === undefined) throw new Error('nothing was hung on the document to draw a tooltip in')
  assert.strictEqual(box.hidden, false, 'the tooltip stayed hidden')
  assert.ok(String(box.textContent).includes('takes any number'), `the tooltip says ${JSON.stringify(box.textContent)}`)

  // And the browser's own is taken off while ours is up, or a reader gets two
  // boxes saying the same thing.
  assert.strictEqual(socket.attrs.title, undefined, 'both tooltips are on at once')

  // It follows the pointer rather than sitting where the pointer entered.
  const was = box.style.left
  seen.fire('document:pointermove', { target: socket, clientX: 300, clientY: 320 })
  assert.notEqual(box.style.left, was, 'the tooltip did not follow the pointer')

  // Leaving puts the title back, so a page whose script stops working still has
  // the browser's.
  seen.fire('document:pointerout', { target: socket, relatedTarget: null })
  assert.strictEqual(box.hidden, true, 'the tooltip stayed up after the pointer left')
  assert.ok(socket.attrs.title, 'the browser tooltip was never put back')

  // A drag is not a read: a tooltip stuck to the pointer is in the way of the
  // thing it is about.
  seen.fire('document:pointerover', { target: socket, clientX: 100, clientY: 120 })
  assert.strictEqual(box.hidden, false)
  seen.fire('document:pointerdown', { target: socket, clientX: 100, clientY: 120, pointerId: 1 })
  assert.strictEqual(box.hidden, true, 'the tooltip survived a drag starting under it')
})

it('the drawer and the toolbar are not the canvas', async () => {
  // Both float *inside* the viewport, so a press on either was starting a pan:
  // dragging a kind out of the drawer panned the graph and carried nothing, and
  // pressing a tool nudged it sideways.
  const seen = run(PLANNING, { hash: '#/', extra: [...DRAWN, '[data-graph-put]', '[data-graph-tool]', '[data-graph-drawer]'] })
  await settle()

  const before = { ...seen.at('[data-graph-world]').style }
  // Inside the viewport, which is where it really is — that is the whole reason
  // a press on it was starting a pan.
  const put = seen.nest('[data-graph-put]', ['[data-graph-drawer]', '[data-graph-viewport]'])
  put.setAttribute('data-graph-put', 'shortlink/shortlink')

  seen.fire('document:pointerdown', { target: put, clientX: 100, clientY: 100, pointerId: 1 })
  seen.fire('document:pointermove', { target: put, clientX: 300, clientY: 260 })
  assert.equal(seen.at('[data-graph-world]').style.transform, before.transform,
    'dragging out of the drawer panned the canvas')

  // The drawer's own background too, not only its buttons: it is a panel with
  // gaps in it, and a press that lands between two kinds must not pan either.
  const shelf = seen.nest('[data-graph-drawer]', ['[data-graph-viewport]'])
  seen.fire('document:pointerdown', { target: shelf, clientX: 60, clientY: 300, pointerId: 2 })
  seen.fire('document:pointermove', { target: shelf, clientX: 500, clientY: 300 })
  assert.equal(seen.at('[data-graph-world]').style.transform, before.transform,
    'pressing the drawer itself panned the canvas')

  // And letting go over the canvas places it, at the pointer.
  seen.fire('document:pointerup', { target: seen.at('[data-graph-viewport]'), clientX: 300, clientY: 260 })
  await settle()

  // `block`, not `place`: what the drawer hands you is one artifact *and
  // everything it needs*, which is the whole reason somebody drags from a drawer
  // rather than wiring six prerequisites by hand.
  const placed = seen.fetches.filter((f) => f.path === '/draft' && f.sent.do === 'block')
  assert.equal(placed.length, 1, `the drop asked to place ${placed.length} times`)
  assert.equal(placed[0].sent.artifact, 'shortlink')
  assert.equal(placed[0].sent.kind, 'shortlink')
  assert.ok(Number.isFinite(placed[0].sent.x) && Number.isFinite(placed[0].sent.y), 'it landed nowhere in particular')
})

it('wiring does not pick the node up on the way past', async () => {
  // The port is *inside* the node, so a press on it was starting a node drag and
  // the gesture that begins a wire moved the thing the wire comes out of.
  const seen = run(PLANNING, { hash: '#/', extra: [...DRAWN, '[data-graph-tool]', '[data-answers]', '[data-graph-edges]'] })
  await settle()

  const tool = seen.at('[data-graph-tool]')
  tool.setAttribute('data-graph-tool', 'wire')
  seen.fire('document:click', { target: tool })
  await settle()

  const node = seen.at('[data-node]')
  node.setAttribute('data-node', 'studio-2')
  // A port is *inside* its node, which is why pressing one used to pick the node
  // up.
  const port = seen.nest('[data-port]', ['[data-node]', '[data-graph-viewport]'])
  port.setAttribute('data-port', 'studio-2 links')
  const was = node.style.left

  // A **drag**, which is the gesture everybody tries first — and which did
  // nothing at all when this was driven by clicks: a drag from a port to a node
  // fires its click on the nearest common ancestor, so a click handler never
  // sees the port the drag started from.
  const answers = seen.nest('[data-answers]', ['[data-graph-viewport]'])
  answers.setAttribute('data-node', 'links-qr')

  seen.fire('document:pointerdown', { target: port, clientX: 120, clientY: 140, pointerId: 1 })
  assert.equal(port.attrs['data-arm'], 'from', 'the port was not armed')

  // A wire that comes out of the socket and follows the pointer. Without it an
  // armed port is a dot that changed colour, and "I can highlight what I want to
  // wire but no wire comes out" is the whole of what the gesture looked like.
  const live = seen.at('[data-graph-edges]').children
    .find((/** @type {any} */ c) => c.attrs['data-graph-live'])
  if (live === undefined) throw new Error('nothing was drawn out of the armed port')
  assert.ok(String(live.attrs.class).includes('k-graph-edge-live'), live.attrs.class)

  seen.fire('document:pointermove', { target: port, clientX: 400, clientY: 400 })
  assert.equal(node.style.left, was, 'starting a wire dragged the node')
  assert.ok(String(live.attrs.d).length > 0, 'the wire does not follow the pointer')

  seen.fire('document:pointerup', { target: answers, clientX: 400, clientY: 400 })
  await settle()
  let wired = seen.fetches.filter((f) => f.path === '/draft' && f.sent.do === 'wire')
  assert.equal(wired.length, 1, `the drag asked to wire ${wired.length} times`)
  assert.equal(wired[0].sent.from, 'studio-2')
  assert.equal(wired[0].sent.port, 'links')
  assert.equal(wired[0].sent.to, 'links-qr')

  // And two presses, which is the same path: released on the node it started
  // from, a wire stays armed for the next one.
  seen.fire('document:pointerdown', { target: port, clientX: 120, clientY: 140, pointerId: 2 })
  seen.fire('document:pointerup', { target: port, clientX: 120, clientY: 140 })
  assert.equal(port.attrs['data-arm'], 'from', 'a press and release on the port let go of it')

  seen.fire('document:pointerdown', { target: answers, clientX: 400, clientY: 400, pointerId: 3 })
  seen.fire('document:pointerup', { target: answers, clientX: 400, clientY: 400 })
  await settle()
  wired = seen.fetches.filter((f) => f.path === '/draft' && f.sent.do === 'wire')
  assert.equal(wired.length, 2, `two presses asked to wire ${wired.length - 1} times`)

  // Dragged off and let go over nothing: the wire comes off. A press and release
  // that never moved is still the first half of two presses, so the two cannot
  // be told apart by where they end — only by whether the pointer went anywhere.
  const empty = seen.nest('[data-graph-world]', ['[data-graph-viewport]'])
  seen.fire('document:pointerdown', { target: port, clientX: 120, clientY: 140, pointerId: 4 })
  seen.fire('document:pointermove', { target: port, clientX: 700, clientY: 500 })
  seen.fire('document:pointerup', { target: empty, clientX: 700, clientY: 500 })
  await settle()

  const off = seen.fetches.filter((f) => f.path === '/draft' && f.sent.do === 'unwire')
  assert.equal(off.length, 1, `letting go over nothing asked to unwire ${off.length} times`)
  assert.equal(off[0].sent.from, 'studio-2')
  assert.equal(off[0].sent.port, 'links')

  // And a press that never moved keeps it armed rather than taking it off.
  seen.fire('document:pointerdown', { target: port, clientX: 120, clientY: 140, pointerId: 5 })
  seen.fire('document:pointerup', { target: port, clientX: 120, clientY: 140 })
  assert.equal(port.attrs['data-arm'], 'from', 'a press that never moved took the wire off')
  assert.equal(seen.fetches.filter((f) => f.path === '/draft' && f.sent.do === 'unwire').length, 1,
    'a press that never moved asked to unwire')
})

it('a block opens into its own canvas, and there is a way back out', async () => {
  const seen = run(PLANNING, { hash: '#/', extra: [...DRAWN, '[data-graph-into]'] })
  await settle()

  const into = seen.nest('[data-graph-into]', ['[data-node]', '[data-graph-viewport]'])
  into.setAttribute('data-graph-into', 'studio')
  into.setAttribute('aria-expanded', 'false')

  // Pressing it must not start a drag: it lives in a node's header, and the
  // header is the thing a drag picks up.
  const node = seen.at('[data-node]')
  const was = node.style.left
  seen.fire('document:pointerdown', { target: into, clientX: 40, clientY: 40, pointerId: 1 })
  seen.fire('document:pointermove', { target: into, clientX: 400, clientY: 400 })
  assert.equal(node.style.left, was, 'opening a block dragged the node it is on')

  seen.fire('document:click', { target: into })
  assert.equal(seen.where.hash, '#/block/studio', `it went to ${seen.where.hash}`)

  // The fake fires no hashchange, so the router is driven the way the address
  // bar would drive it.
  seen.fire('window:hashchange')
  await settle()

  const asked = seen.fetches.filter((f) => f.path === '/canvas' && f.sent.block === 'studio')
  assert.ok(asked.length > 0, 'going into a block drew the whole graph again')

  // And out. `Whole graph` is the only way back, because nothing on a block's
  // own canvas leads out of it.
  seen.fire('document:click', { target: seen.at('#do-out') })
  assert.equal(seen.where.hash, '#/canvas', `it came back to ${seen.where.hash}`)
})

it('a step moves the field it names and redraws', async () => {
  const seen = run(HTML, { extra: DRAWN })
  await settle()

  const field = seen.at('#depth')
  field.value = '1'
  field.min = '0'
  field.max = '3'

  const step = seen.at('[data-step]')
  step.setAttribute('data-step', '1')
  step.setAttribute('data-for', 'depth')
  const before = seen.fetches.filter((f) => f.path === '/canvas').length
  seen.fire('document:click', { target: step })
  assert.equal(field.value, '2', `the step left the field at ${field.value}`)
  assert.ok(seen.fetches.filter((f) => f.path === '/canvas').length > before, 'stepping did not redraw')

  // And it stops at the bounds rather than running past them: a depth of 4 is a
  // request the routes clamp anyway, so a control that offers it is lying.
  field.value = '3'
  seen.fire('document:click', { target: step })
  assert.equal(field.value, '3', 'the step went past max')

  step.setAttribute('data-step', '-1')
  field.value = '0'
  seen.fire('document:click', { target: step })
  assert.equal(field.value, '0', 'the step went below min')
})

it('adding is a form and removing is about the node that is open', async () => {
  const seen = run(PLANNING, { hash: '#/', extra: DRAWN, answer: { ok: true, commands: ['artifact-operator instance create a b c'], why: 'because' } })
  await settle()

  // `hidden` at rest is asserted over the markup in `test/screen.test.js`: this
  // fake builds every element the same way, so its idea of what starts hidden is
  // the fake's, not the page's.
  const panel = seen.at('#change-panel')
  const form = seen.at('#change-add')
  panel.hidden = true

  // Nothing is open, so a removal has nothing to be about and says so rather
  // than asking the reader to type an id they are looking at.
  const item = seen.at('[data-command-item]')
  item.setAttribute('data-run', 'remove')
  seen.fire('document:click', { target: item })
  assert.strictEqual(panel.hidden, true, 'a removal with nothing open opened the panel anyway')
  assert.strictEqual(seen.fetches.some((f) => f.path === '/instance'), false,
    'a removal with nothing open still asked what it would cost')
  assert.ok(String(seen.at('#said').textContent).length > 0, 'nothing was said about why nothing happened')

  // Adding needs nothing open, and is a form rather than a command that fires.
  item.setAttribute('data-run', 'add')
  seen.fire('document:click', { target: item })
  assert.strictEqual(panel.hidden, false, 'the add panel did not open')
  assert.strictEqual(form.hidden, false, 'the add form is hidden on an add')
  assert.strictEqual(seen.fetches.some((f) => f.path === '/instance'), false,
    'the page asked what an unnamed instance would cost before anybody typed one')

  // Nothing to copy before anything has been worked out.
  assert.strictEqual(seen.at('#do-copy').hidden, true, 'the copy button is offered with nothing to copy')

  seen.at('#new-id').value = 'links-3'
  seen.at('#new-kind').value = 'shortlink/shortlink'
  seen.fire('document:click', { target: seen.at('#do-change') })
  await settle()

  const asked = seen.fetches.filter((f) => f.path === '/instance')
  assert.equal(asked.length, 1, `the page asked ${asked.length} times`)
  assert.equal(asked[0].sent.do, 'add')
  assert.equal(asked[0].sent.id, 'links-3')
  // The one select carries both halves, and the page takes them apart.
  assert.equal(asked[0].sent.artifact, 'shortlink')
  assert.equal(asked[0].sent.kind, 'shortlink')
  assert.ok(String(seen.at('#change-out').innerHTML).includes('artifact-operator instance create'),
    'the command that came back was not printed')

  // Both commands at once, in the order they have to be run: copying them one at
  // a time is where somebody runs the removal and not the create.
  assert.strictEqual(seen.at('#do-copy').hidden, false, 'there is a command and no way to copy it')
  seen.fire('document:click', { target: seen.at('#do-copy') })
  const wrote = seen.copied || []
  assert.equal(wrote.length, 1, `the clipboard was written ${wrote.length} times`)
  assert.ok(wrote[0].includes('instance create'), wrote[0])

  // And closing it is a control, not a reload.
  seen.fire('document:click', { target: seen.at('#do-change-off') })
  assert.strictEqual(panel.hidden, true, 'the panel would not close')
  assert.strictEqual(seen.at('#do-copy').hidden, true, 'the copy button outlived what it would copy')
})

it('a window with no clipboard selects the commands instead of doing nothing', async () => {
  // `navigator.clipboard` is absent outside a secure context, and this
  // platform's own window is a bare-native WebView where `navigator.mediaDevices`
  // is absent rather than refused. A button that silently does nothing there is
  // worse than one that does something else.
  const seen = run(PLANNING, { hash: '#/', extra: DRAWN, clipboard: false, answer: { ok: true, commands: ['artifact-operator instance create a b c'], why: 'because' } })
  await settle()

  const item = seen.at('[data-command-item]')
  item.setAttribute('data-run', 'add')
  seen.fire('document:click', { target: item })
  seen.fire('document:click', { target: seen.at('#do-change') })
  await settle()

  seen.fire('document:click', { target: seen.at('#do-copy') })
  assert.ok((seen.selected || 0) > 0, 'nothing was selected and nothing was copied')
  assert.ok(String(seen.at('#said').textContent).toLowerCase().includes('copy it yourself'),
    `it said ${JSON.stringify(seen.at('#said').textContent)}`)
})

it('a removal is about the node the canvas has open', async () => {
  const seen = run(PLANNING, { hash: '#/node/links-qr', extra: DRAWN, answer: { ok: true, commands: ['artifact-operator instance remove links-qr --confirm links-qr'], burns: 'links-qr', why: 'it burns the id' } })
  await settle()

  const item = seen.at('[data-command-item]')
  item.setAttribute('data-run', 'remove')
  seen.fire('document:click', { target: item })
  await settle()

  const asked = seen.fetches.filter((f) => f.path === '/instance')
  assert.equal(asked.length, 1, `the page asked ${asked.length} times`)
  assert.equal(asked[0].sent.do, 'remove')
  assert.equal(asked[0].sent.id, 'links-qr', 'the removal was about something other than the open node')
  assert.strictEqual(seen.at('#change-add').hidden, true, 'the add form is on screen during a removal')
  assert.ok(String(seen.at('#change-out').innerHTML).includes('--confirm links-qr'),
    'the command that came back was not printed')
})

async function main () {
  const of = { kit, script: BEHAVIOUR, network: 'test', artifacts: ['kit', 'shortlink'] }
  HTML = await screen(of)
  PLANNING = await screen({
    ...of,
    mode: 'plan',
    kinds: [{ artifact: 'shortlink', kind: 'shortlink', label: 'shortlink · shortlink' }]
  })
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
