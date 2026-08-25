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
 * @typedef {object} Node
 * @property {string} id
 * @property {string} artifact
 * @property {string} kind
 * @property {Record<string, unknown>} config
 * @property {Port[]} ports
 * @property {string[]} provides    contract ids this instance answers to
 * @property {number} problems      how many faults land on it
 */

/**
 * @typedef {object} Edge
 * @property {string} from      the consuming instance
 * @property {string} port      the port on it
 * @property {string} to        the providing instance
 * @property {string} contract  what crosses it
 * @property {boolean} broken   a problem lands on this exact port
 */

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
 * Turn a derived plan into nodes and edges.
 *
 * @param {object} input
 * @param {any[]} input.instances    what `plan()` returned
 * @param {Record<string, any>} input.manifests
 * @param {any[]} [input.problems]   what `validate()` returned
 * @returns {{ nodes: Node[], edges: Edge[], problems: any[] }}
 */
function model ({ instances, manifests, problems = [] } = /** @type {any} */ ({})) {
  const all = Array.isArray(instances) ? instances : []
  const set = manifests && typeof manifests === 'object' ? manifests : {}
  const faults = Array.isArray(problems) ? problems : []

  // Which instances exist at all. An edge to something that is not here is not
  // an edge — the planner has already refused it, and drawing a spline into
  // empty space would be this file inventing a node.
  const known = new Set(all.map((i) => String(i.id)))

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
        edges.push({ from: id, port: name, to, contract, broken: onPort.has(`${id} ${name}`) })
      }

      return {
        name,
        contract,
        range: String(p.range || ''),
        cardinality: String(p.cardinality || 'one'),
        description: String(p.description || ''),
        platform,
        targets
      }
    })

    nodes.push({
      id,
      artifact,
      kind: String(instance.kind || ''),
      config: instance.config && typeof instance.config === 'object' ? instance.config : {},
      ports,
      provides: ((kind && kind.provides) || []).map((/** @type {any} */ v) => String(v.id)),
      problems: onInstance.get(id) || 0
    })
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
      // A folded node has no ports of its own: they belong to the instances
      // inside it, and one row of eleven sockets summarises nothing.
      ports: [],
      provides: node.provides,
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

module.exports = { model, around, collapse, kindOf, targetsOf, PLATFORM }
