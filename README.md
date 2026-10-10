# Codex 安卓助手 / Codex Android Control

让 Codex 通过你自己的电脑协助操作 Android 手机。**在手机上自己勾选应用，默认不授权任何应用。** 无需 root、ADB 或 VPN。

**当前为电脑端 v0.1.1 / 手机 APK v0.1.0 实验测试版。最低 Android 13，按 Android 16 / API 36 编译。尚未完成真机验收。** 本项目不能保证绝对安全，也不适合无人值守或支付操作。

**连接更新（2026-10-10）：** 原 Cloudflare 临时入口在本工作站发生 HTTPS 连接重置。电脑端 v0.1.1 改用 LocalTunnel 测试入口，已验证真实公网 HTTPS、加密模拟指令往返、管理端口隔离和撤销；手机 APK 无需更新。真实手机及移动网络仍需配对验收，入口可达不等于手机已连接。

[下载 APK 和电脑端包](https://github.com/IamV123/codex-android-control/releases/tag/v0.1.1)

## 授权规则

| 手机上的状态 | Codex 可以做什么 |
| --- | --- |
| 未开启会话 / 已锁屏 / 已过期 | 只能查看电脑侧连接状态，不能控制手机 |
| 会话有效，但应用未勾选 | 返回、回到桌面；不能读取该应用内容、点击或输入 |
| 应用已勾选 | 打开应用、读取当前应用的可访问性文字 |
| 已勾选应用中的点击、输入、滚动 | 每次在手机通知中查看操作，验证锁屏身份后执行 |
| 本助手、系统授权、安装器、系统设置界面 | 不开放远程读屏或操作，基础返回/桌面也会拒绝 |

授权为本机操作：电脑不能增加应用，默认一个都不勾选。修改勾选会撤销当前会话；重新确认才会生效。会话可选 10 或 30 分钟，电脑端配对最多 30 分钟；以先到期者为准。锁屏、停用无障碍、停止通知、连接失败或电脑撤销均终止控制。重新连接需要在电脑点击“重新配对”，再在手机确认。

小红书、微信、快手、抖音以及其他可启动应用，都可以由用户自行选择；是否能读到页面节点取决于应用和手机系统。系统设置、权限管理、安装器、本助手及部分厂商安全中心被固定保护，不列入可选列表。

## 安装与使用

### 手机只需装一个 APK

1. 从上方 Release 下载 `codex-android-control-v0.1.0.apk`，安装到自己的 Android 13+ 手机。
2. 打开“Codex 安卓助手”，允许通知，并手动开启它的无障碍服务。如果手机显示“受限设置”，请按该设备官方说明手动处理；App 不会绕过系统限制。
3. 手机需有锁屏密码。用系统相机/扫码功能扫描电脑配对页的二维码，选择本助手打开；也可把整段配对码粘贴到 App。不同厂商相机不一定支持自定义链接，此时用粘贴方式。
4. **勾选本次允许使用的应用**，选择授权时间，核对电脑地址并验证手机身份。
5. 点击/输入/滚动请求会出现在手机通知里。点开查看具体内容并确认；55 秒不确认即拒绝。点击通知后需要回到原应用，原画面改变则拒绝操作。
6. 用完点通知中的“立即停止”，或锁屏。

请勿把配对码或二维码发到聊天、GitHub 或公共截图。配对码等同密码。不要将银行、支付、工作机密等敏感应用用于首版测试。

### Windows 电脑

1. 安装 [Node.js](https://nodejs.org/) 22 或更高版本，以及已登录的 Codex。
2. 下载并解压 Release 中的 `codex-android-control-v0.1.1-desktop.zip` 到固定目录。
3. 双击 `Start-Desktop.cmd`。首次运行会安装锁定版本的二维码依赖。连接测试通过后，浏览器打开本机配对页面。
4. 第一次运行 `Connect-Codex.ps1`，然后重开 Codex 聊天/应用，载入名为 `android_control` 的 MCP。已有同名配置时脚本会停止，不覆盖它。
5. 手机配对后，可对 Codex 说：“查看手机连接状态”“打开我授权的小红书”。没有真机连接时，工具会明确返回未连接。

电脑需要保持运行和联网。手机和电脑不必在同一 Wi-Fi。默认 LocalTunnel 地址临时变化，只适合测试，不提供可用性保证；其中电脑到中继的一段使用 TCP，业务帧另有端到端加密，详细限制见 SECURITY.md。需要试用原 Cloudflare 通道时，设定 `CAC_TUNNEL_PROVIDER=cloudflare`；启动器会下载并校验固定版本程序。配置自己的固定 HTTPS 入口时，设定 `CAC_PUBLIC_ORIGIN`，并且只代理 `127.0.0.1:18766`；**绝对不要代理管理端口 18765**。

停止电脑端程序会撤销会话。卸载 MCP：`codex mcp remove android_control`。这不会改动其他 MCP 配置。

## 数据与权限

- 手机只主动发起 HTTPS 请求，不在手机上开监听端口，不占用 VPN。
- 配对主密钥为 256 位随机数，应用数据使用 HKDF-SHA256 派生的 AES-256-GCM 密钥加密，绑定方向、会话和递增序号；拒绝篡改及重放。
- 云隧道供应商终止外层 TLS，可以观察连接、时间、体积和派生的传输凭据；在配对密钥未泄露的前提下，应用内容另有加密。电脑和手机必须可信。
- 手机授权和密钥只保存在进程内存；不备份、不记录屏幕文字、输入内容或密钥到日志；不在开机后自动恢复。
- 电脑管理界面只绑定回环地址，与公开手机通道使用不同端口。电脑运行状态文件包含管理密钥，Windows 启动脚本限制目录访问权限。
- 已授权应用的文字会到达电脑，随后可能进入你配置的 AI 服务。密码节点、敏感标志和部分支付/验证码关键词触发拒绝；**这不是完整隐私脱敏，也无法可靠识别所有支付页面。**
- Android 无障碍本身是系统级能力；应用选择由本项目代码检查，**不是 Android 独立的权限沙箱**。不要安装来源不明或自行被修改后的构建。
- 不包含截图、录屏、通知读取、剪贴板、文件浏览、相机、麦克风、任意坐标点击、Shell、ADB、系统设置写入等接口。

完整威胁模型和已知限制见 [SECURITY.md](SECURITY.md)。

## 构建与验证

工具链：JDK 17、Android SDK Platform 36、Build Tools 36.0.0、Gradle 9.1.0、AGP 9.0.0。Gradle 包装器固定发行包校验值。

```powershell
cd desktop
npm ci --ignore-scripts
npm test
cd ..
node tools/test-cross-crypto.mjs
.\gradlew.bat :app:assembleRelease :app:lintRelease
```

不设置签名环境变量时构建 unsigned APK。正式下载 APK 使用项目自己的 release 签名，并且 `debuggable=false`。签名需要环境变量 `CAC_KEYSTORE`、`CAC_STORE_PASSWORD`、`CAC_KEY_PASSWORD`，别名 `release`；密钥绝不放入源码或发布包。更改签名后不能覆盖安装原 APK。

测试分层见 [docs/VALIDATION.md](docs/VALIDATION.md)。本仓库的自动测试不等于真机兼容性或独立安全审计。用户应用页面、后台限制和厂商无障碍行为还需真机验证。

## 项目结构

- `app/`：独立 Java Android App，手机端授权和操作执行。
- `desktop/src/broker.mjs`：分别监听的本机管理服务和加密手机通道。
- `desktop/src/mcp.mjs`：stdio MCP，供 Codex 连接。
- `desktop/src/launch.mjs`：启动临时隧道和配对页。
- `desktop/src/localtunnel.mjs`：仅转发加密手机端口的临时中继适配器，无额外运行依赖。
- `desktop/test/`、`tools/`：协议、安全边界及 Java/Node 加密互通测试。

这是独立实现，不是原项目的官方版本。设计前参考了 [miko684/codex-control-android-mcp](https://github.com/miko684/codex-control-android-mcp) 和 [bsaisuryacharan/android-use](https://github.com/bsaisuryacharan/android-use) 的公开方案；未复制它们的实现代码。二维码依赖 `qrcode`，隧道程序来自 Cloudflare 官方发行版。

MIT License。
