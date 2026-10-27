// A held request as text, the same wherever a person is shown it: the
// CLI's `show` and `decide`, and what an approver's device displays.
import type { Held } from './inbox'
import { PLACEHOLDER } from './secrets'

/** A held request as a person reads it: every header, each placeholder
 *  named by its secret and the key a yes sends in its place, and the body. */
export function describe(r: Held & { status?: string }): string {
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
  if (r.approval)
    lines.push(
      `approval: ${r.approval} (on your device: harar approve ${r.approval})`,
    )
  return lines.join('\n') + '\n'
}
