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
const { model, around, collapse, shutBlocks, kindOf, opening, needs } = require('./model')
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
   * @type {{ network: string, mode: string, instances: any[], manifests: Record<string, any>,
   *   problems: any[], prose: Record<string, any> }}
   */
  let held = { network: '', mode: 'read', instances: [], manifests: {}, problems: [], prose: {} }

  /**
   * The mode somebody picked, which is never above the one they were handed.
   *
   * The document's mode is a **ceiling**, not a setting: it is what the producer
   * was willing to hand over, and `DESIGN-CONFORMANCE.md` §3 is the argument for
   * why an artifact must not be able to raise its own. Lowering it is always
   * allowed and is a real thing to want — a read-only canvas is a canvas nobody
   * can accidentally work a change out on while showing it to somebody.
   */
  let chosen = 'read'

  /**
   * Instances somebody placed on the canvas and nobody has signed.
   *
   * They are drawn like any other node and marked, and they are *not* in the
   * document — a draft is a proposal, and the only thing this application can do
   * with a proposal is print the command that would make it real. Dropped the
   * moment a new document arrives, because a document is the truth and a draft
   * is a sentence about it.
   *
   * @type {{ id: string, artifact: string, kind: string, config: Record<string, unknown>,
   *   bindings: Record<string, any>, draft: true, block?: string, role?: string,
   *   expose?: any[], gives?: any[] }[]}
   */
  let drafts = []

  /**
   * Which blocks are open, by the id of the part that carries the surface.
   *
   * A block is drawn as one node until somebody asks to see inside it. Held here
   * rather than on the draft, because it is a question about the drawing and not
   * about what would be signed.
   *
   * @type {Set<string>}
   */
  let opened = new Set()

  /**
   * What the last document said, so a resend is not mistaken for a new one.
   *
   * `null` rather than `''`: a document that really is empty is still a document
   * and still has to land once.
   */
  let stamp = /** @type {string | null} */ (null)

  /** How far each mode reaches. Anything past the ceiling is refused. */
  /** @type {Record<string, number>} */
  const RANK = { read: 0, plan: 1, edit: 2 }

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
      problems: Array.isArray(document.problems) ? document.problems : [],
      // What each port and each contract is for, in the manifests' own words.
      // Carried beside the manifests rather than on them, because a parsed
      // manifest has no descriptions and a raw one carries every operation of
      // every contract it declares — which is a document no command line takes.
      // Optional: a producer that sends none draws sockets with no tooltip
      // rather than no sockets.
      prose: document.prose && typeof document.prose === 'object' ? document.prose : {}
    }
    // A *new* document is a new graph. Not every document: the producer sends one
    // with every single request, so resetting unconditionally threw the drafts
    // away and re-read the positions on every click — a node placed on the
    // canvas was gone before the next request could see it.
    const now = JSON.stringify([held.network, held.mode, held.instances])
    if (now === stamp) return
    stamp = now

    // Positions belong to whichever network this is.
    loaded = false
    drafts = []
    opened = new Set()
    // And a new ceiling. A page that had chosen `read` under a `plan` document
    // must not stay read-only when a `read` document arrives and then a `plan`
    // one again — the choice is about this document, not about the session.
    chosen = held.mode
  }

  /**
   * Why a change cannot be worked out, or nothing at all.
   *
   * Two different refusals and they are not the same sentence: a document handed
   * over read-only is the producer's decision and nothing here changes it, and a
   * canvas somebody switched to read-only is their own, one menu away from being
   * undone.
   */
  function mayPlan () {
    if (RANK[chosen] >= RANK.plan) return null
    return {
      ok: false,
      mode: chosen,
      ceiling: held.mode,
      why: held.mode === 'read'
        ? 'This graph was handed over read-only, so a change cannot be worked out from here.'
        : 'This canvas is set to read only. Switch it to Plan to work a change out.'
    }
  }

  /** The whole graph, as nodes and edges — what is signed, and what is proposed. */
  function whole () {
    return model({
      instances: [...held.instances, ...drafts],
      manifests: held.manifests,
      problems: held.problems,
      prose: held.prose
    })
  }

  /**
   * Every artifact and kind there is to place, with what each one answers to.
   *
   * Built from the manifests the document carried rather than from what is
   * already running: placing the *first* instance of something is the case that
   * matters most, and a drawer built from the drawing is a drawer that cannot
   * offer it.
   */
  function shelf () {
    /** @type {Record<string, any[]>} */
    const by = {}
    const full = whole()
    for (const name of Object.keys(held.manifests).sort()) {
      for (const kind of (held.manifests[name] || {}).kinds || []) {
        const gives = (kind.provides || []).map((/** @type {any} */ p) => String(p.id))
        const group = gives.length === 0 ? 'Answers to nothing' : 'Artifacts'
        // What placing this as a *block* would come to, worked out here so the
        // drawer can say it before anybody commits: "and 2 more" is the
        // difference between a shelf and a shelf somebody can plan from.
        const worked = needs({
          manifests: held.manifests,
          artifact: name,
          kind: kind.key,
          present: full.nodes.map((n) => ({ id: n.id, provides: n.provides }))
        })
        const more = worked.parts.length - 1

        by[group] = by[group] || []
        by[group].push({
          // `name/kind`, not a middle dot: `ArtifactPatform/test/surface.test.js`
          // scans the shipped bundle for glyphs an artifact used to lay its own
          // output out, and `'· '` is one of them.
          label: kind.key !== name ? `${name}/${kind.key}` : name,
          put: `${name}/${kind.key}`,
          note: more === 0 ? gives.join(', ') : `and ${more} more`,
          hint: (opening((kind.config || {}).description) ||
            `Places an unsigned ${name}. Nothing is signed here — what comes out is an instance create.`) +
            (more === 0
              ? ''
              : `\n\nAs a block: ${worked.parts.map((/** @type {any} */ p) => p.artifact).join(', ')}, ` +
                `wired to each other. ${worked.expose.length} port` +
                `${worked.expose.length === 1 ? '' : 's'} are left for you — a port with one possible answer ` +
                'is filled, and one with a decision in it is not.')
        })
      }
    }
    return Object.keys(by).map((group) => ({ group, items: by[group] }))
  }

  /** The graph as it is actually signed, for anything that must not see a draft. */
  function signed () {
    return model({ instances: held.instances, manifests: held.manifests, problems: held.problems, prose: held.prose })
  }

  /**
   * The commands every draft adds up to, in the order they have to run.
   *
   * One `instance create` per placed node, carrying the wiring somebody drew.
   * There is no `instance wire` and there never will be: what a wire on a draft
   * *is* is an argument to the create that has not been run yet.
   */
  function drafted () {
    const where = held.network === '' ? '<network>' : held.network

    // Providers first. `instance create` binds to instances the network already
    // has, so a create naming a draft that has not been created yet is a command
    // that fails on the line before it would have worked — and the drawing gave
    // no hint of it, because on the canvas both nodes were simply there.
    //
    // A cycle is satisfiable on this platform (`chain.js` says so plainly), so
    // this cannot be a topological sort that refuses one: what is left over
    // after the ordered ones is appended in the order it was placed.
    const byId = new Map(drafts.map((d) => [d.id, d]))
    /** @type {typeof drafts} */
    const order = []
    const placed = new Set()
    const visit = (/** @type {any} */ one, /** @type {Set<string>} */ seen) => {
      if (placed.has(one.id) || seen.has(one.id)) return
      seen.add(one.id)
      for (const bound of Object.values(one.bindings)) {
        for (const target of Array.isArray(bound) ? bound : [bound]) {
          const first = typeof target === 'string' ? byId.get(target) : undefined
          if (first) visit(first, seen)
        }
      }
      if (placed.has(one.id)) return
      placed.add(one.id)
      order.push(one)
    }
    for (const one of drafts) visit(one, new Set())

    return order.map((one) => {
      const kind = kindOf(held.manifests[one.artifact], one.kind)
      const spell = ((kind && kind.ports) || [])
        .filter((/** @type {any} */ p) =>
          !String(p.contract).startsWith('platform:') && !String(p.contract).startsWith('kernel:') &&
          p.cardinality !== 'one')
        .map((/** @type {any} */ p) => {
          const bound = one.bindings[p.name]
          if (p.cardinality === 'many') return `${p.name}=[${(bound || []).join(',')}]`
          return bound ? `${p.name}=${bound}` : `${p.name}=null`
        })
        .join(';')

      return `artifact-operator instance create ${one.id} ${one.artifact} ${one.kind} ` +
        '--group <the group it is delivered to> ' +
        (spell === '' ? '' : `--bind '${spell}' `) +
        `--network ${where} --package <the package directories>`
    })
  }

  /**
   * One block, from the inside, with its own boundary drawn.
   *
   * ## Where a surface is decided
   *
   * Two nodes that are not instances: **In** on the left and **Out** on the
   * right. Wiring a part's port to In makes that port a port of the block;
   * wiring a part's output to Out makes the block answer to that contract. It is
   * the arrangement every node editor with groups arrives at, and it is here for
   * the same reason: a surface is a *wiring* decision, so it should be made with
   * the wire tool and not in a settings panel somewhere else.
   *
   * They fall at the edges without being placed there. `lib/layout.js` puts a
   * node to the right of everything it depends on: a part that reaches In
   * *depends* on In, so In lands left of every part, and Out consumes the parts
   * so it lands right of them. The picture arranges itself out of what the edges
   * already mean.
   *
   * @param {string} block
   */
  function insideOf (block) {
    const parts = drafts.filter((d) => d.block === block)
    if (parts.length === 0) return null
    const surface = parts.find((d) => d.expose !== undefined)
    const full = model({
      instances: parts,
      manifests: held.manifests,
      problems: held.problems,
      prose: held.prose
    })

    const takes = (surface && surface.expose) || []
    const answers = (surface && surface.gives) || []
    const idOf = (/** @type {string} */ role) =>
      (parts.find((p) => p.role === role) || { id: '' }).id

    /** @type {any} */
    // `block/in`, not `block in`. `data-port` and `data-out` carry an id and a
    // name separated by a space, so an id with a space in it splits into the
    // wrong two halves: the page read `studio in shortlink` as the instance
    // `studio` and the port `in`. A slash cannot appear in an instance id.
    const inNode = {
      id: `${block}/in`,
      artifact: 'what this block takes',
      kind: '',
      config: {},
      settings: [],
      about: '',
      ports: [],
      provides: takes.map((/** @type {any} */ e) => e.contract),
      outputs: takes.map((/** @type {any} */ e) => ({
        contract: e.contract,
        used: true,
        description: `${e.name} is a port of this block, because it is wired here.`
      })),
      problems: 0,
      edge: 'in'
    }

    /** @type {any} */
    const outNode = {
      id: `${block}/out`,
      artifact: 'what this block answers to',
      kind: '',
      config: {},
      settings: [],
      about: '',
      ports: answers.map((/** @type {any} */ g) => ({
        name: g.contract,
        contract: g.contract,
        range: '',
        cardinality: 'one',
        description: 'This block answers to this, because it is wired here.',
        platform: false,
        targets: [idOf(g.role)].filter(Boolean)
      })),
      provides: [],
      outputs: [],
      problems: 0,
      edge: 'out'
    }

    const edges = [
      ...full.edges,
      ...takes.map((/** @type {any} */ e) => ({
        from: idOf(e.role),
        port: e.port,
        to: inNode.id,
        contract: e.contract,
        broken: false,
        draft: true
      })).filter((e) => e.from !== ''),
      ...answers.map((/** @type {any} */ g) => ({
        from: outNode.id,
        port: g.contract,
        to: idOf(g.role),
        contract: g.contract,
        broken: false,
        draft: true
      })).filter((e) => e.to !== '')
    ]

    return { nodes: [inNode, ...full.nodes, outNode], edges, problems: [] }
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
    // Inside one block, the whole canvas is that block. Not a focus and not a
    // fold: a focus is still the estate with a neighbourhood picked out, and
    // this is a different graph with its own edges.
    const inside = text(sent.block) === '' ? null : insideOf(text(sent.block))
    if (inside) {
      return {
        graph: inside,
        said: [`inside ${text(sent.block)}`],
        over: 0,
        total: inside.nodes.length
      }
    }

    const full = shutBlocks(whole(), opened)
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
        // The canvas is the panel, so it takes the height it was given rather
        // than one of its own. A graph with a height of its own inside a filling
        // column is a card with empty panel underneath it.
        fill: true,
        label: `${held.network || 'This network'}: ${laid.nodes.length} instances`,
        focus: text(sent.focus),
        // The operations, and what there is to place. Both only where a change
        // can be worked out at all — a drawer on a read-only canvas is a shelf
        // of things that do nothing when picked up.
        tool: text(sent.tool),
        tools: RANK[chosen] >= RANK.plan
          ? [
              { id: '', label: 'Move', icon: '✥', hint: 'Drag nodes and pan the canvas.' },
              { id: 'place', label: 'Place', icon: '+',
                hint: 'Pick something from the drawer, then click the canvas. Nothing is signed.' },
              { id: 'wire', label: 'Wire', icon: '⤳',
                hint: 'Click a port on a placed node, then the node that answers it. ' +
                  'A signed instance cannot be rewired — that is a removal and a fresh id.' }
            ]
          : [],
        drawer: RANK[chosen] >= RANK.plan && text(sent.tool) === 'place' ? shelf() : [],
        empty: await kit.component('empty', {
          icon: '◇',
          title: total === 0 ? 'No graph yet' : 'Nothing matched',
          body: total === 0
            ? 'Nothing has handed this a network to draw.'
            : 'Every instance was filtered out. Widen the search, or show all artifacts.'
        })
      }),
      // Text, not a `note` component. This lands in the inset header, where a
      // block element inside an inline one is markup no parser has to keep — and
      // the header already styles what sits in it.
      note,
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

    // Three columns in a rail 26rem wide, and every one of them earns its width.
    // This started as four — `port | wants | how many | reaches` — in a half-page
    // column, and each move since has been the same lesson from a narrower
    // surface: the answer is in the last column, and the last column is what a
    // cell that cannot wrap drops first.
    //
    // So the range is gone from `takes`. `optional qr-decoder ^1.0.0` costs the
    // room `reaches` needs and answers a question nobody asks of a rail: what a
    // port *reaches* is why this is open, and which versions would also have
    // been legal is a manifest's business.
    const ports = one.ports.length === 0
      ? await kit.component('note', { body: 'This kind declares no ports.' })
      : await kit.component('table', {
        columns: ['port', 'takes', 'reaches'],
        rows: one.ports.map((p) => [
          p.name,
          p.platform ? 'the runtime' : `${p.cardinality} ${p.contract}`,
          p.platform
            ? 'the kernel'
            : p.targets.length === 0
              ? (p.cardinality === 'optional' ? 'nothing' : 'nothing yet')
              : reaching(p.targets)
        ]),
        // What each port is for, where a cell has no room to say it. Same text
        // the socket on the canvas carries, so hovering a row here and a dot
        // there answer the same question the same way.
        tips: one.ports.map((p) => (p.description === '' ? '' : `${p.name} — ${p.description}`))
      })

    // Every setting the kind declares, set or not.
    //
    // This listed `config` and nothing else, which showed the settings somebody
    // had already decided and hid every setting there was to decide: a kind
    // declaring four and an instance carrying one drew a single row, and a kind
    // with three unset settings looked exactly like a kind with none.
    //
    // A value the kind does *not* declare is drawn too, marked, because the
    // planner refuses a network over one — and hiding it would leave the reader
    // looking at a fault whose cause is not on screen.
    const settings = one.settings.length === 0
      ? await kit.component('note', { body: 'This kind declares no settings.' })
      : await kit.component('table', {
        // The kind's own sentence about its settings as a whole, where a table
        // already has somewhere to put one — rather than this file writing a
        // paragraph and having to escape it itself.
        caption: one.about,
        columns: ['setting', 'is', 'value'],
        rows: one.settings.map((f) => [
          f.declared ? f.name : `${f.name} (nothing reads this)`,
          f.declared ? `${f.type}${f.optional ? ', optional' : ''}` : 'not declared',
          f.set ? f.value : (f.optional ? 'not set' : 'not set yet')
        ]),
        tips: one.settings.map((f) => (f.declared
          ? (f.description === '' ? '' : `${f.name} — ${f.description}`)
          : `${f.name} is not declared by this kind, so nothing reads it. ` +
            'The planner refuses a network that carries one.'))
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
          settings,
          // The sentence the standing banner used to carry, moved to where it
          // constrains something. A banner above the canvas is read once and
          // scrolled past; this is beside the ports somebody is about to think
          // about repointing, and it is the whole cost of doing so.
          ...(held.mode === 'plan'
            ? [await kit.component('note', {
                body: 'Nothing here signs anything. Repointing a port is a removal and a fresh instance ' +
                  `under a different id, and ${one.id} would never be reusable.`
              })]
            : []),
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
      // The rail's brand names the instance and its artifact, the way the left
      // one names the application and its network. Sent rather than looked up on
      // the page: the page holds no graph.
      artifact: one.artifact,
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
            mode: chosen,
            ceiling: held.mode,
            remembers: Boolean(store),
            artifacts: [...new Set(full.nodes.map((n) => n.artifact))].sort(),
            // The menu and the add form are built here because the page holds no
            // graph and no manifests — the same reason the artifact filter is.
            instances: full.nodes.map((n) => ({ id: n.id, artifact: n.artifact })),
            // Every artifact this graph was handed a manifest for, not merely the
            // ones already running: adding the first instance of something is the
            // case that matters most, and it is the one a list built from the
            // drawing cannot offer.
            kinds: Object.keys(held.manifests).sort().flatMap((name) =>
              ((held.manifests[name] || {}).kinds || []).map((/** @type {any} */ k) => ({
                artifact: name, kind: k.key, label: `${name}/${k.key}`
              })))
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

      // Placing a node, drawing a wire, and taking either back.
      //
      // Every one of these ends in a command and none of them ends in a change.
      // A wire drawn on a draft is an argument to an `instance create` that has
      // not been run; a wire drawn on a **signed** instance is refused here and
      // sent to `/change`, because rewiring one is a removal and a fresh id and
      // a tool that let somebody drag it would be a tool that lied about what
      // pressing it does.
      if (req.path === '/draft') {
        const act = text(sent.do)
        const refusedDraft = mayPlan()
        if (refusedDraft) return json(200, refusedDraft)

        const answer = () => json(200, {
          ok: true,
          mode: chosen,
          drafts: drafts.map((d) => ({
            id: d.id, artifact: d.artifact, kind: d.kind, ...(d.role ? { role: d.role, block: d.block } : {})
          })),
          commands: drafted()
        })

      /**
       * Bind one draft's port to one instance, or say why it cannot be.
       *
       * Shared, because a wire dropped on a shut block and a wire dropped on a
       * bare node are the same operation on different ends of the same thing --
       * and the checks are the part that must not differ between them.
       *
       * @param {any} one @param {string} port @param {string} to
       */
      const wire = (one, port, to) => {
        const declared = kindOf(held.manifests[one.artifact], one.kind)
        const socket = ((declared && declared.ports) || [])
          .find((/** @type {any} */ p) => p.name === port)
        if (!socket) return json(200, { ok: false, mode: chosen, why: `${one.artifact} declares no port called ${port}.` })
        if (String(socket.contract).startsWith('platform:')) {
          return json(200, {
            ok: false,
            mode: chosen,
            why: `${port} is filled by the runtime, so there is nothing about it for anybody to wire.`
          })
        }

        // The other end has to answer the contract this port wants. A node
        // editor that let any dot reach any dot would be one whose drawings do
        // not plan.
        const target = whole().nodes.find((n) => n.id === to)
        if (!target) return json(200, { ok: false, mode: chosen, why: `there is nothing called ${to}` })
        if (!target.provides.includes(socket.contract)) {
          return json(200, {
            ok: false,
            mode: chosen,
            why: `${to} does not answer to ${socket.contract}, which is what ${port} wants. ` +
              `It answers to ${target.provides.join(', ') || 'nothing'}.`
          })
        }

        if (socket.cardinality === 'many') {
          const held2 = Array.isArray(one.bindings[port]) ? one.bindings[port] : []
          // A second wire to the same target is the same wire.
          one.bindings[port] = held2.includes(to) ? held2 : [...held2, to]
        } else {
          one.bindings[port] = to
        }
        return answer()
      }

        if (act === 'clear') { drafts = []; return answer() }
        if (act === 'undo') { drafts.pop(); return answer() }

        // A block: one artifact and everything it needs, as several drafts wired
        // to each other. What comes out is still N `instance create` commands --
        // nothing on this platform composes instances into a signed unit, and a
        // block that pretended otherwise would be inventing a concept the
        // network does not have.
        if (act === 'block') {
          const artifact = text(sent.artifact)
          const kind = text(sent.kind)
          const full = whole()
          const worked = needs({
            manifests: held.manifests,
            artifact,
            kind,
            present: full.nodes.map((n) => ({ id: n.id, provides: n.provides }))
          })
          if (worked.parts.length === 0) {
            return json(200, { ok: false, mode: chosen, why: `${artifact} declares no kind called ${kind}.` })
          }

          const taken = new Set(full.nodes.map((n) => n.id))
          const free = (/** @type {string} */ stem) => {
            let id = stem
            for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`
            taken.add(id)
            return id
          }

          // Ids first, so a part can bind a sibling by role before that sibling
          // has been walked.
          const byRole = new Map(worked.parts.map((p) => [p.role, free(p.artifact)]))
          const block = byRole.get('main') || ''

          for (const part of worked.parts) {
            /** @type {Record<string, any>} */
            const bindings = {}
            for (const [name, bound] of Object.entries(part.bindings)) {
              // A binding to a sibling is written as a role while the recipe is
              // being worked out, because the sibling has no id until now.
              bindings[name] = bound && typeof bound === 'object' && 'role' in bound
                ? byRole.get(String(bound.role))
                : bound
            }
            drafts.push({
              id: /** @type {string} */ (byRole.get(part.role)),
              artifact: part.artifact,
              kind: part.kind,
              config: {},
              bindings,
              draft: true,
              block,
              role: part.role,
              // Two lists, because a block has two surfaces and they are decided
              // separately: what it takes, and what it answers to. `gives`
              // starts as the main part's own contracts — the honest default,
              // since a block named after a studio answers to what a studio
              // answers to until somebody says otherwise.
              ...(part.role === 'main'
                ? {
                    expose: worked.expose,
                    gives: ((kindOf(held.manifests[part.artifact], part.kind) || {}).provides || [])
                      .map((/** @type {any} */ p) => ({ role: 'main', contract: String(p.id) }))
                  }
                : {})
            })
          }

          const x = Number(sent.x)
          const y = Number(sent.y)
          if (Number.isFinite(x) && Number.isFinite(y)) {
            await positions()
            places[block] = { x, y }
          }

          const out = /** @type {any} */ (JSON.parse(answer().body))
          out.block = block
          out.parts = worked.parts.length
          out.expose = worked.expose.length
          out.reused = worked.reused
          out.why = `${block} and ${worked.parts.length - 1} more, wired to each other. ` +
            (worked.reused.length === 0
              ? ''
              : `${worked.reused.map((r) => r.id).join(', ')} ${worked.reused.length === 1 ? 'was' : 'were'} ` +
                'already here and bound rather than copied. ') +
            `${worked.expose.length} port${worked.expose.length === 1 ? '' : 's'} left for you: ` +
            'a port with one possible answer is filled, and one with a decision in it is not.'
          return { status: 200, type: 'application/json; charset=utf-8', body: JSON.stringify(out) }
        }

        // A port becomes a port *of the block* by being wired to In, and a
        // contract becomes one of its outputs by being wired to Out. Toggled,
        // because the same gesture that puts something on a surface is the
        // obvious way to take it off again.
        if (act === 'expose') {
          const block = text(sent.block)
          const surface = drafts.find((d) => d.block === block && d.expose !== undefined)
          if (!surface) return json(200, { ok: false, mode: chosen, why: `there is no block called ${block}` })

          const role = text(sent.role)
          const part = drafts.find((d) => d.block === block && d.role === role)
          if (!part) return json(200, { ok: false, mode: chosen, why: `${block} has no part called ${role}` })

          if (text(sent.side) === 'out') {
            const contract = text(sent.contract)
            if (contract === '') {
              return json(200, { ok: false, mode: chosen, why: 'an output is named by its contract' })
            }
            const gives = surface.gives || (surface.gives = [])
            const at = gives.findIndex((/** @type {any} */ g) => g.role === role && g.contract === contract)
            if (at >= 0) gives.splice(at, 1)
            else gives.push({ role, contract })
            return answer()
          }

          const port = text(sent.port)
          const declared = kindOf(held.manifests[part.artifact], part.kind)
          const socket = ((declared && declared.ports) || [])
            .find((/** @type {any} */ p) => p.name === port)
          if (!socket) return json(200, { ok: false, mode: chosen, why: `${part.artifact} declares no port called ${port}` })
          if (String(socket.contract).startsWith('platform:')) {
            return json(200, {
              ok: false,
              mode: chosen,
              why: `${port} is filled by the runtime, so it cannot be a port of anything.`
            })
          }

          const expose = surface.expose || (surface.expose = [])
          const at = expose.findIndex((/** @type {any} */ e) => e.role === role && e.port === port)
          if (at >= 0) {
            expose.splice(at, 1)
            return answer()
          }
          expose.push({
            name: role === 'main' ? port : `${role}.${port}`,
            role,
            port,
            contract: String(socket.contract),
            cardinality: String(socket.cardinality || 'one'),
            why: 'Wired to In, so whoever places this block decides it.',
            candidates: []
          })
          return answer()
        }

        // Letting go of a wire over nothing. On the surface that means the port
        // stops being a port of the block; anywhere else it means the binding
        // goes. Both are the same gesture and both are what "disconnect" means
        // where it was let go.
        if (act === 'unwire') {
          const from = text(sent.from)
          const port = text(sent.port)
          const one = drafts.find((d) => d.id === from)
          if (!one) {
            const exists = signed().nodes.some((n) => n.id === from)
            return json(200, {
              ok: false,
              mode: chosen,
              why: exists
                ? `${from} is signed, so its wiring cannot be dragged.`
                : `there is nothing called ${from} to unwire`
            })
          }

          const declared = kindOf(held.manifests[one.artifact], one.kind)
          const socket = ((declared && declared.ports) || [])
            .find((/** @type {any} */ p) => p.name === port)
          if (!socket) return json(200, { ok: false, mode: chosen, why: `${one.artifact} declares no port called ${port}.` })

          const target = text(sent.to)
          if (socket.cardinality === 'many') {
            const bound = Array.isArray(one.bindings[port]) ? one.bindings[port] : []
            // One target where one was named, all of them where none was: a
            // `many` port dragged off a particular node loses that node and not
            // the rest of them.
            one.bindings[port] = target === '' ? [] : bound.filter((/** @type {string} */ t) => t !== target)
          } else {
            one.bindings[port] = null
          }
          return answer()
        }

        if (act === 'open' || act === 'shut') {
          const block = text(sent.block)
          if (act === 'open') opened.add(block)
          else opened.delete(block)
          return answer()
        }

        if (act === 'place') {
          const artifact = text(sent.artifact)
          const kind = text(sent.kind)
          const declared = kindOf(held.manifests[artifact], kind)
          if (!declared) {
            return json(200, { ok: false, mode: chosen, why: `${artifact} declares no kind called ${kind}.` })
          }

          // An id nobody has used, and nobody *will* have used: `instance create`
          // refuses one the network has ever held, so a draft that reuses one is
          // a command that fails at the last step.
          const taken = new Set([...whole().nodes.map((n) => n.id)])
          const stem = text(sent.id).trim() || artifact
          let id = stem
          for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`

          /** @type {Record<string, any>} */
          const bindings = {}
          for (const port of declared.ports) {
            if (String(port.contract).startsWith('platform:') || String(port.contract).startsWith('kernel:')) continue
            if (port.cardinality === 'many') bindings[port.name] = []
            else if (port.cardinality === 'optional') bindings[port.name] = null
          }

          drafts.push({ id, artifact, kind: declared.key, config: {}, bindings, draft: true })
          // Where it was dropped, so it lands under the pointer rather than
          // wherever the layout would have put it.
          const x = Number(sent.x)
          const y = Number(sent.y)
          if (Number.isFinite(x) && Number.isFinite(y)) {
            await positions()
            places[id] = { x, y }
          }
          return answer()
        }

        if (act === 'wire') {
          const from = text(sent.from)
          const port = text(sent.port)
          const to = text(sent.to)

          // A wire dropped on a shut block lands on the part that actually
          // declares the port. The reader is wiring one node; what gets bound is
          // an instance inside it, and the command that comes out says so.
          const surface = drafts.find((d) => d.block === from && d.expose !== undefined)
          if (surface && !opened.has(from)) {
            const named = (surface.expose || [])
              .find((/** @type {any} */ e) => e.name === port || e.port === port)
            // Shut, a block is *only* its surface. The block id and its main
            // part's id are the same string, so without this a port the block
            // filled for itself stayed wirable from outside — which is the block
            // failing to keep the one promise it makes.
            if (!named) {
              return json(200, {
                ok: false,
                mode: chosen,
                why: `${from} filled ${port} itself, so there is nothing there to decide. ` +
                  'Open the block to wire what is inside it.'
              })
            }
            const part = drafts.find((d) => d.block === from && d.role === named.role)
            if (part) return wire(part, String(named.port), to)
          }

          // Not a block, or a block somebody opened: an ordinary draft by id.
          const one = drafts.find((d) => d.id === from)
          if (!one) {
            const exists = signed().nodes.some((n) => n.id === from)
            return json(200, {
              ok: false,
              mode: chosen,
              signed: exists,
              why: exists
                ? `${from} is signed, so its wiring cannot be dragged. Rewiring a port is a removal and a fresh ` +
                  'instance under a different id — open it and work the change out.'
                : `there is nothing called ${from} to wire`
            })
          }

          return wire(one, port, to)
        }

        return json(400, { ok: false, why: 'a draft is placed, wired, undone or cleared' })
      }

      // Which mode this canvas is in, within what it was handed.
      //
      // **The document's mode is a ceiling and this cannot raise it.** Lowering
      // it is always allowed, because that is a real thing to want and gives
      // away nothing. Raising it is refused here rather than in the page,
      // because a check a page performs on itself is a check anybody can skip by
      // not loading the page.
      if (req.path === '/mode') {
        const want = text(sent.want)
        if (!(want in RANK)) return json(400, { ok: false, mode: chosen, why: `there is no ${want} mode` })

        if (RANK[want] <= RANK[held.mode]) {
          chosen = want
          return json(200, {
            ok: true,
            mode: chosen,
            ceiling: held.mode,
            why: want === held.mode ? '' : `This canvas is ${want === 'read' ? 'read only' : want}.`
          })
        }

        // Refused, and the reason names what would grant it rather than saying
        // no. `edit` is the interesting one and its answer is not "ask an
        // administrator": it is that **nothing on this platform edits a signed
        // instance**, so there is no key that turns this on.
        return json(200, {
          ok: false,
          mode: chosen,
          ceiling: held.mode,
          why: want === 'edit'
            ? 'Nothing on this platform edits a signed instance, so no key turns this on. Rewiring a port ' +
              'is a removal and a fresh instance under a different id, and this canvas works out those ' +
              'commands in Plan — an administrator holding the key runs them.'
            : `This graph was handed over read-only. A canvas can work a change out only if the producer ` +
              'passed one that may: `artifact-operator network graph --plan`.'
        })
      }

      // Adding one, and taking one away — the two things a graph can be asked
      // for that are not a rewiring, and the same rule governs all three. This
      // holds no key. What comes back is the command an admin runs, worked out
      // against the manifests this graph was handed, so a command that names a
      // kind no artifact declares is refused here rather than by the operator
      // ten seconds later.
      if (req.path === '/instance') {
        const act = text(sent.do)
        const refused = mayPlan()
        if (refused) return json(200, refused)
        const where = held.network === '' ? '<network>' : held.network
        const packages = `--network ${where} --package <the package directories>`

        if (act === 'remove') {
          const id = text(sent.id)
          const full = whole()
          const one = full.nodes.find((n) => n.id === id)
          if (!one) return json(200, { ok: false, mode: held.mode, why: `Nothing on this graph is called ${id}.` })

          // Who is bound to it, because that is what a removal actually costs.
          // The planner will refuse the network afterwards and say so; saying it
          // *before* is the difference between a warning and a post-mortem.
          const depend = [...new Set(full.edges.filter((e) => e.to === id).map((e) => e.from))]

          return json(200, {
            ok: true,
            mode: held.mode,
            burns: id,
            depend,
            commands: [`artifact-operator instance remove ${id} --confirm ${id} ${packages}`],
            why: `Removing ${id} burns the id — it can never be used on this network again. ` +
              (depend.length === 0
                ? 'Nothing is bound to it.'
                : `${depend.join(', ')} ${depend.length === 1 ? 'is' : 'are'} bound to it, and ` +
                  `${depend.length === 1 ? 'that instance' : 'those instances'} will not plan until ` +
                  'rebound — which is itself a removal and a fresh id, for each of them.')
          })
        }

        if (act === 'add') {
          const id = text(sent.id).trim()
          const artifact = text(sent.artifact)
          const kind = text(sent.kind)
          if (id === '') return json(200, { ok: false, mode: held.mode, why: 'A new instance needs an id.' })

          const full = whole()
          if (full.nodes.some((n) => n.id === id)) {
            return json(200, {
              ok: false,
              mode: held.mode,
              why: `${id} is already on this network, and \`instance create\` refuses an id the network has.`
            })
          }
          const declared = kindOf(held.manifests[artifact], kind)
          if (!declared) {
            return json(200, { ok: false, mode: held.mode, why: `${artifact} declares no kind called ${kind}.` })
          }

          // Only the ports an admin decides are spelled. A `one` port has no
          // unbound state — the planner derives it from the set — so writing it
          // here would be inventing a decision nobody made, and `platform:` ports
          // are the runtime's.
          const decide = declared.ports.filter((/** @type {any} */ p) =>
            !String(p.contract).startsWith('platform:') && !String(p.contract).startsWith('kernel:') &&
            p.cardinality !== 'one')
          const spell = decide
            .map((/** @type {any} */ p) => (p.cardinality === 'many' ? `${p.name}=[]` : `${p.name}=null`))
            // Semicolons. `artifact-operator/lib/args.js` splits `--bind` on `;`
            // and a list's targets on `,` — joining these with a space produced
            // one binding whose target was the entire rest of the flag, and it
            // parsed without complaint.
            .join(';')

          return json(200, {
            ok: true,
            mode: held.mode,
            decide: decide.map((/** @type {any} */ p) => ({ name: p.name, cardinality: p.cardinality })),
            commands: [
              `artifact-operator instance create ${id} ${artifact} ${declared.key} ` +
                '--group <the group it is delivered to> ' +
                (spell === '' ? '' : `--bind '${spell}' `) + packages
            ],
            why: decide.length === 0
              ? `Every port ${artifact} declares is filled by the runtime or derived from the set, so there is ` +
                'nothing here for an admin to decide.'
              : `${decide.map((/** @type {any} */ p) => p.name).join(', ')} ` +
                `${decide.length === 1 ? 'is a port' : 'are ports'} nobody else can decide, and ` +
                `${decide.length === 1 ? 'it is' : 'they are'} spelled empty above. Bind ` +
                `${decide.length === 1 ? 'it' : 'them'} in the same command — after signing, changing one is a ` +
                'removal and a fresh id.'
          })
        }

        return json(400, { ok: false, why: 'a change to an instance is an add or a remove' })
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

        const refusal = mayPlan()
        if (refusal) return json(200, refusal)

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
