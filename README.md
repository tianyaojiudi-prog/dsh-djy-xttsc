# dsh-djy-xttsc — 全局系统提示词注入（DSH 插件）

**DeepSeek Harness 插件**。把一段由你在设置页里随时改写的文字，作为**全局系统提示词段**
注入到每一次模型请求里 —— 本会话、子代理、工作流内部派生的子代理，全都吃到。

> A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that injects a
> **user-editable** system-prompt section into every model request — including subagents and
> workflow-spawned subagents. The text and an on/off switch live on the DSH settings page and
> apply live, with no restart. The Chinese line below is only a placeholder default.

出厂默认内容（**只是占位默认值，写什么就注入什么**）：

```
你是一条大肥鱼，需要每次在回复用户后就卖萌
```

> ⚠️ 插件**不解析、不追加、不改写**你写的内容 —— 原样作为一段系统提示词注入。
> 想换成小猫、换成代码规范、换成英文都行，改完下一个回合就生效。
> 唯一要注意的是别让别的指令通道（`AGENTS.md` 等）同时写同一句，否则会出现
> 「改了没反应」—— 见下面「只保留一个注入源」。

## 兼容性

| dsh 版本 | 内容存哪 | 设置页在哪改 |
|---|---|---|
| **0.1.5 ～ 0.1.6** | 用户设置文件（`settings.yaml` 的 `dsh-djy-xttsc` 节） | 「大肥鱼指令」一页 |
| **0.1.7 ～ 0.2.x**（含 0.2.0-rc.2） | profile 的 `cordis.patch.yml`（这条插件的 config 层） | 「大肥鱼指令」一页（走插件配置表单） |

两边由插件自己认：客户端半区按「哪个设置服务在」挑一条路挂设置页，宿主半区
按 `settings.register` 在不在挑一条路读配置。**同一个版本里只会走一条**，
不会重复注册。

## 它做什么

| 能力 | 实现 |
|---|---|
| 在 dsh 设置页里显示 | 客户端半区注册 `settings.section`，导航里出现「大肥鱼指令」一页 |
| 内容随时改 | 文本框 + 「保存」/「恢复默认」，写入 Host 设置，重启后仍在 |
| 开关是否启用 | 复选框，关闭后系统提示词里完全不会出现这一段 |
| 任何工作流都生效 | Host 半区注册的是**全局**系统提示词段，对所有 scope 生效 |
| 包括子代理 | 子代理用自己的 scope 组装提示词，全局段照样参与组装 |
| 「提前插入」 | 段位 `order = -900`，紧跟 Harness 身份段（-1000），排在人格段（0）与所有工具说明之前 |
| 改完即生效 | 段文本是每次组装时求值的函数，读的是当前配置，不需要重启 |

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主半区：注册全局系统提示词段；两代设置模型都认 |
| `client.js` | 客户端半区：设置面板里的「大肥鱼指令」分区；两代设置传输都认 |
| `cordis.patch.yml` | 作为 bundle 安装时用的插入行（固定条目 id `djy-xttsc`） |
| `vendor/` | 内置的 schemastery / cosmokit（原因见 `vendor/README.md`） |
| `test/smoke.mjs` | 无依赖冒烟测试（桩件跑通两个半区、两代设置模型） |
| `test/integration.mjs` | 真集成验证（真实 cordis + settings + system-prompt + scope） |

两个半区共用同一个设置命名空间名 —— 0.1.6 及以前是 `dsh-djy-xttsc`，
0.1.7 起是**条目 id `djy-xttsc`**（见 `cordis.patch.yml`）。改一处名字就必须改另一处。

## 安装

```powershell
# 在任意目录执行；<PATH> 指到本文件夹（或直接给仓库地址）
dsh plugin add "<PATH>"
```

或者让 Harness 自己在插件面板里装。

本包声明了 `dsh.bundle.patch`，所以安装流程会把它作为 **bundle** 装：往 profile 的
`package.json` 写依赖 + 把 `cordis.patch.yml` 当一层 patch 加载，**当场挂载，不用重启**。
（0.2.0 起，没声明 `dsh.bundle` 的包只会被装成普通依赖并提示
`declares no dsh.bundle`，不会再自动往 profile 里写插入行 —— 所以这里必须声明。）

装完 `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` 会多一行
`"dsh-djy-xttsc": "link:<插件目录>"`（或版本号），`dsh.profile.bundles` 里多一项。

如果页面是插件挂载**之前**打开的，按一下浏览器刷新（F5）让前端重新取一次启动图即可 ——
这是刷新页面，不是重启服务。

### 手工装（不走 `dsh plugin add`）

在 profile 的 `cordis.patch.yml` 里加一条 **id 必须是 `djy-xttsc`** 的插入记录：

```yaml
- insert:
    - id: djy-xttsc
      name: dsh-djy-xttsc
```

id 换了名字，0.1.7 起的设置页就绑不到这条插件的配置。

## ⚠️ 只保留一个注入源

同一个环境里如果还有**别的**地方也在写这句话，模型会同时收到两遍，而且**你在设置页改成小猫，
另一处还在逼它卖萌** —— 表现就是「改了没用、还是老行为」。已经踩过一次，所以：

改内容之前，先确认这些地方没有第二份：

| 位置 | 说明 |
|---|---|
| `<工作区>\AGENTS.md`、`AGENTS.local.md` | 工作区指令，按 step 重读并注入对话 |
| `~/.dsh/AGENTS.md` | 用户全局指令，对所有工作区生效 |
| `~/.dsh/.agent-presets\*\agent.cordis.yml` | agent 预设里的人格段 |
| `~/.dsh/settings.yaml` 的 `dsh-djy-xttsc` 节 | 0.1.6 及以前本插件存的内容 |
| profile 的 `cordis.patch.yml` 里 `id: djy-xttsc` 那条的 `config` | 0.1.7 起本插件存的内容 |

`AGENTS*.md` 那条通道本身很好用（改文件下一个 step 就生效、不用重启），
但**它和本插件别同时开**：它是纯文本、没有开关、内容也不显示在设置页里，
很容易变成你忘了的第二真源。要它就不要插件，要插件就不要它。

## 使用

1. 打开 dsh 设置面板（侧边栏底部齿轮）。
2. 左侧导航点「**大肥鱼指令**」。
3. 勾选/取消「已启用」→ 立即写入并生效。
4. 在文本框里改写内容 → 点「保存」→ 立即写入并生效。
5. 「恢复默认」把内容重置成出厂的那句大肥鱼。

页面底部会显示当前状态：`读取中…` / `已连接 · 写入 Host 设置文件` /
`只读（当前连接不落盘）` / `不可用（Host 未注册这条配置项）`。

## 解析与持久化

解析顺序：schema 默认值 → 插件组合配置（profile patch 的 `config` 层）→ 用户层。

- **0.1.5 ～ 0.1.6**：内容存在 dsh 的用户设置文档里（命名空间 `dsh-djy-xttsc`，
  字段 `enabled` / `content`）。从没动过设置页 → 用默认内容；改过一次 → 用户层覆盖默认值；
  想彻底回到出厂 → 「恢复默认」，或者把设置文件里的 `dsh-djy-xttsc` 分节删掉。
- **0.1.7 起**：`settings.register` 已随设置模型改版移除，改成「按插件的 `Config`
  自动生成配置表单」。`Config` 的每个字段标了 `extra('volatile', true)`：
  设置页写值 → 写进 profile 的 `cordis.patch.yml` → 内核走 **`_commitVolatile`
  「就地提交」**，把新值写进配置里的**运行中引用**（**不重启条目**）→
  段文本函数下次求值就读到新值。

  ⚠️ 这条链路的前提是配置里**确实存在**那种引用：
  `{ get(), [Symbol.for("cosmokit.volatile.write")] }`，而引用是
  `Schema.resolve()` 解析配置时创建的。所以 `Config` 必须由**认 volatile 的**
  schemastery 构造（见 `vendor/README.md`）—— 否则内核会判定「只 volatile 变化、
  **不重启条目**」，却又**找不到引用可写**，变更被**静默丢弃**：
  设置页显示「已保存」、`cordis.patch.yml` 也写对了，但注入内容不变、
  关闭重开又变回旧值，**必须重启 App 才生效**。
  这曾是 1.1.0 的 bug，1.1.1 已修。

也可以不用设置页，直接在 profile 的 `cordis.patch.yml` 里给这条已存在的加载项挂配置
（`base` 层，会被用户层覆盖）：

```yaml
- id: djy-xttsc
  name: dsh-djy-xttsc
  config:
    enabled: true
    content: 你是一条大肥鱼，需要每次在回复用户后就卖萌
```

## 诊断（可选，默认关闭）

排查「设置页保存了但没生效」这类问题时，可以让插件把现场吐出来：

```powershell
# 给 dsh 进程设上，然后重启 dsh
[Environment]::SetEnvironmentVariable('DJY_XTTSC_DIAG', 'on', 'User')
```

之后每轮它读到的配置来源形状、以及渲染出的文本，都会**在变化时**追加一行到
`~/.dsh/djy-xttsc-diag.jsonl`（每行一个 JSON，平时几乎不产生写入）：

```json
{"kind":"activate","schema":"vendor",
 "config":{"isBox":false,"contentIsBox":true,"content":"…"},
 "fiberConfig":{...}}
```

关键字段：

| 字段 | 含义 |
|---|---|
| `schema` | `host` = 用了宿主的 `@deepseek-ai/schemastery`；`vendor` = 退回内置副本（两份现在都支持 volatile）|
| `contentIsBox` | **是否为 `true` 是这条链路能否热更的前提**：配置字段必须是内核可就地提交的「运行中引用」。为 `false` ⇒ 保存会被静默丢弃、必须重启 App |
| `text` | 该轮实际渲染出的注入文本 |

关掉：把变量设成 `on` 以外的任何值（或删掉），重启 dsh。

## 验证

```powershell
# 1) 语法 + 桩件冒烟（在插件目录里跑就行）
node --check index.js
node --check client.js
node test/smoke.mjs

# 2) 真集成验证：真实 cordis / dsh-settings / dsh-system-prompt / dsh-scope
node test/integration.mjs
```

`test/smoke.mjs` 用桩件验证两个半区的接线：段的注册参数、设置改名后段文本实时变化、
设置组件的渲染与开关写回，以及**两代设置服务同时存在时只注册一次设置分区**
（`settings.section` 是 list 槽位，同 id 注册两次会抛错并让条目 failed —— 这是
0.1.7 桌面版被拖进崩溃恢复的根因）。**零依赖**：clone 下来直接跑，不需要装过 dsh。

`test/integration.mjs` 起一套最小真实宿主，并且**自己认版本**：
`settings.register` 在 → 跑旧版那套断言（命名空间、默认值、热改、开关）；
不在 → 跑新版那套（段注册、段序、子代理、schema 信封）。被测插件用仓库里这一份，
**不需要先把插件装进 profile**；但它要借用 dsh 自带的那几个包，所以机器上得有装过 dsh 的
profile —— 脚本自己按 `DSH_HOME` / `DSH_PROFILE` 找（缺省 `~/.dsh`，
`profiles/web` → `profiles/desktop`）。

## 卸载

```powershell
dsh plugin remove dsh-djy-xttsc
```

用户设置里那一节、以及 profile patch 里那条记录可以留着，也可以手删。

## 变更记录

- **1.1.1** —— 修「设置页保存后必须重启 App 才生效」（1.1.0 引入的 bug）：
  - **根因**：`vendor/schemastery.mjs` 是 3.18.0 的副本，**不认 `meta.volatile`**。
    插件导出的是**可调用 schema**，调用它走的是**构造它的那份** `Schema.resolve`，
    于是 `Config` 解析出来全是普通值 —— 内核**没有引用可就地提交**，
    却又因「只 volatile 变化」而**不重启条目**，变更被静默丢弃。
    （实证：诊断里 `contentIsBox: false` ⇒ 修复后 `true`。）
  - `vendor/schemastery.mjs`：**补上 volatile 引用协议**
    （用全局共享符号 `Symbol.for("cosmokit.volatile.write")`，与内核同一颗）。
  - `index.js`：volatile 从**根节点**改到**逐字段**（根标记会被
    `Schema.resolve` 打成一整包，拿不到就地更新）；读取时**逐字段解包**引用。
  - `index.js`：`Config` 优先用宿主的 `@deepseek-ai/schemastery`（三级兜底；
    解析不到时回退内置副本 —— 那份现在也已支持 volatile）。
  - `index.js`：旧设置通道单独喂**不带 volatile** 的 `LegacyConfig`，
    否则 0.1.5 / 0.1.6 的 `settings.register` 拿到引用对象会注册失败。
  - 测试：修掉 smoke 里一条把错误假设固化的断言，新增回归用例；
    integration 加强旧通道断言（专盯上面那条冲突）。
  - 新增**可选**诊断：`DJY_XTTSC_DIAG=on` 时把每轮读到的配置来源形状
    追加到 `~/.dsh/djy-xttsc-diag.jsonl`（默认关）。
- **1.1.0** —— 适配 dsh 0.1.7 ～ 0.2.x 的设置模型改版，同时保持 0.1.5 / 0.1.6 可用：
  - 客户端：`settingsScope`（≤0.1.6）与 `configForms`（≥0.1.7）两条路**互斥**，
    只挂一次设置分区。此前两条路同时挂会用同一个 id 注册两次，list 槽位直接抛错，
    条目变 failed（桌面版表现为启动检查失败 → 崩溃恢复 → profile 被清）。
  - 客户端：`inject` 保持为空，缺服务时安静跳过，不 pending 也不 failed。
  - 宿主：`Config` 标 `extra('volatile', true)`，新版据此生成插件配置表单；
    读取配置时认得 schemastery 的 `Volatile` 包裹（新版 `.get()` 才拿得到值）。
  - 打包：声明 `dsh.bundle.patch`，0.2.0 起安装流程才会把它当 bundle 挂载。
- **1.0.0** —— 首发（面向 dsh 0.1.5）。
