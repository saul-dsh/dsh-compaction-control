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
    const VERSION = '0.1.7'
    /** 与内置 ContextMeter 相同的环几何：14px viewBox，2px 描边。 */
    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS
    /** 官方面板宽度：min(264px, 100vw - 24px)。 */
    const PANEL_WIDTH = 264

    /** 全部对齐官方 ContextMeter/菜单面板 tokens（ContextMeter.module.css 同源）。 */
    const CSS = `
.dsh-cc-host { display: inline-flex; align-items: center; flex: none; }
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

.dsh-cc-bar { display: flex; gap: 1px; margin: 8px 0 8px; height: 4px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); overflow: hidden; }
.dsh-cc-bar-seg { flex: none; min-width: 2px; height: 100%; border-radius: 1px; background: var(--dsh-cc-tint, var(--dsw-alias-label-tertiary)); }
.dsh-cc-tint-system { --dsh-cc-tint: var(--dsw-static-neutral-bluish-400, #9db2c8); }
.dsh-cc-tint-tools { --dsh-cc-tint: rgb(167, 139, 250); }
.dsh-cc-tint-messages { --dsh-cc-tint: var(--dsw-static-blue-450, #5b8def); }

.dsh-cc-rows { margin: 4px 0 0; }
.dsh-cc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 1px 0; }
.dsh-cc-row dt { color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72)); }
.dsh-cc-row dd { margin: 0; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9)); }
.dsh-cc-dot { display: inline-block; margin-right: 6px; width: 8px; height: 8px; border-radius: 2px; background: var(--dsh-cc-tint); vertical-align: baseline; }

.dsh-cc-section { border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)); margin-top: 8px; padding-top: 6px; }

.dsh-cc-disclose {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; height: 28px; padding: 0 4px 0 8px;
  border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72));
  font-size: 13px; line-height: 20px; font-weight: 400;
  cursor: pointer;
}
.dsh-cc-disclose:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.dsh-cc-caret { color: var(--dsw-alias-label-caption, rgba(232, 238, 250, 0.45)); font-size: 12px; }

.dsh-cc-compact-btn {
  width: 100%; height: 24px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9));
  font-size: 12px; line-height: 20px;
  cursor: pointer;
  transition: background 120ms ease;
}
.dsh-cc-compact-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.dsh-cc-compact-btn[disabled] { opacity: 0.5; cursor: default; }

.dsh-cc-fields { margin-top: 4px; }
.dsh-cc-btnrow { display: flex; gap: 6px; margin-top: 4px; }
.dsh-cc-save {
  flex: 1; height: 24px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9));
  font-size: 12px; line-height: 20px;
  cursor: pointer;
  transition: background 120ms ease;
}
.dsh-cc-save:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.dsh-cc-save[disabled] { opacity: 0.5; cursor: default; }
/* 恢复默认：官方菜单行样式（ghost 行，hover 背景无描边） */
.dsh-cc-reset {
  flex: 1; height: 24px; padding: 0 4px;
  border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72));
  font-size: 12px; line-height: 20px; font-weight: 400;
  cursor: pointer;
}
.dsh-cc-reset:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.dsh-cc-reset[disabled] { opacity: 0.5; cursor: default; }

.dsh-cc-field { display: flex; align-items: center; gap: 8px; padding: 1px 0; font-size: 12px; line-height: 20px; }
.dsh-cc-field-label { flex: none; width: 56px; color: var(--dsw-alias-label-tertiary, rgba(232, 238, 250, 0.55)); }
.dsh-cc-field-value { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, rgba(232, 238, 250, 0.9)); min-width: 30px; text-align: right; }
.dsh-cc-slider { flex: 1; height: 2px; accent-color: var(--dsw-static-blue-450, #5b8def); cursor: pointer; }
.dsh-cc-check { accent-color: var(--dsw-static-blue-450, #5b8def); width: 13px; height: 13px; cursor: pointer; }
.dsh-cc-hint { font-size: 11px; line-height: 16px; color: rgb(234, 179, 8); margin: 2px 0 4px; display: none; }
.dsh-cc-hint-show { display: block; }

.dsh-cc-flash { margin-top: 6px; font-size: 11px; line-height: 16px; border-radius: var(--dsw-radius-sm, 8px); padding: 4px 8px; display: none; }
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

    /**
     * 模型选择器按钮 = 输入区里视觉最靠右的下拉按钮（发送按钮按语义排除，
     * prompt-enhancer 同款判别）。槽位顺序在这个运行时不可控，所以圆环
     * 用自建 host 节点锚定到它紧左边。
     */
    function findModelButton() {
      const dock = document.querySelector('[data-composer-dock]')
      const scope = dock?.parentElement ?? document
      const isSend = (b) => /send|发送|排队|steer/i.test(b.getAttribute('aria-label') ?? '')
      const menus = [...scope.querySelectorAll('button')].filter((b) => {
        if (isSend(b) || !b.isConnected) return false
        return b.getAttribute('aria-haspopup') !== null || /▾/.test(b.textContent ?? '')
      })
      if (!menus.length) return null
      return menus.reduce((right, b) => (
        b.getBoundingClientRect().right > right.getBoundingClientRect().right ? b : right
      ))
    }

    /** 几何校正：把 host 拉到锚点按钮的左缘 + 垂直中线（只在错位时动）。 */
    function correctHost(host) {
      const anchor = findModelButton()
      if (!anchor) return
      host.style.transform = ''
      const a = anchor.getBoundingClientRect()
      const r = host.getBoundingClientRect()
      let dx = 0
      let dy = 0
      if (a.height > 0 && r.height > 0) {
        const centerDelta = a.top + a.height / 2 - (r.top + r.height / 2)
        if (Math.abs(centerDelta) >= 2) dy = Math.round(centerDelta)
      }
      // 横向只在错位时校正：与按钮重叠、或离按钮左缘超过 24px（列容器会把
      // host 甩到容器左缘）。正常 flex 行的 12px gap 不动。
      if (a.width > 0 && r.width > 0) {
        const gap = a.left - r.right
        if (gap < -1 || gap > 24) dx = Math.round(a.left - r.right - 4)
      }
      if (dx !== 0 || dy !== 0) host.style.transform = `translate(${dx}px, ${dy}px)`
    }

    /**
     * 把 host 节点插到模型选择器紧左边，复制其 flex order（等 order 时按 DOM 序）。
     * 这个运行时模型按钮的父容器不保证是工具条 flex 行（实测会把圆环顶到
     * 上一行），所以插入后做几何自校正——不依赖任何容器布局假设。
     */
    function anchorHost(host) {
      const anchor = findModelButton()
      if (!anchor?.parentNode) return false
      const order = getComputedStyle(anchor).order
      if (order && order !== '0') host.style.order = order
      anchor.parentNode.insertBefore(host, anchor)
      correctHost(host)
      return true
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
      const [resetting, setResetting] = useState(false)
      const [expanded, setExpanded] = useState(false)
      const [flash, setFlash] = useState(null)

      const rootRef = useRef(null)
      const panelRef = useRef(null)
      const [host, setHost] = useState(null)

      const context = occupancy(pressure)

      // 宿主节点：锚定在模型选择器按钮紧左边（槽位顺序在此运行时不可控）。
      // React 只渲染进我们自己的 host，host 本身由我们搬运，React 不知情，
      // 重渲染不会打架；MutationObserver 在界面重建后把掉线的 host 接回去。
      useEffect(() => {
        const hostNode = document.createElement('span')
        hostNode.className = 'dsh-cc-host'
        let anchored = anchorHost(hostNode)
        if (!anchored) {
          const dock = document.querySelector('[data-composer-dock]')
          ;(dock?.parentNode ?? document.body).appendChild(hostNode)
        }
        setHost(hostNode)
        const reposition = () => {
          if (!hostNode.isConnected) anchored = anchorHost(hostNode)
          else correctHost(hostNode)
        }
        const observer = new MutationObserver(reposition)
        observer.observe(document.body, { childList: true, subtree: true })
        window.addEventListener('resize', reposition)
        return () => {
          observer.disconnect()
          window.removeEventListener('resize', reposition)
          hostNode.remove()
          setHost(null)
        }
      }, [])

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

      if (context === null || host === null || createPortal === null) return null

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
            setFlash({ kind: 'ok', text: '已保存，重启 dsh 后生效' })
          }
        } catch (err) {
          setFlash({ kind: 'err', text: `请求失败：${String(err?.message ?? err)}` })
        } finally {
          setSaving(false)
        }
      }

      const onReset = async () => {
        if (resetting) return
        setResetting(true)
        setFlash(null)
        try {
          const res = await fetch(`${ENDPOINT}/reset`, { method: 'POST', headers: { 'content-type': 'application/json' } })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.ok) {
            setFlash({ kind: 'err', text: data?.error ?? `恢复失败（HTTP ${res.status}）` })
          } else {
            setSettings({ ...settings, state: data.state, profiles: data.profiles })
            setDraft({
              auto: data.state.auto,
              thresholdRatio: data.state.thresholdRatio,
              retainRatio: data.state.retainRatio,
              hideBuiltIn: data.state.hideBuiltIn,
            })
            setExpanded(false)
            setFlash({ kind: 'ok', text: '已恢复默认，重启 dsh 后生效' })
          }
        } catch (err) {
          setFlash({ kind: 'err', text: `请求失败：${String(err?.message ?? err)}` })
        } finally {
          setResetting(false)
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
          h('button', { type: 'button', className: 'dsh-cc-compact-btn', disabled: busy, onClick: onCompact },
            busy ? '正在压缩…' : '立即压缩当前会话')),

        h('div', { className: 'dsh-cc-section' },
          h('button', {
            type: 'button',
            className: 'dsh-cc-disclose',
            'aria-expanded': expanded,
            onClick: () => setExpanded(!expanded),
          },
          h('span', null, '自定义压缩'),
          h('span', { className: 'dsh-cc-caret' }, expanded ? '▾' : '▸')),
          expanded ? h('div', { className: 'dsh-cc-fields' },
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
            h('div', { className: 'dsh-cc-btnrow' },
              h('button', { type: 'button', className: 'dsh-cc-save', disabled: saving || !draft, onClick: onSave },
                saving ? '保存中…' : '保存设置'),
              h('button', { type: 'button', className: 'dsh-cc-reset', disabled: resetting, onClick: onReset },
                resetting ? '恢复中…' : '恢复默认')))
            : null),

        flash ? h('div', { className: `dsh-cc-flash dsh-cc-flash-${flash.kind}` }, flash.text) : null)

      return createPortal(
        h('span', { ref: rootRef, className: 'dsh-cc-root' },
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
          open ? createPortal(panel, document.body) : null),
        host)
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
