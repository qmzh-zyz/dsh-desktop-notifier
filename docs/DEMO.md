# 演示素材：文字说明、截图、录屏脚本

这份文档给三种用途：**一段可以直接贴出去的演示文字**、**一张能放进 README 的截图**、**一份照着做就能录出 30 秒短片的脚本**。

---

## 一、演示文字（可直接用作视频简介 / 动态 / 群公告）

> **DSH 最小化之后，审批和完成都不会再被错过。**
>
> 装上 `dsh-away-alerts` 以后，DSH 需要你点头时不用再盯着窗口：哪怕你切去看视频、开着全屏、或者把窗口最小化，桌面右下角也会弹出「DSH 需要你审批」，写明是哪个工具、为什么要提权，点「允许一次」就能继续。
>
> 任务跑完时，任务栏上的 DSH 图标会挂一个红色数字角标，跑完几个就显示几个，同时响一声提示音。切回 DSH，角标自己消失。
>
> 一个插件，零依赖，只用 Windows 自带的 PowerShell。装完就是这样：

配图建议：`docs/screenshots/toast-closeup.png`（通知 + 角标同框），或录屏 GIF。

**更短的一句话版：**

> 最小化 DSH 时：审批弹右下角，完成挂任务栏角标 + 响一声。

---

## 二、截图

### 已生成的图

| 文件 | 内容 | 用途 |
| --- | --- | --- |
| `docs/screenshots/demo-both.png` | 1600×900 桌面全景：两条通知 + 任务栏红色角标 3 | 头图、README 首屏 |
| `docs/screenshots/toast-closeup.png` | 600×400 特写：审批通知 + 完成通知 | README 正文、动态配图 |
| `docs/screenshots/demo-approval.png` | 只有审批通知 | 「审批」单独讲解 |
| `docs/screenshots/demo-done.png` | 只有完成通知 + 角标 | 「完成」单独讲解 |

这些图由 `demo/index.html` 渲染，可随时重出：

```powershell
# 需要 Edge（Windows 自带）
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$demo = (Resolve-Path .\demo\index.html).Path
$url  = 'file:///' + ($demo -replace '\\','/') + '?static=1&state=both'
& $edge --headless=new --disable-gpu --hide-scrollbars --window-size=1600,900 `
        --screenshot="$PWD\docs\screenshots\demo-both.png" $url
```

`state` 可取 `both` / `approval` / `done`。演示页也可以直接双击 `demo/index.html` 打开，按空格或点按钮重放动画。

### 真机截图（建议也放一张）

1. 装好插件，把 DSH 最小化；
2. 在 DSH 里发一条会触发审批的消息（比如让它写工作区外的文件、或执行需要沙箱提权的命令）；
3. 审批到达时按 `Win+Shift+S` 截右下角，保存为 `docs/screenshots/real-toast.png`；
4. 让它跑一个长任务，最小化，完成时截任务栏，保存为 `docs/screenshots/real-badge.png`。

> 录真机图前先清空通知中心，避免旧通知入镜；桌面壁纸和浏览器标签页也检查一下，别拍进隐私内容。

---

## 三、录屏脚本（约 30 秒）

### 分镜

| 时间 | 画面 | 操作 | 旁白（可后期配音或字幕） |
| --- | --- | --- | --- |
| 0:00–0:04 | DSH 窗口里停在审批卡片上 | 不动 | 「DSH 的审批卡片只在窗口里 —— 你切走了，它就一直挂在那儿。」 |
| 0:04–0:08 | 切到浏览器 / 播放器，DSH 最小化 | `Win+D` 或点浏览器 | 「以前这时候，任务就卡住了。」 |
| 0:08–0:12 | 右下角弹出审批通知，带琥珀色叹号图标 | 等动画走完 | 「装上 dsh-away-alerts：审批直接弹到桌面右下角，写清楚是哪个工具、为什么要提权。」 |
| 0:12–0:16 | 回到 DSH，点「允许一次」 | 点击 | 「允许一次，任务继续。」 |
| 0:16–0:20 | 切走，让任务跑完 | 切到浏览器 | 「跑完之后，不用回来找 ——」 |
| 0:20–0:26 | 任务栏 DSH 图标出现红色角标 + 提示音 | 镜头对准任务栏 | 「任务栏图标挂上角标，跑完几个显示几个，还会响一声。」 |
| 0:26–0:30 | 切回 DSH，角标消失 | 点击任务栏图标 | 「切回来，角标自己消失。就这些，零依赖，装完即用。」 |

### 录制方式

**A. 系统自带（最省事）**

- `Win + G` 打开 Xbox Game Bar → 点录制 → 只录 DSH 窗口；结束在「捕获」面板里找到 mp4。
- 缺点：录不到桌面右下角的系统通知（它只录单个窗口）。

**B. OBS（推荐，能录全屏和系统通知）**

1. 来源 → 显示器采集；
2. 输出 → 录制格式 `mp4`，分辨率 1920×1080，帧率 30；
3. 开始录制后按上面的分镜走一遍；
4. 录完用下面的命令压成 GIF（GitHub README 用）：

```powershell
# 需要 ffmpeg
ffmpeg -i demo.mp4 -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 demo.gif
```

GIF 控制在 6 MB 以内，超过就降到 `fps=10,scale=800:-1`。

### 录制前的检查清单

- [ ] 插件已装好，`node tools/demo.mjs focus` 返回 `"focused":false`（说明焦点判断正常）；
- [ ] 通知中心已清空；
- [ ] 系统「专注助手 / 勿扰」按演示需要设置：想展示穿透就打开勿扰，再触发审批；
- [ ] 浏览器只留有必要的标签页；
- [ ] 显示器缩放 100% 或 125%，通知不会被裁切；
- [ ] 先空跑一遍流程，确认审批真的会触发（用 `node tools/demo.mjs toast approval` 预热一次也可以）。

### 没有真机时的替代素材

演示页可以当「动图」素材：打开 `demo/index.html`，按空格重放，再用 OBS 录这个页面（记得标注「效果演示」）。

---

## 四、素材清单

```
docs/
  DEMO.md                      ← 本文件
  screenshots/
    demo-both.png              ← 1600×900 全景
    demo-approval.png          ← 单独审批
    demo-done.png              ← 单独完成 + 角标
    toast-closeup.png          ← 600×400 特写
demo/
  index.html                   ← 可控演示页（截图与动图都从它来）
```

真机素材建议命名：`real-toast.png`（右下角通知）、`real-badge.png`（任务栏角标）、`demo.gif`（30 秒流程）。
