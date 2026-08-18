/**
 * dsh-replay — sensitive-information redaction.
 *
 * Session replays are shared as public links / standalone HTML, and a
 * conversation often contains API keys, tokens or passwords pasted for
 * convenience. Before anything leaves the machine we scrub every text field
 * (user messages, assistant reasoning/text, tool arguments and results) with
 * a set of conservative patterns, keeping the first few characters so the
 * reader can still recognise what was redacted.
 *
 * Pure Node, no dependencies.
 *
 * @module dsh-replay/redact
 */

export type RedactResult = {
  /** The scrubbed text. */
  text: string
  /** Number of redaction matches applied. */
  hits: number
}

type Rule = {
  re: RegExp
  /** Replace callback: full match -> replacement (returns original when no hit). */
  replace: (match: string, ...groups: string[]) => string
}

const MASK = '***[已自动脱敏]***'
const KEY_MASK = '***[KEY 已脱敏]***'
const TOKEN_MASK = '***[TOKEN 已脱敏]***'

/** Mask a long token, keeping a 4-char recognisable prefix. */
function keepHead(match: string, kind = '已脱敏'): string {
  const head = match.length > 4 ? match.slice(0, 4) : match
  return head + `***[${kind}]***`
}

const RULES: Rule[] = [
  // PEM private keys — whole block
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => MASK,
  },
  // Anthropic keys (sk-ant-...)
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, replace: (m) => keepHead(m, 'KEY') },
  // OpenAI / DeepSeek style keys (sk-...)
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: (m) => keepHead(m, 'KEY') },
  // Google API keys
  { re: /\bAIza[0-9A-Za-z_-]{30,}\b/g, replace: (m) => keepHead(m, 'KEY') },
  // GitHub classic PATs (ghp_/gho_/ghu_/ghs_/ghr_)
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, replace: (m) => keepHead(m, 'TOKEN') },
  // GitHub fine-grained PATs
  { re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, replace: (m) => keepHead(m, 'TOKEN') },
  // npm tokens
  { re: /\bnpm_[A-Za-z0-9]{20,}\b/g, replace: (m) => keepHead(m, 'TOKEN') },
  // AWS access keys
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: (m) => keepHead(m, 'KEY') },
  // Slack tokens
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: (m) => keepHead(m, 'TOKEN') },
  // JWTs
  {
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: (m) => keepHead(m, 'TOKEN'),
  },
  // "Bearer <token>"
  {
    re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
    replace: (m, prefix: string) => prefix + keepHead(m.slice(prefix.length), 'TOKEN'),
  },
  // Credentials embedded in URLs (postgres://user:pass@host, https://user:pass@host, ...)
  {
    re: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+:)([^@/\s]{2,})@/gi,
    replace: (m, proto: string, user: string) => proto + user + '***@',
  },
  // key=value / key: value secret assignments
  {
    re: /\b((?:password|passwd|pwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?)([A-Za-z0-9._~+/=-]{8,})(["']?)/gi,
    replace: (m, head: string, _val: string, quote: string) => head + KEY_MASK + quote,
  },
]

/** Scrub sensitive patterns out of a text field. */
export function redactText(text: string): RedactResult {
  let hits = 0
  let out = text
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    out = out.replace(rule.re, (...args) => {
      hits++
      return rule.replace(args[0], ...args.slice(1, -2))
    })
  }
  return { text: out, hits }
}

/** Convenience: redact an optional/nullable string (e.g. tool result). */
export function redactMaybe(text: string | null | undefined): string | null | undefined {
  if (text === null || text === undefined) return text
  return redactText(text).text
}

/** Count redactions in a text without mutating it (cheap preview). */
export function countRedactions(text: string): number {
  let hits = 0
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    const m = text.match(rule.re)
    if (m) hits += m.length
  }
  return hits
}
