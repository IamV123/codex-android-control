$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { throw '未找到 Node.js。请先安装 Node.js 22 或更高版本（https://nodejs.org），然后重新双击 Connect-Codex.cmd。' }
$desktopRoot = $PSScriptRoot
if ($nodePath.Contains("'") -or $desktopRoot.Contains("'")) { throw 'Node.js 或本文件夹的路径含有单引号，无法自动写入配置。请把它们移到不含单引号的路径后重试。' }
$configRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
$configFile = Join-Path $configRoot 'config.toml'
$block = "[mcp_servers.android_control]`ntool_timeout_sec = 300`ncommand = '$nodePath'`nargs = ['$desktopRoot\src\mcp.mjs', ""--state"", '$desktopRoot\.runtime\broker.json']`n"

function Read-TomlString([string]$raw) {
    $raw = $raw.Trim()
    if ($raw.Length -ge 2 -and $raw.StartsWith("'") -and $raw.EndsWith("'")) { return $raw.Substring(1, $raw.Length - 2) }
    if ($raw.Length -ge 2 -and $raw.StartsWith('"') -and $raw.EndsWith('"')) { return $raw.Substring(1, $raw.Length - 2).Replace('\\', '\') }
    return $raw
}
function Backup-Config {
    $backupPath = Join-Path $desktopRoot '.runtime\config-backups'
    New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $backupPath /inheritance:r /grant:r "*${userSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '无法保护配置备份目录。' }
    Copy-Item -LiteralPath $configFile -Destination (Join-Path $backupPath ('config-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.toml'))
}

$existed = Test-Path -LiteralPath $configFile
$lines = if ($existed) { [IO.File]::ReadAllLines($configFile) } else { @() }
$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*\[mcp_servers\.android_control\]\s*(#.*)?$') { $start = $i; break }
}
if ($start -ge 0) {
    $end = $lines.Count
    for ($i = $start + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*\[' -and $lines[$i] -notmatch '^\s*\[mcp_servers\.android_control[.\]]') { $end = $i; break }
    }
    $command = $null; $argsFound = @()
    foreach ($line in $lines[$start..($end - 1)]) {
        if ($line -match '^\s*command\s*=\s*(.+?)\s*$') { $command = Read-TomlString $Matches[1] }
        if ($line -match '^\s*args\s*=\s*(\[.*\])\s*$') {
            $argsFound = @([regex]::Matches($Matches[1], "'([^']*)'|`"([^`"]*)`"") | ForEach-Object { if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value.Replace('\\', '\') } })
        }
    }
    $expected = @("$desktopRoot\src\mcp.mjs", '--state', "$desktopRoot\.runtime\broker.json")
    $same = ($command -eq $nodePath) -and ($argsFound.Count -eq $expected.Count)
    if ($same) { for ($i = 0; $i -lt $expected.Count; $i++) { if ($argsFound[$i] -ne $expected[$i]) { $same = $false } } }
    if ($same) { Write-Output '已配置过，无需重复运行。'; exit 0 }
    Backup-Config
    $kept = @()
    if ($start -gt 0) { $kept += $lines[0..($start - 1)] }
    if ($end -lt $lines.Count) { $kept += $lines[$end..($lines.Count - 1)] }
    $text = ($kept -join "`n").TrimEnd()
    if ($text) { $text += "`n`n" }
    $text += $block
} elseif ($existed) {
    Backup-Config
    $text = [IO.File]::ReadAllText($configFile)
    if ($text.Length -gt 0) {
        if (-not $text.EndsWith("`n")) { $text += "`n" }
        $text += "`n"
    }
    $text += $block
} else {
    $text = $block
}
New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
[IO.File]::WriteAllText($configFile, $text, [Text.UTF8Encoding]::new($false))
Write-Output '完成：已把手机工具加入 Codex。请完全退出 Codex（包括右下角托盘图标）后重新打开。'
