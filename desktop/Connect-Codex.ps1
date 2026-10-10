$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$codexPath = (Get-Command codex -ErrorAction Stop).Source
$serverName = 'android_control'
$existing = & $codexPath mcp get $serverName --json 2>&1
if ($LASTEXITCODE -eq 0) { throw 'android_control already exists. Inspect the existing configuration before changing it.' }
if (($existing | Out-String) -notmatch 'No MCP server named') { throw 'Cannot inspect the Codex configuration. No changes were made.' }
$configRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
$configFile = Join-Path $configRoot 'config.toml'
if (Test-Path -LiteralPath $configFile) {
    $configText = Get-Content -Raw -LiteralPath $configFile
    if ($configText -match '\[mcp_servers\.android_control\]') { throw 'android_control already exists. Inspect the existing configuration before changing it.' }
    $backupPath = Join-Path $PSScriptRoot '.runtime/config-backups'
    New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $backupPath /inheritance:r /grant:r "*${userSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot protect config backup.' }
    Copy-Item -LiteralPath $configFile -Destination (Join-Path $backupPath ('config-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.toml'))
}
& $codexPath mcp add $serverName -- $nodePath (Join-Path $PSScriptRoot 'src/mcp.mjs') --state (Join-Path $PSScriptRoot '.runtime/broker.json')
if ($LASTEXITCODE -ne 0) { throw 'Codex MCP registration failed.' }
$updated = Get-Content -Raw -LiteralPath $configFile
$marker = '[mcp_servers.android_control]'
if ([regex]::Matches($updated,[regex]::Escape($marker)).Count -ne 1) { throw 'MCP registered, but timeout configuration needs inspection.' }
$updated = $updated.Replace($marker, $marker + "`ntool_timeout_sec = 90")
[IO.File]::WriteAllText($configFile,$updated,[Text.UTF8Encoding]::new($false))
Write-Host 'Codex MCP registered. Reopen the Codex chat/app to load it. Start-Desktop.cmd opens pairing.'
