# dsh-mama-cheer

一个快捷键：把一句可配置的鼓励话**直接送进 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 正在进行的对话**——不用离开终端，也不用等这一轮跑完。

```text
按下 ctrl+alt+m  →  消息在最早合法的时机送到模型眼前
```

## 到底做了什么

已经发出去的模型请求无法追加内容（请求早已离开进程，流是单向的）。新消息能到达模型的时间点只有两个，本插件每次按键按当时状态二选一：

| 模型状态 | 投递方式 | 模型看到什么 |
|---|---|---|
| 空闲 | `Agent.followup` | 正常开启下一轮 |
| 运行中，**有工具调用在跑** | `Agent.steer` | 下一个 step 边界读到——**不打断**，正在跑的工具不受影响 |
| 运行中，只在输出文本 | `Agent.cancel({ keepInbox: true })` + `followup` | 半截回答被保留（`interrupted: true`），新一轮立刻读到消息 |

中间那一行就是默认 `smart` 策略的意义：打断工具调用会留下持久的 `tool call aborted before dispatch` 记录和宿主自己的「已被用户中断」提示行；打断纯文本流几乎不损失什么。**只有第三种情况才会真的打断**；不同意这个判断的话，`always` / `never` 一个设置就能改。

设计所依赖的两条事实（都读自已发布代码，其中一条已本机实测）：

- 中断**不会丢弃**已生成内容：`dsh-agent-loop` 会把半截回答以 `assistant/message` + `interrupted: true` 落到模型可见面上，它既留在对话里，也进入下一次请求。
- `Agent.cancel()` 带 `keepInbox: true`——与宿主自己 Ctrl+Enter 路径同一个选项，所以**你已经排队的消息不会被清掉**。

## 安装

```powershell
dsh plugin --profile dsh-tui add dsh-mama-cheer
```

之后在 TUI 内 `/restart` 生效。

开发时用本地源码：

```powershell
dsh plugin --profile dsh-tui add file:C:\path\to\dsh-mama-cheer
```

安装器会把包 `files` 白名单里的文件**硬链接**进 profile，所以在 `lib/` 下新增模块后必须**先 remove 再 add**——只跑 `add` 会打印 "Already up to date" 而什么都不做。

## 兼容性

| 项 | 值 |
|---|---|
| 宿主 | dsh-TUI 0.10.1 一代接缝：`tuiShortcuts`、`tuiSettingsSections`、`tuiToast`，以及公开的 `ctx.agents` 注册表 |
| Manifest | `manifestVersion` 0.15，仅 host facet，**不申请任何权限** |
| 运行时 | Node `^22.19 || >=24`，纯 ESM，无构建步骤（`lib/` 就是发布源码） |
| 平台 | 投递路径与平台无关（它驱动的是 agent inbox）；toast 反馈需要 TUI 的通知出口，没有时降级为只写日志 |

所有宿主服务都是可选的、且会重试到 ACTIVE：缺一个接缝只关掉对应那一项能力（没有快捷键 / 没有设置卡片 / 没有 toast），**永远不会导致启动失败**。

## 配置

每个键都有默认值；缺键 = 行为不变，绝不会导致启动失败。

| 键 | 默认 | 含义 |
|---|---|---|
| `text` | `妈妈加油！` | 送给模型的文本 |
| `combo` | `ctrl+alt+m` | 注册的快捷键，必须含 `ctrl` 或 `alt`（无修饰键与保留键会被宿主拒绝） |
| `interruptMode` | `smart` | `smart` = 仅在没有工具在跑时打断 · `always` = 模型运行中就打断 · `never` = 从不打断，一律 steer |
| `display` | `toast` | `toast` = 瞬时通知，消息不进对话 · `none` = 完全安静 · `bubble` = 显示成普通用户消息 |
| `toastMs` | `3000` | 通知存活时长（宿主钳制在 500–12000 ms） |
| `keepInbox` | `true` | 中断时保留已排队的消息 |
| `retryMs` / `retryLimit` | `400` / `50` | 就绪重试节奏与上限（仅组合配置，不放进设置面板） |

## 设置面板

六个面向用户的键都能在 `/settings` 里直接改（分区名 **Mama Cheer**），带中英标签、提示与下拉选项：

```text
/settings → Mama Cheer
  Cheer message                 [文本]  鼓励文案
  Shortcut                      [文本]  快捷键
  Interrupt policy              [下拉]  Smart | Always interrupt | Never interrupt
  Display                       [下拉]  Toast | Silent | User message
  Toast lifetime (ms)           [数字]  提示停留时长
  Keep my queued messages       [开关]  中断时保留排队消息
```

配置**每次按键都实时读取**——不用重启、不用重装：

- 组合层（composition entry）是基础层，设置层在按键那一刻合并到最上层；
- 改 `Shortcut` 会**立刻重绑**：先注销旧绑定再注册新的，旧快捷键不会继续生效。

## 已知限制

- **「已被用户中断」提示行改不了、删不掉**：它是宿主自己的投影（`dsh-adapter/channel/projection.js`），渲染器接缝明确禁止影子内建事件类型。只有真的发生打断时才会出现。
- **本 build 下无法自定义转写行**：渲染器接缝要求插件先 append 一个 log-only 会话事件，但 `Session.append()` 没有办法写入持久化契约要求的 `ignorable: true` 标记。本机实测：未知且无标记的事件会让会话日志**下次加载时整份被拒绝**（`SessionFormatUnsupportedError`，"refusing to interpret the log"）。因此本插件不写任何自己的会话事件。
- **只在普通聊天状态响应键盘**：选择器 / 对话框 / 场景打开时键盘归它们所有，快捷键不匹配。
- **归属判定是启发式**：单窗口通常只有一个 live agent；若有多个，优先「正在跑」的那个，其次是最近有事件的那个会话。
- **无头宿主没有键盘、也没有 toast 出口**：消息路径仍可用，反馈不可用。

## 发布与版本策略

- 仓库：[VviLliAm-qwq/dsh-mama-cheer](https://github.com/VviLliAm-qwq/dsh-mama-cheer)
- 以 `dsh-mama-cheer` 发布到 npm（`--access public --provenance`）。
- 发布**由 tag 驱动**：推送 `v*` tag 会触发 `.github/workflows/release.yml`，它重跑全套验证、核对 tag 与 `package.json` 版本一致后发布。仓库里**不存任何长期 npm 令牌**——工作流用 OIDC 走 npm 可信发布换取短时凭据。
- 版本遵循 SemVer；每个版本都记入 `CHANGELOG.md`，manifest 版本与包版本同步移动。

## 验证

```text
npm run verify                       # 编码 + manifest + 测试 + 打包布局
node --test                          # 28 项：入口导出形状、分流矩阵、投递行为、设置面板接线
node tools/probe-plugin.mjs <dir>    # 无头真实组合；退出码 0 且日志出现 "shortcut registered ..."
```

通过时的探测输出：

```text
seams settings=1 sections=1 shortcuts=0 agents=1 toast=0
settings namespace dsh-mama-cheer registered
settings section registered
shortcut registered ctrl+alt+m
ready after 2 attempt(s)
VERDICT: PASS — the plugin applied and its registrations were accepted
```

「首拍被拒、重试成功」是接缝的既定行为，不是缺陷。

## 设计说明

- 入口模块（`lib/index.js`）只导出 `name` / `Config` / `apply` 三个符号。多导出会改变宿主对 activation 的包装方式，之后每次接缝注册都会被拒（`requires a live Cordis activation context`）——插件看起来半死不活。
- 可选服务严格优先取用，取不到再宽松兜底；每个注册都重试到提供者 ACTIVE 为止。
- **不申请任何权限**：不拦截、不观察，除自己的日志文件（`~/.dsh-tui/dsh-mama-cheer.log`，上限 64 KB，`node --test` 下不写）外不落任何数据。
- 按键失败被就地兜住：只写日志与 toast，绝不抛出，因此不会影响其他按键绑定。
- 刻意没有 `src/`：插件是纯 ESM、无构建步骤，发布的 `lib/` 就是唯一源码。

## 许可

MIT
