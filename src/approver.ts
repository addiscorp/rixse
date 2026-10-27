// Who may say yes. Without an approver, a yes is a file in the gateway's
// config directory: enough for agents in a VM, which can't reach it, but an
// agent on the host as the same OS user could write one. With an approver,
// a yes counts only when the approver says a person approved exactly this
// request on one of their devices (harar: a Secure Enclave key behind Touch
// ID, a phone, a passkey; `import { approver } from 'harar'`). Being logged
// in is never an approval.

export type ApprovalState =
  | { state: 'waiting' }
  | {
      state: 'approved' | 'denied'
      /** What the person's device signed: the held request's hash. */
      subject: string
      /** Who approved, by name, and with which device. */
      by: string
      device: string
    }

export interface Approver {
  /** Asks a person to approve sending one held request; returns the
   *  approval's id. `subject` is the request's hash, what a yes binds to;
   *  `text` is what the device shows. */
  ask(r: {
    class: 'gateway.send'
    agent: string
    subject: string
    text: string
  }): Promise<string>
  /** Where an approval stands, as the approver verified it. */
  check(id: string): Promise<ApprovalState>
}
