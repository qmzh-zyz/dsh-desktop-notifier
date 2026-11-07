#requires -Version 5.1
<#
  dsh-desktop-notifier :: taskbar overlay helper (ITaskbarList3)
  ---------------------------------------------------------------------------
  The DSH host plugin runs in its own process, so it cannot call Electron's
  setOverlayIcon on the window that owns the taskbar button. Windows lets any
  process paint that overlay through ITaskbarList3 given the HWND, which is what
  this script does.

  Protocol: one command per line on stdin, one state line per command on stdout.
    add          increment the count and redraw the overlay
    tick         clear the overlay when the window has just come to the foreground
    clear        drop the count and remove the overlay
    color <hex>  change the disc colour and redraw a visible overlay
    quit         clear and exit
  Closing stdin also exits, so the helper dies with its host. -ParentPid lets a
  helper whose host vanished exit on its own instead of painting forever.

  -SelfTest renders sample overlays to PNG files and exits; it never touches the
  taskbar, so it is safe in tests and CI.
#>
param(
  [string]$WindowMatch = 'DeepSeek Harness',
  [string]$BadgeColor = '#f5455c',
  [int]$ParentPid = 0,
  [switch]$SelfTest,
  [string]$SelfTestOut = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::ASCII

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
public class TaskbarList { }

[ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITaskbarList3
{
    void HrInit();
    void AddTab(IntPtr hwnd);
    void DeleteTab(IntPtr hwnd);
    void ActivateTab(IntPtr hwnd);
    void SetActiveAlt(IntPtr hwnd);
    void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fFullscreen);
    void SetProgressValue(IntPtr hwnd, ulong ullCompleted, ulong ullTotal);
    void SetProgressState(IntPtr hwnd, int tbpFlags);
    void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
    void UnregisterTab(IntPtr hwndTab);
    void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
    void SetTabActive(IntPtr hwndTab, IntPtr hwndInsertBefore, uint dwReserved);
    void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);
    void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);
    void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
    void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string pszDescription);
    void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string pszTip);
    void SetThumbnailClip(IntPtr hwnd, IntPtr prcClip);
}

public static class Native
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    public static void SetOverlay(IntPtr hwnd, IntPtr hIcon, string description)
    {
        var list = (ITaskbarList3)new TaskbarList();
        list.HrInit();
        list.SetOverlayIcon(hwnd, hIcon, description);
    }
}
'@

Add-Type -AssemblyName System.Drawing

$script:count = 0
$script:hwnd = [IntPtr]::Zero
$script:icon = [IntPtr]::Zero
$script:wasForeground = $false
$script:seenTick = $false

# Components are returned instead of a Color struct: passing a struct through a
# PowerShell function return hands the constructor a string and it throws.
function Get-BadgeRgb([string]$hex) {
  $clean = ($hex -replace '[^0-9a-fA-F]', '')
  if ($clean.Length -eq 3) {
    $clean = $clean[0].ToString() + $clean[0].ToString() + $clean[1].ToString() + $clean[1].ToString() + $clean[2].ToString() + $clean[2].ToString()
  }
  if ($clean.Length -ne 6) { return @(245, 69, 92) }
  try {
    return @(
      [Convert]::ToInt32($clean.Substring(0, 2), 16),
      [Convert]::ToInt32($clean.Substring(2, 2), 16),
      [Convert]::ToInt32($clean.Substring(4, 2), 16)
    )
  } catch {
    return @(245, 69, 92)
  }
}

$script:badgeRgb = Get-BadgeRgb $BadgeColor

function New-BadgeBitmap([int]$value) {
  $text = if ($value -gt 99) { '99' } elseif ($value -gt 0) { [string]$value } else { '' }
  $size = 32

  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $script:badgeRgb[0], $script:badgeRgb[1], $script:badgeRgb[2]))
  $graphics.FillEllipse($brush, 0, 0, $size - 1, $size - 1)

  $font = New-Object System.Drawing.Font('Segoe UI', $(if ($text.Length -gt 1) { 13 } else { 16 }), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $graphics.DrawString($text, $font, [System.Drawing.Brushes]::White, $rect, $format)

  $graphics.Dispose()
  $brush.Dispose()
  $font.Dispose()
  return $bitmap
}

function New-BadgeIcon([int]$value) {
  $bitmap = New-BadgeBitmap $value
  $handle = $bitmap.GetHicon()
  $bitmap.Dispose()
  return $handle
}

# -SelfTest: prove System.Drawing + the colour parser work here, and leave PNGs
# behind that the README and the demo can use.
if ($SelfTest) {
  $outDir = if ($SelfTestOut) { $SelfTestOut } else { (Join-Path (Get-Location) 'build') }
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  foreach ($value in @(1, 3, 12, 99)) {
    $bitmap = New-BadgeBitmap $value
    # Upscale so the PNG is readable in a README at 4x.
    $scaled = New-Object System.Drawing.Bitmap 128, 128
    $scaledGraphics = [System.Drawing.Graphics]::FromImage($scaled)
    $scaledGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $scaledGraphics.DrawImage($bitmap, 0, 0, 128, 128)
    $scaledGraphics.Dispose()
    $file = Join-Path $outDir ("badge-{0}.png" -f $value)
    $scaled.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $scaled.Dispose()
    $bitmap.Dispose()
  }
  Write-Output ("state=self-test rgb={0},{1},{2} out={3}" -f $script:badgeRgb[0], $script:badgeRgb[1], $script:badgeRgb[2], $outDir)
  exit 0
}

function Test-ParentAlive {
  if ($ParentPid -le 0) { return $true }
  return $null -ne (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)
}

function Find-TargetWindow {
  $process = Get-Process -Name $WindowMatch -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($process) { return [IntPtr]$process.MainWindowHandle }
  return [IntPtr]::Zero
}

function Get-TargetWindow {
  if ($script:hwnd -ne [IntPtr]::Zero -and [Native]::IsWindow($script:hwnd)) {
    return $script:hwnd
  }
  $script:hwnd = Find-TargetWindow
  return $script:hwnd
}

function Publish {
  param([int]$Value)

  $window = Get-TargetWindow
  if ($window -eq [IntPtr]::Zero) {
    Write-Output "state=no-window count=$script:count"
    return
  }

  if ($Value -le 0) {
    if ($script:icon -ne [IntPtr]::Zero) {
      [Native]::SetOverlay($window, [IntPtr]::Zero, '')
      [void][Native]::DestroyIcon($script:icon)
      $script:icon = [IntPtr]::Zero
    }
    Write-Output "state=cleared count=0 hwnd=$window"
    return
  }

  $next = New-BadgeIcon $Value
  [Native]::SetOverlay($window, $next, [string]$Value)
  if ($script:icon -ne [IntPtr]::Zero) { [void][Native]::DestroyIcon($script:icon) }
  $script:icon = $next
  Write-Output "state=shown count=$Value hwnd=$window"
}

function Sync-Foreground {
  $window = Get-TargetWindow
  if ($window -eq [IntPtr]::Zero) {
    $script:wasForeground = $false
    return
  }
  $foreground = [Native]::GetForegroundWindow() -eq $window

  # The first tick only records where we start. Without this, a turn that ends
  # while the window is already in front would clear its own badge on the next
  # tick and the user would never see it.
  if (-not $script:seenTick) {
    $script:seenTick = $true
    $script:wasForeground = $foreground
    return
  }

  if ($foreground -and -not $script:wasForeground -and $script:count -gt 0) {
    $script:count = 0
    Publish -Value 0
  }
  $script:wasForeground = $foreground
}

Write-Output "state=ready pid=$PID"

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }

  if (-not (Test-ParentAlive)) {
    $script:count = 0
    try { Publish -Value 0 } catch { }
    Write-Output 'state=parent-gone'
    exit 0
  }

  $command = $line.Trim()
  $lower = $command.ToLowerInvariant()

  if ($lower.StartsWith('color ')) {
    $script:badgeRgb = Get-BadgeRgb $command.Substring(6)
    if ($script:count -gt 0) { Publish -Value $script:count } else { Write-Output 'state=color-only' }
    [Console]::Out.Flush()
    continue
  }

  switch ($lower) {
    'add' {
      $script:count++
      Publish -Value $script:count
    }
    'tick' {
      Sync-Foreground
    }
    'clear' {
      $script:count = 0
      Publish -Value 0
    }
    'quit' {
      $script:count = 0
      try { Publish -Value 0 } catch { }
      Write-Output 'state=bye'
      exit 0
    }
    '' { }
    default {
      Write-Output 'state=unknown-command'
    }
  }
  [Console]::Out.Flush()
}

# stdin closed: the host went away, drop the overlay so nothing is left behind.
$script:count = 0
try { Publish -Value 0 } catch { }
