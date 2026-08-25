# artifact-graph

The platform's own wiring, drawn — instances, ports and the splines between
them, on a canvas you can focus, fold and cut down.

An instance of the QR studio bound to two shortlink instances draws two curves
out of one `links` port, one to each. That is exactly what `plan()` already
computes for every device on the network, and until now nothing had ever drawn
it.

```
artifact-operator network graph --network <n> --package ../artifact-kit,../artifact-qr-studio > graph.json
artifact-graph serve "$(cat graph.json)"
```

## This cannot see the thing it draws

`platform:network-view` answers exactly seven questions — whoami, members,
groupsOf, usersOf, groups, permissions, grantsOf — and **not one of them is about
instances or bindings**. There is no `platform:assemble`, and
`ArtifactPatform/DESIGN-CONFORMANCE.md` §3 is the long argument for why there
must never be: an artifact that could enumerate the deployment could enumerate
every other artifact's authority, which is the map an attacker wants most.

So this artifact is handed a graph rather than allowed to ask for one. The
document arrives on the request, and the producer is whatever can honestly make
one — `artifact-operator network graph`, which holds the keyring, reads the
signed log, and runs the same `plan()` and `chain.validate()` a device runs.

Everything that follows from that is in `lib/routes.js`.

## Cutting a large graph down

A whole estate is not a picture anybody reads, so there are four ways to narrow
one and a ceiling behind them.

| | What it does |
| --- | --- |
| **Focus** | One instance and everything within *n* hops, in both directions. `#/node/<id>` is a canvas focused on that node, never a screen instead of it. |
| **Fold** | Every instance of one artifact becomes one node carrying a count. Edges out of the group survive; edges inside it are hidden. |
| **Filter** | By artifact, by a search over ids, or down to only what has a problem. |
| **Ceiling** | Never more than `CANVAS` nodes at once — and the note **says how many are missing**, because a cap nobody mentions reads as "that was the whole graph". |

They apply in that order, which is not arbitrary: fold first so a focus lands on
a folded node rather than inside one, then focus, then filter. Narrowing before
focusing would build the neighbourhood of whatever survived the filter, which is
the neighbourhood of nothing.

## The layout, and where a node sits

`lib/layout.js` is pure and deterministic — ranked by longest path so a node sits
right of *everything* it depends on rather than of the nearest one, ordered
within a rank by the median heuristic to cut crossings, and cycle-safe, because
`chain.js` says plainly that a cycle is satisfiable.

Nodes drag, and a dragged position is kept in `platform:store` per network. It is
**advisory** in both directions: a node with no saved place still gets an
automatic one, and a saved place for a node that has since gone is dropped rather
than drawn. A stale arrangement must never hide an instance that has appeared —
the graph is the truth and the arrangement is a preference.

## Nothing here signs anything

The mode is a property of the document, not a setting on this side, so this
application cannot grant itself authority it was not handed.

- **read** — a picture of the wiring.
- **plan** — the canvas will also work out what *would* change a port, and print
  the commands.

There is no third mode, and that is a fact about the platform rather than a
corner cut. **Nothing on this platform edits a signed instance's wiring.**
`artifact-operator instance create` refuses an id the network already has, and
`instance remove` says in its own words that burning an id is the only way to
re-sign an instance on new terms. So rewiring one port is a removal and a fresh
instance under a *different id*, permanently — which is not a button, and which
the planned change leads with rather than hides.

`test/operator.test.js` checks the printed commands against
`artifact-operator`'s own spec and its own `--bind` parser rather than against a
string. It exists because the first version of this printed `artifact-operator
instance bindings …`, a verb that has never existed, with a green assertion
beside it.

## Four surfaces, one implementation

| Surface | How it arrives |
| --- | --- |
| Command line | `cli@2.0.0` — `serve`, `request`, `show`, `problems` |
| Terminal / desktop window | `view@1.1.0` — a summary, never the canvas |
| Browser | `platform:listen` serves the document `lib/screen.js` builds |
| Programs | POST to the same socket, JSON in and JSON out |

The panel is deliberately a summary. A canvas is a picture and a panel is a few
lines of text; drawing one as ASCII would be a second renderer that can disagree
with the first about what is connected to what.

## The canvas has no library under it

Every node editor worth copying is React, which is unreachable from a page an
artifact authored. So nodes are HTML, edges are SVG, and both sit under one CSS
`transform` — text never goes inside a scaled `viewBox`, which the charts already
learned. Zoom is about the pointer rather than the origin, arrows pan, `+`/`-`
zoom, `0` fits, and Enter opens a node: a canvas nobody can reach without a mouse
is not finished.

## Running the suites

```
npm test
npm run typecheck
```

The model and the routes are driven against **the real manifests and the real
planner** — `plan()` derives the whole network from the artifact set on disk, and
one case requires the drawn node and edge counts to equal what it returned. A
picture that disagrees with the planner fails there rather than on a screen.
