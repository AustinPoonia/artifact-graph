/**
 * The document, as a document.
 *
 * `test/page.test.js` runs the script; this checks what the script is handed —
 * that every id it reaches by name is on the page, that the rail and the panels
 * are one list rather than two, and that the mode this instance was given is
 * stated where a person will see it before they try to change something.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const fs = require('bare-fs')

const kit = require('artifact-kit').build({}, {})

const { screen, VIEWS, DEPTHS, TITLE } = require('../lib/screen')
const { BEHAVIOUR } = require('../lib/behaviour')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

const ARTIFACTS = ['kit', 'shortlink', 'studio']

/** @param {object} [opts] */
const page = (opts = {}) => screen({ kit, script: BEHAVIOUR, network: 'test', artifacts: ARTIFACTS, ...opts })

/** The ordinary page, built once — most cases below only read it. */
let HTML = ''

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

it('every view the rail names is a view on the page, and the reverse', async () => {
  for (const view of VIEWS) {
    assert.ok(HTML.includes(`data-nav="${view.id}"`), `the rail does not offer ${view.id}`)
    assert.ok(HTML.includes(`data-view="${view.id}"`), `${view.id} is in the rail and is not a panel`)
  }

  const panels = [...HTML.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1])
  for (const id of new Set(panels)) {
    assert.ok(VIEWS.some((v) => v.id === id), `${id} is a panel the rail cannot reach`)
  }
})

it('every view carries the heading VIEWS gives it, and VIEWS names every view', () => {
  for (const view of VIEWS) {
    assert.equal(TITLE(view.id), view.title)
    assert.ok(HTML.includes(`data-title="${view.title}"`), `${view.id} carries no heading`)
  }
})

it('every element the script fetches by id exists on the page', () => {
  // A `getElementById` that comes back null is a control that silently does
  // nothing, which looks exactly like a control that works.
  const wanted = [...BEHAVIOUR.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1])
  const built = new Set([...HTML.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))

  for (const id of new Set(wanted)) {
    assert.ok(built.has(id), `the script asks for #${id} and no screen builds it`)
  }
})

it('every filter the script sends is a filter a route reads', () => {
  // The two halves of one request, kept honest against each other: a field the
  // page collects and nothing reads is a control that does nothing, and both
  // ends look completely normal on their own.
  const source = fs.readFileSync(require.resolve('../lib/routes.js')).toString()
  const sent = [...BEHAVIOUR.matchAll(/^\s{6}([a-z]+): \$\('/gm)].map((m) => m[1])
  assert.ok(sent.length >= 5, `only ${sent.length} filters found in the script`)

  for (const name of new Set(sent)) {
    assert.ok(source.includes(`sent.${name}`), `the page sends ${name} and no route reads it`)
  }
})

it('the screen writes no markup of its own beyond layout containers', async () => {
  // Everything visible comes from the kit. A `k-` class the kit does not build
  // is this file starting to style itself, and two surfaces styling themselves
  // is how two surfaces stop matching.
  const sheet = await kit.stylesheet()
  for (const file of ['../lib/screen.js', '../lib/routes.js']) {
    const source = fs.readFileSync(require.resolve(file)).toString()
    const used = [...source.matchAll(/class="(k-[a-z0-9 -]+)"/g)].flatMap((m) => m[1].split(/\s+/))
    for (const one of new Set(used)) {
      assert.ok(sheet.includes(`.${one}`), `${file} writes .${one} and the kit does not define it`)
    }
  }
})

it('the mode is stated before anybody tries to change something', async () => {
  // The mode is a property of the document this instance was handed. Saying so
  // where a reader will see it is the difference between "this is read only"
  // and a button that quietly does nothing.
  // A word, in the header, always visible. The banner it replaced sat above the
  // canvas, was read once, and cost a fifth of the panel to go on saying
  // something nobody could act on; the sentence that *is* actionable is beside
  // the ports it constrains, on a node's page — `test/routes.test.js`.
  const reading = await page({ mode: 'read' })
  assert.ok(reading.includes('Read only'), 'a read-only instance does not say so')

  const planning = await page({ mode: 'plan' })
  assert.ok(planning.includes('Plan only'), 'a planning instance claims more or less than it has')
  assert.strictEqual(planning.includes('Read only'), false)

  // Whichever it is, it is in the header rather than in the body — so it does
  // not scroll away and does not take room from the canvas.
  const header = /<header class="k-inset-header">[\s\S]*?<\/header>/.exec(planning)
  if (header === null) throw new Error('the inset has no header')
  assert.ok(header[0].includes('Plan only'), 'the mode is not in the header')

  // There is no third state. An apply document is read like any other word
  // nothing recognises, which is to say read-only — see `lib/routes.js`.
  const applying = await page({ mode: 'apply' })
  assert.ok(applying.includes('Read only'), 'a mode nothing produces got a screen of its own')
})

it('a page with no network says which network it has, rather than a blank', async () => {
  const unnamed = await page({ network: '' })
  assert.ok(unnamed.includes('no network named'), 'an unnamed network left the rail with a gap')

  assert.ok(HTML.includes('test'), 'the network is not named anywhere on an ordinary page')
})

it('the artifact filter offers what is in the graph and nothing else', async () => {
  for (const name of ARTIFACTS) {
    assert.ok(HTML.includes(`value="${name}"`), `${name} is in the graph and not in the filter`)
  }
  assert.ok(HTML.includes('All artifacts'), 'there is no way back to the whole graph')

  // A graph of one artifact still offers the filter, because folding and faults
  // sit beside it — a control that appears and disappears is worse than one
  // that is briefly uninteresting.
  const narrow = await page({ artifacts: ['kit'] })
  assert.ok(narrow.includes('id="artifact"'))
})

it('every depth the control offers is one the routes accept', () => {
  const source = fs.readFileSync(require.resolve('../lib/routes.js')).toString()
  const ceiling = /Math\.min\(3,/.exec(source)
  assert.ok(ceiling, 'the routes do not clamp depth, so the control is the only limit')

  for (const depth of DEPTHS) {
    const n = Number(depth.value)
    assert.ok(n >= 0 && n <= 3, `the control offers depth ${depth.value} and the routes clamp to 0..3`)
    assert.ok(depth.label.length > 0, `depth ${depth.value} has no label`)
  }
})

it('the page has a voice, and it is not a developer talking to themselves', () => {
  // The standing rule for every screen in this tree: an end user is reading it.
  // Notes that argue with the design, or explain why a decision was made, belong
  // in the source and never on the page.
  //
  // `artifact` and `port` are *not* on this list, and the distinction is the
  // whole rule rather than an exception to it: they are the nouns an operator
  // uses for the things on this screen, the same way a link studio says "link".
  // What is banned is the vocabulary of how this is built — `realm`, `manifest`,
  // `binding` — and any sentence explaining a decision to the reader.
  const forbidden = [
    'that is the point', 'which is the whole argument', 'the plain one',
    'rather than', 'which is why', 'deliberately', 'realm', 'manifest'
  ]
  const visible = HTML
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()

  for (const word of forbidden) {
    assert.strictEqual(visible.includes(word), false, `the page says "${word}"`)
  }
})

it('the page script carries no backtick, because it lives inside one', () => {
  // `lib/behaviour.js` is one template literal. A backtick in it ends the
  // literal early; a *matched pair* is worse, because the file still parses and
  // whatever sat between them is interpolated away before the page sees it.
  assert.strictEqual(BEHAVIOUR.includes('`'), false, 'the script contains a backtick')
  assert.strictEqual(BEHAVIOUR.includes('${'), false, 'the script contains an interpolation')
})

it('no two functions in the page script share a name', () => {
  // The later declaration wins silently, and the screen that called the earlier
  // one simply stops working. This has happened here before.
  const named = [...BEHAVIOUR.matchAll(/function ([a-zA-Z0-9_]+)\s*\(/g)].map((m) => m[1])
  const seen = new Set()
  for (const name of named) {
    assert.strictEqual(seen.has(name), false, `two functions in the script are called ${name}`)
    seen.add(name)
  }
})

it('the canvas is the panel, and the node it opens is the other rail', () => {
  // Opening a node must not take away the picture that shows why you opened it.
  // It is a rail on the right rather than a column inside the canvas view, so
  // the canvas is the whole panel when nothing is selected and most of it when
  // something is.
  const canvas = must(/<div class="k-stack k-gap-0 k-fill" data-view="canvas"[\s\S]*?data-view="instances"/.exec(HTML),
    'the canvas view is not on the page')
  assert.ok(canvas[0].includes('id="canvas"'), 'the canvas panel holds no canvas')
  assert.strictEqual(canvas[0].includes('id="node-panel"'), false,
    'the node panel is still inside the canvas view, so it still takes the canvas\'s width')

  // The rail is outside the inset entirely, after it.
  assert.ok(HTML.includes('<aside class="k-aside"'), 'there is no right rail')
  assert.ok(HTML.indexOf('id="node-panel"') > HTML.indexOf('</main>'), 'the node panel is not in the rail')
  assert.ok(HTML.includes('data-open="false"'), 'the rail is open before anything is selected')

  // And the body is flush, so the canvas is not a card in a 90rem column.
  assert.ok(HTML.includes('k-inset k-inset-flush'), 'the canvas view does not take the panel')
})

async function main () {
  HTML = await page()
  t.plan(cases.length)
  for (const [n, f] of cases) {
    try { await f(); t.pass(n) } catch (/** @type {any} */ e) { t.fail(`${n} — ${e && e.message}`) }
  }
}
main()
