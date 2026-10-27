// A profile's `gateway` section (in mirab: `gateway: { rules, secrets }`).
// The shape is fixed now so P1 can fill it in without breaking anyone.

/** What one rule says about the calls it matches. Precedence: `forbidden`
 *  beats `request` beats `apply`; the more specific rule wins; no rule means
 *  `request`; a `forbidden` is never approvable. */
export type Effect = 'apply' | 'request' | 'forbidden'

export interface Rule {
  host: string
  /** `GET`, `POST`, …, or `*`. */
  method?: string
  /** A path, or a prefix ending in `*`. */
  path?: string
  effect: Effect
}

export interface GatewayConfig {
  rules?: Rule[]
  /** For each host: the vault secret the agent's calls use, and optionally a
   *  separate one used only for approved sends, so a read key can't write. */
  secrets?: Record<string, { agent: string; approved?: string }>
}
