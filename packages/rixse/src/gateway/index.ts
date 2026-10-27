// rixse: the gateway between a VM, a vault and the internet.
//
//   import { gateway } from 'rixse'
//
// One session per VM: its only way out. A vault (`import { vault } from
// 'harar'`, or anything with `hosts` and `send`) says where each key may go;
// a runtime (`import { defineAgent } from 'mirab'`) points the VM at it.
export { gateway, type GatewaySession } from './session'
export type { Vault } from './vault'
export type { Effect, GatewayConfig, Rule } from './config'
export {
  decide,
  governs,
  pathProblem,
  ruleProblem,
  type Call,
  type Verdict,
} from './decide'
export type { GatewayEvent } from './events'
export {
  APPROVAL_MS,
  HOLD_MS,
  requests,
  type Answer,
  type Held,
  type Status,
} from './inbox'
export { gatewayBody } from './intercept'
export {
  ANTHROPIC,
  PLACEHOLDER,
  anthropicKeyRoute,
  claudeGuestEnvironment,
  claudeRoute,
  guestRouteURL,
  withClaudeRoute,
} from './routes'
export {
  auditor,
  lookupAll,
  startEgress,
  type Route,
} from './egress'
export { stationAuthority, type StationAuthority } from './ca'
export { domainProblem, allowed, isPublic } from './hosts'
export {
  allow,
  allowPath,
  allowSecret,
  allowedFor,
  asker,
  asks,
  dismiss,
  fileName,
  grants,
  projectAgent,
  readJson,
  revoke,
  revokeSecret,
  secretGrants,
  secretsPath,
  writeJson,
  type Ask,
} from './escalations'
export { type Upstream } from './intercept'
