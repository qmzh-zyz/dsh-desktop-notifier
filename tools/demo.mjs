#!/usr/bin/env node
/**
 * Real-effect demo driver.
 *
 * The HTML page under demo/ is a mock used for screenshots; this script drives
 * the actual PowerShell helpers, so what you see is what the plugin does.
 *
 *   node tools/demo.mjs toast approval   # one approval banner in the corner
 *   node tools/demo.mjs toast done       # one completion banner
 *   node tools/demo.mjs badge 3          # paint a count of 3, hold, clear
 *   node tools/demo.mjs chime            # the fallback chime
 *   node tools/demo.mjs focus            # report the foreground process
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { approvalPayload, completionPayload, normalizeConfig } from '../lib/policy.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ASSETS = join(ROOT, 'assets')
const CONFIG = normalizeConfig({ approval: { skipWhenFocused: false }, completion: { skipWhenFocused: false } })

const [command, arg] = process.argv.slice(2)

function showToast(kind) {
  const payload =
    kind === 'approval'
      ? approvalPayload({ toolName: 'bash', reason: 'sandbox escalation 需要「允许一次」或「拒绝」' }, CONFIG, join(ASSETS, 'icon-approval.png'))
      : completionPayload({ header: { id: 'demo', cwd: 'C:\\work\\dsh-demo' } }, CONFIG, join(ASSETS, 'icon-task.png'))
  const dir = mkdtempSync(join(tmpdir(), 'dsh-away-demo-'))
  const jsonPath = join(dir, 'payload.json')
  writeFileSync(jsonPath, JSON.stringify(payload), 'utf8')
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ASSETS, 'notify.ps1'), '-JsonPath', jsonPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  child.on('close', (code) => {
    console.log(`notify.ps1 exited with ${code}`)
  })
}

function paintBadge(count) {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ASSETS, 'badge.ps1'), '-WindowMatch', CONFIG.windowMatch, '-BadgeColor', CONFIG.badgeColor],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  child.stdout.on('data', (chunk) => process.stdout.write(String(chunk)))
  for (let index = 0; index < count; index += 1) child.stdin.write('add\n')
  console.log(`badge ${count}: clearing in 4s`)
  setTimeout(() => {
    child.stdin.write('clear\nquit\n')
    child.on('close', () => process.exit(0))
  }, 4000)
}

switch (command) {
  case 'toast':
    showToast(arg === 'done' ? 'done' : 'approval')
    break
  case 'badge':
    paintBadge(Number(arg) > 0 ? Number(arg) : 1)
    break
  case 'chime': {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ASSETS, 'chime.ps1')], { stdio: 'inherit' })
    process.exit(result.status ?? 0)
    break
  }
  case 'focus': {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-away-demo-'))
    const jsonPath = join(dir, 'payload.json')
    writeFileSync(jsonPath, JSON.stringify({ focusProcesses: [CONFIG.windowMatch] }), 'utf8')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ASSETS, 'notify.ps1'), '-JsonPath', jsonPath, '-FocusOnly'], {
      encoding: 'utf8',
    })
    console.log((result.stdout || '').trim())
    rmSync(dir, { recursive: true, force: true })
    break
  }
  default:
    console.log('usage: node tools/demo.mjs <toast approval|toast done|badge N|chime|focus>')
    process.exit(command ? 1 : 0)
}
