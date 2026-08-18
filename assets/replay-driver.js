/**
 * dsh-replay driver — runs INSIDE the real DeepSeek Harness GUI page.
 *
 * Injected by the /replay/<sessionId> route before </body>. The page is the
 * real GUI: this script only (1) clicks the target session in the native
 * sidebar so the native conversation view renders the full history, then
 * (2) overlays a native-styled playback bar and reveals the rendered message
 * DOM in timeline order with play/pause/seek/speed controls.
 *
 * Rendering is 100% native — this script never rebuilds UI, it only times
 * the reveal of nodes the real GUI already mounted.
 */
(function () {
  'use strict'

  const CFG = window.__DSH_REPLAY__ || {}
  const TARGET_ID = CFG.sessionId
  const TITLE = CFG.title || '会话回放'

  // ── Poll helpers ────────────────────────────────────
  function waitFor(fn, { timeout = 30000, interval = 250, label = 'condition' } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now()
      const check = () => {
        let v
        try { v = fn() } catch { v = null }
        if (v) return resolve(v)
        if (Date.now() - t0 > timeout) return reject(new Error('timeout waiting for ' + label))
        setTimeout(check, interval)
      }
      check()
    })
  }

  // ── Step 1: open the target session via the native sidebar ──
  async function openSession() {
    // The sidebar session row carries the session id in its data attributes
    // or via the list item; find by text/title and click it. Fall back to a
    // row whose text contains the title.
    const row = await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('[class*="sessionRow"]'))
      if (!rows.length) return null
      // 1) exact / prefix session-id attribute
      for (const r of rows) {
        const id = r.getAttribute('data-session-id') || ''
        if (id && TARGET_ID && (id === TARGET_ID || TARGET_ID.startsWith(id) || id.startsWith(TARGET_ID.slice(0, 20)))) {
          return r
        }
      }
      // 2) title substring (rows render title plus status prefix like 进行中)
      const t = TITLE || TARGET_ID
      const probe = t.slice(0, 8)
      const byTitle = rows.find((r) => r.textContent && r.textContent.includes(probe) && !r.textContent.includes('新对话'))
      if (byTitle) return byTitle
      // 3) last resort: the first row that is not a folder/section header
      return rows.find((r) => r.textContent && r.textContent.trim().length > 4)
    }, { label: 'sidebar session row' })

    row.click()
    // Give the native conversation view time to render history: wait for the
    // message column (aIOhda_column / scrollBody content) to grow.
    await waitFor(() => {
      const col = document.querySelector('[class*="column"]')
      const body = document.querySelector('[class*="scrollBody"]')
      const h = col ? col.scrollHeight : body ? body.scrollHeight : 0
      return h > 600
    }, { timeout: 20000, label: 'conversation history render' })
  }

  // ── Step 2: collect message nodes in the rendered conversation ──
  function collectNodes() {
    // Native layout: .aIOhda_column is the message column whose direct
    // children are flow items (one per message/tool card), in timeline order.
    const col = document.querySelector('[class*="column"]')
    if (col && col.children.length > 1) {
      return Array.from(col.children).filter((n) => {
        const text = (n.textContent || '').trim()
        if (!text) return false
        if (n.querySelector('[class*="composerSeat"]')) return false
        return true
      })
    }
    // Fallback: scrollBody direct children (may include composer seat).
    const body = document.querySelector('[class*="scrollBody"]')
    if (!body) return []
    return Array.from(body.children).filter((n) => {
      const text = (n.textContent || '').trim()
      return text && !n.querySelector('[class*="composerSeat"]')
    })
  }

  // ── Step 3: native-styled playback overlay ──
  function injectOverlay(nodes) {
    if (!nodes.length) return

    const overlay = document.createElement('div')
    overlay.id = 'dsh-replay-overlay'
    overlay.innerHTML = `
      <style>
        #dsh-replay-overlay .bar {
          position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
          z-index: 2147483000; display: flex; align-items: center; gap: 10px;
          background: rgba(17,20,25,0.94); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px; padding: 8px 14px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.5); backdrop-filter: blur(8px);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
          color: #e8ebf0; font-size: 12px; max-width: 92vw; white-space: nowrap;
        }
        #dsh-replay-overlay .btn {
          background: #151920; color: #e8ebf0; border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px; padding: 5px 13px; font-size: 12.5px; cursor: pointer;
          font-family: inherit;
        }
        #dsh-replay-overlay .btn:hover { filter: brightness(1.2); }
        #dsh-replay-overlay .btn.primary { background: #4d6bfe; border-color: #4d6bfe; color: #fff; }
        #dsh-replay-overlay .time {
          font-variant-numeric: tabular-nums; min-width: 84px; text-align: center; color: #8b93a3;
        }
        #dsh-replay-overlay input[type=range] {
          width: 170px; appearance: none; height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.14); outline: none; cursor: pointer;
        }
        #dsh-replay-overlay input[type=range]::-webkit-slider-thumb {
          appearance: none; width: 13px; height: 13px; border-radius: 50%;
          background: #4d6bfe; border: 2px solid #fff; cursor: pointer;
        }
        #dsh-replay-overlay .spd { display: flex; gap: 2px; }
        #dsh-replay-overlay .spd button {
          background: transparent; color: #5c6474; border: none; border-radius: 5px;
          padding: 3px 7px; font-size: 11.5px; cursor: pointer; font-family: inherit;
        }
        #dsh-replay-overlay .spd button.on { background: #151920; color: #e8ebf0; }
        #dsh-replay-overlay .bar .cnt { color: #5c6474; font-size: 11px; }
      </style>
      <div class="bar">
        <button class="btn primary" id="dr-play">▶ 播放</button>
        <button class="btn" id="dr-restart">↺</button>
        <span class="time" id="dr-time">0:00 / 0:00</span>
        <input type="range" id="dr-seek" min="0" max="1000" value="0">
        <span class="cnt" id="dr-cnt"></span>
        <div class="spd">
          <button data-s="0.5">0.5×</button>
          <button data-s="1" class="on">1×</button>
          <button data-s="2">2×</button>
          <button data-s="4">4×</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    // Hide every message node; reveal in timeline order.
    for (const n of nodes) {
      n.style.transition = 'opacity 300ms ease'
      n.style.opacity = '0'
    }

    let speed = 1
    let playing = false
    let cursor = -1
    let timer = null
    let total = nodes.length

    const el = (id) => document.getElementById(id)
    const fmt = (ms) => {
      const s = Math.round(ms / 1000)
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
    }
    // Per-node duration: larger nodes take longer (chars heuristic).
    const durOf = (n) => {
      const len = (n.textContent || '').length
      return Math.max(350, Math.min(len * 22, 2200))
    }
    const totalMs = () => {
      let t = 0
      for (let i = 0; i < nodes.length; i++) t += durOf(nodes[i])
      return t
    }
    const reveal = (i) => {
      const n = nodes[i]
      if (n) {
        n.style.opacity = '1'
        n.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
    const updateUI = () => {
      const done = cursor >= 0 ? cursor + 1 : 0
      let acc = 0
      for (let i = 0; i < done && i < nodes.length; i++) acc += durOf(nodes[i])
      el('dr-time').textContent = fmt(acc) + ' / ' + fmt(totalMs())
      el('dr-seek').value = nodes.length ? Math.round((done / nodes.length) * 1000) : 0
      el('dr-cnt').textContent = done + ' / ' + total + ' 帧'
    }
    const step = () => {
      if (!playing) return
      cursor++
      if (cursor >= nodes.length) { stop(); return }
      reveal(cursor)
      updateUI()
      timer = setTimeout(step, durOf(nodes[cursor]) / speed)
    }
    const start = () => {
      if (cursor >= nodes.length - 1) { cursor = -1; updateUI() }
      playing = true
      el('dr-play').textContent = '⏸ 暂停'
      step()
    }
    const stop = () => {
      playing = false
      el('dr-play').textContent = '▶ 播放'
      if (timer) clearTimeout(timer)
    }
    const reset = () => {
      stop()
      cursor = -1
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].style.transition = 'none'
        nodes[i].style.opacity = '0'
      }
      updateUI()
    }

    el('dr-play').onclick = () => (playing ? stop() : start())
    el('dr-restart').onclick = reset
    el('dr-seek').addEventListener('input', (e) => {
      stop()
      const target = Math.round((e.target.value / 1000) * (nodes.length - 1))
      for (let i = 0; i <= target && i < nodes.length; i++) reveal(i)
      cursor = target
      updateUI()
    })
    overlay.querySelectorAll('.spd button').forEach((b) => {
      b.onclick = () => {
        overlay.querySelectorAll('.spd button').forEach((x) => x.classList.remove('on'))
        b.classList.add('on')
        speed = parseFloat(b.dataset.s)
      }
    })
    updateUI()
  }

  // ── Boot ────────────────────────────────────────────
  openSession()
    .then(() => {
      // Re-collect after a beat (native render settles async).
      return new Promise((r) => setTimeout(r, 800))
    })
    .then(() => {
      const nodes = collectNodes()
      if (!nodes.length) throw new Error('no conversation nodes found')
      injectOverlay(nodes)
    })
    .catch((e) => {
      const err = document.createElement('div')
      err.className = 'dsh-replay-error'
      err.style.cssText =
        'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483000;' +
        'background:#2a1a1a;color:#fca5a5;border:1px solid #f87171;border-radius:10px;' +
        'padding:10px 16px;font:12px -apple-system,"PingFang SC",sans-serif'
      err.textContent = 'dsh-replay: ' + (e instanceof Error ? e.message : String(e))
      document.body.appendChild(err)
    })
})()
