import test from 'node:test'
import assert from 'node:assert/strict'

import { createApprovalListener } from '../lib/index.js'
import { normalizeConfig } from '../lib/policy.mjs'

/** Collect the announcements and the debug lines a listener produces. */
function harness(overrides = {}) {
  const announced = []
  const logs = []
  let clock = 1_000
  const listener = createApprovalListener({
    config: normalizeConfig(overrides.config),
    log: (kind) => logs.push(kind),
    announce: async (payload) => {
      announced.push(payload)
    },
    now: () => clock,
    ...overrides.listener,
  })
  return {
    listener,
    announced,
    logs,
    advance: (ms) => {
      clock += ms
    },
  }
}

test('the approval listener hands the decision back to the chain', async () => {
  const { listener, announced } = harness()
  let called = 0
  const outcome = await listener({ toolName: 'bash' }, async () => {
    called += 1
    return 'allowed-once'
  })
  assert.equal(called, 1)
  assert.equal(outcome, 'allowed-once')
  assert.equal(announced.length, 1)
})

test('a rejected approval still returns the chain outcome', async () => {
  const { listener } = harness()
  assert.equal(await listener({ toolName: 'bash' }, async () => 'rejected'), 'rejected')
})

test('the same call is announced once inside the dedupe window', async () => {
  const { listener, announced, advance } = harness()
  const next = async () => 'allowed-once'
  await listener({ toolName: 'bash', callId: 'call-1' }, next)
  await listener({ toolName: 'bash', callId: 'call-1' }, next)
  assert.equal(announced.length, 1)
  advance(6000)
  await listener({ toolName: 'bash', callId: 'call-1' }, next)
  assert.equal(announced.length, 2)
})

test('different calls are announced independently', async () => {
  const { listener, announced } = harness()
  const next = async () => 'allowed-once'
  await listener({ toolName: 'bash', callId: 'call-1' }, next)
  await listener({ toolName: 'bash', callId: 'call-2' }, next)
  assert.equal(announced.length, 2)
})

test('a failing announcement never breaks the approval chain', async () => {
  const { listener, logs } = harness({
    listener: {
      announce: async () => {
        throw new Error('toast exploded')
      },
    },
  })
  const outcome = await listener({ toolName: 'bash' }, async () => 'allowed-once')
  assert.equal(outcome, 'allowed-once')
  assert.ok(logs.includes('approval-failed'))
})

test('a synchronous throw in announce is contained too', async () => {
  const { listener } = harness({
    listener: {
      announce: () => {
        throw new Error('sync boom')
      },
    },
  })
  // The listener itself must not throw: the approval chain cannot see this plugin.
  assert.doesNotThrow(() => listener({ toolName: 'bash' }, async () => 'rejected'))
})

test('a malformed request still passes the chain through', async () => {
  const { listener } = harness()
  assert.equal(await listener(undefined, async () => 'unavailable'), 'unavailable')
})
