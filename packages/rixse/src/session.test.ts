import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { allowSecret, revokeSecret, secretGrants } from './escalations'
import { gateway } from './session'

const AGENT = 'gg.addis.agent.ops'
const guest = {
  proxy: 'http://127.0.0.1:8790',
  caPath: '/usr/local/share/ca-certificates/gateway.crt',
}

test('a VM gets a placeholder only for a secret its agent was allowed and the vault lets go somewhere', async () => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const base = await mkdtemp(join(resolve('.tmp'), 'gateway-'))
  const project = join(base, 'project')
  await mkdir(project)
  await writeFile(
    join(project, '.env'),
    [
      'STRIPE=harar://prod/shop/STRIPE_KEY',
      'NOWHERE=harar://prod/shop/NOWHERE',
      'UNASKED=harar://personal/bank/TOKEN',
      'BROKEN=harar://prod/shop/BROKEN',
    ].join('\n'),
  )
  const asked: string[] = []
  const vault = {
    hosts: async (secret: string) => {
      asked.push(`hosts ${secret}`)
      if (secret === 'prod/shop/BROKEN')
        throw new Error('harar at /h.sock did not answer with an object')
      return secret === 'prod/shop/STRIPE_KEY'
        ? ['api.stripe.com', 'API.bad']
        : []
    },
    send: async () => 'sk-real',
  }
  try {
    for (const s of [
      'prod/shop/STRIPE_KEY',
      'prod/shop/NOWHERE',
      'prod/shop/BROKEN',
    ])
      allowSecret(base, AGENT, s)
    const session = await gateway({
      project,
      vault,
      configDir: base,
      zone: 'gg.addis.zone.vm-test',
      auditLog: join(base, 'egress.log'),
      routes: {},
      allow: [],
      agent: AGENT,
      guest,
    })
    try {
      expect(
        Object.keys(session.env).filter((k) => !/proxy|CERTS/i.test(k)),
      ).toEqual(['STRIPE'])
      expect(session.env.STRIPE).toMatch(/^mirab-ph-[0-9a-f]{24}$/)
      // The guest's view is the runtime's: its proxy address and CA path.
      expect(session.env.HTTPS_PROXY).toBe(guest.proxy)
      expect(session.env.NODE_EXTRA_CA_CERTS).toBe(guest.caPath)
      expect(session.caCert).toContain('BEGIN CERTIFICATE')
      const notes = session.notes.join('\n')
      expect(notes).toContain(`personal/bank/TOKEN, which ${AGENT} hasn't been allowed`)
      expect(notes).toContain('prod/shop/NOWHERE, which the vault lets go nowhere')
      expect(notes).toContain("hosts the gateway can't open, left out: API.bad")
      expect(notes).toContain('BROKEN: harar at')
      // Never asked about the secret this agent wasn't allowed.
      expect(asked.sort()).toEqual([
        'hosts prod/shop/BROKEN',
        'hosts prod/shop/NOWHERE',
        'hosts prod/shop/STRIPE_KEY',
      ])
    } finally {
      await session.close()
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('with no secrets to open, there is no certificate authority and no proxy settings', async () => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const base = await mkdtemp(join(resolve('.tmp'), 'gateway-'))
  try {
    const session = await gateway({
      project: base,
      vault: { hosts: async () => [], send: async () => '' },
      configDir: base,
      zone: 'gg.addis.zone.vm-test',
      auditLog: join(base, 'egress.log'),
      routes: {},
      allow: [],
      agent: AGENT,
      guest,
    })
    expect(session.caCert).toBeUndefined()
    expect(session.env).toEqual({})
    await session.close()
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('secret grants are per agent, only harar paths, and revocable', async () => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const dir = await mkdtemp(join(resolve('.tmp'), 'grants-'))
  try {
    allowSecret(dir, AGENT, 'prod/shop/STRIPE_KEY')
    allowSecret(dir, AGENT, 'prod/shop/STRIPE_KEY')
    expect(secretGrants(dir, AGENT)).toEqual(['prod/shop/STRIPE_KEY'])
    expect(secretGrants(dir, 'gg.addis.agent.other')).toEqual([])
    expect(() => allowSecret(dir, AGENT, '../etc/passwd')).toThrow('path')
    expect(() => allowSecret(dir, AGENT, 'a/../b')).toThrow('path')
    revokeSecret(dir, AGENT, 'prod/shop/STRIPE_KEY')
    expect(secretGrants(dir, AGENT)).toEqual([])
    expect(() => revokeSecret(dir, AGENT, 'prod/shop/STRIPE_KEY')).toThrow(
      "wasn't allowed",
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
