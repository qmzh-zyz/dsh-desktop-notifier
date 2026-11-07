#requires -Version 5.1
<#
  dsh-desktop-notifier :: focus the DSH window
  ---------------------------------------------------------------------------
  Runs when a toast is clicked (through launch.vbs and the dshnotifier:
  protocol). Restores a minimized window, lifts a window that is buried behind
  other apps, and relaunches the app when it was closed to the tray and no
  window exists any more.

  Pure ASCII on purpose: PowerShell 5.1 decodes a BOM-less .ps1 with the local
  code page, and this script must not be sensitive to that.

  Usage:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File focus.ps1 [-WindowMatch "DeepSeek Harness"] [-AppPath <exe>] [-DryRun]
#>
[CmdletBinding()]
param(
  [string]$WindowMatch = 'DeepSeek Harness',
  [string]$AppPath = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NotifierFocus
{
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    // GetCurrentThreadId lives in kernel32, not user32.
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    public static string TitleOf(IntPtr hWnd)
    {
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }
}
'@

function Emit($obj) {
  try { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5)) } catch { }
}

# A Win32 interop failure must still leave a parsable verdict behind instead of
# an unhandled exception with a stack trace.
trap {
  Emit @{ ok = $false; action = 'error'; error = $_.Exception.Message }
  exit 1
}

# The window that carries the taskbar button. When the app is minimized to the
# tray Electron may report 0 here, which is why the caller passes an exe path.
$target = Get-Process -Name $WindowMatch -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1

if (-not $target) {
  $exe = $AppPath
  if (-not $exe) {
    $any = Get-Process -Name $WindowMatch -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($any) { $exe = $any.Path }
  }
  if ($DryRun) {
    Emit @{ ok = $true; action = 'relaunch-dry-run'; exe = $exe }
    exit 0
  }
  if ($exe -and (Test-Path -LiteralPath $exe)) {
    # A second launch cannot take the single-instance lock, so Electron hands
    # the request to the running instance, which restores its own window.
    Start-Process -FilePath $exe | Out-Null
    Emit @{ ok = $true; action = 'relaunch'; exe = $exe }
    exit 0
  }
  Emit @{ ok = $false; action = 'no-window'; match = $WindowMatch }
  exit 1
}

$handle = [IntPtr]$target.MainWindowHandle
$restored = $false
$shown = $false

if ([NotifierFocus]::IsIconic($handle)) {
  [void][NotifierFocus]::ShowWindow($handle, 9)   # SW_RESTORE
  $restored = $true
}
if (-not [NotifierFocus]::IsWindowVisible($handle)) {
  [void][NotifierFocus]::ShowWindow($handle, 5)   # SW_SHOW
  $shown = $true
}

if (-not $DryRun) {
  # SetForegroundWindow alone is refused while another app owns the foreground
  # lock; attaching to the foreground thread's input queue is the standard way
  # around it, with SwitchToThisWindow as the last resort.
  $foreground = [NotifierFocus]::GetForegroundWindow()
  $foregroundThread = 0
  if ($foreground -ne [IntPtr]::Zero) {
    [void][NotifierFocus]::GetWindowThreadProcessId($foreground, [ref]$foregroundThread)
  }
  $currentThread = [NotifierFocus]::GetCurrentThreadId()

  $attached = $false
  if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
    $attached = [NotifierFocus]::AttachThreadInput($currentThread, $foregroundThread, $true)
  }

  [void][NotifierFocus]::BringWindowToTop($handle)
  $ok = [NotifierFocus]::SetForegroundWindow($handle)

  if ($attached) {
    [void][NotifierFocus]::AttachThreadInput($currentThread, $foregroundThread, $false)
  }

  if (-not $ok) {
    [NotifierFocus]::SwitchToThisWindow($handle, $true)
  }

  # The app can re-hide itself right after being shown (close-to-tray race), so
  # give it a few short chances before reporting failure.
  for ($attempt = 0; $attempt -lt 4; $attempt++) {
    Start-Sleep -Milliseconds 120
    if ([NotifierFocus]::GetForegroundWindow() -eq $handle) { break }
    if ([NotifierFocus]::IsIconic($handle)) { [void][NotifierFocus]::ShowWindow($handle, 9) }
    [void][NotifierFocus]::SetForegroundWindow($handle)
  }
}

$isForeground = ([NotifierFocus]::GetForegroundWindow() -eq $handle)
Emit @{
  ok          = $true
  action      = 'focused'
  restored    = $restored
  shown       = $shown
  foreground  = $isForeground
  hwnd        = [int64]$handle
  title       = [NotifierFocus]::TitleOf($handle)
}
