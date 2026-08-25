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

  const controls = await kit.component('card', {
    title: 'What to draw',
    description: 'A whole estate is not a picture anybody reads. Narrow it, then look.',
    children: [
      await kit.component('columns', {
        min: 12,
        children: [
          await kit.component('input', {
            id: 'find',
            label: 'Find',
            placeholder: 'an instance or an artifact',
            hint: 'Narrows the canvas to what matches, and what those touch.',
            extra: { 'data-filter': 'find' }
          }),
          await kit.component('select', {
            id: 'depth',
            label: 'Around the focus',
            value: '1',
            options: DEPTHS,
            hint: 'How far from the node you opened.',
            extra: { 'data-filter': 'depth' }
          }),
          await kit.component('select', {
            id: 'artifact',
            label: 'Artifact',
            value: '',
            options: [{ value: '', label: 'All artifacts' }, ...artifacts.map((a) => ({ value: a, label: a }))],
            extra: { 'data-filter': 'artifact' }
          })
        ]
      }),
      await kit.component('cluster', {
        gap: 4,
        children: [
          await kit.component('toggle', {
            id: 'fold',
            label: 'Fold instances of one artifact together',
            checked: false,
            extra: { 'data-filter': 'fold' }
          }),
          await kit.component('toggle', {
            id: 'faults-only',
            label: 'Only what has a problem',
            checked: false,
            extra: { 'data-filter': 'faults' }
          })
        ]
      }),
      '<div id="canvas-note"></div>'
    ]
  })

  const canvasView =
    `<div class="k-stack k-gap-6" data-view="canvas" data-title="${TITLE('canvas')}">` +
    controls +
    // The canvas is the wide column and the node's own page is the narrow one,
    // beside it rather than instead of it: opening a node must not take away the
    // picture that shows why you opened it.
    //
    // With nothing open the second column is not a narrower canvas beside an
    // empty box — the grid drops to one column and the picture takes the width.
    // `lib/behaviour.js` puts `k-grid-wide` back when a node opens.
    '<div class="k-grid" id="canvas-area">' +
    '<div class="k-stack" id="canvas"></div>' +
    '<div class="k-stack k-sticky" id="node-panel" hidden></div>' +
    '</div>' +
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

  // What this instance may do, said once and where a reader will see it. The
  // mode is a property of the document this was handed, not a setting here — an
  // application cannot give itself authority it was not given.
  const standing = await kit.component('alert', {
    variant: 'warning',
    title: canPlan ? 'Changes are worked out here and run elsewhere' : 'Read only',
    body: canPlan
      ? 'Nothing here signs anything. Picking a different target writes out the commands an admin runs, ' +
        'and rewiring an instance takes it out of the network permanently.'
      : 'A picture of the wiring, and nothing else.'
  })

  const body = await kit.component('inset', {
    sidebar: rail,
    title: VIEWS[0].title,
    actions: '<span id="view-note" class="k-hint"></span>',
    children: [
      standing,
      await kit.component('live', { id: 'said' }),
      canvasView,
      instancesView,
      problemsView
    ]
  })

  return kit.page(title, body, script)
}

module.exports = { screen, VIEWS, DEPTHS, TITLE }
