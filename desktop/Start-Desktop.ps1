param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$desktopRoot = $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { throw 'Install Node.js 22 or newer from https://nodejs.org, then reopen this launcher.' }
$nodeMajor = [int]((& $nodePath --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
Push-Location $desktopRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $desktopRoot 'node_modules/qrcode'))) {
        & npm.cmd ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
    }
    $runtimePath = Join-Path $desktopRoot '.runtime'
    New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $runtimePath /inheritance:r /grant:r "*${userSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict private runtime directory permissions.' }
    if (-not $env:CAC_PUBLIC_ORIGIN -and $env:CAC_TUNNEL_PROVIDER -eq 'cloudflare') {
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $desktopRoot 'cloudflared-manifest.json') | ConvertFrom-Json
    $binPath = Join-Path $desktopRoot 'bin'
    New-Item -ItemType Directory -Force -Path $binPath | Out-Null
    $tunnelExe = Join-Path $binPath 'cloudflared.exe'
    if (-not (Test-Path -LiteralPath $tunnelExe)) {
        $partial = Join-Path $binPath 'cloudflared.download'
        Invoke-WebRequest -Uri $manifest.url -OutFile $partial -UseBasicParsing
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Tunnel download hash mismatch. File was not executed.' }
        Move-Item -LiteralPath $partial -Destination $tunnelExe
    }
    if ((Get-FileHash -LiteralPath $tunnelExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Tunnel client hash mismatch. File was not executed.' }
    }
    if (-not $NoLaunch) { & $nodePath (Join-Path $desktopRoot 'src/launch.mjs') }
} finally { Pop-Location }
