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
| **Filter** | By artifact, or down to only what has a problem. |
| **Ceiling** | Never more than `CANVAS` nodes at once — and the note **says how many are missing**, because a cap nobody mentions reads as "that was the whole graph". |

They apply in that order, which is not arbitrary: fold first so a focus lands on
a folded node rather than inside one, then focus, then filter. Narrowing before
focusing would build the neighbourhood of whatever survived the filter, which is
the neighbourhood of nothing.

## One box, and the rest in the rail

There used to be a strip of five controls across the top of the picture — a Find
box, a depth menu, an artifact menu and two toggles — which is the shape a screen
takes when nobody has decided where its controls live. Worse, two of them
answered the same question differently: Find narrowed the drawing and the
artifact menu narrowed the drawing, and the canvas kept whichever was typed in
last.

So there is one box now, and it is not on screen until it is wanted: ⌘K or Ctrl-K
opens a command menu that holds every instance, every artifact, and the things a
person can do. Naming an instance opens it; naming an artifact filters to it.
Everything that shapes what is drawn — **Hops**, folding, faults-only — lives in
the right rail beside the node it is about, and Hops is a number with steps
rather than a menu of four words for four numbers.

## Adding and removing an instance

Both are commands in that menu, and both end in a line of text rather than in
anything happening. `lib/routes.js` works the change out against the manifests
the graph was handed, so an id the network already has is refused *here* — with
the sentence `instance create` would have refused it with — rather than after a
paste and ten seconds.

An add spells only the ports an admin decides. A `one` port has no unbound state
(the planner derives it from the set) and a `platform:` port is the runtime's, so
writing either would be inventing a decision nobody made; what is left is spelled
empty, `port=[]` for a `many` and `port=null` for an optional, joined with `;` —
which is what `artifact-operator/lib/args.js` splits on, and joining them with a
space instead produced one binding whose target was the whole rest of the flag
and parsed without complaint.

A removal says what it burns and who it breaks *before* it is run: the id can
never be used on this network again, and every instance bound to the one going
away stops planning until it is rebound — which is itself a removal and a fresh
id, for each of them. Saying that afterwards is a post-mortem.

## Blocks

Placing a studio and then wiring its encoder, its kit and whatever else it needs
is six decisions to express one. **A block is one artifact and everything it
needs, placed at once** — and it is what the drawer hands you, so there is no
second gesture to learn.

It is not a new kind of artifact. Nothing on this platform composes instances
into a signed unit, and inventing one here would be this drawing claiming a
concept the network does not have. A block is a *recipe*: several drafts wired to
each other, and what comes out is still one `instance create` per part.

Nor is it a catalogue. There is no list of "the QR studio block" anywhere in this
repository, because a drawing tool that knew the name of a particular artifact
would be the one piece of this platform that knew about another. A block is
**derived** — a port wants a contract, and the manifests say who answers to it.

### Which ports it fills, and which it hands back

The rule is about **decisions, not convenience**. A port is filled inside the
block only when there is nothing to decide:

| | |
| --- | --- |
| `one` port, exactly one candidate | **Filled.** Asking would be asking somebody to confirm arithmetic. |
| `many` port | **Handed back.** "How many, and which" is the question the port exists to ask. |
| `optional` port | **Handed back.** The author said an instance may decline it, so declining is a decision. |
| `one` port, several candidates | **Handed back.** A block that picked would be picking silently, which is how a graph gets wired to whichever manifest sorted first. |
| `one` port, no candidate | **Handed back.** Nothing here can satisfy it, and hiding that makes a block that looks complete and will not plan. |
| `platform:` port | Neither. The runtime fills it and nobody binds one. |

A contract already answered by exactly one instance **on the graph** is bound to
that instance rather than to a fresh copy — a block that placed its own private
shortlink beside the one already running would read as tidy and double the estate
every time it was used. So the same block is several nodes on an empty network
and one node on a full one, which is the honest answer in both cases.

### Editing one: its own canvas, and two ends

A block opens into **its own canvas** — the same drawing, of a different graph.
Expanding it where it stood was the first spelling and it answers a different
question: *what is in there* is worth a glance, and *change what is in there* is
worth the whole screen. `Whole graph` in the header is the way back, and it is
only on screen while there is something to come back from.

Inside are the parts, and two nodes that are not instances:

| | |
| --- | --- |
| **In** | on the left. Wire a part's port to it and that port becomes a port **of the block**. |
| **Out** | on the right. Wire a part's output to it and the block answers to that contract. |

That is where a surface is decided, and the reason it is decided *there* is that
a surface is a wiring decision — so it is made with the wire tool, not in a
settings panel somewhere else. The same wire takes it off again.

They fall at the edges without being placed there. `lib/layout.js` puts a node to
the right of everything it depends on: a part that reaches In depends on In, so
In lands left of every part, and Out consumes the parts so it lands right of
them. The picture arranges itself out of what the edges already mean.

A block node carries **▣** in its header. Without it a block and an instance are
the same rectangle until somebody notices the border, and a border is not a thing
anybody reads a diagram for.

### One node, until you open it

A shut block draws as a single node carrying only the ports it handed back, with
a `+` on it. Wiring one of those ports wires the instance *inside* it, and the
command that comes out says so. A port the block filled cannot be reached from
outside — open the block and wire the part directly, or leave it alone.

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

The mode menu in the top right offers three, and the document decides the
**ceiling** rather than the choice.

- **read** — a picture of the wiring.
- **plan** — the canvas will also work out what *would* change a port, print the
  commands, and copy the whole change to the clipboard in one press.
- **edit** — listed, never granted, and the answer says why rather than saying no.

Lowering the mode is always allowed and is a real thing to want: a canvas nobody
can accidentally work a change out on while it is up on a screen in a meeting.
Raising it is refused by `lib/routes.js`, not by the page — a check a page
performs on itself is a check anybody can skip by not loading the page.

**Edit is refused on every document this platform produces, and no key turns it
on.** That is not a permission this application is missing. An artifact holds no
key, has no outbound channel to anything that does — `platform:listen` is inbound
and `platform:documents` is write-only — and there is nothing to sign anyway,
because nothing on this platform edits a signed instance. Rewiring is a removal
and a fresh id, which Plan works out and an administrator runs.

There is no third mode, and that is a fact about the platform rather than a
corner cut. **Nothing on this platform edits a signed instance's wiring.**
`artifact-operator instance create` refuses an id the network already has, and
`instance remove` says in its own words that burning an id is the only way to
re-sign an instance on new terms. So rewiring one port is a removal and a fresh
instance under a *different id*, permanently — which is not a button, and which
the planned change leads with rather than hides.

`test/operator.test.js` checks every printed command — the rewiring, the add and
the removal — against `artifact-operator`'s own spec and its own `--bind` parser
rather than against a string. It exists because the first version of this printed `artifact-operator
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

## Placing and wiring

The toolbar sits over the canvas at the top left — **Move**, **Place**, **Wire** —
and it is only there where a change can be worked out at all, because a drawer on
a read-only canvas is a shelf of things that do nothing when picked up.

**Place** opens the drawer down the left edge: every artifact and kind the
document carried a manifest for, *not* the ones already running — placing the
first instance of something is the case that matters most, and a drawer built
from the drawing is the one that cannot offer it. Pick a kind, click the canvas,
and a node lands where the pointer was. It is drawn dashed, because it is a
proposal and every other node is a thing that exists.

**Wire** is two clicks rather than a drag: a port, then the node that answers it.
A drag over a canvas that also pans is two gestures fighting over one pointer,
and two clicks is what a keyboard can do as well. A wire only lands where the
contract fits — `lib/routes.js` checks that the target's `provides` holds what
the port wants, so a node editor whose drawings do not plan is not possible here.

**A signed instance cannot be dragged into a new shape.** Wiring one is refused
with the reason, and the reason is the platform's: rewiring a port is a removal
and a fresh instance under a different id. What can be wired is what nobody has
signed yet — a draft, where a wire is not an edit but an argument to an
`instance create` that has not been run.

Everything placed adds up to one script, **providers first**: a create naming a
draft that has not been created yet is a command that fails on the line before it
would have worked, and on the canvas both nodes are simply there. `Copy commands`
takes the lot.

Undo and clear are in the command menu. A new document drops every draft — a
document is the truth and a draft is a sentence about it.

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
