// What a session tells its runtime, as it happens: a request held for a
// person, the answer, what the host said when the gateway sent it, and a
// call the rules forbid. JSON lines on the wire; a runtime shows them where
// the person is (mirab's dev chat) and passes them to the agent.
import type { Held } from './inbox'

export type GatewayEvent =
  | { event: 'held'; request: Held }
  /** The approver was asked: approve on a device (`harar approve <approval>`). */
  | { event: 'asked'; request: string; approval: string }
  | {
      event: 'decided'
      request: string
      decision: 'yes' | 'no'
      by: string
    }
  | {
      event: 'sent'
      request: string
      /** The host's status, or why it couldn't be sent. */
      status: number | string
      /** The answer's start, every real key put back to its placeholder. */
      body?: string
    }
  | {
      event: 'denied'
      host: string
      method: string
      target: string
      rule: string
    }

/** Events a reader may fall behind by; past that its oldest are dropped,
 *  so a reader that stops reading can't grow the gateway without bound. */
export const MAX_QUEUED = 1000

/** A stream of events for any number of readers; each sees what happens
 *  after it starts reading. Ends when the session closes. */
export class Events implements AsyncIterable<GatewayEvent> {
  private readonly readers = new Set<(e: GatewayEvent | undefined) => void>()
  private closed = false

  emit(e: GatewayEvent) {
    for (const r of this.readers) r(e)
  }

  close() {
    this.closed = true
    for (const r of this.readers) r(undefined)
  }

  async *[Symbol.asyncIterator](): AsyncIterator<GatewayEvent> {
    if (this.closed) return
    const queue: (GatewayEvent | undefined)[] = []
    let wake: (() => void) | undefined
    const reader = (e: GatewayEvent | undefined) => {
      if (e !== undefined && queue.length >= MAX_QUEUED) queue.shift()
      queue.push(e)
      wake?.()
    }
    this.readers.add(reader)
    try {
      for (;;) {
        if (!queue.length) await new Promise<void>((r) => (wake = r))
        wake = undefined
        const e = queue.shift()
        if (e === undefined) return
        yield e
      }
    } finally {
      this.readers.delete(reader)
    }
  }
}
