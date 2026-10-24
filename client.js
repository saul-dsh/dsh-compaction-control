/**
 * dsh-compaction-control 的 web 客户端部分。
 *
 * 在输入栏右侧区（conversation.input.right，list 槽位，渲染在模型选择器
 * 左边）放一颗和内置 ContextMeter 同款几何的上下文占用圆环：
 *
 *   - 数据走官方会话投影：useProjection('contextPressure') /
 *     'contextBreakdown'（token-meter 注册，session 标准 props 自动下发），
 *     不碰内部 RPC。
 *   - 点开面板 = 内置面板的三段构成（系统提示/工具/对话）+ 两个新能力：
 *       1. 「立即压缩」→ POST /api/dsh-compaction-control/compact，
 *          服务端 ctx.compaction.compactNow(agent, signal)（官方 /compact
 *          的编程入口，等价免打字）。
 *       2. 自动压缩调节（auto 开关 / 触发阈值 / 保留比例）→ POST
 *          /state，服务端写 profile 用户补丁层，重启后生效。
 *   - hideBuiltIn（默认开）：运行时把 dock 条里内置圆环按钮 display:none。
 *     内置圆环是 InputBar 硬编码（不在槽位里），没有官方关闭开关；识别
 *     特征 = [data-composer-dock] 里带双 circle svg 的 dialog 按钮，
 *     MutationObserver 在 dock 重挂时补隐藏。
 *
 * 诊断：boot/register/crash 上报服务端 /diag，落
 * ~/.dsh/compaction-control-debug.log；window.__dshCompactionControl 供检查。
 */

window.__ModuleLoader__.load({
  id: 'dsh-compaction-control',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    // react shim 没有 createPortal；必须从 react-dom 取（内置组件同款做法）。
    let createPortal = null
    try {
      const ReactDOM = require('react-dom')
      if (typeof ReactDOM?.createPortal === 'function') createPortal = ReactDOM.createPortal
    } catch { createPortal = null }

    const ENDPOINT = '/api/dsh-compaction-control'
    const VERSION = '0.1.2'
    /** 与内置 ContextMeter 相同的环几何：14px viewBox，2px 描边。 */
    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS
    /** 官方面板宽度：min(264px, 100vw - 24px)。 */
    const PANEL_WIDTH = 264

    /** 全部对齐官方 ContextMeter/菜单面板 tokens（ContextMeter.module.css 同源）。 */
    const CSS = `
.dsh-cc-root { display: inline-flex; }
.dsh-cc-trigger {
  display: inline-flex; align-items: center; justify-content: center;
  flex: none; padding: 2px 6px;
  border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, rgba(232, 238, 250, 0.55));
  font-family: inherit; line-height: 20px;
  cursor: pointer;
}
.dsh-cc-trigger:hover, .dsh-cc-trigger[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72));
}
.dsh-cc-ring-track { fill: none; stroke: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.18)); stroke-width: 2; }
.dsh-cc-ring-fill { fill: none; stroke: var(--dsw-alias-label-tertiary, rgba(232, 238, 250, 0.55)); stroke-width: 2; stroke-linecap: round; transition: stroke-dasharray 200ms ease; }

.dsh-cc-panel {
  position: fixed; z-index: 1100; box-sizing: border-box;
  width: min(264px, calc(100vw - 24px)); max-height: 70vh; overflow-y: auto;
  padding: 12px;
  border: 0; border-radius: var(--dsw-radius-lg, 14px);
  background: var(--dsw-specific-menu, rgba(28, 28, 34, 0.97));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 40px rgba(0, 0, 0, 0.45));
  font-size: 12px; line-height: 20px;
  color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72));
  cursor: default;
  animation: dsh-cc-in 140ms ease-out both;
}
/* 只动 opacity：展开方向由内联 transform 控制，keyframes 不能碰 transform */
@keyframes dsh-cc-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dsh-cc-panel { animation: none; } }

.dsh-cc-head { display: flex; align-items: center; gap: 6px; }
.dsh-cc-head-label { color: var(--dsw-alias-label-tertiary, rgba(232, 238, 250, 0.55)); white-space: nowrap; }
.dsh-cc-head-pct { font-weight: 500; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9)); }
.dsh-cc-head-fig { margin-left: auto; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9)); }

.dsh-cc-bar { display: flex; gap: 1px; margin: 10px 0 12px; height: 4px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); overflow: hidden; }
.dsh-cc-bar-seg { flex: none; min-width: 2px; height: 100%; border-radius: 1px; background: var(--dsh-cc-tint, var(--dsw-alias-label-tertiary)); }
.dsh-cc-tint-system { --dsh-cc-tint: var(--dsw-static-neutral-bluish-400, #9db2c8); }
.dsh-cc-tint-tools { --dsh-cc-tint: rgb(167, 139, 250); }
.dsh-cc-tint-messages { --dsh-cc-tint: var(--dsw-static-blue-450, #5b8def); }

.dsh-cc-rows { margin: 6px 0 0; }
.dsh-cc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0; }
.dsh-cc-row dt { color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72)); }
.dsh-cc-row dd { margin: 0; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9)); }
.dsh-cc-dot { display: inline-block; margin-right: 6px; width: 8px; height: 8px; border-radius: 2px; background: var(--dsh-cc-tint); vertical-align: baseline; }

.dsh-cc-section { border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)); margin-top: 10px; padding-top: 8px; }
.dsh-cc-title { margin-bottom: 6px; font-size: 11px; line-height: 16px; letter-spacing: 0.02em; color: var(--dsw-alias-label-tertiary, rgba(232, 238, 250, 0.55)); }

.dsh-cc-compact-btn, .dsh-cc-save {
  width: 100%; height: 26px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9));
  font-size: 12px; line-height: 20px;
  cursor: pointer;
  transition: background 120ms ease;
}
.dsh-cc-compact-btn:hover, .dsh-cc-save:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.dsh-cc-compact-btn[disabled], .dsh-cc-save[disabled] { opacity: 0.5; cursor: default; }

.dsh-cc-field { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 12px; line-height: 20px; }
.dsh-cc-field-label { flex: none; width: 56px; color: var(--dsw-alias-label-tertiary, rgba(232, 238, 250, 0.55)); }
.dsh-cc-field-value { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9)); min-width: 30px; text-align: right; }
.dsh-cc-slider { flex: 1; height: 2px; accent-color: var(--dsw-static-blue-450, #5b8def); cursor: pointer; }
.dsh-cc-check { accent-color: var(--dsw-static-blue-450, #5b8def); width: 13px; height: 13px; cursor: pointer; }
.dsh-cc-hint { font-size: 11px; line-height: 16px; color: rgb(234, 179, 8); margin: 2px 0 4px; display: none; }
.dsh-cc-hint-show { display: block; }

.dsh-cc-note { margin-top: 8px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, rgba(232, 238, 250, 0.45)); }
.dsh-cc-flash { margin-top: 8px; font-size: 11px; line-height: 16px; border-radius: var(--dsw-radius-sm, 8px); padding: 5px 8px; display: none; }
.dsh-cc-flash-ok { display: block; background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72)); }
.dsh-cc-flash-err { display: block; background: rgba(239, 68, 68, 0.12); color: #fca5a5; }
`

    const STYLE_ID = 'dsh-compaction-control-style'

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    const report = (phase, extra) => {
      try {
        fetch(`${ENDPOINT}/diag`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ line: `${phase} ${JSON.stringify(extra ?? {})}`.slice(0, 1800) }),
        }).catch(() => {})
      } catch { /* ignore */ }
    }

    /** 与内置 ContextMeter 同款紧凑数字（K / M）。 */
    function formatTokens(value) {
      if (value < 1000) return String(value)
      const scale = (n) => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10))
      if (value < 1000000) return `${scale(value / 1000)}K`
      return `${scale(value / 1000000)}M`
    }

    /** contextPressure → 占用（与 ui-conversation 的 contextOccupancy 同算法）。 */
    function occupancy(pressure) {
      const used = pressure?.projectedTokens ?? pressure?.pressureTokens
      if (used === undefined || pressure?.contextWindow === undefined) return null
      return {
        percent: Math.min(100, Math.round((used / pressure.contextWindow) * 100)),
        usedTokens: used,
        contextWindow: pressure.contextWindow,
      }
    }

    /** dock 里内置圆环的识别特征：dialog 按钮 + 双 circle svg。 */
    function findBuiltInMeterButtons() {
      const found = []
      for (const dock of document.querySelectorAll('[data-composer-dock]')) {
        for (const btn of dock.querySelectorAll('button[aria-haspopup="dialog"]')) {
          const svg = btn.querySelector('svg')
          if (svg && svg.querySelectorAll('circle').length >= 2) found.push(btn)
        }
      }
      return found
    }

    let hideObserver = null
    let hideRefcount = 0
    function acquireDockHide() {
      hideRefcount += 1
      for (const btn of findBuiltInMeterButtons()) btn.style.display = 'none'
      if (!hideObserver) {
        hideObserver = new MutationObserver(() => {
          for (const btn of findBuiltInMeterButtons()) btn.style.display = 'none'
        })
        hideObserver.observe(document.body, { childList: true, subtree: true })
      }
    }
    function releaseDockHide() {
      hideRefcount = Math.max(0, hideRefcount - 1)
      if (hideRefcount === 0) {
        if (hideObserver) { hideObserver.disconnect(); hideObserver = null }
        for (const btn of findBuiltInMeterButtons()) btn.style.display = ''
      }
    }

    class QuietBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { report('crash', { message: String(error?.message ?? error) }) }
      render() { return this.state.error ? null : this.props.children }
    }

    function RingSvg({ percent }) {
      return h('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { className: 'dsh-cc-ring-track', cx: 7, cy: 7, r: RADIUS }),
        h('circle', {
          className: 'dsh-cc-ring-fill',
          cx: 7, cy: 7, r: RADIUS,
          strokeDasharray: `${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`,
          transform: 'rotate(-90 7 7)',
        }))
    }

    function Seat(props) {
      const useProjection = props.useProjection
      const sessionId = props.sessionId
      const pressure = useProjection('contextPressure')
      const breakdown = useProjection('contextBreakdown')

      const [open, setOpen] = useState(false)
      const [pos, setPos] = useState(null)
      const [settings, setSettings] = useState(null)
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [saving, setSaving] = useState(false)
      const [flash, setFlash] = useState(null)

      const rootRef = useRef(null)
      const panelRef = useRef(null)

      const context = occupancy(pressure)

      // 挂载即拉一次服务端状态：hideBuiltIn 要在用户打开面板前就生效。
      useEffect(() => {
        let alive = true
        fetch(`${ENDPOINT}/state`)
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((data) => {
            if (!alive || !data?.state) return
            setSettings(data)
            setDraft({
              auto: data.state.auto,
              thresholdRatio: data.state.thresholdRatio,
              retainRatio: data.state.retainRatio,
              hideBuiltIn: data.state.hideBuiltIn,
            })
          })
          .catch((err) => report('state-error', { message: String(err?.message ?? err) }))
        return () => { alive = false }
      }, [])

      // 隐藏内置圆环的生命周期跟 draft.hideBuiltIn 走（面板里可切换）。
      useEffect(() => {
        if (draft?.hideBuiltIn === undefined) return undefined
        if (!draft.hideBuiltIn) return undefined
        acquireDockHide()
        return () => releaseDockHide()
      }, [draft?.hideBuiltIn])

      // 面板定位 + 外点关闭 + Esc。默认向上展开（translateY(-100%)）；
      // 上方空间不足 460px 时才向下。外点关闭 + Esc。
      useEffect(() => {
        if (!open) return undefined
        const rect = rootRef.current?.getBoundingClientRect()
        if (rect) {
          const left = Math.max(8, Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8))
          const openUp = rect.top > 460
          setPos({
            left,
            top: openUp ? rect.top - 8 : rect.bottom + 8,
            transform: openUp ? 'translateY(-100%)' : 'none',
          })
        }
        const onPointerDown = (e) => {
          const t = e.target
          if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
          setOpen(false)
        }
        const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      // flash 3.5s 自动消散。
      useEffect(() => {
        if (!flash) return undefined
        const timer = setTimeout(() => setFlash(null), 3500)
        return () => clearTimeout(timer)
      }, [flash])

      if (context === null) return null

      const breakdownTotal = breakdown === undefined
        ? 0
        : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
      const rows = [
        { key: 'systemTokens', label: '系统提示', cls: 'dsh-cc-tint-system', value: breakdown?.systemTokens },
        { key: 'toolsTokens', label: '工具定义', cls: 'dsh-cc-tint-tools', value: breakdown?.toolsTokens },
        { key: 'messageTokens', label: '对话历史', cls: 'dsh-cc-tint-messages', value: breakdown?.messageTokens },
      ]
      const segments = breakdownTotal > 0
        ? rows
          .map((row) => ({ ...row, width: (context.percent * row.value) / breakdownTotal }))
          .filter((row) => row.width > 0)
        : [{ key: 'total', cls: '', width: context.percent }]

      const onCompact = async () => {
        if (busy) return
        setBusy(true)
        setFlash(null)
        try {
          const res = await fetch(`${ENDPOINT}/compact`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: String(sessionId) }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.ok) {
            setFlash({ kind: 'err', text: data?.error ?? `压缩失败（HTTP ${res.status}）` })
          } else if (data.empty) {
            setFlash({ kind: 'ok', text: data.message ?? '暂无可压缩的历史' })
          } else {
            setFlash({ kind: 'ok', text: `已压缩 ${data.shadowed} 条历史（约 ${formatTokens(data.tokens ?? 0)} tokens）` })
          }
        } catch (err) {
          setFlash({ kind: 'err', text: `请求失败：${String(err?.message ?? err)}` })
        } finally {
          setBusy(false)
        }
      }

      const onSave = async () => {
        if (saving || !draft) return
        if (draft.retainRatio >= draft.thresholdRatio) {
          setFlash({ kind: 'err', text: '保留比例必须小于触发阈值' })
          return
        }
        setSaving(true)
        setFlash(null)
        try {
          const res = await fetch(`${ENDPOINT}/state`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.ok) {
            setFlash({ kind: 'err', text: data?.error ?? `保存失败（HTTP ${res.status}）` })
          } else {
            setSettings({ ...settings, state: data.state, profiles: data.profiles })
            setFlash({
              kind: 'ok',
              text: `已保存并写入 ${data.profiles?.length ? data.profiles.join('、') : '0 个'} profile 的补丁层，重启 dsh 后生效`,
            })
          }
        } catch (err) {
          setFlash({ kind: 'err', text: `请求失败：${String(err?.message ?? err)}` })
        } finally {
          setSaving(false)
        }
      }

      const panel = h('div', {
        ref: panelRef,
        className: 'dsh-cc-panel',
        role: 'dialog',
        'aria-label': '上下文压缩控制',
        style: pos ? { left: pos.left, top: pos.top, transform: pos.transform } : { visibility: 'hidden', left: 0, top: 0 },
      },
        h('div', { className: 'dsh-cc-head' },
          h('span', { className: 'dsh-cc-head-label' }, '上下文已用'),
          h('span', { className: 'dsh-cc-head-pct' }, `${context.percent}%`),
          h('span', { className: 'dsh-cc-head-fig' }, `~${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}`)),
        h('div', { className: 'dsh-cc-bar' },
          segments.map((seg) => h('div', { key: seg.key, className: `dsh-cc-bar-seg ${seg.cls}`, style: { width: `${seg.width}%` } }))),
        breakdownTotal > 0
          ? h('dl', { className: 'dsh-cc-rows' },
            rows.map((row) => h('div', { key: row.key, className: 'dsh-cc-row' },
              h('dt', null,
                h('span', { className: `dsh-cc-dot ${row.cls}`, 'aria-hidden': true }),
                row.label),
              h('dd', null, `~${formatTokens(row.value ?? 0)}`))))
          : null,

        h('div', { className: 'dsh-cc-section' },
          h('div', { className: 'dsh-cc-title' }, '手动压缩'),
          h('button', { type: 'button', className: 'dsh-cc-compact-btn', disabled: busy, onClick: onCompact },
            busy ? '正在压缩…' : '立即压缩当前会话'),
          h('div', { className: 'dsh-cc-note' }, '仅空闲会话可压缩；等价于官方 /compact 命令。')),

        h('div', { className: 'dsh-cc-section' },
          h('div', { className: 'dsh-cc-title' }, '自动压缩'),
          h('div', { className: 'dsh-cc-field' },
            h('span', { className: 'dsh-cc-field-label' }, '启用'),
            h('input', {
              type: 'checkbox', className: 'dsh-cc-check',
              checked: draft?.auto ?? true,
              onChange: (e) => setDraft({ ...draft, auto: e.target.checked }),
            }),
            h('span', { className: 'dsh-cc-field-value' }, draft?.auto === false ? '已关' : '开')),
          h('div', { className: 'dsh-cc-field' },
            h('span', { className: 'dsh-cc-field-label' }, '触发阈值'),
            h('input', {
              type: 'range', className: 'dsh-cc-slider', min: 50, max: 95, step: 1,
              value: Math.round((draft?.thresholdRatio ?? 0.8) * 100),
              onChange: (e) => setDraft({ ...draft, thresholdRatio: Number(e.target.value) / 100 }),
            }),
            h('span', { className: 'dsh-cc-field-value' }, `${Math.round((draft?.thresholdRatio ?? 0.8) * 100)}%`)),
          h('div', { className: 'dsh-cc-field' },
            h('span', { className: 'dsh-cc-field-label' }, '保留比例'),
            h('input', {
              type: 'range', className: 'dsh-cc-slider', min: 4, max: 40, step: 1,
              value: Math.round((draft?.retainRatio ?? 0.16) * 100),
              onChange: (e) => setDraft({ ...draft, retainRatio: Number(e.target.value) / 100 }),
            }),
            h('span', { className: 'dsh-cc-field-value' }, `${Math.round((draft?.retainRatio ?? 0.16) * 100)}%`)),
          h('div', { className: `dsh-cc-hint ${(draft?.retainRatio ?? 0) >= (draft?.thresholdRatio ?? 1) ? 'dsh-cc-hint-show' : ''}` },
            '保留比例需小于触发阈值'),
          h('div', { className: 'dsh-cc-field' },
            h('span', { className: 'dsh-cc-field-label' }, '内置圆环'),
            h('input', {
              type: 'checkbox', className: 'dsh-cc-check',
              checked: draft?.hideBuiltIn ?? true,
              onChange: (e) => setDraft({ ...draft, hideBuiltIn: e.target.checked }),
            }),
            h('span', { className: 'dsh-cc-field-value' }, draft?.hideBuiltIn === false ? '显示' : '已隐藏')),
          h('button', { type: 'button', className: 'dsh-cc-save', disabled: saving || !draft, onClick: onSave },
            saving ? '保存中…' : '保存设置'),
          h('div', { className: 'dsh-cc-note' },
            `参数写入 profile 用户补丁层（compaction-basic），重启 dsh 后生效。当前默认：阈值 80%、保留 16%。`,
            settings?.profiles?.length ? `挂载 profile：${settings.profiles.join('、')}。` : '')),

        flash ? h('div', { className: `dsh-cc-flash dsh-cc-flash-${flash.kind}` }, flash.text) : null)

      return h('span', { ref: rootRef, className: 'dsh-cc-root' },
        h('button', {
          type: 'button',
          className: 'dsh-cc-trigger',
          'aria-label': `上下文已用 ${context.percent}%，打开压缩控制`,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          title: `上下文已用 ${context.percent}%`,
          onClick: () => setOpen(!open),
        },
        h(RingSvg, { percent: context.percent })),
        open && createPortal ? createPortal(panel, document.body) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ensureStyle()
        console.info(`[dsh-compaction-control] client ${VERSION} loading`)
        report('boot', {
          slots: typeof ctx.slots,
          portal: createPortal ? 'react-dom' : 'missing',
        })
        window.__dshCompactionControl = { version: VERSION }

        ctx.inject(['slots'], (scope) => {
          const gate = Promise.race([
            fetch(`${ENDPOINT}/enabled`)
              .then((res) => (res.ok ? res.json() : { enabled: true }))
              .catch(() => ({ enabled: true })),
            new Promise((resolve) => setTimeout(() => resolve({ enabled: true }), 2500)),
          ])

          gate.then(({ enabled }) => {
            if (enabled === false) {
              report('skip-disabled', {})
              return
            }
            // list 槽位：order 越小越靠前，0 让圆环落在模型选择器左边第一位。
            scope.slots.inject('conversation.input.right', () => scope.slots.register({
              name: 'conversation.input.right',
              id: 'dsh-compaction-control',
              order: 0,
            }, (props) => h(QuietBoundary, null, h(Seat, props))))
            report('register', {})
          }).catch((err) => report('gate-error', { message: String(err?.message ?? err) }))
        })
      },
    }
  },
})
