import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactText, countRedactions, redactMaybe } from '../src/redact.ts'

test('redactText masks OpenAI-style keys keeping a prefix', () => {
  const { text, hits } = redactText('use sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 now')
  assert.equal(hits, 1)
  assert.ok(!text.includes('sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'))
  assert.ok(text.includes('sk-p***'))
})

test('redactText masks Anthropic sk-ant keys', () => {
  const { text, hits } = redactText('key=sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP')
  assert.equal(hits, 1)
  assert.ok(!text.includes('sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP'))
})

test('redactText masks GitHub, npm, AWS, Slack tokens', () => {
  const sample = [
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno',
    'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    'npm_abcdefghijklmnopqrstuvwxyzABCDEF',
    'AKIAABCDEFGHIJKLMNOP',
    'xoxb-1234567890-abcdefghij',
  ].join(' ')
  const { text, hits } = redactText(sample)
  assert.equal(hits, 5)
  // prefix kept for recognisability, the secret payload is gone
  assert.ok(!text.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno'))
  assert.ok(!text.includes('ABCDEFGHIJKLMNOP'))
  assert.ok(!text.includes('1234567890-abcdefghij'))
})

test('redactText masks JWTs and Bearer tokens', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
  const { text, hits } = redactText('Authorization: Bearer ' + token)
  assert.equal(hits, 1)
  assert.ok(!text.includes(token))
  assert.ok(text.includes('Bearer'))
})

test('redactText masks PEM private keys entirely', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
  const { text, hits } = redactText(pem)
  assert.equal(hits, 1)
  assert.ok(!text.includes('MIIEowIBAAKCAQEA'))
  assert.ok(text.includes('脱敏'))
})

test('redactText masks credentials in URLs', () => {
  const { text, hits } = redactText('postgres://admin:s3cr3t@db.internal:5432/main')
  assert.equal(hits, 1)
  assert.ok(!text.includes('s3cr3t'))
  assert.ok(text.includes('admin:***'))
})

test('redactText masks key=value secret assignments keeping the key name', () => {
  const { text, hits } = redactText('export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456')
  assert.ok(hits >= 1)
  assert.ok(text.includes('OPENAI_API_KEY'))
  assert.ok(!text.includes('sk-abcdefghijklmnopqrstuvwxyz123456'))
})

test('redactText leaves normal prose untouched', () => {
  const prose = '你好，我在测试分享功能。今天的天气很好，代码运行正常，token 这个词也常见。'
  const { text, hits } = redactText(prose)
  assert.equal(hits, 0)
  assert.equal(text, prose)
})

test('redactText counts multiple occurrences', () => {
  const { hits } = redactText('key1=sk-abcdefghijklmnopqrstuvwxyz123456 and key2=sk-abcdefghijklmnopqrstuvwxyz654321')
  assert.equal(hits, 2)
})

test('redactMaybe passes through null/undefined', () => {
  assert.equal(redactMaybe(null), null)
  assert.equal(redactMaybe(undefined), undefined)
  const r = redactMaybe('Bearer abcdefghijklmnopqrstuvwxyzABCDEFGH')
  assert.ok(!r!.includes('abcdefghijklmnopqrstuvwxyzABCDEFGH'))
})

test('countRedactions counts without mutating', () => {
  const src = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno 普通文本'
  assert.equal(countRedactions(src), 1)
  assert.ok(src.includes('ghp_'))
})
