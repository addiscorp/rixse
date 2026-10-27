import { expect, test } from 'bun:test'
import type { Effect, Rule } from './config'
import {
  decide,
  governs,
  decideWith,
  keyedDefaults,
  pathProblem,
  ruleProblem,
} from './decide'

const CF = 'api.cloudflare.com'
const PCT =
  'a %, ; or backslash in the path (the host may read it as another path)'
const rules: Rule[] = [
  { host: CF, method: 'GET', path: '/client/v4/zones/*', effect: 'apply' },
  { host: CF, method: 'POST', path: '/client/v4/zones/*', effect: 'request' },
  { host: CF, path: '/client/v4/accounts/*', effect: 'forbidden' },
  {
    host: CF,
    method: 'GET',
    path: '/client/v4/zones/abc/secrets',
    effect: 'request',
  },
  { host: '*.github.test', method: 'GET', effect: 'apply' },
  { host: 'pick.test', path: '/x', effect: 'apply' },
  { host: 'pick.test', path: '/x', effect: 'request' },
]

test.each<[string, string, string, Effect]>([
  ['GET', CF, '/client/v4/zones/abc/dns_records', 'apply'],
  ['get', CF, '/client/v4/zones/abc/dns_records', 'apply'],
  ['POST', CF, '/client/v4/zones/abc/dns_records', 'request'],
  // forbidden wins over anything, whatever the method
  ['GET', CF, '/client/v4/accounts/x/tokens', 'forbidden'],
  ['DELETE', CF, '/client/v4/accounts/x', 'forbidden'],
  // the more specific rule wins: an exact path over the prefix
  ['GET', CF, '/client/v4/zones/abc/secrets', 'request'],
  // no rule matches on a governed host: held
  ['GET', CF, '/client/v4/user', 'request'],
  ['DELETE', CF, '/client/v4/zones/abc/dns_records/1', 'request'],
  ['GET', 'api.github.test', '/repos', 'apply'],
  ['POST', 'api.github.test', '/repos', 'request'],
  // the same rule twice with different effects: request, never apply
  ['GET', 'pick.test', '/x', 'request'],
])('%s %s%s → %s', (method, host, path, effect) => {
  expect(decide(rules, { host, method, path }).effect).toBe(effect)
})

test('a verdict names the rule that decided it', () => {
  expect(
    decide(rules, { host: CF, method: 'GET', path: '/client/v4/accounts/1' }),
  ).toEqual({
    effect: 'forbidden',
    rule: `forbidden * ${CF}/client/v4/accounts/*`,
  })
  expect(decide(rules, { host: CF, method: 'GET', path: '/nope' })).toEqual({
    effect: 'request',
  })
})

test('a host is governed when any rule names it; `*.` never names the apex', () => {
  expect(governs(rules, CF)).toBe(true)
  expect(governs(rules, 'API.CLOUDFLARE.COM.')).toBe(true)
  expect(governs(rules, 'api.github.test')).toBe(true)
  expect(governs(rules, 'github.test')).toBe(false)
  expect(governs(rules, 'api.stripe.com')).toBe(false)
})

test.each([
  ['/client/v4/zones/../accounts/x', 'a . or .. segment in the path'],
  ['/client/v4/zones/./x', 'a . or .. segment in the path'],
  ['/client/v4/zones/%2e%2e/accounts', PCT],
  ['/client/v4/zones%2Faccounts', PCT],
  ['/%61dmin/users', PCT],
  ['/public/..;/admin', PCT],
  ['/client/v4/zones\\..\\accounts', PCT],
  ['/client/v4//accounts', 'an empty segment in the path'],
  ['client', 'a path starts with /'],
])('a path a host could read differently is refused: %s', (path, problem) => {
  expect(pathProblem(path)).toBe(problem)
})

test('an ordinary path has no problem', () => {
  expect(pathProblem('/client/v4/zones/abc/dns_records')).toBeNull()
  expect(pathProblem('/')).toBeNull()
})

test('the path decides first: a rule about /admin outranks one about every path, whatever the methods', () => {
  const r: Rule[] = [
    { host: 'h.test', method: 'GET', path: '/*', effect: 'apply' },
    { host: 'h.test', path: '/admin/*', effect: 'request' },
    { host: 'h.test', method: 'GET', path: '/admin/public', effect: 'apply' },
  ]
  expect(
    decide(r, { host: 'h.test', method: 'GET', path: '/admin/export' }).effect,
  ).toBe('request')
  expect(
    decide(r, { host: 'h.test', method: 'GET', path: '/admin' }).effect,
  ).toBe('request')
  expect(
    decide(r, { host: 'h.test', method: 'GET', path: '/admin/public' }).effect,
  ).toBe('apply')
  expect(
    decide(r, { host: 'h.test', method: 'GET', path: '/home' }).effect,
  ).toBe('apply')
})

test('a /* prefix stops at a segment: /v1/charges/* is not /v1/charges-admin', () => {
  const r: Rule[] = [
    { host: 'h.test', method: 'GET', path: '/v1/charges/*', effect: 'apply' },
  ]
  expect(
    decide(r, { host: 'h.test', method: 'GET', path: '/v1/charges' }).effect,
  ).toBe('apply')
  expect(
    decide(r, { host: 'h.test', method: 'GET', path: '/v1/charges/ch_1' })
      .effect,
  ).toBe('apply')
  expect(
    decide(r, { host: 'h.test', method: 'GET', path: '/v1/charges-admin' })
      .effect,
  ).toBe('request')
})

test.each<[Rule, string]>([
  [
    { host: 'h.test', path: '/v1/charges*', effect: 'apply' },
    'path /v1/charges* is a path, or one ending in /* for everything under it',
  ],
  [
    { host: 'h.test', path: '/a/*/b', effect: 'apply' },
    'path /a/*/b is a path, or one ending in /* for everything under it',
  ],
  [
    { host: 'h.test', path: '/a/%2e', effect: 'apply' },
    'path /a/%2e is a path, or one ending in /* for everything under it',
  ],
  [
    { host: 'localhost', effect: 'apply' },
    'host localhost needs two or more labels, like api.github.com',
  ],
  [
    { host: 'h.test', method: 'GE T', effect: 'apply' },
    'method GE T is a method name or *',
  ],
  [
    { host: 'h.test', effect: 'allow' as never },
    'effect allow is apply, request or forbidden',
  ],
])(
  'a rule that could be misread is refused when the session starts: %#',
  (rule, problem) => {
    expect(ruleProblem(rule)).toBe(problem)
  },
)

test('ordinary rules have no problem', () => {
  for (const r of rules) expect(ruleProblem(r)).toBeNull()
})

test('a host a key goes to, governed by no rule: reads apply, everything else is held', () => {
  const defaults = keyedDefaults(['api.stripe.com', CF, '*.github.test'])
  const on = (host: string, method: string) =>
    decideWith(rules, defaults, { host, method, path: '/v1/charges' }).effect
  expect(on('api.stripe.com', 'GET')).toBe('apply')
  expect(on('api.stripe.com', 'HEAD')).toBe('apply')
  expect(on('api.stripe.com', 'POST')).toBe('request')
  expect(on('api.stripe.com', 'DELETE')).toBe('request')
  // CF has rules of its own: the defaults never apply to it.
  expect(
    decideWith(rules, defaults, { host: CF, method: 'GET', path: '/x' }).effect,
  ).toBe('request')
})

test('a host the profile governs by any pattern never gets the defaults', () => {
  // Named only by a wildcard: GET stays held.
  const wild: Rule[] = [
    { host: '*.stripe.com', method: 'GET', effect: 'request' },
  ]
  expect(
    decideWith(wild, keyedDefaults(['api.stripe.com']), {
      host: 'api.stripe.com',
      method: 'GET',
      path: '/',
    }).effect,
  ).toBe('request')
  // The vault names a wildcard, the profile an exact host with `*`: held.
  const all: Rule[] = [
    { host: 'api.stripe.com', path: '/*', effect: 'request' },
  ]
  expect(
    decideWith(all, keyedDefaults(['*.stripe.com']), {
      host: 'api.stripe.com',
      method: 'GET',
      path: '/v1',
    }).effect,
  ).toBe('request')
  // ...while a sibling the profile doesn't name gets the defaults.
  expect(
    decideWith(all, keyedDefaults(['*.stripe.com']), {
      host: 'files.stripe.com',
      method: 'GET',
      path: '/',
    }).effect,
  ).toBe('apply')
})
