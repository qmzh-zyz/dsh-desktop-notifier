# 更新记录

遵循[语义化版本](https://semver.org/lang/zh-CN/)。

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
