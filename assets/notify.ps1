#requires -Version 5.1
<#
  dsh-desktop-notifier :: Windows notification sender
  ---------------------------------------------------------------------------
  Pure-ASCII on purpose: PowerShell 5.1 decodes a BOM-less .ps1 with the local
  code page, so every localized string travels through the UTF-8 JSON payload.

  Two channels, one entry point:
    * WinRT toast  - rich, honours scenario="urgent"/"alarm" (breaks through
                     Focus Assist and fullscreen) and appLogoOverride.
    * tray balloon - the fallback when the process has no package identity
                     (WinRT answers 0x80073D54). Same bottom-right corner, same
                     action-center entry, still plays the notification sound.

  Usage:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File notify.ps1 -JsonPath payload.json
    powershell.exe ... -FocusOnly -JsonPath payload.json   # just report the foreground

  Payload (UTF-8 JSON):
  {
    "title": "DSH 需要你审批",
    "body": "bash: sandbox escalation ...",
    "appId": "DeepSeek.Harness.DesktopNotifier",
    "displayName": "DeepSeek Harness",
    "iconPath": "C:\\...\\icon.png",
    "logo": "C:\\...\\icon-approval.png",
    "scenario": "auto" | "urgent" | "alarm" | "default",
    "audio": "silent" | "default" | "chime",
    "duration": "short" | "long",
    "skipWhenFocused": true,
    "focusProcesses": ["DeepSeek Harness"],
    "tag": "dsh-away-approval",
    "group": "dsh-desktop-notifier"
  }

  Prints exactly one JSON line, for example:
  {"ok":true,"action":"shown","channel":"toast","scenario":"urgent"}
  {"ok":true,"action":"shown","channel":"balloon","toastError":"..."}
  {"ok":true,"action":"skipped-focus","foreground":"Code"}
  {"ok":true,"action":"focus","focused":false,"foreground":"Code"}
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$JsonPath,
  # Build the toast XML and print it instead of showing anything; used by tests
  # and by machines without a notification platform.
  [switch]$DryRun,
  # Report the foreground window only. The host uses this when the banner is
  # switched off but the taskbar badge still has to know whether the user is
  # looking at DSH.
  [switch]$FocusOnly
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit($obj) {
  try { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)) } catch { }
}

function Focused-ProcessName() {
  try {
    if (-not ('DesktopNotifierWin32' -as [type])) {
      Add-Type -Namespace '' -Name 'DesktopNotifierWin32' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsIconic(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@
    }
    $hwnd = [DesktopNotifierWin32]::GetForegroundWindow()
    if ($hwnd -eq [System.IntPtr]::Zero) { return '' }
    # A minimized window can still be the foreground window. The user tucked DSH
    # away and wants the reminder, so a minimized window never counts as "watching".
    if ([DesktopNotifierWin32]::IsIconic($hwnd)) { return '' }
    if (-not [DesktopNotifierWin32]::IsWindowVisible($hwnd)) { return '' }
    $ownerPid = 0
    [void][DesktopNotifierWin32]::GetWindowThreadProcessId($hwnd, [ref]$ownerPid)
    if (-not $ownerPid) { return '' }
    $process = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    if ($process) { return [string]$process.ProcessName }
    return ''
  } catch { return '' }
}

try {
  $raw = [System.IO.File]::ReadAllText($JsonPath, [System.Text.Encoding]::UTF8)
} catch {
  Emit @{ ok = $false; action = 'failed'; error = ('payload unreadable: ' + $_.Exception.Message) }
  exit 2
}

try { $payload = $raw | ConvertFrom-Json } catch {
  Emit @{ ok = $false; action = 'failed'; error = ('payload invalid json: ' + $_.Exception.Message) }
  exit 2
}

$title = [string]$payload.title
if (-not $title) { $title = 'DeepSeek Harness' }
$body = [string]$payload.body
$appId = [string]$payload.appId
if (-not $appId) { $appId = 'DeepSeek.Harness.DesktopNotifier' }
$displayName = [string]$payload.displayName
if (-not $displayName) { $displayName = 'DeepSeek Harness' }
$iconPath = [string]$payload.iconPath
$logoPath = [string]$payload.logo
$scenario = [string]$payload.scenario
if (-not $scenario) { $scenario = 'auto' }
$skipWhenFocused = $true
if ($null -ne $payload.skipWhenFocused) { $skipWhenFocused = [bool]$payload.skipWhenFocused }

$focusNames = @()
if ($payload.focusProcesses) { $focusNames = @($payload.focusProcesses) }
if ($focusNames.Count -eq 0) { $focusNames = @('DeepSeek Harness') }
$foreground = Focused-ProcessName
$isFocused = $false
foreach ($candidate in $focusNames) {
  if ($foreground -and $foreground.ToLowerInvariant() -eq ([string]$candidate).ToLowerInvariant()) {
    $isFocused = $true
    break
  }
}

# ---- focus probe ---------------------------------------------------------
if ($FocusOnly) {
  Emit @{ ok = $true; action = 'focus'; focused = $isFocused; foreground = $foreground }
  exit 0
}

# ---- focus gate ----------------------------------------------------------
if ($skipWhenFocused -and -not $DryRun -and $isFocused) {
  Emit @{ ok = $true; action = 'skipped-focus'; foreground = $foreground }
  exit 0
}

# ---- register the per-user AppUserModelID (idempotent) -------------------
# An unpackaged app has no Start-menu shortcut for Windows to read an AUMID
# from, so the banner would be dropped. This key gives it one, per user, with
# no administrator rights. It is what makes the toast path work on hosts that
# do have a notification platform available.
try {
  if (-not $DryRun) {
    $regPath = 'HKCU:\Software\Classes\AppUserModelId\' + $appId
    if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
    New-ItemProperty -Path $regPath -Name 'DisplayName' -Value $displayName -PropertyType String -Force | Out-Null
    if ($iconPath -and (Test-Path -LiteralPath $iconPath)) {
      New-ItemProperty -Path $regPath -Name 'IconUri' -Value $iconPath -PropertyType String -Force | Out-Null
    }
    New-ItemProperty -Path $regPath -Name 'ShowInSettings' -Value 1 -PropertyType DWord -Force | Out-Null
  }
} catch { }

function Xml-Escape($value) {
  if ($null -eq $value) { return '' }
  return [System.Security.SecurityElement]::Escape([string]$value)
}

# ---- channel 1: WinRT toast ---------------------------------------------
$toastError = ''
$toastShown = $false
$scenarioUsed = 'default'

try {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

  $audioMode = [string]$payload.audio
  if (-not $audioMode) { $audioMode = 'default' }
  switch ($audioMode) {
    'silent' { $audioXml = '<audio silent="true" />' }
    'chime' { $audioXml = '<audio src="ms-winsoundevent:Notification.IM" />' }
    default { $audioXml = '<audio src="ms-winsoundevent:Notification.Default" />' }
  }

  $toastDuration = 'long'
  if ([string]$payload.duration -eq 'short') { $toastDuration = 'short' }

  # urgent (Windows 11) and alarm (Windows 10) are the only two reminder
  # classes Windows lets through Do Not Disturb / Focus Assist and fullscreen.
  switch ($scenario) {
    'urgent' { $candidates = @('urgent', 'alarm', 'default') }
    'alarm' { $candidates = @('alarm', 'default') }
    'default' { $candidates = @('default') }
    default { $candidates = @('urgent', 'alarm', 'default') }
  }

  # Without an explicit image Windows shows the AUMID icon, which for an
  # unpackaged app is a generic placeholder. An absolute file URI keeps the
  # mark that matches the message (amber "!" = approval, green check = done).
  $logoXml = ''
  if ($logoPath -and (Test-Path -LiteralPath $logoPath)) {
    try {
      $logoSrc = (New-Object System.Uri -ArgumentList (Resolve-Path -LiteralPath $logoPath).Path).AbsoluteUri
      $logoXml = '<image placement="appLogoOverride" hint-crop="none" src="' + (Xml-Escape $logoSrc) + '" />'
    } catch { $logoXml = '' }
  }

  # A toast cannot activate an unpackaged app (there is no COM activator to
  # launch), but Windows will happily ShellExecute a URI. lib/protocol.mjs
  # registers the dshnotifier: scheme under HKCU; declaring
  # activationType="protocol" is what makes a click go through it.
  $launchAttr = ''
  $launchUri = [string]$payload.launch
  if ($launchUri) {
    $launchAttr = ' activationType="protocol" launch="' + (Xml-Escape $launchUri) + '"'
  }

  $candidateXml = ''
  foreach ($candidate in $candidates) {
    $scenarioAttr = ''
    if ($candidate -ne 'default') { $scenarioAttr = ' scenario="' + $candidate + '"' }
    $xml = '<toast' + $scenarioAttr + ' duration="' + $toastDuration + '"' + $launchAttr + '><visual><binding template="ToastGeneric">' +
      $logoXml + '<text>' + (Xml-Escape $title) + '</text><text>' + (Xml-Escape $body) + '</text></binding></visual>' +
      $audioXml + '</toast>'
    $candidateXml = $xml
    break
  }

  if ($DryRun) {
    Emit @{ ok = $true; action = 'dry-run'; scenario = $candidates[0]; xml = $candidateXml }
    exit 0
  }

  $notifier = $null
  try {
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
  } catch {
    $toastError = $_.Exception.Message
  }

  if ($notifier -ne $null) {
    foreach ($candidate in $candidates) {
      $scenarioAttr = ''
      if ($candidate -ne 'default') { $scenarioAttr = ' scenario="' + $candidate + '"' }
      $xml = '<toast' + $scenarioAttr + ' duration="' + $toastDuration + '"' + $launchAttr + '><visual><binding template="ToastGeneric">' +
        $logoXml + '<text>' + (Xml-Escape $title) + '</text><text>' + (Xml-Escape $body) + '</text></binding></visual>' +
        $audioXml + '</toast>'
      $document = New-Object Windows.Data.Xml.Dom.XmlDocument
      try {
        $document.LoadXml($xml)
      } catch {
        $toastError = $_.Exception.Message
        continue
      }
      try {
        $toast = New-Object Windows.UI.Notifications.ToastNotification $document
        try { $toast.Priority = [Windows.UI.Notifications.ToastNotificationPriority]::High } catch { }
        try {
          $tag = [string]$payload.tag
          if ($tag) {
            $group = [string]$payload.group
            if (-not $group) { $group = 'dsh-desktop-notifier' }
            $toast.Tag = $tag
            $toast.Group = $group
          }
        } catch { }
        $notifier.Show($toast)
        $toastShown = $true
        $scenarioUsed = $candidate
        break
      } catch {
        $toastError = $_.Exception.Message
      }
    }
  }
} catch {
  $toastError = $_.Exception.Message
}

if ($toastShown) {
  Emit @{ ok = $true; action = 'shown'; channel = 'toast'; scenario = $scenarioUsed; foreground = $foreground }
  exit 0
}

# ---- channel 2: tray balloon --------------------------------------------
# No package identity means WinRT refuses every notifier (0x80073D54). A tray
# balloon needs nothing and lands in the same corner, so fall back to it rather
# than dropping the reminder.
try {
  $balloonScript = Join-Path $PSScriptRoot 'balloon.ps1'
  $powershell = Join-Path $PSHOME 'powershell.exe'
  if (-not (Test-Path -LiteralPath $powershell)) { $powershell = 'powershell.exe' }
  $seconds = 8
  if ([string]$payload.duration -eq 'short') { $seconds = 5 }
  $argumentList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $balloonScript, '-JsonPath', (Resolve-Path -LiteralPath $JsonPath).Path, '-Seconds', [string]$seconds)
  Start-Process -FilePath $powershell -ArgumentList $argumentList -WindowStyle Hidden | Out-Null
  Emit @{ ok = $true; action = 'shown'; channel = 'balloon'; foreground = $foreground; toastError = $toastError }
  exit 0
} catch {
  Emit @{ ok = $false; action = 'failed'; error = ('balloon fallback failed: ' + $_.Exception.Message); toastError = $toastError }
  exit 1
}
