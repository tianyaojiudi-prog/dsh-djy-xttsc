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

做的唯一改动：

1. 删掉 `//# sourceMappingURL=...` 注释（没带 `.map` 文件，留着会在 devtools 里报 404）；
2. `schemastery.mjs` 里唯一一处裸导入 `from "cosmokit"` 改成 `from "./cosmokit.mjs"`
   （cosmokit 自己是 esbuild 打包产物，内部无裸导入）。

`dsh` 的设置服务只用 schema 做三件事：调用它解析值（`schema(data)`）、
`schema.toJSON()` 序列化给设置界面、以及遍历它做 `redactSecrets`。
没有任何 `instanceof` 检查，所以同版本的独立副本可以正常充当命名空间 schema。

升级 dsh 之后如果设置页报 schema 相关错误，把这两个文件重新从
`~/.dsh/profiles/web/node_modules/{schemastery,cosmokit}/lib/index.mjs` 拷一遍即可。
