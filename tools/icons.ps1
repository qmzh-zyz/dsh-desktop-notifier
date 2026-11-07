#requires -Version 5.1
<#
  dsh-away-alerts :: icon generator
  ---------------------------------------------------------------------------
  Regenerates the PNGs under assets/ with System.Drawing, so the repository
  needs no binary editor and no Python/Pillow dependency.

  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/icons.ps1
#>
[CmdletBinding()]
param(
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $OutDir) {
  $OutDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets'
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Canvas([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Square($canvas, [string]$file) {
  $canvas.Bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
}

# --- approval: amber disc with an exclamation mark -------------------------
function New-ApprovalIcon([int]$size, [string]$file) {
  $canvas = New-Canvas $size
  $g = $canvas.Graphics
  $pad = [single]($size * 0.04)
  $path = New-RoundedPath $pad $pad ($size - 2 * $pad) ($size - 2 * $pad) ([single]($size * 0.22))
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF 0, 0, $size, $size),
    [System.Drawing.Color]::FromArgb(255, 246, 173, 60),
    [System.Drawing.Color]::FromArgb(255, 235, 128, 24),
    90.0)
  $g.FillPath($brush, $path)
  $brush.Dispose()

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $barWidth = [single]($size * 0.13)
  $barHeight = [single]($size * 0.34)
  $barX = [single](($size - $barWidth) / 2)
  $barY = [single]($size * 0.24)
  $g.FillRectangle($white, $barX, $barY, $barWidth, $barHeight)
  $dot = [single]($size * 0.15)
  $g.FillEllipse($white, $barX, [single]($size * 0.66), $dot, $dot)
  $white.Dispose()
  $path.Dispose()
  Save-Square $canvas $file
}

# --- task complete: green disc with a check mark ---------------------------
function New-TaskIcon([int]$size, [string]$file) {
  $canvas = New-Canvas $size
  $g = $canvas.Graphics
  $pad = [single]($size * 0.04)
  $path = New-RoundedPath $pad $pad ($size - 2 * $pad) ($size - 2 * $pad) ([single]($size * 0.22))
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF 0, 0, $size, $size),
    [System.Drawing.Color]::FromArgb(255, 74, 205, 132),
    [System.Drawing.Color]::FromArgb(255, 26, 158, 88),
    90.0)
  $g.FillPath($brush, $path)
  $brush.Dispose()

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([single]($size * 0.1))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $points = @(
    (New-Object System.Drawing.PointF ([single]($size * 0.26)), ([single]($size * 0.52))),
    (New-Object System.Drawing.PointF ([single]($size * 0.44)), ([single]($size * 0.70))),
    (New-Object System.Drawing.PointF ([single]($size * 0.75)), ([single]($size * 0.33)))
  )
  $g.DrawLines($pen, $points)
  $pen.Dispose()
  $path.Dispose()
  Save-Square $canvas $file
}

# --- market card: blue tile with a bell and a red dot ----------------------
function New-MarketIcon([int]$size, [string]$file) {
  $canvas = New-Canvas $size
  $g = $canvas.Graphics
  $path = New-RoundedPath 0 0 $size $size ([single]($size * 0.2))
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF 0, 0, $size, $size),
    [System.Drawing.Color]::FromArgb(255, 62, 110, 240),
    [System.Drawing.Color]::FromArgb(255, 33, 74, 186),
    90.0)
  $g.FillPath($brush, $path)
  $brush.Dispose()

  # Bell: a rounded dome, a trapezoid skirt, a base bar and a clapper.
  # Filled shapes keep the silhouette readable at 64 px.
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $body = @(
    (New-Object System.Drawing.PointF ([single]($size * 0.34)), ([single]($size * 0.42))),
    (New-Object System.Drawing.PointF ([single]($size * 0.66)), ([single]($size * 0.42))),
    (New-Object System.Drawing.PointF ([single]($size * 0.72)), ([single]($size * 0.64))),
    (New-Object System.Drawing.PointF ([single]($size * 0.28)), ([single]($size * 0.64)))
  )
  $g.FillPolygon($white, $body)
  $g.FillEllipse($white, [single]($size * 0.34), [single]($size * 0.28), [single]($size * 0.32), [single]($size * 0.22))
  $g.FillEllipse($white, [single]($size * 0.26), [single]($size * 0.58), [single]($size * 0.48), [single]($size * 0.10))
  $g.FillEllipse($white, [single]($size * 0.44), [single]($size * 0.68), [single]($size * 0.12), [single]($size * 0.12))
  $white.Dispose()

  # Unread dot in the badge red so the icon reads as "there is something new".
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 69, 92))
  $dot = [single]($size * 0.26)
  $g.FillEllipse($red, [single]($size * 0.6), [single]($size * 0.12), $dot, $dot)
  $red.Dispose()
  $path.Dispose()
  Save-Square $canvas $file
}

New-ApprovalIcon 64 (Join-Path $OutDir 'icon-approval.png')
New-TaskIcon 64 (Join-Path $OutDir 'icon-task.png')
New-MarketIcon 180 (Join-Path $OutDir 'icon-180.png')
New-MarketIcon 512 (Join-Path $OutDir 'icon-512.png')

Write-Output ("icons written to {0}" -f $OutDir)
