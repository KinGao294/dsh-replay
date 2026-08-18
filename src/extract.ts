/**
 * dsh-replay — session log extractor.
 *
 * Reads a DeepSeek Harness session artifact (`session.jsonl.zstd`, a
 * concatenation of independent Zstandard frames, each decompressing to JSONL
 * lines) and rebuilds a structured, replayable timeline: user messages,
 * assistant messages (reasoning / text / tool-call parts), tool calls and
 * their results, with per-event timestamps derived from the log's `time`
 * fields. Pure Node, no runtime dependencies beyond `node:zlib`.
 *
 * @module dsh-replay/extract
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** A single event record from the session log. */
export type SessionEvent = {
  type: string
  seq?: number
  time?: number
  time0?: number
  data?: any
  [key: string]: any
}

/** One replay timeline frame. */
export type ReplayFrame = {
  kind: 'user' | 'assistant' | 'tool'
  time: number
  seq: number
  gapMs?: number
  id?: string
  text?: string
  sourceKind?: string
  system?: boolean
  reasoning?: string | null
  toolCalls?: { callId?: string; name?: string; arguments?: string }[]
  model?: string | null
  callId?: string
  name?: string
  arguments?: string
  result?: string | null
  isError?: boolean
  resultTime?: number
}

/** Timeline build result. */
export type TimelineResult = {
  header: SessionEvent | null
  title: string | null
  frames: ReplayFrame[]
  eventCount: number
}

/** One session summary entry (scanSessions). */
export type SessionSummary = {
  sessionId: string
  projectDir: string
  file: string
  createdAt: number
  cwd: string | null
  agentPreset: string | null
  title: string
  eventCount: number
  updatedAt: number
}

/** Split a concatenated Zstandard stream into frame byte ranges. */
export function scanFrames(buf: Buffer): number[] {
  const frames: number[] = []
  let idx = 0
  while ((idx = buf.indexOf(ZSTD_MAGIC, idx)) !== -1) {
    frames.push(idx)
    idx += 4
  }
  return frames
}

/**
 * Decompress a session artifact into plaintext JSONL.
 * Torn / incomplete final frames are skipped silently (the durable backend
 * may leave an interrupted append).
 */
export function decompressSession(buf: Buffer): string {
  const frames = scanFrames(buf)
  let all = ''
  for (let i = 0; i < frames.length; i++) {
    const start = frames[i]
    const end = i + 1 < frames.length ? frames[i + 1] : buf.length
    try {
      all += zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
    } catch {
      // torn final frame — skip
    }
  }
  return all
}

/** Parse a decompressed artifact into event objects (JSONL lines). */
export function parseEvents(plaintext: string): SessionEvent[] {
  return plaintext
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SessionEvent
      } catch {
        return null
      }
    })
    .filter((e): e is SessionEvent => Boolean(e))
}

/** Extract the session header (first `session` record). */
export function sessionHeader(events: SessionEvent[]): SessionEvent | null {
  return events.find((e) => e.type === 'session') ?? null
}

/** Extract the session title event if present. */
export function sessionTitle(events: SessionEvent[]): string | null {
  const t = events.find((e) => e.type === 'session/title')
  return t?.data?.title ?? null
}

/** Decode a text part (text / reasoning / tool-result content). */
function textOf(part: any): string {
  if (!part) return ''
  if (typeof part === 'string') return part
  if (typeof part.text === 'string') return part.text
  if (Array.isArray(part.content)) {
    return part.content.map(textOf).join('\n')
  }
  return ''
}

/** Stable integer time for one event (ms since epoch). */
function evtTime(e: SessionEvent): number {
  const t = typeof e.time === 'number' ? e.time : e.time0
  return typeof t === 'number' && Number.isFinite(t) ? t : 0
}

/** Summary of one tool result (text) with a short preview. */
function toolResultText(data: any): string {
  const msg = data?.message
  if (!msg) return ''
  const parts = Array.isArray(msg.content) ? msg.content : []
  const texts = parts
    .map((p: any) => {
      if (p?.type === 'tool-result' || p?.type === 'tool_result') {
        return textOf(p.content)
      }
      return textOf(p)
    })
    .filter(Boolean)
  return texts.join('\n')
}

/**
 * Rebuild a replay timeline from parsed session events.
 *
 * The timeline is an ordered list of frames:
 *   { kind: 'user'|'assistant'|'tool', ... }
 * Timestamps are event times; `gapMs` is the wall-clock gap from the previous
 * frame (used by the player for natural pacing, clamped to a sane max).
 *
 * @returns {{header: object, title: string|null, frames: object[]}}
 */
export function buildTimeline(events: SessionEvent[]): TimelineResult {
  const header = sessionHeader(events)
  const title = sessionTitle(events)

  // 1) user messages
  const userEvents = events.filter((e) => e.type === 'user/message')
  // 2) assistant messages (final assembled, includes reasoning + text + tool calls)
  const assistantEvents = events.filter((e) => e.type === 'assistant/message')
  // 3) tool results keyed by callId
  const resultsByCall = new Map<string, { time: number; text: string; isError: boolean; callId: string }>()
  for (const e of events) {
    if (e.type !== 'tool/result') continue
    const callId = e.data?.message?.source?.callId as string | undefined
    if (callId) {
      resultsByCall.set(callId, {
        time: evtTime(e),
        text: toolResultText(e.data),
        isError: e.data?.message?.content?.some((p: any) => p?.isError) as boolean,
        callId,
      })
    }
  }
  // tool calls keyed by callId (first occurrence wins — the authoritative one)
  const callInfo = new Map<string, { callId: string; name: string; arguments: string; time: number; seq: number }>()
  for (const e of events) {
    if (e.type !== 'tool/call') continue
    const callId = e.data?.callId as string | undefined
    if (!callId || callInfo.has(callId)) continue
    callInfo.set(callId, {
      callId,
      name: e.data?.name ?? 'tool',
      arguments: e.data?.arguments ?? '',
      time: evtTime(e),
      seq: e.seq ?? 0,
    })
  }

  // Build frames in seq order by walking the merged event stream.
  const frames: ReplayFrame[] = []
  const userSeq = new Map<number, SessionEvent>()
  for (const e of userEvents) userSeq.set(e.seq ?? 0, e)

  // Associate user messages with their turn, then emit in seq order.
  const allOrdered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  let lastTime = header?.createdAt ?? 0
  const pushFrame = (frame: ReplayFrame) => {
    const t = frame.time
    frame.gapMs = lastTime ? Math.max(0, Math.min(t - lastTime, 60_000)) : 0
    lastTime = t
    frames.push(frame)
  }

  const emittedUsers = new Set<number>()
  const emittedAssistants = new Set<number>()
  const emittedTools = new Set<number>()

  for (const e of allOrdered) {
    const seq = e.seq ?? 0

    if (e.type === 'user/message' && !emittedUsers.has(seq)) {
      emittedUsers.add(seq)
      const sourceKind = e.data?.source?.kind ?? 'user'
      const text = Array.isArray(e.data?.content) ? e.data.content.map(textOf).filter(Boolean).join('\n') : ''
      pushFrame({
        kind: 'user',
        id: e.data?.id,
        text,
        sourceKind,
        system: sourceKind !== 'user', // plugin / skill-catalog injected context
        time: evtTime(e),
        seq,
      })
    }

    if (e.type === 'assistant/message' && !emittedAssistants.has(seq)) {
      emittedAssistants.add(seq)
      const content = Array.isArray(e.data?.message?.content) ? e.data.message.content : []
      const reasoning = content.filter((p: any) => p?.type === 'reasoning').map(textOf).filter(Boolean).join('\n')
      const text = content.filter((p: any) => p?.type === 'text').map(textOf).filter(Boolean).join('\n')
      const toolCalls = content
        .filter((p: any) => p?.type === 'tool-call' || p?.type === 'tool_call')
        .map((p: any) => ({
          callId: p.id ?? p.callId,
          name: p.name ?? 'tool',
          arguments: p.arguments ?? p.input ?? '',
        }))
      pushFrame({
        kind: 'assistant',
        id: e.data?.message?.id,
        reasoning: reasoning || null,
        text,
        toolCalls,
        model: e.data?.message?.source?.model ?? null,
        time: evtTime(e),
        seq,
      })
    }

    if (e.type === 'tool/call' && !emittedTools.has(seq)) {
      emittedTools.add(seq)
      const callId = e.data?.callId as string | undefined
      const info = callInfo.get(callId ?? '') ?? {
        callId,
        name: e.data?.name ?? 'tool',
        arguments: e.data?.arguments ?? '',
      }
      pushFrame({
        kind: 'tool',
        callId,
        name: info.name,
        arguments: info.arguments,
        result: resultsByCall.get(callId ?? '')?.text ?? null,
        isError: resultsByCall.get(callId ?? '')?.isError ?? false,
        resultTime: resultsByCall.get(callId ?? '')?.time ?? 0,
        time: evtTime(e),
        seq,
      })
    }
  }

  return { header, title, frames, eventCount: events.length }
}

/** Convenience: read + decompress + build timeline from a session file path. */
export function extractFromFile(filePath: string) {
  const buf = readFileSync(filePath)
  const plain = decompressSession(buf)
  const events = parseEvents(plain)
  return { ...buildTimeline(events), events }
}

/** List every session artifact under a DSH sessions root. */
export function scanSessions(root: string): SessionSummary[] {
  const out: SessionSummary[] = []
  const projects = readdirSync(root, { withFileTypes: true })
  for (const proj of projects) {
    if (!proj.isDirectory()) continue
    const projPath = join(root, proj.name)
    let sessions
    try {
      sessions = readdirSync(projPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const s of sessions) {
      if (!s.isDirectory()) continue
      const logPath = join(projPath, s.name, 'session.jsonl.zstd')
      try {
        const buf = readFileSync(logPath)
        const plain = decompressSession(buf)
        const events = parseEvents(plain)
        const header = sessionHeader(events)
        const title = sessionTitle(events)
        const lastEvent = events[events.length - 1]
        out.push({
          sessionId: s.name,
          projectDir: proj.name,
          file: logPath,
          createdAt: header?.createdAt ?? 0,
          cwd: header?.cwd ?? null,
          agentPreset: header?.agentPreset ?? null,
          title: title ?? s.name,
          eventCount: events.length,
          updatedAt: lastEvent ? evtTime(lastEvent) : header?.createdAt ?? 0,
        })
      } catch {
        // unreadable artifact — skip
      }
    }
  }
  out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return out
}
