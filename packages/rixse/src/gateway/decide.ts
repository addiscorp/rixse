// What a call gets: a pure function of the session's rules and the call, no
// I/O, so it is tested as a table (decide.test.ts).
//
// A host named by any rule is governed: each request to it gets the effect
// of the rules that match it, and one no rule matches is held (`request`).
// A host no rule names keeps today's behaviour: the allow-list and the key
// swap decide, and its requests pass.
import { allowed } from './hosts'
import type { Effect, Rule } from './config'

export interface Call {
  host: string
  method: string
  /** The path, without the query. */
  path: string
}

export type Verdict =
  | { effect: 'apply'; rule: string }
  | { effect: 'request'; rule?: string }
  | { effect: 'forbidden'; rule: string }

/** How a rule is named in verdicts, the inbox and the log. */
export const ruleName = (r: Rule) =>
  `${r.effect} ${(r.method ?? '*').toUpperCase()} ${r.host}${r.path ?? '/*'}`

const normal = (host: string) => host.toLowerCase().replace(/\.$/, '')

function pathMatches(pattern: string | undefined, path: string) {
  if (pattern === undefined || pattern === '*') return true
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1))
  return path === pattern
}

function matches(r: Rule, call: Call) {
  const method = (r.method ?? '*').toUpperCase()
  return (
    allowed(normal(call.host), [normal(r.host)]) &&
    (method === '*' || method === call.method.toUpperCase()) &&
    pathMatches(r.path, call.path)
  )
}

/** Higher is more specific: an exact host over `*.`, a method over `*`, a
 *  longer path, an exact path over a prefix of the same length. */
function specificity(r: Rule): number {
  const host = r.host.startsWith('*.') ? 0 : 1
  const method = (r.method ?? '*') === '*' ? 0 : 1
  const path = r.path ?? '*'
  const exact = path.endsWith('*') ? 0 : 1
  return host * 1e6 + method * 1e5 + path.replace(/\*$/, '').length * 2 + exact
}

const RANK: Record<Effect, number> = { forbidden: 2, request: 1, apply: 0 }

/** Why a path on a governed host can't be decided, or null. A host may read
 *  `/a/../b`, `%2e%2e`, an encoded slash or a backslash as another path than
 *  the one a rule saw, so those are refused rather than matched. */
export function pathProblem(path: string): string | null {
  if (!path.startsWith('/')) return 'a path starts with /'
  if (/%2e|%2f|%5c|\\/i.test(path))
    return 'an encoded dot, slash or a backslash in the path'
  if (path.split('/').some((s) => s === '.' || s === '..'))
    return 'a . or .. segment in the path'
  if (path.includes('//')) return 'an empty segment in the path'
  return null
}

/** Whether any rule names `host`, so its requests are decided here. */
export function governs(rules: readonly Rule[], host: string): boolean {
  return rules.some((r) => allowed(normal(host), [normal(r.host)]))
}

/**
 * The effect of `rules` on `call`. A matching `forbidden` always wins and is
 * never approvable; otherwise the most specific matching rule decides, and a
 * tie goes to `request` over `apply`. No match: `request`.
 */
export function decide(rules: readonly Rule[], call: Call): Verdict {
  const hits = rules.filter((r) => matches(r, call))
  const forbidden = hits.find((r) => r.effect === 'forbidden')
  if (forbidden) return { effect: 'forbidden', rule: ruleName(forbidden) }
  const top = hits.sort(
    (a, b) =>
      specificity(b) - specificity(a) || RANK[b.effect] - RANK[a.effect],
  )[0]
  if (!top) return { effect: 'request' }
  return top.effect === 'apply'
    ? { effect: 'apply', rule: ruleName(top) }
    : { effect: 'request', rule: ruleName(top) }
}
