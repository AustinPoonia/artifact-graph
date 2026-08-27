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

const { screen, VIEWS, TITLE } = require('../lib/screen')
const { BEHAVIOUR } = require('../lib/behaviour')

/** @type {[string, () => void | Promise<void>][]} */
const cases = []
/** @param {string} n @param {() => void | Promise<void>} f */
const it = (n, f) => cases.push([n, f])

const ARTIFACTS = ['kit', 'shortlink', 'studio']

/** @param {object} [opts] */
const INSTANCES = [
  { id: 'studio', artifact: 'studio' },
  { id: 'links-go', artifact: 'shortlink' }
]

const page = (/** @type {any} */ opts = {}) => screen(/** @type {any} */ ({
  kit, script: BEHAVIOUR, network: 'test', artifacts: ARTIFACTS, instances: INSTANCES, ...opts
}))

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

it('every element the script fetches by id exists on the page', async () => {
  // A `getElementById` that comes back null is a control that silently does
  // nothing, which looks exactly like a control that works.
  //
  // Over both screens, because the mode decides what is built: the panel that
  // works out a change is not on a read-only page, and the script checks for it
  // rather than assuming it. One screen would fail on ids the other is the only
  // one that has.
  const wanted = [...BEHAVIOUR.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1])
  const both = HTML + await page({ mode: 'plan' })
  const built = new Set([...both.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))

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
  // Four, since Find left: depth, artifact, fold, faults. `focus` is sent too
  // and is not read off a field, so it is not counted here.
  assert.ok(sent.length >= 4, `only ${sent.length} filters found in the script`)

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
  // It is a menu now rather than a word, and what the menu *offers* is the part
  // worth guarding: the document hands over a ceiling, so a read-only graph must
  // not present Plan as something a reader can simply choose.
  const reading = await page({ mode: 'read' })
  assert.ok(reading.includes('id="mode"'), 'there is no way to see or change the mode')
  assert.ok(/Plan \(not available\)/.test(reading), 'a read-only graph offers Plan as though it were a choice')
  assert.ok(/Edit \(not available\)/.test(reading), 'a read-only graph offers Edit as though it were a choice')

  const planning = await page({ mode: 'plan', ceiling: 'plan' })
  assert.strictEqual(/Plan \(not available\)/.test(planning), false, 'a planning graph will not let anybody plan')
  // Lowering is always allowed, and is a real thing to want: a canvas nobody can
  // accidentally work a change out on while showing it to somebody.
  assert.strictEqual(/Read only \(not available\)/.test(planning), false, 'a planning graph cannot be made read-only')
  // And Edit is never available, on any document this platform produces.
  assert.ok(/Edit \(not available\)/.test(planning), 'a planning graph offers Edit')

  // Whichever it is, it is in the header rather than in the body — so it does
  // not scroll away and does not take room from the canvas.
  const header = /<header class="k-inset-header">[\s\S]*?<\/header>/.exec(planning)
  if (header === null) throw new Error('the inset has no header')
  assert.ok(header[0].includes('id="mode"'), 'the mode is not in the header')

  // A mode nothing produces is read like any other word nothing recognises,
  // which is to say read-only — see `lib/routes.js`.
  const applying = await page({ mode: 'apply', ceiling: 'apply' })
  assert.ok(/Plan \(not available\)/.test(applying), 'a mode nothing produces got authority of its own')
})

it('a page with no network says which network it has, rather than a blank', async () => {
  const unnamed = await page({ network: '' })
  assert.ok(unnamed.includes('no network named'), 'an unnamed network left the rail with a gap')

  assert.ok(HTML.includes('test'), 'the network is not named anywhere on an ordinary page')
})

it('the command menu names every instance and every artifact', async () => {
  // The Find box and the Artifact menu are gone: five controls across the top of
  // a picture is the shape a screen takes when nobody has decided where its
  // controls live. One box that finds anything, and it is not on screen until
  // it is wanted.
  assert.strictEqual(HTML.includes('id="find"'), false, 'the Find box is still on the page')
  assert.ok(HTML.includes('data-command'), 'there is no command menu')

  for (const one of INSTANCES) {
    assert.ok(HTML.includes(`data-run="open:${one.id}"`), `${one.id} cannot be opened from the menu`)
  }
  for (const name of ARTIFACTS) {
    assert.ok(HTML.includes(`data-run="only:${name}"`), `${name} cannot be filtered from the menu`)
  }
  // And a way back to everything, or a filter is a one-way door.
  assert.ok(HTML.includes('data-run="only:"'), 'there is no way back to the whole graph')

  // The value the filter sets still exists for the script to read and send.
  assert.ok(HTML.includes('id="artifact"'), 'nothing holds the artifact filter')
})

it('adding and removing an instance are commands, and only where they can be answered', async () => {
  const planning = await page({ mode: 'plan' })
  assert.ok(planning.includes('data-run="add"'), 'there is no way to add an instance')
  assert.ok(planning.includes('data-run="remove"'), 'there is no way to remove one')
  assert.ok(planning.includes('id="change-panel" hidden'), 'the change panel is on screen before anybody asked')

  // And not on a read-only graph, where the routes refuse both: a command that
  // always comes back refused is a menu teaching the reader to distrust it.
  assert.strictEqual(HTML.includes('data-run="add"'), false, 'a read-only graph offers to add an instance')
  assert.strictEqual(HTML.includes('data-run="remove"'), false, 'a read-only graph offers to remove one')
  // By the id it is built with, not by the name: the script is on the page too,
  // and it asks for #change-panel whether or not this screen has one.
  assert.strictEqual(HTML.includes('id="change-panel"'), false, 'a read-only graph builds the change panel')
})

it('the controls live in the rail, and Hops is a number', async () => {
  // `Around the focus` was a `<select>` of one, two, three hops: a list of
  // numbers dressed as a list of choices, where going from 1 to 3 meant opening
  // a menu and hunting for a word.
  assert.strictEqual(HTML.includes('Around the focus'), false, 'the old wording is still on the page')
  assert.ok(HTML.includes('>Hops<'), 'the control is not called Hops')
  assert.ok(/id="depth"[^>]*type="number"|type="number"[^>]*id="depth"/.test(HTML), 'Hops is not a number field')
  assert.ok(HTML.includes('data-step="-1"') && HTML.includes('data-step="1"'), 'Hops has no steps')

  // Every control sits in the right rail now, not in a strip over the canvas.
  const rail = /<aside class="k-sidebar k-sidebar-right"[\s\S]*<\/aside>/.exec(HTML)
  if (rail === null) throw new Error('there is no right rail')
  for (const id of ['depth', 'fold', 'faults-only', 'artifact', 'node-panel']) {
    assert.ok(rail[0].includes(`id="${id}"`), `${id} is not in the rail`)
  }
  // Over the markup with the stylesheet taken out: the sheet names every class
  // it styles, so scanning the whole document finds `k-inset-bar` whether or not
  // anything uses one. Same trap as the rail count below.
  const markup = HTML.replace(/<style[\s\S]*?<\/style>/g, '')
  assert.strictEqual(markup.includes('k-inset-bar'), false, 'the strip of controls is still above the canvas')

  // And the rail starts open, because controls nobody can see are controls
  // nobody finds.
  assert.strictEqual(/id="k-aside-toggle" checked/.test(HTML), false, 'the rail holding the controls starts collapsed')
})

it('every depth the control offers is one the routes accept', () => {
  const source = fs.readFileSync(require.resolve('../lib/routes.js')).toString()
  const ceiling = /Math\.min\(3,/.exec(source)
  assert.ok(ceiling, 'the routes do not clamp depth, so the control is the only limit')

  // The stepper's own bounds, read off the page rather than off a list beside
  // it: a number field is only as clamped as its min and max say, and a control
  // that offers 7 where the routes stop at 3 silently draws 3 and says 7.
  const min = /id="depth"[^>]*min="(-?\d+)"/.exec(HTML)
  const max = /id="depth"[^>]*max="(-?\d+)"/.exec(HTML)
  if (min === null || max === null) throw new Error('the Hops control declares no bounds')
  assert.equal(min[1], '0', 'the control goes below the floor the routes clamp to')
  assert.equal(max[1], '3', 'the control goes past the ceiling the routes clamp to')
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
  const canvas = must(/<div class="k-fill" data-view="canvas"[^>]*id="canvas"><\/div>/.exec(HTML),
    'the canvas view is not on the page')
  assert.ok(canvas[0].includes('id="canvas"'), 'the canvas panel holds no canvas')
  assert.strictEqual(canvas[0].includes('node-panel'), false,
    'the node panel is still inside the canvas view, so it still takes the canvas\'s width')

  // The rail is outside the inset entirely, after it — and it is the *same*
  // component as the left one, with its own collapse rather than a bespoke one.
  assert.ok(HTML.includes('<aside class="k-sidebar k-sidebar-right"'), 'there is no right rail')
  assert.ok(HTML.indexOf('id="node-panel"') > HTML.indexOf('</main>'), 'the node panel is not in the rail')
  // It starts *open* now, because it holds the controls as well as the selected
  // node — and a control that is not on screen until something is selected is a
  // control nobody finds.
  assert.strictEqual(/id="k-aside-toggle" checked/.test(HTML), false, 'the rail holding the controls starts collapsed')
  assert.ok(HTML.includes('for="k-aside-toggle"'), 'the rail has no control to open and close it')

  // Two rails, two brands, two handles: whatever the left one has, this has.
  //
  // Counted over the markup with the stylesheet taken out first. The sheet names
  // every class it styles, so counting `k-sidebar-brand-mark` across the whole
  // document returns three for two rails — a number that looks like a finding
  // and is a rule.
  const markup = HTML.replace(/<style[\s\S]*?<\/style>/g, '')
  assert.equal((markup.match(/k-sidebar-brand-mark/g) || []).length, 2, 'the rails are not built the same way')
  assert.equal((markup.match(/class="k-shell-handle"/g) || []).length, 2, 'only one rail can be collapsed')
  assert.equal((markup.match(/class="k-sidebar[ "]/g) || []).length, 2, 'the two rails are not two sidebars')

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
