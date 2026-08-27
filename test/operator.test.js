/**
 * The commands this prints, against the program that would run them.
 *
 * A planned change is a string, and a string is the easiest thing in the world
 * to assert about wrongly: `assert.ok(command.includes('instance bindings'))`
 * passes forever, whether or not `artifact-operator` has ever had such a verb.
 * It has not. That assertion was in this suite, green, next to a command line the
 * program refuses at the first word.
 *
 * So this file asks the program instead. The verb is looked up in
 * `artifact-operator/lib/spec.js`, the flags are checked against the options that
 * verb declares, and the `--bind` value is handed to `artifact-operator/lib/args.js`
 * — the same parser the real command line goes through — and compared with the
 * bindings the change actually meant.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const fs = require('bare-fs')
const path = require('bare-path')

const kit = require('artifact-kit').build({}, {})
const { manifest: manifestOf } = require('artifact-protocol')
const operatorArgs = require('artifact-operator/lib/args.js')
const { SPEC } = require('artifact-operator/lib/spec.js')

const { routes } = require('../lib/routes')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

/**
 * The value, or a failure that names what was missing.
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

/** Every manifest beside this repository, parsed. */
function manifests () {
  /** @type {Record<string, any>} */
  const all = {}
  const here = BESIDE
  for (const dir of fs.readdirSync(here)) {
    try {
      const m = manifestOf.parse(JSON.parse(fs.readFileSync(`${here}/${dir}/manifest.json`).toString()))
      all[m.name] = m
    } catch { /* not an artifact, or not one this tree can parse */ }
  }
  return all
}

const SET = manifests()

/** @param {string} id @param {string} artifact @param {Record<string, any>} [bindings] */
function wire (id, artifact, bindings = {}) {
  const kind = SET[artifact].kinds[0]
  /** @type {Record<string, any>} */
  const total = {}
  for (const port of kind.ports) {
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
  return { id, artifact, kind: kind.key, config: {}, bindings: total }
}

const WIRING = [
  wire('kit', 'kit'),
  wire('qr', 'qr'),
  wire('links-qr', 'shortlink'),
  wire('links-go', 'shortlink'),
  wire('studio', 'studio', { kit: 'kit', encoder: 'qr', links: ['links-qr', 'links-go'] })
]

/** A planning graph, and the change it works out. @param {any} change */
async function planned (change) {
  const app = routes({ kit, script: 'void 0', title: 'Graph' })
  const document = { network: 'testnet', mode: 'plan', instances: WIRING, manifests: SET, problems: [] }
  await app.handle({ method: 'POST', path: '/canvas', query: {}, body: JSON.stringify({ document }) })
  const out = await app.handle({ method: 'POST', path: '/change', query: {}, body: JSON.stringify(change) })
  return JSON.parse(out.body)
}

/** The same, for an instance added or taken away. @param {any} sent */
async function instanced (sent) {
  const app = routes({ kit, script: 'void 0', title: 'Graph' })
  const document = { network: 'testnet', mode: 'plan', instances: WIRING, manifests: SET, problems: [] }
  await app.handle({ method: 'POST', path: '/canvas', query: {}, body: JSON.stringify({ document }) })
  const out = await app.handle({ method: 'POST', path: '/instance', query: {}, body: JSON.stringify(sent) })
  return JSON.parse(out.body)
}

/**
 * A command line, taken apart the way a shell would.
 *
 * @param {string} line
 */
function parts (line) {
  const words = must(line.match(/'[^']*'|\S+/g), `${JSON.stringify(line)} is not a command line`)
    .map((w) => (w.startsWith("'") ? w.slice(1, -1) : w))

  assert.equal(words[0], 'artifact-operator', `the command does not run this program: ${words[0]}`)

  /** @type {Record<string, string>} */
  const flags = {}
  /** @type {string[]} */
  const positional = []
  for (let i = 1; i < words.length; i++) {
    if (words[i].startsWith('--')) { flags[words[i].slice(2)] = words[i + 1]; i++ } else positional.push(words[i])
  }
  return { words, flags, positional }
}

/** The command a verb path names, out of the operator's own spec. @param {string[]} path */
function verb (path) {
  /** @type {any} */
  let at = { commands: SPEC.commands }
  for (const step of path) {
    at = must((at.commands ?? []).find((/** @type {any} */ c) => c.name === step),
      `artifact-operator has no ${path.join(' ')} — it stops at ${step}`)
  }
  return at
}

/* ------------------------------------------------------------------------- */

it('the operator this checks against is the real one', () => {
  assert.ok(Array.isArray(SPEC.commands) && SPEC.commands.length > 5, 'the spec came back empty')
  assert.equal(typeof operatorArgs.bindings, 'function', 'the bindings parser is not where this reads it')
  // And the verb that does *not* exist still does not exist. This whole file was
  // written because a command naming it was green in another suite.
  assert.strictEqual(
    (verb(['instance']).commands ?? []).some((/** @type {any} */ c) => c.name === 'bindings'), false,
    'artifact-operator grew an `instance bindings` verb, and the two commands below can become one'
  )
})

it('both commands a change prints are verbs the operator declares', async () => {
  const out = await planned({ instance: 'studio', port: 'links', targets: ['links-qr'] })
  assert.equal(out.ok, true, out.why)
  assert.equal(out.commands.length, 2)

  for (const line of out.commands) {
    const { positional } = parts(line)
    // Two words of verb, then the command's own arguments.
    const found = verb([positional[0], positional[1]])
    assert.ok(found.action, `${positional[0]} ${positional[1]} names no action`)
  }
})

it('every flag a printed command uses is one that verb declares', async () => {
  const out = await planned({ instance: 'studio', port: 'links', targets: ['links-qr', 'links-go'] })

  for (const line of out.commands) {
    const { positional, flags } = parts(line)
    const found = verb([positional[0], positional[1]])
    const declared = new Set((found.options ?? []).map((/** @type {any} */ o) => o.name))
    for (const name of Object.keys(flags)) {
      assert.ok(declared.has(name),
        `${positional[0]} ${positional[1]} does not take --${name}; it takes ${[...declared].join(', ')}`)
    }
  }
})

it('every argument those verbs require is on the line', async () => {
  const out = await planned({ instance: 'studio', port: 'links', targets: ['links-qr'] })

  for (const line of out.commands) {
    const { positional, flags } = parts(line)
    const found = verb([positional[0], positional[1]])

    const args = (found.arguments ?? []).filter((/** @type {any} */ a) => a.required)
    assert.ok(positional.length - 2 >= args.length,
      `${found.name} needs ${args.length} argument${args.length === 1 ? '' : 's'} and the line carries ` +
      `${positional.length - 2}`)

    for (const option of (found.options ?? []).filter((/** @type {any} */ o) => o.required)) {
      assert.ok(option.name in flags, `${found.name} requires --${option.name} and the line does not carry it`)
    }
  }
})

it('the bind the page writes is the bind the operator parses, for all three spellings', async () => {
  // The assertion this file exists for. `args.bindings` is the function the real
  // command line goes through, and what it returns has to be the change that was
  // asked for — not merely a string with the right words in it.
  const many = await planned({ instance: 'studio', port: 'links', targets: ['links-qr', 'links-go'] })
  const parsedMany = operatorArgs.bindings(parts(many.commands[1]).flags.bind)
  assert.equal(JSON.stringify(parsedMany), JSON.stringify({ links: ['links-qr', 'links-go'] }),
    `the operator read ${JSON.stringify(parsedMany)}`)

  const emptied = await planned({ instance: 'studio', port: 'links', targets: [] })
  const parsedEmpty = operatorArgs.bindings(parts(emptied.commands[1]).flags.bind)
  assert.equal(JSON.stringify(parsedEmpty), JSON.stringify({ links: [] }),
    'an emptied many port did not come back as an empty list')

  const single = await planned({ instance: 'studio', port: 'encoder', targets: ['qr'] })
  const parsedOne = operatorArgs.bindings(parts(single.commands[1]).flags.bind)
  assert.equal(JSON.stringify(parsedOne), JSON.stringify({ encoder: 'qr' }))

  const declined = await planned({ instance: 'studio', port: 'image', targets: [] })
  const parsedNull = operatorArgs.bindings(parts(declined.commands[1]).flags.bind)
  assert.strictEqual(parsedNull.image, null, 'a declined optional port did not come back as null')

  // And the two absences stay distinct all the way through, which is the whole
  // reason there are three spellings rather than two.
  assert.notStrictEqual(JSON.stringify(parsedEmpty), JSON.stringify({ links: null }))
})

it('a comma-joined list is a line the operator refuses, which is what this used to print', async () => {
  // The bug, kept as a case. `links=links-qr,links-go` reads as a *scalar* target
  // called `links-qr,links-go` — so it does not throw, it silently means
  // something else, which is why nothing caught it.
  const wrong = operatorArgs.bindings('links=links-qr,links-go')
  assert.strictEqual(Array.isArray(wrong.links), false,
    'the comma spelling parses as a list after all, and this case is measuring nothing')
  assert.equal(wrong.links, 'links-qr,links-go')
})

it('the add and the remove are verbs the operator declares, with flags it takes', async () => {
  const added = await instanced({ do: 'add', id: 'studio-2', artifact: 'studio', kind: 'studio' })
  assert.equal(added.ok, true, added.why)
  const removed = await instanced({ do: 'remove', id: 'links-qr' })
  assert.equal(removed.ok, true, removed.why)

  for (const line of [...added.commands, ...removed.commands]) {
    const { positional, flags } = parts(line)
    const found = verb([positional[0], positional[1]])
    assert.ok(found.action, `${positional[0]} ${positional[1]} names no action`)

    const declared = new Set((found.options ?? []).map((/** @type {any} */ o) => o.name))
    for (const name of Object.keys(flags)) {
      assert.ok(declared.has(name),
        `${positional[0]} ${positional[1]} does not take --${name}; it takes ${[...declared].join(', ')}`)
    }
    for (const option of (found.options ?? []).filter((/** @type {any} */ o) => o.required)) {
      assert.ok(option.name in flags, `${found.name} requires --${option.name} and the line does not carry it`)
    }
    const args = (found.arguments ?? []).filter((/** @type {any} */ a) => a.required)
    assert.ok(positional.length - 2 >= args.length,
      `${found.name} needs ${args.length} argument(s) and the line carries ${positional.length - 2}`)
  }
})

it('the bind an add writes is the bind the operator parses', async () => {
  // Same assertion as the rewiring above, for the other command that carries
  // one: a create whose --bind means something other than what the form said is
  // a wrong network signed on the first try.
  const added = await instanced({ do: 'add', id: 'studio-2', artifact: 'studio', kind: 'studio' })
  const spelled = must(parts(added.commands[0]).flags.bind, 'the create carries no --bind')
  const parsed = operatorArgs.bindings(spelled)

  for (const port of added.decide) {
    assert.ok(port.name in parsed, `${port.name} is a port to decide and the operator does not see it`)
    if (port.cardinality === 'many') {
      const list = parsed[port.name]
      assert.ok(Array.isArray(list) && list.length === 0,
        `${port.name} is a many port and came back as ${JSON.stringify(list)}`)
    } else {
      assert.strictEqual(parsed[port.name], null,
        `${port.name} is optional and came back as ${JSON.stringify(parsed[port.name])}`)
    }
  }
  // And nothing else: a `one` port spelled here is a decision nobody made.
  assert.equal(Object.keys(parsed).length, added.decide.length,
    `the command binds ${Object.keys(parsed).join(', ')} and only ${added.decide.length} are anybody's to decide`)
})

async function main () {
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
