// Where keys come from. The gateway never holds a key at rest and never
// decides where one may go: it asks the vault, for one host at a time.
// harar implements this (`import { vault } from 'harar'`); anything with the
// same two answers can stand in.
export interface Vault {
  /** The host patterns `secret` may go to: an exact name, or `*.example.com`
   *  for any name under it (never the name itself). */
  hosts(secret: string): Promise<string[]>
  /** `secret`'s value, for a request to `host` only. The vault decides, and
   *  records the host. */
  send(secret: string, host: string): Promise<string>
}
