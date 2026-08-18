/**
 * dsh-replay standalone export.
 *
 * Renders a self-contained replay HTML for one session: the replay template
 * with the session timeline, sidebar list and metadata embedded as JSON. The
 * file opens in any browser with no server, no DSH install — for sharing
 * with people outside your network.
 *
 * @module dsh-replay/standalone
 */

import { readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFromFile } from './extract.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
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

/** Human relative time for the sidebar list. */
function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时'
  return Math.floor(h / 24) + ' 天'
}

/**
 * Render the standalone replay HTML.
 * @param sessionFile - absolute path to the session artifact.
 * @param title - optional title override.
 * @param allSessions - session index for the sidebar list.
 * @returns the self-contained HTML string.
 */
export function renderStandalone(sessionFile, title) {
  const data = extractFromFile(sessionFile)
  const safeTitle = (title || data.title || basename(dirname(sessionFile))).slice(0, 120)
  const payload = {
    title: safeTitle,
    cwd: data.header?.cwd || null,
    agentPreset: data.header?.agentPreset || null,
    createdAt: data.header?.createdAt || 0,
    frames: data.frames,
    redactions: data.redactions || 0,
  }
  return TEMPLATE
    .replace('__TITLE__', safeTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .replace('__DATA__', embedJson(payload))
}
