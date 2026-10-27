#!/usr/bin/env bun
// rixse: the person's side of the gateway, in their own terminal, outside
// the VM. JSON by default (one object per line for lists); --human for text.
//
//   rixse requests --config-dir <dir> [--human]
//   rixse decide <id> yes|no --config-dir <dir> [--by <name>] [--human]
//
// A decision is a file the gateway's session watches: a yes is sent at once,
// exactly as it was held, and only once.
import { userInfo } from 'node:os'
import * as inbox from './inbox'

const USAGE = {
  usage: [
    'rixse requests --config-dir <dir> [--human]',
    'rixse decide <id> yes|no --config-dir <dir> [--by <name>] [--human]',
  ],
}

function fail(error: string, code = 2): never {
  process.stderr.write(JSON.stringify({ error, ...USAGE }) + '\n')
  process.exit(code)
}

export function parse(argv: string[]) {
  const flags: Record<string, string | true> = {}
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--human') flags.human = true
    else if (a === '--config-dir' || a === '--by') {
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
  if (command === 'decide') {
    const [id, decision] = args
    if (!id || (decision !== 'yes' && decision !== 'no') || args.length > 2)
      fail('decide takes <id> yes|no')
    const by =
      typeof flags.by === 'string' ? flags.by : `user:${userInfo().username}`
    let a: inbox.Answer
    try {
      a = inbox.decide(configDir, id, decision, by)
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
