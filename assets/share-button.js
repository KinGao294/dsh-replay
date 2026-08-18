/**
 * dsh-replay share menu — runs inside the REAL DeepSeek Harness GUI.
 *
 * Injected into the GUI index page via webServer.tapIndex. Purely additive
 * DOM enhancement: it does NOT add buttons to session rows. Instead it
 * watches the native session context menu (opened via the ⋯ button on each
 * session row, showing 重命名/分叉会话/归档会话) and injects a
 * 「分享回放」 item ABOVE 重命名. Clicking it opens a share popover:
 *
 *   · 复制链接 — copies http://<host>/replay/<sessionId> (pixel-identical
 *     replay page on this machine; use the public tunnel URL to share
 *     externally).
 *   · 下载 HTML — downloads a self-contained replay HTML (data embedded, no
 *     server needed) for people outside your network.
 *
 * Session ids are resolved through the GUI's own session.list RPC (the same
 * source the sidebar renders from), so titles always match.
 */
(function () {
  'use strict'

  var sessionIndex = null
  var popover = null
  var observer = null
  var POLL_MS = 800

  // Fetch the session list through the same RPC the GUI sidebar uses —
  // guarantees title↔id parity with what the user sees.
  function fetchIndex() {
    if (sessionIndex) return Promise.resolve(sessionIndex)
    return fetch('/api/session.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'dsh-replay-' + Math.random().toString(36).slice(2, 10),
        method: 'session.list',
        payload: {},
      }),
    })
      .then(function (r) { return r.json() })
      .then(function (data) {
        var items = (data && data.result && data.result.value && data.result.value.items) || []
        sessionIndex = items.map(function (it) {
          var proj = (it.projections && it.projections.values) || {}
          return {
            sessionId: it.sessionId,
            title: proj.title || it.sessionId,
            stats: proj.sessionStats || null,
            updatedAt: it.updatedAt || 0,
          }
        })
        return sessionIndex
      })
      .catch(function () { return [] })
  }

  // Match a session row (title text) to its id via the index.
  function findSession(titleText) {
    if (!sessionIndex) return null
    var t = (titleText || '').trim()
    if (!t) return null
    var exact = sessionIndex.find(function (s) { return s.title === t })
    if (exact) return exact
    var best = null
    var bestLen = 0
    for (var i = 0; i < sessionIndex.length; i++) {
      var s = sessionIndex[i]
      if (t.indexOf(s.title) !== -1 && s.title.length > bestLen) {
        best = s
        bestLen = s.title.length
      }
    }
    return best
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text) })
    }
    fallbackCopy(text)
    return Promise.resolve()
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch (e) { /* noop */ }
    document.body.removeChild(ta)
  }

  function downloadHTML(sessionId) {
    var a = document.createElement('a')
    a.href = '/api/replay/export/' + encodeURIComponent(sessionId)
    a.download = 'dsh-replay-' + sessionId.slice(0, 20) + '.html'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function showPopover(entry, anchorRect) {
    if (popover) popover.remove()
    popover = document.createElement('div')
    popover.style.cssText =
      'position:fixed;z-index:2147483100;background:#fff;color:#1a1d24;border:1px solid rgba(0,0,0,0.12);' +
      'border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.18);padding:14px 16px;' +
      'width:300px;font:13px -apple-system,"PingFang SC","Segoe UI",sans-serif;'
    var title = document.createElement('div')
    title.style.cssText = 'font-weight:600;margin-bottom:10px;font-size:13.5px;'
    title.textContent = '🔗 分享回放'
    var sub = document.createElement('div')
    sub.style.cssText = 'color:#5c6474;font-size:12px;margin-bottom:8px;word-break:break-all;'
    sub.textContent = (entry && entry.title) || ''
    var pubUrl = 'https://replay.contentradars.com/replay/' + encodeURIComponent((entry && entry.sessionId) || '')
    var urlBox = document.createElement('input')
    urlBox.type = 'text'
    urlBox.readOnly = true
    urlBox.value = pubUrl
    urlBox.style.cssText =
      'width:100%;box-sizing:border-box;padding:7px 10px;margin-bottom:8px;border-radius:7px;' +
      'border:1px solid rgba(0,0,0,0.14);background:#f6f7f9;color:#1a1d24;font-size:11.5px;' +
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;outline:none;'
    urlBox.onclick = function () { this.select() }
    var pub = document.createElement('div')
    pub.style.cssText = 'color:#9aa1af;font-size:11px;margin-bottom:12px;line-height:1.5;'
    pub.textContent = '公网地址，需保持本机 dsh web 运行'
    var linkBtn = document.createElement('button')
    linkBtn.textContent = '复制回放链接'
    var dlBtn = document.createElement('button')
    dlBtn.textContent = '下载 HTML 文件'
    var cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    var style = 'display:block;width:100%;padding:8px 12px;margin:4px 0;border-radius:8px;cursor:pointer;' +
      'font-size:12.5px;font-family:inherit;'
    linkBtn.style.cssText = style + 'background:#4d6bfe;color:#fff;border:none;'
    dlBtn.style.cssText = style + 'background:#f0f2f5;color:#1a1d24;border:1px solid rgba(0,0,0,0.1);'
    cancelBtn.style.cssText = style + 'background:transparent;color:#5c6474;border:none;font-size:12px;'

    linkBtn.onclick = function () {
      // Fixed public domain — works for anyone, anywhere (tunnel + dsh web
      // must be running on this machine).
      var url = 'https://replay.contentradars.com/replay/' + encodeURIComponent(entry.sessionId)
      copyText(url).then(function () {
        linkBtn.textContent = '✓ 已复制!'
        setTimeout(function () { if (popover) popover.remove() }, 900)
      })
    }
    dlBtn.onclick = function () {
      downloadHTML(entry.sessionId)
      dlBtn.textContent = '✓ 已开始下载'
    }
    cancelBtn.onclick = function () { popover.remove() }

    popover.appendChild(title)
    popover.appendChild(sub)
    popover.appendChild(urlBox)
    popover.appendChild(pub)
    popover.appendChild(linkBtn)
    popover.appendChild(dlBtn)
    popover.appendChild(cancelBtn)
    document.body.appendChild(popover)

    var rect = anchorRect || { right: window.innerWidth - 16, bottom: 80 }
    var left = Math.min(rect.right - 300, window.innerWidth - 316)
    if (left < 8) left = 8
    var top = Math.min(rect.bottom + 8, window.innerHeight - popover.offsetHeight - 8)
    popover.style.left = left + 'px'
    popover.style.top = top + 'px'

    setTimeout(function () {
      document.addEventListener('click', function close(ev) {
        if (!popover.contains(ev.target)) {
          popover.remove()
          document.removeEventListener('click', close)
        }
      })
    }, 0)
  }

  // ── Menu injection ─────────────────────────────────
  // The native session menu renders into a portal list whose items are
  // 重命名 / 分叉会话 / 归档会话. We inject 分享回放 above 重命名.
  function injectIntoMenu(menuEl) {
    if (!menuEl || menuEl.getAttribute('data-dsh-replay') === '1') return
    var renameItem = findMenuItem(menuEl, '重命名')
    if (!renameItem) return
    menuEl.setAttribute('data-dsh-replay', '1')

    // Determine which session this menu belongs to: the owning row is the
    // most recently hovered session row (the ⋯ anchor lives in that row).
    // Resolve its title to a session entry; the entry is stored on the menu
    // element so the click handler reads it without extra lookups.
    var row = findMenuRow(menuEl)
    var titleText = row ? (row.querySelector('[class*="title"]') || {}).textContent : null
    var entry = findSession(titleText || '')
    if (!entry && titleText) entry = { sessionId: '', title: titleText.trim() }
    try { menuEl.setAttribute('data-dsh-replay-title', String(titleText || '')) } catch (e) { /* noop */ }

    var itemWrap = document.createElement('div')
    itemWrap.className = renameItem.parentElement.className || '_itemWrap_'
    itemWrap.style.cssText = (renameItem.parentElement.getAttribute('style') || '') + ';'
    var item = document.createElement('button')
    item.type = 'button'
    item.className = renameItem.className
    item.textContent = '🔗 分享回放'
    item.setAttribute('role', 'menuitem')
    item.style.cssText = renameItem.getAttribute('style') || ''
    item.onclick = function (ev) {
      ev.stopPropagation()
      ev.preventDefault()
      closeMenu(menuEl)
      var savedTitle = menuEl.getAttribute('data-dsh-replay-title') || ''
      var e2 = findSession(savedTitle)
      if (!e2 && savedTitle) e2 = { sessionId: '', title: savedTitle }
      showPopover(e2 || entry, row ? row.getBoundingClientRect() : null)
    }
    itemWrap.appendChild(item)
    menuEl.insertBefore(itemWrap, renameItem.parentElement)
  }

  function findMenuItem(menuEl, label) {
    var all = menuEl.querySelectorAll('button, [role=menuitem], div')
    for (var i = 0; i < all.length; i++) {
      if (all[i].textContent.trim() === label) return all[i]
    }
    return null
  }

  // Walk up from the portal to locate the owning session row.
  function findMenuRow(menuEl) {
    // The ⋯ anchor button lives inside the row's .rowActions; the menu
    // portal is appended to body. Track the most recent row whose actions
    // were opened by watching for the ellipsis button click is complex —
    // simpler: find the row whose .rowActions contains a button that is the
    // anchor. We track lastHoverRow via document mouseover on sessionRows.
    if (lastHoverRow) return lastHoverRow
    return null
  }

  function closeMenu(menuEl) {
    // Close by clicking the anchor (the ⋯ button toggles) or pressing Escape.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (menuEl) menuEl.style.display = 'none'
  }

  var lastHoverRow = null
  document.addEventListener('mouseover', function (ev) {
    var t = ev.target
    while (t && t !== document.body) {
      if (t.className && typeof t.className === 'string' && t.className.indexOf('sessionRow') !== -1) {
        lastHoverRow = t
        return
      }
      t = t.parentElement
    }
  }, true)

  // Watch for the native menu portal appearing (contains 重命名).
  function startObserver() {
    observer = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes
        for (var i = 0; i < added.length; i++) {
          var node = added[i]
          if (node.nodeType !== 1) continue
          var menuEl = node.nodeType === 1 && (node.matches && node.matches('[class*="portal"], [class*="menu"], [class*="list"]')) ? node : node.querySelector && node.querySelector('[class*="portal"], [class*="menu"], [class*="list"]')
          if (menuEl && menuEl.textContent && menuEl.textContent.indexOf('重命名') !== -1) {
            injectIntoMenu(menuEl)
          }
          // also scan children for nested portal
          if (node.querySelectorAll) {
            var portals = node.querySelectorAll('[class*="portal"], [class*="menu"], [class*="list"]')
            for (var p = 0; p < portals.length; p++) {
              if (portals[p].textContent && portals[p].textContent.indexOf('重命名') !== -1) {
                injectIntoMenu(portals[p])
              }
            }
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // Boot: load the session index, then start watching for menus.
  fetchIndex().then(function () {
    startObserver()
    // Re-check periodically in case a menu portal predates the observer.
    setInterval(function () {
      var portals = document.querySelectorAll('[class*="portal"], [class*="menu"], [class*="list"]')
      for (var i = 0; i < portals.length; i++) {
        if (portals[i].textContent && portals[i].textContent.indexOf('重命名') !== -1) {
          injectIntoMenu(portals[i])
        }
      }
    }, 1000)
  })

  // Expose a global for the replay page driver (shared id lookup).
  window.__DSH_REPLAY_SHARE__ = { findSession: findSession }
})()
