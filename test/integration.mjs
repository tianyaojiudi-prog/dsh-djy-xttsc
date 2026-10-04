/**
 * dsh-djy-xttsc 真集成验证 —— 用**真实的** cordis / dsh-settings / dsh-system-prompt /
 * dsh-scope 起一套最小宿主，跑本插件的宿主半区。
 *
 *   node test/integration.mjs
 *
 * 两代 dsh 的设置模型不同，脚本自己认版本（看 `settings.register` 在不在）：
 *
 * A. dsh ≤ 0.1.6：设置命名空间由 `settings.register` 注册。
 *    验证：默认值 / 段序「提前插入」/ 子代理也吃到 / 热改与开关 / schema 信封。
 *
 * B. dsh ≥ 0.1.7（含 0.2.0）：`settings.register` 已随设置模型改版移除，
 *    设置页改的是 profile 里这条加载项的 Config 表单（本插件 Config 标了 volatile），
 *    写值让条目重启、`apply` 拿到新 config。这条路线在真宿主里要挂 Loader 才有条目 id，
 *    所以这里验证不依赖 Loader 的那部分：段注册、段序、子代理、config 快照与开关。
 *
 * 两个注意点：
 *
 * 1. 被测插件本体用仓库里这一份（`../index.js`），所以 clone 下来、只要机器上装过
 *    dsh，就能直接 `node test/integration.mjs` 验证，不需要先把插件装进 profile。
 * 2. dsh 自带的那几个包按 profile 根目录解析（createRequire）。因为这些包不一定是
 *    本仓库的依赖，写死裸包名在 clone 里会 ERR_MODULE_NOT_FOUND。
 *    profile 取 DSH_PROFILE 指定的那个，缺省按 profiles/web → profiles/desktop 找。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 诊断是 opt-in（`DJY_XTTSC_DIAG=on` 才写）。这里显式关掉，防止开发机
// 全局开着该变量时，测试往 ~/.dsh/djy-xttsc-diag.jsonl 写垃圾。
process.env.DJY_XTTSC_DIAG = 'off';

const DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');

/** 找出一个装过 dsh 的 profile 目录。 */
function resolveProfileRoot() {
  const named = process.env.DSH_PROFILE;
  const candidates = named ? [named] : ['web', 'desktop', 'headless'];
  for (const name of candidates) {
    const dir = join(dshHome, 'profiles', name);
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  throw new Error(
    '找不到装过 dsh 的 profile（试过 ' + candidates.join(' / ') + '；用 DSH_HOME / DSH_PROFILE 覆盖）',
  );
}

const profileRoot = resolveProfileRoot();
/** 按 profile 根目录解析 dsh 自带的包（本仓库没有把它们列为依赖）。 */
const fromProfile = createRequire(join(profileRoot, 'package.json'));
const load = async (request) => import(pathToFileURL(fromProfile.resolve(request)).href);

/** schemastery 的包名在 0.2.0 前后换过，两个都试。 */
async function loadSchemastery() {
  for (const request of ['@deepseek-ai/schemastery', 'schemastery']) {
    try {
      return (await load(request)).default;
    } catch {
      /* 换下一个名字 */
    }
  }
  return undefined;
}

const { Context } = await load('@deepseek-ai/cordis');
const { default: SystemPrompt, renderPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const { default: SettingsFile } = await load('@deepseek-ai/dsh-settings-file');
const { createScope } = await load('@deepseek-ai/dsh-scope');
/** 被测插件：仓库里这一份（自带 vendor，无需任何依赖）。 */
const mod = await import('../index.js');

const tmp = mkdtempSync(join(tmpdir(), 'dsh-djy-xttsc-'));
const root = new Context();

try {
  await root.plugin(SystemPrompt, {});
  await root.plugin(SettingsFile, { path: join(tmp, 'settings.yaml') });
  const entry = await root.plugin({
    name: mod.name,
    inject: mod.inject,
    apply: mod.apply,
    Config: mod.Config,
  });
  await entry.await();

  const prompt = root.get('systemPrompt');
  const settings = root.get('settings');
  const legacy = typeof settings?.register === 'function';
  const mode = legacy ? 'A (settings.register)' : 'B (插件 Config 表单)';
  console.log('· 检测到设置模型：' + mode + '（profile: ' + profileRoot + '）');

  // 1. 段注册与段序：harness:identity → dsh-djy-xttsc:global → deployment:persona-*
  const main = await prompt.assemble({});
  const names = main.sections.map((s) => s.name);
  assert.ok(names.includes(mod.NS + ':global'), '主会话里有本段');
  assert.ok(
    names.indexOf(mod.NS + ':global') < names.indexOf('deployment:persona-prefix'),
    '排在人格段之前（提前插入）',
  );
  assert.equal(names[0], 'harness:identity', 'Harness 身份仍是第一段');
  assert.ok(renderPrompt(main).includes(DEFAULT_CONTENT), '主会话注入默认内容');

  // 2. 子代理：自己的 scope + 自己的 scoped 人格段，照样拿到这一段
  const key = {};
  const sub = createScope(root, key);
  await new Promise((resolve) => {
    sub.ctx.inject(['systemPrompt'], (scoped) => {
      scoped.systemPrompt.section({
        name: 'deployment:persona-prefix',
        order: 0,
        text: '（子代理人格）',
      });
      resolve();
    });
  });
  const child = await prompt.assemble({ scope: key });
  assert.deepEqual(child.sections.map((s) => s.name), names, '子代理段序与主会话一致');
  const childText = renderPrompt(child);
  assert.ok(childText.includes(DEFAULT_CONTENT), '子代理也拿到本段');
  assert.ok(childText.includes('（子代理人格）'), '子代理自己的 scoped 段仍在');

  if (legacy) {
    // 3A. 设置命名空间：默认值 = 出厂内容
    assert.deepEqual(settings.describe().map((d) => d.ns), [mod.NS], '注册了唯一命名空间');
    const descriptor = settings.describe().find((d) => d.ns === mod.NS);
    assert.deepEqual(descriptor.value, { enabled: true, content: DEFAULT_CONTENT }, '默认解析值');

    // 4A. 热改 + 关开关（主会话与子代理一起变）
    await settings.update(mod.NS, { content: '子代理也要卖萌' });
    assert.ok(renderPrompt(await prompt.assemble({})).includes('子代理也要卖萌'), '主会话热改生效');
    assert.ok(
      renderPrompt(await prompt.assemble({ scope: key })).includes('子代理也要卖萌'),
      '子代理热改生效',
    );

    await settings.update(mod.NS, { enabled: false });
    assert.ok(!renderPrompt(await prompt.assemble({})).includes('子代理也要卖萌'), '关掉后主会话不注入');
    assert.ok(
      !renderPrompt(await prompt.assemble({ scope: key })).includes('子代理也要卖萌'),
      '关掉后子代理不注入',
    );
    assert.ok(
      renderPrompt(await prompt.assemble({ scope: key })).includes('（子代理人格）'),
      '关掉后子代理自身段落不受影响',
    );
  } else {
    // 3B. 新版：设置页读的是「按插件 Config 生成的表单」，命名空间 = 条目 id。
    //     这里的宿主是直接 root.plugin(...) 挂的，没有 Loader 给的条目 id，
    //     所以只验证那段仍然在、值仍然是默认值，且段本身不依赖任何 scope。
    const descriptors = settings.describe?.() ?? [];
    const ours = descriptors.find(
      (d) => d.value !== undefined
        && Object.hasOwn(d.value, 'content')
        && Object.hasOwn(d.value, 'enabled'),
    );
    if (ours !== undefined) {
      assert.equal(ours.applies, 'live', '参与表单的字段是 live 生效');
      assert.deepEqual(ours.value, { enabled: true, content: DEFAULT_CONTENT }, '表单默认解析值');
    } else {
      console.log('· 新宿主未挂 Loader：跳过「条目表单」字段检查');
    }
    assert.ok(
      renderPrompt(await prompt.assemble({ scope: key })).includes(DEFAULT_CONTENT),
      '新版：子代理同样拿到默认内容',
    );
  }

  // 5. 跨实例 schema 信封（设置界面用的就是 host 自带的那份 schemastery）
  const hostZ = await loadSchemastery();
  if (hostZ === undefined) {
    console.log('· 跳过 schema 信封检查：这个 profile 里找不到 schemastery');
  } else {
    const envelope = mod.Config.toJSON();
    const rehydrated = hostZ(envelope);
    const resolved = rehydrated({});
    // dsh ≥ 0.1.7 自带的 schemastery 会把 volatile 节点包成 Volatile 对象，
    // 取值要 .get()（dsh 自己的 plainConfig 就是这么干的）；插件里走 readConfig 兼容两种形状。
    const value = mod.readConfig(resolved);
    // 2026-10-05：volatile 改为**逐字段**标记（根标记会把整包打成一个盒子，
    // 拿不到内核的就地更新）。所以顶层是普通对象、字段才是 { get(), [write] } 引用，
    // 取值必须逐字段 .get()；renderSectionText 内部就是这么做解包的。
    const unwrap = (v) => (
      v !== null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v
    );
    assert.deepEqual(
      { enabled: unwrap(value.enabled), content: unwrap(value.content) },
      { enabled: true, content: DEFAULT_CONTENT },
      'host 侧能重建本插件的 schema 并解出默认值',
    );
    assert.equal(
      mod.renderSectionText(value),
      DEFAULT_CONTENT,
      '插件读得懂 host 那份 schema 的解析结果（逐字段解包）',
    );
  }

  console.log('✓ dsh-djy-xttsc 真集成验证通过（主会话 / 子代理 / 段序 / schema 信封）');
} finally {
  await root.fiber.dispose();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
