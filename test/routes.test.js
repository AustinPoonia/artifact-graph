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
  const here = __dirname.replace(/\/artifact-graph\/test$/, '')
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

  const missing = await post(a, '/node', { document: document(), id: 'nowhere' })
  assert.ok(missing.body.html.includes('No such instance'))
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
