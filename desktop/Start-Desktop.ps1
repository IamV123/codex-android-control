param([switch]$NoLaunch,[switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$desktopRoot = $PSScriptRoot
$bundledNode = Join-Path $desktopRoot 'node\node.exe'
$nodePath = $null
if (Test-Path -LiteralPath $bundledNode) {
    $nodePath = $bundledNode
} else {
    $pathNode = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($pathNode -and [int]((& $pathNode --version).TrimStart('v').Split('.')[0]) -ge 22) { $nodePath = $pathNode }
}
if (-not $nodePath) {
    $nodeManifest = Get-Content -Raw -LiteralPath (Join-Path $desktopRoot 'node-manifest.json') | ConvertFrom-Json
    $partial = Join-Path $desktopRoot 'node.zip'
    $ok = $false
    for ($attempt = 0; $attempt -lt 3 -and -not $ok; $attempt++) {
        $url = $nodeManifest.urls[$attempt % $nodeManifest.urls.Count]
        try {
            Invoke-WebRequest -Uri $url -OutFile $partial -UseBasicParsing
            $ok = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -eq $nodeManifest.sha256
        } catch {}
    }
    if (-not $ok) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue; throw 'Node.js 下载失败或校验不符。请检查网络后重新双击 Start-Desktop.cmd。' }
    $extractStage = Join-Path $desktopRoot 'node.extract'
    if (Test-Path -LiteralPath $extractStage) { Remove-Item -LiteralPath $extractStage -Recurse -Force }
    Expand-Archive -LiteralPath $partial -DestinationPath $extractStage
    $inner = Get-ChildItem -LiteralPath $extractStage -Directory | Select-Object -First 1
    $nodeDir = Join-Path $desktopRoot 'node'
    if (Test-Path -LiteralPath $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
    Move-Item -LiteralPath $inner.FullName -Destination $nodeDir
    Remove-Item -LiteralPath $extractStage -Recurse -Force
    Remove-Item -LiteralPath $partial -Force
    $nodePath = Join-Path $nodeDir 'node.exe'
    if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 解包失败。请重新双击 Start-Desktop.cmd。' }
}
$npmCmd = Join-Path (Split-Path $nodePath -Parent) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmCmd)) { throw '未找到 npm。请重新双击 Start-Desktop.cmd。' }
Push-Location $desktopRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $desktopRoot 'node_modules/qrcode'))) {
        & $npmCmd ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { & $npmCmd ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com }
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
        $ok = $false
        for ($attempt = 0; $attempt -lt 3 -and -not $ok; $attempt++) {
            try {
                Invoke-WebRequest -Uri $manifest.url -OutFile $partial -UseBasicParsing
                $ok = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.sha256
            } catch {}
        }
        if (-not $ok) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue; throw '通道程序下载失败或校验不符，文件未执行。请检查网络后重新双击 Start-Desktop.cmd。' }
        Move-Item -LiteralPath $partial -Destination $tunnelExe
    }
    if ((Get-FileHash -LiteralPath $tunnelExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw '通道程序校验失败，文件未执行。请检查网络后重新双击 Start-Desktop.cmd。' }
    }
    if (-not $NoLaunch) {
        if ($NoBrowser) { $env:CAC_NO_OPEN_BROWSER='1' }
        & $nodePath (Join-Path $desktopRoot 'src/supervise.mjs')
    }
} finally { Pop-Location }
