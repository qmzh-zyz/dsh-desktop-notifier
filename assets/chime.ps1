#requires -Version 5.1
<#
  dsh-desktop-notifier :: chime
  ---------------------------------------------------------------------------
  A short, in-process synthesized chime. No audio file ships with the plugin and
  nothing is downloaded: the waveform is built into a WAV in memory and handed
  to SoundPlayer, which keeps the whole thing synchronous and leak-free.

  Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File chime.ps1 [-Preset chime|beep|rise]
#>
param(
  [ValidateSet('chime', 'beep', 'rise')]
  [string]$Preset = 'chime'
)

$ErrorActionPreference = 'Stop'

$sampleRate = 44100

# note = frequency in Hz, seconds = duration, gain = peak amplitude 0..1
switch ($Preset) {
  'beep' { $notes = @(@{ hz = 880; seconds = 0.12; gain = 0.25 }) }
  'rise' { $notes = @(@{ hz = 660; seconds = 0.11; gain = 0.22 }, @{ hz = 880; seconds = 0.11; gain = 0.22 }, @{ hz = 1320; seconds = 0.14; gain = 0.22 }) }
  default { $notes = @(@{ hz = 880; seconds = 0.13; gain = 0.25 }, @{ hz = 1318; seconds = 0.18; gain = 0.22 }) }
}

$samples = New-Object System.Collections.Generic.List[Int16]
foreach ($note in $notes) {
  $count = [int]($sampleRate * $note.seconds)
  for ($i = 0; $i -lt $count; $i++) {
    $t = $i / $sampleRate
    # Exponential decay keeps the tone from ending with an audible click.
    $envelope = [Math]::Exp(-4.0 * $i / $count)
    $value = [Math]::Sin(2 * [Math]::PI * $note.hz * $t) * $note.gain * $envelope * 32767
    $samples.Add([Int16]$value)
  }
}

$dataBytes = $samples.Count * 2
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $stream

# RIFF/WAVE header: PCM, mono, 16-bit.
$writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
$writer.Write([int](36 + $dataBytes))
$writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVE'))
$writer.Write([System.Text.Encoding]::ASCII.GetBytes('fmt '))
$writer.Write([int]16)
$writer.Write([Int16]1)
$writer.Write([Int16]1)
$writer.Write([int]$sampleRate)
$writer.Write([int]($sampleRate * 2))
$writer.Write([Int16]2)
$writer.Write([Int16]16)
$writer.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
$writer.Write([int]$dataBytes)
foreach ($sample in $samples) { $writer.Write($sample) }
$writer.Flush()

$stream.Position = 0
$player = New-Object System.Media.SoundPlayer $stream
$player.PlaySync()
$player.Dispose()
$stream.Dispose()
