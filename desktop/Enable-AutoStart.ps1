$ErrorActionPreference='Stop'
$desktopRoot=(Resolve-Path -LiteralPath $PSScriptRoot).Path
& (Join-Path $desktopRoot 'Start-Desktop.ps1') -NoLaunch
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$entryName='CodexAndroidControl'
$command='powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $desktopRoot 'Start-Desktop.ps1')+'" -NoBrowser'
$existing=$null
if(Test-Path -LiteralPath $runKey){
    $values=Get-ItemProperty -LiteralPath $runKey
    $property=$values.PSObject.Properties[$entryName]
    if($null -ne $property){$existing=[string]$property.Value}
}
if($existing -and $existing -cne $command){throw 'Another installation owns CodexAndroidControl auto-start. Disable it from that installation first.'}
if(!(Test-Path -LiteralPath $runKey)){New-Item -Path $runKey -Force|Out-Null}
New-ItemProperty -LiteralPath $runKey -Name $entryName -Value $command -PropertyType String -Force|Out-Null
if((Get-ItemPropertyValue -LiteralPath $runKey -Name $entryName) -cne $command){throw 'Auto-start readback did not match.'}
Write-Output 'Enabled: this Windows user starts the desktop after sign-in. Pairing and remaining authorization are preserved.'
