/**
 * dsh-djy-xttsc —— 全局系统提示词注入（大肥鱼）
 *
 * 宿主半区做两件事：
 *
 * 1. 拿到「要注入什么」：
 *    - dsh 0.1.5 / 0.1.6：`settings.register` 还在，注册设置命名空间后
 *      设置页写值即时生效（`scope.watch` 驱动）；
 *    - dsh 0.1.7 起（含 0.2.0）：该 API 已随设置模型改版移除，改由 profile 里
 *      这条插件条目的 Config 表单写入。Config 标了 `extra('volatile', true)`，
 *      `SettingsForms.describe()` 才会把它投影成可编辑表单，命名空间 = 条目 id。
 *      写值会让 cordis 重启这个插件条目（`Fiber#update` → `restart`），
 *      `apply()` 带着新 config 重新跑，所以段文本取的就是最新值。
 *
 * 2. 把一个**全局**系统提示词段挂进 systemPrompt 注册表：
 *    - 全局段（非 scope 段）对所有 scope 生效，因此本会话、子代理、
 *      工作流内部派生的子代理，都会拿到同一段文字；
 *    - `order: -900` 让它紧跟 Harness 身份段（-1000）之后、人格与工具
 *      说明之前出现，也就是「提前插入」；
 *    - 关闭开关或内容为空时返回空字符串，而空段会被组装流程直接丢弃。
 */
// 仅用于临时诊断（见文件下方的 diag 区块）；定位结束后可一并删除。
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── schemastery 来源（2026-10-05 改）────────────────────────────────────────
// ⚠ **必须优先用宿主的 `@deepseek-ai/schemastery`。**
//
// dsh 0.1.7 的「就地提交」链路（内核 `_commitVolatile`）要求配置里存在
// `{ get(), [Symbol.for("cosmokit.volatile.write")] }` 形式的**运行中引用**，
// 而这些引用是 `Schema.resolve()` 解析配置时创建的 —— 只有**宿主那份**
// schemastery 会创建（内核 asar 里 `volatile` 出现 859 次；内置副本
// `vendor/schemastery.mjs` 里出现 **0 次**）。
//
// 插件导出的是一个**可调用 schema**，调用它走的是**构造它的那份** resolve。
// 所以用内置副本构造 Config ⇒ 解析出来全是普通值 ⇒ 内核判定「只有 volatile
// 变化、不重启条目」，却又**找不到引用可就地提交** ⇒ 变更被**静默丢弃**：
// 设置页提示「已保存」、patch 文件也写对了，但注入内容和页面读数都不更新，
// 必须重启 App 才生效。（2026-10-05 实测，证据见 ~/.dsh/djy-xttsc-diag.jsonl）
//
// 为什么不给内置副本补 volatile：0.1.5 / 0.1.6 走旧的 `settings.register` 通道，
// 那套设置服务**不认识**引用对象，补了会让旧版直接挂掉
// （test/integration.mjs 的「注册了唯一命名空间」用例当场抓到）。
// 用宿主那份则天然跟随版本：0.1.7 会包引用，0.1.5 不会包。
//
// 解析走三级兜底，避免依赖「裸包名一定能解析」这个假设：
//   1. 裸包名 —— dsh 的 runtime resolution 会把它指到 profile 的依赖图；
//   2. 直接从 profile 的 node_modules 解析（DSH_HOME / DSH_PROFILE 由 dsh 提供）；
//   3. 内置副本 —— 功能降级回旧行为，但绝不崩，也不影响旧版。
async function loadHostSchemastery() {
  try {
    return (await import('@deepseek-ai/schemastery')).default;
  } catch {
    /* 落到下一级 */
  }
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const profile = process.env.DSH_PROFILE;
    if (profile) {
      const fromProfile = createRequire(join(home, 'profiles', profile, 'package.json'));
      const resolved = fromProfile.resolve('@deepseek-ai/schemastery');
      return (await import(pathToFileURL(resolved).href)).default;
    }
  } catch {
    /* 落到下一级 */
  }
  return undefined;
}

let z = await loadHostSchemastery();
let schemaSource = 'host';
if (z === undefined) {
  z = (await import('./vendor/schemastery.mjs')).default;
  schemaSource = 'vendor';
}

/** `'host'` = 用了宿主 schemastery（volatile 引用生效）；`'vendor'` = 退回内置副本。 */
export const SCHEMASTERY_SOURCE = schemaSource;

/** 稳定插件名（与 cordis.patch.yml 的 name 一致）。 */
export const name = 'dsh-djy-xttsc';

/**
 * 设置命名空间（dsh ≤ 0.1.6 用）。
 * 只允许小写字母、数字与连字符。客户端半区必须用同一个值。
 */
export const NS = 'dsh-djy-xttsc';

/**
 * dsh ≥ 0.1.7 的设置命名空间 = profile 里这条加载项的**条目 id**
 * （见 cordis.patch.yml 的 `- id: djy-xttsc`）。客户端半区必须用同一个值。
 */
export const ENTRY_ID = 'djy-xttsc';

/** 出厂默认内容。 */
export const DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';

/**
 * 段位。参考 systemPrompt 的中心段位表：
 * HARNESS_IDENTITY = -1000，DEPLOYMENT_PERSONA_PREFIX = 0。
 * 取 -900 即「排在 Harness 身份之后、其他一切之前」。
 */
export const SECTION_ORDER = -900;

/**
 * 插件组合配置的 schema，同时用作设置命名空间的 schema。
 *
 * ⚠ 2026-10-05：volatile 标记从**根节点**挪到了**每个字段**上。
 *
 *   旧的写法是整份 schema 打一个 `.extra('volatile', true)`，dsh 的
 *   `Schema.resolve` 会把**整个配置对象包成一个** Volatile 引用；实测在这种
 *   形状下，设置页写值走内核 `_commitVolatile`「就地提交」时拿不到新值
 *   （症状：设置页提示「已保存」、patch 文件也写对了，但注入内容不变、
 *   关闭重开又变回旧值，必须重启 App 才生效）。
 *
 *   改成逐字段标记后，配置形状与 `dsh-plugin-subagent-director` 一致
 *   ——那边 `config.roles.get()` 是活的、设置面板改动即时生效。本插件同理。
 *
 *   表单侧不受影响：`SettingsForms.volatileForm()` 会递归进 object 的 dict
 *   收集被标记的子字段（`isVolatilePath()` 同样逐级下钻），所以
 *   enabled / content 照旧出现在设置页里、也照旧可写。
 *
 * 读取时**必须逐字段解包**（见 {@link unwrapBox}）：盒子要用 `.get()` 取快照。
 * 0.1.5 的 schemastery 3.18.0 不认 volatile，标记只是无害的 meta。
 */
export const Config = z.object({
  /** 是否启用注入。 */
  enabled: z.boolean().default(true).extra('volatile', true),
  /** 注入的正文。 */
  content: z.string().default(DEFAULT_CONTENT).extra('volatile', true),
});

/**
 * 与 {@link Config} 字段完全相同、但**不带 volatile** 的一份，**只给旧版
 * `settings.register` 用**（dsh ≤ 0.1.6）。
 *
 * 为什么必须分开：volatile 生效时，`Schema.resolve()` 会把字段解析成
 * `{ get(), [write] }` 引用对象；而旧版那套设置服务**不认识引用**，
 * 喂给它带引用的解析结果会直接注册失败（`test/integration.mjs` 的
 * 「注册了唯一命名空间」用例会当场抓到）。
 * 0.1.7 的设置表单走的是另一条路（`SettingsForms` + 条目 Config），用不到它。
 */
const LegacyConfig = z.object({
  enabled: z.boolean().default(true),
  content: z.string().default(DEFAULT_CONTENT),
});

/** `systemPrompt` 是硬依赖：没有注册表就什么都不用谈。 */
export const inject = ['systemPrompt'];

/** 认出一个 schemastery `Volatile`（dsh 自带的那份会把 volatile 字段包起来）。 */
function isVolatileBox(value) {
  return (
    value !== null
    && typeof value === 'object'
    && typeof value.get === 'function'
    && Object.getOwnPropertySymbols(value).some((key) => String(key).includes('volatile'))
  );
}

/**
 * 把任意来源的配置收敛成普通对象。
 * 认得三种形态：普通对象、schemastery `Volatile`（`.get()`）、JSON 化过的值。
 */
export function readConfig(value) {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (isVolatileBox(current)) {
      try {
        current = current.get();
      } catch {
        return {};
      }
      continue;
    }
    if (current !== null && typeof current === 'object') return current;
    if (typeof current === 'string') {
      try {
        const parsed = JSON.parse(current);
        if (parsed !== null && typeof parsed === 'object') {
          current = parsed;
          continue;
        }
      } catch {
        /* 不是 JSON 就当空配置 */
      }
    }
    return {};
  }
  return current !== null && typeof current === 'object' ? current : {};
}

/**
 * 逐字段解包：0.1.7 起标了 volatile 的字段是 `{ get(), [write] }` 引用，
 * 快照必须 `.get()` 才拿得到；活值由内核就地提交进这个引用，所以每次读都要取。
 * 不是盒子就原样返回（0.1.5 / 普通值）。
 */
function unwrapBox(value) {
  if (!isVolatileBox(value)) return value;
  try {
    return value.get();
  } catch {
    return undefined;
  }
}

/** 把任意来源的值收敛成 { enabled, content }。 */
function normalize(value) {
  const src = readConfig(value);
  const content = unwrapBox(src.content);
  const enabled = unwrapBox(src.enabled);
  return {
    enabled: enabled !== false,
    content: typeof content === 'string' ? content : DEFAULT_CONTENT,
  };
}

/**
 * 组装这一段最终要写进系统提示词的文字。
 * 关闭或空白时返回空串 —— systemPrompt 会把空段丢掉，等于这一段不存在。
 * @param state - 当前解析值。
 * @returns 注入文本。
 */
export function renderSectionText(state) {
  const current = normalize(state);
  if (!current.enabled) return '';
  return current.content.trim() ? current.content : '';
}

// ─────────────────────────── 可选诊断（默认关闭）───────────────────────────
// 用途：排查「设置页写值不生效」这类问题时，看清插件每轮到底拿到哪些配置来源、
//       哪一个是「活引用」（`contentIsBox`）、当前渲染出的文本是什么。
//
// 开关：环境变量 `DJY_XTTSC_DIAG=on`。**默认关闭** —— 插件不该默认往用户 home
//       里写文件。开启后只在「文本」或「来源形状」变化时追加一行，平时几乎无写入。
// 输出：`~/.dsh/djy-xttsc-diag.jsonl`（每行一个 JSON）。
// 关闭：不设该变量，或设成 `on` 以外的任何值。
//
// 2026-10-05 就是靠它定位到 1.1.1 那个 bug：
//   修复前 `contentIsBox:false`（配置里没有内核可就地提交的引用），
//   修复后 `contentIsBox:true`，且保存后 12 秒内活值自动更新、无需重启。
const DIAG_PATH = join(homedir(), '.dsh', 'djy-xttsc-diag.jsonl');
const DIAG_ON = process.env.DJY_XTTSC_DIAG === 'on';
const seenDiag = new Set();

/** 描述一个来源的形状：是不是活盒子、里面 content 是盒子还是普通值。 */
function shapeOf(value) {
  const src0 = unwrapBox(value);
  const src = src0 !== null && typeof src0 === 'object' ? src0 : {};
  const content = unwrapBox(src.content);
  return {
    isBox: isVolatileBox(value),
    keys: value !== null && typeof value === 'object' ? Object.keys(value).slice(0, 10) : [],
    contentIsBox: isVolatileBox(src.content),
    content: typeof content === 'string' ? content : null,
  };
}

function diag(kind, extra) {
  if (!DIAG_ON) return;
  try {
    const key = JSON.stringify(extra);
    if (seenDiag.has(key)) return;
    seenDiag.add(key);
    appendFileSync(
      DIAG_PATH,
      JSON.stringify({ t: new Date().toISOString(), kind, ...extra }) + '\n',
      'utf8',
    );
  } catch {
    /* 诊断失败绝不影响注入 */
  }
}

/**
 * 取这一轮的配置快照，按「新鲜度」从高到低找第一个有内容的来源：
 * 1. 旧版设置作用域（dsh ≤ 0.1.6，用户在设置页改过的值）；
 * 2. `config` —— `apply` 的第二参数。**0.1.7 起这是活引用**：根节点标了
 *    volatile 的字段会被内核包成 Volatile 盒子，设置页写入时内核走
 *    `_commitVolatile`「就地提交」进这些盒子（**不重启条目**），
 *    所以 `.get()` 拿到的就是最新值；
 * 3. `ctx.fiber.config` —— 内核保留的**原始（未解析）配置**，只在条目
 *    真正重启时才换新；0.1.7 上它一直是激活那一刻的旧值。
 *
 * ⚠ **顺序不能反**（2026-10-05 修）：
 *   旧版把 `ctx.fiber.config` 排在 `config` 前面，而这里又是「第一个非空就
 *   返回」，于是在 0.1.7 上永远命中那份旧快照，`config` 活盒子根本没机会被读。
 *   症状：设置页点保存提示「已保存」、文件也确实写对了，但关闭重开又变回旧值，
 *   必须重启 App 才生效。对照：同一个内核下 **非 volatile** 字段（如
 *   `subagent-director` 的 `backgroundMode`）改动会触发「普通重挂载」，
 *   条目重启后自然拿到新值，所以那种字段看起来是正常的。
 *
 * 每个来源都过一遍 {@link readConfig}，所以 `Volatile` / JSON 形态都能吃。
 */
function readSnapshot(ctx, config, scope) {
  const sources = [];
  if (scope) {
    try {
      sources.push(scope.get());
    } catch {
      /* 作用域读取失败就往下走 */
    }
  }
  // 活引用优先：0.1.7 上 `config` 里的 volatile 盒子由内核就地更新，
  // `ctx.fiber.config` 只是激活时的原始快照。
  sources.push(config, ctx?.fiber?.config);
  for (const source of sources) {
    const resolved = readConfig(source);
    if (Object.keys(resolved).length > 0) return resolved;
  }
  return {};
}

export function apply(ctx, config) {
  const base = config ?? {};

  /** 已注册的旧版设置作用域；null 表示没有（0.1.7 起的正常状态）。 */
  let scope = null;

  // 设置服务是可选依赖，两条路都试，先到先得：
  //   - 有 settings.register → 旧版设置命名空间，支持运行时热改；
  //   - 没有（或已改版）→ 什么都不做，段文本直接读 fiber/config 快照。
  try {
    ctx.inject(['settings'], (sctx) => {
      if (typeof sctx.settings?.register !== 'function') {
        sctx.logger?.info?.(
          '[dsh-djy-xttsc] settings.register 不可用（dsh 0.1.7 起改为插件配置表单）：' +
          '设置页写入 profile patch，条目重启后 apply 会拿到新 config。',
        );
        return;
      }
      try {
        // 旧通道必须用**不带 volatile** 的 schema，且 base 要收敛成普通值：
        // 那套设置服务不认识 volatile 引用对象，喂引用会让注册直接失败。
        const registered = sctx.settings.register(NS, LegacyConfig, {
          base: normalize(base),
          applies: 'live',
        });
        scope = registered;
        sctx.effect(() => () => {
          if (scope === registered) scope = null;
        });
        sctx.logger?.info?.(
          '[dsh-djy-xttsc] 设置命名空间已就绪: ' + NS +
          '（当前状态: ' + (normalize(registered.get()).enabled ? '启用' : '停用') + '）',
        );
      } catch (error) {
        ctx.logger?.warn?.('[dsh-djy-xttsc] 设置命名空间注册失败（改用配置文件）: ' + String(error));
      }
    });
  } catch (error) {
    // apply 抛错会让条目变 failed（0.2.0 的启动审计会报错），这里一律吞掉。
    ctx.logger?.warn?.('[dsh-djy-xttsc] settings 注入失败: ' + String(error));
  }

  // 诊断：激活时两个来源的形状（谁是活引用、谁是原始快照）。
  diag('activate', {
    schema: SCHEMASTERY_SOURCE,
    config: shapeOf(config),
    fiberConfig: shapeOf(ctx?.fiber?.config),
  });

  ctx.effect(
    () => ctx.systemPrompt.section({
      name: NS + ':global',
      order: SECTION_ORDER,
      // 每次组装提示词时求值，不是注册时定值。
      text: () => {
        const text = renderSectionText(readSnapshot(ctx, config, scope));
        // 诊断：每轮实际读到什么。文本或来源形状一变就各记一行。
        diag('render', {
          schema: SCHEMASTERY_SOURCE,
          text,
          config: shapeOf(config),
          fiberConfig: shapeOf(ctx?.fiber?.config),
        });
        return text;
      },
    }),
    'dsh-djy-xttsc: global system prompt section',
  );
}
