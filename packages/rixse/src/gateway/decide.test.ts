import { expect, test } from 'bun:test'
import type { Effect, Rule } from './config'
import { decide, governs, pathProblem } from './decide'

const CF = 'api.cloudflare.com'
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
  [
    '/client/v4/zones/%2e%2e/accounts',
    'an encoded dot, slash or a backslash in the path',
  ],
  [
    '/client/v4/zones%2Faccounts',
    'an encoded dot, slash or a backslash in the path',
  ],
  [
    '/client/v4/zones\\..\\accounts',
    'an encoded dot, slash or a backslash in the path',
  ],
  ['/client/v4//accounts', 'an empty segment in the path'],
  ['client', 'a path starts with /'],
])('a path a host could read differently is refused: %s', (path, problem) => {
  expect(pathProblem(path)).toBe(problem)
})

test('an ordinary path has no problem', () => {
  expect(pathProblem('/client/v4/zones/abc/dns_records')).toBeNull()
  expect(pathProblem('/')).toBeNull()
})
