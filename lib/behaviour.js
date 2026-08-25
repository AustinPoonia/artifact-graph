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
    var name = at.view === 'node' ? 'canvas' : at.view
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

    if (name === 'canvas') { focused = at.view === 'node' ? at.id : ''; draw(); openNode(focused) }
    if (name === 'instances') refresh()
    if (name === 'problems') problems()
  }

  window.addEventListener('hashchange', route)

  // The same argument as the re-fit above: a viewport that changed size is a
  // drawing that no longer fits the box it was fitted to.
  window.addEventListener('resize', fit)

  /* ------------------------------------------------------------- canvas --- */

  var focused = ''

  function filters (extra) {
    var body = {
      focus: focused,
      depth: $('depth') ? $('depth').value : '1',
      artifact: $('artifact') ? $('artifact').value : '',
      find: $('find') ? $('find').value : '',
      fold: $('fold') && $('fold').checked ? 'on' : '',
      faults: $('faults-only') && $('faults-only').checked ? 'on' : ''
    }
    for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) body[key] = extra[key]
    return JSON.stringify(body)
  }

  function draw () {
    return ask('/canvas', filters({})).then(function (a) {
      show('canvas', a.html || '')
      show('canvas-note', a.note || '')
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

    var nav = e.target.closest('[data-nav]')
    if (nav) { goTo(nav.getAttribute('data-nav')); return }

    var step = e.target.closest('[data-graph-zoom]')
    if (step) {
      var room = viewport().getBoundingClientRect()
      zoom(Number(step.getAttribute('data-graph-zoom')), room.width / 2, room.height / 2)
      return
    }
    if (e.target.closest('[data-graph-fit]')) { fit(); return }

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
    var node = e.target && e.target.closest ? e.target.closest('[data-node]') : null
    dragged = false

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

  document.addEventListener('pointerup', function () {
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
      if (to === id) { x2 = x + width; y2 = y + height / 2 }

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
      for (var i = 0; i < open.length; i++) open[i].open = false
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

  function openNode (id) {
    var panel = $('node-panel')
    var area = $('canvas-area')

    // Nothing open is one column, not two with an empty box in the second: on a
    // canvas, the half a placeholder would take is the half the picture needed.
    if (!id) {
      if (panel) { panel.hidden = true; panel.innerHTML = '' }
      if (area) area.classList.remove('k-grid-wide')
      fit()
      return Promise.resolve(null)
    }
    return ask('/node', JSON.stringify({ id: id })).then(function (a) {
      show('node-panel', a.html || '')
      if (panel) panel.hidden = false
      if (area) area.classList.add('k-grid-wide')
      // **Fit again, because the canvas just got narrower.** Opening a node and
      // drawing the canvas are two fetches racing each other, and the drawing
      // usually wins — so it fits to a full-width column that is about to become
      // a two-thirds one, and the graph ends up half off the right edge at a
      // confident-looking 100%.
      fit()
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

  pickers()
  route()
})()
`.trim()

module.exports = { BEHAVIOUR }
