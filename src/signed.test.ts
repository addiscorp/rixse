// Signed decisions, end to end with real curl: with an approver, a yes is
// the approver's word that a person approved these exact bytes. An answer
// file alone, as anything on the host could write, sends nothing.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as httpsServer } from 'node:https'
import { connect, createServer, type Server } from 'node:net'
import { join, resolve } from 'node:path'
import type { ApprovalState, Approver } from './approver'
import { stationAuthority } from './ca'
import { allowSecret } from './escalations'
import type { GatewayEvent } from './events'
import * as inbox from './inbox'
import { gateway, type GatewaySession } from './session'

const AGENT = 'gg.addis.agent.dns-fixer'
const CF = 'api.cloudflare.com'
const KEY = 'personal/cloudflare/DNS_EDIT'

/** A stand-in for harar's approver: what was asked, and the state a
 *  person's device would leave each approval in. */
const asked: Parameters<Approver['ask']>[0][] = []
const states = new Map<string, ApprovalState>()
const approver: Approver = {
  ask: async (r) => {
    asked.push(r)
    const id = `a${asked.length}`
    states.set(id, { state: 'waiting' })
    return id
  },
  check: async (id) => states.get(id) ?? { state: 'waiting' },
}

let base: string
let session: GatewaySession
let egress: Server
let bridge: Server
let upstream: ReturnType<typeof httpsServer>
let proxyPort: number
let caPath: string
const received: string[] = []
const events: GatewayEvent[] = []

beforeAll(async () => {
  await mkdir(resolve('.tmp'), { recursive: true })
  base = await mkdtemp(join(resolve('.tmp'), 'signed-'))
  const project = join(base, 'project')
  await mkdir(project)
  await writeFile(
    join(project, '.env'),
    `CLOUDFLARE_API_TOKEN=harar://${KEY}\n`,
  )
  allowSecret(base, AGENT, KEY)
  const world = await stationAuthority(join(base, 'world'))
  const leaf = await world.leaf([CF])
  upstream = httpsServer({ key: leaf.key, cert: leaf.cert }, (req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push(`${req.method} ${req.url} ${body}`)
      res.end('{"success":true}')
    })
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  const port = (upstream.address() as { port: number }).port
  session = await gateway({
    project,
    vault: { hosts: async () => [CF], send: async () => 'cf_real' },
    configDir: base,
    zone: 'gg.addis.zone.signed-test',
    auditLog: join(base, 'egress.log'),
    routes: {},
    allow: [],
    agent: AGENT,
    guest: { proxy: 'http://127.0.0.1:1', caPath: '/ca.pem' },
    approver,
    upstream: async () => ({ address: '127.0.0.1', port, ca: world.cert }),
  })
  caPath = join(base, 'ca.pem')
  await writeFile(caPath, session.caCert!)
  void (async () => {
    for await (const e of session.events) events.push(e)
  })()
  const socketPath = join(base, 'e.sock')
  egress = await session.listen(socketPath)
  bridge = createServer((c) => {
    const s = connect(socketPath)
    c.pipe(s)
    s.pipe(c)
    c.on('error', () => s.destroy())
    s.on('error', () => c.destroy())
  })
  await new Promise<void>((r) => bridge.listen(0, '127.0.0.1', r))
  proxyPort = (bridge.address() as { port: number }).port
})

afterAll(async () => {
  bridge?.close()
  egress?.close()
  await session?.close()
  upstream?.close()
  await rm(base, { recursive: true, force: true })
})

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(10)
}

/** A write from the VM, held: its id once the approver has been asked. */
async function heldWrite(body: string) {
  const p = Bun.spawn(
    [
      'curl',
      '-sS',
      '--max-time',
      '15',
      '-x',
      `http://127.0.0.1:${proxyPort}`,
      '--cacert',
      caPath,
      '-H',
      `Authorization: Bearer ${session.env.CLOUDFLARE_API_TOKEN}`,
      '-X',
      'POST',
      '-d',
      body,
      `https://${CF}/client/v4/zones/abc/dns_records`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const out = await new Response(p.stdout).text()
  if (!out) throw new Error('curl: ' + (await new Response(p.stderr).text()))
  const id: string = JSON.parse(out).rixse.request
  await until(() => events.some((e) => e.event === 'asked' && e.request === id))
  return { id, held: inbox.held(base, id)! }
}
/** The answer file `rixse decide` writes: the gateway's cue to check. */
const cue = (id: string, hash: string) =>
  inbox.decide(base, id, 'yes', 'someone on the host', hash)

test('the approver is asked for each held request, with its hash and what the device shows', async () => {
  const { held } = await heldWrite('{"n":1}')
  const ask = asked.at(-1)!
  expect(ask).toMatchObject({
    class: 'gateway.send',
    agent: AGENT,
    subject: held.hash,
  })
  expect(ask.text).toContain(
    `POST https://${CF}/client/v4/zones/abc/dns_records`,
  )
  expect(ask.text).toContain('{"n":1}')
  expect(held.approval).toBe(`a${asked.length}`)
})

test('an answer file alone sends nothing: the approver still says waiting', async () => {
  const { id, held } = await heldWrite('{"n":2}')
  const before = received.length
  cue(id, held.hash)
  await Bun.sleep(150)
  expect(received.length).toBe(before)
})

test("a person's approval of these bytes sends them once, by the approver's word", async () => {
  const { id, held } = await heldWrite('{"n":3}')
  states.set(held.approval!, {
    state: 'approved',
    subject: held.hash,
    by: 'gg.addis.human.sami',
    device: 'mac-1',
  })
  const before = received.length
  cue(id, held.hash)
  await until(() => events.some((e) => e.event === 'sent' && e.request === id))
  expect(received.slice(before)).toEqual([
    'POST /client/v4/zones/abc/dns_records {"n":3}',
  ])
  expect(events).toContainEqual({
    event: 'decided',
    request: id,
    decision: 'yes',
    by: 'gg.addis.human.sami (device mac-1)',
  })
})

test('an approval of other bytes, or one already used, sends nothing', async () => {
  const a = await heldWrite('{"n":4}')
  const b = await heldWrite('{"n":6}')
  const c = await heldWrite('{"n":6}') // b's bytes, held again
  const before = received.length
  // a's approval signed some other request.
  states.set(a.held.approval!, {
    state: 'approved',
    subject: 'f'.repeat(64),
    by: 'x',
    device: 'd',
  })
  cue(a.id, a.held.hash)
  // b's approval is real, and sends b.
  states.set(b.held.approval!, {
    state: 'approved',
    subject: b.held.hash,
    by: 'x',
    device: 'd',
  })
  cue(b.id, b.held.hash)
  await until(() =>
    events.some((e) => e.event === 'sent' && e.request === b.id),
  )
  // c, pointed on disk at b's approval (same bytes, same hash): already used.
  await writeFile(
    join(base, 'gateway', 'requests', `${c.id}.json`),
    JSON.stringify({ ...c.held, approval: b.held.approval }),
  )
  cue(c.id, c.held.hash)
  await Bun.sleep(150)
  expect(received.slice(before)).toEqual([
    'POST /client/v4/zones/abc/dns_records {"n":6}',
  ])
}, 15_000)

test("a person's denial is told, and sends nothing", async () => {
  const { id, held } = await heldWrite('{"n":5}')
  states.set(held.approval!, {
    state: 'denied',
    subject: held.hash,
    by: 'gg.addis.human.sami',
    device: 'mac-1',
  })
  const before = received.length
  cue(id, held.hash)
  await until(() =>
    events.some((e) => e.event === 'decided' && e.request === id),
  )
  await Bun.sleep(50)
  expect(received.length).toBe(before)
  expect(events).toContainEqual({
    event: 'decided',
    request: id,
    decision: 'no',
    by: 'gg.addis.human.sami',
  })
})

test('a record written by anything on the host never sends, even with an approval of its own hash', async () => {
  const before = received.length
  // Forged from scratch: a held record with a consistent hash, and an
  // approval the attacker got for that hash with harmless text.
  const forged = inbox.hold(base, {
    agent: AGENT,
    host: CF,
    method: 'DELETE',
    target: '/client/v4/zones/abc',
    headers: [],
    keys: [],
    body: '',
  })
  states.set('forged', {
    state: 'approved',
    subject: forged.hash,
    by: 'x',
    device: 'd',
  })
  inbox.setApproval(base, forged.id, 'forged')
  cue(forged.id, forged.hash)
  // A real held request, its bytes rewritten on disk with a consistent hash
  // and an approval of the new hash.
  const { id, held } = await heldWrite('{"n":7}')
  const body = Buffer.from('{"evil":1}').toString('base64')
  const rewritten = {
    ...held,
    body,
    hash: inbox.requestHash({ ...held, body }),
  }
  await writeFile(
    join(base, 'gateway', 'requests', `${id}.json`),
    JSON.stringify({ ...rewritten, approval: 'rewritten' }),
  )
  states.set('rewritten', {
    state: 'approved',
    subject: rewritten.hash,
    by: 'x',
    device: 'd',
  })
  cue(id, rewritten.hash)
  await Bun.sleep(200)
  expect(received.length).toBe(before)
})
