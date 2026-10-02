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
// 内置（vendored）schemastery：见 vendor/README.md。
// 用相对路径而不是裸包名，是为了让插件在「被 pnpm link: 成软链接安装」的情况下
// 也能解析到依赖 —— 软链接安装时 Node 会用源目录做真实路径，裸包名会解析失败。
import z from './vendor/schemastery.mjs';

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
 * `extra('volatile', true)`：dsh 0.1.7 起设置服务按插件 Config 自动生成配置表单
 * （SettingsForms.describe → volatileForm），只有标了 volatile 的字段才进表单。
 *
 * ⚠ 这个标记在 dsh 自带的 schemastery 里是**运行时契约**，不只是表单标注：
 *   `Schema.resolve` 会把标了 volatile 的节点包成 `Volatile` 对象（取值必须 `.get()`，
 *   dsh 自己的 `plainConfig()` 就是先 `isVolatile(value)` 再解包）。
 *   所以下面读配置一律走 {@link readConfig}，两种形状都认；
 *   0.1.5 的 schemastery 3.18.0 不认 volatile，标记只是无害的 meta。
 */
export const Config = z
  .object({
    /** 是否启用注入。 */
    enabled: z.boolean().default(true),
    /** 注入的正文。 */
    content: z.string().default(DEFAULT_CONTENT),
  })
  .extra('volatile', true);

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

/** 把任意来源的值收敛成 { enabled, content }。 */
function normalize(value) {
  const src = readConfig(value);
  return {
    enabled: src.enabled !== false,
    content: typeof src.content === 'string' ? src.content : DEFAULT_CONTENT,
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

/**
 * 取这一轮的配置快照，按「新鲜度」从高到低找第一个有内容的来源：
 *
 * 1. 旧版设置作用域（dsh ≤ 0.1.6，用户在设置页改过的值）；
 * 2. `ctx.fiber.config`（cordis 每轮激活前重新解析的那份，含 profile patch 层）；
 * 3. `apply` 的第二参数（同一份解析值，兜底）。
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
  sources.push(ctx?.fiber?.config, config);
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
        const registered = sctx.settings.register(NS, Config, { base, applies: 'live' });
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

  ctx.effect(
    () => ctx.systemPrompt.section({
      name: NS + ':global',
      order: SECTION_ORDER,
      // 每次组装提示词时求值，不是注册时定值。
      text: () => renderSectionText(readSnapshot(ctx, config, scope)),
    }),
    'dsh-djy-xttsc: global system prompt section',
  );
}
