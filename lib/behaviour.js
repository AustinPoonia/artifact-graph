/**
 * The page's one script, as a string.
 *
 * **This whole file is inside a template literal.** A backtick written anywhere
 * in it ends the literal early and the file stops being valid JavaScript; a
 * *matched pair* is worse, because the file still parses and the text between
 * them is interpolated away before the page ever sees it. There is a case that
 * fails on either.
 *
 * The pan, the zoom and the drag are the only real work here, and all three are
 * arithmetic on one `transform` — the canvas has no library behind it because
 * every node editor worth copying is React, which is unreachable from a page
 * running one script an artifact authored.
 */
const BEHAVIOUR = `
;(function () {
  'use strict'

  function $ (id) { return document.getElementById(id) }
  function show (id, html) { var el = $(id); if (el) el.innerHTML = html }
  function bind (id, event, fn) { var el = $(id); if (el) el.addEventListener(event, fn) }

  function ask (path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body
    }).then(function (r) { return r.json() })
  }

  function announce (what) {
    var said = $('said')
    if (said) said.textContent = what
  }

  /* ------------------------------------------------------------- router --- */

  function where () {
    var raw = String(window.location.hash || '').replace(/^#\\/?/, '')
    var parts = raw.split('/').filter(Boolean).map(decodeURIComponent)
    return { view: parts[0] || '', id: parts[1] || '' }
  }

  function offers (name) { return Boolean(document.querySelector('[data-view="' + name + '"]')) }

  function goTo (view, id) {
    var next = '#/' + view + (id ? '/' + encodeURIComponent(id) : '')
    if (window.location.hash === next) route()
    else window.location.hash = next
  }

  function route () {
    var at = where()
    // A node's address is a canvas focused on it, not a screen of its own: the
    // picture that shows why you opened a node must not disappear when you do.
    // A node's page and a block's inside are both the canvas: one focuses it and
    // the other replaces what it is a canvas *of*.
    var name = at.view === 'node' || at.view === 'block' ? 'canvas' : at.view
    if (!offers(name)) {
      var first = document.querySelector('[data-view]')
      name = first ? first.getAttribute('data-view') : ''
      if (!name) return
    }

    var views = document.querySelectorAll('[data-view]')
    for (var i = 0; i < views.length; i++) {
      views[i].hidden = views[i].getAttribute('data-view') !== name
    }
    var items = document.querySelectorAll('[data-nav]')
    for (var j = 0; j < items.length; j++) {
      var on = items[j].getAttribute('data-nav') === name
      items[j].classList.toggle('k-active', on)
      if (on) items[j].setAttribute('aria-current', 'page')
      else items[j].removeAttribute('aria-current')
    }
    var panel = document.querySelector('[data-view="' + name + '"]')
    var heading = panel ? panel.getAttribute('data-title') : ''
    var titleEl = document.querySelector('.k-inset-title')
    if (titleEl && heading) titleEl.textContent = heading

    // The canvas takes the panel; the two lists are columns of prose and want
    // the measure and the padding back. One class, both directions.
    var inset = document.querySelector('.k-inset')
    if (inset) inset.classList.toggle('k-inset-flush', name === 'canvas')

    // And a rail about a selected node has nothing to be about on a list, nor
    // has a note about what the canvas is drawing.
    if (name !== 'canvas') {
      openAside(false)
      var noted = $('canvas-note')
      if (noted) noted.textContent = ''
    }

    if (name === 'canvas') {
      inside = at.view === 'block' ? at.id : ''
      focused = at.view === 'node' ? at.id : ''
      draw()
      openNode(focused)
    }
    if (name === 'instances') refresh()
    if (name === 'problems') problems()
  }

  window.addEventListener('hashchange', route)

  // The same argument as the re-fit above: a viewport that changed size is a
  // drawing that no longer fits the box it was fitted to.
  window.addEventListener('resize', fit)

  /* ------------------------------------------------------------- canvas --- */

  var focused = ''

  /* --------------------------------------------------------- the tools --- */

  /**
   * Which operation the pointer is armed with, and what it is armed *to* place.
   *
   * Empty is Move, which is what a canvas does when nobody has asked for
   * anything else. The tool is sent with every drawing because the toolbar and
   * the drawer are drawn by the routes -- one place that decides whether either
   * exists at all, rather than a page that hides controls the routes would have
   * refused anyway.
   */
  /** Which block the canvas is inside, if any. Empty is the whole graph. */
  var inside = ''

  /**
   * Which part of the open block an instance id is.
   *
   * Kept from the last answer rather than parsed out of the id: a role is the
   * block's own word for a part and an id is the network's, and the two are only
   * the same string by coincidence.
   */
  var roles = {}
  function roleOf (id) { return roles[id] || id }

  var tool = ''
  var putting = ''
  var arming = null
  /** What the pointer picked up out of the drawer, if anything. */
  var carrying = ''

  function armTool (which) {
    tool = tool === which ? '' : which
    if (tool !== 'place') putting = ''
    if (tool !== 'wire') disarmWire()
    var box = viewport()
    if (box) box.setAttribute('data-tool', tool)
    announce(tool === 'place'
      ? 'Pick something from the drawer, then click the canvas.'
      : tool === 'wire'
        ? 'Click a port on a placed node, then the node that answers it.'
        : 'Drag nodes, drag the canvas.')
    return draw()
  }

  function armPut (what) {
    putting = what
    var all = document.querySelectorAll('[data-graph-put]')
    for (var i = 0; i < all.length; i++) {
      all[i].setAttribute('aria-pressed', all[i].getAttribute('data-graph-put') === what ? 'true' : 'false')
    }
    announce('Click the canvas to place ' + what + '.')
  }

  /**
   * Put one down, in graph units, where the pointer was.
   *
   * As a **block**: one artifact and everything it needs, wired to each other.
   * A port with exactly one possible answer is filled and a port with a decision
   * in it is handed back, so what lands is the thing somebody asked for rather
   * than the thing plus six prerequisites they have to look up.
   */
  function place (what, clientX, clientY, box) {
    var at = box.getBoundingClientRect()
    var cut = what.indexOf('/')
    // Disarmed, so a stray click afterwards does not quietly place a second one.
    putting = ''
    armPut('')
    return draft({
      do: 'block',
      artifact: cut < 0 ? what : what.slice(0, cut),
      kind: cut < 0 ? '' : what.slice(cut + 1),
      x: (clientX - at.left - view.x) / view.scale,
      y: (clientY - at.top - view.y) / view.scale
    })
  }

  function disarmWire () {
    if (arming && arming.el) arming.el.removeAttribute('data-arm')
    arming = null
  }

  /** Ask for a draft change, and redraw whatever came of it. */
  function draft (body) {
    return ask('/draft', filters(body)).then(function (a) {
      if (!a.ok) { announce(a.why || 'That cannot be done here.'); return a }
      script = (a.commands || []).join('\\n')
      copyShown()
      roles = {}
      for (var i = 0; i < (a.drafts || []).length; i++) {
        if (a.drafts[i].role) roles[a.drafts[i].id] = a.drafts[i].role
      }
      if (a.commands && a.commands.length > 0) {
        var panel = $('change-panel')
        if (panel) {
          panel.hidden = false
          var form = $('change-add')
          if (form) form.hidden = true
          var title = $('change-title')
          if (title) title.textContent = a.commands.length === 1 ? 'One command' : a.commands.length + ' commands'
          show('change-out', a.commands.map(function (c) {
            return '<p class="k-mono">' + esc(c) + '</p>'
          }).join('') + '<p class="k-hint">Nothing here has run these.</p>')
        }
      }
      return draw()
    })
  }

  function filters (extra) {
    // No find any more. Searching moved to the command menu, which does not
    // narrow the canvas — it opens the thing you named. A box that filtered the
    // drawing *and* a box that jumped to a node were two answers to one
    // question, and the canvas kept whichever was typed in last.
    var body = {
      tool: tool,
      block: inside,
      focus: focused,
      depth: $('depth') ? $('depth').value : '1',
      artifact: $('artifact') ? $('artifact').value : '',
      fold: $('fold') && $('fold').checked ? 'on' : '',
      faults: $('faults-only') && $('faults-only').checked ? 'on' : ''
    }
    for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) body[key] = extra[key]
    return JSON.stringify(body)
  }

  function draw () {
    return ask('/canvas', filters({})).then(function (a) {
      show('canvas', a.html || '')
      // The viewport is a *new* element after every drawing, so the armed tool
      // has to be put back on it -- it is what decides the cursor, and a canvas
      // that looks like Move while it is armed to Place is a canvas that lies.
      var armed = viewport()
      if (armed) armed.setAttribute('data-tool', tool)
      var noted = $('canvas-note')
      if (noted) noted.textContent = a.note || ''
      // A way back out, where being inside is the only state you cannot leave by
      // pressing something on the canvas.
      var back = $('do-out')
      if (back) back.hidden = inside === ''
      // A fresh drawing is a fresh world, so the view it is seen through starts
      // where it can see something rather than wherever the last one was left.
      view = { x: 24, y: 24, scale: 1 }
      paint()
      fit()
      return a
    })
  }

  var typing = 0
  document.addEventListener('input', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('[data-filter]')) return
    if (typing) clearTimeout(typing)
    typing = setTimeout(draw, 180)
  })
  document.addEventListener('change', function (e) {
    if (!e.target) return
    if (e.target.id === 'mode') { wantMode(e.target.value); return }
    var box = e.target.closest ? e.target.closest('[data-picker]') : null
    if (box) pickerShown(box)
    if (e.target.closest && e.target.closest('[data-filter]')) draw()
  })

  /* --------------------------------------------------- pan, zoom, drag --- */

  // One transform is the whole camera. Everything below is arithmetic on it.
  var view = { x: 24, y: 24, scale: 1 }

  function world () { return document.querySelector('[data-graph-world]') }
  function viewport () { return document.querySelector('[data-graph-viewport]') }

  function paint () {
    var w = world()
    if (!w) return
    w.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')'
    var scale = document.querySelector('[data-graph-scale]')
    if (scale) scale.textContent = Math.round(view.scale * 100) + '%'
  }

  /** Fit the whole drawing into the viewport, which is what Fit means. */
  function fit () {
    var w = world()
    var box = viewport()
    if (!w || !box) return
    var wide = parseFloat(w.style.width) || 1
    var tall = parseFloat(w.style.height) || 1
    var room = box.getBoundingClientRect()
    if (!room.width || !room.height) return
    var scale = Math.min((room.width - 48) / wide, (room.height - 48) / tall, 1)
    view.scale = Math.max(0.2, Math.min(2, scale))
    view.x = (room.width - wide * view.scale) / 2
    view.y = (room.height - tall * view.scale) / 2
    paint()
  }

  /**
   * Zoom about a point, so the thing under the pointer stays under it.
   *
   * Zooming about the origin instead is what makes a canvas feel like it is
   * running away from you: the further from the corner you are looking, the
   * further the picture jumps.
   */
  function zoom (by, atX, atY) {
    var was = view.scale
    var now = Math.max(0.2, Math.min(2, was * (by > 0 ? 1.15 : 1 / 1.15)))
    if (now === was) return
    view.x = atX - (atX - view.x) * (now / was)
    view.y = atY - (atY - view.y) * (now / was)
    view.scale = now
    paint()
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return

    var choice = e.target.closest('[data-picker-choose]')
    if (choice) {
      var box = choice.closest('[data-picker]')
      var native = box && box.querySelector('.k-picker-native')
      if (!native) return
      native.value = choice.getAttribute('data-picker-choose')
      pickerShown(box)
      var menu = box.querySelector('.k-picker-menu')
      if (menu) menu.open = false
      native.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
    var inside = e.target.closest('.k-picker-menu')
    var open = document.querySelectorAll('.k-picker-menu[open]')
    for (var p = 0; p < open.length; p++) if (open[p] !== inside) open[p].open = false

    // Folding the rail by hand is also letting go of the node: leaving the
    // address at #/node/x would redraw the neighbourhood on the next filter
    // change, with nothing on screen saying why the canvas had seven nodes.
    if (e.target.closest('[for="k-aside-toggle"]')) {
      if (where().view === 'node') goTo('canvas')
      return
    }

    // A click on the grey outside the menu. A dialog has no light dismiss of its
    // own -- the backdrop is painted by the dialog and swallows the click -- and
    // the tell is that the click lands on the dialog *element* rather than on
    // anything inside it, because the menu's children cover it completely.
    var menu = palette()
    if (menu && menu.open && e.target === menu) { menu.close(); return }

    // The toolbar and the drawer, over the canvas.
    var pick = e.target.closest('[data-graph-tool]')
    if (pick) { armTool(pick.getAttribute('data-graph-tool')); return }

    var put = e.target.closest('[data-graph-put]')
    if (put) { armPut(put.getAttribute('data-graph-put')); return }

    // Looking inside a block, and shutting it again.
    // Into a block, as its own canvas. Expanding it where it stands was the
    // first spelling and it answers a different question: "what is in there" is
    // worth a glance, and "change what is in there" is worth the whole screen.
    var into = e.target.closest('[data-graph-into]')
    if (into) { goTo('block', into.getAttribute('data-graph-into')); return }

    if (e.target.closest('#do-out')) { goTo('canvas'); return }
    if (e.target.closest('#do-palette')) { openPalette(); return }
    // Close first. The id do-change is a prefix of do-change-off, and an id
    // selector does not match on a prefix — but the order costs nothing and the
    // day one of these is renamed is the day it would have.
    if (e.target.closest('#do-change-off')) { plan(''); return }
    if (e.target.closest('#do-copy')) { copy(); return }

    if (e.target.closest('#do-change')) { worked(); return }

    var item = e.target.closest('[data-command-item]')
    if (item) { run(item.getAttribute('data-run')); return }

    // A step is a click on the field it names, not on whatever is nearest.
    var step = e.target.closest('[data-step]')
    if (step) {
      var field = $(step.getAttribute('data-for'))
      if (field) {
        var by = Number(step.getAttribute('data-step')) || 0
        var now = Number(field.value) || 0
        var low = field.min === '' ? -Infinity : Number(field.min)
        var high = field.max === '' ? Infinity : Number(field.max)
        field.value = String(Math.max(low, Math.min(high, now + by)))
        draw()
      }
      return
    }

    var nav = e.target.closest('[data-nav]')
    if (nav) { goTo(nav.getAttribute('data-nav')); return }

    var step = e.target.closest('[data-graph-zoom]')
    if (step) {
      var room = viewport().getBoundingClientRect()
      zoom(Number(step.getAttribute('data-graph-zoom')), room.width / 2, room.height / 2)
      return
    }
    if (e.target.closest('[data-graph-fit]')) { fit(); return }

    // Wiring: a port, then the node that answers it. Two clicks rather than a
    // drag, because a drag over a canvas that also pans is two gestures fighting
    // over one pointer -- and two clicks is what a keyboard can do as well.
    if (tool === 'wire') {
      var socket = e.target.closest('[data-port]')
      if (socket && !arming) {
        var said = socket.getAttribute('data-port').split(' ')
        disarmWire()
        arming = { el: socket, id: said[0], port: said[1], side: 'in' }
        socket.setAttribute('data-arm', 'from')
        announce(inside === ''
          ? 'Now click the node that answers ' + said[1] + '.'
          : 'Now click the node that answers it, or In to make it a port of this block.')
        return
      }

      // An output socket, which is only wirable inside a block: out there it is
      // something a node *has*, and in here it is something the block can be
      // made to answer to.
      var gives = e.target.closest('[data-out]')
      if (gives && !arming && inside !== '') {
        var offered = gives.getAttribute('data-out').split(' ')
        disarmWire()
        arming = { el: gives, id: offered[0], contract: offered[1], side: 'out' }
        gives.setAttribute('data-arm', 'from')
        announce('Now click Out to make this block answer to ' + offered[1] + '.')
        return
      }

      var landing = e.target.closest('[data-node]')
      if (landing && arming) {
        var to = landing.getAttribute('data-node')
        var from = arming
        disarmWire()

        // The boundary. Wiring to it is not a binding at all — it is saying that
        // this port, or this contract, is part of the block's surface.
        if (to === inside + ' in' || to === inside + ' out') {
          draft({
            do: 'expose',
            block: inside,
            role: roleOf(from.id),
            side: to === inside + ' out' ? 'out' : 'in',
            port: from.port || '',
            contract: from.contract || ''
          })
          return
        }

        if (from.side === 'out') { announce('An output is wired to Out, or to nothing.'); return }
        draft({ do: 'wire', from: from.id, port: from.port, to: to })
        return
      }
      if (arming) { disarmWire(); announce('Nothing to wire there.'); return }
    }

    // Placing: the drawer arms it, the canvas lands it, and where it lands is
    // where the pointer was rather than wherever the layout would have chosen.
    if (tool === 'place' && putting !== '') {
      var onCanvas = e.target.closest('[data-graph-viewport]')
      if (onCanvas && !e.target.closest('[data-graph-drawer]') && !e.target.closest('[data-graph-tool]')) {
        place(putting, e.clientX, e.clientY, onCanvas)
        return
      }
    }

    // A node opens its own page. Not a drag: a drag is cancelled below before
    // the click ever arrives.
    var node = e.target.closest('[data-node]')
    if (node && !dragged) { goTo('node', node.getAttribute('data-node')); return }
  })

  /* ---- pointers: one handler, three jobs ---------------------------------- */

  var panning = null
  var moving = null
  var dragged = false

  document.addEventListener('pointerdown', function (e) {
    if (!e.target || !e.target.closest) return
    dragged = false

    // The toolbar and the drawer sit *inside* the viewport, because they float
    // over the drawing. So a press on either was starting a pan: dragging a kind
    // out of the drawer panned the canvas and carried nothing, and even a press
    // on a tool nudged the graph sideways.
    if (e.target.closest('[data-graph-tool]') || e.target.closest('[data-graph-into]') ||
        e.target.closest('[data-graph-zoom]') || e.target.closest('[data-graph-fit]')) return

    var put = e.target.closest('[data-graph-put]')
    if (put) {
      // Picked up. Where it lands is decided on the way up, so this is a drag
      // and two clicks are the same gesture, and neither of them pans.
      carrying = put.getAttribute('data-graph-put')
      armPut(carrying)
      return
    }
    if (e.target.closest('[data-graph-drawer]')) return

    // Wiring is clicks, not drags. A press on a port would otherwise pick the
    // node up -- the port is inside it -- so the gesture that was meant to start
    // a wire moved the thing the wire comes out of.
    if (tool === 'wire') return

    var node = e.target.closest('[data-node]')

    if (node) {
      moving = {
        node: node,
        id: node.getAttribute('data-node'),
        // Where the pointer is *within* the node, in graph units, so the node
        // does not jump to put its corner under the cursor.
        offX: e.clientX / view.scale - parseFloat(node.style.left || '0'),
        offY: e.clientY / view.scale - parseFloat(node.style.top || '0')
      }
      node.setAttribute('data-grabbing', 'true')
      node.setPointerCapture(e.pointerId)
      return
    }

    var box = e.target && e.target.closest ? e.target.closest('[data-graph-viewport]') : null
    if (!box) return
    panning = { x: e.clientX - view.x, y: e.clientY - view.y }
    box.setAttribute('data-grabbing', 'true')
    box.setPointerCapture(e.pointerId)
  })

  document.addEventListener('pointermove', function (e) {
    if (moving) {
      dragged = true
      var x = e.clientX / view.scale - moving.offX
      var y = e.clientY / view.scale - moving.offY
      moving.node.style.left = x + 'px'
      moving.node.style.top = y + 'px'
      moving.at = { x: x, y: y }
      // The splines that touch this node follow it. Recomputed rather than
      // redrawn from the server, because a round trip per pointer move is a
      // canvas that lags behind the hand.
      restring(moving.id, x, y)
      return
    }
    if (panning) {
      dragged = true
      view.x = e.clientX - panning.x
      view.y = e.clientY - panning.y
      paint()
    }
  })

  document.addEventListener('pointerup', function (e) {
    // Dropped. A kind is carried out of the drawer and let go over the canvas,
    // which is the gesture everybody tries first -- and it lands in the same
    // place() as clicking the drawer and then the canvas, so both work.
    if (carrying !== '') {
      var what = carrying
      carrying = ''
      var over = e && e.target && e.target.closest ? e.target.closest('[data-graph-viewport]') : null
      if (over && !e.target.closest('[data-graph-drawer]') && !e.target.closest('[data-graph-tool]')) {
        place(what, e.clientX, e.clientY, over)
        return
      }
      // Let go somewhere that is not the canvas: still armed, so the next click
      // lands it. Silently forgetting what somebody just picked up is worse.
      return
    }

    if (moving) {
      moving.node.removeAttribute('data-grabbing')
      if (moving.at) {
        ask('/place', JSON.stringify({ id: moving.id, x: moving.at.x, y: moving.at.y }))
          .then(function (a) { if (!a.kept && a.why) announce(a.why) })
      }
      moving = null
    }
    if (panning) {
      var box = viewport()
      if (box) box.removeAttribute('data-grabbing')
      panning = null
    }
    // Cleared on the next frame, so the click that follows a drag is swallowed
    // and the one that follows a tap is not.
    setTimeout(function () { dragged = false }, 0)
  })

  /**
   * Move every spline that touches one node.
   *
   * The same curve the server draws, because the two have to agree: an edge
   * recomputed differently here would snap into a new shape the moment anything
   * refetched.
   */
  function restring (id, x, y) {
    var node = document.querySelector('[data-node="' + cssq(id) + '"]')
    if (!node) return
    var width = parseFloat(node.style.width || '0')
    var height = parseFloat(node.style.height || '0')
    var paths = document.querySelectorAll('[data-edge]')

    for (var i = 0; i < paths.length; i++) {
      var parts = String(paths[i].getAttribute('data-edge')).split(' ')
      var from = parts[0]
      var port = parts[1]
      var to = parts[2]
      var contract = parts[3] || ''
      if (from !== id && to !== id) continue

      var d = String(paths[i].getAttribute('d'))
      var numbers = d.match(/-?[0-9.]+/g)
      if (!numbers || numbers.length < 8) continue
      var x1 = parseFloat(numbers[0]); var y1 = parseFloat(numbers[1])
      var x2 = parseFloat(numbers[6]); var y2 = parseFloat(numbers[7])

      if (from === id) {
        var row = node.querySelector('[data-port="' + cssq(id + ' ' + port) + '"]')
        x1 = x
        y1 = y + (row ? parseFloat(row.style.top || '0') : height / 2)
      }
      if (to === id) {
        // The output socket the contract lands on, read off the node rather
        // than recomputed — so a drag puts the edge back where the layout drew
        // it instead of on a second guess about which row that was.
        var out = node.querySelector('[data-out="' + cssq(id + ' ' + contract) + '"]')
        x2 = x + width
        y2 = y + (out ? parseFloat(out.style.top || '0') : height / 2)
      }

      var reach = Math.max(40, Math.abs(x1 - x2) / 2)
      paths[i].setAttribute('d',
        'M' + x1 + ' ' + y1 + 'C' + (x1 - reach) + ' ' + y1 + ' ' + (x2 + reach) + ' ' + y2 + ' ' + x2 + ' ' + y2)
    }
  }

  /** An id is somebody else's string and it lands inside a selector. */
  function cssq (value) { return String(value).replace(/["\\\\]/g, '\\\\$&') }

  document.addEventListener('wheel', function (e) {
    var box = e.target && e.target.closest ? e.target.closest('[data-graph-viewport]') : null
    if (!box) return
    e.preventDefault()
    var room = box.getBoundingClientRect()
    zoom(e.deltaY < 0 ? 1 : -1, e.clientX - room.left, e.clientY - room.top)
  }, { passive: false })

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var open = document.querySelectorAll('.k-picker-menu[open]')
      var shut = 0
      for (var i = 0; i < open.length; i++) { open[i].open = false; shut++ }
      // A menu first, then the rail. Escape closing both at once would take away
      // the thing behind the thing somebody was dismissing.
      if (shut === 0 && where().view === 'node') goTo('canvas')
      return
    }

    var box = e.target && e.target.closest ? e.target.closest('[data-graph-viewport]') : null
    if (!box) return

    // A canvas nobody can drive without a pointer is not finished.
    var by = e.shiftKey ? 120 : 40
    if (e.key === 'ArrowLeft') { view.x += by; paint(); e.preventDefault() }
    else if (e.key === 'ArrowRight') { view.x -= by; paint(); e.preventDefault() }
    else if (e.key === 'ArrowUp') { view.y += by; paint(); e.preventDefault() }
    else if (e.key === 'ArrowDown') { view.y -= by; paint(); e.preventDefault() }
    else if (e.key === '+' || e.key === '=') { zoom(1, box.clientWidth / 2, box.clientHeight / 2); e.preventDefault() }
    else if (e.key === '-') { zoom(-1, box.clientWidth / 2, box.clientHeight / 2); e.preventDefault() }
    else if (e.key === '0') { fit(); e.preventDefault() }
    else if (e.key === 'Enter') {
      var node = e.target.closest('[data-node]')
      if (node) { goTo('node', node.getAttribute('data-node')); e.preventDefault() }
    }
  })

  /* --------------------------------------------------------- the panel --- */

  /**
   * Open or close the right rail.
   *
   * The rail has a width rather than a hidden attribute, so this is a change the
   * canvas beside it can see — and has to, because the canvas just got narrower
   * or wider by 22rem. The re-fit waits for the transition to finish for the
   * same reason: measuring during a width transition reads the width the rail
   * has now, not the one it is going to have.
   */
  function openAside (open, heading, about) {
    // The checkbox *is* the state, the same way it is for the left rail — so a
    // reader who folded the rail by hand and a selection that opens it are the
    // same mechanism, and there is no second flag to disagree with the first.
    var toggle = $('k-aside-toggle')
    if (toggle) toggle.checked = !open

    // Scoped to the right rail. Both rails are the same component, so both carry
    // these hooks — and an unscoped query takes the first, which is the left
    // one: the application's own name and network were replaced by whichever
    // node had last been opened.
    var name = document.querySelector('.k-sidebar-right [data-sidebar-name]')
    var note = document.querySelector('.k-sidebar-right [data-sidebar-note]')
    if (name) name.textContent = open ? (heading || '') : 'Nothing open'
    if (note) note.textContent = open ? (about || '') : 'pick a node'
    if (!open) show('node-panel', '')

    // 220ms: the transition is 200. Fitting before it finishes fits the drawing
    // to a width the rail is passing through rather than to the one it lands on.
    setTimeout(fit, 220)
  }

  function openNode (id) {
    // Nothing selected is a rail with nothing to be about, so it is not there.
    if (!id) {
      openAside(false)
      return Promise.resolve(null)
    }
    return ask('/node', JSON.stringify({ id: id })).then(function (a) {
      show('node-panel', a.html || '')
      openAside(true, a.id || id, a.artifact || '')
      return a
    })
  }

  /* ---------------------------------------------------------- the lists --- */

  function refresh () {
    return ask('/instances', JSON.stringify({})).then(function (a) {
      show('instance-list', a.html || '')
      return a
    })
  }

  function problems () {
    return ask('/problems', JSON.stringify({})).then(function (a) {
      show('problem-list', (a.html || '') + (a.note || ''))
      return a
    })
  }

  bind('do-refresh', 'click', refresh)

  /* ------------------------------------------------------------ pickers --- */

  function safe (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function pickerShown (box) {
    var native = box.querySelector('.k-picker-native')
    var choices = box.querySelector('.k-picker-list')
    if (!native || !choices) return
    var html = ''
    for (var i = 0; i < native.options.length; i++) {
      var o = native.options[i]
      html += '<button type="button" class="k-menu-item k-picker-option" tabindex="-1"' +
        ' data-picker-choose="' + safe(o.value) + '"' +
        ' aria-selected="' + (o.value === native.value ? 'true' : 'false') + '">' +
        '<span class="k-picker-tick" aria-hidden="true">&#10003;</span>' +
        '<span class="k-picker-text">' + safe(o.text) + '</span></button>'
    }
    choices.innerHTML = html
    var label = box.querySelector('[data-picker-label]')
    var at = native.selectedIndex
    if (label) label.textContent = at < 0 ? '' : native.options[at].text
  }

  function pickers () {
    var all = document.querySelectorAll('[data-picker]')
    for (var i = 0; i < all.length; i++) pickerShown(all[i])
  }

  function copyShown () {
    var button = $('do-copy')
    if (button) button.hidden = script === ''
  }

  /**
   * Put the whole change on the clipboard.
   *
   * The clipboard API is not everywhere. It is absent outside a secure
   * context, and this platform's own window is a bare-native WebView where
   * navigator.mediaDevices is *absent* rather than refused -- so the same is
   * assumed of this rather than discovered by a reader pressing a button that
   * does nothing. Where it is missing the text is selected instead, which leaves
   * the keyboard shortcut everybody already knows.
   */
  function copy () {
    if (script === '') return
    var done = function () { announce('Copied. Nothing here has run it.') }

    // typeof, because a bare reference to a global that is not there is a
    // ReferenceError rather than undefined -- and the whole point of this branch
    // is the window where it is not there.
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(script).then(done, select)
      return
    }
    select()
  }

  function select () {
    var out = $('change-out')
    if (!out || !document.createRange || !window.getSelection) {
      announce('This window has no clipboard. The commands are above.')
      return
    }
    var range = document.createRange()
    range.selectNodeContents(out)
    var chosen = window.getSelection()
    chosen.removeAllRanges()
    chosen.addRange(range)
    announce('Selected. This window has no clipboard, so copy it yourself.')
  }

  /* -------------------------------------------------------------- mode --- */

  /**
   * Ask for a mode, and take the answer.
   *
   * The routes decide, not this. A page that checked its own authority would be
   * checking something anybody can skip by not loading the page, so what comes
   * back is the mode that was *granted* and the menu is put back to it when that
   * is not the mode that was asked for.
   */
  function wantMode (want) {
    return ask('/mode', JSON.stringify({ want: want })).then(function (a) {
      var pick = $('mode')
      if (pick && a.mode && pick.value !== a.mode) {
        pick.value = a.mode
        // The styled trigger reads the native select, so it has to be told.
        var box = pick.closest ? pick.closest('[data-picker]') : null
        if (box) pickerShown(box)
      }
      if (a.why) announce(a.why)
      // A change of mode changes what the rail offers, so the panel that works
      // a change out goes away with the authority to use it.
      if (!a.ok || a.mode !== 'plan') plan('')
      return a
    })
  }

  /* ---------------------------------------------------------- tooltips --- */

  /**
   * What a socket says, drawn where the pointer is.
   *
   * The browser's own tooltip is on these elements too and it is not enough on
   * its own: it waits about a second before appearing, which on a canvas
   * somebody is sweeping a pointer across means it mostly never does. So the
   * title is taken off on the way in and put back on the way out -- both
   * tooltips at once is two boxes saying the same thing.
   *
   * Fixed to the window rather than to the node: the node is inside a scaled
   * transform, so a box positioned against it would scale with the canvas, and
   * the viewport clips anything that leaves it because a pannable canvas has to.
   */
  var tipBox = null
  var tipping = null

  function tip () {
    if (tipBox) return tipBox
    tipBox = document.createElement('div')
    tipBox.className = 'k-tip'
    tipBox.hidden = true
    // Announced by the title the element already carries, so this is decoration
    // as far as a screen reader is concerned.
    tipBox.setAttribute('aria-hidden', 'true')
    document.body.appendChild(tipBox)
    return tipBox
  }

  function tipAt (x, y) {
    var box = tip()
    // Below and to the right, then pulled back inside the window. A tooltip half
    // off the edge is the one case where the pointer is nearest the thing you
    // most want to read about.
    var room = box.getBoundingClientRect ? box.getBoundingClientRect() : { width: 0, height: 0 }
    var w = window.innerWidth || 0
    var h = window.innerHeight || 0
    var left = x + 14
    var top = y + 18
    if (w && left + room.width > w - 8) left = Math.max(8, x - room.width - 14)
    if (h && top + room.height > h - 8) top = Math.max(8, y - room.height - 14)
    box.style.left = left + 'px'
    box.style.top = top + 'px'
  }

  function tipOff () {
    if (tipping && tipping.el && tipping.said) tipping.el.setAttribute('title', tipping.said)
    tipping = null
    if (tipBox) tipBox.hidden = true
  }

  document.addEventListener('pointerover', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null
    if (!el) { if (tipping) tipOff(); return }
    if (tipping && tipping.el === el) return
    tipOff()

    var said = el.getAttribute('data-tip')
    if (!said) return
    tipping = { el: el, said: el.getAttribute('title') }
    if (tipping.said) el.removeAttribute('title')

    var box = tip()
    box.textContent = said
    box.hidden = false
    tipAt(e.clientX, e.clientY)
  })

  document.addEventListener('pointermove', function (e) {
    if (tipping) tipAt(e.clientX, e.clientY)
  })

  // A drag is not a read. Dragging a node with a tooltip stuck to the pointer is
  // the tooltip getting in the way of the thing it is about.
  document.addEventListener('pointerdown', tipOff)

  document.addEventListener('pointerout', function (e) {
    if (!tipping) return
    var to = e.relatedTarget
    if (to && to.closest && to.closest('[data-tip]') === tipping.el) return
    tipOff()
  })

  /* ------------------------------------------------ adding and removing --- */

  /**
   * Which change the rail is about, if any.
   *
   * There is no third state and there is deliberately no *fourth*: nothing here
   * applies anything. A device's wiring is signed, and the only honest answer a
   * page with no key can give is the command an admin runs — so both of these
   * end in a line of text, and a reader who wants it to end in a button is
   * asking for authority this application was never handed.
   */
  var planning = ''

  /**
   * A command, safe to put in markup.
   *
   * Four replaces rather than a detached element's textContent-then-innerHTML:
   * the round trip is a lovely trick and it makes escaping depend on a live
   * document, which is one more thing between a printed command and the reader.
   * These commands carry <the package directories> in angle brackets, so this is
   * load-bearing rather than habit.
   */
  function esc (what) {
    return String(what === undefined || what === null ? '' : what)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function plan (what) {
    var panel = $('change-panel')
    if (!panel) {
      announce('This graph was handed over read-only, so a change cannot be worked out here.')
      return
    }

    if (what === '') {
      planning = ''
      panel.hidden = true
      show('change-out', '')
      script = ''
      copyShown()
      return
    }

    // A removal names an instance, and the canvas is where one is named. Asking
    // for a second picker in the rail would be asking the reader to type an id
    // they are looking at.
    if (what === 'remove' && !focused) {
      announce('Open the instance you want removed first, then ask again.')
      return
    }

    planning = what
    panel.hidden = false
    var adding = what === 'add'
    var form = $('change-add')
    if (form) form.hidden = !adding
    var title = $('change-title')
    if (title) title.textContent = adding ? 'Add an instance' : 'Remove ' + focused
    show('change-out', '')
    script = ''
    copyShown()
    openAside(true, adding ? 'Add an instance' : focused, adding ? 'nothing is signed here' : 'removing')

    if (adding) { var id = $('new-id'); if (id) id.focus(); return }
    worked()
  }

  /**
   * The commands the last worked-out change printed, as a script.
   *
   * Kept rather than read back off the panel: what is on screen is escaped
   * markup, and a command line taken back out of HTML is a command line one
   * escaped ampersand away from being a different command line.
   */
  var script = ''

  /** Ask what the change would cost, and print it. */
  function worked () {
    if (planning === '') return Promise.resolve(null)

    var body = { do: 'remove', id: focused }
    if (planning === 'add') {
      // One select of artifact-and-kind pairs rather than two that depend on each
      // other: a kind menu that has to be rebuilt when an artifact menu changes
      // is a second list to keep in step, and every pair is already known when
      // the page is built.
      var pick = $('new-kind') ? String($('new-kind').value) : ''
      var cut = pick.indexOf('/')
      body = {
        do: 'add',
        id: $('new-id') ? $('new-id').value : '',
        artifact: cut < 0 ? pick : pick.slice(0, cut),
        kind: cut < 0 ? '' : pick.slice(cut + 1)
      }
    }

    return ask('/instance', JSON.stringify(body)).then(function (a) {
      if (!a.ok) {
        script = ''
        copyShown()
        show('change-out', '<p class="k-hint">' + esc(a.why || 'That cannot be worked out.') + '</p>')
        announce(a.why || 'That cannot be worked out.')
        return a
      }
      // Both lines, in the order they have to be run. A removal and a create is
      // one change however many commands it takes, and copying them one at a
      // time is where somebody runs the first and not the second.
      script = (a.commands || []).join('\\n')
      copyShown()
      roles = {}
      for (var i = 0; i < (a.drafts || []).length; i++) {
        if (a.drafts[i].role) roles[a.drafts[i].id] = a.drafts[i].role
      }
      // A paragraph rather than a pre. A command line is about 140 characters and
      // the rail is 24rem wide, and a pre does not wrap -- so the half of the
      // command that matters most, the flags, would sit off the edge of a panel
      // with no horizontal scrollbar. These are space-separated, so wrapping is
      // free and no class had to be added to the kit to get it.
      var lines = (a.commands || []).map(function (c) {
        return '<p class="k-mono">' + esc(c) + '</p>'
      }).join('')
      show('change-out', lines + '<p class="k-hint">' + esc(a.why || '') + '</p>')
      announce(a.commands && a.commands.length === 1
        ? 'One command works this out. Nothing here has run it.'
        : a.commands.length + ' commands work this out. Nothing here has run them.')
      return a
    })
  }

  /* ------------------------------------------------------ command menu --- */

  function palette () { return $('palette') }

  function openPalette () {
    var box = palette()
    if (!box || box.open) return
    box.showModal()
    var find = box.querySelector('[data-command-find]')
    if (find) { find.value = ''; filterPalette(''); find.focus() }
  }

  /**
   * Hide what does not match, and the groups left holding nothing.
   *
   * A group whose every item is hidden is a heading over empty space, which
   * reads as a category with no members rather than as one that did not match.
   */
  function filterPalette (term) {
    var box = palette()
    if (!box) return
    var want = String(term || '').trim().toLowerCase()
    var shown = 0
    var groups = box.querySelectorAll('[data-command-group]')
    for (var g = 0; g < groups.length; g++) {
      var here = 0
      var items = groups[g].querySelectorAll('[data-command-item]')
      for (var i = 0; i < items.length; i++) {
        var hit = want === '' || String(items[i].getAttribute('data-find') || '').indexOf(want) >= 0
        items[i].hidden = !hit
        items[i].removeAttribute('data-active')
        if (hit) { here++; shown++ }
      }
      groups[g].hidden = here === 0
    }
    // Not called none: ArtifactPatform/test/surface.test.js scans the shipped
    // bundle for output an artifact formatted itself, and one of the strings it
    // looks for is "(none)" -- which "if (none)" spells exactly.
    var empty = box.querySelector('[data-command-empty]')
    if (empty) empty.hidden = shown > 0
    // The first survivor is the one Enter takes, so there is always something
    // to press Enter on rather than a list you have to arrow into first.
    var first = box.querySelector('[data-command-item]:not([hidden])')
    if (first) first.setAttribute('data-active', 'true')
  }

  /** Every command the menu can name. The menu says what; this says how. */
  function run (what) {
    var box = palette()
    if (box && box.open) box.close()
    if (!what) return

    var at = what.indexOf(':')
    var verb = at < 0 ? what : what.slice(0, at)
    var rest = at < 0 ? '' : what.slice(at + 1)

    if (verb === 'open') { goTo('node', rest); return }
    if (verb === 'only') {
      var pick = $('artifact')
      if (pick) pick.value = rest
      show('only-note', rest === '' ? '' : 'Showing only ' + rest + '.')
      draw()
      return
    }
    if (verb === 'fit') { fit(); return }
    if (verb === 'add') { plan('add'); return }
    if (verb === 'remove') { plan('remove'); return }
    if (verb === 'undo') { draft({ do: 'undo' }); return }
    if (verb === 'clear') { draft({ do: 'clear' }); return }
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-command-find')) {
      filterPalette(e.target.value)
    }
  })

  document.addEventListener('keydown', function (e) {
    // The shortcut every command menu has, on both spellings of the modifier.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      openPalette()
      return
    }
    var box = palette()
    if (!box || !box.open) return
    if (e.key === 'Enter') {
      var active = box.querySelector('[data-command-item][data-active="true"]')
      if (active) { e.preventDefault(); run(active.getAttribute('data-run')) }
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    var items = box.querySelectorAll('[data-command-item]:not([hidden])')
    if (items.length === 0) return
    var at = -1
    for (var i = 0; i < items.length; i++) if (items[i].getAttribute('data-active') === 'true') at = i
    if (at >= 0) items[at].removeAttribute('data-active')
    var next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1)
    items[next].setAttribute('data-active', 'true')
    // Keep the highlight in view, or arrowing past the fold moves a selection
    // nobody can see.
    if (items[next].scrollIntoView) items[next].scrollIntoView({ block: 'nearest' })
  })

  pickers()
  route()
})()
`.trim()

module.exports = { BEHAVIOUR }
