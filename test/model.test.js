/**
 * The node model, driven against **real manifests and the real planner**.
 *
 * A hand-written fixture would let this file agree with itself about what a port
 * is. The manifests are the ones on disk and `plan()` is the function the kernel
 * runs, so a picture that disagrees with what a device would actually wire fails
 * here rather than on a screen.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const fs = require('bare-fs')
const path = require('bare-path')

const { model, around, collapse, targetsOf, kindOf } = require('../lib/model')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

/**
 * The directory the sibling repositories sit in.
 *
 * `path.join`, not a regular expression against the path. This read
 * `__dirname.replace(/\/artifact-graph\/test$/, '')`, which is a pattern only a
 * POSIX path can match: on Windows `__dirname` is separated by backslashes, so
 * the replace did nothing, the walk below listed this repository's own `test`
 * directory, and the first entry it tried to open was `package.json` —
 * `ENOTDIR`. Three suites here were green on a Mac and dead on Windows.
 */
const BESIDE = path.join(__dirname, '..', '..')

/** Every manifest beside this repository, by artifact name. */
function manifests () {
  /** @type {Record<string, any>} */
  const all = {}
  const here = BESIDE
  for (const dir of fs.readdirSync(here)) {
    const file = `${here}/${dir}/manifest.json`
    try {
      const m = JSON.parse(fs.readFileSync(file).toString())
      if (m && m.name) all[m.name] = m
    } catch { /* not an artifact, or not readable */ }
  }
  return all
}

const SET = manifests()

/** A wiring shaped like the QR network's: two shortlinks behind one studio. */
const WIRING = [
  { id: 'kit', artifact: 'kit', kind: 'kit', config: {}, bindings: {} },
  { id: 'qr', artifact: 'qr', kind: 'qr', config: {}, bindings: {} },
  { id: 'links-qr', artifact: 'shortlink', kind: 'shortlink', config: {}, bindings: {} },
  { id: 'links-go', artifact: 'shortlink', kind: 'shortlink', config: {}, bindings: {} },
  { id: 'scans', artifact: 'scans', kind: 'scans', config: {}, bindings: {} },
  {
    id: 'studio',
    artifact: 'studio',
    kind: 'studio',
    config: {},
    bindings: { kit: 'kit', encoder: 'qr', links: ['links-qr', 'links-go'], scans: 'scans' }
  }
]

/* ------------------------------------------------------------------------- */

it('the fixture is real, or the rest of this file is theatre', () => {
  assert.ok(Object.keys(SET).length > 20, `${Object.keys(SET).length} manifests found`)
  for (const name of ['studio', 'shortlink', 'kit', 'scans']) {
    assert.ok(SET[name], `${name} is not among the manifests read off disk`)
  }
})

it('one many port with two targets draws two edges from that port', () => {
  // The worked example the whole application exists for: a studio bound to two
  // shortlink instances has a spline from its links port to each.
  const g = model({ instances: WIRING, manifests: SET })
  const links = g.edges.filter((e) => e.from === 'studio' && e.port === 'links')
  assert.equal(links.length, 2, `${links.length} edges out of a two-target port`)
  assert.equal(links.map((e) => e.to).sort().join(','), 'links-go,links-qr')
  for (const edge of links) assert.equal(edge.contract, 'shortlink')
})

it('a platform port is a terminal, never a dangling edge', () => {
  // The runtime fills it and no binding names one. Drawing it as an unbound
  // socket would report every correctly-wired instance as half-connected.
  const g = model({ instances: WIRING, manifests: SET })
  const studio = /** @type {any} */ (g.nodes.find((n) => n.id === 'studio'))
  const listen = studio.ports.find((/** @type {any} */ p) => p.name === 'listen')

  assert.ok(listen, 'the studio has no listen port')
  assert.equal(listen.platform, true, 'a platform: contract was not marked as one')
  assert.equal(listen.targets.length, 0)
  assert.strictEqual(g.edges.some((e) => e.port === 'listen'), false, 'a platform port drew an edge')

  // And a real port that is simply unbound is *not* a platform port — the two
  // look the same on a node and mean completely different things.
  const image = studio.ports.find((/** @type {any} */ p) => p.name === 'image')
  assert.equal(image.platform, false)
  assert.equal(image.cardinality, 'optional', 'an unbound optional is how this stays legal')
})

it('an edge to an instance that does not exist is not an edge', () => {
  // The planner has already refused it. Drawing a spline into empty space would
  // be this file inventing a node the graph does not have.
  const g = model({
    instances: [{ id: 'studio', artifact: 'studio', kind: 'studio', config: {}, bindings: { kit: 'nowhere' } }],
    manifests: SET
  })
  assert.equal(g.edges.length, 0)
  const kit = /** @type {any} */ (g.nodes[0]).ports.find((/** @type {any} */ p) => p.name === 'kit')
  assert.equal(kit.targets.length, 0, 'a target nothing answers to was kept')
})

it('a port carries what the manifest says it is, not what the binding says', () => {
  // A binding says what a port points at. Only the manifest says what the port
  // *is* — its contract, its range, how many targets it takes.
  const g = model({ instances: WIRING, manifests: SET })
  const studio = /** @type {any} */ (g.nodes.find((n) => n.id === 'studio'))
  const links = studio.ports.find((/** @type {any} */ p) => p.name === 'links')

  assert.equal(links.contract, 'shortlink')
  assert.equal(links.cardinality, 'many')
  assert.ok(/^\^1\./.test(links.range), `the range came through as ${JSON.stringify(links.range)}`)
  assert.ok(links.description.length > 0, 'the port description was dropped')
})

it('a kind the instance does not name gives no ports rather than the wrong ones', () => {
  // Falling back to the first kind would draw ports the instance does not have.
  const g = model({
    instances: [{ id: 'odd', artifact: 'studio', kind: 'not-a-kind', config: {}, bindings: { kit: 'kit' } }],
    manifests: SET
  })
  assert.equal(/** @type {any} */ (g.nodes[0]).ports.length, 0)
  assert.equal(g.edges.length, 0)
})

it('problems land on the instance and on the exact port', () => {
  const g = model({
    instances: WIRING,
    manifests: SET,
    problems: [
      { code: 'unbound', instance: 'studio', port: 'links', path: ['studio'], message: 'nope' },
      { code: 'other', instance: 'studio', port: '', path: ['studio'], message: 'also nope' }
    ]
  })
  const studio = /** @type {any} */ (g.nodes.find((n) => n.id === 'studio'))
  assert.equal(studio.problems, 2, 'both faults did not land on the instance')
  assert.ok(g.edges.filter((e) => e.port === 'links').every((e) => e.broken), 'a faulted port drew sound edges')
  assert.strictEqual(g.edges.some((e) => e.port === 'kit' && e.broken), false, 'a fault spread to a port it was not on')
})

it('the same plan produces the same picture, whatever order it arrives in', () => {
  // Two runs over one plan have to produce one picture, or the canvas is a
  // different shape every time somebody opens it.
  const forwards = model({ instances: WIRING, manifests: SET })
  const backwards = model({ instances: [...WIRING].reverse(), manifests: SET })
  assert.equal(JSON.stringify(forwards), JSON.stringify(backwards))
})

it('a neighbourhood is counted in both directions', () => {
  // What this instance reaches and what reaches it are equally its
  // neighbourhood: somebody asking about a shortlink instance wants the studio
  // pointing at it as much as the store underneath it.
  const g = model({ instances: WIRING, manifests: SET })

  const one = around(g, 'links-qr', 1)
  assert.equal(one.nodes.map((n) => n.id).sort().join(','), 'links-qr,studio',
    'depth 1 is not exactly the direct neighbours')
  assert.strictEqual(one.missing, false)

  const two = around(g, 'links-qr', 2)
  assert.equal(two.nodes.length, WIRING.length, 'depth 2 did not reach everything through the studio')

  // Every edge has both ends inside. A line leaving the neighbourhood suggests a
  // node that is not on screen.
  for (const edge of two.edges) {
    assert.ok(two.nodes.some((n) => n.id === edge.from), `${edge.from} is an end with no node`)
    assert.ok(two.nodes.some((n) => n.id === edge.to), `${edge.to} is an end with no node`)
  }

  const nothing = around(g, 'never-existed', 2)
  assert.equal(nothing.missing, true)
  assert.equal(nothing.nodes.length, 0)
})

it('depth 0 is the node alone', () => {
  const g = model({ instances: WIRING, manifests: SET })
  const alone = around(g, 'studio', 0)
  assert.equal(alone.nodes.map((n) => n.id).join(','), 'studio')
  assert.equal(alone.edges.length, 0)
})

it('collapsing keeps what a group talks to and drops what it says to itself', () => {
  const g = model({ instances: WIRING, manifests: SET })
  const folded = collapse(g, ['shortlink'])

  const one = folded.nodes.find((/** @type {any} */ n) => n.id === 'artifact:shortlink')
  assert.ok(one, 'the two shortlink instances did not fold')
  assert.equal(/** @type {any} */ (one).held, 2, 'the folded node does not say how many it holds')
  assert.equal(/** @type {any} */ (one).ports.length, 0, 'a folded node kept a row of sockets that summarise nothing')

  // The studio still reaches it — once, not twice.
  const reaching = folded.edges.filter((/** @type {any} */ e) => e.to === 'artifact:shortlink' && e.port === 'links')
  assert.equal(reaching.length, 1, `${reaching.length} edges into a folded node`)

  // And folding nothing changes nothing.
  const untouched = collapse(g, [])
  assert.equal(untouched.nodes.length, g.nodes.length)
  assert.equal(untouched.edges.length, g.edges.length)
})

it('the three spellings of a binding are three different numbers of edges', () => {
  // A `one` port binds a string, a `many` port an array, and a port deliberately
  // left unbound binds null.
  assert.equal(targetsOf('a').join(','), 'a')
  assert.equal(targetsOf(['a', 'b']).join(','), 'a,b')
  assert.equal(targetsOf(null).length, 0)
  assert.equal(targetsOf(undefined).length, 0)
  assert.equal(targetsOf('').length, 0, 'an empty string is not a target')
  assert.equal(targetsOf([]).length, 0)
})

it('a manifest with one kind and an instance that named none is the ordinary case', () => {
  const one = { kinds: [{ key: 'only', ports: [], provides: [] }] }
  assert.ok(kindOf(one, ''), 'a single kind was not matched by an instance naming none')
  assert.strictEqual(kindOf(one, 'wrong'), null, 'a named kind that does not exist matched anyway')
  assert.strictEqual(kindOf({ kinds: [] }, ''), null)
  assert.strictEqual(kindOf(null, ''), null)
})

async function main () {
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
