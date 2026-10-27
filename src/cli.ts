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
import { describe } from './describe'
import * as inbox from './inbox'

const USAGE = {
  usage: [
    'rixse requests --config-dir <dir> [--human]',
    'rixse show <id> --config-dir <dir> [--human]',
    'rixse decide <id> yes|no --config-dir <dir> [--hash <hash>] [--by <name>] [--harar-socket <path>] [--human]',
  ],
}

function fail(error: string, code = 2): never {
  process.stderr.write(JSON.stringify({ error, ...USAGE }) + '\n')
  process.exit(code)
}

const VALUED = new Set(['--config-dir', '--by', '--hash', '--harar-socket'])

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
    // A request the gateway put to an approver is approved on the person's
    // device, where harar asks for Touch ID; the answer below is only the
    // gateway's cue to check with it.
    const held = inbox.held(configDir, id)
    if (decision === 'yes' && held?.approval && held.hash === shown) {
      const socket =
        typeof flags['harar-socket'] === 'string'
          ? ['--socket', flags['harar-socket']]
          : []
      const signed = Bun.spawnSync(
        ['harar', 'approve', held.approval, ...socket],
        { stdio: ['inherit', 'inherit', 'inherit'] },
      )
      if (signed.exitCode !== 0)
        fail(`harar approve ${held.approval} didn't approve it`, 1)
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
