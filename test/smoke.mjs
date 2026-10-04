/**
 * dsh-djy-xttsc 冒烟测试 —— 不依赖运行中的 Harness，用桩件把两个半区都跑一遍。
 *
 *   node test/smoke.mjs
 *
 * 覆盖：
 *   1. Host 半区注册的系统提示词段（名字 / 段位 / 默认文本）；
 *   2. 旧版设置命名空间（settings.register）变化后段文本实时跟着变（含关闭时为空）；
 *   3. 新版（dsh ≥ 0.1.7）没有 settings.register 时，段文本取当前 config 快照；
 *   4. Config 标了 volatile（新版设置表单靠它生成）；
 *   5. 客户端半区在 settings.section 上的注册参数（旧版 settingsScope 路线）；
 *   6. 客户端半区新版路线：configForms 未就位 → whileServed → 就位后挂上；
 *   7. **两代服务同时存在时只挂一次**（list 槽位重复 id 会抛错，这是桌面版崩溃的根因）；
 *   8. 设置组件能渲染，并且开关确实把写入打到 scope 上。
 */
import assert from 'node:assert/strict';

// 诊断是 opt-in（`DJY_XTTSC_DIAG=on` 才写）。这里显式关掉，防止开发机
// 全局开着该变量时，测试往 ~/.dsh/djy-xttsc-diag.jsonl 写垃圾。
process.env.DJY_XTTSC_DIAG = 'off';

const DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';
const NS = 'dsh-djy-xttsc';
const ENTRY_ID = 'djy-xttsc';

// ---------------------------------------------------------------- host half
const host = await import('../index.js');

assert.equal(host.name, NS, 'host 插件名');
assert.equal(host.NS, NS, '设置命名空间（≤ 0.1.6）');
assert.equal(host.ENTRY_ID, ENTRY_ID, '设置命名空间（≥ 0.1.7 = profile 条目 id）');
assert.equal(host.DEFAULT_CONTENT, DEFAULT_CONTENT, '默认内容');
assert.equal(host.renderSectionText({ enabled: false, content: 'x' }), '', '关闭时为空');
assert.equal(host.renderSectionText({ enabled: true, content: '   ' }), '', '空白内容为空');
assert.equal(host.renderSectionText({ enabled: true, content: '喵' }), '喵', '启用时原样输出');
assert.ok(host.Config, '导出 Config schema');
// 2026-10-05：volatile 从根节点挪到字段。根标记会把整个配置包成一个盒子，
// 那种形状拿不到内核的就地更新（症状：设置页保存后必须重启才生效）。
assert.equal(
  host.Config.meta.volatile,
  undefined,
  '根节点不标 volatile（避免整包一个盒子）',
);
assert.equal(host.Config.dict.enabled.meta.volatile, true, 'enabled 字段标了 volatile');
assert.equal(host.Config.dict.content.meta.volatile, true, 'content 字段标了 volatile');

// ---- 旧版路线：settings.register 在，段文本读注册作用域的当前值 ----
const sections = [];
const effects = [];
const watchers = new Set();
const scopeValue = { enabled: true, content: DEFAULT_CONTENT };
const fakeScope = {
  get() {
    return scopeValue;
  },
  watch(callback) {
    watchers.add(callback);
    return () => watchers.delete(callback);
  },
};

let settingsReady = null;
const hostCtx = {
  logger: { info() {}, warn() {} },
  fiber: { config: { enabled: true, content: DEFAULT_CONTENT } },
  systemPrompt: {
    section(entry) {
      sections.push(entry);
      return () => {};
    },
  },
  effect(run) {
    effects.push(run());
  },
  inject(deps, callback) {
    if (!deps.includes('settings')) return;
    settingsReady = () => callback({
      settings: {
        register(ns, schema, options) {
          assert.equal(ns, NS, '注册的命名空间');
          assert.ok(schema, '注册需要 schema');
          assert.ok(options && 'base' in options, '注册需要 base 层');
          return fakeScope;
        },
      },
      logger: { info() {}, warn() {} },
      effect(run) {
        effects.push(run());
      },
    });
  },
};

host.apply(hostCtx, {});
assert.equal(sections.length, 1, '注册了唯一一段');
assert.ok(settingsReady, '发现了 settings 服务');
settingsReady();

const section = sections[0];
assert.ok(section, '注册了系统提示词段');
assert.equal(section.name, NS + ':global', '段名');
assert.equal(section.order, host.SECTION_ORDER, '段位');
assert.ok(section.order < 0, '段位在人格段（0）之前');
assert.equal(section.text(), DEFAULT_CONTENT, '默认文本');
assert.ok(effects.length >= 1, '段注册返回了 disposer');

// 设置页改内容 -> 段文本实时跟着变
scopeValue.enabled = true;
scopeValue.content = '改成卖惨';
for (const watch of watchers) watch(scopeValue, scopeValue);
assert.equal(section.text(), '改成卖惨', '旧版：热改内容');

scopeValue.enabled = false;
for (const watch of watchers) watch(scopeValue, scopeValue);
assert.equal(section.text(), '', '旧版：关闭开关后不再注入');

// ---- 新版路线：没有 settings.register（dsh ≥ 0.1.7），段文本取 config 快照 ----
const modernSections = [];
const modernCtx = {
  logger: { info() {}, warn() {} },
  fiber: { config: { enabled: true, content: '来自配置表单' } },
  systemPrompt: {
    section(entry) {
      modernSections.push(entry);
      return () => {};
    },
  },
  effect(run) {
    run();
  },
  inject(deps, callback) {
    if (!deps.includes('settings')) return;
    // 0.1.7 起 settings 服务还在（只是 API 改版），register 已经没了
    callback({ settings: {}, logger: { info() {}, warn() {} }, effect(run) { run(); } });
  },
};
host.apply(modernCtx, { enabled: true, content: '来自 apply 参数' });
assert.equal(modernSections.length, 1, '新版也注册了唯一一段');
// 2026-10-05 修正：0.1.7 上 **apply 的第二参数才是活引用**。
// 内核 `_commitVolatile` 对「仅 volatile 变化」只做就地提交，不改 `fiber.config`
// （内核原话：fiber.config 是「retains the raw Fiber config for later activation」
// ——留到下次激活才用的原始配置），所以 fiber.config 此刻反而是旧值。
// 旧断言写的是「优先取 fiber.config」，把这个错误假设固化了，也正是
// 「设置页保存后必须重启 App 才生效」的根因。
assert.equal(modernSections[0].text(), '来自 apply 参数', '新版：优先取 apply 参数（活引用）');
assert.doesNotThrow(() => host.apply(modernCtx, undefined), '缺少 config 时不抛错（回退 fiber.config）');

// ---- 回归：volatile 就地提交后段文本必须跟着变（不重启条目）----
// 模拟内核把根 volatile 包成盒子交给 apply；设置页写入后盒子里换新值，
// 而 fiber.config 仍是激活时的旧快照。旧顺序会命中旧快照 → 本用例失败。
const liveSections = [];
const liveCtx = {
  logger: { info() {}, warn() {} },
  fiber: { config: { enabled: true, content: '激活时的旧值' } },
  systemPrompt: {
    section(entry) {
      liveSections.push(entry);
      return () => {};
    },
  },
  effect(run) {
    run();
  },
  inject(deps, callback) {
    if (!deps.includes('settings')) return;
    callback({ settings: {}, logger: { info() {}, warn() {} }, effect(run) { run(); } });
  },
};
const liveBox = { get: () => ({ enabled: true, content: '就地提交后的新值' }) };
Object.defineProperty(liveBox, Symbol.for('cosmokit.volatile.write'), { value: true });
host.apply(liveCtx, liveBox);
assert.equal(
  liveSections[0].text(),
  '就地提交后的新值',
  'volatile 就地提交后立即生效（无需重启条目）',
);

// ---- schemastery 的 Volatile 形状（dsh ≥ 0.1.7 自带那份会把 volatile 节点包起来）----
const volatileBox = {
  get: () => ({ enabled: false, content: '解包后的内容' }),
};
Object.defineProperty(volatileBox, Symbol.for('cosmokit.volatile'), { value: true });
assert.deepEqual(
  host.readConfig(volatileBox),
  { enabled: false, content: '解包后的内容' },
  'readConfig 认得 Volatile 包裹（取值要 .get()）',
);
assert.equal(host.renderSectionText(volatileBox), '', 'Volatile 里关闭开关也认得出');

// ---- schemastery 来源（2026-10-05）----
// 插件优先用宿主的 `@deepseek-ai/schemastery`：只有那份的 Schema.resolve 会为
// volatile 字段创建「运行中引用」，内核 `_commitVolatile` 才有东西可就地提交。
// 解析不到裸包名时退回内置副本（本测试环境就是这种情况），功能降级但不会崩。
assert.ok(
  host.SCHEMASTERY_SOURCE === 'host' || host.SCHEMASTERY_SOURCE === 'vendor',
  '导出 schemastery 来源，便于诊断',
);
console.log(`· schemastery 来源：${host.SCHEMASTERY_SOURCE}`);


// ---- 逐字段 volatile（2026-10-05 改法）----
// 字段级盒子：`config` 本身是普通对象，`config.content` 才是引用。
// 必须逐字段 `.get()` 解包，否则会误判成「不是字符串」而回落到默认内容。
const fieldBoxes = {
  enabled: { get: () => true },
  content: { get: () => '字段盒子里的话' },
};
for (const box of Object.values(fieldBoxes)) {
  Object.defineProperty(box, Symbol.for('cosmokit.volatile.write'), { value: true });
}
assert.equal(
  host.renderSectionText(fieldBoxes),
  '字段盒子里的话',
  '逐字段 volatile：字段盒子要 .get() 解包',
);
const liveFieldBoxes = {
  enabled: { get: () => true },
  content: { get: () => '就地提交后的字段值' },
};
for (const box of Object.values(liveFieldBoxes)) {
  Object.defineProperty(box, Symbol.for('cosmokit.volatile.write'), { value: true });
}
const fieldSections = [];
host.apply(
  {
    logger: { info() {}, warn() {} },
    fiber: { config: { enabled: true, content: '激活时的旧值' } },
    systemPrompt: {
      section(entry) {
        fieldSections.push(entry);
        return () => {};
      },
    },
    effect(run) {
      run();
    },
    inject(deps, callback) {
      if (!deps.includes('settings')) return;
      callback({ settings: {}, logger: { info() {}, warn() {} }, effect(run) { run(); } });
    },
  },
  liveFieldBoxes,
);
assert.equal(
  fieldSections[0].text(),
  '就地提交后的字段值',
  '逐字段 volatile 就地提交后立即生效（无需重启条目）',
);
assert.deepEqual(host.readConfig('{"enabled":true,"content":"json 形态"}'), {
  enabled: true,
  content: 'json 形态',
}, 'readConfig 认得 JSON 化过的值');
assert.deepEqual(host.readConfig(undefined), {}, 'readConfig 对空值给空对象');

// -------------------------------------------------------------- client half
let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec;
    },
  },
};

await import('../client.js');
assert.ok(loaded, '客户端 bundle 调用了 __ModuleLoader__.load');
assert.equal(loaded.id, NS, '客户端 bundle id');

const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: Object.assign({}, props, { children }) };
  },
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useSyncExternalStore: (subscribe, read) => read(),
};
const fakeRequire = (request) => {
  if (request === 'react') return reactStub;
  throw new Error('未预期的 require: ' + request);
};

const client = loaded.factory(fakeRequire);
assert.equal(client.name, NS, '客户端插件名');
assert.deepEqual(client.inject, [], '客户端不写硬依赖（0.1.7 移除 settingsScope 后条目会永远 pending）');

let disposed = 0;
const written = [];
const clientScope = {
  getSnapshot: () => ({
    status: 'ready',
    value: { enabled: true, content: DEFAULT_CONTENT },
    writable: true,
  }),
  subscribe: () => () => {
    disposed += 1;
  },
  set: (field, value) => {
    written.push([field, value]);
    return Promise.resolve();
  },
  unset: () => Promise.resolve(),
};

/** 记录一次 settings.section 注册的槽位桩件（两代共用）。 */
function makeSlots(record) {
  return {
    inject(name, register) {
      assert.equal(name, 'settings.section', '挂载到设置分区');
      record.dispose = register();
      return record.dispose;
    },
    register(options, component) {
      record.registration = { options, component };
      return () => {
        record.unregistered = true;
      };
    },
  };
}

const clientLogger = { warn() {} };

// ---- 旧版路线（dsh ≤ 0.1.6）：只有 settingsScope ----
const classic = { registration: null, unregistered: false, dispose: null };
let classicReady = null;
client.apply({
  logger: clientLogger,
  inject(deps, callback) {
    if (deps.join() === 'slots,configForms') return; // 0.1.6 没有 configForms
    assert.deepEqual(deps, ['slots', 'settingsScope'], '0.1.6 走 settingsScope 软依赖');
    classicReady = () => callback({
      logger: clientLogger,
      settingsScope: {
        bind(spec) {
          assert.equal(spec.namespace, NS, '旧版 bind 的命名空间');
          return clientScope;
        },
      },
      slots: makeSlots(classic),
    });
  },
});
assert.ok(classicReady, '0.1.6：客户端等到 slots / settingsScope 才挂设置分区');
classicReady();
assert.ok(classic.registration, '0.1.6 注册了设置分区');
assert.equal(classic.registration.options.id, NS, '0.1.6 分区 id');

// ---- 新版路线（dsh ≥ 0.1.7）：只有 configForms，先「读取中」再被服务 ----
const modern = { registration: null, unregistered: false, dispose: null };
let modernReady = null;
let modernServed = null;
/** 模拟 configForms 的快照：mirror 还没读到条目时是 loading，就位后才是 ready。 */
const modernForm = {
  served: false,
  getSnapshot() {
    return this.served
      ? { status: 'ready', value: { enabled: true, content: DEFAULT_CONTENT }, writable: true }
      : { status: 'loading', value: undefined, writable: false };
  },
  subscribe: () => () => {
    disposed += 1;
  },
  set: (field, value) => {
    written.push([field, value]);
    return Promise.resolve(true);
  },
};
client.apply({
  logger: clientLogger,
  inject(deps, callback) {
    if (deps.join() !== 'slots,configForms') return; // 0.1.7 没有 settingsScope
    modernReady = () => callback({
      logger: clientLogger,
      effect(run) {
        run();
      },
      configForms: {
        get(entryId) {
          assert.equal(entryId, ENTRY_ID, '新版设置命名空间是 profile 条目 id');
          return modernForm;
        },
        whileServed(namespaces, register) {
          assert.deepEqual(namespaces, [ENTRY_ID], '跟随条目命名空间');
          assert.equal(modern.registration, null, 'namespace 没就位时不抢先注册');
          modernForm.served = true;
          modernServed = { register, off: register() };
          return () => {
            modernServed.off?.();
          };
        },
      },
      slots: makeSlots(modern),
    });
  },
});
assert.ok(modernReady, '0.1.7：客户端等到 slots / configForms 才挂设置分区');
modernReady();
assert.ok(modernServed, '0.1.7 通过 whileServed 挂页面');
assert.ok(modern.registration, '0.1.7 也注册了设置分区');
assert.equal(modern.registration.options.id, NS, '两代用同一个分区 id');
assert.equal(typeof modern.dispose, 'function', '挂载返回 disposer（whileServed 要收回注册）');
assert.equal(typeof modernServed.off, 'function', 'whileServed 的 register 返回 disposer');

// 收回：namespace 下线时注册要跟着收，之后还能重新挂
modernServed.off();
assert.equal(modern.unregistered, true, 'namespace 下线时收回注册');

// ---- 两代服务同时存在（0.1.7 桌面版的实际情况）：只能挂一次 ----
let bothRegistrations = 0;
const both = {
  inject(name, register) {
    register();
    return () => {};
  },
  register() {
    bothRegistrations += 1;
    return () => {};
  },
};
client.apply({
  logger: clientLogger,
  inject(deps, callback) {
    callback({
      logger: clientLogger,
      effect(run) {
        run();
      },
      settingsScope: {
        bind: () => clientScope,
      },
      configForms: {
        get: () => clientScope,
        whileServed: (namespaces, register) => register(),
      },
      slots: both,
    });
  },
});
assert.equal(bothRegistrations, 1, '两代服务同时存在时只注册一次分区（否则 list 槽位抛错）');

// ---- 两个服务都不在：静默跳过，不许抛错 / 不许待机 ----
assert.doesNotThrow(() => {
  client.apply({ logger: clientLogger, inject() {} });
}, '缺少设置服务时静默跳过，不再 pending / failed');

// 渲染一遍组件（用桩件直接调用函数组件）—— 用 0.1.6 那次注册的组件
const element = classic.registration.component();
assert.ok(element, '注册值渲染出了元素');
const tree = element.type({ scope: clientScope });
const text = JSON.stringify(tree);
assert.ok(text.includes('大肥鱼指令注入'), '标题渲染');
assert.ok(text.includes(DEFAULT_CONTENT), '默认内容带进输入框');

/** 在桩件元素的树里找第一个 type 命中者。 */
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  const children = (node.props && node.props.children) || [];
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return null;
}

const checkbox = find(tree, 'input');
assert.ok(checkbox, '找到开关');
assert.equal(checkbox.props.checked, true, '默认启用');
checkbox.props.onChange({ target: { checked: false } });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(written, [['enabled', false]], '关闭开关写回 scope');

const buttons = [];
(function collect(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'button') buttons.push(node);
  const children = (node.props && node.props.children) || [];
  for (const child of Array.isArray(children) ? children : [children]) collect(child);
})(tree);
assert.equal(buttons.length, 2, '保存 + 恢复默认');
const reset = buttons.find((b) => JSON.stringify(b.props.children).includes('恢复默认'));
reset.props.onClick();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(written[1], ['content', DEFAULT_CONTENT], '恢复默认写回内容');

console.log('✓ dsh-djy-xttsc 冒烟测试通过（host 段注册 + 热改 + 客户端两代设置分区）');
