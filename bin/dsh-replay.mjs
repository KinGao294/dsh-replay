#!/usr/bin/env node
/**
 * dsh-replay — DeepSeek Harness 会话链接回放生成器
 *
 * 读取 DSH 会话日志，生成 Manus 风格的自包含 HTML 回放播放器：
 * 打字机动画、工具调用卡片、推理折叠、倍速播放、进度条。
 * 生成的文件可以分享给任何人，浏览器打开即看，无需安装 DSH。
 *
 * 用法：
 *   dsh-replay list                     列出所有会话
 *   dsh-replay export <sessionId> [out] 生成回放 HTML（默认输出 ./replay-<id>.html）
 *   dsh-replay export --pick [out]      交互式选择会话后生成
 *   dsh-replay serve [port]             本地起一个静态服务，方便分享链接
 *
 * @module dsh-replay/cli
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { extractFromFile, scanSessions } from '../src/extract.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const DSH_HOME = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')
const TEMPLATE = readFileSync(join(__dirname, '../assets/template.html'), 'utf8')

/** Escaped inline JSON for embedding into the HTML template. */
function embedJson(obj) {
  return JSON.stringify(obj)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Render the replay HTML for one session file.
 * @param {string} sessionFile - absolute path to session.jsonl(.zstd)
 * @param {object} extra - extra metadata to attach (title override etc.)
 * @returns {{html: string, meta: object}}
 */
export function renderReplay(sessionFile, extra = {}) {
  const data = extractFromFile(sessionFile)
  const safeTitle = (extra.title || data.title || basename(dirname(sessionFile))).slice(0, 120)
  const sidebar = (extra.sidebarSessions || []).slice(0, 12).map((s) => ({
    title: s.title || s.sessionId,
    id: s.sessionId,
    time: timeAgo(s.updatedAt || s.createdAt),
  }))
  const payload = {
    title: safeTitle,
    cwd: data.header?.cwd || null,
    agentPreset: data.header?.agentPreset || null,
    createdAt: data.header?.createdAt || 0,
    frames: data.frames,
    sidebarSessions: sidebar,
  }
  const html = TEMPLATE
    .replace('__TITLE__', safeTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .replace('__DATA__', embedJson(payload))
  return { html, meta: { title: safeTitle, frames: data.frames.length, header: data.header } }
}

/** Human relative time for the sidebar list. */
function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时'
  const d = Math.floor(h / 24)
  return d + ' 天'
}

// ── CLI ───────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2)

function printSessions(list, { verbose = false } = {}) {
  if (list.length === 0) {
    console.log('没有找到会话。会话根目录: ' + SESSIONS_ROOT)
    return
  }
  console.log(`共 ${list.length} 个会话:`)
  for (const s of list) {
    const date = new Date(s.updatedAt || s.createdAt).toLocaleString('zh-CN', { hour12: false })
    const title = (s.title || s.sessionId).slice(0, 50)
    const preset = s.agentPreset ? ` [${s.agentPreset}]` : ''
    console.log(`  ${s.sessionId}  ${date}${preset}`)
    console.log(`    ↳ ${title}`)
    if (verbose) console.log(`    ↳ ${s.cwd || ''} · ${s.eventCount} 事件 · ${s.file}`)
  }
}

async function main() {
  if (!existsSync(SESSIONS_ROOT)) {
    console.error(`会话目录不存在: ${SESSIONS_ROOT}`)
    console.error('请确认 DSH_HOME 或 ~/.dsh 下有 sessions/。')
    process.exit(1)
  }

  if (cmd === 'list' || cmd === 'ls') {
    const list = scanSessions(SESSIONS_ROOT)
    printSessions(list, { verbose: args.includes('-v') || args.includes('--verbose') })
    return
  }

  if (cmd === 'export') {
    let sessionId = args[0]
    let outFile = args[1]
    if (sessionId === '--pick' || sessionId === '-p') {
      const list = scanSessions(SESSIONS_ROOT)
      printSessions(list)
      const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout })
      const pick = await new Promise((res) => rl.question('\n输入序号或 sessionId: ', res))
      rl.close()
      const idx = parseInt(pick, 10)
      const chosen = Number.isInteger(idx) && idx >= 1 && idx <= list.length
        ? list[idx - 1]
        : list.find((s) => s.sessionId === pick)
      if (!chosen) { console.error('没有匹配的会话。'); process.exit(1) }
      sessionId = chosen.sessionId
      outFile = outFile || join(process.cwd(), `replay-${sessionId}.html`)
      const { html, meta } = renderReplay(chosen.file, { sidebarSessions: list })
      writeFileSync(outFile, html, 'utf8')
      console.log(`✓ 已生成回放: ${outFile}`)
      console.log(`  ${meta.title} · ${meta.frames} 帧`)
      console.log('  用浏览器打开即可播放，或分享这个 HTML 文件给任何人。')
      return
    }
    if (!sessionId) {
      console.error('用法: dsh-replay export <sessionId> [out.html]')
      console.error('       dsh-replay export --pick [out.html]')
      process.exit(1)
    }
    const list = scanSessions(SESSIONS_ROOT)
    const chosen = list.find((s) => s.sessionId === sessionId)
    if (!chosen) {
      console.error(`未找到会话: ${sessionId}`)
      console.error('用 `dsh-replay list` 查看全部会话。')
      process.exit(1)
    }
    outFile = outFile || join(process.cwd(), `replay-${sessionId}.html`)
    const { html, meta } = renderReplay(chosen.file, { sidebarSessions: list })
    writeFileSync(outFile, html, 'utf8')
    console.log(`✓ 已生成回放: ${outFile}`)
    console.log(`  ${meta.title} · ${meta.frames} 帧`)
    return
  }

  if (cmd === 'serve') {
    const port = parseInt(args[0] || '8931', 10)
    const { createServer } = await import('node:http')
    const { extname } = await import('node:path')
    const list = scanSessions(SESSIONS_ROOT)
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-replay</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#0f1115;color:#e6e9ef;padding:32px;max-width:900px;margin:0 auto}
h1{font-size:20px}ul{list-style:none;padding:0}li{background:#171a21;border:1px solid #2a2f3a;border-radius:10px;padding:12px 16px;margin:8px 0}
a{color:#4f8cff;text-decoration:none}small{color:#8b93a3}</style></head><body>
<h1>🎬 dsh-replay — 会话回放</h1><ul>
${list.map((s, i) => `<li><a href="/r/${encodeURIComponent(s.sessionId)}">${i + 1}. ${(s.title || s.sessionId).slice(0, 60)}</a><br><small>${new Date(s.updatedAt || s.createdAt).toLocaleString('zh-CN', { hour12: false })} · ${s.eventCount} 事件${s.agentPreset ? ' · ' + s.agentPreset : ''}</small></li>`).join('\n')}
</ul></body></html>`)
        return
      }
      const m = url.pathname.match(/^\/r\/([^/]+)$/)
      if (m) {
        const id = decodeURIComponent(m[1])
        const chosen = list.find((s) => s.sessionId === id)
        if (!chosen) { res.writeHead(404); res.end('not found'); return }
        const { html } = renderReplay(chosen.file, { sidebarSessions: list })
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }
      res.writeHead(404); res.end('not found')
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`dsh-replay 服务已启动: http://127.0.0.1:${port}`)
      console.log('共 ' + list.length + ' 个会话。Ctrl+C 停止。')
    })
    return
  }

  console.log(`dsh-replay — DeepSeek Harness 会话回放生成器

用法:
  dsh-replay list                     列出所有会话
  dsh-replay export <sessionId> [out] 生成回放 HTML
  dsh-replay export --pick [out]      交互式选择会话
  dsh-replay serve [port]             本地服务（默认端口 8931）
`)
}

main().catch((e) => { console.error(e); process.exit(1) })
