// A profile's `gateway` section (in mirab: `gateway: { rules, secrets }`).
//
// A host any rule names is governed; each of its requests is decided
// (decide.ts):
//   1. a matching `forbidden` wins outright, and is never approvable;
//   2. otherwise the most specific matching rule: the longer path first (an
//      exact path over a `/*` prefix of the same length), then a method over
//      `*`, then an exact host over `*.`; a tie goes to `request`;
//   3. no matching rule: `request` (held for a person).
// A host a key is swapped in for that no rule names gets the defaults:
// GET and HEAD apply, everything else is held. A host with no key and no
// rule passes as the allow-list lets it.

/** What one rule says about the calls it matches. */
export type Effect = 'apply' | 'request' | 'forbidden'

export interface Rule {
  host: string
  /** `GET`, `POST`, …, or `*`. */
  method?: string
  /** An exact path, or `/a/*` for `/a` and every path under it (whole
   *  segments: never `/ab`); none or `/*` is every path. */
  path?: string
  effect: Effect
}

export interface GatewayConfig {
  rules?: Rule[]
  /** For each host: the vault secret the agent's calls use, and optionally a
   *  separate one used only for approved sends, so a read key can't write. */
  secrets?: Record<string, { agent: string; approved?: string }>
}
