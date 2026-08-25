/**
 * Where the nodes go.
 *
 * The layout is a pure function and the promise it makes is that it is the
 * *same* pure function every time: a canvas that rearranges itself between
 * visits is one nobody builds a memory of. Most of this file is that promise,
 * asserted from several directions.
 */
const t = require('bare-tap')
const assert = require('bare-assert')

const { layout, rankOf, heightOf, portAt, NODE } = require('../lib/layout')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

/** A node with `ports` named p0, p1, … so an index is checkable. */
const node = (/** @type {string} */ id, /** @type {number} */ ports = 0, /** @type {string} */ artifact = 'a') => ({
  id,
  artifact,
  kind: 'k',
  config: {},
  provides: [],
  problems: 0,
  ports: Array.from({ length: ports }, (_, i) => ({
    name: `p${i}`, contract: 'c', range: '^1.0.0', cardinality: 'one', description: '', platform: false, targets: []
  }))
})

const edge = (/** @type {string} */ from, /** @type {string} */ port, /** @type {string} */ to) =>
  ({ from, port, to, contract: 'c', broken: false })

/* ------------------------------------------------------------------------- */

it('providers sit to the left of what consumes them', () => {
  // An edge runs consumer to provider and a consumer's ports are on its left,
  // so the thing a port reaches has to be further left than the port.
  const g = { nodes: [node('studio', 1), node('links')], edges: [edge('studio', 'p0', 'links')] }
  const out = layout(g)
  const studio = /** @type {any} */ (out.nodes.find((n) => n.id === 'studio'))
  const links = /** @type {any} */ (out.nodes.find((n) => n.id === 'links'))

  assert.ok(links.x < studio.x, `the provider is at ${links.x} and its consumer at ${studio.x}`)
  assert.equal(links.rank, 0)
  assert.equal(studio.rank, 1)
})

it('a node sits right of everything it depends on, not of the nearest one', () => {
  // Longest path rather than shortest. With shortest, `c` would land in rank 1
  // beside `b` and its edge would run backwards through a rank it should have
  // cleared.
  const g = {
    nodes: [node('a'), node('b', 1), node('c', 2)],
    edges: [edge('b', 'p0', 'a'), edge('c', 'p0', 'a'), edge('c', 'p1', 'b')]
  }
  const { rank } = rankOf(g)
  assert.equal(rank.get('a'), 0)
  assert.equal(rank.get('b'), 1)
  assert.equal(rank.get('c'), 2, `c ranked ${rank.get('c')}, which puts it level with something it depends on`)
})

it('a cycle terminates and is marked rather than pretended away', () => {
  // `chain.js` says plainly that a cycle is satisfiable, so the ranking cannot
  // assume a DAG. What it must not do is loop.
  const g = {
    nodes: [node('a', 1), node('b', 1)],
    edges: [edge('a', 'p0', 'b'), edge('b', 'p0', 'a')]
  }
  const out = layout(g)
  assert.equal(out.nodes.length, 2, 'the layout did not come back')
  assert.ok(out.back.size > 0, 'a cycle was ranked without any edge being marked as a back edge')
  const marked = out.edges.filter((/** @type {any} */ e) => e.back)
  assert.equal(marked.length, 1, `${marked.length} edges marked in a two-edge cycle`)
})

it('the same graph lays out the same way, whatever order it arrives in', () => {
  const nodes = [node('a'), node('b', 2), node('c', 1), node('d')]
  const edges = [edge('b', 'p0', 'a'), edge('b', 'p1', 'd'), edge('c', 'p0', 'a')]

  const forwards = layout({ nodes, edges })
  const backwards = layout({ nodes: [...nodes].reverse(), edges: [...edges].reverse() })

  const shape = (/** @type {any} */ out) => out.nodes
    .slice()
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.id < b.id ? -1 : 1))
    .map((/** @type {any} */ n) => `${n.id}@${n.x},${n.y}`)
    .join(' ')

  assert.equal(shape(forwards), shape(backwards))
  assert.equal(forwards.width, backwards.width)
  assert.equal(forwards.height, backwards.height)
})

it('a node is as tall as its ports, and a port dot is where both halves agree it is', () => {
  // The edges have to know where a port sits before anything is on screen, so
  // this is computed rather than measured — and it is computed once, so the dot
  // the page draws and the spline the layout draws cannot disagree.
  assert.ok(heightOf(node('x', 5)) > heightOf(node('x', 1)), 'ports do not make a node taller')
  assert.equal(heightOf(node('x', 0)), NODE.head + NODE.foot)

  const first = portAt(0)
  const second = portAt(1)
  assert.equal(second.y - first.y, NODE.port, 'two ports are not one row apart')
  assert.equal(first.x, 0, 'a port dot is not on the left edge')
})

it('an edge starts at its own port and ends on the provider', () => {
  const g = {
    nodes: [node('studio', 3), node('links')],
    edges: [edge('studio', 'p2', 'links')]
  }
  const out = layout(g)
  const studio = /** @type {any} */ (out.nodes.find((n) => n.id === 'studio'))
  const drawn = /** @type {any} */ (out.edges[0])

  // The third port, not the first — an edge that always left from the top would
  // make a node with nine ports unreadable.
  assert.equal(drawn.y1, studio.y + portAt(2).y, 'the spline did not leave from its own port')
  assert.equal(drawn.x1, studio.x, 'the spline did not leave from the left edge')

  const links = /** @type {any} */ (out.nodes.find((n) => n.id === 'links'))
  assert.equal(drawn.x2, links.x + links.width, 'the spline did not land on the provider\'s right edge')
})

it('a dragged position is used, and a stale one is ignored', () => {
  // Advisory, which settles the awkward case: a stale arrangement must never
  // hide a node that has appeared.
  const g = { nodes: [node('a'), node('b')], edges: [] }

  const moved = layout(g, { a: { x: 900, y: 400 } })
  const a = /** @type {any} */ (moved.nodes.find((n) => n.id === 'a'))
  assert.equal(a.x, 900)
  assert.equal(a.moved, true)

  // `b` has no saved place and still gets one.
  const b = /** @type {any} */ (moved.nodes.find((n) => n.id === 'b'))
  assert.equal(b.moved, false)
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'a node with no saved place got no place')

  // A saved place for a node that is gone changes nothing, and every node that
  // is here is still drawn.
  const stale = layout(g, { departed: { x: 5, y: 5 }, a: { x: 900, y: 400 } })
  assert.equal(stale.nodes.length, 2)
  assert.strictEqual(stale.nodes.some((/** @type {any} */ n) => n.id === 'departed'), false)

  // And nonsense is not a position.
  const bad = layout(g, { a: /** @type {any} */ ({ x: 'over there', y: null }) })
  assert.equal(/** @type {any} */ (bad.nodes.find((n) => n.id === 'a')).moved, false)
})

it('an empty graph is an empty layout rather than a throw', () => {
  const out = layout({ nodes: [], edges: [] })
  assert.equal(out.nodes.length, 0)
  assert.equal(out.width, 0)
  assert.equal(out.height, 0)
})

it('the canvas is as big as what is on it', () => {
  const g = { nodes: [node('a'), node('b', 4)], edges: [edge('b', 'p0', 'a')] }
  const out = layout(g)
  for (const n of out.nodes) {
    assert.ok(n.x + n.width <= out.width, `${n.id} sticks out to the right`)
    assert.ok(n.y + n.height <= out.height, `${n.id} sticks out of the bottom`)
  }
})

it('nothing in one rank sits on top of anything else in it', () => {
  const g = {
    nodes: [node('a'), node('b', 3), node('c', 1), node('d', 6)],
    edges: [edge('b', 'p0', 'a'), edge('c', 'p0', 'a'), edge('d', 'p0', 'a')]
  }
  const out = layout(g)
  /** @type {Map<number, any[]>} */
  const ranks = new Map()
  for (const n of out.nodes) {
    const held = ranks.get(n.rank)
    if (held) held.push(n)
    else ranks.set(n.rank, [n])
  }
  for (const [rank, all] of ranks) {
    const sorted = all.slice().sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i++) {
      const above = sorted[i - 1]
      assert.ok(above.y + above.height <= sorted[i].y,
        `${above.id} overlaps ${sorted[i].id} in rank ${rank}`)
    }
  }
})

async function main () {
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
