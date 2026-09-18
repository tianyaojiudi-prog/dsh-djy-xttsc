/**
 * dsh-djy-xttsc 真集成验证 —— 用**真实的** cordis / dsh-settings / dsh-system-prompt /
 * dsh-scope 起一套最小宿主，跑本插件的宿主半区，验证：
 *
 *   1. 设置命名空间注册成功，默认值 = 出厂内容；
 *   2. 段序：harness:identity → dsh-djy-xttsc:global → deployment:persona-*（即「提前插入」）；
 *   3. 子代理（带自己的 scope + 自己的 scoped 人格段）照样拿到这一段；
 *   4. 设置页写值后，主会话与子代理的提示词都实时跟着变；关掉开关两边都消失；
 *   5. 内置 schemastery 与 host 自带 schemastery 的序列化信封可以互相重建
 *      （设置界面用的就是 host 那份）。
 *
 *   node test/integration.mjs
 *
 * 两个注意点：
 *
 * 1. 被测插件本体用仓库里这一份（`../index.js`），所以 clone 下来、只要机器上装过
 *    dsh，就能直接 `node test/integration.mjs` 验证，不需要先把插件装进 profile。
 * 2. dsh 自带的那几个包按 profile 根目录解析（createRequire）。因为这些包不一定是
 *    本仓库的依赖，写死裸包名在 clone 里会 ERR_MODULE_NOT_FOUND。
 *    profile 位置取 DSH_HOME（缺省 ~/.dsh）下的 profiles/web，可用 DSH_PROFILE 覆盖。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const profileRoot = join(dshHome, 'profiles', process.env.DSH_PROFILE || 'web');
if (!existsSync(join(profileRoot, 'package.json'))) {
  throw new Error('找不到 dsh profile: ' + profileRoot + '（用 DSH_HOME / DSH_PROFILE 覆盖）');
}

/** 按 profile 根目录解析 dsh 自带的包（本仓库没有把它们列为依赖）。 */
const fromProfile = createRequire(join(profileRoot, 'package.json'));
const load = async (request) => import(pathToFileURL(fromProfile.resolve(request)).href);

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
  await root.plugin({
    name: mod.name,
    inject: mod.inject,
    apply: mod.apply,
    Config: mod.Config,
  });

  const prompt = root.get('systemPrompt');
  const settings = root.get('settings');

  // 1. 命名空间
  assert.deepEqual(settings.describe().map((d) => d.ns), [mod.NS], '注册了唯一命名空间');
  const descriptor = settings.describe().find((d) => d.ns === mod.NS);
  assert.deepEqual(descriptor.value, { enabled: true, content: DEFAULT_CONTENT }, '默认解析值');

  // 2. 主会话段序 + 正文
  const main = await prompt.assemble({});
  const names = main.sections.map((s) => s.name);
  assert.ok(names.includes(mod.NS + ':global'), '主会话里有本段');
  assert.ok(
    names.indexOf(mod.NS + ':global') < names.indexOf('deployment:persona-prefix'),
    '排在人格段之前',
  );
  assert.equal(names[0], 'harness:identity', 'Harness 身份仍是第一段');
  assert.ok(renderPrompt(main).includes(DEFAULT_CONTENT), '主会话注入默认内容');

  // 3. 子代理：自己的 scope + 自己的 scoped 人格段
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

  // 4. 热改 + 关开关
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

  // 5. 跨实例 schema 信封（设置界面用的就是 host 自带的那份 schemastery）
  const hostZ = (await load('schemastery')).default;
  const rehydrated = hostZ(mod.Config.toJSON());
  assert.deepEqual(
    rehydrated({}),
    { enabled: true, content: DEFAULT_CONTENT },
    'host 侧能重建本插件的 schema 并解出默认值',
  );

  console.log('✓ dsh-djy-xttsc 真集成验证通过（主会话 / 子代理 / 热改 / 开关 / schema 信封）');
} finally {
  await root.fiber.dispose();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
