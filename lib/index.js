/**
 * dsh-desktop-notifier — the host half.
 *
 * Two things happen here:
 *
 * 1. `approval/request` (a Cordis waterfall) is mirrored to a Windows toast in
 *    the bottom-right corner. The listener is registered `prepend` + `global`
 *    because the approval service dispatches through `scopeTarget(agent, agent)`
 *    and a scope-bound listener can be filtered out entirely. It always returns
 *    `next()`: this plugin never answers an approval, it only announces one.
 *
 * 2. `session/event`'s `turn/end` (reason `completed`) increments a red count on
 *    the DSH taskbar button and rings a chime — but only when DSH is not in the
 *    foreground, which the PowerShell helper decides with `GetForegroundWindow`.
 *
 * The taskbar overlay cannot be drawn from here: this process does not own the
 * window that carries the taskbar button, so Electron's `setOverlayIcon` is out
 * of reach. Windows still lets any process paint that overlay through
 * `ITaskbarList3` given the HWND, so `assets/badge.ps1` is kept alive as a
 * helper and fed one command per line.
 *
 * Zero runtime dependencies: Node built-ins plus the PowerShell that ships with
 * Windows.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { approvalPayload, completionPayload, completionPlan, normalizeConfig, turnKey } from './policy.mjs'

export const name = 'dsh-desktop-notifier'

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url))
const NOTIFY_SCRIPT = join(ASSETS, 'notify.ps1')
const BADGE_SCRIPT = join(ASSETS, 'badge.ps1')
const CHIME_SCRIPT = join(ASSETS, 'chime.ps1')
const ICON_APPROVAL = join(ASSETS, 'icon-approval.png')
const ICON_TASK = join(ASSETS, 'icon-task.png')

const FOCUS_TICK_MS = 800
const NOTIFY_TIMEOUT_MS = 8000
const DEDUPE_MS = 5000

/** PowerShell lives in the system directory; resolving it avoids PATH surprises. */
function powershellExe() {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** The last JSON line a helper printed, or a shape the caller can log. */
function parseHelperOutput(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index])
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Not a JSON line (a PowerShell warning, for example): keep looking.
    }
  }
  return { ok: false, action: 'unparsed', raw: lines.slice(-3).join(' | ') }
}

/**
 * Run a one-shot PowerShell helper and resolve with its JSON verdict.
 * Never rejects: a broken helper must not take the host down.
 */
function runPowerShell(script, args, timeoutMs = NOTIFY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let stdout = ''
    let settled = false
    let child
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        // Already gone.
      }
      finish({ ok: false, action: 'timeout' })
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    try {
      child = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (error) {
      finish({ ok: false, action: 'spawn-failed', error: String(error && error.message) })
      return
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('error', (error) => finish({ ok: false, action: 'spawn-failed', error: String(error && error.message) }))
    child.on('close', () => finish(parseHelperOutput(stdout)))
  })
}

/** Persistent taskbar-badge helper: own the count, let PowerShell paint it. */
class BadgeHelper {
  constructor(config, log) {
    this.config = config
    this.log = log
    this.child = null
    this.spawnedAt = 0
    this.failures = 0
    this.parkedUntil = 0
    this.stopped = false
  }

  start() {
    const child = spawn(
      powershellExe(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        BADGE_SCRIPT,
        '-WindowMatch',
        this.config.windowMatch,
        '-BadgeColor',
        this.config.badgeColor,
        '-ParentPid',
        String(process.pid),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    )
    child.spawnedAt = Date.now()
    // Drain stdout: an unread pipe eventually blocks the helper.
    child.stdout.on('data', (chunk) => {
      this.failures = 0
      const line = String(chunk).trim()
      if (line) this.log('badge-helper', { line })
    })
    child.on('error', () => this.retire(child))
    child.on('exit', () => this.retire(child))
    this.child = child
    return child
  }

  /** Count only deaths that come right after a spawn; a long-lived helper dying is normal. */
  retire(child) {
    if (this.child === child) this.child = null
    if (Date.now() - child.spawnedAt > 5000) {
      this.failures = 0
      return
    }
    this.failures += 1
    if (this.failures >= 3) {
      // Three instant deaths mean the setup is broken (policy, missing script).
      // Park for five minutes instead of respawning on every turn.
      this.parkedUntil = Date.now() + 5 * 60 * 1000
      this.failures = 0
      this.log('badge-helper-parked', {})
    }
  }

  send(command) {
    if (this.stopped) return
    if (Date.now() < this.parkedUntil) return
    if (!this.child || this.child.exitCode !== null) {
      try {
        this.start()
      } catch (error) {
        this.failures += 1
        this.log('badge-spawn-failed', { error: String(error && error.message) })
        return
      }
    }
    try {
      this.child.stdin.write(`${command}\n`)
    } catch {
      this.child = null
    }
  }

  stop() {
    this.stopped = true
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.stdin.write('quit\n')
    } catch {
      // Already closed.
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // Nothing left to kill.
      }
    }, 1500)
    if (typeof timer.unref === 'function') timer.unref()
  }
}

/** Show one toast; the payload goes through a UTF-8 temp file (PS 5.1 has no reliable UTF-8 CLI). */
async function showToast(payload, log) {
  let dir
  try {
    dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-notifier-'))
    const jsonPath = join(dir, 'payload.json')
    writeFileSync(jsonPath, JSON.stringify(payload), 'utf8')
    const result = await runPowerShell(NOTIFY_SCRIPT, ['-JsonPath', jsonPath])
    log('toast', { tag: payload.tag, ...result })
    return result
  } catch (error) {
    log('toast-failed', { error: String(error && error.message) })
    return { ok: false, action: 'failed' }
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Temp cleanup is best effort.
      }
    }
  }
}

/** One chime, used only when the completion banner is switched off. */
function playChime(config, log) {
  try {
    const child = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CHIME_SCRIPT], {
      windowsHide: true,
      stdio: 'ignore',
    })
    child.on('error', () => {})
    log('chime', {})
  } catch (error) {
    log('chime-failed', { error: String(error && error.message) })
  }
}

/**
 * Build the `approval/request` waterfall listener.
 *
 * Extracted from `apply` so the interesting part — dedupe, the never-throw
 * promise, and the obligation to hand the decision back to the chain — is
 * testable without spawning PowerShell.
 *
 * @param options.config - normalized configuration.
 * @param options.announce - called with the toast payload; may reject.
 * @param options.log - structured debug logger.
 * @param options.now - clock, injectable for the dedupe window.
 */
export function createApprovalListener({ config, announce, log, now = () => Date.now() }) {
  const recent = new Map()
  return (req, next) => {
    try {
      const key = String((req && (req.callId || req.toolName)) || 'approval')
      const timestamp = now()
      const last = recent.get(key)
      if (last !== undefined && timestamp - last < DEDUPE_MS) {
        log('approval-deduped', { key })
      } else {
        recent.set(key, timestamp)
        if (recent.size > 64) {
          for (const [entry, at] of recent) if (timestamp - at > DEDUPE_MS * 4) recent.delete(entry)
        }
        announce(approvalPayload(req, config, ICON_APPROVAL)).catch((error) => {
          log('approval-failed', { error: String(error && error.message) })
        })
      }
    } catch (error) {
      log('approval-failed', { error: String(error && error.message) })
    }
    // Never swallow the approval: this plugin only announces it.
    return next()
  }
}

/**
 * Mount the plugin.
 * @param ctx - Cordis context of this composition entry.
 * @param rawConfig - `config` from `cordis.patch.yml`; every field is optional.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)

  const log = (kind, data = {}) => {
    if (!config.debugLog) return
    try {
      appendFileSync(config.debugLog, `${new Date().toISOString()} ${kind} ${JSON.stringify(data)}\n`)
    } catch {
      // Diagnostics must never break the feature.
    }
  }

  log('load', { pid: process.pid, platform: process.platform, config })

  if (!config.enabled) return
  if (process.platform !== 'win32') {
    // The whole feature is Windows-only; stay silent on other platforms.
    log('skip', { reason: 'not-win32' })
    return
  }

  const badge = new BadgeHelper(config, log)
  // Everything this plugin started must go away with it, or an orphan helper
  // would keep painting the taskbar after the plugin is removed.
  ctx.effect(() => () => badge.stop())

  const seenTurns = new Set()
  const turnStartedAt = new Map()

  /* ------------------------------------------------------------- approvals */

  // Re-reminded approvals: the toast is silent about resolution, so the
  // `approval/decided` session event is what stops the loop.
  const pendingApprovals = { count: 0, timer: null }
  const stopApprovalRepeat = () => {
    if (pendingApprovals.timer !== null) {
      clearInterval(pendingApprovals.timer)
      pendingApprovals.timer = null
    }
    pendingApprovals.count = 0
  }
  const startApprovalRepeat = () => {
    if (config.approval.repeat <= 0) return
    if (pendingApprovals.timer !== null) return
    let fired = 0
    const timer = setInterval(() => {
      fired += 1
      if (fired >= config.approval.repeat || pendingApprovals.count === 0) {
        stopApprovalRepeat()
        return
      }
      const payload = { ...approvalPayload({ toolName: '审批仍未处理' }, config, ICON_APPROVAL) }
      payload.title = 'DSH 还在等你审批'
      payload.audio = 'default'
      void showToast(payload, log)
    }, config.approval.repeatIntervalSec * 1000)
    if (typeof timer.unref === 'function') timer.unref()
    pendingApprovals.timer = timer
  }

  if (config.approval.enabled) {
    ctx.on(
      'approval/request',
      createApprovalListener({
        config,
        log,
        announce: (payload) => {
          pendingApprovals.count += 1
          startApprovalRepeat()
          return showToast(payload, log)
        },
      }),
      { prepend: true, global: true },
    )
  }

  /* ------------------------------------------------------------ completed */

  ctx.on('session/event', (session, event) => {
    try {
      if (!session || !event || typeof event.type !== 'string') return
      const sessionId = session.header ? session.header.id : undefined

      if (event.type === 'turn/start') {
        turnStartedAt.set(sessionId, Date.now())
        return
      }

      if (event.type === 'approval/decided') {
        pendingApprovals.count = Math.max(0, pendingApprovals.count - 1)
        if (pendingApprovals.count === 0) stopApprovalRepeat()
        return
      }

      if (event.type !== 'turn/end') return

      const startedAt = turnStartedAt.get(sessionId)
      turnStartedAt.delete(sessionId)
      const durationMs = typeof startedAt === 'number' ? Date.now() - startedAt : Infinity

      const plan = completionPlan({ session, reason: event.data && event.data.reason, durationMs, config })
      if (!plan.badge && !plan.toast && !plan.chime) return

      const key = turnKey(sessionId, event.data && event.data.turn)
      if (seenTurns.has(key)) return
      seenTurns.add(key)
      if (seenTurns.size > 512) seenTurns.clear()

      if (plan.toast) {
        void showToast(completionPayload(session, config, ICON_TASK), log).then((result) => {
          // Badge only when the banner really showed: `skipped-focus` means the
          // user was already looking at DSH, so there is nothing to catch up on.
          if (plan.badge && result && result.action === 'shown') badge.send('add')
        })
      } else {
        if (plan.badge) badge.send('add')
        if (plan.chime) playChime(config, log)
      }
    } catch (error) {
      log('turn-failed', { error: String(error && error.message) })
    }
  })

  /* ---------------------------------------------------------------- focus */

  if (config.clearBadgeOnFocus) {
    const tick = setInterval(() => badge.send('tick'), FOCUS_TICK_MS)
    if (typeof tick.unref === 'function') tick.unref()
    ctx.effect(() => () => clearInterval(tick))
  }

  ctx.effect(() => () => {
    stopApprovalRepeat()
    turnStartedAt.clear()
    seenTurns.clear()
  })
}
