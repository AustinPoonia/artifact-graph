/**
 * A derived plan, as nodes and edges.
 *
 * ## Nothing here decides anything
 *
 * `artifact-planner`'s `plan()` already answers which instances exist and what
 * each one is bound to, and its `validate()` already answers what is wrong with
 * that. This file turns those two answers into something drawable and adds no
 * rule of its own — a picture that disagreed with `network check` would be worse
 * than no picture, and two implementations of one rule set is how two answers
 * drift apart.
 *
 * So: no reachability logic, no version resolution, no cardinality checking.
 * Those live in `chain.js` and their verdicts arrive here as `Problem[]`.
 *
 * ## What a node is
 *
 * One instance. Its ports come from its artifact's manifest kind, because a
 * binding says *what* a port points at and only the manifest says what the port
 * is — its contract, its range, whether it takes one target or many.
 *
 * A `platform:*` port is **filled by the runtime and bound by nobody**. It is a
 * terminal on the node rather than an edge to somewhere, and drawing it as an
 * unbound socket would report every correctly-wired instance as half-connected.
 */

/** Ports whose targets the runtime supplies, so no binding names one. */
const PLATFORM = /^platform:/

/**
 * How long a socket's description may be before it is cut to a sentence.
 *
 * Roughly three lines in a tooltip. Longer than that and the reader is being
 * handed the manifest rather than an answer.
 */
const LONG = 240

/**
 * The opening paragraph of a description, and nothing after it.
 *
 * A manifest's prose is written for somebody reading the manifest: a port's
 * description runs to four paragraphs of why the port is a port, and a
 * contract's opens with what it is and then argues with an alternative design
 * for a page. The first paragraph is the sentence a reader hovering a socket
 * wants; the rest is the argument they did not ask for.
 *
 * @param {unknown} prose
 */
function opening (prose) {
  const whole = String(prose === undefined || prose === null ? '' : prose).trim()
  if (whole === '') return ''

  // Markdown out. These descriptions are written to be read in a manifest and
  // they carry `**bold**` and backticked names; a tooltip is plain text, and a
  // browser draws the asterisks.
  const said = whole.split(/\n\s*\n/)[0]
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // A paragraph is the unit these were written in, and some of them run to five
  // lines. Past a screenful the first sentence is the part that answers "what is
  // this socket", so a long one is cut back to it rather than shown whole — and
  // a short one is left exactly as its author wrote it.
  if (said.length <= LONG) return said
  const stop = said.search(/\.\s/)
  return stop > 0 ? said.slice(0, stop + 1) : said
}

/**
 * What a contract is *for*, in the words of whoever declared it.
 *
 * Searched across the whole set rather than read off the providing artifact,
 * because an artifact that answers to a contract is usually not the one that
 * declared it: `artifact-graph` provides `cli` and `view` and its manifest
 * declares neither, so looking in its own file finds nothing every time.
 *
 * A contract shape *does* survive `manifest.parse` — unlike a port description,
 * which does not, and which is why the prose channel exists at all.
 *
 * @param {Record<string, any>} set
 * @param {string} id
 */
function purposeOf (set, id) {
  for (const name of Object.keys(set)) {
    const held = ((set[name] || {}).contracts || [])
      .find((/** @type {any} */ c) => String(c.id) === id)
    if (held) return opening(held.shape && held.shape.description)
  }
  return ''
}

/**
 * @typedef {object} Port
 * @property {string} name
 * @property {string} contract
 * @property {string} range
 * @property {string} cardinality   one, optional or many
 * @property {string} description
 * @property {boolean} platform     the runtime fills it; nothing binds it
 * @property {string[]} targets     instance ids this port reaches, in binding order
 */

/**
 * @typedef {object} Setting
 * @property {string} name
 * @property {string} type         what the kind says it is, or '' where it declares nothing
 * @property {boolean} optional    the author said an instance need not set it
 * @property {boolean} set         this instance carries a value for it
 * @property {string} value        the value, rendered — '' where it is unset
 * @property {string} description  what the kind says it is for
 * @property {boolean} declared    the kind declares it; false is a setting nothing reads
 */

/**
 * @typedef {object} Node
 * @property {string} id
 * @property {string} artifact
 * @property {string} kind
 * @property {Record<string, unknown>} config
 * @property {Port[]} ports
 * @property {string[]} provides    contract ids this instance answers to
 * @property {{ contract: string, used: boolean, description: string }[]} outputs  the same,
 *   as sockets on the node's right, each saying whether anything on this graph
 *   takes it and what the contract behind it is for
 * @property {Setting[]} settings   every setting the kind declares, set or not, and any
 *   the instance carries that the kind does not
 * @property {string} about         what the kind says its settings are, as a whole
 * @property {number} problems      how many faults land on it
 * @property {boolean} [draft]      proposed here and signed by nobody
 * @property {string} [block]       the block this is a part of, if any
 * @property {string} [role]        which part of that block it is
 * @property {any[]} [expose]       on the part that carries the surface: the ports
 *   the block handed back rather than filling
 * @property {any[]} [gives]        and the contracts it says it answers to
 * @property {string} [edge]        `in` or `out`: a boundary, not an instance
 * @property {boolean} [shut]       drawn as one node with the parts inside it
 * @property {number} [held]        how many instances this one node stands for
 */

/**
 * @typedef {object} Edge
 * @property {string} from      the consuming instance
 * @property {string} port      the port on it
 * @property {string} to        the providing instance
 * @property {string} contract  what crosses it
 * @property {boolean} broken   a problem lands on this exact port
 * @property {boolean} [draft]  one end of it is proposed here and signed by nobody
 */

/**
 * A value as a cell, without pretending an object is a word.
 *
 * @param {unknown} value
 */
function shown (value) {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Every setting an instance has, including the ones it has not set.
 *
 * The panel used to list the instance's `config` and nothing else, which showed
 * the settings somebody had already decided and hid every setting there was to
 * decide. A kind declaring four settings and an instance carrying one drew one
 * row, and the other three were invisible — indistinguishable from a kind with
 * no settings at all.
 *
 * The other direction is drawn too, and it is the more interesting one: a value
 * the kind does not declare is a setting *nothing reads*, and the planner
 * refuses the network over it. Leaving it out of the picture would hide the
 * cause of a fault the same picture is reporting.
 *
 * @param {any} kind
 * @param {Record<string, unknown>} config
 * @returns {Setting[]}
 */
function settingsOf (kind, config) {
  const fields = (kind && kind.config && kind.config.fields) || {}
  /** @type {Setting[]} */
  const out = []

  for (const name of Object.keys(fields)) {
    const field = fields[name] || {}
    const set = Object.prototype.hasOwnProperty.call(config, name)
    out.push({
      name,
      type: String(field.type || ''),
      optional: field.optional === true,
      set,
      value: set ? shown(config[name]) : '',
      description: opening(field.description),
      declared: true
    })
  }

  for (const name of Object.keys(config)) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) continue
    out.push({
      name,
      type: '',
      optional: false,
      set: true,
      value: shown(config[name]),
      description: '',
      declared: false
    })
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

/**
 * The kind a signed instance names, or the artifact's only kind.
 *
 * A manifest may hold several kinds and an instance names one. Falling back to
 * the first when the name does not match would draw ports the instance does not
 * have, so an unmatched kind is *no* ports rather than the wrong ones — and the
 * planner will already have refused that instance, which is where the reader is
 * told about it.
 *
 * @param {any} manifest
 * @param {string} wanted
 */
function kindOf (manifest, wanted) {
  const kinds = (manifest && manifest.kinds) || []
  if (kinds.length === 0) return null
  const named = kinds.find((/** @type {any} */ k) => k.key === wanted)
  if (named) return named
  // A manifest with exactly one kind and an instance that named nothing is the
  // ordinary case, not an ambiguity.
  return wanted === '' && kinds.length === 1 ? kinds[0] : null
}

/**
 * Every target a binding names, however it was spelled.
 *
 * A `one` port binds a string, a `many` port binds an array, and a port
 * deliberately left unbound binds `null` — three spellings of one field, and the
 * difference between them is the difference between one edge, several, and none.
 *
 * @param {unknown} binding
 * @returns {string[]}
 */
function targetsOf (binding) {
  if (typeof binding === 'string') return binding === '' ? [] : [binding]
  if (Array.isArray(binding)) return binding.filter((t) => typeof t === 'string' && t !== '')
  return []
}

/**
 * Everything one artifact needs, and the decisions it cannot make for you.
 *
 * ## What a block is, and what it is not
 *
 * It is **not a new kind of artifact**. Nothing on this platform composes
 * instances into a signed unit, and inventing one here would be this drawing
 * claiming a concept the network does not have. A block is a *recipe*: place
 * one and you get several drafts wired to each other, and what comes out is
 * still N `instance create` commands an administrator runs.
 *
 * Nor is it a catalogue. There is no list of "the QR studio block" anywhere in
 * this repository, because a drawing tool that knew the name of a particular
 * artifact would be the one piece of this platform that knew about another —
 * which is the coupling every other file here refuses. A block is *derived*: a
 * port wants a contract, and the manifests say who answers to it.
 *
 * ## Which ports the block fills, and which it hands back
 *
 * The rule is the whole design, and it is about **decisions rather than
 * convenience**. A port is filled inside the block only when there is nothing to
 * decide:
 *
 * - a `one` port with exactly one candidate — the answer is forced, so asking
 *   would be asking somebody to confirm arithmetic;
 * - and nothing else.
 *
 * Everything else is surfaced as a port on the block:
 *
 * - **`many`** — "how many, and which" is the question the port exists to ask;
 * - **`optional`** — the author said an instance may decline it, so declining is
 *   a decision and not a default;
 * - **a `one` port with several candidates** — the block must not pick, because
 *   picking silently is how a graph ends up wired to whichever manifest sorted
 *   first;
 * - **a `one` port with no candidate at all** — nothing here can satisfy it, and
 *   hiding that produces a block that looks complete and will not plan.
 *
 * A `platform:` port is neither: the runtime fills it and nobody binds one.
 *
 * ## Reuse before creation
 *
 * A contract already answered by exactly one instance on the graph is bound to
 * *that* instance rather than to a fresh copy. A block that placed its own
 * private shortlink beside the one already running would be a block that reads
 * as tidy and doubles the estate every time it is used.
 *
 * @param {object} input
 * @param {Record<string, any>} input.manifests
 * @param {string} input.artifact
 * @param {string} [input.kind]
 * @param {{ id: string, provides: string[] }[]} [input.present]  what the graph already has
 * @returns {{ parts: {role: string, artifact: string, kind: string, bindings: Record<string, any>}[],
 *   expose: {name: string, role: string, port: string, contract: string, cardinality: string,
 *     why: string, candidates: string[]}[],
 *   reused: {role: string, port: string, id: string}[] }}
 */
function needs ({ manifests, artifact, kind = '', present = [] } = /** @type {any} */ ({})) {
  const set = manifests && typeof manifests === 'object' ? manifests : {}

  /** Who, among the manifests, answers to a contract. */
  const answers = (/** @type {string} */ contract) => {
    /** @type {{artifact: string, kind: string}[]} */
    const all = []
    for (const name of Object.keys(set).sort()) {
      for (const k of (set[name] || {}).kinds || []) {
        if (((k.provides || []).some((/** @type {any} */ p) => String(p.id) === contract))) {
          all.push({ artifact: name, kind: String(k.key) })
        }
      }
    }
    return all
  }

  /** Which instances already on the graph answer to it. */
  const running = (/** @type {string} */ contract) =>
    present.filter((n) => (n.provides || []).includes(contract)).map((n) => n.id)

  /** @type {any[]} */
  const parts = []
  /** @type {any[]} */
  const expose = []
  /** @type {any[]} */
  const reused = []

  /** One role per artifact, so a diamond binds one copy rather than two. */
  const roleOf = new Map()

  /**
   * @param {string} name @param {string} wanted @param {string} role
   */
  function add (name, wanted, role) {
    const declared = kindOf(set[name], wanted)
    if (!declared) return null
    if (roleOf.has(name)) return roleOf.get(name)
    roleOf.set(name, role)

    /** @type {Record<string, any>} */
    const bindings = {}
    const part = { role, artifact: name, kind: String(declared.key), bindings }
    // Pushed before its ports are walked, so a cycle binds the role that is
    // already on the way rather than recursing forever. `chain.js` says plainly
    // that a cycle is satisfiable, so this cannot be an error.
    parts.push(part)

    for (const port of declared.ports || []) {
      const contract = String(port.contract)
      if (contract.startsWith('platform:') || contract.startsWith('kernel:')) continue
      const cardinality = String(port.cardinality || 'one')
      const label = role === 'main' ? port.name : `${role}.${port.name}`

      if (cardinality !== 'one') {
        bindings[port.name] = cardinality === 'many' ? [] : null
        expose.push({
          name: label,
          role,
          port: String(port.name),
          contract,
          cardinality,
          why: cardinality === 'many'
            ? 'How many, and which, is the question this port exists to ask.'
            : 'The author said an instance may decline this, so declining is a decision.',
          candidates: [...running(contract), ...answers(contract).map((a) => `${a.artifact}/${a.kind}`)]
        })
        continue
      }

      const already = running(contract)
      if (already.length === 1) {
        bindings[port.name] = already[0]
        reused.push({ role, port: String(port.name), id: already[0] })
        continue
      }

      const able = answers(contract)
      if (already.length === 0 && able.length === 1) {
        const made = add(able[0].artifact, able[0].kind, able[0].artifact)
        if (made) { bindings[port.name] = { role: made } ; continue }
      }

      expose.push({
        name: label,
        role,
        port: String(port.name),
        contract,
        cardinality,
        why: already.length + able.length === 0
          ? `Nothing here answers to ${contract}.`
          : 'More than one thing answers to this, and a block that picked would be picking silently.',
        candidates: [...already, ...able.map((a) => `${a.artifact}/${a.kind}`)]
      })
    }

    return role
  }

  add(artifact, kind, 'main')
  return { parts, expose, reused }
}

/**
 * Turn a derived plan into nodes and edges.
 *
 * @param {object} input
 * @param {any[]} input.instances    what `plan()` returned
 * @param {Record<string, any>} input.manifests
 * @param {any[]} [input.problems]   what `validate()` returned
 * @param {Record<string, any>} [input.prose]  what each port and contract is for,
 *   keyed by artifact — a parsed manifest carries no descriptions, so the
 *   producer reads them off the files and hands them over separately
 * @returns {{ nodes: Node[], edges: Edge[], problems: any[] }}
 */
function model ({ instances, manifests, problems = [], prose = {} } = /** @type {any} */ ({})) {
  const all = Array.isArray(instances) ? instances : []
  const set = manifests && typeof manifests === 'object' ? manifests : {}
  const faults = Array.isArray(problems) ? problems : []
  const said = prose && typeof prose === 'object' ? prose : {}

  /** @param {string} artifact @param {string} kind @param {string} port */
  const aboutPort = (artifact, kind, port) =>
    opening(((said[artifact] || {}).ports || {})[`${kind} ${port}`])

  /** @param {string} artifact @param {string} contract */
  const aboutContract = (artifact, contract) =>
    opening(((said[artifact] || {}).contracts || {})[contract])


  // Which instances exist at all. An edge to something that is not here is not
  // an edge — the planner has already refused it, and drawing a spline into
  // empty space would be this file inventing a node.
  const known = new Set(all.map((i) => String(i.id)))

  /** Which of them nobody has signed. */
  const drafted = new Set(all.filter((i) => i.draft === true).map((i) => String(i.id)))

  /** How many faults land on each instance, and on which of its ports. */
  const onInstance = new Map()
  const onPort = new Set()
  for (const fault of faults) {
    const id = String(fault.instance || '')
    if (id !== '') onInstance.set(id, (onInstance.get(id) || 0) + 1)
    if (id !== '' && fault.port) onPort.add(`${id} ${fault.port}`)
  }

  /** @type {Node[]} */
  const nodes = []
  /** @type {Edge[]} */
  const edges = []

  for (const instance of all) {
    const id = String(instance.id)
    const artifact = String(instance.artifact || '')
    const manifest = set[artifact]
    const kind = kindOf(manifest, String(instance.kind || ''))
    const bindings = instance.bindings && typeof instance.bindings === 'object' ? instance.bindings : {}

    /** @type {Port[]} */
    const ports = ((kind && kind.ports) || []).map((/** @type {any} */ p) => {
      const name = String(p.name)
      const contract = String(p.contract || '')
      const platform = PLATFORM.test(contract)
      // A platform port names no target even when a binding exists for it: the
      // runtime is what fills it, and an id here would be a caller claiming to
      // have chosen the kernel's own instance.
      const targets = platform ? [] : targetsOf(bindings[name]).filter((t) => known.has(t))

      for (const to of targets) {
        // Draft at either end. A wire from a proposed node to a signed one is
        // not a wire that exists, and neither is one *into* a proposed node.
        const proposed = instance.draft === true || drafted.has(to)
        edges.push({
          from: id,
          port: name,
          to,
          contract,
          broken: onPort.has(`${id} ${name}`),
          ...(proposed ? { draft: true } : {})
        })
      }

      return {
        name,
        contract,
        range: String(p.range || ''),
        cardinality: String(p.cardinality || 'one'),
        description: aboutPort(artifact, String((kind && kind.key) || ''), name) || opening(p.description),
        platform,
        targets
      }
    })

    nodes.push({
      id,
      artifact,
      kind: String(instance.kind || ''),
      config: instance.config && typeof instance.config === 'object' ? instance.config : {},
      settings: settingsOf(kind, instance.config && typeof instance.config === 'object' ? instance.config : {}),
      about: opening(kind && kind.config && kind.config.description),
      ...(instance.draft === true ? { draft: true } : {}),
      ...(instance.block ? { block: String(instance.block), role: String(instance.role || '') } : {}),
      ...(Array.isArray(instance.expose) ? { expose: instance.expose } : {}),
      ...(Array.isArray(instance.gives) ? { gives: instance.gives } : {}),
      ports,
      provides: ((kind && kind.provides) || []).map((/** @type {any} */ v) => String(v.id)),
      // Filled once every edge is known: whether an output is taken is a fact
      // about the graph, and a node cannot see one.
      outputs: /** @type {{ contract: string, used: boolean, description: string }[]} */ ([]),
      problems: onInstance.get(id) || 0
    })
  }

  // What each node *gives*, as sockets on its right, and whether anything takes
  // it. Derived here rather than in the drawing, because "is this contract
  // consumed" is a question about the whole graph and a node cannot see one.
  //
  // An unconsumed output is worth drawing rather than hiding: an instance that
  // answers to a contract nothing on this network asks for is either a spare or
  // a wiring mistake, and both are things a reader wants to notice.
  /** @type {Set<string>} */
  const taken = new Set(edges.map((e) => `${e.to} ${e.contract}`))
  for (const node of nodes) {
    node.outputs = node.provides.map((/** @type {string} */ contract) => ({
      contract,
      used: taken.has(`${node.id} ${contract}`),
      description: aboutContract(node.artifact, contract) || purposeOf(set, contract)
    }))
  }

  // Sorted, because two runs over one plan have to produce one picture. The
  // planner already sorts its instances; this makes the promise this file's own
  // rather than one it inherits and could quietly lose.
  const by = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0)
  nodes.sort((a, b) => by(a.id, b.id))
  edges.sort((a, b) => by(a.from, b.from) || by(a.port, b.port) || by(a.to, b.to))

  return { nodes, edges, problems: faults }
}

/**
 * Fold each block into the one node it is meant to be.
 *
 * The parts of a block are ordinary instances and are drawn as such the moment
 * anybody opens it. Shut, they are one node carrying the ports the block
 * *surfaced* — which is the whole point of a block, and the reason this is not
 * `collapse()`: folding by artifact answers "how many of these are there", and
 * this answers "what is there left to decide".
 *
 * An edge into a part becomes an edge into the block, but only where it comes
 * from outside: the wiring the block did for itself is the thing it exists to
 * hide.
 *
 * @param {{ nodes: Node[], edges: Edge[] }} graph
 * @param {Set<string>} open   blocks somebody asked to see inside
 */
function shutBlocks (graph, open) {
  const shut = new Set(graph.nodes
    .filter((n) => n.block !== undefined && n.block !== '' && !open.has(String(n.block)))
    .map((n) => String(n.block)))
  if (shut.size === 0) return { nodes: graph.nodes, edges: graph.edges }

  /** Where each instance ends up. */
  const at = new Map()
  for (const node of graph.nodes) {
    at.set(node.id, node.block !== undefined && shut.has(String(node.block)) ? String(node.block) : node.id)
  }

  /** @type {Map<string, any>} */
  const kept = new Map()

  // The surface first, in its own pass. A block is named after its main part and
  // carries that part's id, so a single loop that folded "everything whose id is
  // not the block id" left the main part alone with every port it has — which is
  // a block that saved nobody anything and was drawn as an ordinary node.
  for (const node of graph.nodes) {
    if (node.expose === undefined) continue
    const to = String(node.block || '')
    if (!shut.has(to)) continue
    kept.set(to, {
      ...node,
      id: to,
      // Only the ports the block handed back...
      ports: (node.ports || []).filter((p) => (node.expose || [])
        .some((/** @type {any} */ e) => e.role === 'main' && e.port === p.name)),
      // ...and only the contracts it says it answers to. Merging every part's
      // outputs was the earlier spelling and it made the surface something
      // nobody chose: a block answers to what it was wired to answer to.
      outputs: (node.outputs || []).filter((o) => (node.gives || [])
        .some((/** @type {any} */ g) => g.role === 'main' && g.contract === o.contract)),
      held: 1,
      block: to,
      shut: true
    })
  }

  for (const node of graph.nodes) {
    const to = at.get(node.id)
    const surface = kept.get(to)
    if (surface !== undefined && surface.shut === true) {
      if (node.expose !== undefined) continue
      surface.held += 1
      surface.problems += node.problems
      continue
    }
    if (!kept.has(to)) kept.set(to, node)
  }

  /** @type {Map<string, any>} */
  const between = new Map()
  for (const edge of graph.edges) {
    const from = at.get(edge.from)
    const to = at.get(edge.to)
    if (from === undefined || to === undefined || from === to) continue
    const key = `${from} ${edge.port} ${to}`
    if (!between.has(key)) between.set(key, { ...edge, from, to })
  }

  return { nodes: [...kept.values()], edges: [...between.values()] }
}

/**
 * One node and everything within `depth` hops of it.
 *
 * The answer to "show me this thing and what it touches, not the whole estate".
 * Hops are counted in **both** directions: what this instance reaches and what
 * reaches it are equally its neighbourhood, and a reader asking about a
 * shortlink instance wants the studios pointing at it as much as the store
 * underneath it.
 *
 * @param {{ nodes: Node[], edges: Edge[] }} graph
 * @param {string} id
 * @param {number} depth
 */
function around (graph, id, depth) {
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  if (!nodes.some((n) => n.id === id)) return { nodes: [], edges: [], missing: true }

  /** @type {Map<string, string[]>} */
  const beside = new Map()
  const link = (/** @type {string} */ a, /** @type {string} */ b) => {
    const held = beside.get(a)
    if (held) held.push(b)
    else beside.set(a, [b])
  }
  for (const edge of edges) { link(edge.from, edge.to); link(edge.to, edge.from) }

  const reached = new Set([id])
  let ring = [id]
  for (let step = 0; step < Math.max(0, depth); step++) {
    /** @type {string[]} */
    const next = []
    for (const at of ring) {
      for (const to of beside.get(at) || []) {
        if (reached.has(to)) continue
        reached.add(to)
        next.push(to)
      }
    }
    if (next.length === 0) break
    ring = next
  }

  return {
    nodes: nodes.filter((n) => reached.has(n.id)),
    // Only edges with *both* ends inside. An edge leaving the neighbourhood is a
    // line to nothing, and drawing one suggests a node that is not on screen.
    edges: edges.filter((e) => reached.has(e.from) && reached.has(e.to)),
    missing: false
  }
}

/**
 * Fold every instance of one artifact into a single node.
 *
 * The first way a large graph gets smaller: eleven `permissions` instances are
 * eleven nodes saying the same thing. A collapsed node keeps its **external**
 * edges and drops the internal ones, so what the group talks to is still
 * visible and what it says to itself is not.
 *
 * @param {{ nodes: Node[], edges: Edge[] }} graph
 * @param {string[]} artifacts  which artifacts to fold; others are left alone
 */
function collapse (graph, artifacts) {
  const fold = new Set(artifacts || [])
  if (fold.size === 0) return { nodes: graph.nodes, edges: graph.edges }

  /** Where each instance ends up. */
  const at = new Map()
  for (const node of graph.nodes) {
    at.set(node.id, fold.has(node.artifact) ? `artifact:${node.artifact}` : node.id)
  }

  /** @type {Map<string, any>} */
  const kept = new Map()
  for (const node of graph.nodes) {
    const to = at.get(node.id)
    if (to === node.id) { kept.set(to, node); continue }
    const already = kept.get(to)
    if (already) { already.held += 1; already.problems += node.problems; continue }
    kept.set(to, {
      id: to,
      artifact: node.artifact,
      kind: '',
      config: {},
      // Nor any settings, for the ports' reason below: two instances of one
      // artifact are two *different* signed decisions, and a fold that showed
      // one of them would be showing whichever happened to be first.
      settings: [],
      about: '',
      // A folded node has no ports of its own: they belong to the instances
      // inside it, and one row of eleven sockets summarises nothing.
      ports: [],
      provides: node.provides,
      // The outputs survive the fold where the inputs do not, and the asymmetry
      // is the point: a folded node still *answers* to the same contracts, and
      // the edges into it have to land somewhere. Its inputs belong to the
      // instances inside it and summarise nothing.
      outputs: (node.outputs || []).map((/** @type {any} */ o) => ({ ...o })),
      problems: node.problems,
      held: 1,
      folded: true
    })
  }

  /** @type {Map<string, any>} */
  const between = new Map()
  for (const edge of graph.edges) {
    const from = at.get(edge.from)
    const to = at.get(edge.to)
    if (from === undefined || to === undefined || from === to) continue
    const key = `${from} ${edge.port} ${to}`
    if (!between.has(key)) between.set(key, { ...edge, from, to })
  }

  return { nodes: [...kept.values()], edges: [...between.values()] }
}

module.exports = { model, around, collapse, shutBlocks, kindOf, targetsOf, opening, needs, PLATFORM }
