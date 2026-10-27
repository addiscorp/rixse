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
    headers: [
      'content-type',
      'application/json',
      'Authorization',
      'Bearer mirab-ph-0123456789abcdef01234567',
    ],
    keys: [
      {
        header: 'Authorization',
        secret: 'personal/cloudflare/DNS_READ',
        approved: 'personal/cloudflare/DNS_EDIT',
      },
    ],
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

  // show: everything a yes would send, and the hash it binds to.
  const show = await rixse('show', r.id, '--config-dir', base, '--human')
  expect(show.code).toBe(0)
  expect(show.out).toContain(
    `POST https://api.cloudflare.com/client/v4/zones/abc/dns_records`,
  )
  expect(show.out).toContain(
    'Authorization: Bearer ‹harar://personal/cloudflare/DNS_EDIT›',
  )
  expect(show.out).toContain('{}')
  expect(show.out).toContain(`hash: ${r.hash}`)

  // Not a terminal, and no hash: refused.
  const blind = await rixse('decide', r.id, 'yes', '--config-dir', base)
  expect(blind.code).toBe(2)
  expect(JSON.parse(blind.err).error).toContain('approving needs a terminal')

  const yes = await rixse(
    'decide',
    r.id,
    'yes',
    '--hash',
    r.hash,
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

test('a request put to an approver is approved through harar, and harar saying no stops it', async () => {
  // A stand-in harar on PATH: records its arguments, approves or not.
  const bin = join(base, 'bin')
  await mkdir(bin, { recursive: true })
  const log = join(base, 'harar.log')
  const harar = join(bin, 'harar')
  const fake = (code: number) =>
    Bun.write(harar, `#!/bin/sh\necho "$@" >> ${log}\nexit ${code}\n`).then(
      () => Bun.spawnSync(['chmod', '+x', harar]),
    )
  const run = (...args: string[]) => {
    const p = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
    return Promise.all([new Response(p.stderr).text(), p.exited])
  }
  const held = () => {
    const r = inbox.hold(base, {
      agent: 'gg.addis.agent.ops',
      host: 'api.cloudflare.com',
      method: 'POST',
      target: '/x',
      headers: [],
      keys: [],
      body: '',
    })
    inbox.setApproval(base, r.id, `appr-${r.id}`)
    return r
  }

  await fake(1)
  const refused = held()
  const [err, code] = await run(
    'decide',
    refused.id,
    'yes',
    '--hash',
    refused.hash,
    '--config-dir',
    base,
    '--harar-socket',
    '/p.sock',
  )
  expect(code).toBe(1)
  expect(JSON.parse(err).error).toBe(
    `harar approve appr-${refused.id} didn't approve it`,
  )
  expect(inbox.answer(base, refused.id)).toBeUndefined()

  await fake(0)
  const approved = held()
  const [, ok] = await run(
    'decide',
    approved.id,
    'yes',
    '--hash',
    approved.hash,
    '--config-dir',
    base,
    '--harar-socket',
    '/p.sock',
  )
  expect(ok).toBe(0)
  expect(inbox.answer(base, approved.id)?.decision).toBe('yes')
  expect((await Bun.file(log).text()).trim().split('\n')).toEqual([
    `approve appr-${refused.id} --socket /p.sock`,
    `approve appr-${approved.id} --socket /p.sock`,
  ])
  const show = await rixse('show', approved.id, '--config-dir', base, '--human')
  expect(show.out).toContain(
    `approval: appr-${approved.id} (on your device: harar approve appr-${approved.id})`,
  )
})
