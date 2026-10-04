# vendor —— 内置依赖

这两个文件不是本插件写的，是从 dsh 自带依赖里原样拷进来的，目的是让插件**零裸包导入**：

安装本插件时，pnpm 用的是 `link:`（软链接到源码目录）而不是 `file:`（硬链接副本）。
Node 解析模块时会用源目录当真实路径，于是 `import z from 'schemastery'` 会
`ERR_MODULE_NOT_FOUND`（源码目录不在任何 node_modules 链上）。
改成同目录的相对导入后，无论插件是被软链接、硬链接、复制还是打包安装，都能加载。

| 文件 | 来源 | 版本 | 许可 |
|---|---|---|---|
| `schemastery.mjs` | [schemastery](https://github.com/shigma/schemastery) `lib/index.mjs` | 3.18.0 | MIT |
| `cosmokit.mjs` | [cosmokit](https://github.com/shigma/cosmokit) `lib/index.mjs` | 1.8.1 | MIT |

本仓库对这两个文件做的改动：

1. 删掉 `//# sourceMappingURL=...` 注释（没带 `.map` 文件，留着会在 devtools 里报 404）；
2. `schemastery.mjs` 里唯一一处裸导入 `from "cosmokit"` 改成 `from "./cosmokit.mjs"`
   （cosmokit 自己是 esbuild 打包产物，内部无裸导入）；
3. **`schemastery.mjs`：补上 `meta.volatile` 支持**（2026-10-05）。

⚠️ 因为第 3 条，`schemastery.mjs` **不再是逐字副本**。升级 schemastery
（重新从下面两处拷）时**必须把第 3 条重新打上**，否则「设置页保存后要重启 App」
那个 bug 会原样回来。

## `meta.volatile`：为什么必须补（2026-10-05）

dsh ≥ 0.1.7 自带的 schemastery（包名 `@deepseek-ai/schemastery`）把 `meta.volatile`
当**运行时契约**：`Schema.resolve()` 会把标了 volatile 的节点包成
`{ get(), [Symbol.for("cosmokit.volatile.write")] }` 引用；内核的 `_commitVolatile`
之后靠这些引用**就地换值**（不重启插件条目）。

**只有被包成引用的字段，设置页写值才不需要重启。**

原版 3.18.0 副本不认 volatile（该文件里 `volatile` 出现 **0** 次；
dsh 内核 asar 里出现 **859** 次），于是：

- 插件导出的是一个**可调用 schema**，调用它走的是**构造它的那份** `resolve`
  （本目录 `schemastery.mjs` 顶部 `Schema.resolve(data, schema, ...)`）；
- 用不认 volatile 的副本构造 `Config` ⇒ 解析出来**全是普通值、没有引用**；
- 内核判定「只 volatile 变化 ⇒ **不重启条目**」，却又**找不到引用可就地提交**
  ⇒ 变更被**静默丢弃**。

症状：设置页点「保存」提示「已保存」、`cordis.patch.yml` 也确实写对了，
但注入内容不变、关闭重开又变回旧值，**必须重启 App 才生效**。
整条保存链每一步都"成功"，唯独最后一步空转。

> ⚠️ 早期版本的这份 README 曾写「两种形状都认，因此用哪一份都不会读出问题」——
> **那是错的**，而且正是上述 bug 的根因。`readConfig()` 只解决了"读得出"，
> 解决不了"内核没有引用可写"。

补上之后，`Config` 解析出的字段是引用，`index.js` 里的 `unwrapBox()`
逐字段 `.get()` 取值，内核也能往同一颗符号里就地提交。

### 副作用与配套要求

补了 volatile 之后，**0.1.5 / 0.1.6 的旧设置通道会不认识引用对象**
（它的 `settings.register` 直接注册失败）。所以 `index.js` 给旧通道喂的是
**不带 volatile** 的 `LegacyConfig`，两者必须保持分离 ——
`test/integration.mjs` 的「注册了唯一命名空间」用例专门盯这条。

`dsh` 的设置服务只用 schema 做三件事：调用它解析值（`schema(data)`）、
`schema.toJSON()` 序列化给设置界面、以及遍历它做 `redactSecrets`。
没有任何 `instanceof` 检查，所以同版本的独立副本可以正常充当命名空间 schema。

升级 dsh 之后如果设置页报 schema 相关错误，把这两个文件重新从下面两处拷一遍即可：

- dsh ≤ 0.1.6：`~/.dsh/profiles/<profile>/node_modules/{schemastery,cosmokit}/lib/index.mjs`
- dsh ≥ 0.1.7：`~/.dsh/profiles/<profile>/node_modules/@deepseek-ai/{schemastery,cosmokit}/lib/index.mjs`

⚠️ 重拷之后**必须把上面改动清单里的第 1、2、3 条重新打上**
（sourceMappingURL、裸导入、**volatile 支持**）—— 尤其第 3 条，
漏了就会让「设置页保存后要重启 App」那个 bug 原样回来。
