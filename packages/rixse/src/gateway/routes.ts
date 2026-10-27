// The gateway's model routes. The VM sends a placeholder; the gateway adds
// the person's long-lived credential on the way out, so nothing in the VM
// ever holds it. The credential comes from the vault's send for the route's
// own host, like any other key: the vault decides, and records each time.
import type { Route } from './egress'
import type { Vault } from './vault'

export const ANTHROPIC = 'https://api.anthropic.com'
/** What the VM sends where a key or token would be. */
export const PLACEHOLDER = 'mirab-placeholder'

/** The base URL a route has in the guest: the gateway's proxy address
 *  there (`proxy`, e.g. http://127.0.0.1:8790), then the route's name. */
export const guestRouteURL = (proxy: string, name: string) => `${proxy}/${name}`

/** `secret` for `upstream`'s host, from the vault's send; a refusal says how
 *  to let it go there. */
function sent(vault: Vault, secret: string, upstream: string) {
  const host = new URL(upstream).hostname
  return () =>
    vault.send(secret, host).catch((e: Error) => {
      throw new Error(
        `${e.message} (to let it: harar hosts allow ${secret} ${host}, or a role's send at a primary)`,
      )
    })
}

/** An API key: `x-api-key`. */
export function anthropicKeyRoute(
  vault: Vault,
  key: string | undefined,
  upstream = ANTHROPIC,
): Route | undefined {
  if (!key) return undefined
  return {
    upstream,
    header: 'x-api-key',
    paths: ['/v1/messages'],
    credential: sent(vault, key, upstream),
  }
}

/** Claude Code on the person's own subscription: its OAuth token
 *  (`claude setup-token`) as `Authorization: Bearer`. */
export function claudeRoute(
  vault: Vault,
  token: string | undefined,
  upstream = ANTHROPIC,
): Route | undefined {
  if (!token) return undefined
  return {
    upstream,
    header: 'authorization',
    format: (credential) => `Bearer ${credential}`,
    paths: ['/v1/messages'],
    credential: sent(vault, token, upstream),
  }
}

/** The host's own Anthropic and Claude settings (keys, tokens, custom
 *  headers, Bedrock or Vertex) never reach a VM that uses the route. */
export function withClaudeRoute(
  env: Record<string, string>,
  proxy: string,
): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE_)/.test(k)),
  )
  return { ...kept, ...claudeGuestEnvironment(proxy) }
}

/** Claude Code's environment in the guest: the placeholder token, the
 *  gateway's route as its API, and nothing else on the network (no
 *  telemetry, error reports or self-updates). Anything else it tries goes
 *  to the gateway as a proxy, where the allow-list decides and the audit
 *  log shows it. `proxy` is the gateway's address in the guest. */
export const claudeGuestEnvironment = (
  proxy: string,
): Record<string, string> => ({
  ANTHROPIC_BASE_URL: guestRouteURL(proxy, 'claude'),
  HTTPS_PROXY: proxy,
  HTTP_PROXY: proxy,
  NO_PROXY: '127.0.0.1,localhost',
  CLAUDE_CODE_OAUTH_TOKEN: PLACEHOLDER,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
})
