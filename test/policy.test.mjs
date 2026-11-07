import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULTS,
  approvalPayload,
  clampBody,
  completionPayload,
  completionPlan,
  hexColor,
  isChildSession,
  isCompletedReason,
  normalizeConfig,
  sessionLabel,
  shouldCountTurn,
  turnKey,
} from '../lib/policy.mjs'

const quietConfig = { debugLog: '' }

test('normalizeConfig fills every default', () => {
  const config = normalizeConfig(undefined)
  assert.equal(config.enabled, true)
  assert.equal(config.windowMatch, DEFAULTS.windowMatch)
  assert.deepEqual(config.approval, DEFAULTS.approval)
  assert.deepEqual(config.completion, DEFAULTS.completion)
})

test('normalizeConfig keeps valid overrides and rejects junk', () => {
  const config = normalizeConfig({
    enabled: false,
    windowMatch: '  My DSH  ',
    badgeColor: 'red',
    approval: { enabled: false, scenario: 'nope', repeat: -3, title: '' },
    completion: { minTurnMs: '4500', toast: 'yes' },
  })
  assert.equal(config.enabled, false)
  assert.equal(config.windowMatch, 'My DSH')
  // An invalid colour falls back instead of reaching PowerShell.
  assert.equal(config.badgeColor, DEFAULTS.badgeColor)
  assert.equal(config.approval.enabled, false)
  assert.equal(config.approval.scenario, 'auto')
  assert.equal(config.approval.repeat, 0)
  assert.equal(config.approval.title, DEFAULTS.approval.title)
  assert.equal(config.completion.minTurnMs, 4500)
  // A non-boolean stays at its default rather than becoming truthy.
  assert.equal(config.completion.toast, DEFAULTS.completion.toast)
})

test('normalizeConfig survives a non-object config', () => {
  for (const value of [null, 42, 'text', [], { approval: [] }]) {
    assert.doesNotThrow(() => normalizeConfig(value))
  }
})

test('hexColor accepts short, long and alpha forms', () => {
  assert.equal(hexColor('#f00'), '#f00')
  assert.equal(hexColor('#F5455C'), '#F5455C')
  assert.equal(hexColor('#11223344'), '#11223344')
  assert.equal(hexColor('112233'), DEFAULTS.badgeColor)
  assert.equal(hexColor(undefined), DEFAULTS.badgeColor)
})

test('isChildSession recognises every parent link', () => {
  assert.equal(isChildSession({ origin: 'subagent' }), true)
  assert.equal(isChildSession({ parentSession: 'abc' }), true)
  assert.equal(isChildSession({ delegationDepth: 2 }), true)
  assert.equal(isChildSession({ delegationDepth: 0 }), false)
  assert.equal(isChildSession({ id: 'x' }), false)
  assert.equal(isChildSession(undefined), false)
})

test('shouldCountTurn treats an unknown duration as worth counting', () => {
  assert.equal(shouldCountTurn({ durationMs: 100, minTurnMs: 2000 }), false)
  assert.equal(shouldCountTurn({ durationMs: 2000, minTurnMs: 2000 }), true)
  assert.equal(shouldCountTurn({ durationMs: Infinity, minTurnMs: 2000 }), true)
  assert.equal(shouldCountTurn({ durationMs: 5, minTurnMs: 0 }), true)
})

test('isCompletedReason only accepts "completed"', () => {
  assert.equal(isCompletedReason({ kind: 'completed' }), true)
  assert.equal(isCompletedReason({ kind: 'error' }), false)
  assert.equal(isCompletedReason({ kind: 'aborted' }), false)
  assert.equal(isCompletedReason(undefined), false)
})

test('completionPlan: a normal away turn badges and toasts', () => {
  const plan = completionPlan({
    session: { header: { id: 's1', cwd: 'C:\\work\\demo' } },
    reason: { kind: 'completed' },
    durationMs: 60_000,
    config: normalizeConfig(quietConfig),
  })
  assert.deepEqual(plan, { badge: true, toast: true, chime: true })
})

test('completionPlan: subagent turns never badge', () => {
  const plan = completionPlan({
    session: { header: { id: 's2', origin: 'subagent' } },
    reason: { kind: 'completed' },
    durationMs: 60_000,
    config: normalizeConfig(quietConfig),
  })
  assert.deepEqual(plan, { badge: false, toast: false, chime: false })
})

test('completionPlan: aborted and errored turns stay silent', () => {
  for (const kind of ['aborted', 'error', 'cancelled']) {
    const plan = completionPlan({
      session: { header: { id: 's3' } },
      reason: { kind },
      durationMs: 60_000,
      config: normalizeConfig(quietConfig),
    })
    assert.deepEqual(plan, { badge: false, toast: false, chime: false })
  }
})

test('completionPlan: a short turn is ignored when minTurnMs is set', () => {
  const plan = completionPlan({
    session: { header: { id: 's4' } },
    reason: { kind: 'completed' },
    durationMs: 500,
    config: normalizeConfig({ completion: { minTurnMs: 2000 } }),
  })
  assert.deepEqual(plan, { badge: false, toast: false, chime: false })
})

test('completionPlan: banner off still chimes', () => {
  const plan = completionPlan({
    session: { header: { id: 's5' } },
    reason: { kind: 'completed' },
    durationMs: 60_000,
    config: normalizeConfig({ completion: { toast: false, badge: true, sound: true } }),
  })
  assert.deepEqual(plan, { badge: true, toast: false, chime: true })
})

test('completionPlan: a disabled plugin plans nothing', () => {
  const plan = completionPlan({
    session: { header: { id: 's6' } },
    reason: { kind: 'completed' },
    durationMs: 60_000,
    config: normalizeConfig({ completion: { enabled: false } }),
  })
  assert.deepEqual(plan, { badge: false, toast: false, chime: false })
})

test('approvalPayload names the tool and folds in the reason', () => {
  const config = normalizeConfig(quietConfig)
  const withReason = approvalPayload({ toolName: 'bash', reason: 'needs network access' }, config, 'C:\\icon.png')
  assert.equal(withReason.title, DEFAULTS.approval.title)
  assert.match(withReason.body, /bash/)
  assert.match(withReason.body, /needs network access/)
  assert.equal(withReason.scenario, 'auto')
  assert.equal(withReason.duration, 'long')
  assert.equal(withReason.skipWhenFocused, true)
  assert.deepEqual(withReason.focusProcesses, [DEFAULTS.windowMatch])
  assert.equal(withReason.logo, 'C:\\icon.png')

  const bare = approvalPayload({ toolName: 'write_file' }, config, '')
  assert.match(bare.body, /允许一次/)
})

test('approvalPayload prefers displayReason over the raw reason', () => {
  const payload = approvalPayload(
    { toolName: 'bash', reason: 'internal', displayReason: '要在沙箱外执行' },
    normalizeConfig(quietConfig),
    '',
  )
  assert.match(payload.body, /要在沙箱外执行/)
})

test('completionPayload names the workspace folder', () => {
  const payload = completionPayload({ header: { id: 'abc12345', cwd: 'D:\\projects\\dsh-desktop-notifier' } }, normalizeConfig(quietConfig), '')
  assert.match(payload.body, /dsh-desktop-notifier/)
  assert.equal(payload.duration, 'short')
  assert.equal(payload.scenario, 'default')
})

test('sessionLabel falls back to a short id', () => {
  assert.equal(sessionLabel({ header: { id: 'abcdefghijkl' } }), 'abcdefgh')
  assert.equal(sessionLabel({ header: {} }), '当前会话')
  assert.equal(sessionLabel({}), '当前会话')
})

test('clampBody collapses whitespace and truncates', () => {
  assert.equal(clampBody('  a\n\n b  '), 'a b')
  const long = clampBody('x'.repeat(400))
  assert.equal(long.length, 180)
  assert.ok(long.endsWith('…'))
})

test('turnKey is stable per session and turn', () => {
  assert.equal(turnKey('s1', 3), 's1#3')
  assert.notEqual(turnKey('s1', 3), turnKey('s1', 4))
})
