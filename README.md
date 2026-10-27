# rixse

The gateway between an agent's VM, a vault and the internet:
`effect = gateway(agent(state))`.

```ts
import { gateway } from 'rixse'   // Bun
import { vault } from 'harar'

const session = await gateway({ agent, project, vault: vault({ socket }), configDir, config, … })
```

- **Rules** per host, method and path: `apply`, `request` (held for a person) or
  `forbidden` (never approvable). On a host any rule names, a request no rule
  matches is held. A host no rule names is not governed: its requests pass as
  the allow-list and the vault let them.
- **Held** calls answer `403` with `{"rixse":{"status":"held","request":"r_…"}}`,
  never a 2xx. `rixse show <id>` shows the whole request, including which header
  gets which key. `rixse decide <id> yes` asks in a terminal, or takes
  `--hash <hash>` from `show`. A yes sends exactly those bytes, once, within 15
  minutes. `secrets[host].approved` names the key an approved send uses.
- **What it guarantees, and for whom:** an agent in a VM can't reach the
  gateway's config directory, so it can't approve its own requests. An agent
  running on the host as the same OS user can write an answer, so until
  decisions are signed, the guarantee covers VM agents only.

## Layout

| path | what |
|---|---|
| `packages/rixse` | the gateway (`import { gateway } from 'rixse'`) and the `rixse` CLI, on Bun |
| `pack/` | the publish proof for the npm tarball |

`npm test` runs the gateway's tests and typecheck (Bun) and the publish proof.
