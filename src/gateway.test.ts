// P1 end to end, with real curl as the agent in its VM: a session with
// rules, its way out on a socket, and a stand-in for the real host. A write
// is held with a 403 and never reaches the host; a yes sends exactly the
// held bytes, once, with the approved key; a read inside the rules goes
// through; a forbidden call can't be approved.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as httpsServer } from 'node:https'
import { connect, createServer, type Server } from 'node:net'
import { join, resolve } from 'node:path'
import { stationAuthority } from './ca'
import { allowSecret } from './escalations'
import type { GatewayEvent } from './events'
import * as inbox from './inbox'
import { gateway, type GatewaySession } from './session'

const AGENT = 'gg.addis.agent.dns-fixer'
const CF = 'api.cloudflare.com'
const READ = 'personal/cloudflare/DNS_READ'
const EDIT = 'personal/cloudflare/DNS_EDIT'
const STRIPE = 'prod/shop/STRIPE_KEY'
const REAL: Record<string, string> = {
  [STRIPE]: 'sk_live_real',
  [READ]: 'cf_READ_real',
  [EDIT]: 'cf_EDIT_real',
}

let base: string
let session: GatewaySession
let egress: Server
let bridge: Server
let upstream: ReturnType<typeof httpsServer>
let proxyPort: number
let caPath: string
let placeholder: string
const received: {
  method?: string
  url?: string
  auth: string | null
  body: string
}[] = []
const events: GatewayEvent[] = []
const sends: string[] = []

beforeAll(async () => {
  await mkdir(resolve('.tmp'), { recursive: true })
  base = await mkdtemp(join(resolve('.tmp'), 'p1-'))
  const project = join(base, 'project')
  await mkdir(project)
  await writeFile(
    join(project, '.env'),
    `CLOUDFLARE_API_TOKEN=harar://${READ}\nSTRIPE_KEY=harar://${STRIPE}\n`,
  )
  allowSecret(base, AGENT, READ)
  allowSecret(base, AGENT, EDIT)
  allowSecret(base, AGENT, STRIPE)
  const world = await stationAuthority(join(base, 'world'))
  const leaf = await world.leaf([CF, 'api.stripe.com', 'status.example.com'])
  upstream = httpsServer({ key: leaf.key, cert: leaf.cert }, (req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization ?? null,
        body,
      })
      // A long answer that ends with the key, across the gateway's cut.
      if (req.url?.endsWith('/pad'))
        // 'Bearer ' then the key, which starts 5 bytes before the cut.
        return res.end('x'.repeat(65536 - 12) + req.headers.authorization)
      // A host that echoes the key it got.
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({ success: true, auth: req.headers.authorization }),
      )
    })
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  const port = (upstream.address() as { port: number }).port
  session = await gateway({
    project,
    vault: {
      hosts: async (secret) => [secret === STRIPE ? 'api.stripe.com' : CF],
      send: async (secret) => (sends.push(secret), REAL[secret]),
    },
    configDir: base,
    zone: 'gg.addis.zone.p1-test',
    auditLog: join(base, 'egress.log'),
    routes: {},
    allow: ['status.example.com'],
    agent: AGENT,
    guest: { proxy: 'http://127.0.0.1:1', caPath: '/ca.pem' },
    config: {
      rules: [
        {
          host: CF,
          method: 'GET',
          path: '/client/v4/zones/*',
          effect: 'apply',
        },
        {
          host: CF,
          method: 'POST',
          path: '/client/v4/zones/*',
          effect: 'request',
        },
        { host: CF, path: '/client/v4/accounts/*', effect: 'forbidden' },
        { host: 'status.example.com', method: 'GET', effect: 'apply' },
        { host: 'nowhere.example.com', method: 'GET', effect: 'apply' },
      ],
      // A wildcard listed first never shadows the exact entry.
      secrets: {
        '*.cloudflare.com': { agent: READ, approved: READ },
        [CF]: { agent: READ, approved: EDIT },
      },
    },
    upstream: async () => ({ address: '127.0.0.1', port, ca: world.cert }),
  })
  placeholder = session.env.CLOUDFLARE_API_TOKEN
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

async function curl(args: string[]) {
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
      '-w',
      '\n%{http_code}',
      ...args,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [out, code] = await Promise.all([
    new Response(p.stdout).text(),
    p.exited,
  ])
  const at = out.lastIndexOf('\n')
  return { code, body: out.slice(0, at), status: Number(out.slice(at + 1)) }
}
const bearer = () => ['-H', `Authorization: Bearer ${placeholder}`]
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(10)
}
const DNS = `https://${CF}/client/v4/zones/abc/dns_records`
const RECORD = '{"type":"CNAME","name":"guard","content":"addis.org"}'

test('a read inside the rules goes through, with the agent key', async () => {
  const before = received.length
  const r = await curl([...bearer(), DNS])
  expect(r.status).toBe(200)
  expect(received.length).toBe(before + 1)
  expect(received.at(-1)!.auth).toBe('Bearer cf_READ_real')
  // The echoed key comes back as the placeholder.
  expect(r.body).not.toContain('cf_READ_real')
})

test('a write is held with a 403 naming the request, and never reaches the host', async () => {
  const before = received.length
  const r = await curl([
    ...bearer(),
    '-X',
    'POST',
    '-H',
    'content-type: application/json',
    '-d',
    RECORD,
    DNS,
  ])
  expect(r.status).toBe(403)
  const body = JSON.parse(r.body)
  expect(body.rixse.status).toBe('held')
  expect(body.rixse.request).toMatch(/^r_[0-9a-f]{12}$/)
  expect(received.length).toBe(before)
  const held = inbox.held(base, body.rixse.request)!
  expect(held.agent).toBe(AGENT)
  expect(Buffer.from(held.body, 'base64').toString()).toBe(RECORD)
  // Held with its placeholder, never a key.
  expect(JSON.stringify(held)).not.toContain('cf_')
  expect(
    events.some((e) => e.event === 'held' && e.request.id === held.id),
  ).toBe(true)
})

test('a yes sends exactly the held bytes, once, with the approved key', async () => {
  const r = await curl([...bearer(), '-X', 'POST', '-d', RECORD, DNS])
  const id = JSON.parse(r.body).rixse.request
  const before = received.length
  // What the person is shown: which header gets which key on a yes.
  const shown = inbox.held(base, id)!
  expect(shown.keys).toEqual([
    { header: 'Authorization', secret: READ, approved: EDIT },
  ])
  // A yes for anything but what was shown is refused.
  expect(() =>
    inbox.decide(base, id, 'yes', 'gg.addis.human.sami', 'f'.repeat(64)),
  ).toThrow("isn't what was shown")
  expect(() => inbox.decide(base, id, 'yes', 'gg.addis.human.sami')).toThrow(
    "isn't what was shown",
  )
  // As `rixse decide` in the person's terminal: a file the session watches.
  inbox.decide(base, id, 'yes', 'gg.addis.human.sami', shown.hash)
  await until(() => events.some((e) => e.event === 'sent' && e.request === id))
  expect(received.length).toBe(before + 1)
  const got = received.at(-1)!
  expect(got.method).toBe('POST')
  expect(got.url).toBe('/client/v4/zones/abc/dns_records')
  expect(got.body).toBe(RECORD)
  expect(got.auth).toBe('Bearer cf_EDIT_real')
  const sent = events.find((e) => e.event === 'sent' && e.request === id)
  expect(sent).toMatchObject({ status: 200 })
  // The approved key went out, and never comes back to the agent.
  expect(JSON.stringify(sent)).not.toContain('cf_EDIT_real')
  expect(events).toContainEqual({
    event: 'decided',
    request: id,
    decision: 'yes',
    by: 'gg.addis.human.sami',
  })
  // Used once: no second answer, no second send.
  expect(() =>
    inbox.decide(base, id, 'yes', 'gg.addis.human.sami', shown.hash),
  ).toThrow('is sent')
  await session.decide(id, 'yes', 'x', shown.hash).catch(() => {})
  // Even a second yes written straight to disk is never sent again.
  const answer = inbox.answer(base, id)!
  await writeFile(
    join(base, 'gateway', 'answers', `${id}.json`),
    JSON.stringify({ ...answer, at: new Date().toISOString() }),
  )
  await Bun.sleep(150)
  expect(received.length).toBe(before + 1)
  const log = await readFile(join(base, 'egress.log'), 'utf8')
  expect(log).toContain(`"request":"${id}"`)
  expect(log).not.toContain('cf_EDIT_real')
})

test('a no sends nothing, and is told', async () => {
  const r = await curl([...bearer(), '-X', 'POST', '-d', RECORD, DNS])
  const id = JSON.parse(r.body).rixse.request
  const before = received.length
  await session.decide(id, 'no', 'gg.addis.human.sami')
  await until(() =>
    events.some((e) => e.event === 'decided' && e.request === id),
  )
  await Bun.sleep(50)
  expect(received.length).toBe(before)
  expect(inbox.status(base, inbox.held(base, id)!)).toBe('declined')
})

test('a forbidden call is denied, never held, so it can never be approved', async () => {
  const before = inbox.requests(base).length
  const r = await curl([
    ...bearer(),
    '-X',
    'DELETE',
    `https://${CF}/client/v4/accounts/1/tokens/2`,
  ])
  expect(r.status).toBe(403)
  expect(JSON.parse(r.body).rixse.status).toBe('denied')
  expect(inbox.requests(base).length).toBe(before)
})

test('a path the host could read as another is refused before any rule', async () => {
  const before = received.length
  const r = await curl([
    ...bearer(),
    '--path-as-is',
    `https://${CF}/client/v4/zones/../accounts/1`,
  ])
  expect(r.status).toBe(400)
  expect(received.length).toBe(before)
})

test('a yes for bytes changed on disk, or given too long ago, sends nothing', async () => {
  const a = JSON.parse(
    (await curl([...bearer(), '-X', 'POST', '-d', RECORD, DNS])).body,
  ).rixse.request
  const b = JSON.parse(
    (await curl([...bearer(), '-X', 'POST', '-d', RECORD, DNS])).body,
  ).rixse.request
  const before = received.length
  // a: its body swapped for another after it was held.
  const path = join(base, 'gateway', 'requests', `${a}.json`)
  const held = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(
    path,
    JSON.stringify({
      ...held,
      body: Buffer.from('{"evil":1}').toString('base64'),
    }),
  )
  expect(() => inbox.decide(base, a, 'yes', 'gg.addis.human.sami')).toThrow(
    'no held request',
  )
  // b: a yes from before APPROVAL_MS, written as if long ago.
  const r = inbox.held(base, b)!
  await writeFile(
    join(base, 'gateway', 'answers', `${b}.json`),
    JSON.stringify({
      id: b,
      hash: r.hash,
      decision: 'yes',
      by: 'x',
      at: new Date(Date.now() - inbox.APPROVAL_MS - 1000).toISOString(),
    }),
  )
  await Bun.sleep(150)
  expect(received.length).toBe(before)
})

test('a governed host without a key is opened only when the allow-list lets it', async () => {
  const listed = await curl(['https://status.example.com/'])
  expect(listed.status).toBe(200)
  const unlisted = await curl(['https://nowhere.example.com/'])
  expect(unlisted.code).not.toBe(0)
})

test('a % or ; in the path, or a method or URL override header, is refused before any rule', async () => {
  const before = received.length
  for (const path of ['/%61dmin/users', '/client/v4/zones/..;/accounts/1']) {
    const r = await curl([...bearer(), '--path-as-is', `https://${CF}${path}`])
    expect(r.status).toBe(400)
  }
  for (const header of [
    'X-HTTP-Method-Override: DELETE',
    'X-Original-URL: /client/v4/accounts/1',
  ]) {
    const r = await curl([...bearer(), '-H', header, DNS])
    expect(r.status).toBe(400)
  }
  expect(received.length).toBe(before)
})

test('an answer is cut only after the key is taken out of it', async () => {
  const r = await curl([
    ...bearer(),
    '-X',
    'POST',
    '-d',
    '{}',
    `https://${CF}/client/v4/zones/abc/pad`,
  ])
  const id = JSON.parse(r.body).rixse.request
  await session.decide(
    id,
    'yes',
    'gg.addis.human.sami',
    inbox.held(base, id)!.hash,
  )
  await until(() => events.some((e) => e.event === 'sent' && e.request === id))
  const sent = events.find((e) => e.event === 'sent' && e.request === id) as {
    body: string
  }
  expect(sent.body.length).toBeLessThanOrEqual(65536)
  expect(sent.body).not.toContain('cf_E')
  expect(sent.body.endsWith('Bearer mirab')).toBe(true)
})

test('a host a key goes to, with no rule: a read passes with the key, a write is held', async () => {
  const stripe = ['-H', `Authorization: Bearer ${session.env.STRIPE_KEY}`]
  const before = received.length
  const read = await curl([...stripe, 'https://api.stripe.com/v1/charges'])
  expect(read.status).toBe(200)
  expect(received.at(-1)!.auth).toBe('Bearer sk_live_real')
  const write = await curl([
    ...stripe,
    '-X',
    'POST',
    '-d',
    'amount=1',
    'https://api.stripe.com/v1/charges',
  ])
  expect(write.status).toBe(403)
  expect(JSON.parse(write.body).rixse.status).toBe('held')
  expect(received.length).toBe(before + 1)
})
