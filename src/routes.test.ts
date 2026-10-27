import { expect, test } from 'bun:test'
import {
  PLACEHOLDER,
  anthropicKeyRoute,
  claudeGuestEnvironment,
  claudeRoute,
  withClaudeRoute,
} from './routes'

const PROXY = 'http://127.0.0.1:8790'
const KEY = 'personal/anthropic/API_KEY'
const TOKEN = 'personal/claude/OAUTH_TOKEN'
/** A vault that records what it is asked, and sends only the API key. */
function vault() {
  const asked: string[] = []
  return {
    asked,
    hosts: async () => [],
    send: async (secret: string, host: string) => {
      asked.push(`${secret} ${host}`)
      if (secret === KEY) return 'sk-real'
      throw new Error(`harar refused ${secret} to ${host}: not_allowed`)
    },
  }
}

test("Claude Code's route adds the token as a bearer, only on the messages API", () => {
  const route = claudeRoute(vault(), TOKEN)!
  expect(route.upstream).toBe('https://api.anthropic.com')
  expect(route.header).toBe('authorization')
  expect(route.format!('sk-ant-oat01-x')).toBe('Bearer sk-ant-oat01-x')
  expect(route.paths).toEqual(['/v1/messages'])
  expect(claudeRoute(vault(), undefined)).toBeUndefined()
  expect(anthropicKeyRoute(vault(), KEY)!.header).toBe('x-api-key')
})

test("a route's key is the vault's send for the route's own host, never a read; a refusal says how to allow it", async () => {
  const v = vault()
  expect(await anthropicKeyRoute(v, KEY)!.credential()).toBe('sk-real')
  await expect(claudeRoute(v, TOKEN)!.credential()).rejects.toThrow(
    `harar hosts allow ${TOKEN} api.anthropic.com`,
  )
  expect(v.asked).toEqual([
    `${KEY} api.anthropic.com`,
    `${TOKEN} api.anthropic.com`,
  ])
})

test('Claude Code in the guest holds only the placeholder, and talks to nothing but the route', () => {
  const env = claudeGuestEnvironment(PROXY)
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(PLACEHOLDER)
  expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8790/claude')
  expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
  expect(env.DISABLE_AUTOUPDATER).toBe('1')
  expect(Object.keys(env).sort()).toEqual([
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'DISABLE_AUTOUPDATER',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
  ])
})

test("the host's Anthropic and Claude settings never reach a VM on the route", () => {
  const env = withClaudeRoute({
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'sk-ant-api-host',
    ANTHROPIC_AUTH_TOKEN: 'host',
    ANTHROPIC_CUSTOM_HEADERS: 'x: y',
    CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-host',
    CLAUDE_CODE_USE_BEDROCK: '1',
  }, PROXY)
  for (const value of Object.values(env))
    expect([
      'sk-ant-api-host',
      'host',
      'x: y',
      'sk-ant-oat01-host',
    ]).not.toContain(value)
  expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
  expect(env.PATH).toBe('/usr/bin')
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(PLACEHOLDER)
})
