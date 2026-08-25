/**
 * Where each node goes.
 *
 * A pure function, and **deterministic**: the same graph lays out the same way
 * every time. That is the rule every derivation in this tree follows, and here
 * it is what makes a picture something you can learn — a canvas that rearranges
 * itself between visits is one nobody builds a memory of.
 *
 * ## Providers on the left
 *
 * An edge runs consumer to provider, and a consumer's ports are drawn on its
 * left, so the thing a port reaches has to sit to the left of the port. A studio
 * bound to two shortlink instances has them upstream of it, and its `links`
 * input takes a spline from each.
 *
 * ## Cycles are legal here
 *
 * `chain.js` says so plainly: contract C requiring D and D requiring C is
 * satisfiable. So the ranking cannot assume a DAG. A back edge — one that
 * reaches a node already being visited — is **ignored for ranking and marked**,
 * so the layout terminates and the drawing can show the cycle as what it is
 * rather than pretending it is not there.
 */

/** How large a node is drawn, before its ports are counted. */
const NODE = { width: 220, head: 56, port: 22, foot: 12 }

/** The space between ranks, and between nodes within one. */
const GAP = { x: 120, y: 32 }

/**
 * How tall a node is.
 *
 * Its ports are rows, so a node with nine of them is taller than one with two.
 * Computed here rather than measured in the page, because the edges have to know
 * where a port sits before anything is on screen — and a layout that depends on
 * the browser is one the suite cannot check.
 *
 * @param {any} node
 */
function heightOf (node) {
  const ports = (node.ports || []).length
  return NODE.head + ports * NODE.port + NODE.foot
}

/**
 * Where a port's dot sits, relative to its node's top-left.
 *
 * The one place this is decided. The page draws the dot from it and the layout
 * draws the spline to it, so a change here moves both and they cannot disagree.
 *
 * @param {number} index
 */
function portAt (index) {
  return { x: 0, y: NODE.head + index * NODE.port + NODE.port / 2 }
}

/**
 * Rank every node: providers to the left, consumers to the right.
 *
 * Longest path rather than shortest, so a node sits to the right of *everything*
 * it depends on rather than to the right of the nearest one — which is what
 * stops an edge running backwards through a rank it should have cleared.
 *
 * @param {{ nodes: any[], edges: any[] }} graph
 * @returns {{ rank: Map<string, number>, back: Set<string> }}
 */
function rankOf (graph) {
  /** @type {Map<string, string[]>} */
  const providers = new Map()
  for (const node of graph.nodes) providers.set(node.id, [])
  for (const edge of graph.edges) {
    const held = providers.get(edge.from)
    if (held && providers.has(edge.to)) held.push(edge.to)
  }

  /** @type {Map<string, number>} */
  const rank = new Map()
  /** @type {Set<string>} */
  const back = new Set()
  /** @type {Set<string>} */
  const open = new Set()

  /** @param {string} id @returns {number} */
  const depth = (id) => {
    const already = rank.get(id)
    if (already !== undefined) return already
    if (open.has(id)) {
      // A cycle. Ranking it would not terminate, so this edge is out of the
      // ranking and into `back`, where the drawing can say so.
      return 0
    }
    open.add(id)
    let deepest = 0
    for (const to of providers.get(id) || []) {
      if (open.has(to)) { back.add(`${id} ${to}`); continue }
      deepest = Math.max(deepest, depth(to) + 1)
    }
    open.delete(id)
    rank.set(id, deepest)
    return deepest
  }

  // In id order, so which node a cycle is entered from is decided by the ids
  // rather than by whatever order the edges happened to arrive in.
  for (const node of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) depth(node.id)
  return { rank, back }
}

/**
 * Order the nodes within each rank to cut down crossings.
 *
 * The median heuristic, two passes. Not optimal — crossing minimisation is
 * NP-hard and nobody needs the optimum — but it is stable, cheap, and turns the
 * usual tangle into something readable.
 *
 * `ponytail:` two passes because the third rarely moves anything on graphs this
 * size. More passes if a real network ever looks knotted.
 *
 * @param {{ nodes: any[], edges: any[] }} graph
 * @param {Map<string, number>} rank
 */
function order (graph, rank) {
  /** @type {Map<number, string[]>} */
  const ranks = new Map()
  for (const node of graph.nodes) {
    const at = rank.get(node.id) || 0
    const held = ranks.get(at)
    if (held) held.push(node.id)
    else ranks.set(at, [node.id])
  }
  // Alphabetical to start with, so the first pass has a defined thing to improve.
  for (const ids of ranks.values()) ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  /** @type {Map<string, string[]>} */
  const beside = new Map()
  for (const edge of graph.edges) {
    for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const held = beside.get(a)
      if (held) held.push(b)
      else beside.set(a, [b])
    }
  }

  const levels = [...ranks.keys()].sort((a, b) => a - b)
  for (let pass = 0; pass < 2; pass++) {
    for (const level of levels) {
      const ids = /** @type {string[]} */ (ranks.get(level))
      /** @type {Map<string, number>} */
      const place = new Map()
      for (const id of ids) {
        const near = (beside.get(id) || [])
          .map((other) => {
            const at = rank.get(other)
            if (at === undefined || at === level) return -1
            return /** @type {string[]} */ (ranks.get(at)).indexOf(other)
          })
          .filter((n) => n >= 0)
          .sort((a, b) => a - b)
        // A node with no neighbours elsewhere keeps where it is, rather than
        // being swept to the top by a median of nothing.
        place.set(id, near.length === 0 ? ids.indexOf(id) : near[Math.floor(near.length / 2)])
      }
      ids.sort((a, b) => {
        const byMedian = /** @type {number} */ (place.get(a)) - /** @type {number} */ (place.get(b))
        // Ties broken by id, never by the previous order — an unstable tiebreak
        // is how a layout stops being the same twice.
        return byMedian || (a < b ? -1 : a > b ? 1 : 0)
      })
    }
  }

  return ranks
}

/**
 * Lay a graph out.
 *
 * @param {{ nodes: any[], edges: any[] }} graph
 * @param {Record<string, { x: number, y: number }>} [saved]
 *        positions somebody dragged. **Advisory**: a node with none takes its
 *        computed place, and a saved place for a node that is gone is ignored.
 *        A stale arrangement must never hide a node that has appeared.
 * @returns {{ nodes: any[], edges: any[], width: number, height: number, back: Set<string> }}
 */
function layout (graph, saved = {}) {
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0, back: new Set() }

  const { rank, back } = rankOf({ nodes, edges })
  const ranks = order({ nodes, edges }, rank)

  /** @type {Map<string, any>} */
  const byId = new Map(nodes.map((n) => [n.id, n]))
  /** @type {Map<string, { x: number, y: number, height: number }>} */
  const at = new Map()

  const levels = [...ranks.keys()].sort((a, b) => a - b)
  for (const level of levels) {
    let y = 0
    for (const id of /** @type {string[]} */ (ranks.get(level))) {
      const node = byId.get(id)
      const height = heightOf(node)
      at.set(id, { x: level * (NODE.width + GAP.x), y, height })
      y += height + GAP.y
    }
  }

  // Every rank centred against the tallest, so a graph with one long column and
  // several short ones does not read as a staircase.
  const tallest = Math.max(...levels.map((level) => {
    const ids = /** @type {string[]} */ (ranks.get(level))
    const last = /** @type {any} */ (at.get(ids[ids.length - 1]))
    return last.y + last.height
  }))
  for (const level of levels) {
    const ids = /** @type {string[]} */ (ranks.get(level))
    const last = /** @type {any} */ (at.get(ids[ids.length - 1]))
    const shift = (tallest - (last.y + last.height)) / 2
    for (const id of ids) {
      const place = /** @type {any} */ (at.get(id))
      place.y += shift
    }
  }

  const placed = nodes.map((node) => {
    const computed = /** @type {any} */ (at.get(node.id))
    const held = saved && saved[node.id]
    const moved = held && Number.isFinite(held.x) && Number.isFinite(held.y)
    return {
      ...node,
      x: moved ? held.x : computed.x,
      y: moved ? held.y : computed.y,
      width: NODE.width,
      height: computed.height,
      rank: rank.get(node.id) || 0,
      moved: Boolean(moved)
    }
  })

  /** @type {Map<string, any>} */
  const spot = new Map(placed.map((n) => [n.id, n]))

  const drawn = edges.map((edge) => {
    const from = spot.get(edge.from)
    const to = spot.get(edge.to)
    if (!from || !to) return null
    const index = (from.ports || []).findIndex((/** @type {any} */ p) => p.name === edge.port)
    const socket = portAt(index < 0 ? 0 : index)
    return {
      ...edge,
      // The consumer's port dot, on its left edge.
      x1: from.x + socket.x,
      y1: from.y + socket.y,
      // The provider's right edge, at its middle: a node answers on its whole
      // right side rather than at a numbered socket, because what it provides is
      // the instance and not one of its ports.
      x2: to.x + to.width,
      y2: to.y + to.height / 2,
      back: back.has(`${edge.from} ${edge.to}`)
    }
  }).filter(Boolean)

  const width = Math.max(...placed.map((n) => n.x + n.width))
  const height = Math.max(...placed.map((n) => n.y + n.height))
  return { nodes: placed, edges: /** @type {any[]} */ (drawn), width, height, back }
}

module.exports = { layout, rankOf, order, heightOf, portAt, NODE, GAP }
