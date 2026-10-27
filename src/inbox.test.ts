// The inbox's limits: a VM can't fill it, and requests past any use go.
import { afterAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import * as inbox from './inbox'

await mkdir(resolve('.tmp'), { recursive: true })
const base = await mkdtemp(join(resolve('.tmp'), 'inbox-'))
afterAll(() => rm(base, { recursive: true, force: true }))

const request = (agent: string) => ({
  agent,
  host: 'api.cloudflare.com',
  method: 'POST',
  target: '/x',
  headers: [],
  keys: [],
  body: '',
})

test('one agent can have MAX_WAITING requests waiting, then is told no', () => {
  for (let i = 0; i < inbox.MAX_WAITING; i++) inbox.hold(base, request('a'))
  expect(() => inbox.hold(base, request('a'))).toThrow('already waiting')
  // Another agent's are its own.
  expect(inbox.hold(base, request('b')).agent).toBe('b')
})

test('requests too old for any answer to send are removed when the agent holds again', () => {
  const old = new Date(Date.now() - inbox.HOLD_MS - inbox.APPROVAL_MS - 1000)
  const stale = inbox.hold(base, request('c'), old)
  inbox.decide(base, stale.id, 'no', 'x', undefined, old)
  inbox.hold(base, request('c'))
  expect(inbox.held(base, stale.id)).toBeUndefined()
  expect(existsSync(join(base, 'gateway', 'answers', `${stale.id}.json`))).toBe(
    false,
  )
})
