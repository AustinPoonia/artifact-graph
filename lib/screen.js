/**
 * The document, built once.
 *
 * Everything visible comes from `artifact-kit`, and the graph itself arrives
 * over fetch into an empty container — a canvas rendered here would be a picture
 * of whatever was wired when the page was cached, which is the one thing a
 * graph must never be.
 */

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

/** How far a neighbourhood reaches. Three is where "related" stops meaning much. */
const DEPTHS = [
  { value: '1', label: 'What it touches' },
  { value: '2', label: 'Two hops' },
  { value: '3', label: 'Three hops' },
  { value: '0', label: 'This one alone' }
]

/**
 * @param {object} opts
 * @param {any} opts.kit
 * @param {string} opts.script
 * @param {string} [opts.title]
 * @param {string} [opts.network]   which network this graph is of
 * @param {string} [opts.mode]      read, plan or apply
 * @param {boolean} [opts.remembers]
 * @param {string[]} [opts.artifacts]  every artifact in the graph, for the filters
 */
async function screen ({
  kit, script, title = 'Graph', network = '', mode = 'read', remembers = false, artifacts = []
} = /** @type {any} */ ({})) {
  const canPlan = mode === 'plan'

  /* --------------------------------------------------------- the canvas --- */

  // A strip, not a card. What to draw is chrome — it is read once, set, and then
  // ignored while somebody looks at the picture — and a card of it above the
  // canvas costs a third of the panel to say so. `k-toolbar` caps a field at
  // 16rem and wraps when the window is narrow, so the strip is one row on a
  // monitor and two on a laptop rather than a column on both.
  const bar =
    '<div class="k-inset-bar">' +
    await kit.component('toolbar', {
      gap: 3,
      start: [
        await kit.component('input', {
          id: 'find',
          label: 'Find',
          placeholder: 'an instance or an artifact',
          extra: { 'data-filter': 'find' }
        }),
        await kit.component('select', {
          id: 'depth',
          label: 'Around the focus',
          value: '1',
          options: DEPTHS,
          extra: { 'data-filter': 'depth' }
        }),
        await kit.component('select', {
          id: 'artifact',
          label: 'Artifact',
          value: '',
          options: [{ value: '', label: 'All artifacts' }, ...artifacts.map((a) => ({ value: a, label: a }))],
          extra: { 'data-filter': 'artifact' }
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
        })
      ],
      // Nothing on the right. What is being drawn is a fact about the whole
      // panel, so it goes in the header beside the mode — and the strip gets the
      // full width, which is the difference between one row of controls and two.
      end: []
    }) +
    '</div>'

  // The canvas *is* the panel. Not a card in a column with a measure either side
  // — a picture of a whole network centred in 90rem with gutters is a picture in
  // a box, and the box is the part nobody asked for.
  //
  // `k-gap-0` because the strip draws its own bottom border and a gap under it
  // would be a line with a stripe of background beneath it.
  const canvasView =
    `<div class="k-stack k-gap-0 k-fill" data-view="canvas" data-title="${TITLE('canvas')}">` +
    bar +
    '<div class="k-fill" id="canvas"></div>' +
    '</div>'

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
  const standing = await kit.component('badge', {
    variant: canPlan ? 'secondary' : 'outline',
    label: canPlan ? 'Plan only' : 'Read only'
  })

  const body = await kit.component('inset', {
    sidebar: rail,
    title: VIEWS[0].title,
    // The note first, then the mode: what is on screen changes as somebody
    // filters, and what they may do does not.
    actions: '<span id="canvas-note" class="k-hint"></span>' + standing,
    // Canvas is the view a page opens on, so it opens flush. `lib/behaviour.js`
    // takes the class off for the two views that are columns of prose — which is
    // the same switch in both directions rather than a first render that flashes.
    flush: true,
    // The other rail. Navigation on the left, what is *selected* on the right,
    // and it has no width until something is.
    asideTitle: '',
    aside: [
      await kit.component('live', { id: 'said' }),
      '<div id="node-panel"></div>'
    ],
    children: [
      canvasView,
      instancesView,
      problemsView
    ]
  })

  return kit.page(title, body, script)
}

module.exports = { screen, VIEWS, DEPTHS, TITLE }
