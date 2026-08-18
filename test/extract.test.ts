import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zstdCompressSync } from 'node:zlib'
import {
  scanFrames,
  decompressSession,
  parseEvents,
  sessionHeader,
  sessionTitle,
  buildTimeline,
} from '../src/extract.ts'

function zstd(text) {
  return zstdCompressSync(Buffer.from(text, 'utf8'))
}

test('scanFrames finds every Zstandard frame magic', () => {
  const buf = Buffer.concat([zstd('hello '), zstd('world '), zstd('!')])
  const frames = scanFrames(buf)
  assert.equal(frames.length, 3)
  // each magic marker is a 4-byte 28 b5 2f fd
  for (const idx of frames) {
    assert.deepEqual([...buf.subarray(idx, idx + 4)], [0x28, 0xb5, 0x2f, 0xfd])
  }
})

test('scanFrames returns empty for non-zstd input', () => {
  assert.deepEqual(scanFrames(Buffer.from('plain text')), [])
})

test('decompressSession reconstructs concatenated frames', () => {
  const buf = Buffer.concat([zstd('{"a":1}\n'), zstd('{"b":2}\n')])
  assert.equal(decompressSession(buf), '{"a":1}\n{"b":2}\n')
})

test('decompressSession skips a torn final frame', () => {
  const good = zstd('{"a":1}\n')
  const torn = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xff, 0xff, 0xff, 0xff])
  const plain = decompressSession(Buffer.concat([good, torn]))
  assert.equal(plain, '{"a":1}\n')
})

test('parseEvents parses JSONL and drops bad lines', () => {
  const events = parseEvents('{"type":"session"}\nnot json\n{"type":"user/message"}\n')
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'session')
  assert.equal(events[1].type, 'user/message')
})

test('sessionHeader / sessionTitle extract metadata', () => {
  const events = [
    { type: 'session', createdAt: 123, cwd: '/tmp' },
    { type: 'session/title', data: { title: 'hello' } },
  ]
  const h = sessionHeader(events)
  assert.ok(h)
  assert.equal(h.cwd, '/tmp')
  assert.equal(sessionTitle(events), 'hello')
  assert.equal(sessionHeader([]), null)
  assert.equal(sessionTitle([]), null)
})

test('buildTimeline emits frames in seq order with gapMs', () => {
  const events = [
    { type: 'session', createdAt: 1000, cwd: '/p', agentPreset: 'std' },
    { type: 'user/message', seq: 1, time: 1100, data: { id: 'u1', content: ['hi'], source: { kind: 'user' } } },
    {
      type: 'assistant/message',
      seq: 2,
      time: 1200,
      data: {
        message: {
          id: 'm1',
          source: { model: 'deepseek-v4' },
          content: [
            { type: 'reasoning', text: 'think...' },
            { type: 'text', text: 'hello back' },
            { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"cmd":"ls"}' },
          ],
        },
      },
    },
    { type: 'tool/call', seq: 3, time: 1250, data: { callId: 'call_1', name: 'bash', arguments: '{"cmd":"ls"}' } },
    {
      type: 'tool/result',
      seq: 4,
      time: 1300,
      data: {
        message: {
          source: { callId: 'call_1' },
          content: [{ type: 'tool-result', content: 'file1\nfile2' }],
        },
      },
    },
  ]
  const { header, title, frames } = buildTimeline(events)
  assert.ok(header)
  assert.equal(header.cwd, '/p')
  assert.equal(title, null)
  // user + assistant + tool (tool/result merges into the tool frame)
  assert.equal(frames.length, 3)
  assert.deepEqual(frames.map((f) => f.kind), ['user', 'assistant', 'tool'])
  // user frame
  assert.equal(frames[0].text, 'hi')
  assert.equal(frames[0].gapMs, 100)
  // assistant frame carries reasoning/text/toolCalls
  assert.equal(frames[1].reasoning, 'think...')
  assert.equal(frames[1].text, 'hello back')
  assert.equal(frames[1].toolCalls?.[0]?.callId, 'call_1')
  assert.equal(frames[1].model, 'deepseek-v4')
  // tool frame merged with its result
  assert.equal(frames[2].callId, 'call_1')
  assert.equal(frames[2].result, 'file1\nfile2')
  assert.equal(frames[2].isError, false)
  assert.equal(frames[2].gapMs, 50)
})

test('buildTimeline clamps gapMs to 60s', () => {
  const events = [
    { type: 'session', createdAt: 1000 },
    { type: 'user/message', seq: 1, time: 1000, data: { content: ['a'] } },
    { type: 'user/message', seq: 2, time: 1000 + 120_000, data: { content: ['b'] } },
  ]
  const { frames } = buildTimeline(events)
  assert.equal(frames[1].gapMs, 60_000)
})

test('buildTimeline flags system-injected user messages', () => {
  const events = [
    { type: 'session', createdAt: 0 },
    { type: 'user/message', seq: 1, time: 5, data: { content: ['skill doc'], source: { kind: 'plugin' } } },
  ]
  const { frames } = buildTimeline(events)
  assert.equal(frames[0].system, true)
  assert.equal(frames[0].sourceKind, 'plugin')
})
