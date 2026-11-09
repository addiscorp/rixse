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
  matches is held. A host a key goes to that no rule names gets the safe
  default: reads (GET, HEAD) pass, everything else is held. A host with no
  key and no rule passes as the allow-list lets it.
  An API that changes things on a GET passes under that default: give such a
  host its own rules.
- **Held** calls answer `403` with `{"rixse":{"status":"held","request":"r_…"}}`,
  never a 2xx. `rixse show <id>` shows the whole request, including which header
  gets which key. `rixse decide <id> yes` asks in a terminal, or takes
  `--hash <hash>` from `show`. A yes sends exactly those bytes, once, within 15
  minutes. `secrets[host].approved` names the key an approved send uses.
- **Who can say yes.** With an approver (`gateway({ approver })`, harar's
  `approver({ socket })` on a primary), each held request is put to it, and a
  yes counts only when it says a person approved exactly that request's hash on
  one of their devices (Touch ID, a phone, a passkey), once. `rixse decide <id>
  yes` runs `harar approve` for you. Without an approver, a yes is a file in the
  gateway's config directory: an agent in a VM can't reach it, but an agent
  running on the host as the same OS user could write one, so use an approver
  wherever agents run outside a VM.

## Layout

| path | what |
|---|---|
| `src/` | the gateway (`import { gateway } from 'rixse'`) and the `rixse` CLI, on Bun |
| `pack/` | the publish proof for the npm tarball |

`npm test` runs the gateway's tests and typecheck (Bun) and the publish proof.

## License

[MIT](LICENSE)
