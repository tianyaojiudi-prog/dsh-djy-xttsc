/* dsh-djy-xttsc —— 客户端半区
 *
 * 在设置面板里挂一个「大肥鱼指令」分区（slot: settings.section）：
 *   - 开关：是否启用注入
 *   - 文本框：随时改写要注入的内容
 *   - 保存 / 恢复默认
 * 读写走 ctx.settingsScope.bind('dsh-djy-xttsc')，也就是 Host 端注册的
 * 同一个设置命名空间：浏览器写 → Host 持久化 → Host 侧系统提示词段实时换文本。
 */
window.__ModuleLoader__.load({
  id: 'dsh-djy-xttsc',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');

    /** 必须与 Host 端 index.js 的 NS 完全一致。 */
    var NS = 'dsh-djy-xttsc';
    var DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';

    /** 依赖的客户端服务：slots 提供注册位，settingsScope 提供跨线读写。 */
    var inject = ['slots', 'settingsScope'];

    var S = {
      box: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '4px 2px 20px',
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: '1.6',
        color: 'inherit'
      },
      title: {
        margin: '0',
        fontSize: '15px',
        fontWeight: '600'
      },
      hint: {
        margin: '0',
        opacity: '0.72',
        fontSize: '12px'
      },
      warn: {
        margin: '0',
        fontSize: '12px',
        lineHeight: '1.6',
        padding: '8px 10px',
        borderRadius: '6px',
        border: '1px solid rgba(234,179,8,0.35)',
        background: 'rgba(234,179,8,0.08)'
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap'
      },
      switchRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 12px',
        border: '1px solid rgba(127,127,127,0.28)',
        borderRadius: '8px',
        cursor: 'pointer',
        userSelect: 'none'
      },
      area: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '132px',
        resize: 'vertical',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid rgba(127,127,127,0.28)',
        background: 'rgba(127,127,127,0.06)',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: '1.6',
        outline: 'none'
      },
      btn: {
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'rgba(127,127,127,0.12)',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: '12px',
        cursor: 'pointer'
      },
      btnPrimary: {
        padding: '6px 16px',
        borderRadius: '6px',
        border: '1px solid rgba(59,130,246,0.55)',
        background: 'rgba(59,130,246,0.18)',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer'
      },
      ok: { fontSize: '12px', color: '#22c55e' },
      err: { fontSize: '12px', color: '#ef4444' },
      note: {
        margin: '0',
        fontSize: '12px',
        opacity: '0.62',
        borderTop: '1px solid rgba(127,127,127,0.2)',
        paddingTop: '10px'
      }
    };

    function statusText(status, writable) {
      if (status === 'loading') return '读取中…';
      if (status === 'unavailable') return '不可用（Host 未注册 dsh-djy-xttsc 设置项）';
      if (status === 'ready') {
        return writable ? '已连接 · 写入 Host 设置文件' : '只读（当前连接不落盘）';
      }
      return String(status);
    }

    function XttscSection(props) {
      var scope = props.scope;

      var subscribe = react.useCallback(function (onChange) {
        return scope.subscribe(onChange);
      }, [scope]);
      var read = react.useCallback(function () {
        return scope.getSnapshot();
      }, [scope]);

      // getSnapshot 在两次变化之间返回稳定引用，正好满足 useSyncExternalStore。
      var snap = react.useSyncExternalStore(subscribe, read, read);
      var value = snap ? snap.value : undefined;

      var stored = value && typeof value.content === 'string' ? value.content : DEFAULT_CONTENT;
      var enabled = value ? value.enabled !== false : true;
      var status = snap ? snap.status : 'loading';
      var writable = !!(snap && snap.writable);

      var textPair = react.useState(stored);
      var text = textPair[0];
      var setText = textPair[1];
      var savedRef = react.useRef(stored);

      // 远端值变了才覆盖草稿，避免打字打到一半被快照刷新冲掉。
      react.useEffect(function () {
        if (savedRef.current === stored) return;
        savedRef.current = stored;
        setText(stored);
      }, [stored]);

      var msgPair = react.useState(null);
      var msg = msgPair[0];
      var setMsg = msgPair[1];
      var busyPair = react.useState(false);
      var busy = busyPair[0];
      var setBusy = busyPair[1];

      var run = react.useCallback(function (work) {
        setBusy(true);
        setMsg(null);
        Promise.resolve()
          .then(work)
          .then(function () {
            setMsg({ kind: 'ok', text: '已保存' });
          })
          .catch(function (error) {
            setMsg({
              kind: 'err',
              text: '保存失败：' + (error && error.message ? error.message : String(error))
            });
          })
          .then(function () {
            setBusy(false);
          });
      }, []);

      var onToggle = function (next) {
        if (busy) return;
        run(function () { return scope.set('enabled', next); });
      };
      var onSave = function () {
        if (busy) return;
        run(function () { return scope.set('content', text); });
      };
      var onReset = function () {
        if (busy) return;
        savedRef.current = DEFAULT_CONTENT;
        setText(DEFAULT_CONTENT);
        run(function () { return scope.set('content', DEFAULT_CONTENT); });
      };

      var dirty = text !== stored;
      var zero = !stored.trim();

      return react.createElement(
        'div',
        { style: S.box, 'data-dsh-djy-xttsc': 'section' },
        react.createElement('h3', { style: S.title }, '大肥鱼指令注入'),
        react.createElement(
          'p',
          { style: S.hint },
          '开启后，下面的内容会作为全局系统提示词段注入到每一个会话——包括本会话、子代理，以及工作流内部派生的子代理。'
            + '它排在 Harness 身份段之后、人格与工具说明之前。修改即时生效，无需重启。'
        ),
        react.createElement(
          'p',
          { style: S.warn },
          '这里就是唯一真源：改了却没反应，通常是别处还写了同一句。'
            + '检查工作区 AGENTS.md / AGENTS.local.md、~/.dsh/AGENTS.md，以及 agent 预设里的人格段。'
        ),
        react.createElement(
          'label',
          { style: S.switchRow },
          react.createElement('input', {
            type: 'checkbox',
            checked: enabled,
            disabled: !writable || busy,
            onChange: function (event) { onToggle(event.target.checked); }
          }),
          react.createElement('span', null, enabled ? '已启用' : '已停用'),
          react.createElement(
            'span',
            { style: S.hint },
            enabled ? '（正在注入）' : '（系统提示词中不会出现这一段）'
          )
        ),
        react.createElement('textarea', {
          style: S.area,
          value: text,
          rows: 7,
          spellCheck: false,
          disabled: !writable,
          placeholder: DEFAULT_CONTENT,
          onChange: function (event) { setText(event.target.value); }
        }),
        react.createElement(
          'div',
          { style: S.row },
          react.createElement('button', {
            type: 'button',
            style: S.btnPrimary,
            disabled: !writable || busy || !dirty,
            onClick: onSave
          }, busy ? '保存中…' : '保存'),
          react.createElement('button', {
            type: 'button',
            style: S.btn,
            disabled: !writable || busy,
            onClick: onReset
          }, '恢复默认'),
          msg
            ? react.createElement(
              'span',
              { style: msg.kind === 'err' ? S.err : S.ok },
              msg.text
            )
            : null
        ),
        react.createElement(
          'p',
          { style: S.note },
          '状态：' + statusText(status, writable)
            + ' · 生效文本：' + (enabled ? (zero ? '空（不会注入）' : stored.length + ' 字') : '已停用')
            + (dirty ? ' · 有未保存的修改' : '')
        ),
        status === 'unavailable'
          ? react.createElement(
            'p',
            { style: S.err },
            'Host 半区未加载：检查插件是否已安装并启用，然后刷新页面。'
          )
          : null
      );
    }

    function apply(ctx) {
      var scope;
      try {
        scope = ctx.settingsScope.bind({ namespace: NS });
      } catch (error) {
        ctx.logger?.warn?.('[dsh-djy-xttsc] settingsScope 绑定失败: ' + String(error));
        return;
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: 60,
        label: () => '大肥鱼指令'
      }, function () {
        return react.createElement(XttscSection, { scope: scope });
      }));
    }

    exports.name = NS;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
