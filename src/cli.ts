#!/usr/bin/env bun
// rixse: the person's side of the gateway, in their own terminal, outside
// the VM. JSON by default (one object per line for lists); --human for text.
//
//   rixse requests --config-dir <dir> [--human]
//   rixse show <id> --config-dir <dir> [--human]
//   rixse decide <id> yes|no --config-dir <dir> [--hash <hash>] [--by <name>]
//
// A yes is for exactly what was shown: in a terminal, `decide` shows the
// whole request and asks; anywhere else it needs the hash `show` printed.
// The session watches answers: a yes is sent at once, as held, and once.
//
// What this does not stop: anything running as the person's own user can
// write an answer too. The guarantee is for agents in a VM, which can't
// reach the config directory; an agent on the host itself can approve its
// own request until decisions are signed.
import { userInfo } from 'node:os'
import * as inbox from './inbox'
import { PLACEHOLDER } from './secrets'

const USAGE = {
  usage: [
    'rixse requests --config-dir <dir> [--human]',
    'rixse show <id> --config-dir <dir> [--human]',
    'rixse decide <id> yes|no --config-dir <dir> [--hash <hash>] [--by <name>] [--human]',
  ],
}

function fail(error: string, code = 2): never {
  process.stderr.write(JSON.stringify({ error, ...USAGE }) + '\n')
  process.exit(code)
}

const VALUED = new Set(['--config-dir', '--by', '--hash'])

export function parse(argv: string[]) {
  const flags: Record<string, string | true> = {}
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--human') flags.human = true
    else if (VALUED.has(a)) {
      const v = argv[++i]
      if (!v) fail(`${a} takes a value`)
      flags[a.slice(2)] = v
    } else if (a.startsWith('--')) fail(`unknown flag ${a}`)
    else rest.push(a)
  }
  return { flags, rest }
}

/** A held request as a person reads it: every header, each placeholder
 *  named by its secret and the key a yes sends in its place, and the body. */
export function describe(r: inbox.Held & { status?: string }): string {
  // Each placeholder in a header, in order, by the secret the hold recorded
  // for that header; Basic credentials stay encoded, and are listed below.
  const named = (header: string, text: string) => {
    const secrets = r.keys.filter((k) => k.header === header)
    let n = 0
    return text.replace(PLACEHOLDER, () => {
      const k = secrets[Math.min(n++, secrets.length - 1)]
      return k ? `‹harar://${k.approved ?? k.secret}›` : '‹placeholder›'
    })
  }
  const lines = [
    `${r.id}  ${r.status ?? ''}  held ${r.at}  agent ${r.agent}`,
    `rule: ${r.rule ?? 'none matched'}`,
    '',
    `${r.method} https://${r.host}${r.target}`,
  ]
  for (let i = 0; i + 1 < r.headers.length; i += 2)
    lines.push(`${r.headers[i]}: ${named(r.headers[i], r.headers[i + 1])}`)
  lines.push('')
  if (r.keys.length) {
    lines.push('keys swapped in on a yes:')
    for (const k of r.keys)
      lines.push(
        `  ${k.header}: harar://${k.approved ?? k.secret}${k.approved ? ` (in place of the agent's harar://${k.secret})` : ''}`,
      )
  } else lines.push('keys swapped in on a yes: none')
  const body = Buffer.from(r.body, 'base64')
  const text = body.toString('utf8')
  const printable = !/[\u0000-\u0008\u000e-\u001f�]/.test(text)
  lines.push('', `body (${body.length} bytes${printable ? '' : ', base64'}):`)
  lines.push(printable ? text : r.body, '', `hash: ${r.hash}`)
  return lines.join('\n') + '\n'
}

export function main(
  argv: string[],
  out = (s: string) => void process.stdout.write(s),
) {
  const { flags, rest } = parse(argv)
  const [command, ...args] = rest
  if (!command || command === 'help') return out(JSON.stringify(USAGE) + '\n')
  const configDir = flags['config-dir']
  if (typeof configDir !== 'string') fail('--config-dir is required')
  const human = flags.human === true
  if (command === 'requests') {
    if (args.length) fail('requests takes no arguments')
    const list = inbox.requests(configDir)
    if (!human) {
      for (const { headers: _, body, ...r } of list)
        out(
          JSON.stringify({ ...r, bytes: Buffer.from(body, 'base64').length }) +
            '\n',
        )
      return
    }
    if (!list.length) return out('nothing held\n')
    for (const r of list)
      out(
        `${r.id}  ${r.status.padEnd(8)}  ${r.agent}  ${r.method} ${r.host}${r.target}  ${r.at}\n`,
      )
    return
  }
  if (command === 'show') {
    const [id] = args
    if (!id || args.length > 1) fail('show takes <id>')
    const r = inbox.held(configDir, id)
    if (!r) fail(`no held request ${id}`, 1)
    const full = { ...r, status: inbox.status(configDir, r) }
    return out(human ? describe(full) : JSON.stringify(full) + '\n')
  }
  if (command === 'decide') {
    const [id, decision] = args
    if (!id || (decision !== 'yes' && decision !== 'no') || args.length > 2)
      fail('decide takes <id> yes|no')
    const by =
      typeof flags.by === 'string' ? flags.by : `user:${userInfo().username}`
    let shown = typeof flags.hash === 'string' ? flags.hash : undefined
    if (decision === 'yes' && shown === undefined) {
      if (!process.stdin.isTTY)
        fail(
          `approving needs a terminal, or --hash with the hash \`rixse show ${id}\` prints`,
        )
      const r = inbox.held(configDir, id)
      if (!r) fail(`no held request ${id}`, 1)
      process.stdout.write(
        describe({ ...r, status: inbox.status(configDir, r) }),
      )
      if (prompt('Send exactly this? Type yes:')?.trim() !== 'yes')
        fail('not approved', 1)
      shown = r.hash
    }
    let a: inbox.Answer
    try {
      a = inbox.decide(configDir, id, decision, by, shown)
    } catch (e) {
      fail((e as Error).message, 1)
    }
    return out(
      human
        ? `${a.id}: ${a.decision === 'yes' ? 'approved; the gateway sends it once' : 'declined'}\n`
        : JSON.stringify(a) + '\n',
    )
  }
  fail(`unknown command ${command}`)
}

if (import.meta.main) main(process.argv.slice(2))
