/**
 * A request in, an answer out, and no I/O anywhere in the file.
 *
 * ## The graph arrives; it is never fetched
 *
 * This artifact cannot see the wiring. `platform:network-view` answers seven
 * questions and not one is about instances or bindings, and there is no
 * `platform:assemble` — `DESIGN-CONFORMANCE.md` §3 is the argument for why there
 * must not be. So the graph is a **document handed in** by whoever can honestly
 * produce one, and everything here renders what it was given.
 *
 * That is also what makes the mode safe. `read` and `plan` are properties of the
 * document, so this application cannot grant itself authority it was not handed:
 * a graph passed over read-only will not even work out a change, and a `plan`
 * produces the commands an admin runs rather than anything signed here.
 */

const { screen: buildScreen } = require('./screen')
const { model, around, collapse } = require('./model')
const { layout } = require('./layout')

/**
 * How many nodes are drawn at once.
 *
 * A canvas of four hundred boxes is not a picture of anything, and the browser
 * has to place every one of them. When the cut exceeds this the drawing says so
 * — a ceiling nobody mentions reads as "that was the whole graph", which is the
 * one lie a map must not tell.
 */
const CANVAS = 120

/** How many problems are listed before the list says how many more there are. */
const PROBLEMS = 200

/**
 * @param {object} deps
 * @param {any} deps.kit
 * @param {string} deps.script
 * @param {any} [deps.store]
 * @param {string} [deps.title]
 */
function routes ({ kit, script, store, title = 'Graph' }) {
  /** @param {unknown} v */
  const text = (v) => (v === undefined || v === null ? '' : String(v))

  /** @param {unknown} err */
  const message = (err) => (err instanceof Error ? err.message : String(err))

  /** @param {string} body */
  const parse = (body) => {
    if (typeof body !== 'string' || body === '') return null
    try {
      const out = JSON.parse(body)
      return out !== null && typeof out === 'object' && !Array.isArray(out) ? out : null
    } catch { return null }
  }

  /** @param {number} status @param {unknown} value */
  const json = (status, value) => ({
    status, type: 'application/json; charset=utf-8', body: JSON.stringify(value)
  })

  /**
   * The document this instance is currently drawing.
   *
   * Held rather than fetched, and replaced by any request that carries a newer
   * one — the producer sends it with each request, so there is no moment where
   * the page is drawing one graph and the operator is holding another.
   *
   * @type {{ network: string, mode: string, instances: any[], manifests: Record<string, any>, problems: any[] }}
   */
  let held = { network: '', mode: 'read', instances: [], manifests: {}, problems: [] }

  /** Positions somebody dragged, per network. Advisory — see `layout()`. */
  let places = /** @type {Record<string, { x: number, y: number }>} */ ({})
  let loaded = false

  async function positions () {
    if (loaded || !store) return places
    loaded = true
    try {
      const raw = await store.get(`places:${held.network}`)
      const read = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : null
      if (read && typeof read === 'object' && !Array.isArray(read)) places = read
    } catch { /* a place nobody can read is a place nobody had */ }
    return places
  }

  /** @param {any} sent */
  function take (sent) {
    const document = sent && sent.document
    if (!document || typeof document !== 'object') return
    held = {
      network: text(document.network),
      // Two modes, not three. An `apply` was designed and then removed, and the
      // reason is a fact about the platform rather than a shortcut: nothing here
      // can edit a signed instance's wiring, because nothing anywhere can. See
      // `/change`. What an apply would sign is a removal that burns an id, and a
      // button is the wrong shape for that whoever is holding the key.
      mode: ['read', 'plan'].includes(text(document.mode)) ? text(document.mode) : 'read',
      instances: Array.isArray(document.instances) ? document.instances : [],
      manifests: document.manifests && typeof document.manifests === 'object' ? document.manifests : {},
      problems: Array.isArray(document.problems) ? document.problems : []
    }
    // A new document is a new graph; positions belong to whichever network it is.
    loaded = false
  }

  /** The whole graph, as nodes and edges. */
  function whole () {
    return model({ instances: held.instances, manifests: held.manifests, problems: held.problems })
  }

  /**
   * The graph, cut down to what was asked for.
   *
   * The order matters and is not arbitrary: fold first so a focus lands on a
   * folded node rather than inside one, then focus, then filter — narrowing
   * before focusing would make a neighbourhood of whatever survived the filter,
   * which is not the neighbourhood of anything.
   *
   * @param {any} sent
   */
  function cut (sent) {
    const full = whole()
    /** @type {string[]} */
    const said = []
    let graph = { nodes: full.nodes, edges: full.edges }

    if (text(sent.fold) === 'on') {
      /** @type {Map<string, number>} */
      const counted = new Map()
      for (const node of graph.nodes) counted.set(node.artifact, (counted.get(node.artifact) || 0) + 1)
      const many = [...counted.entries()].filter(([, n]) => n > 1).map(([a]) => a)
      if (many.length > 0) {
        graph = collapse(graph, many)
        said.push(`${many.length} artifact${many.length === 1 ? '' : 's'} folded`)
      }
    }

    const focus = text(sent.focus)
    if (focus !== '') {
      const depth = Math.max(0, Math.min(3, Number(sent.depth) || 1))
      const near = around(graph, focus, depth)
      if (!near.missing) {
        graph = { nodes: near.nodes, edges: near.edges }
        said.push(`${focus} and ${depth === 0 ? 'nothing else' : `everything within ${depth} hop${depth === 1 ? '' : 's'}`}`)
      }
    }

    const wanted = text(sent.artifact)
    const faults = text(sent.faults) === 'on'
    const find = text(sent.find).trim().toLowerCase()
    if (wanted !== '' || faults || find !== '') {
      const keep = new Set(graph.nodes.filter((n) => {
        if (wanted !== '' && n.artifact !== wanted) return false
        if (faults && !n.problems) return false
        if (find !== '' && !`${n.id} ${n.artifact}`.toLowerCase().includes(find)) return false
        return true
      }).map((n) => n.id))
      graph = {
        nodes: graph.nodes.filter((n) => keep.has(n.id)),
        edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to))
      }
      if (wanted !== '') said.push(`only ${wanted}`)
      if (faults) said.push('only what has a problem')
      if (find !== '') said.push(`matching ${JSON.stringify(find)}`)
    }

    // The ceiling, applied last and **stated**. Which ones survive is decided by
    // fault first and then by id, so a truncated canvas is at least the part
    // somebody most needs to see.
    let over = 0
    if (graph.nodes.length > CANVAS) {
      over = graph.nodes.length - CANVAS
      const kept = [...graph.nodes]
        .sort((a, b) => (b.problems || 0) - (a.problems || 0) || (a.id < b.id ? -1 : 1))
        .slice(0, CANVAS)
      const ids = new Set(kept.map((n) => n.id))
      graph = { nodes: kept, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) }
    }

    return { graph, said, over, total: full.nodes.length }
  }

  /** @param {any} sent */
  async function canvas (sent) {
    const { graph, said, over, total } = cut(sent)
    const laid = layout(graph, await positions())

    // "All 132 instances" beside a canvas holding 120 is the exact lie the
    // ceiling exists to avoid telling, so `over` decides the first clause too
    // and not only whether a second one is appended.
    const note = [
      said.length > 0
        ? `${graph.nodes.length} of ${total}: ${said.join(', ')}.`
        : over > 0
          ? `${graph.nodes.length} of ${total} instances.`
          : `All ${total} instances.`,
      over > 0 ? `${over} more are not drawn — the ones with problems are kept first.` : ''
    ].filter(Boolean).join(' ')

    return {
      html: await kit.component('graph', {
        id: 'graph',
        nodes: laid.nodes,
        edges: laid.edges,
        width: laid.width,
        height: laid.height,
        label: `${held.network || 'This network'}: ${laid.nodes.length} instances`,
        focus: text(sent.focus),
        empty: await kit.component('empty', {
          icon: '◇',
          title: total === 0 ? 'No graph yet' : 'Nothing matched',
          body: total === 0
            ? 'Nothing has handed this a network to draw.'
            : 'Every instance was filtered out. Widen the search, or show all artifacts.'
        })
      }),
      note: await kit.component('note', { body: note }),
      nodes: laid.nodes.length,
      edges: laid.edges.length,
      over
    }
  }

  /**
   * One node's page: its ports, what each reaches, and what is wrong with it.
   *
   * @param {any} sent
   */
  async function node (sent) {
    const id = text(sent.id)
    const full = whole()
    const one = full.nodes.find((n) => n.id === id)
    if (!one) {
      return {
        html: await kit.component('card', {
          title: 'Nothing open',
          children: [await kit.component('empty', { icon: '◇', title: 'No such instance', body: `Nothing in this graph is called ${id}.` })]
        })
      }
    }

    const faults = held.problems.filter((p) => text(p.instance) === id)
    const inbound = full.edges.filter((e) => e.to === id)

    /**
     * A port's targets, in a cell that cannot wrap.
     *
     * `.k-table td` is `white-space:nowrap`, which is the right call for a table
     * somebody scans and the wrong shape for a list of twelve. Unshortened, the
     * `apps` port of a surface adapter renders as `campaigns, codes, grapl` — cut
     * mid-word, with no sign that eight more follow.
     *
     * Two names and a count, because the canvas is where the twelve are: every
     * one of them is a spline out of this node, which is what the application is
     * for. `and 9 more` was the first spelling and it clipped too, one word
     * further along — the cell has room for about two names and a number.
     *
     * @param {string[]} targets
     */
    const reaching = (targets) => (targets.length <= 3
      ? targets.join(', ')
      : `${targets.slice(0, 2).join(', ')} +${targets.length - 2}`)

    // Three columns, not four. This had `port | wants | how many | reaches`, and
    // beside a canvas the fourth one is where the answer got cut off — "filled by
    // the ke…" — which is the one column somebody opened the node to read. How
    // many a port takes belongs with what it takes, so the two are one column.
    const ports = one.ports.length === 0
      ? await kit.component('note', { body: 'This kind declares no ports.' })
      : await kit.component('table', {
        columns: ['port', 'takes', 'reaches'],
        rows: one.ports.map((p) => [
          p.name,
          p.platform ? 'the runtime' : `${p.cardinality} ${p.contract} ${p.range}`,
          p.platform
            ? 'the kernel'
            : p.targets.length === 0
              ? (p.cardinality === 'optional' ? 'nothing' : 'nothing yet')
              : reaching(p.targets)
        ])
      })

    return {
      html: await kit.component('card', {
        title: one.id,
        // The artifact alone. The kind is a row in the facts below, and a
        // separator glyph between the two would be this artifact deciding how a
        // renderer punctuates — which the kernel refuses, and rightly.
        description: one.artifact,
        children: [
          await kit.component('facts', {
            items: [
              { label: 'Artifact', value: one.artifact },
              { label: 'Kind', value: one.kind || '—' },
              { label: 'Provides', value: one.provides.join(', ') || '—' },
              { label: 'Reached by', value: inbound.length === 0 ? 'nothing' : reaching([...new Set(inbound.map((e) => e.from))]) }
            ]
          }),
          ports,
          ...(Object.keys(one.config).length === 0
            ? []
            : [await kit.component('table', {
              columns: ['setting', 'value'],
              rows: Object.entries(one.config).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
            })]),
          ...(faults.length === 0
            ? []
            : [(await Promise.all(faults.map((p) => kit.component('alert', {
              variant: 'destructive',
              title: text(p.code),
              body: text(p.message)
            })))).join('')])
        ]
      }),
      id: one.id,
      // The path a fault took, so the canvas can draw the route rather than
      // just the endpoint.
      paths: faults.map((p) => (Array.isArray(p.path) ? p.path : []))
    }
  }

  /** Every fault, as a list that leads back to the canvas. */
  async function problems () {
    const faults = held.problems
    if (faults.length === 0) {
      return {
        html: await kit.component('empty', {
          icon: '✓',
          title: 'Nothing wrong',
          body: 'Every instance builds and every port resolves. This is the same verdict `network check` gives.'
        })
      }
    }
    const shown = faults.slice(0, PROBLEMS)
    return {
      html: await kit.component('dataTable', {
        id: 'problems',
        columns: [
          { key: 'code', label: 'Code', sortable: false },
          { key: 'instance', label: 'Instance', sortable: false },
          { key: 'port', label: 'Port', sortable: false },
          { key: 'message', label: 'What is wrong', sortable: false }
        ],
        rows: shown.map((p) => [text(p.code), text(p.instance), text(p.port) || '—', text(p.message)]),
        hrefs: shown.map((p) => `#/node/${encodeURIComponent(text(p.instance))}`),
        total: faults.length,
        page: 1,
        size: shown.length
      }),
      note: faults.length > PROBLEMS
        ? await kit.component('note', { body: `The first ${PROBLEMS} of ${faults.length}.` })
        : ''
    }
  }

  return {
    CANVAS,
    PROBLEMS,
    whole,
    cut,
    take,
    held: () => held,

    /**
     * @param {{ method: string, path: string, query: Record<string, string>, body: string }} req
     */
    async handle (req) {
      const sent = parse(req.body) || {}
      take(sent)

      if (req.path === '/' && req.method === 'GET') {
        const full = whole()
        return {
          status: 200,
          type: 'text/html; charset=utf-8',
          body: await buildScreen({
            kit,
            script,
            title,
            network: held.network,
            mode: held.mode,
            remembers: Boolean(store),
            artifacts: [...new Set(full.nodes.map((n) => n.artifact))].sort()
          })
        }
      }

      if (req.method !== 'POST') {
        return { status: 404, type: 'text/plain; charset=utf-8', body: 'no such path\n' }
      }

      if (req.path === '/canvas') return json(200, await canvas(sent))
      if (req.path === '/node') return json(200, await node(sent))
      if (req.path === '/problems') return json(200, await problems())

      if (req.path === '/instances') {
        const full = whole()
        return json(200, {
          html: await kit.component('dataTable', {
            id: 'instances',
            columns: [
              { key: 'id', label: 'Instance', sortable: false },
              { key: 'artifact', label: 'Artifact', sortable: false },
              { key: 'ports', label: 'Ports', numeric: true, sortable: false },
              { key: 'bound', label: 'Bound', numeric: true, sortable: false },
              { key: 'problems', label: 'Problems', numeric: true, sortable: false }
            ],
            rows: full.nodes.map((n) => [
              n.id,
              n.artifact,
              String(n.ports.length),
              String(n.ports.reduce((/** @type {number} */ t, p) => t + p.targets.length, 0)),
              n.problems === 0 ? '—' : String(n.problems)
            ]),
            hrefs: full.nodes.map((n) => `#/node/${encodeURIComponent(n.id)}`),
            total: full.nodes.length,
            page: 1,
            size: full.nodes.length || 1,
            empty: await kit.component('empty', { title: 'No graph yet', body: 'Nothing has handed this a network to draw.' })
          })
        })
      }

      // Somebody dragged a node. Advisory, and kept only where there is a store
      // to keep it in — a device with none simply lays out afresh each time.
      if (req.path === '/place') {
        if (!store) return json(200, { kept: false, why: 'This device keeps nothing between visits.' })
        const id = text(sent.id)
        const x = Number(sent.x)
        const y = Number(sent.y)
        if (id === '' || !Number.isFinite(x) || !Number.isFinite(y)) return json(400, { kept: false })
        await positions()
        places[id] = { x, y }
        try {
          await store.put(`places:${held.network}`, JSON.stringify(places))
          return json(200, { kept: true })
        } catch (err) { return json(200, { kept: false, why: message(err) }) }
      }

      // A change, expressed as the commands that would make it.
      //
      // **Rewiring burns an id, and this is where that is said out loud.** There
      // is no operation on this platform that edits a signed instance's
      // bindings: `instance create` refuses an id the network already has, and
      // `instance remove` says in its own words that burning an id is the only
      // way to re-sign an instance on new terms. So a change to one port is a
      // removal and a fresh instance under a *different id*, permanently.
      //
      // Nothing is signed here under any mode. This holds no key, and the two
      // lines it prints are lines an admin runs.
      if (req.path === '/change') {
        const instance = text(sent.instance)
        const port = text(sent.port)
        const targets = Array.isArray(sent.targets) ? sent.targets.map(text).filter(Boolean) : []
        if (instance === '' || port === '') return json(400, { ok: false, why: 'a change names an instance and a port' })

        if (held.mode === 'read') {
          return json(200, {
            ok: false,
            mode: held.mode,
            why: 'This graph was handed over read-only, so a change cannot be worked out from here.'
          })
        }

        const one = whole().nodes.find((n) => n.id === instance)
        const declared = one && one.ports.find((/** @type {any} */ p) => p.name === port)
        if (!declared) {
          return json(200, { ok: false, mode: held.mode, why: `${instance} declares no port called ${port}.` })
        }
        if (declared.platform) {
          return json(200, {
            ok: false,
            mode: held.mode,
            why: `${port} is filled by the runtime, so there is nothing about it for an admin to decide.`
          })
        }

        // The three spellings `artifact-operator/lib/args.js` accepts, chosen by
        // what the port *is* rather than by how many targets were picked: an
        // empty `many` port is `[]` and an empty optional one is `null`, and the
        // two mean different things.
        const spell = declared.cardinality === 'many'
          ? `${port}=[${targets.join(',')}]`
          : targets.length === 0 ? `${port}=null` : `${port}=${targets[0]}`

        const where = held.network === '' ? '<network>' : held.network
        const commands = [
          `artifact-operator instance remove ${instance} --confirm ${instance} ` +
            `--network ${where} --package <the package directories>`,
          `artifact-operator instance create <a new id> ${one.artifact} ${one.kind} ` +
            `--group <the group it is delivered to> --bind '${spell}' ` +
            `--network ${where} --package <the package directories>`
        ]

        return json(200, {
          ok: true,
          mode: held.mode,
          commands,
          burns: instance,
          why: `Nothing on this platform edits a signed instance's wiring. Running these takes ${instance} out of ` +
            'the network permanently — the id can never be used again — and signs a new instance in its place.',
          change: { instance, port, targets, cardinality: declared.cardinality }
        })
      }

      return { status: 404, type: 'text/plain; charset=utf-8', body: 'no such path\n' }
    }
  }
}

module.exports = { routes, CANVAS, PROBLEMS }
