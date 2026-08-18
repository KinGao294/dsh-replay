/**
 * dsh-replay — DSH web plugin (host half only).
 *
 * Mounts pixel-identical session replay on the dsh web server. Unlike a
 * hand-built player page, `/replay/<sessionId>` returns the REAL DeepSeek
 * Harness GUI — the same `__DSH_BOOT__` bootstrap, the same /assets bundles,
 * the same client plugin graph — and injects a small driver script that:
 *
 *   1. waits for the native sidebar, finds the target session row and clicks
 *      it (the native conversation view then renders the full history with
 *      the real components — messages, tool cards, trajectory tabs);
 *   2. overlays a native-styled playback control bar (play/pause, seek,
 *      speed) and reveals the already-rendered message DOM in timeline
 *      order, so the page looks and feels exactly like the real GUI.
 *
 * Registered as a prefix route on the shared webserver. The page itself is
 * assembled by internally fetching the real index (which carries the boot
 * payload injected by the frontend-static fallback) and splicing the driver
 * script before `</body>`.
 *
 * @module dsh-replay/plugin
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { scanSessions } from './extract.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DRIVER = readFileSync(join(__dirname, '../assets/replay-driver.js'), 'utf8')
const SHARE_BUTTON = readFileSync(join(__dirname, '../assets/share-button.js'), 'utf8')

/** Required services: the shared web server. */
export const inject = ['webServer']

/** Render the session-list index page (real GUI look, host-rendered). */
function renderIndex(list) {
  const PUBLIC_BASE = 'https://replay.contentradars.com'
  const rows = list.map((s, i) => {
    const date = new Date(s.updatedAt || s.createdAt).toLocaleString('zh-CN', { hour12: false })
    const title = (s.title || s.sessionId).slice(0, 80).replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const preset = s.agentPreset ? ` · ${s.agentPreset}` : ''
    return `<li>
      <a href="${PUBLIC_BASE}/replay/${encodeURIComponent(s.sessionId)}"><strong>${i + 1}. ${title}</strong></a>
      <div class="meta">${date}${preset} · ${s.eventCount} 事件</div>
    </li>`
  }).join('\n')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-replay · 会话回放</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#0f1115;color:#e6e9ef;padding:32px 20px;margin:0}
.wrap{max-width:880px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#8b93a3;font-size:13px;margin-bottom:8px}
.pub{color:#4ade80;font-size:12px;margin-bottom:24px;word-break:break-all}
ul{list-style:none;padding:0;margin:0}
li{background:#171a21;border:1px solid #2a2f3a;border-radius:10px;padding:14px 18px;margin:10px 0}
a{color:#4f8cff;text-decoration:none;font-size:15px}
a:hover{text-decoration:underline}
.meta{color:#8b93a3;font-size:12px;margin-top:6px}
.empty{color:#8b93a3;text-align:center;padding:60px 0}
</style></head><body><div class="wrap">
<h1>🎬 dsh-replay · 会话回放</h1>
<div class="sub">选择一个会话生成回放链接，发给任何人即可观看（原生 GUI 界面 · 倍速播放）</div>
<div class="pub">🔗 公网入口：${PUBLIC_BASE}/replay/（复制给外部的人）</div>
${list.length ? `<ul>${rows}</ul>` : '<div class="empty">没有找到会话</div>'}
</div></body></html>`
}

/**
 * Fetch the real GUI index page (through the frontend-static fallback, which
 * injects `window.__DSH_BOOT__`) so the replay page reuses the exact assets
 * and bootstrap payload of the running GUI.
 */
async function fetchRealIndex(port, host = '127.0.0.1') {
  const res = await fetch(`http://${host}:${String(port)}/`)
  if (!res.ok) throw new Error('index fetch failed: ' + res.status)
  return await res.text()
}

/**
 * Mount the /replay routes.
 * @param ctx - context carrying webServer.
 */
export function apply(ctx: Context) {
  const sessionsRoot = join(process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'), 'sessions')

  const serve = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.local')
    const path = url.pathname

    // /replay → no session list. Share is per-session only (via the GUI
    // context menu); the bare /replay path redirects to the most recently
    // active session so it never exposes the full catalog.
    if (path === '/replay' || path === '/replay/') {
      const list = existsSync(sessionsRoot) ? scanSessions(sessionsRoot) : []
      if (list.length > 0) {
        const active = list[0] // scanSessions sorts by updatedAt desc
        res.writeHead(302, { 'location': '/replay/' + encodeURIComponent(active.sessionId) })
        res.end()
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('没有可回放的会话')
      return
    }

    // /replay/<sessionId> → replay page.
    // Local requests get the pixel-identical real GUI (driver auto-opens the
    // session in the native sidebar). Remote requests (via a public tunnel)
    // get the self-contained standalone player instead — the GUI's own RPC is
    // loopback-protected, so the native sidebar would show no sessions there.
    const m = path.match(/^\/replay\/([^/]+)$/)
    if (m) {
      const sessionId = decodeURIComponent(m[1])
      const list = existsSync(sessionsRoot) ? scanSessions(sessionsRoot) : []
      const chosen = list.find((s) => s.sessionId === sessionId)
      if (!chosen) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('会话不存在: ' + sessionId)
        return
      }

      // Detect remote access: any X-Forwarded-For / X-Forwarded-Host header
      // set by a tunnel proxy, or a Host that is not loopback.
      const forwarded = req.headers['x-forwarded-for'] ?? req.headers['x-forwarded-host']
      const hostHeader = req.headers.host ?? ''
      const remote = Boolean(forwarded) || !/^127\.0\.0\.1|^localhost|^\[::1\]/.test(hostHeader)

      if (remote) {
        const { renderStandalone } = await import('./standalone.ts')
        const html = renderStandalone(chosen.file, chosen.title)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }

      const port = ctx.webServer.port
      const host = ctx.webServer.host === '0.0.0.0' ? '127.0.0.1' : ctx.webServer.host
      let html
      try {
        html = await fetchRealIndex(port, host)
      } catch (e) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('无法加载 GUI 首页: ' + (e instanceof Error ? e.message : String(e)))
        return
      }

      // Splice the driver script before </body>. The driver receives the
      // target session id and the sessions root for sidebar labeling.
      const payload = JSON.stringify({ sessionId, title: chosen.title || '' })
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
      const injected = `<script>window.__DSH_REPLAY__ = ${payload};</script>
<script>${DRIVER}</script>`
      html = html.replace('</body>', injected + '</body>')

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    // /api/replay/* is served by the separate /api/replay route (serveApi).
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }

  // /api/replay/* — separate prefix route (the /replay prefix does not match
  // /api/... paths, and without this route they'd fall through to the static
  // fallback and 404).
  const serveApi = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.local')
    const path = url.pathname

    // /api/replay/sessions → id↔title index for the share buttons
    if (path === '/api/replay/sessions') {
      const list = existsSync(sessionsRoot) ? scanSessions(sessionsRoot) : []
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        sessions: list.map((s) => ({
          sessionId: s.sessionId,
          title: s.title || s.sessionId,
          updatedAt: s.updatedAt || s.createdAt || 0,
          agentPreset: s.agentPreset || null,
        })),
      }))
      return
    }

    // /api/replay/export/<sessionId> → self-contained replay HTML download
    const ex = path.match(/^\/api\/replay\/export\/([^/]+)$/)
    if (ex) {
      const sessionId = decodeURIComponent(ex[1])
      const list = existsSync(sessionsRoot) ? scanSessions(sessionsRoot) : []
      const chosen = list.find((s) => s.sessionId === sessionId)
      if (!chosen) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('会话不存在: ' + sessionId)
        return
      }
      const { renderStandalone } = await import('./standalone.ts')
      const html = renderStandalone(chosen.file, chosen.title)
      const filename = 'dsh-replay-' + sessionId.slice(0, 24) + '.html'
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      })
      res.end(html)
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }

  // Inject share buttons into the real GUI index page.
  const disposers = [
    ctx.webServer.register({ kind: 'prefix', path: '/replay', handler: serve }),
    ctx.webServer.register({ kind: 'prefix', path: '/api/replay', handler: serveApi }),
  ]
  const tap = ctx.webServer.tapIndex((html: string) => {
    const script = `<script>${SHARE_BUTTON}</script>`
    return html.replace('</body>', script + '</body>')
  })
  disposers.push(tap)
  return () => {
    for (const d of disposers) d()
  }
}

/** Display name for diagnostics. */
export const name = 'dsh-replay'
