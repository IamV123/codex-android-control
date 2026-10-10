$ErrorActionPreference='Stop'
$desktopRoot=(Resolve-Path -LiteralPath $PSScriptRoot).Path
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$entryName='CodexAndroidControl'
$expected='powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $desktopRoot 'Start-Desktop.ps1')+'" -NoBrowser'
$existing=Get-ItemPropertyValue -LiteralPath $runKey -Name $entryName -ErrorAction SilentlyContinue
if($existing -and $existing -cne $expected){throw 'Another installation owns this entry; it was not changed.'}
if($existing){Remove-ItemProperty -LiteralPath $runKey -Name $entryName}
Write-Output 'Disabled: no other startup entries were changed. Use the dashboard Revoke to end any current phone authorization.'
