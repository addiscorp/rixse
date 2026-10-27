// The person's CLI, run as they run it: a held request listed, answered,
// and an answer to anything not waiting refused.
import { afterAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import * as inbox from './inbox'

await mkdir(resolve('.tmp'), { recursive: true })
const base = await mkdtemp(join(resolve('.tmp'), 'cli-'))
afterAll(() => rm(base, { recursive: true, force: true }))

async function rixse(...args: string[]) {
  const p = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ])
  return { out, err, code }
}

test('requests lists what is held, and decide answers it once', async () => {
  const r = inbox.hold(base, {
    agent: 'gg.addis.agent.ops',
    host: 'api.cloudflare.com',
    method: 'POST',
    target: '/client/v4/zones/abc/dns_records',
    headers: ['content-type', 'application/json'],
    body: Buffer.from('{}').toString('base64'),
  })
  const list = await rixse('requests', '--config-dir', base)
  expect(list.code).toBe(0)
  const [row] = list.out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  expect(row).toMatchObject({
    id: r.id,
    status: 'held',
    method: 'POST',
    bytes: 2,
  })
  expect(row.body).toBeUndefined()

  const yes = await rixse(
    'decide',
    r.id,
    'yes',
    '--by',
    'gg.addis.human.sami',
    '--config-dir',
    base,
  )
  expect(yes.code).toBe(0)
  expect(JSON.parse(yes.out)).toMatchObject({
    id: r.id,
    decision: 'yes',
    by: 'gg.addis.human.sami',
    hash: r.hash,
  })

  const again = await rixse('decide', r.id, 'no', '--config-dir', base)
  expect(again.code).toBe(1)
  expect(JSON.parse(again.err).error).toBe(
    `${r.id} is approved, not waiting for an answer`,
  )
})

test('usage errors are JSON, with exit 2', async () => {
  const r = await rixse(
    'decide',
    'r_000000000000',
    'maybe',
    '--config-dir',
    base,
  )
  expect(r.code).toBe(2)
  expect(JSON.parse(r.err).error).toBe('decide takes <id> yes|no')
  const none = await rixse('requests')
  expect(JSON.parse(none.err).error).toBe('--config-dir is required')
})
