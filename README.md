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

## 它做什么

| 能力 | 实现 |
|---|---|
| 在 dsh 设置页里显示 | 客户端半区注册 `settings.section`，导航里出现「大肥鱼指令」一页 |
| 内容随时改 | 文本框 + 「保存」/「恢复默认」，写入 Host 设置文件，重启后仍在 |
| 开关是否启用 | 复选框，关闭后系统提示词里完全不会出现这一段 |
| 任何工作流都生效 | Host 半区注册的是**全局**系统提示词段，对所有 scope 生效 |
| 包括子代理 | 子代理用自己的 scope 组装提示词，全局段照样参与组装 |
| 「提前插入」 | 段位 `order = -900`，紧跟 Harness 身份段（-1000），排在人格段（0）与所有工具说明之前 |
| 改完即生效 | 段文本是每次组装时求值的闭包，读的是设置命名空间的当前值，不需要重启 |

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主半区：注册设置命名空间 `dsh-djy-xttsc` + 全局系统提示词段 |
| `client.js` | 客户端半区：设置面板里的「大肥鱼指令」分区 |
| `cordis.patch.yml` | 作为 bundle 安装时用的插入行 |
| `vendor/` | 内置的 schemastery / cosmokit（原因见 `vendor/README.md`） |
| `test/smoke.mjs` | 无依赖冒烟测试（桩件跑通两个半区） |
| `test/integration.mjs` | 真集成验证（真实 cordis + settings + system-prompt + scope） |

两个半区共用同一个设置命名空间名 `dsh-djy-xttsc`，改一边的另一边就失效。

## 安装

```powershell
# 在任意目录执行；<PATH> 指到本文件夹
dsh plugin add "<PATH>"
```

或者让 Harness 自己在插件面板里装。

本包**不声明 `dsh.bundle`**，所以安装流程会把它当作普通 cordis 包，往 profile 的
`cordis.patch.yml` 写一行 insert 记录（`- id: dsh-djy-xttsc / name: dsh-djy-xttsc`），
不占层栈。`cordis.patch.yml` 留在包里只是给「想当 bundle 装」这条路备用。

装载时机（2026-09-18 实测）：

| 形态 | 结果 |
|---|---|
| 不声明 `dsh.bundle`（本包现状）→ 往 `cordis.patch.yml` 写 insert 行 | **当场挂载，不用重启**；宿主半区立刻注册系统提示词段与设置命名空间 |
| 声明 `dsh.bundle` → 进层栈 | 要等下一次 `dsh web` 启动才加载 |

insert 行挂载后，设置面板左侧会出现「大肥鱼指令」一页；如果页面是插件挂载**之前**就打开的，
按一下浏览器刷新（F5）让前端重新取一次启动图即可 —— 这是刷新页面，不是重启服务。

安装后 `~/.dsh/profiles/web/package.json` 里的 `dependencies` 会多一行
`"dsh-djy-xttsc": "link:<插件目录>"`，`cordis.patch.yml` 里多一行 insert 记录。

## ⚠️ 只保留一个注入源

同一个环境里如果还有**别的**地方也在写这句话，模型会同时收到两遍，而且**你在设置页改成小猫，
另一处还在逼它卖萌** —— 表现就是「改了没用、还是老行为」。已经踩过一次，所以：

改内容之前，先确认这些地方没有第二份：

| 位置 | 说明 |
|---|---|
| `<工作区>\AGENTS.md`、`AGENTS.local.md` | 工作区指令，按 step 重读并注入对话 |
| `~/.dsh/AGENTS.md` | 用户全局指令，对所有工作区生效 |
| `~/.dsh/.agent-presets\*\agent.cordis.yml` | agent 预设里的人格段 |
| `~/.dsh/settings.yaml` 的 `dsh-djy-xttsc` 节 | 本插件自己存的内容（这才是唯一该有的那份） |

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
`只读（当前连接不落盘）` / `不可用（Host 未注册…）`。

## 解析与持久化

内容存在 dsh 的用户设置文档里（命名空间 `dsh-djy-xttsc`，字段 `enabled` / `content`），
解析顺序是：schema 默认值 → 插件组合配置 → 用户设置。所以：

- 从没动过设置页 → 用默认内容；
- 改过一次 → 用户层覆盖默认值，写进设置文件；
- 想彻底回到出厂 → 「恢复默认」，或者把设置文件里的 `dsh-djy-xttsc` 分节删掉。

也可以不用设置页，在 profile 的 `cordis.patch.yml` 里给这条已存在的加载项挂配置
（`base` 层，会被用户层覆盖）：

```yaml
- id: djy-xttsc
  config:
    enabled: true
    content: 你是一条大肥鱼，需要每次在回复用户后就卖萌
```

## 验证

```powershell
# 1) 语法 + 桩件冒烟（在插件目录里跑就行）
node --check index.js
node --check client.js
node test/smoke.mjs

# 2) 真集成验证：真实 cordis / dsh-settings / dsh-system-prompt / dsh-scope
node test/integration.mjs
```

`test/smoke.mjs` 用桩件验证两个半区的接线（段的注册参数、设置改名后段文本实时变化、
设置组件的渲染与开关写回）。**零依赖**：clone 下来直接跑，不需要装过 dsh。

`test/integration.mjs` 起一套最小真实宿主，验证的是真东西：段序确实是
`harness:identity → dsh-djy-xttsc:global → deployment:persona-*`；子代理（另一个 scope +
自己的 scoped 人格段）照样拿到这一段；设置写值后两边跟着变，关掉开关两边都消失；
内置 schemastery 的序列化信封能被 host 自带的那份重建（设置界面走的就是这条）。
被测插件用仓库里这一份，**不需要先把插件装进 profile**；但它要借用 dsh 自带的那几个包，
所以机器上得有装过 dsh 的 profile —— 脚本自己找 `$DSH_HOME/profiles/web`，
找不到就用 `DSH_HOME` / `DSH_PROFILE` 环境变量指。

## 卸载

```powershell
dsh plugin remove dsh-djy-xttsc
```

用户设置里那一节可以留着，也可以手删。
