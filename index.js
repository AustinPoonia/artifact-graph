/**
 * Graph: the platform's own wiring, drawn.
 *
 * ## This artifact cannot see the thing it draws, and that is deliberate
 *
 * `platform:network-view` answers seven questions — whoami, members, groupsOf,
 * usersOf, groups, permissions, grantsOf — and **not one of them is about
 * instances or bindings**. There is no `platform:assemble` and
 * `DESIGN-CONFORMANCE.md` §3 is the argument for why there must never be. An
 * artifact that could enumerate the deployment could enumerate every other
 * artifact's authority, which is the map an attacker wants most.
 *
 * So the graph is a **document handed in** by whoever can honestly produce one —
 * `artifact-operator graph`, which holds the network's signed state and runs the
 * same `plan()` and `validate()` a device runs. This side renders it.
 *
 * That is also what keeps the modes honest. `read`, `plan` and `apply` are
 * properties of the document rather than settings here, so this application
 * cannot grant itself authority it was not handed, and an `apply` is never
 * signed here — it is handed back to the producer, which is the thing holding
 * the key.
 *
 * ## One application, four ways in
 *
 * | Surface | How it arrives here |
 * | --- | --- |
 * | Command line | `cli@2.0.0` — the verbs below |
 * | Terminal / desktop window | `view@1.1.0` — `panel()` through whatever shell is bound |
 * | Browser | `platform:listen` serves the document `lib/screen.js` builds |
 * | Programs | POST to the same socket, JSON in and JSON out |
 *
 * Every one of them goes through `lib/routes.js`, over `lib/model.js` and
 * `lib/layout.js`, which are pure. A second implementation of "where does this
 * node go" is two pictures of one network that can disagree.
 */
const { routes } = require('./lib/routes')
const { screen } = require('./lib/screen')
const { BEHAVIOUR } = require('./lib/behaviour')
const { model } = require('./lib/model')

const SPEC = {
  name: 'graph',
  describe: 'The wiring of a network, drawn — instances, ports and what reaches what',
  commands: [
    {
      name: 'serve',
      describe: 'Draw a graph until you stop it. Blocks — see `request` for a program',
      action: 'cliServe',
      arguments: [{ name: 'document', describe: 'The graph, as JSON. `artifact-operator graph` produces one' }]
    },
    {
      name: 'request',
      describe: 'Answer one HTTP request, as JSON in and JSON out. For a program that owns its own socket',
      action: 'cliRequest',
      arguments: [{ name: 'payload', describe: 'The request as JSON: { method, path, query, body }' }]
    },
    {
      name: 'show',
      describe: 'Every instance in a graph, and what each one reaches',
      action: 'cliShow',
      arguments: [{ name: 'document', describe: 'The graph, as JSON' }],
      options: [
        { name: 'focus', short: 'f', type: 'string', describe: 'One instance, and what is around it', default: '', required: false },
        { name: 'depth', short: 'd', type: 'number', describe: 'How many hops from the focus', default: 1, required: false }
      ]
    },
    {
      name: 'problems',
      describe: 'Every fault in a graph, in the words a device would refuse it with',
      action: 'cliProblems',
      arguments: [{ name: 'document', describe: 'The graph, as JSON' }]
    }
  ]
}

module.exports = {
  SPEC,

  /**
   * @param {Record<string, any>} deps  one entry per bound port
   * @param {Record<string, any>} [config]  the instance's signed configuration
   */
  build (deps, config) {
    const { kit, listen, store, documents } = deps

    const title = config && typeof config.title === 'string' && config.title.trim() !== ''
      ? config.title.trim()
      : 'Graph'

    const app = routes({ kit, store, title, script: BEHAVIOUR })

    /** A `text` node saying one thing. @param {string} what @param {string} [tone] */
    const said = (what, tone) => ({ nodes: [{ type: 'text', text: what, tone: tone || 'default' }] })

    /** @param {unknown} err */
    const message = (err) => (err instanceof Error ? err.message : String(err))

    /**
     * A document off the command line, refused rather than half-read.
     *
     * A malformed graph drawn as an empty canvas is the failure this whole
     * design is arranged against: an empty picture of a wired network reads as
     * "nothing is connected", which is a lie somebody would act on.
     *
     * @param {unknown} raw
     */
    function document (raw) {
      let sent
      try {
        sent = JSON.parse(String(raw))
      } catch {
        throw new Error('that document was not JSON; `artifact-operator graph` prints one')
      }
      if (sent === null || typeof sent !== 'object' || Array.isArray(sent)) {
        throw new Error('a graph document is an object with instances, manifests and problems')
      }
      if (!Array.isArray(sent.instances)) {
        throw new Error('that document carries no instances, so it is not a graph of anything')
      }
      return sent
    }

    /**
     * Answer one request from the listener, turning a route's throw into a 500.
     *
     * @param {{ id: number, method: string, path: string, query: Record<string, string>, body: string }} request
     */
    async function answer (request) {
      let out
      try {
        out = await app.handle(request)
      } catch (err) {
        out = {
          status: 500,
          type: 'text/plain; charset=utf-8',
          body: `the graph failed to answer: ${message(err)}\n`
        }
      }
      await listen.respond(request.id, out.status, out.type, out.body)
    }

    return {
      cli () {
        // A fresh copy, so a caller normalising in place cannot poison the next.
        return JSON.parse(JSON.stringify(SPEC))
      },

      /* ------------------------------------------------------- view@1.1 --- */

      /**
       * The panel, for whatever shell is bound.
       *
       * A summary and never the graph. A canvas is a picture and a panel is a
       * few lines of text — drawing one as ASCII would be a second renderer that
       * can disagree with the first about what is connected to what, which is
       * exactly the thing `lib/layout.js` exists to make impossible.
       */
      async view () {
        const held = app.held()

        if (held.instances.length === 0) {
          return {
            nodes: [
              { type: 'rows', label: title, children: [{ type: 'field', label: 'network', value: 'none handed over' }] },
              {
                type: 'paragraph',
                tone: 'muted',
                text: 'This draws a graph it is given. `artifact-operator graph` produces one; nothing has handed this instance one yet.'
              }
            ]
          }
        }

        const g = model(held)
        const faulted = g.nodes.filter((n) => n.problems > 0)

        /** @type {any[]} */
        const nodes = [{
          type: 'rows',
          label: title,
          children: [
            { type: 'field', label: 'network', value: held.network || 'unnamed' },
            { type: 'field', label: 'instances', value: String(g.nodes.length) },
            { type: 'field', label: 'connections', value: String(g.edges.length) },
            { type: 'field', label: 'may change', value: held.mode === 'apply' ? 'yes, signed' : held.mode === 'plan' ? 'planned only' : 'no, read only' },
            ...(faulted.length > 0
              ? [{ type: 'field', label: 'with problems', value: String(faulted.length), tone: 'warning' }]
              : [])
          ]
        }]

        if (faulted.length > 0) {
          nodes.push({
            type: 'rows',
            label: 'Where the problems are',
            children: faulted.slice(0, 5).map((n) => ({
              type: 'field', label: n.id, value: `${n.problems} problem${n.problems === 1 ? '' : 's'}`, tone: 'warning'
            }))
          })
        }

        return { nodes }
      },

      /**
       * `view@1.1.0` declares `handle`, so it has to exist. What it must not do
       * is act: this panel offers no buttons, and a shell that invented one
       * would be asking for something nothing here promised.
       */
      async handle () { return { nodes: [] } },

      /* ------------------------------------------------------------ cli --- */

      /**
       * Hold a graph and serve it until the process is stopped.
       *
       * **This blocks, and it has to** — for the reason the link studio's does:
       * an action that returned while a loop kept running would have its realm
       * torn down underneath it, and the loop's death would be silent.
       *
       * @param {Record<string, any>} args @param {Record<string, any>} [_options]
       */
      async cliServe (args, _options) {
        app.take({ document: document(args && args.document) })

        const { origin } = await listen.serve()
        if (documents) {
          try { await documents.write('graph-address', `${origin}\n`, '.txt') } catch { /* serving still works */ }
        }

        for (;;) {
          const request = await listen.next()
          if (request === null) return said('The graph has stopped.')
          await answer(request)
        }
      },

      /**
       * One request, for a program that owns the socket.
       *
       * The document rides on the request rather than being held from a flag,
       * which is what makes a desktop shell work: it re-derives the graph, posts
       * it with every call, and there is no moment where the page is drawing one
       * network and the operator is holding another.
       *
       * @param {Record<string, any>} args @param {Record<string, any>} [_options]
       */
      async cliRequest (args, _options) {
        let sent = null
        try {
          sent = JSON.parse(String(args && args.payload))
        } catch {
          return { nodes: [{ type: 'code', text: JSON.stringify({ status: 400, type: 'text/plain', body: 'that payload was not JSON\n' }) }] }
        }

        const answered = await app.handle({
          method: String(sent.method || 'GET'),
          path: String(sent.path || '/'),
          query: sent.query && typeof sent.query === 'object' ? sent.query : {},
          body: typeof sent.body === 'string' ? sent.body : ''
        })
        return { nodes: [{ type: 'code', text: JSON.stringify(answered) }] }
      },

      /** @param {Record<string, any>} args @param {Record<string, any>} [options] */
      async cliShow (args, options) {
        const o = options || {}
        app.take({ document: document(args && args.document) })

        const { graph, said: narrowed, over, total } = app.cut({
          focus: String(o.focus || ''),
          depth: Number(o.depth) || 1
        })

        if (graph.nodes.length === 0) {
          return said(total === 0 ? 'that graph has no instances' : 'nothing matched', 'muted')
        }

        /** @type {any[]} */
        const nodes = []
        if (narrowed.length > 0) {
          nodes.push({ type: 'paragraph', tone: 'muted', text: `${graph.nodes.length} of ${total}: ${narrowed.join(', ')}.` })
        }
        if (over > 0) {
          nodes.push({ type: 'paragraph', tone: 'warning', text: `${over} more matched and are not listed.` })
        }

        nodes.push({
          type: 'table',
          columns: ['instance', 'artifact', 'reaches', 'problems'],
          rows: graph.nodes.map((n) => {
            const out = graph.edges.filter((e) => e.from === n.id)
            return [
              n.id,
              n.artifact,
              out.length === 0 ? '—' : [...new Set(out.map((e) => e.to))].join(', '),
              n.problems === 0 ? '—' : String(n.problems)
            ]
          }),
          // The instance name is what somebody focuses on next, so it is the
          // column that has to survive a narrow frame.
          keep: [0]
        })
        return { nodes }
      },

      /** @param {Record<string, any>} args @param {Record<string, any>} [_options] */
      async cliProblems (args, _options) {
        app.take({ document: document(args && args.document) })
        const faults = app.held().problems

        if (faults.length === 0) {
          return said('Every instance builds and every port resolves.')
        }
        return {
          nodes: [{
            type: 'table',
            columns: ['code', 'instance', 'port', 'what is wrong'],
            rows: faults.map((/** @type {any} */ p) => [
              String(p.code || ''),
              String(p.instance || ''),
              String(p.port || '') || '—',
              String(p.message || '')
            ]),
            keep: [0, 1]
          }]
        }
      },

      /**
       * The document, for a program that has its own window.
       *
       * A desktop shell loads the origin rather than this, because the canvas
       * needs a live server behind it. This exists for a caller that wants the
       * markup — to look at it, to test it, to diff it.
       */
      async page () {
        const held = app.held()
        const g = model(held)
        return screen({
          kit,
          script: BEHAVIOUR,
          title,
          network: held.network,
          mode: held.mode,
          remembers: Boolean(store),
          artifacts: [...new Set(g.nodes.map((n) => n.artifact))].sort()
        })
      }
    }
  }
}
