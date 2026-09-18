/**
 * dsh-djy-xttsc —— 全局系统提示词注入（大肥鱼）
 *
 * 宿主半区做两件事：
 *
 * 1. 注册设置命名空间 `dsh-djy-xttsc`（字段 `enabled` / `content`）。
 *    解析顺序 = schema 默认值 → 插件组合配置（base）→ 用户设置文档，
 *    所以设置页里的修改会持久化进 dsh 的用户设置文件，重启后仍在。
 *
 * 2. 把一个**全局**系统提示词段挂进 systemPrompt 注册表，文本由上面那个
 *    命名空间在每个回合组装时实时求值：
 *      - 全局段（非 scope 段）对所有 scope 生效，因此本会话、子代理、
 *        工作流内部派生的子代理，都会拿到同一段文字；
 *      - `order: -900` 让它紧跟 Harness 身份段（-1000）之后、人格与工具
 *        说明之前出现，也就是「提前插入」；
 *      - 关闭开关或内容为空时返回空字符串，而空段会被组装流程直接丢弃。
 */
// 内置（vendored）schemastery：见 vendor/README.md。
// 用相对路径而不是裸包名，是为了让插件在「被 pnpm link: 成软链接安装」的情况下
// 也能解析到依赖 —— 软链接安装时 Node 会用源目录做真实路径，裸包名会解析失败。
import z from './vendor/schemastery.mjs';

/** 稳定插件名（与 cordis.patch.yml 的 name 一致）。 */
export const name = 'dsh-djy-xttsc';

/** 设置命名空间；只允许小写字母、数字与连字符。客户端半区必须用同一个值。 */
export const NS = 'dsh-djy-xttsc';

/** 出厂默认内容。 */
export const DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';

/**
 * 段位。参考 systemPrompt 的中心段位表：
 * HARNESS_IDENTITY = -1000，DEPLOYMENT_PERSONA_PREFIX = 0。
 * 取 -900 即「排在 Harness 身份之后、其他一切之前」。
 */
export const SECTION_ORDER = -900;

/** 插件组合配置的 schema，同时用作设置命名空间的 schema。 */
export const Config = z.object({
  /** 是否启用注入。 */
  enabled: z.boolean().default(true),
  /** 注入的正文。 */
  content: z.string().default(DEFAULT_CONTENT),
});

/** `systemPrompt` 是硬依赖：没有注册表就什么都不用谈。 */
export const inject = ['systemPrompt'];

/** 把任意来源的值收敛成 { enabled, content }。 */
function normalize(value) {
  const src = value && typeof value === 'object' ? value : {};
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

export function apply(ctx, config) {
  const base = config ?? {};
  let state = normalize(base);

  // 设置服务是可选依赖：在，就打开运行时热改；不在，就退回组合配置。
  ctx.inject(['settings'], (sctx) => {
    try {
      const scope = sctx.settings.register(NS, Config, { base, applies: 'live' });
      const sync = () => {
        state = normalize(scope.get() ?? base);
      };
      sync();
      const off = scope.watch(sync);
      sctx.effect(() => off);
      ctx.logger?.info?.(
        '[dsh-djy-xttsc] 设置命名空间已就绪: ' + NS +
        '（当前状态: ' + (state.enabled ? '启用' : '停用') + '）',
      );
    } catch (error) {
      ctx.logger?.warn?.('[dsh-djy-xttsc] 命名空间注册失败: ' + String(error));
    }
  });

  ctx.effect(
    () => ctx.systemPrompt.section({
      name: NS + ':global',
      order: SECTION_ORDER,
      text: () => renderSectionText(state),
    }),
    'dsh-djy-xttsc: global system prompt section',
  );
}
