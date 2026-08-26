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

const kit = require('artifact-kit').build({}, {})

const { layout, rankOf, heightOf, rowsOf, portAt, outAt, NODE } = require('../lib/layout')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

/** A node with `ports` named p0, p1, … so an index is checkable. */
const one = (/** @type {string} */ id, /** @type {number} */ ports = 0, /** @type {string} */ artifact = 'a') => ({
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
  const g = { nodes: [one('studio', 1), one('links')], edges: [edge('studio', 'p0', 'links')] }
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
    nodes: [one('a'), one('b', 1), one('c', 2)],
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
    nodes: [one('a', 1), one('b', 1)],
    edges: [edge('a', 'p0', 'b'), edge('b', 'p0', 'a')]
  }
  const out = layout(g)
  assert.equal(out.nodes.length, 2, 'the layout did not come back')
  assert.ok(out.back.size > 0, 'a cycle was ranked without any edge being marked as a back edge')
  const marked = out.edges.filter((/** @type {any} */ e) => e.back)
  assert.equal(marked.length, 1, `${marked.length} edges marked in a two-edge cycle`)
})

it('the same graph lays out the same way, whatever order it arrives in', () => {
  const nodes = [one('a'), one('b', 2), one('c', 1), one('d')]
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
  assert.ok(heightOf(one('x', 5)) > heightOf(one('x', 1)), 'ports do not make a node taller')
  assert.equal(heightOf(one('x', 0)), NODE.head + NODE.foot)

  const first = portAt(0)
  const second = portAt(1)
  assert.equal(second.y - first.y, NODE.port, 'two ports are not one row apart')
  assert.equal(first.x, 0, 'a port dot is not on the left edge')
})

it('an edge starts at its own port and ends on the provider', () => {
  const g = {
    nodes: [one('studio', 3), one('links')],
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
  const g = { nodes: [one('a'), one('b')], edges: [] }

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
  const g = { nodes: [one('a'), one('b', 4)], edges: [edge('b', 'p0', 'a')] }
  const out = layout(g)
  for (const n of out.nodes) {
    assert.ok(n.x + n.width <= out.width, `${n.id} sticks out to the right`)
    assert.ok(n.y + n.height <= out.height, `${n.id} sticks out of the bottom`)
  }
})

it('nothing in one rank sits on top of anything else in it', () => {
  const g = {
    nodes: [one('a'), one('b', 3), one('c', 1), one('d', 6)],
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

it('the kit draws every socket where this file says it is', async () => {
  // The case that was missing, and the bug it would have caught: the drawing put
  // its rows inside a positioned `<ul>` that sits below the header, while the
  // number written into each row already counted the header — so the offset was
  // applied twice and **every spline in every graph met its node 57 pixels above
  // the dot it came out of**. Both sides had a comment saying they used the same
  // two numbers. Neither had a case comparing them.
  //
  // This is that comparison: the layout computes a socket, the kit renders one,
  // and the two have to be the same pixel.
  const node = {
    ...one('studio', 3),
    outputs: [{ contract: 'cli', used: true }, { contract: 'view', used: false }]
  }
  const out = layout({ nodes: [node], edges: [] })
  const drawn = /** @type {any} */ (out.nodes[0])
  const html = await kit.component('graph', {
    id: 'g', nodes: out.nodes, edges: out.edges, width: out.width, height: out.height
  })

  /** The `top` the kit wrote for a row, by its data attribute. @param {string} sel */
  const topOf = (sel) => {
    const found = new RegExp(sel + '[^>]*style="top:(-?[0-9.]+)px"').exec(html)
    if (found === null) throw new Error(`the kit drew no row matching ${sel}`)
    return Number(found[1])
  }

  for (let i = 0; i < 3; i++) {
    assert.equal(topOf(`data-port="studio p${i}"`), portAt(i).y,
      `input ${i} is drawn at a different height than the spline aimed at it`)
  }
  for (const [i, contract] of ['cli', 'view'].entries()) {
    assert.equal(topOf(`data-out="studio ${contract}"`), outAt(drawn, i).y,
      `output ${contract} is drawn at a different height than the spline leaving it`)
  }

  // And the rows resolve against the node rather than against the list that
  // holds them, which is the half a `top` value cannot state on its own.
  const sheet = await kit.stylesheet()
  assert.ok(/\.k-graph-ports\{[^}]*position:static/.test(sheet),
    'the row list is positioned, so every row is offset by the header a second time')
})

it('an edge starts on a socket and ends on the matching one', async () => {
  // Not "on the provider's right edge somewhere". A node answering two contracts
  // put both edges at the same point, and a picture that draws two different
  // relationships in one place has stopped saying which is which.
  const provider = {
    ...one('links', 0),
    outputs: [{ contract: 'other', used: false }, { contract: 'shortlink', used: true }]
  }
  const consumer = one('studio', 2)
  consumer.ports[1].contract = 'shortlink'

  const out = layout({
    nodes: [provider, consumer],
    edges: [{ from: 'studio', port: 'p1', to: 'links', contract: 'shortlink', broken: false }]
  })
  const drawn = /** @type {any} */ (out.edges[0])
  const from = /** @type {any} */ (out.nodes.find((n) => n.id === 'studio'))
  const to = /** @type {any} */ (out.nodes.find((n) => n.id === 'links'))

  assert.equal(drawn.x1, from.x, 'the spline does not leave the consumer\'s left edge')
  assert.equal(drawn.y1, from.y + portAt(1).y, 'the spline does not leave its own port')

  // The *second* output, because that is the one on this contract.
  assert.equal(drawn.x2, to.x + to.width, 'the spline does not land on the provider\'s right edge')
  assert.equal(drawn.y2, to.y + outAt(to, 1).y, 'the spline landed on the wrong output')
  assert.notEqual(drawn.y2, to.y + to.height / 2, 'the spline still lands at the middle of the node')
})

it('a node is as tall as both its sides', async () => {
  const bare = { ...one('a', 0), outputs: [] }
  const takes = { ...one('b', 3), outputs: [] }
  const gives = { ...one('c', 0), outputs: [{ contract: 'x', used: false }] }
  const both = { ...one('d', 3), outputs: [{ contract: 'x', used: false }] }

  assert.equal(rowsOf(bare), 0)
  assert.equal(rowsOf(both), 4, 'the outputs are not counted as rows')
  assert.equal(heightOf(both), heightOf(takes) + NODE.port, 'an output does not make a node taller')
  assert.ok(heightOf(gives) > heightOf(bare), 'a node that gives something is no taller than one that gives nothing')

  // And an output row never lands on top of an input row.
  assert.ok(outAt(both, 0).y > portAt(2).y, 'the first output overlaps the last input')
  assert.equal(outAt(both, 0).y - portAt(2).y, NODE.port, 'the two sides are not one continuous pitch')
})

async function main () {
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
