// What a call gets: a pure function of the session's rules and the call, no
// I/O, so it is tested as a table (decide.test.ts).
//
// A host named by any rule is governed: each request to it gets the effect
// of the rules that match it, and one no rule matches is held (`request`).
// A host a key is swapped in for is governed too: with no rule naming it,
// it gets `keyedDefaults` (reads apply, everything else is held), the safe
// default of a gateway like DigitalOcean's: no rule, no unapproved write.
// A host with neither passes as the allow-list lets it (no key, no power).
import { allowed, domainProblem } from './hosts'
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
  `${r.effect} ${(r.method ?? '*').toUpperCase()} ${r.host.toLowerCase()}${r.path ?? '/*'}`

const normal = (host: string) => host.toLowerCase().replace(/\.$/, '')

/** `/a/*` is `/a` and everything under it, by whole segments (never
 *  `/ab`); `/*` or none is every path; anything else is that path only. */
function pathMatches(pattern: string | undefined, path: string) {
  if (pattern === undefined || pattern === '/*') return true
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2)
    return path === base || path.startsWith(base + '/')
  }
  return path === pattern
}

/** Why a rule can't be used, or null: rules are checked when a session starts. */
export function ruleProblem(r: Rule): string | null {
  const host = r.host.toLowerCase()
  const problem = domainProblem(host)
  if (problem) return `host ${r.host} ${problem}`
  if (r.method !== undefined && !/^(\*|[A-Z]+)$/.test(r.method.toUpperCase()))
    return `method ${r.method} is a method name or *`
  if (r.path !== undefined) {
    const base = r.path.endsWith('/*') ? r.path.slice(0, -2) : r.path
    if (r.path !== '/*' && (base.includes('*') || pathProblem(base || '/')))
      return `path ${r.path} is a path, or one ending in /* for everything under it`
  }
  if (!['apply', 'request', 'forbidden'].includes(r.effect))
    return `effect ${r.effect} is apply, request or forbidden`
  return null
}

function matches(r: Rule, call: Call) {
  const method = (r.method ?? '*').toUpperCase()
  return (
    allowed(normal(call.host), [normal(r.host)]) &&
    (method === '*' || method === call.method.toUpperCase()) &&
    pathMatches(r.path, call.path)
  )
}

/** Higher is more specific. The path decides first (a longer one, then an
 *  exact path over a prefix of the same length), then a method over `*`,
 *  then an exact host over `*.`: a rule about `/admin/*` outranks one about
 *  every path, whatever their methods. */
function specificity(r: Rule): number {
  const path = r.path ?? '/*'
  const exact = path.endsWith('/*') ? 0 : 1
  const length = path.endsWith('/*') ? path.length - 2 : path.length
  const method = (r.method ?? '*') === '*' ? 0 : 1
  const host = r.host.startsWith('*.') ? 0 : 1
  return (length * 2 + exact) * 4 + method * 2 + host
}

const RANK: Record<Effect, number> = { forbidden: 2, request: 1, apply: 0 }

/** Why a path on a governed host can't be decided, or null. A host may read
 *  `/a/../b`, `/%61dmin`, `/a/..;/b` or a backslash as another path than the
 *  one a rule saw, so any of those is refused rather than matched: no `%`,
 *  no `;`, no backslash, no `.` or `..` segment, no empty segment. */
export function pathProblem(path: string): string | null {
  if (!path.startsWith('/')) return 'a path starts with /'
  if (/[%;\\]/.test(path))
    return 'a %, ; or backslash in the path (the host may read it as another path)'
  if (path.split('/').some((s) => s === '.' || s === '..'))
    return 'a . or .. segment in the path'
  if (path.includes('//')) return 'an empty segment in the path'
  return null
}

/** The rules a host a key goes to gets when no rule names it: GET and HEAD
 *  apply, anything else is held. Named rules replace these entirely, so a
 *  profile that writes rules for a host decides all of it. */
export function keyedDefaults(
  rules: readonly Rule[],
  keyed: readonly string[],
): Rule[] {
  return [...new Set(keyed.map(normal))]
    .filter((host) => !rules.some((r) => normal(r.host) === host))
    .flatMap((host): Rule[] => [
      { host, method: 'GET', effect: 'apply' },
      { host, method: 'HEAD', effect: 'apply' },
    ])
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
