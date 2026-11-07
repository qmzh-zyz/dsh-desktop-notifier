import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { DEFAULT_SCHEME, protocolCommand, wscriptExe } from '../lib/protocol.mjs'
import { FOCUS_SCHEME, FOCUS_URI } from '../lib/policy.mjs'

test('the scheme is shared between the payload and the registration', () => {
  assert.equal(DEFAULT_SCHEME, FOCUS_SCHEME)
  assert.equal(FOCUS_URI, `${FOCUS_SCHEME}:focus`)
})

test('wscript resolves inside the system directory', () => {
  assert.match(wscriptExe(), /System32[\\/]wscript\.exe$/i)
})

test('the registered command passes uri, script, window match and exe', () => {
  const command = protocolCommand({
    wscriptPath: 'C:\\Windows\\System32\\wscript.exe',
    vbsPath: 'C:\\plugins\\dsh-desktop-notifier\\assets\\launch.vbs',
    focusPath: 'C:\\plugins\\dsh-desktop-notifier\\assets\\focus.ps1',
    windowMatch: 'DeepSeek Harness',
    appPath: 'C:\\Program Files\\DeepSeek\\DeepSeek Harness.exe',
  })
  assert.equal(
    command,
    '"C:\\Windows\\System32\\wscript.exe" ' +
      '"C:\\plugins\\dsh-desktop-notifier\\assets\\launch.vbs" ' +
      '"%1" ' +
      '"C:\\plugins\\dsh-desktop-notifier\\assets\\focus.ps1" ' +
      '"DeepSeek Harness" ' +
      '"C:\\Program Files\\DeepSeek\\DeepSeek Harness.exe"',
  )
})

test('the command still has four arguments without an exe', () => {
  const command = protocolCommand({
    wscriptPath: 'C:\\Windows\\System32\\wscript.exe',
    vbsPath: join('C:\\p', 'launch.vbs'),
    focusPath: join('C:\\p', 'focus.ps1'),
    windowMatch: 'DeepSeek Harness',
  })
  // The launcher treats the last argument as optional; it must still be quoted
  // so the empty value occupies its own argv slot.
  assert.ok(command.endsWith('"DeepSeek Harness" ""'))
})
