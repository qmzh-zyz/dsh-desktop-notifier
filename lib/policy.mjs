/**
 * Pure decision logic for dsh-desktop-notifier.
 *
 * Nothing in this module touches Electron, Cordis, the filesystem, or
 * PowerShell, so every rule below is unit-testable on any platform. `index.js`
 * owns the side effects (spawning the helpers) and delegates the "should this
 * event produce a toast / a badge / a chime" questions here.
 */

/** DeepSeek Harness' own window title/process name, used to locate the taskbar button. */
export const DEFAULT_WINDOW_MATCH = 'DeepSeek Harness'

/** AppUserModelID registered per user so the unpackaged app can post toasts. */
export const DEFAULT_APP_ID = 'DeepSeek.Harness.DesktopNotifier'

export const DEFAULTS = {
  enabled: true,
  windowMatch: DEFAULT_WINDOW_MATCH,
  appId: DEFAULT_APP_ID,
  appName: 'DeepSeek Harness',
  badgeColor: '#f5455c',
  clearBadgeOnFocus: true,
  debugLog: '',
  approval: {
    enabled: true,
    skipWhenFocused: true,
    // 'auto' lets the helper try urgent -> alarm -> default, which is how the
    // banner survives Focus Assist and fullscreen on both Windows 10 and 11.
    scenario: 'auto',
    sound: true,
    title: 'DSH 需要你审批',
    repeat: 0,
    repeatIntervalSec: 20,
  },
  completion: {
    enabled: true,
    badge: true,
    toast: true,
    sound: true,
    skipWhenFocused: true,
    scenario: 'default',
    minTurnMs: 2000,
    title: '任务完成',
  },
}

const SCENARIOS = new Set(['auto', 'urgent', 'alarm', 'default'])

/** Coerce to a boolean only when the value really is one; otherwise keep the default. */
function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** Coerce to a finite number (config files quote numbers surprisingly often). */
function num(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Trimmed non-empty string, else the fallback. */
function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/** One of the toast scenarios, else the fallback. */
function scenario(value, fallback) {
  const candidate = text(value, '')
  return SCENARIOS.has(candidate) ? candidate : fallback
}

/**
 * Merge the patch config over {@link DEFAULTS}.
 *
 * The loader hands over exactly what the patch declared, so every field is
 * optional and every value is untrusted: a typo in `cordis.patch.yml` must not
 * be able to crash the host process.
 *
 * @param raw - the `config` object from the composition entry.
 * @returns a fully populated, type-safe configuration.
 */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const approval = source.approval && typeof source.approval === 'object' ? source.approval : {}
  const completion = source.completion && typeof source.completion === 'object' ? source.completion : {}

  return {
    enabled: bool(source.enabled, DEFAULTS.enabled),
    windowMatch: text(source.windowMatch, DEFAULTS.windowMatch),
    appId: text(source.appId, DEFAULTS.appId),
    appName: text(source.appName, DEFAULTS.appName),
    badgeColor: hexColor(source.badgeColor, DEFAULTS.badgeColor),
    clearBadgeOnFocus: bool(source.clearBadgeOnFocus, DEFAULTS.clearBadgeOnFocus),
    debugLog: text(source.debugLog, DEFAULTS.debugLog),
    approval: {
      enabled: bool(approval.enabled, DEFAULTS.approval.enabled),
      skipWhenFocused: bool(approval.skipWhenFocused, DEFAULTS.approval.skipWhenFocused),
      scenario: scenario(approval.scenario, DEFAULTS.approval.scenario),
      sound: bool(approval.sound, DEFAULTS.approval.sound),
      title: text(approval.title, DEFAULTS.approval.title),
      repeat: Math.max(0, Math.trunc(num(approval.repeat, DEFAULTS.approval.repeat))),
      repeatIntervalSec: Math.max(5, Math.trunc(num(approval.repeatIntervalSec, DEFAULTS.approval.repeatIntervalSec))),
    },
    completion: {
      enabled: bool(completion.enabled, DEFAULTS.completion.enabled),
      badge: bool(completion.badge, DEFAULTS.completion.badge),
      toast: bool(completion.toast, DEFAULTS.completion.toast),
      sound: bool(completion.sound, DEFAULTS.completion.sound),
      skipWhenFocused: bool(completion.skipWhenFocused, DEFAULTS.completion.skipWhenFocused),
      scenario: scenario(completion.scenario, DEFAULTS.completion.scenario),
      minTurnMs: Math.max(0, Math.trunc(num(completion.minTurnMs, DEFAULTS.completion.minTurnMs))),
      title: text(completion.title, DEFAULTS.completion.title),
    },
  }
}

/**
 * Validate a badge colour, accepting `#rgb`, `#rrggbb` and `#rrggbbaa`.
 * @param value - untrusted colour string.
 * @param fallback - colour returned when the value is unusable.
 */
export function hexColor(value, fallback = DEFAULTS.badgeColor) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(candidate) ? candidate : fallback
}

/**
 * Whether a session is a child (subagent / teammate) whose turns the user never
 * experiences as their own conversation.
 *
 * A child session carries `origin: 'subagent'`, or one of the parent links, or
 * a delegation depth above zero. Counting those would make the badge run ahead
 * of the user's actual work.
 *
 * @param header - `session.header` (may be missing on exotic sessions).
 */
export function isChildSession(header) {
  if (!header || typeof header !== 'object') return false
  if (header.origin === 'subagent') return true
  if (header.parentSession) return true
  if (header.parentSessionId) return true
  if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true
  return false
}

/**
 * Stable identity of one finished turn, used to drop duplicate `turn/end`
 * notifications (a replayed or re-read log can emit the same turn twice).
 */
export function turnKey(sessionId, turn) {
  return `${String(sessionId)}#${String(turn)}`
}

/**
 * Whether a finished turn is worth a badge and a chime.
 * @param options.durationMs - wall-clock duration of the turn, `Infinity` when unknown.
 * @param options.minTurnMs - turns shorter than this are treated as chatter.
 */
export function shouldCountTurn({ durationMs = Infinity, minTurnMs = 0 } = {}) {
  if (!Number.isFinite(minTurnMs) || minTurnMs <= 0) return true
  if (!Number.isFinite(durationMs)) return true
  return durationMs >= minTurnMs
}

/**
 * Whether a finished turn's reason counts as "completed".
 * Errors have their own path; `aborted` / `cancelled` are the user stopping work.
 */
export function isCompletedReason(reason) {
  return Boolean(reason) && reason.kind === 'completed'
}

/** Short, human-readable name for a session: the workspace folder, else a short id. */
export function sessionLabel(session) {
  const header = session && session.header ? session.header : {}
  const cwd = typeof header.cwd === 'string' ? header.cwd : ''
  if (cwd) {
    const parts = cwd.split(/[\\/]+/).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  const id = typeof header.id === 'string' ? header.id : String(header.id ?? '')
  return id ? id.slice(0, 8) : '当前会话'
}

/** Truncate toast body text; Windows shows two lines and drops the rest anyway. */
export function clampBody(value, limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

/**
 * Build the payload `assets/notify.ps1` consumes for an approval request.
 * @param req - the `approval/request` event (`toolName`, `reason`, `displayReason`).
 * @param config - normalized configuration.
 * @param logoPath - absolute PNG shown on the left of the banner.
 */
export function approvalPayload(req, config, logoPath) {
  const toolName = text(req && req.toolName, '工具调用')
  const reason = text(req && req.displayReason, '') || text(req && req.reason, '')
  const body = reason ? `${toolName}：${reason}` : `${toolName} 需要你「允许一次」或「拒绝」`

  return {
    title: config.approval.title,
    body: clampBody(body),
    appId: config.appId,
    displayName: config.appName,
    logo: logoPath,
    scenario: config.approval.scenario,
    // The banner stays silent on purpose: the plugin plays its own chime once
    // the banner is actually on screen, so the reminder is audible even when
    // Windows' notification sound is switched off.
    audio: 'silent',
    duration: 'long',
    skipWhenFocused: config.approval.skipWhenFocused,
    focusProcesses: [config.windowMatch],
    tag: 'dsh-desktop-notifier-approval',
    group: 'dsh-desktop-notifier',
  }
}

/**
 * Build the payload for a finished turn.
 * @param session - the session whose turn ended.
 * @param config - normalized configuration.
 * @param logoPath - absolute PNG shown on the left of the banner.
 */
export function completionPayload(session, config, logoPath) {
  return {
    title: config.completion.title,
    body: clampBody(`《${sessionLabel(session)}》这一轮已跑完`),
    appId: config.appId,
    displayName: config.appName,
    logo: logoPath,
    scenario: config.completion.scenario,
    audio: 'silent',
    duration: 'short',
    skipWhenFocused: config.completion.skipWhenFocused,
    focusProcesses: [config.windowMatch],
    tag: 'dsh-desktop-notifier-completion',
    group: 'dsh-desktop-notifier',
  }
}

/**
 * Decide what a finished turn should trigger, so the tests can assert the
 * outcome without spawning PowerShell.
 *
 * @param options.session - the session that finished.
 * @param options.reason - `turn/end` reason.
 * @param options.durationMs - measured turn duration.
 * @param options.config - normalized configuration.
 * @returns `{ badge, toast, chime }`.
 */
export function completionPlan({ session, reason, durationMs, config }) {
  if (!config.completion.enabled) return { badge: false, toast: false, chime: false }
  if (isChildSession(session && session.header)) return { badge: false, toast: false, chime: false }
  if (!isCompletedReason(reason)) return { badge: false, toast: false, chime: false }
  if (!shouldCountTurn({ durationMs, minTurnMs: config.completion.minTurnMs })) {
    return { badge: false, toast: false, chime: false }
  }
  return {
    badge: config.completion.badge,
    toast: config.completion.toast,
    // The plugin owns the sound: the banner is always silent, so the chime is
    // played by us and stays audible even with Windows notification sounds off.
    chime: config.completion.sound,
  }
}
