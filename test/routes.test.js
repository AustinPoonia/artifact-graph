/**
 * The routes, driven against **the real planner over the real manifests**.
 *
 * The whole design of this application rests on one claim: the picture agrees
 * with what a device would actually wire. A hand-written fixture cannot check
 * that — it would let this suite and this code agree with each other about what
 * a port is, while both disagreed with `plan()`. So the graph handed in here is
 * derived by `plan()` and faulted by `chain.validate()`, the same two functions
 * `artifact-operator network check` runs, over the manifests on disk.
 *
 * What that buys is the case at the bottom of this file, which requires the
 * drawn node and edge counts to equal what those functions returned. A picture
 * that disagrees with the planner fails here rather than on a screen.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const fs = require('bare-fs')
const path = require('bare-path')

const kit = require('artifact-kit').build({}, {})
const { plan, chain } = require('artifact-planner')
const { manifest: manifestOf } = require('artifact-protocol')

const { routes, CANVAS } = require('../lib/routes')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

/** A store, async like a real port — a synchronous fake hides a missing await. */
function memory () {
  /** @type {Record<string, string>} */
  const held = {}
  return {
    async get (/** @type {string} */ k) { return held[k] },
    async put (/** @type {string} */ k, /** @type {string} */ v) { held[k] = v; return true },
    async delete (/** @type {string} */ k) { delete held[k]; return true },
    async keys () { return Object.keys(held) }
  }
}

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

/**
 * Every manifest beside this repository, **parsed**.
 *
 * Parsed and not merely read, because `chain.validate` is not defined over raw
 * JSON: `contract.structure` emits `optional` unconditionally and `canonical`
 * refuses an undefined value, so a set read straight off disk makes the
 * validator throw `NOT_CANONICAL` rather than return a verdict.
 * `artifact-operator/lib/check.js` parses for the same reason, so this is what
 * the producer does rather than a convenience here.
 */
function manifests () {
  /** @type {Record<string, any>} */
  const all = {}
  const here = BESIDE
  for (const dir of fs.readdirSync(here)) {
    try {
      all[manifestOf.parse(JSON.parse(fs.readFileSync(`${here}/${dir}/manifest.json`).toString())).name] =
        manifestOf.parse(JSON.parse(fs.readFileSync(`${here}/${dir}/manifest.json`).toString()))
    } catch { /* not an artifact, or not one this tree can parse */ }
  }
  return all
}

const SET = manifests()

/**
 * An instance whose bindings are **total** over the ports its kind declares.
 *
 * The planner refuses anything less: an optional port left out is not "left
 * empty", it is unspelled, and a signed instance has to say which ports its
 * admin deliberately declined. Filling them here rather than typing them out
 * keeps the fixture honest against a manifest that gains a port tomorrow —
 * which is the version of this that would otherwise start failing for a reason
 * nothing in this file mentions.
 *
 * @param {string} id @param {string} artifact @param {Record<string, any>} [bindings]
 */
function wire (id, artifact, bindings = {}) {
  const kind = SET[artifact]?.kinds?.[0]
  /** @type {Record<string, any>} */
  const total = {}
  for (const port of kind?.ports ?? []) {
    // A platform port is filled by the runtime and named by nobody: binding one
    // is refused outright, which is the same rule `lib/model.js` draws as a
    // terminal rather than as a socket somebody forgot.
    if (port.contract.startsWith('platform:') || port.contract.startsWith('kernel:')) continue
    if (Object.prototype.hasOwnProperty.call(bindings, port.name)) {
      total[port.name] = bindings[port.name]
      continue
    }
    // A `one` port is left *out*, not spelled null: it has no unbound state, and
    // the planner derives it from the set. `optional` and `many` are the ports an
    // admin decides, and those have to be spelled — including the emptiness.
    if (port.cardinality === 'one') continue
    total[port.name] = port.cardinality === 'many' ? [] : null
  }
  return { id, artifact, kind: kind?.key ?? artifact, config: {}, bindings: total }
}

/** The wiring the whole application exists to draw: two shortlinks behind a studio. */
const WIRING = [
  wire('kit', 'kit'),
  wire('qr', 'qr'),
  wire('links-qr', 'shortlink'),
  wire('links-go', 'shortlink'),
  wire('scans', 'scans'),
  wire('studio', 'studio', { kit: 'kit', encoder: 'qr', links: ['links-qr', 'links-go'], scans: 'scans' })
]

/**
 * A document of the shape the operator hands over.
 *
 * @param {object} [opts]
 * @param {any[]} [opts.instances]
 * @param {string} [opts.mode]
 * @param {any[]} [opts.problems]
 */
function document (opts = {}) {
  const instances = opts.instances || WIRING
  return {
    network: 'test',
    mode: opts.mode || 'read',
    instances,
    manifests: SET,
    problems: opts.problems || chain.validate(SET, instances).problems
  }
}

/** @param {object} [opts] */
function app (opts = {}) {
  return routes({ kit, script: 'void 0', store: /** @type {any} */ (opts).store, title: 'Graph' })
}

/**
 * @param {any} a @param {string} path @param {any} [sent]
 */
async function post (a, path, sent) {
  const out = await a.handle({ method: 'POST', path, query: {}, body: JSON.stringify(sent || {}) })
  return { status: out.status, body: JSON.parse(out.body) }
}

/* ------------------------------------------------------------------------- */

it('the fixture is real, or every case below is theatre', async () => {
  assert.ok(Object.keys(SET).length > 20, `${Object.keys(SET).length} manifests parsed`)
  for (const name of ['studio', 'shortlink', 'kit', 'scans']) {
    assert.ok(SET[name], `${name} is not among the manifests this tree could parse`)
  }
  // And `validate` actually ran over them rather than throwing into a catch.
  const verdict = chain.validate(SET, WIRING)
  assert.ok(Array.isArray(verdict.problems), 'the planner returned no verdict')
})

it('a document arrives on a request and is what gets drawn', async () => {
  const a = app()
  // Before anything is handed over there is no graph, and the page says so
  // rather than drawing an empty canvas that reads as "nothing is connected".
  const empty = await post(a, '/canvas')
  assert.equal(empty.body.nodes, 0)
  assert.ok(empty.body.html.includes('No graph yet'), 'an ungiven graph did not say so')

  const given = await post(a, '/canvas', { document: document() })
  assert.equal(given.body.nodes, WIRING.length)
  assert.ok(given.body.edges > 0, 'a wired network drew no connections')
})

it('the drawing agrees with the planner about what is in the network', async () => {
  // The case this whole design is arranged around. `plan()` is what a device
  // runs, and if the canvas ever draws a different number of instances or
  // connections than the plan holds, the picture is lying about the network.
  const specs = plan(SET, { instances: WIRING })
  const a = app()
  const drawn = await post(a, '/canvas', { document: { ...document(), instances: specs } })

  assert.equal(drawn.body.nodes, specs.length,
    `the canvas drew ${drawn.body.nodes} nodes and the planner derived ${specs.length}`)

  // `plan()` derives the *whole* network from the artifact set, so this is not
  // the six instances above — it is every artifact in the tree, wired the way a
  // device would wire it, which is a far better fixture than six.
  assert.ok(specs.length > 20, `the planner derived ${specs.length} instances`)

  // An edge is a binding to another **instance**. `plan()` also fills every
  // platform port, and it fills them with capability targets — `@store:scans`,
  // `@network-view`, `@listen:graph` — which name no instance and can never be
  // one end of a spline. Counting those would make this assertion agree with a
  // canvas that drew a line into empty space.
  const ids = new Set(specs.map((/** @type {any} */ s) => s.id))
  const bound = specs.reduce((/** @type {number} */ total, /** @type {any} */ s) =>
    total + Object.values(s.bindings || {})
      .flatMap((v) => (Array.isArray(v) ? v : v === null || v === '' ? [] : [v]))
      .filter((v) => ids.has(v)).length, 0)
  assert.equal(drawn.body.edges, bound,
    `the canvas drew ${drawn.body.edges} connections and the plan holds ${bound} bindings between instances`)
  assert.ok(bound > 30, `only ${bound} bindings, which is too few for this to be measuring the real network`)
})

it('a focus is a neighbourhood, and its depth is what was asked for', async () => {
  const a = app()
  const doc = document()

  const one = await post(a, '/canvas', { document: doc, focus: 'links-qr', depth: 1 })
  assert.equal(one.body.nodes, 2, 'depth 1 is not exactly the node and its direct neighbours')
  assert.ok(one.body.note.includes('within 1 hop'), one.body.note)

  const two = await post(a, '/canvas', { document: doc, focus: 'links-qr', depth: 2 })
  assert.ok(two.body.nodes > one.body.nodes, 'depth 2 reached no further than depth 1')

  // A focus on nothing is the whole graph rather than an empty canvas: somebody
  // whose instance has been removed wants to see the network, not a blank page.
  const gone = await post(a, '/canvas', { document: doc, focus: 'never-existed', depth: 1 })
  assert.equal(gone.body.nodes, WIRING.length)
})

it('the ceiling is applied and stated, never applied quietly', async () => {
  // A cap nobody mentions reads as "that was the whole graph", which is the one
  // lie a map must not tell.
  const many = []
  for (let i = 0; i < CANVAS + 12; i++) {
    many.push(wire(`s${i}`, 'shortlink'))
  }
  const a = app()
  const out = await post(a, '/canvas', { document: document({ instances: many, problems: [] }) })

  assert.equal(out.body.nodes, CANVAS, `${out.body.nodes} nodes drawn against a ceiling of ${CANVAS}`)
  assert.equal(out.body.over, 12)
  assert.ok(out.body.note.includes('12 more'), out.body.note)

  // And the sentence before it does not say "all". It did: nothing was filtered,
  // so the note opened with `All 132 instances` beside a canvas holding 120, and
  // the honest half after it did not undo the dishonest half before it.
  assert.strictEqual(out.body.note.includes('All '), false, out.body.note)
  assert.ok(out.body.note.includes(`${CANVAS} of 132`), out.body.note)
})

it('what the ceiling keeps is what somebody most needs to see', async () => {
  const many = []
  for (let i = 0; i < CANVAS + 5; i++) {
    many.push(wire(`s${i}`, 'shortlink'))
  }
  // Five faults, on the five instances a plain slice would have dropped.
  const problems = many.slice(-5).map((s) => ({
    code: 'MADE_UP', instance: s.id, port: '', path: [s.id], message: 'something is wrong here'
  }))

  const a = app()
  await post(a, '/canvas', { document: document({ instances: many, problems }) })
  const shown = await post(a, '/canvas', { document: document({ instances: many, problems }), faults: 'on' })
  assert.equal(shown.body.nodes, 5, 'the faulted instances were the ones dropped')
})

it('folding turns instances of one artifact into one node that says how many', async () => {
  const a = app()
  const out = await post(a, '/canvas', { document: document(), fold: 'on' })
  assert.ok(out.body.nodes < WIRING.length, 'nothing folded')
  assert.ok(out.body.note.includes('folded'), out.body.note)
})

it('a filter narrows, and every narrowing is named in the note', async () => {
  const a = app()
  const doc = document()

  const found = await post(a, '/canvas', { document: doc, find: 'links' })
  assert.equal(found.body.nodes, 2, `${found.body.nodes} matched "links"`)
  assert.ok(found.body.note.includes('"links"'), found.body.note)

  const one = await post(a, '/canvas', { document: doc, artifact: 'shortlink' })
  assert.equal(one.body.nodes, 2)
  assert.ok(one.body.note.includes('only shortlink'), one.body.note)

  // Nothing matched is said as such, rather than as an empty canvas.
  const none = await post(a, '/canvas', { document: doc, find: 'zzz' })
  assert.equal(none.body.nodes, 0)
  assert.ok(none.body.html.includes('Nothing matched'), 'an empty result did not say why')
})

it('a node page names its ports, what each reaches, and what fills a platform port', async () => {
  const a = app()
  const out = await post(a, '/node', { document: document(), id: 'studio' })

  assert.ok(out.body.html.includes('links'), 'the links port is not on the page')
  assert.ok(out.body.html.includes('links-qr') && out.body.html.includes('links-go'),
    'a many port did not name both of its targets')
  // A platform port is filled by the runtime and bound by nobody. Reporting it
  // as unbound would make every correctly-wired instance look half-connected.
  assert.ok(out.body.html.includes('the kernel'), 'a platform port was drawn as unbound')
  // And the word for it is not the word for an unbound optional, which is the
  // whole distinction: one is filled and the other is a decision somebody made.
  assert.ok(out.body.html.includes('>nothing<'), 'an unbound optional was not named')

  // Three columns in a 26rem rail, so every cell has to be short enough to
  // survive one: `.k-table td` is `white-space:nowrap`, and what it drops first
  // is the rightmost column — which is the one somebody opened the node to read.
  assert.strictEqual(out.body.html.includes('^1.1.0'), false,
    'the port table still carries a version range, which is the width `reaches` needs')

  const missing = await post(a, '/node', { document: document(), id: 'nowhere' })
  assert.ok(missing.body.html.includes('No such instance'))
})

it('a planning graph says what repointing costs, on the page where it would be done', async () => {
  // This was a banner above the canvas: always on screen, read once, and about
  // nothing in particular. It says something a person acts on, so it belongs
  // beside the ports they are looking at when they think about acting.
  const planning = app()
  const out = await post(planning, '/node', { document: document({ mode: 'plan' }), id: 'studio' })
  assert.ok(out.body.html.includes('never be reusable'), 'a planning node page does not say what a change costs')
  assert.ok(out.body.html.includes('studio'), 'the warning does not name the instance it is about')

  // And a read-only graph does not carry it, because there is nothing to plan.
  const reading = app()
  const quiet = await post(reading, '/node', { document: document({ mode: 'read' }), id: 'studio' })
  assert.strictEqual(quiet.body.html.includes('never be reusable'), false,
    'a read-only graph warned about a change it will not work out')
})

it('a port with a dozen targets is named and counted, not cut off mid-word', async () => {
  // `.k-table td` is `white-space:nowrap`, so a cell that is too long is clipped
  // rather than wrapped. An adapter's `apps` port rendered as
  // `campaigns, codes, grapl` — cut in the middle of a name, with nothing saying
  // eight more followed.
  const specs = plan(SET, { instances: WIRING })
  const adapter = /** @type {any} */ (specs.find((/** @type {any} */ s) => s.artifact === 'macos'))
  assert.ok(adapter, 'the planner derived no surface adapter to check this against')
  assert.ok(adapter.bindings.apps.length > 3, `the adapter binds ${adapter.bindings.apps.length} apps`)

  const a = app()
  const out = await post(a, '/node', { document: { ...document(), instances: specs }, id: adapter.id })
  assert.ok(out.body.html.includes(`+${adapter.bindings.apps.length - 2}`), 'the long list was not counted')

  // Two are still named. A count with no names is a cell that answers nothing.
  assert.ok(out.body.html.includes(adapter.bindings.apps[0]), 'no target was named at all')
})

it('the problems list is the planner\'s words, not this application\'s', async () => {
  const broken = [wire('studio', 'studio', { kit: 'kit' })]
  const problems = chain.validate(SET, broken).problems
  assert.ok(problems.length > 0, 'a studio bound to a missing kit produced no fault')

  const a = app()
  await post(a, '/canvas', { document: document({ instances: broken, problems }) })
  const out = await post(a, '/problems')

  for (const p of problems.slice(0, 3)) {
    assert.ok(out.body.html.includes(p.code), `${p.code} is not on the list`)
  }
})

it('a graph with nothing wrong says so rather than showing an empty table', async () => {
  const a = app()
  await post(a, '/canvas', { document: document({ problems: [] }) })
  const out = await post(a, '/problems')
  assert.ok(out.body.html.includes('Nothing wrong'), out.body.html.slice(0, 120))
})

it('a dragged position is kept, and a device with no store says so', async () => {
  const store = memory()
  const a = routes({ kit, script: 'void 0', store, title: 'Graph' })
  await post(a, '/canvas', { document: document() })

  const kept = await post(a, '/place', { id: 'studio', x: 900, y: 400 })
  assert.equal(kept.body.kept, true)

  // And it is used the next time the canvas is drawn — through the store rather
  // than through anything this object is holding in memory.
  const again = routes({ kit, script: 'void 0', store, title: 'Graph' })
  await post(again, '/canvas', { document: document() })
  const drawn = await post(again, '/canvas', { document: document() })
  assert.ok(drawn.body.html.includes('900'), 'the saved position was not used')

  const nowhere = app()
  const lost = await post(nowhere, '/place', { id: 'studio', x: 1, y: 2 })
  assert.equal(lost.body.kept, false)
  assert.ok(lost.body.why.length > 0, 'a drag was dropped without saying so')

  // Nonsense is not a position.
  const bad = await post(a, '/place', { id: 'studio', x: 'over there', y: null })
  assert.equal(bad.status, 400)
})

it('a block fills what has one answer and hands back what has a decision', async () => {
  const { needs } = require('../lib/model')

  // Nothing here names an artifact. The recipe is *derived*: a port wants a
  // contract and the manifests say who answers to it, which is the only way a
  // drawing tool can offer this without knowing what a QR studio is.
  const worked = needs({ manifests: SET, artifact: 'studio', kind: 'studio', present: [] })

  const made = worked.parts.map((/** @type {any} */ p) => p.artifact)
  assert.ok(made.includes('studio'), 'the block does not contain the thing it is a block of')
  assert.ok(made.length > 1, 'the block filled nothing, so it saved nobody anything')

  // Filled: a `one` port with exactly one candidate. Asking would be asking
  // somebody to confirm arithmetic.
  const kind = SET.studio.kinds[0]
  const forced = kind.ports.filter((/** @type {any} */ p) =>
    p.cardinality === 'one' && !String(p.contract).startsWith('platform:'))
  for (const port of forced) {
    assert.strictEqual(worked.expose.some((/** @type {any} */ e) => e.port === port.name), false,
      `${port.name} has one possible answer and the block asked about it anyway`)
  }

  // Handed back: every `many` and every `optional`, because both are decisions.
  const decided = kind.ports.filter((/** @type {any} */ p) =>
    p.cardinality !== 'one' && !String(p.contract).startsWith('platform:'))
  for (const port of decided) {
    assert.ok(worked.expose.some((/** @type {any} */ e) => e.port === port.name),
      `${port.name} is a decision and the block made it silently`)
  }

  // And a platform port is neither: the runtime fills it and nobody binds one.
  assert.strictEqual(worked.expose.some((/** @type {any} */ e) => e.contract.startsWith('platform:')), false,
    'the block offered a port the runtime fills')
  assert.strictEqual(
    worked.parts.some((/** @type {any} */ p) => Object.keys(p.bindings).some((n) => n === 'listen')), false,
    'the block bound a platform port'
  )
})

it('a block binds what is already running rather than copying it', async () => {
  const { needs } = require('../lib/model')

  // A block that placed its own private kit beside the one already running would
  // read as tidy and double the estate every time somebody used it.
  const present = [{ id: 'kit', provides: ['kit'] }, { id: 'qr', provides: ['qr-encoder'] }]
  const worked = needs({ manifests: SET, artifact: 'studio', kind: 'studio', present })

  assert.equal(worked.parts.length, 1, `it made ${worked.parts.map((/** @type {any} */ p) => p.artifact).join(', ')}`)
  assert.equal(worked.reused.length, 2, 'nothing already running was reused')
  assert.ok(worked.reused.some((/** @type {any} */ r) => r.id === 'kit'))

  // Two candidates is not one candidate: the block must not pick, because
  // picking silently is how a graph gets wired to whichever manifest sorted
  // first.
  const two = [{ id: 'kit', provides: ['kit'] }, { id: 'kit-b', provides: ['kit'] }]
  const split = needs({ manifests: SET, artifact: 'studio', kind: 'studio', present: two })
  const asked = split.expose.find((/** @type {any} */ e) => e.port === 'kit')
  if (asked === undefined) throw new Error('two candidates and the block still chose one')
  assert.ok(asked.candidates.includes('kit') && asked.candidates.includes('kit-b'), asked.candidates.join(', '))
})

it('a block is one node until somebody opens it, and it can be wired as one', async () => {
  const a = app()
  // A graph holding only a shortlink, so the block has prerequisites left to
  // fill: against the full fixture it correctly reuses the kit and the encoder
  // already running and comes to exactly one part, which is the *other* case.
  const doc = document({
    mode: 'plan',
    instances: WIRING.filter((/** @type {any} */ i) => i.id === 'links-qr'),
    problems: []
  })
  await post(a, '/canvas', { document: doc })

  const put = await post(a, '/draft', { document: doc, do: 'block', artifact: 'studio', kind: 'studio' })
  assert.equal(put.body.ok, true, put.body.why)
  assert.ok(put.body.parts > 1, `the block is ${put.body.parts} part`)
  assert.ok(put.body.commands.length === put.body.parts,
    `${put.body.parts} instances and ${put.body.commands.length} commands`)

  // Shut, it is one node. The parts are real instances and are drawn as such the
  // moment anybody opens it -- but a block that showed its own wiring by default
  // is a block that saved nobody anything.
  const shut = await post(a, '/canvas', { document: doc })
  const drawn = /<article[^>]*data-node="[^"]*"[\s\S]*?<\/article>/g
  const one = String(shut.body.html).match(drawn)
    ?.find((/** @type {string} */ a) => a.includes(`data-node="${put.body.block}"`))
  if (one === undefined) throw new Error('the block is not on the canvas')
  assert.ok(one.includes('k-graph-node-block'), 'a shut block is drawn as an ordinary node')
  assert.ok(one.includes('data-graph-into'), 'a block offers no way to look inside it')

  // Only the surface. A shut block showing the ports it filled for itself is a
  // block that saved nobody anything — and this failed exactly that way once,
  // because a block carries its main part's id and the fold skipped it.
  const ports = [...one.matchAll(/data-port="[^ ]+ ([a-z]+)"/g)].map((m) => m[1])
  assert.ok(ports.includes('links'), `the surface is missing links: ${ports.join(', ')}`)
  assert.strictEqual(ports.includes('encoder'), false, `a filled port is drawn on the surface: ${ports.join(', ')}`)
  assert.strictEqual(ports.includes('listen'), false, 'a platform port is drawn on the surface')

  const opened = await post(a, '/draft', { document: doc, do: 'open', block: put.body.block })
  assert.equal(opened.body.ok, true)
  const open = await post(a, '/canvas', { document: doc })
  assert.ok(open.body.nodes > shut.body.nodes,
    `shut drew ${shut.body.nodes} and open drew ${open.body.nodes}`)
  assert.equal(open.body.nodes - shut.body.nodes, put.body.parts - 1, 'opening did not reveal every part')

  // Shut again, and wire the block itself: the reader wires one node, and what
  // gets bound is an instance inside it.
  await post(a, '/draft', { document: doc, do: 'shut', block: put.body.block })
  const wired = await post(a, '/draft', { document: doc, do: 'wire', from: put.body.block, port: 'links', to: 'links-qr' })
  assert.equal(wired.body.ok, true, wired.body.why)
  const create = wired.body.commands.find((/** @type {string} */ c) => c.includes(`create ${put.body.block} `))
  assert.ok(/links=\[links-qr\]/.test(create), create)

  // A port the block filled for itself is not on its surface, so it cannot be
  // wired from outside -- which is the block keeping its own promise.
  const inside = await post(a, '/draft', { document: doc, do: 'wire', from: put.body.block, port: 'encoder', to: 'qr' })
  assert.equal(inside.body.ok, false, 'a port the block filled was wirable from outside')
})

it('placing a node draws it, marks it unsigned, and prints the create', async () => {
  const a = app()
  const doc = document({ mode: 'plan' })
  await post(a, '/canvas', { document: doc })

  const put = await post(a, '/draft', { document: doc, do: 'place', artifact: 'shortlink', kind: 'shortlink' })
  assert.equal(put.body.ok, true, put.body.why)
  assert.equal(put.body.drafts.length, 1)
  assert.equal(put.body.commands.length, 1)
  assert.ok(put.body.commands[0].startsWith('artifact-operator instance create shortlink shortlink'), put.body.commands[0])

  // Drawn, and drawn *differently*: a proposal rendered like a signed instance
  // is a map that has stopped being one.
  const drawn = await post(a, '/canvas', { document: doc })
  assert.equal(drawn.body.nodes, WIRING.length + 1, 'the placed node is not on the canvas')
  assert.ok(drawn.body.html.includes('k-graph-node-draft'), 'a placed node is drawn as though it were signed')

  // An id the network already holds is one `instance create` refuses, so the
  // drawer never hands out one.
  const again = await post(a, '/draft', { document: doc, do: 'place', artifact: 'shortlink', kind: 'shortlink' })
  const ids = again.body.drafts.map((/** @type {any} */ d) => d.id)
  assert.equal(new Set([...ids, ...WIRING.map((/** @type {any} */ i) => i.id)]).size,
    ids.length + WIRING.length, `two things share an id: ${ids.join(', ')}`)

  // Undo, and clear.
  const undone = await post(a, '/draft', { document: doc, do: 'undo' })
  assert.equal(undone.body.drafts.length, 1)
  const cleared = await post(a, '/draft', { document: doc, do: 'clear' })
  assert.equal(cleared.body.drafts.length, 0)
  assert.equal(cleared.body.commands.length, 0)
})

it('a wire is only a wire where the contract fits and nobody has signed it', async () => {
  const a = app()
  const doc = document({ mode: 'plan' })
  await post(a, '/canvas', { document: doc })
  await post(a, '/draft', { document: doc, do: 'place', artifact: 'studio', kind: 'studio' })
  await post(a, '/draft', { document: doc, do: 'place', artifact: 'shortlink', kind: 'shortlink' })

  // The wire that fits: a `many` port takes it, and the create carries it.
  const wired = await post(a, '/draft', { document: doc, do: 'wire', from: 'studio-2', port: 'links', to: 'shortlink' })
  assert.equal(wired.body.ok, true, wired.body.why)
  const create = wired.body.commands.find((/** @type {string} */ c) => c.includes('create studio-2'))
  assert.ok(/links=\[shortlink\]/.test(create), create)

  // Providers first. A create naming a draft that has not been created yet is a
  // command that fails on the line before it would have worked.
  const at = wired.body.commands.findIndex((/** @type {string} */ c) => c.includes('create shortlink'))
  const then = wired.body.commands.findIndex((/** @type {string} */ c) => c.includes('create studio-2'))
  assert.ok(at < then, `the create that binds runs first: ${wired.body.commands.join(' | ')}`)

  // The same wire twice is the same wire.
  const twice = await post(a, '/draft', { document: doc, do: 'wire', from: 'studio-2', port: 'links', to: 'shortlink' })
  const once = twice.body.commands.find((/** @type {string} */ c) => c.includes('create studio-2'))
  assert.ok(/links=\[shortlink\]/.test(once), once)

  // A dot that does not answer the contract is not a place a wire can land.
  const wrong = await post(a, '/draft', { document: doc, do: 'wire', from: 'studio-2', port: 'encoder', to: 'shortlink' })
  assert.equal(wrong.body.ok, false, 'any dot reached any dot')
  assert.ok(wrong.body.why.includes('does not answer to qr-encoder'), wrong.body.why)

  // A platform port is the runtime's, and there is nothing about it to wire.
  const runtime = await post(a, '/draft', { document: doc, do: 'wire', from: 'studio-2', port: 'listen', to: 'shortlink' })
  assert.equal(runtime.body.ok, false)
  assert.ok(runtime.body.why.includes('runtime'), runtime.body.why)

  // And the rule the tool exists to teach: a signed instance cannot be dragged
  // into a new shape, because rewiring one is a removal and a fresh id.
  const signed = await post(a, '/draft', { document: doc, do: 'wire', from: 'studio', port: 'links', to: 'links-qr' })
  assert.equal(signed.body.ok, false, 'a signed instance was rewired by dragging')
  assert.equal(signed.body.signed, true)
  assert.ok(signed.body.why.includes('removal and a fresh instance'), signed.body.why)
})

it('a read-only canvas has no drawer and no tools', async () => {
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'read' }) })

  const drawn = await post(a, '/canvas', { document: document({ mode: 'read' }), tool: 'place' })
  assert.strictEqual(drawn.body.html.includes('data-graph-tool'), false,
    'a read-only canvas offers operations it will refuse')
  assert.strictEqual(drawn.body.html.includes('data-graph-put'), false,
    'a read-only canvas offers a shelf of things that do nothing when picked up')

  const put = await post(a, '/draft', { do: 'place', artifact: 'shortlink', kind: 'shortlink' })
  assert.equal(put.body.ok, false, 'a read-only canvas placed a node anyway')
})

it('the drawer offers every kind, including ones nothing is running yet', async () => {
  const a = app()
  const doc = document({ mode: 'plan' })
  await post(a, '/canvas', { document: doc })
  const drawn = await post(a, '/canvas', { document: doc, tool: 'place' })

  assert.ok(drawn.body.html.includes('data-graph-put'), 'there is nothing to place')
  // Placing the *first* instance of something is the case that matters most, and
  // a drawer built from the drawing is the one that cannot offer it.
  const running = new Set(WIRING.map((/** @type {any} */ i) => i.artifact))
  const idle = Object.keys(SET).find((name) => !running.has(name) && (SET[name].kinds || []).length > 0)
  assert.ok(idle, 'every artifact in the fixture is already running, so this case checks nothing')
  assert.ok(drawn.body.html.includes(`data-graph-put="${idle}/`),
    `${idle} is not running and is not in the drawer`)
})

it('the mode is a ceiling the page cannot raise', async () => {
  // The whole authority model of this application in one case. `read` and `plan`
  // are what the producer was willing to hand over; a value set on the page is a
  // request, and the routes answer it.
  const reading = app()
  await post(reading, '/canvas', { document: document({ mode: 'read' }) })

  const up = await post(reading, '/mode', { want: 'plan' })
  assert.equal(up.body.ok, false, 'a read-only graph let the page promote itself')
  assert.equal(up.body.mode, 'read')
  assert.ok(up.body.why.includes('--plan'), up.body.why)

  // And the refusal is not cosmetic: the routes still refuse the work.
  const change = await post(reading, '/change', { instance: 'studio', port: 'links', targets: [] })
  assert.equal(change.body.ok, false, 'a graph that refused the mode did the work anyway')

  // Edit is refused on every document this platform produces, and the reason is
  // not "ask an administrator" — it is that there is nothing to ask for.
  const planning = app()
  await post(planning, '/canvas', { document: document({ mode: 'plan' }) })
  const edit = await post(planning, '/mode', { want: 'edit' })
  assert.equal(edit.body.ok, false, 'edit mode was granted')
  assert.ok(edit.body.why.includes('no key'), edit.body.why)

  // Lowering is always allowed, and it really lowers: a canvas set to read only
  // will not work a change out even though the document would permit it.
  const down = await post(planning, '/mode', { want: 'read' })
  assert.equal(down.body.ok, true, down.body.why)
  assert.equal(down.body.mode, 'read')
  const quiet = await post(planning, '/change', { instance: 'studio', port: 'links', targets: [] })
  assert.equal(quiet.body.ok, false, 'a canvas set to read only worked a change out')
  assert.ok(quiet.body.why.includes('Switch it to Plan'), quiet.body.why)

  // ...and is undone by the same menu, which the producer's refusal never is.
  const back = await post(planning, '/mode', { want: 'plan' })
  assert.equal(back.body.ok, true)
  const again = await post(planning, '/change', { instance: 'studio', port: 'links', targets: ['links-qr'] })
  assert.equal(again.body.ok, true, again.body.why)

  // A word nothing recognises is read-only, not a mode with authority nobody
  // defined.
  const nonsense = await post(planning, '/mode', { want: 'apply' })
  assert.equal(nonsense.status, 400, 'a mode nothing produces was accepted')
})

it('a resent document is not a new one, and a new one really is', async () => {
  // The producer sends the document with **every request**, so "a new document
  // arrived" cannot mean "a document arrived". It meant exactly that once: the
  // drafts were thrown away and the positions re-read on every click, and a node
  // placed on the canvas was gone before the next request could see it.
  const a = app()
  const doc = document({ mode: 'plan' })
  await post(a, '/canvas', { document: doc })
  await post(a, '/mode', { want: 'read' })

  const same = await post(a, '/canvas', { document: doc })
  assert.ok(same.status === 200)
  const kept = await post(a, '/change', { instance: 'studio', port: 'links', targets: ['links-qr'] })
  assert.equal(kept.body.ok, false, 'resending the same document threw away a choice somebody made')

  // A draft survives the resends too, which is the case that made this visible.
  await post(a, '/mode', { want: 'plan' })
  await post(a, '/draft', { document: doc, do: 'place', artifact: 'shortlink', kind: 'shortlink' })
  const still = await post(a, '/draft', { document: doc, do: 'undo' })
  assert.equal(still.body.drafts.length, 0, 'undo took away something already gone')

  await post(a, '/draft', { document: doc, do: 'place', artifact: 'shortlink', kind: 'shortlink' })
  const after = await post(a, '/canvas', { document: doc })
  assert.ok(after.body.nodes > WIRING.length, 'a placed node did not survive the next request')

  // And a genuinely different document resets both: the choice is about this
  // document, not about the session, or a canvas is quietly less than it was
  // handed.
  const fewer = document({ mode: 'plan', instances: WIRING.slice(0, 3), problems: [] })
  await post(a, '/mode', { want: 'read' })
  await post(a, '/canvas', { document: fewer })
  const fresh = await post(a, '/change', { instance: 'studio', port: 'links', targets: ['links-qr'] })
  assert.notEqual(fresh.body.why, 'This canvas is set to read only. Switch it to Plan to work a change out.',
    'a new document kept the old choice')
})

it('a node lists every setting its kind declares, not only the ones somebody set', async () => {
  const a = app()
  const out = await post(a, '/node', { document: document(), id: 'links-go' })

  // The fixture wires this instance with no config at all, which is exactly the
  // case the old panel drew as nothing: a kind with three settings nobody has
  // decided looked identical to a kind with no settings.
  const wired = WIRING.find((/** @type {any} */ i) => i.id === 'links-go')
  if (wired === undefined) throw new Error('the fixture has no links-go')
  assert.equal(Object.keys(wired.config || {}).length, 0, 'the fixture sets config, so this case is not measuring anything')

  const declared = SET.shortlink.kinds[0].config.fields
  const names = Object.keys(declared)
  assert.ok(names.length >= 2, `the shortlink kind declares ${names.length} settings, so this case checks little`)

  for (const name of names) {
    assert.ok(out.body.html.includes(`<td>${name}</td>`), `${name} is declared and is not on the panel`)
  }
  assert.ok(out.body.html.includes('not set'), 'a setting nobody decided does not say so')

  // And what each one is for, where a cell cannot wrap.
  const tips = [...out.body.html.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1])
  assert.ok(tips.some((t) => t.startsWith(names[0])), `no row says what ${names[0]} is: ${JSON.stringify(tips)}`)
})

it('a setting the kind does not declare is drawn, and marked', async () => {
  // The other direction, and the more interesting one: the planner refuses a
  // network carrying a setting nothing reads, so leaving it out of the picture
  // would hide the cause of a fault the same picture reports.
  const a = app()
  const bent = WIRING.map((/** @type {any} */ i) =>
    (i.id === 'links-go' ? { ...i, config: { ...i.config, nonsense: 'yes' } } : i))
  const out = await post(a, '/node', { document: document({ instances: bent, problems: [] }), id: 'links-go' })

  assert.ok(out.body.html.includes('nothing reads this'), 'an undeclared setting is drawn as though it were fine')
  assert.ok(out.body.html.includes('not declared'), 'nothing says the kind does not declare it')
  assert.ok(out.body.html.includes('yes'), 'the value nobody reads is not shown')
})

it('a folded node carries no settings, because two instances are two decisions', async () => {
  const a = app()
  const out = await post(a, '/canvas', { document: document(), fold: 'on' })
  assert.ok(out.body.nodes > 0)

  const { model, collapse } = require('../lib/model')
  const graph = model({ instances: WIRING, manifests: SET, problems: [] })
  const folded = collapse(graph, ['shortlink'])
  const one = folded.nodes.find((/** @type {any} */ n) => n.id === 'artifact:shortlink')
  if (one === undefined) throw new Error('nothing folded')
  assert.equal(one.settings.length, 0, 'a folded node shows one instance\'s settings as though they were both\'s')
})

it('a socket says what it is, in the manifest\'s own words', async () => {
  // The prose is handed over separately and that is not an arrangement anybody
  // chose: `manifest.parse` produces the canonical signing shape, which carries
  // no descriptions and no `contracts` at all. A drawing that wants to say what
  // a socket does cannot read it off the manifests it was given.
  const parsed = SET.studio
  assert.ok(parsed, 'the studio manifest is not in the fixture set')
  assert.strictEqual(
    (parsed.kinds[0].ports[0] || {}).description !== undefined, false,
    'a parsed manifest carries descriptions after all, and the whole prose channel can go'
  )

  const a = app()
  const doc = {
    ...document(),
    prose: {
      studio: {
        ports: { 'studio links': 'Where the short links live.\n\nA second paragraph nobody asked for.' },
        contracts: { view: 'What a window draws.' }
      }
    }
  }
  await post(a, '/canvas', { document: doc })
  const drawn = await post(a, '/canvas', { document: doc })

  assert.ok(drawn.body.html.includes('Where the short links live.'), 'the port says nothing about itself')
  assert.strictEqual(drawn.body.html.includes('A second paragraph'), false,
    'the whole description went into the tooltip, not the opening of it')

  // An output says what its contract is for, and the contract is almost never
  // declared by the artifact answering to it: the studio provides `view` and its
  // manifest declares no such contract, so a lookup in its own file finds
  // nothing every time. This is the assertion that fails if that lookup goes
  // back to being a local one.
  const owner = Object.keys(SET).find((name) =>
    (SET[name].contracts || []).some((/** @type {any} */ c) => c.id === 'cli'))
  assert.ok(owner, 'nothing in the fixture set declares the cli contract')
  assert.notEqual(owner, 'studio', 'the studio declares cli itself, so this case is not measuring the search')
  const said = SET[/** @type {string} */ (owner)].contracts
    .find((/** @type {any} */ c) => c.id === 'cli').shape.description
  const first = String(said).split('\n\n')[0].replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
  const sentence = first.length > 240 ? first.slice(0, first.search(/\.\s/) + 1) : first
  // Unescaped before comparing: these descriptions carry apostrophes, and the
  // page quite correctly writes them as entities.
  const plain = String(drawn.body.html).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  assert.ok(plain.includes(sentence.slice(0, 40)),
    `an output does not carry what its contract is for: looked for ${JSON.stringify(sentence.slice(0, 40))}`)

  // And a producer that sends none draws sockets with no tooltip rather than no
  // sockets, because the prose is the newest field on the document and an older
  // producer is a real thing.
  const quiet = await post(a, '/canvas', { document: document() })
  assert.ok(quiet.body.html.includes('data-port='), 'a document with no prose drew no ports')
  assert.strictEqual(quiet.body.html.includes('title=""'), false, 'a socket carries an empty tooltip')
})

it('adding an instance is a command, and an id the network has is refused here', async () => {
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'plan' }) })

  const out = await post(a, '/instance', { do: 'add', id: 'links-3', artifact: 'shortlink', kind: 'shortlink' })
  assert.equal(out.body.ok, true, out.body.why)
  assert.equal(out.body.commands.length, 1)
  assert.ok(out.body.commands[0].startsWith('artifact-operator instance create links-3 shortlink '),
    out.body.commands[0])

  // The refusal the operator would give, given here instead — because a page
  // that prints a command the operator refuses has taught the reader nothing
  // except to paste it and find out.
  const taken = await post(a, '/instance', { do: 'add', id: 'links-qr', artifact: 'shortlink', kind: 'shortlink' })
  assert.equal(taken.body.ok, false)
  assert.ok(taken.body.why.includes('already on this network'), taken.body.why)

  const nonsense = await post(a, '/instance', { do: 'add', id: 'x', artifact: 'shortlink', kind: 'not-a-kind' })
  assert.equal(nonsense.body.ok, false)
  assert.ok(nonsense.body.why.includes('no kind called not-a-kind'), nonsense.body.why)

  const unnamed = await post(a, '/instance', { do: 'add', id: '  ', artifact: 'shortlink', kind: 'shortlink' })
  assert.equal(unnamed.body.ok, false)
})

it('only the ports an admin decides are spelled on a create', async () => {
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'plan' }) })

  // The studio has an optional `image` and a `many` links, and a `one` encoder.
  // A `one` port has no unbound state — the planner derives it — so writing it
  // here would be inventing a decision nobody made.
  const out = await post(a, '/instance', { do: 'add', id: 'studio-2', artifact: 'studio', kind: 'studio' })
  assert.equal(out.body.ok, true, out.body.why)
  const named = out.body.decide.map((/** @type {any} */ p) => p.name)
  assert.ok(named.includes('links'), 'a many port is not among the ports to decide')
  assert.strictEqual(named.includes('encoder'), false, 'a one port is being asked about')
  assert.strictEqual(named.includes('listen'), false, 'a platform port is being asked about')

  const bind = /--bind '([^']*)'/.exec(out.body.commands[0])
  if (bind === null) throw new Error(`there are ports to decide and no --bind: ${out.body.commands[0]}`)
  assert.ok(bind[1].includes('links=[]'), `an empty many port is not spelled as a list: ${bind[1]}`)
  assert.ok(bind[1].includes('image=null'), `a declined optional port is not spelled null: ${bind[1]}`)
})

it('a removal says what it burns and who it breaks, before it is run', async () => {
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'plan' }) })

  const out = await post(a, '/instance', { do: 'remove', id: 'links-qr' })
  assert.equal(out.body.ok, true, out.body.why)
  assert.equal(out.body.burns, 'links-qr')
  assert.ok(out.body.commands[0].includes('--confirm links-qr'), out.body.commands[0])
  // The studio binds it, and saying so afterwards is a post-mortem.
  assert.ok(out.body.depend.includes('studio'), `nothing was named as depending on it: ${out.body.depend}`)
  assert.ok(out.body.why.includes('studio'), out.body.why)

  const nothing = await post(a, '/instance', { do: 'remove', id: 'never-existed' })
  assert.equal(nothing.body.ok, false)
})

it('a read-only document will not add or remove either', async () => {
  const reading = app()
  await post(reading, '/canvas', { document: document({ mode: 'read' }) })
  for (const sent of [{ do: 'add', id: 'x', artifact: 'shortlink', kind: 'shortlink' }, { do: 'remove', id: 'links-qr' }]) {
    const refused = await post(reading, '/instance', sent)
    assert.equal(refused.body.ok, false, `a read-only graph worked out a ${sent.do}`)
    assert.ok(refused.body.why.includes('read-only'), refused.body.why)
  }
})

it('a read-only document will not even work out a change', async () => {
  // The mode is a property of the document, so this application cannot grant
  // itself authority it was not handed.
  const reading = app()
  await post(reading, '/canvas', { document: document({ mode: 'read' }) })
  const refused = await post(reading, '/change', { instance: 'studio', port: 'links', targets: ['links-qr'] })
  assert.equal(refused.body.ok, false)
  assert.equal(refused.body.mode, 'read')
  assert.strictEqual('commands' in refused.body, false, 'a read-only graph handed back a command anyway')
})

it('a planned change is two commands, and it says what it burns', async () => {
  // There is no operation on this platform that edits a signed instance's
  // wiring. `instance create` refuses an id the network already has and
  // `instance remove` burns one permanently, so a change to one port is a
  // removal and a fresh instance under a different id — which is the sentence a
  // planned change has to lead with rather than hide.
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'plan' }) })
  const planned = await post(a, '/change', { instance: 'studio', port: 'links', targets: ['links-qr', 'links-go'] })

  assert.equal(planned.body.ok, true)
  assert.equal(planned.body.burns, 'studio')
  assert.equal(planned.body.commands.length, 2)
  assert.ok(planned.body.commands[0].startsWith('artifact-operator instance remove studio --confirm studio'),
    planned.body.commands[0])
  assert.ok(planned.body.commands[1].includes('instance create'), planned.body.commands[1])
  assert.ok(planned.body.why.includes('never be used again'), planned.body.why)
})

it('a binding is spelled the way the operator spells one, per cardinality', async () => {
  // `[a,b]` for a many port, a bare id for a `one`, and `null` for an optional
  // left empty — three spellings, because "no targets" and "no binding" are
  // different things and `args.bindings` distinguishes them. A comma-joined list
  // is what this printed first, and it is a line the operator refuses.
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'plan' }) })

  const many = await post(a, '/change', { instance: 'studio', port: 'links', targets: ['links-qr', 'links-go'] })
  assert.ok(many.body.commands[1].includes("--bind 'links=[links-qr,links-go]'"), many.body.commands[1])

  const emptied = await post(a, '/change', { instance: 'studio', port: 'links', targets: [] })
  assert.ok(emptied.body.commands[1].includes("--bind 'links=[]'"), emptied.body.commands[1])

  const single = await post(a, '/change', { instance: 'studio', port: 'encoder', targets: ['qr'] })
  assert.ok(single.body.commands[1].includes("--bind 'encoder=qr'"), single.body.commands[1])

  const declined = await post(a, '/change', { instance: 'studio', port: 'image', targets: [] })
  assert.ok(declined.body.commands[1].includes("--bind 'image=null'"), declined.body.commands[1])
})

it('a port an admin does not decide is not a port a change can name', async () => {
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'plan' }) })

  // Filled by the runtime, so there is nothing about it to decide.
  const platform = await post(a, '/change', { instance: 'studio', port: 'listen', targets: ['anything'] })
  assert.equal(platform.body.ok, false)
  assert.ok(platform.body.why.includes('runtime'), platform.body.why)

  const nonsense = await post(a, '/change', { instance: 'studio', port: 'not-a-port', targets: [] })
  assert.equal(nonsense.body.ok, false)
})

it('a mode nothing recognises is read, not the last one that was set', async () => {
  const a = app()
  await post(a, '/canvas', { document: document({ mode: 'plan' }) })
  await post(a, '/canvas', { document: { ...document(), mode: 'administrator' } })
  const out = await post(a, '/change', { instance: 'studio', port: 'links', targets: [] })
  assert.equal(out.body.mode, 'read', 'an unrecognised mode kept the authority of the last one')

  // `apply` is one of those unrecognised words, and deliberately: a mode that
  // signed something would need this artifact to hold a key, and what it would
  // sign is a removal that burns an id.
  await post(a, '/canvas', { document: { ...document(), mode: 'apply' } })
  const applied = await post(a, '/change', { instance: 'studio', port: 'links', targets: [] })
  assert.equal(applied.body.mode, 'read')
})

it('the page is served on GET and every other path is refused', async () => {
  const a = app()
  const page = await a.handle({ method: 'GET', path: '/', query: {}, body: '' })
  assert.equal(page.status, 200)
  assert.ok(page.body.includes('<!doctype html>') || page.body.includes('<!DOCTYPE html>'), page.body.slice(0, 60))

  const gone = await a.handle({ method: 'GET', path: '/canvas', query: {}, body: '' })
  assert.equal(gone.status, 404, 'a fragment answered a GET')

  const unknown = await a.handle({ method: 'POST', path: '/whatever', query: {}, body: '{}' })
  assert.equal(unknown.status, 404)
})

it('a body that is not JSON is an empty request rather than a throw', async () => {
  const a = app()
  const out = await a.handle({ method: 'POST', path: '/canvas', query: {}, body: 'not json at all' })
  assert.equal(out.status, 200)
})

async function main () {
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
