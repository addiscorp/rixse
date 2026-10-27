// Held requests and the answers to them, as files in the gateway's config
// directory, like escalations: the gateway writes a request once and only
// reads answers; a person's `rixse decide` (or a runtime's chat, through the
// session) writes the answer. Nothing in the VM can reach any of it.
//
//   requests/<id>.json   what was held: the exact bytes, with placeholders
//   answers/<id>.json    yes or no, by whom, when
//   sent/<id>.json       the gateway sent it (once): the host's status
//
// An answer binds to one request by its id and the hash of its bytes; a yes
// counts only within APPROVAL_MS of being given and for a request held no
// longer than HOLD_MS; `sent/` makes it single-use.
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './escalations'

/** How long a held request waits for an answer. */
export const HOLD_MS = 60 * 60_000
/** How long a yes stays good before the gateway sends. */
export const APPROVAL_MS = 15 * 60_000
/** Requests one agent may have waiting at once; past that, the VM is told no. */
export const MAX_WAITING = 32

export interface Held {
  id: string
  agent: string
  at: string
  host: string
  method: string
  /** The request target as sent: path and query. */
  target: string
  /** [name, value, ...], placeholders as the VM sent them, no one-hop headers. */
  headers: string[]
  /** The body, base64. */
  body: string
  /** Each header carrying a placeholder: the secret the VM's placeholder
   *  stands for, and the key an approved send puts there instead. */
  keys: { header: string; secret: string; approved?: string }[]
  /** sha256 over method, host, target, headers, keys and body: what a yes
   *  binds to, and what a person was shown. */
  hash: string
  rule?: string
}

export interface Answer {
  id: string
  hash: string
  decision: 'yes' | 'no'
  by: string
  at: string
}

export interface Sent {
  id: string
  at: string
  status: number | string
}

export function requestHash(
  r: Pick<Held, 'method' | 'host' | 'target' | 'headers' | 'keys' | 'body'>,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([r.method, r.host, r.target, r.headers, r.keys, r.body]),
    )
    .digest('hex')
}

const ID = /^r_[0-9a-f]{12}$/
const file = (configDir: string, kind: string, id: string) =>
  join(configDir, 'gateway', kind, `${id}.json`)

export const answersDir = (configDir: string) =>
  join(configDir, 'gateway', 'answers')

/** Holds a request; its id is new and random. Clears the agent's requests
 *  past any use first, and refuses past MAX_WAITING still waiting. */
export function hold(
  configDir: string,
  r: Omit<Held, 'id' | 'at' | 'hash'>,
  now = new Date(),
): Held {
  prune(configDir, r.agent, now.getTime())
  const waiting = requests(configDir, now.getTime()).filter(
    (q) => q.agent === r.agent && q.status === 'held',
  ).length
  if (waiting >= MAX_WAITING)
    throw new Error(
      `${waiting} requests are already waiting for a person; answer those first`,
    )
  const id = `r_${randomBytes(6).toString('hex')}`
  const held: Held = { id, at: now.toISOString(), hash: requestHash(r), ...r }
  writeJson(file(configDir, 'requests', id), held)
  return held
}

export function held(configDir: string, id: string): Held | undefined {
  if (!ID.test(id)) return undefined
  const r = readJson<Held | undefined>(
    file(configDir, 'requests', id),
    undefined,
  )
  // A request whose bytes no longer hash to what it says was changed on disk.
  return r && r.id === id && r.hash === requestHash(r) ? r : undefined
}

export function answer(configDir: string, id: string): Answer | undefined {
  if (!ID.test(id)) return undefined
  return readJson<Answer | undefined>(file(configDir, 'answers', id), undefined)
}

export function sent(configDir: string, id: string): Sent | undefined {
  if (!ID.test(id)) return undefined
  return readJson<Sent | undefined>(file(configDir, 'sent', id), undefined)
}

/** Takes the one right to send `id`: true for exactly one caller, in any
 *  process, ever (an exclusive create), so a yes is used once. */
export function claim(configDir: string, id: string): boolean {
  if (!ID.test(id)) return false
  const dir = join(configDir, 'gateway', 'sent')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    closeSync(openSync(join(dir, `${id}.claim`), 'wx', 0o600))
    return true
  } catch {
    return false
  }
}

export function markSent(configDir: string, s: Sent) {
  writeJson(file(configDir, 'sent', s.id), s)
}

export type Status = 'held' | 'approved' | 'declined' | 'sent' | 'expired'

export function status(configDir: string, r: Held, now = Date.now()): Status {
  if (existsSync(join(configDir, 'gateway', 'sent', `${r.id}.claim`)))
    return 'sent'
  const a = answer(configDir, r.id)
  if (a?.decision === 'no') return 'declined'
  if (a?.decision === 'yes' && a.hash === r.hash) return 'approved'
  return now - Date.parse(r.at) > HOLD_MS ? 'expired' : 'held'
}

/** Every held request, newest first, with where it stands. */
export function requests(configDir: string, now = Date.now()) {
  let names: string[] = []
  try {
    names = readdirSync(join(configDir, 'gateway', 'requests'))
  } catch {
    return []
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => held(configDir, n.slice(0, -'.json'.length)))
    .filter((r): r is Held => !!r)
    .map((r) => ({ ...r, status: status(configDir, r, now) }))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** Removes `agent`'s requests too old for any answer to send, with their
 *  answers and marks: the log keeps the record. */
export function prune(configDir: string, agent: string, now = Date.now()) {
  for (const r of requests(configDir, now)) {
    if (r.agent !== agent || now - Date.parse(r.at) <= HOLD_MS + APPROVAL_MS)
      continue
    for (const [kind, name] of [
      ['requests', `${r.id}.json`],
      ['answers', `${r.id}.json`],
      ['sent', `${r.id}.json`],
      ['sent', `${r.id}.claim`],
    ])
      rmSync(join(configDir, 'gateway', kind, name), { force: true })
  }
}

/**
 * A person's answer to one held request; refused unless it is still waiting.
 * A yes names the hash of what the person was shown (`rixse show`), and is
 * refused if the request is not exactly that.
 */
export function decide(
  configDir: string,
  id: string,
  decision: 'yes' | 'no',
  by: string,
  shown?: string,
  now = new Date(),
): Answer {
  const r = held(configDir, id)
  if (!r) throw new Error(`no held request ${id}`)
  if (decision === 'yes' && shown !== r.hash)
    throw new Error(
      `${id} isn't what was shown: approve the hash \`rixse show ${id}\` prints`,
    )
  const s = status(configDir, r, now.getTime())
  if (s !== 'held') throw new Error(`${id} is ${s}, not waiting for an answer`)
  const a: Answer = { id, hash: r.hash, decision, by, at: now.toISOString() }
  writeJson(file(configDir, 'answers', id), a)
  return a
}

/** Whether the gateway may send `r` now: a yes for exactly these bytes,
 *  given in time, for a request held in time, never sent before. */
export function sendable(
  configDir: string,
  r: Held,
  now = Date.now(),
): Answer | undefined {
  const a = answer(configDir, r.id)
  if (!a || a.decision !== 'yes' || a.hash !== r.hash) return undefined
  if (existsSync(join(configDir, 'gateway', 'sent', `${r.id}.claim`)))
    return undefined
  if (now - Date.parse(a.at) > APPROVAL_MS) return undefined
  if (Date.parse(a.at) - Date.parse(r.at) > HOLD_MS) return undefined
  return a
}
