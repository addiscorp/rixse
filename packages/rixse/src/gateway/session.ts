// One session of the gateway: a VM's only way out. Its allow-list, its model
// routes and, when the project's .env names secrets the person let this
// agent use and the vault lets go somewhere, the hosts it opens to swap
// placeholders for keys. The vault decides each send, and records the host.
//
// The gateway knows nothing about VMs: a runtime (mirab) maps the guest's
// egress port to `listen(socketPath)`, installs `caCert` in the guest at
// `guest.caPath`, and passes `env` to the guest's programs.
import { readFile } from 'node:fs/promises'
import type { Server } from 'node:net'
import { join } from 'node:path'
import { stationAuthority } from './ca'
import { auditor, lookupAll, startEgress, type Route } from './egress'
import { asker, grants, secretGrants } from './escalations'
import { domainProblem } from './hosts'
import { startIntercept, type Intercept, type Upstream } from './intercept'
import { Placeholders, referencesIn, type Secrets } from './secrets'
import type { Vault } from './vault'

/** How long a secret's value for a host is kept before the vault is asked again. */
const VALUE_TTL_MS = 60_000
const MAX_VALUES = 64

export interface GatewaySession {
  /** What the guest's programs get: a placeholder per secret, and the gateway as their proxy. */
  env: Record<string, string>
  /** Things the person should know (a reference the vault lets go nowhere). */
  notes: string[]
  /** The gateway's certificate authority (PEM), when it opens HTTPS for
   *  keys: the guest must trust it, at `guest.caPath`. */
  caCert?: string
  /** Serves the VM's way out on `socketPath` (the runtime maps the guest's
   *  egress port to it). */
  listen(socketPath: string): Promise<Server>
  close(): Promise<void>
}

/** The gateway for one session: `import { gateway } from 'rixse'`. */
export async function gateway(o: {
  project: string
  vault: Vault
  /** Where the gateway keeps grants, asks and its certificate authority. */
  configDir: string
  zone: string
  auditLog: string
  routes: Record<string, Route>
  allow: string[]
  /** Whose escalations these are: the agent's harar name, or `project:<path>`. */
  agent: string
  /** The guest's view: the gateway's proxy address there, and where the
   *  runtime puts `caCert`. */
  guest: { proxy: string; caPath: string }
  /** Tests point the hosts the gateway opens at a local stand-in. */
  upstream?: (host: string) => Promise<Upstream>
}): Promise<GatewaySession> {
  const text = await readFile(join(o.project, '.env'), 'utf8').catch(() => '')
  const references = referencesIn(text)
  const placeholders = new Placeholders()
  const secrets: Secrets = Object.create(null)
  const env: Record<string, string> = {}
  const notes: string[] = []
  // Only the secrets the person let this agent use; then, all at once, where
  // harar lets each go.
  const allowedSecrets = new Set(secretGrants(o.configDir, o.agent))
  const wanted = [...references].filter(([name, secret]) => {
    if (allowedSecrets.has(secret)) return true
    notes.push(
      `${name} names harar://${secret}, which ${o.agent} hasn't been allowed to use (outside the VM); the VM doesn't get it`,
    )
    return false
  })
  const answers = await Promise.all(
    wanted.map(([, secret]) =>
      o.vault.hosts(secret).then(
        (hosts) => ({ hosts }),
        (e: Error) => ({ error: e.message }),
      ),
    ),
  )
  wanted.forEach(([name, secret], i) => {
    const answer = answers[i]
    if ('error' in answer) {
      notes.push(`${name}: ${answer.error}; the VM doesn't get it`)
      return
    }
    // Only names the gateway can open; harar holds to the same rule.
    const hosts = answer.hosts.filter(
      (h) => !domainProblem(h.replace(/^\*\./, '')),
    )
    if (hosts.length < answer.hosts.length)
      notes.push(
        `${name}: the vault named hosts the gateway can't open, left out: ${answer.hosts.filter((h) => !hosts.includes(h)).join(', ')}`,
      )
    if (!hosts.length) {
      notes.push(
        `${name} names harar://${secret}, which the vault lets go nowhere the gateway can open (harar hosts allow ${secret} <host>, or a role's send at a primary); the VM doesn't get it`,
      )
      return
    }
    secrets[secret] = { hosts }
    env[name] = placeholders.for(secret)
  })
  // Each secret is asked for, for one host, at most every VALUE_TTL_MS: a
  // rotated key or a revoked host is picked up within that, and harar
  // records each send it answers. A failure is not kept, and the cache never
  // holds more than MAX_VALUES, so names under a `*.` can't grow it.
  const values = new Map<string, { value: Promise<string>; until: number }>()
  const value = (secret: string, host: string) => {
    const key = `${secret}\n${host}`
    const held = values.get(key)
    if (held && held.until > Date.now()) return held.value
    values.delete(key)
    while (values.size >= MAX_VALUES) values.delete(values.keys().next().value!)
    const v = o.vault.send(secret, host)
    // A failure goes, but only if nothing newer took its place.
    v.catch(() => {
      if (values.get(key)?.value === v) values.delete(key)
    })
    values.set(key, { value: v, until: Date.now() + VALUE_TTL_MS })
    return v
  }
  const audit = auditor(o.zone, o.auditLog)
  let intercept: Intercept | undefined
  let authority: Awaited<ReturnType<typeof stationAuthority>> | undefined
  if (placeholders.size) {
    authority = await stationAuthority(join(o.configDir, 'station-ca'))
    intercept = await startIntercept({
      secrets,
      placeholders,
      value,
      authority,
      audit,
      resolve: lookupAll,
      upstream: o.upstream,
    })
    const proxy = o.guest.proxy
    Object.assign(env, {
      HTTPS_PROXY: proxy,
      HTTP_PROXY: proxy,
      https_proxy: proxy,
      http_proxy: proxy,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      NODE_EXTRA_CA_CERTS: o.guest.caPath,
    })
  }
  // Escalation: asks recorded sparingly, grants read when they change.
  const asked = asker(o.configDir, o.agent)
  const granted = grants(o.configDir, o.agent)
  return {
    env,
    notes,
    caCert: authority?.cert,
    listen: (socketPath) =>
      startEgress({
        socketPath,
        zone: o.zone,
        allow: o.allow,
        routes: o.routes,
        auditLog: o.auditLog,
        intercept,
        granted,
        asked,
      }),
    close: async () => intercept?.close(),
  }
}
