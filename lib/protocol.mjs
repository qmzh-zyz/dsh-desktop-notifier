/**
 * Per-user URI protocol registration.
 *
 * A WinRT toast cannot activate an unpackaged app: Windows looks for a COM
 * activator registered against the AppUserModelID, does not find one, and drops
 * the click. What it *will* do is ShellExecute a URI, so the toast declares
 * `activationType="protocol" launch="dshnotifier:focus"` and this module
 * registers that scheme under HKCU — per user, no administrator required.
 *
 * The handler is `wscript.exe launch.vbs`: wscript starts without a console
 * window, unlike powershell.exe, so clicking a toast does not flash a black box.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { FOCUS_SCHEME } from './policy.mjs'

/** The scheme the toast activates. Kept short so the XML stays readable. */
export const DEFAULT_SCHEME = FOCUS_SCHEME

/** Registry root for per-user file/URI associations. */
const CLASSES = 'HKCU\\Software\\Classes'

/**
 * The command line Windows runs when the URI is activated.
 *
 * `%1` is the full URI (`dshnotifier:focus`); the launcher ignores its value and
 * only uses it to know it was started from a click. The trailing exe path is
 * what lets the handler relaunch DSH after it was closed to the tray; it may be
 * an empty string when the caller has no usable path.
 */
export function protocolCommand({ wscriptPath, vbsPath, focusPath, windowMatch, appPath = '' }) {
  return `"${wscriptPath}" "${vbsPath}" "%1" "${focusPath}" "${windowMatch}" "${appPath}"`
}

/** Absolute path of wscript.exe for this machine. */
export function wscriptExe() {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return join(root, 'System32', 'wscript.exe')
}

/** Run one `reg add`; throws with reg's stderr when it fails. */
function regAdd(args) {
  execFileSync('reg.exe', ['add', ...args, '/f'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
}

/**
 * Register (or repair) the scheme. Idempotent: every value is written with
 * `/f`, so a moved plugin directory simply overwrites the old command.
 *
 * @param options.scheme - URI scheme without the trailing colon.
 * @param options.vbsPath - absolute path of launch.vbs.
 * @param options.focusPath - absolute path of focus.ps1.
 * @param options.windowMatch - process name of the DSH window.
 * @param options.appPath - optional exe used when the app has no window.
 * @returns the command line that was written.
 */
export function registerProtocol({ scheme = DEFAULT_SCHEME, vbsPath, focusPath, windowMatch, appPath = '' }) {
  const base = `${CLASSES}\\${scheme}`
  const command = protocolCommand({ wscriptPath: wscriptExe(), vbsPath, focusPath, windowMatch, appPath })

  regAdd([base, '/ve', '/d', 'URL:DSH Desktop Notifier'])
  regAdd([base, '/v', 'URL Protocol', '/d', ''])
  regAdd([`${base}\\shell\\open\\command`, '/ve', '/d', command])

  return command
}

/**
 * Remove the scheme (used by tests and by an uninstall cleanup).
 * A missing key is not an error.
 */
export function unregisterProtocol({ scheme = DEFAULT_SCHEME } = {}) {
  try {
    execFileSync('reg.exe', ['delete', `${CLASSES}\\${scheme}`, '/f'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}
