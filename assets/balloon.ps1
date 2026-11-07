#requires -Version 5.1
<#
  dsh-away-alerts :: tray balloon fallback
  ---------------------------------------------------------------------------
  A WinRT toast needs a package identity (0x80073D54 without one), so it is not
  available on every machine. A Shell_NotifyIcon balloon needs nothing: it is
  the same corner popup as a toast to the user, it lands in the Action Center on
  Windows 10/11, and it plays the system notification sound.

  This script owns the balloon and keeps a message pump alive for its lifetime,
  because a balloon whose process exits immediately disappears with it.

  Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File balloon.ps1 -JsonPath payload.json -Seconds 6
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$JsonPath,
  [int]$Seconds = 6
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Emit($obj) {
  try { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)) } catch { }
}

try {
  $raw = [System.IO.File]::ReadAllText($JsonPath, [System.Text.Encoding]::UTF8)
  $payload = $raw | ConvertFrom-Json
} catch {
  Emit @{ ok = $false; action = 'failed'; error = ('payload unreadable: ' + $_.Exception.Message) }
  exit 2
}

$title = [string]$payload.title
if (-not $title) { $title = 'DeepSeek Harness' }
$body = [string]$payload.body
# A balloon title is one line and about 60 characters wide; the body is what
# carries the detail, so keep the title from being clipped into nonsense.
if ($title.Length -gt 48) { $title = $title.Substring(0, 47) + [char]0x2026 }

$iconHandle = $null
$iconImage = $null
try {
  $logo = [string]$payload.logo
  if ($logo -and (Test-Path -LiteralPath $logo)) {
    $iconImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $logo).Path)
    $bitmap = New-Object System.Drawing.Bitmap $iconImage, 32, 32
    $iconHandle = $bitmap.GetHicon()
    $bitmap.Dispose()
  }
} catch {
  $iconHandle = $null
}

$notify = New-Object System.Windows.Forms.NotifyIcon
if ($iconHandle -ne $null -and $iconHandle -ne [System.IntPtr]::Zero) {
  $notify.Icon = [System.Drawing.Icon]::FromHandle($iconHandle)
} else {
  $notify.Icon = [System.Drawing.SystemIcons]::Information
}
$notify.Text = 'DeepSeek Harness'
$notify.BalloonTipTitle = $title
$notify.BalloonTipText = $body
if ([string]$payload.scenario -eq 'default') {
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
} else {
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
}
$notify.Visible = $true

if ($Seconds -lt 3) { $Seconds = 3 }
if ($Seconds -gt 30) { $Seconds = 30 }
$notify.ShowBalloonTip($Seconds * 1000)
Emit @{ ok = $true; action = 'shown'; channel = 'balloon' }

# Pump messages while the balloon is up: without a live message loop the tray
# icon is torn down and the balloon vanishes the moment the process exits.
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 100
}

$notify.Visible = $false
$notify.Dispose()
if ($iconHandle -ne $null -and $iconHandle -ne [System.IntPtr]::Zero) {
  try { [void][System.Drawing.Icon]::FromHandle($iconHandle) } catch { }
}
if ($iconImage -ne $null) { $iconImage.Dispose() }
