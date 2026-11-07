' A toast click launches this through the registered URI protocol. wscript is
' used instead of powershell.exe because it starts without a console window:
' a black box flashing over the user's screen would defeat the point.
'
' Command line (written by the plugin into HKCU\Software\Classes\dshnotifier):
'   wscript.exe launch.vbs "<uri>" "<focus.ps1>" "<window match>" "<exe>"
Option Explicit

Dim args, shell, focusScript, windowMatch, appPath, command
Set args = WScript.Arguments
Set shell = CreateObject("WScript.Shell")

If args.Count < 3 Then WScript.Quit 1

focusScript = args(1)
windowMatch = args(2)
appPath = ""
If args.Count >= 4 Then appPath = args(3)

command = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ _
  & focusScript & """ -WindowMatch """ & windowMatch & """"

' Only pass an explicit exe when the host had one; focus.ps1 otherwise derives
' the path from the running process.
If Len(appPath) > 0 Then
  command = command & " -AppPath """ & appPath & """"
End If

' 0 = hidden window, False = do not wait for it to finish.
shell.Run command, 0, False
