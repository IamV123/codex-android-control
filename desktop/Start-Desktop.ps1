param([switch]$NoLaunch,[switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$desktopRoot = $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { throw '未找到 Node.js。请先从 https://nodejs.org 安装 Node.js 22 LTS 或更高版本，然后重新双击 Start-Desktop.cmd。' }
$nodeMajor = [int]((& $nodePath --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Node.js 版本过旧。请先从 https://nodejs.org 安装 Node.js 22 LTS 或更高版本，然后重新双击 Start-Desktop.cmd。' }
Push-Location $desktopRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $desktopRoot 'node_modules/qrcode'))) {
        & npm.cmd ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { & npm.cmd ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com }
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。请检查网络后重新双击 Start-Desktop.cmd。' }
    }
    $runtimePath = Join-Path $desktopRoot '.runtime'
    New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $runtimePath /inheritance:r /grant:r "*${userSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '无法设置运行目录的隐私权限。请重新双击 Start-Desktop.cmd。' }
    if (-not $env:CAC_PUBLIC_ORIGIN -and $env:CAC_TUNNEL_PROVIDER -ne 'localtunnel') {
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $desktopRoot 'cloudflared-manifest.json') | ConvertFrom-Json
    $binPath = Join-Path $desktopRoot 'bin'
    New-Item -ItemType Directory -Force -Path $binPath | Out-Null
    $tunnelExe = Join-Path $binPath 'cloudflared.exe'
    if (-not (Test-Path -LiteralPath $tunnelExe)) {
        $partial = Join-Path $binPath 'cloudflared.download'
        Invoke-WebRequest -Uri $manifest.url -OutFile $partial -UseBasicParsing
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw '通道程序下载校验失败，文件未执行。请检查网络后重新双击 Start-Desktop.cmd。' }
        Move-Item -LiteralPath $partial -Destination $tunnelExe
    }
    if ((Get-FileHash -LiteralPath $tunnelExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw '通道程序校验失败，文件未执行。请检查网络后重新双击 Start-Desktop.cmd。' }
    }
    if (-not $NoLaunch) {
        if ($NoBrowser) { $env:CAC_NO_OPEN_BROWSER='1' }
        & $nodePath (Join-Path $desktopRoot 'src/supervise.mjs')
    }
} finally { Pop-Location }
