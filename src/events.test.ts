import { expect, test } from 'bun:test'
import { Events, MAX_QUEUED, type GatewayEvent } from './events'

const denied = (n: number): GatewayEvent => ({
  event: 'denied',
  host: 'h.test',
  method: 'GET',
  target: `/${n}`,
  rule: 'r',
})

test('a reader that falls behind keeps only the newest MAX_QUEUED events', async () => {
  const events = new Events()
  const reader = events[Symbol.asyncIterator]()
  const first = reader.next() // starts reading, then stops
  for (let i = 0; i <= MAX_QUEUED + 10; i++) events.emit(denied(i))
  events.close()
  const got: GatewayEvent[] = [(await first).value]
  for (let r = await reader.next(); !r.done; r = await reader.next())
    got.push(r.value)
  expect(got.length).toBeLessThanOrEqual(MAX_QUEUED + 1)
  expect(got.at(-1)).toEqual(denied(MAX_QUEUED + 10))
})
