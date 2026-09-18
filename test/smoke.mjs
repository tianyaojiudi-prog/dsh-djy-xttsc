/**
 * dsh-djy-xttsc 冒烟测试 —— 不依赖运行中的 Harness，用桩件把两个半区都跑一遍。
 *
 *   node test/smoke.mjs
 *
 * 覆盖：
 *   1. Host 半区注册的系统提示词段（名字 / 段位 / 默认文本）；
 *   2. 设置命名空间变化后，段文本实时跟着变（含关闭时为空）；
 *   3. 客户端半区在 settings.section 上的注册参数；
 *   4. 设置组件能渲染，并且开关确实把写入打到 scope 上。
 */
import assert from 'node:assert/strict';

const DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';
const NS = 'dsh-djy-xttsc';

// ---------------------------------------------------------------- host half
const host = await import('../index.js');

assert.equal(host.name, NS, 'host 插件名');
assert.equal(host.NS, NS, '设置命名空间');
assert.equal(host.DEFAULT_CONTENT, DEFAULT_CONTENT, '默认内容');
assert.equal(host.renderSectionText({ enabled: false, content: 'x' }), '', '关闭时为空');
assert.equal(host.renderSectionText({ enabled: true, content: '   ' }), '', '空白内容为空');
assert.equal(host.renderSectionText({ enabled: true, content: '喵' }), '喵', '启用时原样输出');
assert.ok(host.Config, '导出 Config schema');

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
assert.equal(section.text(), '改成卖惨', '热改内容');

scopeValue.enabled = false;
for (const watch of watchers) watch(scopeValue, scopeValue);
assert.equal(section.text(), '', '关闭开关后不再注入');

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

let disposed = 0;
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
assert.ok(client.inject.includes('settingsScope'), '客户端注入 settingsScope');
assert.ok(client.inject.includes('slots'), '客户端注入 slots');

let registration = null;
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
client.apply({
  logger: { warn() {} },
  settingsScope: {
    bind(spec) {
      assert.equal(spec.namespace, NS, 'bind 的命名空间');
      return clientScope;
    },
  },
  slots: {
    inject(name, register) {
      assert.equal(name, 'settings.section', '挂载到设置分区');
      register();
    },
    register(options, component) {
      registration = { options, component };
      return () => {};
    },
  },
});

assert.ok(registration, '注册了设置分区');
assert.equal(registration.options.name, 'settings.section');
assert.equal(registration.options.id, NS);
assert.equal(typeof registration.options.label, 'function');
const label = registration.options.label();
assert.ok(label.includes('大肥鱼'), '导航标题: ' + label);

// 渲染一遍组件（用桩件直接调用函数组件）
const element = registration.component();
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

console.log('✓ dsh-djy-xttsc 冒烟测试通过（host 段注册 + 热改 + 客户端设置分区）');
