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
