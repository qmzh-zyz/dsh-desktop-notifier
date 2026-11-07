import test from 'node:test'
import assert from 'node:assert/strict'

import * as plugin from '../lib/index.js'

/**
 * The smallest Cordis context this plugin touches: `on`, `effect`, `logger`.
 * Nothing here spawns anything, so a wired-up mount stays silent.
 */
function fakeContext() {
  const handlers = new Map()
  const disposers = []
  return {
    handlers,
    disposers,
    on(name, fn, options) {
      handlers.set(name, { fn, options })
      return () => handlers.delete(name)
    },
    effect(fn) {
      disposers.push(fn)
      return () => {}
    },
    logger: { debug() {}, warn() {}, info() {} },
  }
}

const originalPlatform = process.platform

function withPlatform(value, run) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  }
}

test('the package exports a named plugin with apply()', () => {
  assert.equal(plugin.name, 'dsh-desktop-notifier')
  assert.equal(typeof plugin.apply, 'function')
})

test('a disabled plugin registers nothing', () => {
  const ctx = fakeContext()
  withPlatform('win32', () => plugin.apply(ctx, { enabled: false }))
  assert.equal(ctx.handlers.size, 0)
})

test('non-Windows hosts stay completely silent', () => {
  const ctx = fakeContext()
  withPlatform('linux', () => plugin.apply(ctx, { enabled: true }))
  assert.equal(ctx.handlers.size, 0)
})

test('Windows mounts the approval waterfall and the turn listener', () => {
  const ctx = fakeContext()
  withPlatform('win32', () =>
    plugin.apply(ctx, {
      // No focus tick and no protocol registration: this test must stay silent
      // and must not write to the real registry.
      clearBadgeOnFocus: false,
      clickToFocus: false,
      completion: { enabled: false },
    }),
  )
  assert.deepEqual([...ctx.handlers.keys()].sort(), ['approval/request', 'session/event'])
  // The approval service dispatches through a scope filter: a listener without
  // `global` can be dropped before it ever runs.
  assert.deepEqual(ctx.handlers.get('approval/request').options, { prepend: true, global: true })
})

test('turn events are handled without spawning when completion is off', () => {
  const ctx = fakeContext()
  withPlatform('win32', () => plugin.apply(ctx, { clearBadgeOnFocus: false, clickToFocus: false, completion: { enabled: false } }))
  const session = { header: { id: 's1', cwd: 'C:\\w\\p' } }
  const listener = ctx.handlers.get('session/event').fn
  assert.doesNotThrow(() => listener(session, { type: 'turn/start', data: { turn: 1 } }))
  assert.doesNotThrow(() => listener(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }))
})

test('malformed session events are ignored, not thrown on', () => {
  const ctx = fakeContext()
  withPlatform('win32', () => plugin.apply(ctx, { clearBadgeOnFocus: false, clickToFocus: false }))
  const listener = ctx.handlers.get('session/event').fn
  assert.doesNotThrow(() => listener(undefined, undefined))
  assert.doesNotThrow(() => listener({}, {}))
  assert.doesNotThrow(() => listener({ header: { id: 's' } }, { type: 'turn/end', data: null }))
})

test('every effect disposes cleanly', () => {
  const ctx = fakeContext()
  withPlatform('win32', () => plugin.apply(ctx, { clearBadgeOnFocus: false, clickToFocus: false }))
  for (const register of ctx.disposers) {
    const dispose = register()
    assert.equal(typeof dispose, 'function')
    assert.doesNotThrow(() => dispose())
  }
})
