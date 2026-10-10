$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Version = '0.1.11'
$base = if ($env:CAC_INSTALL_BASE) { $env:CAC_INSTALL_BASE } else { "https://github.com/IamV123/codex-android-control/releases/download/v$Version" }
$target = if ($env:CAC_INSTALL_TARGET) { $env:CAC_INSTALL_TARGET } else { Join-Path $env:USERPROFILE 'CodexAndroidControl' }
$installStart = Get-Date
$work = $null
function Stop-Install([string]$message) { Write-Output $message; exit 1 }
try {
    if ($target.Contains("'")) { Stop-Install '安装路径含有单引号，无法继续。' }
    $desktopDir = Join-Path $target 'desktop'

    $work = Join-Path $env:TEMP ('cac-install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    function Fetch([string]$name, [string]$dest) {
        for ($i = 1; $i -le 3; $i++) {
            try {
                if ($base -match '^https?://') { Invoke-WebRequest -Uri ($base.TrimEnd('/') + '/' + $name) -OutFile $dest -UseBasicParsing }
                else { Copy-Item -LiteralPath (Join-Path $base $name) -Destination $dest -Force }
                return
            } catch {
                if ($i -eq 3) { Stop-Install "下载 $name 失败。请检查网络后，重新运行同一条命令。" }
                Start-Sleep -Seconds 2
            }
        }
    }
    Write-Output '正在下载校验信息…'
    $sumsFile = Join-Path $work 'SHA256SUMS.txt'
    Fetch 'SHA256SUMS.txt' $sumsFile
    $zipName = "codex-android-control-v$Version-desktop.zip"
    $expected = ((Get-Content -LiteralPath $sumsFile | Where-Object { $_ -match [regex]::Escape($zipName) }) -split '\s+')[0].ToLowerInvariant()
    if (-not $expected) { Stop-Install '校验信息中找不到桌面压缩包的条目。' }
    Write-Output '正在下载电脑端程序…'
    $zipFile = Join-Path $work $zipName
    Fetch $zipName $zipFile
    if ((Get-FileHash -LiteralPath $zipFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { Stop-Install '下载的压缩包校验不符，已取消安装。请重新运行同一条命令。' }

    $listenPids = @{}
    try {
        Get-NetTCPConnection -State Listen -LocalPort 18764, 18765, 18766 -ErrorAction Stop | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | ForEach-Object { $listenPids[[int]$_.OwningProcess] = $true }
    } catch {
        netstat -ano 2>$null | ForEach-Object {
            if ($_ -match '127\.0\.0\.1:(?:18764|18765|18766)\s+\S+\s+LISTENING\s+(\d+)') { $listenPids[[int]$Matches[1]] = $true }
        }
    }
    $stoppedDesks = @{}
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID } | ForEach-Object {
        $cl = $_.CommandLine; $desk = $null
        if ($cl -match '.*([A-Za-z]:[\\/][^"]*?)[\\/]src[\\/](?:supervise|launch)\.mjs') {
            $candidate = $Matches[1].Trim()
            if ($listenPids.ContainsKey([int]$_.ProcessId) -or ($_.Name -eq 'node.exe' -and $cl -match '[\\/]desktop[\\/]src[\\/]')) { $desk = $candidate }
        } elseif ($cl -match '--url +http://127\.0\.0\.1:18766' -and $cl -match '.*([A-Za-z]:[\\/][^"]*?)[\\/]bin[\\/]cloudflared\.exe') {
            $desk = $Matches[1].Trim()
        }
        if ($desk) {
            if (-not $stoppedDesks.ContainsKey($desk)) { $stoppedDesks[$desk] = @() }
            $stoppedDesks[$desk] += $_.ProcessId
        }
    }
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID } | ForEach-Object {
        foreach ($desk in @($stoppedDesks.Keys)) {
            if (($_.Name -eq 'powershell.exe' -and $_.CommandLine -match [regex]::Escape($desk + '\Start-Desktop.ps1')) -or
                ($_.Name -eq 'cmd.exe' -and $_.CommandLine -match [regex]::Escape($desk + '\Start-Desktop.cmd'))) {
                $stoppedDesks[$desk] += $_.ProcessId
            }
        }
    }
    foreach ($desk in @($stoppedDesks.Keys)) {
        Write-Output "正在停止旧版电脑端：$desk"
        foreach ($procId in $stoppedDesks[$desk]) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
    if ($stoppedDesks.Count) { Start-Sleep -Seconds 2 }

    Write-Output '正在安装文件…'
    $stage = Join-Path $work 'extracted'
    Expand-Archive -LiteralPath $zipFile -DestinationPath $stage
    New-Item -ItemType Directory -Force -Path $desktopDir | Out-Null
    # 压缩包里没有 .runtime、node、node_modules、bin，覆盖复制会保留这些目录。
    Copy-Item -Path (Join-Path $stage '*') -Destination $desktopDir -Recurse -Force

    Write-Output '正在准备运行环境（第一次会下载 Node.js 和通道程序，可能需要几分钟）…'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desktopDir 'Start-Desktop.ps1') -NoLaunch
    if ($LASTEXITCODE -ne 0) { Stop-Install '运行环境准备失败。请查看上面的错误信息，然后重新运行同一条命令。' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desktopDir 'Connect-Codex.ps1')
    if ($LASTEXITCODE -ne 0) { Stop-Install '写入 Codex 配置失败。请查看上面的错误信息，然后重新运行同一条命令。' }

    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '启动 Codex 手机助手.lnk'))
    $shortcut.TargetPath = Join-Path $desktopDir 'Start-Desktop.cmd'
    $shortcut.WorkingDirectory = $desktopDir
    $shortcut.Save()

    Write-Output '正在启动电脑端（会打开一个黑色窗口，请不要关闭）…'
    Start-Process -FilePath (Join-Path $desktopDir 'Start-Desktop.cmd')
    $brokerJson = Join-Path $desktopDir '.runtime\broker.json'
    $deadline = (Get-Date).AddSeconds(300)
    $waited = 0; $ready = $false
    while ((Get-Date) -lt $deadline) {
        try {
            if ((Test-Path -LiteralPath $brokerJson) -and (Get-Item -LiteralPath $brokerJson).LastWriteTime -ge $installStart) {
                $state = Get-Content -LiteralPath $brokerJson -Raw | ConvertFrom-Json
                if ($state.version -eq $Version -and (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue)) {
                    $status = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $state.port + '/api/status') -Headers @{ 'X-Admin-Key' = $state.key } -TimeoutSec 5
                    if ($status.active -eq $true) { $ready = $true; break }
                }
            }
        } catch {}
        $waited += 10
        Write-Output "等待手机通道就绪…（已等待 $waited 秒，通常 1–3 分钟）"
        Start-Sleep -Seconds 10
    }
    if (-not $ready) { Stop-Install '启动超时：新打开的电脑端窗口里显示了原因。请按窗口提示处理后，重新运行同一条命令。' }

    Write-Output '安装完成，电脑端已就绪，配对网页：http://127.0.0.1:18765/ （浏览器没自动打开就手动打开）。'
    Write-Output "安装位置：$desktopDir"
    Write-Output '接下来：'
    Write-Output '1. 完全退出 Codex（包括右下角托盘图标），重新打开，新建一个任务。'
    Write-Output '2. 手机安装 App：用手机相机扫配对网页上的“下载手机 App”二维码，或在手机浏览器打开 https://github.com/IamV123/codex-android-control/releases/latest/download/codex-android-control.apk'
    Write-Output '3. 手机打开 Codex 安卓助手，点“开启通知”“开启无障碍服务”，再用手机相机扫配对网页上的“配对二维码”，勾选允许操作的应用，点“确认并开始”。'
    Write-Output '4. 手机显示“已连接电脑”后，在 Codex 新任务里直接说要做什么，例如：用手机打开抖音刷5个视频。'
    Write-Output '电脑重启后：双击桌面上的“启动 Codex 手机助手”，手机重新扫配对二维码。'
    exit 0
} catch {
    Write-Output ('安装失败：' + $_.Exception.Message)
    exit 1
} finally {
    if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
