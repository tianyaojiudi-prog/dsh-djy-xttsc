/* dsh-djy-xttsc —— 客户端半区
 *
 * 在设置面板里挂一个「大肥鱼指令」分区（slot: settings.section）：
 *   - 开关：是否启用注入
 *   - 文本框：随时改写要注入的内容
 *   - 保存 / 恢复默认
 *
 * 两个 dsh 世代的设置传输不同，这里**只走一条**（两条都挂会撞车，见下）：
 *   - dsh ≤ 0.1.6：ctx.settingsScope.bind('dsh-djy-xttsc')，
 *     命名空间由 Host 端 settings.register 注册；
 *   - dsh ≥ 0.1.7（含 0.2.0）：settingsScope 已被移除，改成
 *     ctx.configForms.get('djy-xttsc')，命名空间就是 profile 里这条加载项的条目 id，
 *     Host 端靠 Config 的 volatile 标记把它暴露给设置文档（见 index.js）。
 * 两者的快照形状一致（status / value / writable），所以同一个界面组件直接复用。
 *
 * ⚠ settings.section 是 **list** 槽位，同一个 id 在同一个优先级上注册两次会直接抛
 *   `list slot "settings.section" already has an entry with id "..."`，
 *   条目随即变 failed —— 0.1.7 桌面版就是这么被拖进崩溃恢复的。
 *   0.1.7 起两个服务同时存在，所以下面用 claimed 标志保证只挂一次。
 */
// 冒烟测试在 Node 里加载本文件，没有 window；补一个空壳只影响测试，不影响浏览器。
globalThis.window = globalThis.window || {};

window.__ModuleLoader__.load({
  id: 'dsh-djy-xttsc',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');

    /** dsh ≤ 0.1.6 的设置命名空间（Host 端 settings.register 用的那个）。 */
    var NS = 'dsh-djy-xttsc';
    /** dsh ≥ 0.1.7 的设置命名空间 = profile 里这条加载项的条目 id（见 cordis.patch.yml）。 */
    var ENTRY_ID = 'djy-xttsc';
    var DEFAULT_CONTENT = '你是一条大肥鱼，需要每次在回复用户后就卖萌';

    /**
     * 这里**故意留空**：0.1.7 的客户端已经删掉 `settingsScope`，而前端启动检查
     * 会把任何非 active 的条目判成致命错误：
     *   web boot: 1 entry did not activate — pending (waiting for service: settingsScope)
     * 硬依赖会让整个条目永远 pending，进而触发崩溃恢复并清掉 profile。
     * 改成软依赖：见下面的 apply —— 按服务在不在挑一条路，两条都挂不上就安静跳过。
     */
    var inject = [];


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
      if (status === 'unavailable') return '不可用（Host 未注册这条配置项）';
      if (status === 'ready') {
        return writable ? '已连接 · 写入 Host 设置文件' : '只读（当前连接不落盘）';
      }
      return String(status);
    }

    /** 读一次快照；scope 不可用或抛错时退化成“读取中”，组件不炸。 */
    function readScopeSnapshot(scope) {
      try {
        return scope.getSnapshot() ?? {
          status: 'loading',
          value: undefined,
          writable: false
        };
      } catch (error) {
        return { status: 'loading', value: undefined, writable: false };
      }
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
          .then(function (result) {
            // 0.1.7 的 configForms.set() 以 false 表示 Host 拒绝了这次写入。
            if (result === false) throw new Error('Host 没有接受这次写入');
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

    /** 设置分区的注册参数（两代共用）。 */
    function sectionOptions() {
      return {
        name: 'settings.section',
        id: NS,
        order: 60,
        label: function () { return '大肥鱼指令'; }
      };
    }

    /**
     * 「大肥鱼指令」分区的挂载器。
     *
     * 关键点：settings.section 是 list 槽位，同 id 同优先级注册两次会直接抛错并把条目
     * 打成 failed。0.1.7 起 configForms 与 settingsScope 同时存在，所以这里用 claimed
     * 标志保证「谁先就位谁挂，另一个让路」。
     */
    function PageMounter(scope) {
      this.scope = scope;
      /** 这一轮的分区已经有人挂了。 */
      this.claimed = false;
      /** 当前这一代注册的令牌，用来做 only-if-current 的收回。 */
      this.claim = null;
      /** 当前这一代注册的 disposer。 */
      this.off = null;
      /** 挂载用的槽位服务（由 adopt 固定）。 */
      this.slots = null;
    }

    /** 收回挂载（跟随注册的 disposer 用）。传 `claim` 时 only-if-current。 */
    PageMounter.prototype.release = function release(claim) {
      if (claim !== undefined && claim !== this.claim) return;
      this.claim = null;
      this.claimed = false;
      if (!this.off) return;
      var off = this.off;
      this.off = null;
      off();
    };

    /**
     * 接管一次挂载：拿到这一代的令牌。之后 `register(claim)` 是「挂上这一代」，
     * `release(claim)` 是「收回这一代」。已经被挂过就返回 null（让路）。
     */
    PageMounter.prototype.adopt = function adopt(slots) {
      if (this.claimed) return null;
      this.claim = {};
      this.claimed = true;
      this.slots = slots;
      return this.claim;
    };

    /** 用 adopt 拿到的令牌真正注册分区；返回注册的 disposer。 */
    PageMounter.prototype.register = function register(claim) {
      if (claim !== this.claim || this.off) return this.off;
      var self = this;
      // 返回值必须是 disposer：whileServed 在命名空间不再被服务时要收回注册。
      this.off = this.slots.inject('settings.section', function () {
        return self.slots.register(sectionOptions(), function () {
          return react.createElement(XttscSection, { scope: self.scope });
        });
      });
      return this.off;
    };

    /**
     * dsh ≥ 0.1.7 路线：把设置传输接到 configForms 的条目表单上。
     * 命名空间要等 Host 把它投影进设置文档（Config 标了 volatile）才出现，
     * 所以先读一次快照；没就位就交给 whileServed 盯着。
     * @returns 跟随注册的 disposer。
     */
    function adoptConfigForms(ctx, controller) {
      var forms = ctx.configForms;
      if (!forms || typeof forms.get !== 'function' || typeof forms.whileServed !== 'function') {
        return function () {};
      }
      // 不要 dispose 这个 scope —— configForms 提供方缓存并持有它，
      // 条目每次热重载都从缓存里拿同一个实例，dispose 掉表单就再也不更新了。
      var scope = forms.get(ENTRY_ID);
      controller.scope = scope;
      var register = function () {
        var claim = controller.adopt(ctx.slots);
        if (claim === null) return function () {}; // 已经被 settingsScope 那条路挂了
        // 注意：slots.inject 的注册回调是异步生效的，register(claim) 自己按令牌
        // 判断这一代是否还有效，所以这里直接注册即可。
        controller.register(claim);
        return function () {
          controller.release(claim);
        };
      };
      if (readScopeSnapshot(scope).status === 'ready') register();
      else forms.whileServed([ENTRY_ID], register);
      return function () {
        controller.release();
      };
    }

    /** dsh ≤ 0.1.6 路线：设置传输是 settingsScope，命名空间由 Host 端 register 注册。 */
    function adoptSettingsScope(ctx, controller) {
      var binder = ctx.settingsScope;
      if (!binder || typeof binder.bind !== 'function') return false;
      controller.scope = binder.bind({ namespace: NS });
      var claim = controller.adopt(ctx.slots);
      if (claim === null) return false;
      controller.register(claim);
      return true;
    }

    function apply(ctx) {
      var controller = new PageMounter(null);
      try {
        // ---- dsh ≥ 0.1.7：设置传输是 configForms，命名空间 = profile 条目 id。----
        ctx.inject(['slots', 'configForms'], function (sctx) {
          try {
            sctx.effect(function () {
              return adoptConfigForms(sctx, controller);
            }, 'dsh-djy-xttsc: settings page');
          } catch (error) {
            sctx.logger?.warn?.('[dsh-djy-xttsc] configForms 绑定失败: ' + String(error));
          }
        });

        // ---- dsh ≤ 0.1.6：设置传输是 settingsScope。----
        ctx.inject(['slots', 'settingsScope'], function (sctx) {
          if (controller.claimed) return; // 上一路已经挂上了，让路
          try {
            adoptSettingsScope(sctx, controller);
          } catch (error) {
            sctx.logger?.warn?.('[dsh-djy-xttsc] settingsScope 绑定失败: ' + String(error));
          }
        });
      } catch (error) {
        // 兜底：apply 抛错会让条目变 failed，同样触发前端的致命启动检查。
        ctx.logger?.warn?.('[dsh-djy-xttsc] 设置分区未挂载: ' + String(error));
      }
    }

    exports.name = NS;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
