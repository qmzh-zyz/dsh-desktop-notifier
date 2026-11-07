# 更新记录

遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## 0.2.0

- **点通知切回 DSH**：toast 现在带 `activationType="protocol" launch="dshnotifier:focus"`，插件在加载时按用户注册 `HKCU\Software\Classes\dshnotifier`（无需管理员）。点击通知会跑 `assets/launch.vbs` → `assets/focus.ps1`：最小化的窗口还原、被挡住的窗口提到最前；DSH 已退出时用注册时记录的 exe 重新拉起。wscript 负责启动，所以不会闪黑框。
- 新配置 `clickToFocus`（默认开）与 `appPath`（可选，DSH 的 exe 绝对路径）。
- `notify.ps1` 支持 `launch` 字段；托盘气泡降级通道不支持点击激活，行为不变。
- 测试从 33 个增至 39 个：协议命令拼装、`launch` 字段、`appPath` 归一化。
- CI 增加 `focus.ps1 -DryRun` 冒烟（验证 Win32 互操作类型能加载、脚本能给出结论）。

## 0.1.2

- **中文展示名定为「DSH桌面通知」**：README 标题、`package.json` 描述、GitHub 简介与 release 标题统一用这个名字；包名与仓库名仍是 `dsh-desktop-notifier`（npm 与 GitHub 的名称只接受 ASCII，中文只用于展示）。
- 功能无变化。

## 0.1.1

- **提示音改由插件自己发声**：toast 一律 `<audio silent="true">`，改由 `assets/chime.ps1` 合成并播放。此前声音挂在通知的 `<audio src="ms-winsoundevent:Notification.Default">` 上，系统关掉「通知声音」时整条提醒就是静音的——而这恰恰是不少人的设置。
- 审批与完成用不同音色：审批两音 `chime`、完成三音上行 `rise`；音量整体上调（0.25 → 0.3–0.35），单声时长加长。
- 只有弹窗**真的显示**（`action: "shown"`）才发声：因为 DSH 在前台而跳过的提醒不会突然响一声。
- `README` 补充说明声音由插件合成、不依赖系统通知音设置。

## 0.1.0

首个版本。

- **审批通知**：监听 `approval/request`（`prepend + global`），在桌面右下角弹通知，写明工具名与申请原因；DSH 在前台时不打扰；同一 `callId` 5 秒内只报一次；可选追加提醒（`approval.repeat`），审批被处理或取消后立即停止。
- **完成角标**：`session/event` 的 `turn/end`（`reason.kind === 'completed'`）在 DSH 任务栏按钮上叠红色数字角标，`ITaskbarList3::SetOverlayIcon` 由常驻的 `assets/badge.ps1` 绘制；窗口切回前台自动清零；子代理回合不计入；短于 `minTurnMs` 的回合忽略。
- **提示音**：完成时随通知响一声；关掉通知时用内置合成的 chime 补一声。
- **双通道通知**：优先 WinRT toast（`scenario=urgent/alarm`，可穿透勿扰与全屏，支持 `appLogoOverride`）；进程没有包标识（`0x80073D54`）时自动降级为托盘气泡，不再丢提醒。
- **零依赖**：宿主侧只用 Node 内置模块，通知/角标/提示音全部由系统自带 PowerShell 5.1 完成。
- 资源：`icon-approval.png` / `icon-task.png` / `icon-180.png` / `icon-512.png` 由 `tools/icons.ps1` 用 System.Drawing 生成。
- 演示：`demo/index.html` 演示页 + `docs/screenshots/*` 截图 + `docs/DEMO.md` 录屏脚本；`tools/demo.mjs` 可单独驱动真实通知、角标与提示音。
- 测试：33 个 `node:test` 用例，覆盖配置归一化、完成判定、角标/通知决策、审批监听（去重、透传、异常隔离）与插件挂载契约。
