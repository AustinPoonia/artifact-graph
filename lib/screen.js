/**
 * The document, built once.
 *
 * Everything visible comes from `artifact-kit`, and the graph itself arrives
 * over fetch into an empty container — a canvas rendered here would be a picture
 * of whatever was wired when the page was cached, which is the one thing a
 * graph must never be.
 */

/**
 * What this graph may do, in the order it may do more.
 *
 * `read` and `plan` are properties of the document — `artifact-operator network
 * graph` decides which one it hands over, and nothing here can raise it. `edit`
 * is in the list because it is a thing somebody wants and not because this can
 * do it: an artifact holds no key, has no outbound channel to anything that
 * does, and `instance create` refuses an id the network already has. Choosing it
 * is answered with what it would take, which is better than a menu that pretends
 * the option is not there.
 */
/** How far each mode reaches. The document hands over a ceiling, never a choice. */
const RANK = /** @type {Record<string, number>} */ ({ read: 0, plan: 1, edit: 2 })

const MODES = [
  { value: 'read', label: 'Read only' },
  { value: 'plan', label: 'Plan' },
  { value: 'edit', label: 'Edit' }
]

/** The sections the rail switches between. */
const VIEWS = [
  { id: 'canvas', label: 'Canvas', icon: '◇', title: 'Canvas' },
  { id: 'instances', label: 'Instances', icon: '▤', title: 'Instances' },
  { id: 'problems', label: 'Problems', icon: '!', title: 'Problems' }
]

/**
 * A view's heading. `VIEWS` is the one place that knows it — a panel spelling
 * its own into a `data-title` as well is a second list to forget.
 *
 * @param {string} id
 */
const TITLE = (id) => (VIEWS.find((v) => v.id === id) || { title: id }).title

/**
 * @param {object} opts
 * @param {any} opts.kit
 * @param {string} opts.script
 * @param {string} [opts.title]
 * @param {string} [opts.network]   which network this graph is of
 * @param {string} [opts.mode]      what this canvas is set to
 * @param {string} [opts.ceiling]   the most the document permits; the menu offers no more
 * @param {boolean} [opts.remembers]
 * @param {string[]} [opts.artifacts]  every artifact in the graph, for the filters
 * @param {{id: string, artifact: string}[]} [opts.instances]  every instance, for the command menu
 * @param {{artifact: string, kind: string, label: string}[]} [opts.kinds]  every artifact/kind pair that could be added
 */
async function screen ({
  kit, script, title = 'Graph', network = '', mode = 'read', ceiling = mode, remembers = false,
  artifacts = [], instances = [], kinds = []
} = /** @type {any} */ ({})) {
  const canPlan = mode === 'plan'
  // A word nothing recognises is not a mode with authority nobody has defined —
  // it is read-only, the same as every other unrecognised value. `apply` was a
  // real word in an early design and this is the case that keeps it inert.
  const reach = RANK[ceiling] === undefined ? RANK.read : RANK[ceiling]

  /* --------------------------------------------------------- the canvas --- */

  // The canvas *is* the panel, and now it is the whole of it. There was a strip
  // of controls above it — Find, a depth menu, an artifact menu, two toggles —
  // and it was five boxes across the top of a picture, which is the shape a
  // screen takes when nobody has decided where its controls live.
  //
  // They live in two places now. Searching is the command menu, which is one box
  // that finds anything and is not on screen until it is wanted; everything that
  // shapes what is drawn is in the rail beside it, next to the node it is about.
  const canvasView =
    `<div class="k-fill" data-view="canvas" data-title="${TITLE('canvas')}" id="canvas"></div>`

  /* ------------------------------------------------------ the command menu --- */

  // Every instance, and the things a person can do, in one list. The instances
  // are enumerated at build time because the page holds no graph — the same
  // reason the artifact filter used to be built from a list handed in.
  const palette = await kit.component('command', {
    id: 'palette',
    placeholder: 'Find an instance, or type a command…',
    empty: 'Nothing here by that name.',
    items: [
      ...instances.map((/** @type {{id: string, artifact: string}} */ one) => ({
        label: one.id,
        group: 'Instances',
        hint: one.artifact,
        icon: '◇',
        run: `open:${one.id}`
      })),
      ...artifacts.map((a) => ({
        label: a,
        group: 'Artifacts',
        hint: 'show only these',
        icon: '▤',
        run: `only:${a}`
      })),
      { label: 'Show every artifact', group: 'View', icon: '✳', run: 'only:' },
      { label: 'Fit the whole graph on screen', group: 'View', icon: '⤢', run: 'fit' },
      ...(canPlan
        ? [
            { label: 'Take the open node off the drawing', group: 'Change', icon: '⌫', run: 'drop' },
            { label: 'Undo the last thing placed', group: 'Change', icon: '↶', run: 'undo' },
            { label: 'Clear everything placed', group: 'Change', icon: '⌫', run: 'clear' }
          ]
        : []),
      // Only where they can be answered. A graph handed over read-only cannot
      // work a change out at all, so offering the command and explaining the
      // refusal afterwards is a menu that teaches the reader to distrust it.
      ...(canPlan
        ? [
            { label: 'Add an instance', group: 'Change', icon: '+', run: 'add' },
            { label: 'Remove the open instance', group: 'Change', icon: '−', run: 'remove' }
          ]
        : [])
    ]
  })

  /* -------------------------------------------------------- the change --- */

  // Adding an instance and taking one away, in the rail, hidden until the
  // command menu asks for one. Not a button on the canvas and not a right-click:
  // neither is a thing this platform can do, and a control that looks like a
  // direct manipulation of a signed network would be lying about what happens
  // when it is pressed. What comes back is a command, every time.
  const change = canPlan
    ? '<div id="change-panel" hidden>' +
      await kit.component('separator', {}) +
      '<h3 class="k-label" id="change-title">Add an instance</h3>' +
      '<div id="change-add">' +
      await kit.component('input', {
        id: 'new-id',
        label: 'Id',
        hint: 'Permanent. `instance create` refuses an id the network has ever used.',
        placeholder: 'links-go'
      }) +
      await kit.component('select', {
        id: 'new-kind',
        label: 'Artifact',
        options: kinds.map((/** @type {{artifact: string, kind: string, label: string}} */ k) => ({ value: `${k.artifact}/${k.kind}`, label: k.label }))
      }) +
      '</div>' +
      '<div id="change-out"></div>' +
      await kit.component('cluster', {
        children: [
          await kit.component('button', { id: 'do-change', label: 'Work out the command', size: 'sm' }),
          // Built here rather than written into `#change-out` by the script:
          // a button is `k-button k-button-outline k-button-sm` and a page
          // assembling those by hand is a second place the kit's class names
          // live. Hidden until there is something to copy.
          await kit.component('button', {
            id: 'do-copy', label: 'Copy commands', variant: 'outline', size: 'sm', icon: '⧉'
          }) +
          await kit.component('button', { id: 'do-change-off', label: 'Close', variant: 'ghost', size: 'sm' })
        ]
      }) +
      '</div>'
    : ''

  /* -------------------------------------------------------- the lists --- */

  const instancesView =
    `<div class="k-stack" data-view="instances" data-title="${TITLE('instances')}" hidden>` +
    await kit.component('card', {
      title: 'Instances',
      description: 'Every instance this network runs. Click a row to open it on the canvas.',
      children: ['<div id="instance-list"></div>'],
      footer: [await kit.component('button', { label: 'Refresh', id: 'do-refresh', variant: 'outline', icon: '↻' })]
    }) +
    '</div>'

  const problemsView =
    `<div class="k-stack" data-view="problems" data-title="${TITLE('problems')}" hidden>` +
    await kit.component('card', {
      title: 'Problems',
      description: 'Every fault the planner found, in the words a device would refuse the graph with. ' +
        'Opening one draws the path it took to get there.',
      children: ['<div id="problem-list"></div>']
    }) +
    '</div>'

  /* ---------------------------------------------------------- the shell --- */

  const rail = await kit.component('sidebar', {
    name: title,
    note: network === '' ? 'no network named' : network,
    mark: '◇',
    groups: [{ label: 'Look', items: VIEWS.map((v, i) => ({
      label: v.label,
      icon: v.icon,
      ...(i === 0 ? { active: true } : {}),
      extra: { 'data-nav': v.id }
    })) }],
    footer: ''
  })

  // What this instance may do, in the header where it is always visible rather
  // than in a banner above the canvas. The mode is a property of the document
  // this was handed, not a setting here, so there is nothing to press and
  // nothing to explain at length — a word is the whole of it, and the sentence
  // that matters lives next to the change it constrains, on a node's page.
  // Three modes, and the document decides the **ceiling** rather than the
  // choice. Picking one at or below what this graph was handed takes effect
  // here; picking one above it is refused by the routes with the reason, because
  // an application that could raise its own authority by setting a value on its
  // own page would be an application with no authority model at all.
  const standing = await kit.component('select', {
    id: 'mode',
    label: '',
    value: mode,
    options: MODES.map((m) => ({
      value: m.value,
      // Named as unavailable rather than hidden. A menu that quietly drops the
      // option somebody came looking for reads as a menu that does not have it,
      // and the answer to "why can I not edit" is worth a line.
      label: RANK[m.value] > reach ? `${m.label} (not available)` : m.label
    })),
    extra: { 'data-mode': 'true' }
  })

  const body = await kit.component('inset', {
    sidebar: rail,
    title: VIEWS[0].title,
    // The note first, then the mode: what is on screen changes as somebody
    // filters, and what they may do does not.
    actions: '<span id="canvas-note" class="k-hint"></span>' +
      // Only on screen while there is something to come back from. Inside a
      // block the canvas is a different graph, and nothing on it leads out.
      await kit.component('button', {
        id: 'do-out', label: 'Whole graph', variant: 'outline', size: 'sm', icon: '↰'
      }) +
      await kit.component('button', {
        id: 'do-palette', label: 'Search', variant: 'outline', size: 'sm', icon: '⌕'
      }) + standing,
    // Canvas is the view a page opens on, so it opens flush. `lib/behaviour.js`
    // takes the class off for the two views that are columns of prose — which is
    // the same switch in both directions rather than a first render that flashes.
    flush: true,
    // The other rail, and it is the same rail: `sidebar` again, on the right.
    // Navigation on the left, whatever is selected on the right, each with its
    // own collapse — so the reader folds the one they are not using and neither
    // fold takes the other with it.
    //
    // It starts collapsed because nothing is selected when a page loads, and
    // collapsed is an icon strip rather than nothing: the mark stays, so the way
    // back is on screen even when the panel is not.
    aside: await kit.component('sidebar', {
      side: 'right',
      name: 'Nothing open',
      note: 'pick a node',
      mark: '◇',
      children: [
        await kit.component('live', { id: 'said' }),
        // What shapes the drawing, beside the drawing — and above the node,
        // because these hold whether that node is on screen at all.
        await kit.component('stepper', {
          id: 'depth',
          label: 'Hops',
          hint: 'How far from the node you opened. 0 is that node alone.',
          value: 1,
          min: 0,
          max: 3,
          extra: { 'data-filter': 'depth' }
        }),
        await kit.component('toggle', {
          id: 'fold',
          label: 'Fold by artifact',
          checked: false,
          extra: { 'data-filter': 'fold' }
        }),
        await kit.component('toggle', {
          id: 'faults-only',
          label: 'Only problems',
          checked: false,
          extra: { 'data-filter': 'faults' }
        }),
        // The artifact filter is no longer a menu on the page — the command
        // menu sets it — but the page still needs somewhere to keep the value
        // and something that says when one is on.
        '<input type="hidden" id="artifact" data-filter="artifact" value="">',
        '<div id="only-note"></div>',
        await kit.component('separator', {}),
        '<div id="node-panel"></div>',
        change
      ]
    }),
    // Open from the start now: the rail holds the controls, and controls that
    // are not on screen until something is selected are controls nobody finds.
    asideCollapsed: false,
    children: [
      canvasView,
      instancesView,
      problemsView
    ]
  })

  // The command menu lives outside the shell: a `<dialog>` that `showModal()`
  // opens sits in the top layer wherever it is in the markup, and putting it
  // inside a scrolling panel would only give it an ancestor that can clip it.
  return kit.page(title, body + palette, script)
}

module.exports = { screen, VIEWS, MODES, TITLE }
