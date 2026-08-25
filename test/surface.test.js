/**
 * What this artifact says about itself, against what it does.
 *
 * A manifest is the only thing an admin reads before signing an instance, and it
 * is the only thing a device reads before wiring one. Everywhere it disagrees
 * with the code, the disagreement is discovered on a machine.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const fs = require('bare-fs')

const graph = require('..')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

const MANIFEST = JSON.parse(fs.readFileSync(require.resolve('../manifest.json')).toString())
const PACKAGE = JSON.parse(fs.readFileSync(require.resolve('../package.json')).toString())
const KIND = MANIFEST.kinds[0]

const INDEX = fs.readFileSync(require.resolve('../index.js')).toString()

/** Everything under `lib/`, as one string — the pages, the model and the script. */
const LIB = ['model', 'layout', 'screen', 'routes', 'behaviour']
  .map((f) => fs.readFileSync(require.resolve(`../lib/${f}.js`)).toString())
  .join('\n')

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

it('every port the manifest declares is one the build actually takes', () => {
  // The two lists that have to be one list. A port declared and never destructured
  // is a capability an admin granted for nothing, which is the worst kind of
  // documentation error: it reads as a promise and it is a hole.
  const taken = must(/const \{ ([^}]+) \} = deps/.exec(INDEX),
    'build() does not destructure its deps, so this cannot be checked')

  const names = taken[1].split(',').map((s) => s.trim()).filter(Boolean).sort()
  const declared = KIND.ports.map((/** @type {any} */ p) => p.name).sort()
  assert.equal(names.join(','), declared.join(','))
})

it('the required ports are the ones nothing works without', () => {
  // `kit` because every element on every surface comes from it, and `listen`
  // because a canvas nobody can reach is not a canvas. Everything else is a
  // decision an operator gets to make, and the page says what is missing rather
  // than failing to load.
  const required = KIND.ports.filter((/** @type {any} */ p) => p.cardinality === 'one')
    .map((/** @type {any} */ p) => p.name).sort()
  assert.equal(required.join(','), 'kit,listen')

  const optional = KIND.ports.filter((/** @type {any} */ p) => p.cardinality === 'optional')
    .map((/** @type {any} */ p) => p.name).sort()
  assert.equal(optional.join(','), 'documents,store')
})

it('every component this draws is one the kit contract at the declared range names', () => {
  // The failure this catches is the one that shipped next door: a port range
  // written as the *artifact's* version rather than the contract's. `component`
  // takes a **closed enum**, so asking for one the resolved contract does not
  // name is refused at the call — and a range that admits an older declaration
  // is a page that half-renders on somebody else's device.
  // Read by path rather than resolved: a manifest is not a module, and
  // `artifact-kit`'s `exports` map does not publish one — which is right, and is
  // why every reader of one in this tree goes to the file.
  const kitManifest = JSON.parse(fs.readFileSync(`${__dirname}/../node_modules/artifact-kit/manifest.json`).toString())
  const declaration = kitManifest.contracts.find((/** @type {any} */ c) => c.id === 'kit')
  assert.ok(declaration, 'the kit declares no kit contract')

  const port = KIND.ports.find((/** @type {any} */ p) => p.name === 'kit')
  assert.equal(port.range, `^${declaration.version}`,
    `this asks for kit ${port.range} and the contract on disk is ${declaration.version}`)

  const named = declaration.shape.operations
    .find((/** @type {any} */ o) => o.name === 'component')
    .params[0].enum

  const used = new Set([...(LIB + INDEX).matchAll(/kit\.component\('([a-zA-Z]+)'/g)].map((m) => m[1]))
  assert.ok(used.has('graph'), 'nothing here draws a graph, which would make this whole artifact pointless')
  for (const one of used) {
    assert.ok(named.includes(one), `this draws a ${one} and the kit contract does not name one`)
  }
})

it('every contract this provides is one the surface answers', () => {
  const built = graph.build({ kit: {}, listen: {} }, {})
  const provided = KIND.provides.map((/** @type {any} */ p) => p.id).sort()
  assert.equal(provided.join(','), 'cli,view')

  // `cli@2.0.0` is a spec, and every action it names has to exist.
  assert.equal(typeof built.cli, 'function')
  for (const command of graph.SPEC.commands) {
    assert.equal(typeof (/** @type {any} */ (built))[command.action], 'function',
      `the spec names ${command.action} and the build has no such function`)
  }

  // `view@1.1.0` is two operations, and `handle` has to exist even though this
  // panel offers nothing to press.
  assert.equal(typeof built.view, 'function')
  assert.equal(typeof built.handle, 'function')
})

it('the config the manifest documents is the config the build reads', () => {
  const documented = Object.keys(KIND.config.fields).sort()
  const read = new Set([...INDEX.matchAll(/config(?:\.|\[')([a-z]+)/g)].map((m) => m[1]))
  for (const field of documented) {
    assert.ok(read.has(field), `the manifest documents ${field} and the build never reads it`)
  }

  // And nothing about the mode is settable here. The mode is a property of the
  // document this instance is handed, so a config field for it would be an admin
  // granting an authority the producer withheld.
  assert.strictEqual(documented.includes('mode'), false)
  assert.strictEqual(documented.includes('apply'), false)
})

it('this artifact cannot see the wiring, and does not ask to', () => {
  // The finding the whole design follows from. `platform:network-view` answers
  // seven questions and none is about instances or bindings, and there is no
  // `platform:assemble`. A port on either would be this application trying to
  // discover a graph rather than being handed one.
  for (const port of KIND.ports) {
    assert.notStrictEqual(port.contract, 'platform:network-view',
      'this declares a port that would let it enumerate the network')
    assert.strictEqual(port.contract.includes('assemble'), false,
      `this declares a port on ${port.contract}`)
  }

  // And no code path fetches a graph from anywhere: the document arrives on a
  // request and is held, which is what `take()` is.
  assert.ok(LIB.includes('function take ('), 'nothing takes a handed-in document')
  assert.strictEqual(/require\('artifact-planner'\)/.test(LIB + INDEX), false,
    'this derives a plan of its own, which is a second answer to what a device wires')
})

it('nothing here signs anything, whatever mode it was handed', () => {
  // `apply` says the *producer* holds a key and will sign the change this hands
  // back. It never says this artifact holds one.
  for (const word of ['sign(', 'secretKey', 'privateKey', 'keyPair']) {
    assert.strictEqual((LIB + INDEX).includes(word), false, `this file mentions ${word}`)
  }
  assert.ok(LIB.includes('artifact-operator instance remove'),
    'a planned change is not expressed as the commands that would make it')
  // Which commands, and whether the operator would accept them, is
  // `test/operator.test.js` — asked of the operator's own parser rather than of
  // a string, because a string with the right words in it is how the verb this
  // used to print stayed green while not existing.
  assert.ok(LIB.includes('function take ('))
})

it('the version in the manifest, the package and the kind all agree', () => {
  assert.equal(MANIFEST.version, PACKAGE.version)
  assert.equal(KIND.version, MANIFEST.version)
  assert.equal(MANIFEST.entry, `/${PACKAGE.main}`)
})

it('every dependency the manifest declares is one this actually needs', () => {
  const declared = MANIFEST.deps.map((/** @type {any} */ d) => d.name).sort()
  assert.equal(declared.join(','), 'cli,kit')

  // `cli` because this provides `cli@2.0.0`, and `kit` because every port on a
  // contract that artifact declares has to be able to see the declaration.
  assert.ok(KIND.provides.some((/** @type {any} */ p) => p.id === 'cli'))
  assert.ok(KIND.ports.some((/** @type {any} */ p) => p.contract === 'kit'))
})

it('every test file this package runs is a test file on disk', () => {
  // A suite that names a file that does not exist prints nothing and exits zero.
  const named = [...PACKAGE.scripts.test.matchAll(/test\/([a-z]+\.test\.js)/g)].map((m) => m[1])
  assert.ok(named.length >= 7, `the run script names ${named.length} suites`)

  const onDisk = fs.readdirSync(require.resolve('../package.json').replace(/package\.json$/, 'test')).sort()
  assert.equal([...named].sort().join(','), onDisk.join(','),
    'the suites this runs and the suites on disk are two different lists')
})

async function main () {
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
