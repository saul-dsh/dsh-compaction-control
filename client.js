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
 *   - hideBuiltIn（默认开）：运行时把官方占用环按钮 visibility:hidden。
 *     内置圆环是 InputBar 硬编码（不在槽位里），没有官方关闭开关；识别
 *     特征收严（0.2.2）= dialog 按钮 + svg 带圆 + 文本恰为「NN%」——
 *     0.2.1 的宽泛特征在真机命中了 dock 里的未知按钮，文本白名单把误伤
 *     半径收到最小。MutationObserver 在宿主重挂时补隐藏。
 *   - 落位（0.2.3 起为布局流插入，参照 = 模型选择器本身）：host 插进选
 *     择器所在行、紧贴其左侧，占真实布局空间，与任何按钮结构上不可能重
 *     叠——0.2.0/0.2.1 两轮 fixed 定位不占流先后压住剪贴板和未知按钮；
 *     0.2.2 以剪贴板为参照也错（日志实证 composer.dock 渲染在会话状态行
 *     y≈1004，而非输入 dock 行 y≈796）。选择器所在行以发送按钮（aria-
 *     label「发送消息」，实测特征）定位，插入后做水平线几何防线（0.1.6
 *     落错竖排容器的教训），失败回落剪贴板同排、再次 fixed、最后隐藏。
 *     另：本环永远渲染——0.2.1 的「hideBuiltIn=false 时退场」门已拆
 *     （持久化值恰为 false，环被卸成空壳占位，即用户看到的剪贴板左侧
 *     大间隔）；该开关现在只管官方环的隐藏。
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
    const VERSION = '0.2.4'
    /** 官方环几何 14px viewBox / 2 单位描边；纯图标无百分比文字撑视觉重量，渲染尺寸放大到 18px（描边随比例 ≈2.6px）。 */
    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS
    const RING_SIZE = 18
    /** 官方面板宽度：min(264px, 100vw - 24px)。 */
    const PANEL_WIDTH = 264

    /** 全部对齐官方 ContextMeter/菜单面板 tokens（ContextMeter.module.css 同源）。 */
    const CSS = `
.dsh-cc-host { display: inline-flex; align-items: center; flex: none; margin: 0 2px; }
.dsh-cc-root { display: inline-flex; }
.dsh-cc-trigger {
  display: inline-flex; align-items: center; justify-content: center;
  flex: none; height: 28px; padding: 0 6px;
  border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72));
  font-family: inherit; line-height: 20px;
  cursor: pointer;
}
.dsh-cc-trigger:hover, .dsh-cc-trigger[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72));
}
.dsh-cc-ring-track { fill: none; stroke: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.18)); stroke-width: 2; }
.dsh-cc-ring-fill { fill: none; stroke: var(--dsw-alias-label-secondary, rgba(232, 238, 250, 0.72)); stroke-width: 2; stroke-linecap: round; transition: stroke-dasharray 200ms ease; }

.dsh-cc-panel {
  position: fixed; z-index: 1100; box-sizing: border-box;
  width: min(264px, calc(100vw - 24px)); max-height: 70vh; overflow-y: auto;
  padding: 12px;
  border: 0; border-radius: 14px;
  /* 底色写死 0.94，不用 --dsw-specific-menu：Windows 默认值是 rgba(67,69,74,.45)，
     那是给带 MenuSurface 底衬的官方菜单用的；插件 portal 到 body 没有底衬，
     45% 一旦 backdrop-filter 失效就发灰糊在背景上。0.94 取自 dsh 的 macOS 档。 */
  background: rgba(248, 249, 250, 0.94);
  backdrop-filter: blur(40px) saturate(150%);
  -webkit-backdrop-filter: blur(40px) saturate(150%);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.07),
    0 3px 8px 0 rgba(0, 0, 0, 0.04),
    0 0 20px 0 rgba(0, 0, 0, 0.05);
  font-size: 12px; line-height: 20px;
  color: rgba(28, 30, 34, 0.86);
  cursor: default;
  animation: dsh-cc-in 140ms ease-out both;
}
body[data-ds-dark-theme] .dsh-cc-panel {
  background: rgba(48, 49, 54, 0.94);
  box-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 0.10),
    0 3px 8px 0 rgba(0, 0, 0, 0.04),
    0 0 20px 0 rgba(0, 0, 0, 0.05);
  color: rgba(232, 238, 250, 0.72);
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

    /**
     * 官方占用环按钮的识别特征：dialog 按钮 + 双 circle svg。rc.5 起官方
     * 环从 composer dock 移到了状态行，特征不再限定容器、全文匹配；必须
     * 排除我们自己的触发按钮（同款几何，全文扫描会扫到自己）。
     */
    function findBuiltInMeterButtons() {
      const found = []
      for (const btn of document.querySelectorAll('button[aria-haspopup="dialog"]')) {
        if (btn.classList.contains('dsh-cc-trigger')) continue
        const svg = btn.querySelector('svg')
        if (svg && svg.querySelectorAll('circle').length >= 2) found.push(btn)
      }
      return found
    }

    /**
     * 官方占用环按钮的识别特征（0.2.2 收严）：dialog 按钮 + svg 带圆 +
     * 文本恰为「NN%」。0.2.1 的「全文 dialog + 双 circle」宽泛特征在真机
     * 命中了 dock 里一个未知按钮（correct-trace mode:"meter" 坐标 965,796），
     * 宽泛特征必然误伤，文本白名单把爆炸半径收到最小；若官方环文本形态
     * 不同则不隐藏（无害降级，官方环照常显示）。
     */
    function findBuiltInMeterButtons() {
      const found = []
      for (const btn of document.querySelectorAll('button[aria-haspopup="dialog"]')) {
        if (btn.classList.contains('dsh-cc-trigger')) continue
        if (!/^\d+%$/.test((btn.textContent ?? '').trim())) continue
        const svg = btn.querySelector('svg')
        if (svg && svg.querySelectorAll('circle').length >= 1) found.push(btn)
      }
      return found
    }

    /** 剪贴板按钮（dsh-composer 片段入口）：自家组件，落位参照物零猜测。 */
    function findClipboardAnchor() {
      const btn = document.querySelector('.dsh-cs-btn')
      if (!btn?.isConnected) return null
      const span = btn.closest('.dsh-cs-anchor') ?? btn.parentElement
      if (!span?.parentNode) return null
      return { row: span.parentNode, span }
    }

    /**
     * 模型选择器（fixed 回落模式用）：发送按钮（aria-label「发送消息」，
     * 实测特征）左侧最靠右的下拉按钮。不再猜模型按钮的 label——它实际是
     * 模型名（如「DeepSeek-V4.1-Flash」），「选择模型」判别式从未命中过。
     */
    function findPickerButton() {
      const send = [...document.querySelectorAll('button[aria-label]')]
        .find((b) => /发送消息|send message/i.test(b.getAttribute('aria-label') ?? ''))
      if (!send) return null
      const s = send.getBoundingClientRect()
      const popups = [...document.querySelectorAll('button[aria-haspopup]')].filter((b) =>
        b.isConnected && b.offsetParent !== null
        && !b.classList.contains('dsh-cc-trigger')
        && b.getBoundingClientRect().right <= s.left + 1)
      if (!popups.length) return null
      return popups.reduce((right, b) => (
        b.getBoundingClientRect().right > right.getBoundingClientRect().right ? b : right
      ))
    }

    /** 落位 trace 节流 10s（w/h 用来区分「环渲染了」还是「空壳占位」）。 */
    function tracePlacement(host, mode, anchor) {
      const now = Date.now()
      if (tracePlacement.last && now - tracePlacement.last < 10_000) return
      tracePlacement.last = now
      const r = host.getBoundingClientRect()
      report('correct', {
        mode,
        left: Math.round(r.left), top: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
        anchorLeft: anchor ? Math.round(anchor.left) : undefined,
        anchorTop: anchor ? Math.round(anchor.top) : undefined,
      })
    }

    /** 几何防线否决记录：模型选择器行插入被证明落错容器后，本会话不再重试（防每秒重插闪烁）。 */
    let pickerRowBroken = false

    /**
     * 模型选择器所在行（布局流首选落点）。0.2.2 日志实证：composer.dock 的
     * 剪贴板渲染在会话状态行（y≈1004）而非输入 dock 行（y≈796），以它为参
     * 照圆环会落错行——必须以模型选择器自身为参照。行容器由发送按钮定位
     * （aria-label「发送消息」，实测可靠特征），再从选择器按钮上爬到该行的
     * 直接子级包装，插到它前面 = 模型选择器紧左侧。
     */
    function findPickerRowAnchor() {
      if (pickerRowBroken) return null
      const send = [...document.querySelectorAll('button[aria-label]')]
        .find((b) => /发送消息|send message/i.test(b.getAttribute('aria-label') ?? ''))
      if (!send?.isConnected) return null
      const s = send.getBoundingClientRect()
      const popups = [...document.querySelectorAll('button[aria-haspopup]')].filter((b) =>
        b.isConnected && b.offsetParent !== null
        && !b.classList.contains('dsh-cc-trigger')
        && b.getBoundingClientRect().right <= s.left + 1)
      if (!popups.length) return null
      const picker = popups.reduce((right, b) => (
        b.getBoundingClientRect().right > right.getBoundingClientRect().right ? b : right
      ))
      let row = send.parentElement
      for (let i = 0; row && i < 3 && !row.contains(picker); i++) row = row.parentElement
      if (!row || !row.contains(picker)) return null
      // 容器方向检查：竖排容器（0.1.6 陷阱）在选行阶段就直接否决。
      const rowStyle = getComputedStyle(row)
      if (rowStyle.flexDirection === 'column' || rowStyle.display === 'block') return null
      let wrapper = picker
      for (let i = 0; i < 4 && wrapper.parentElement !== row; i++) wrapper = wrapper.parentElement
      if (wrapper.parentElement !== row) return null
      return { row, wrapper, picker }
    }

    /**
     * 落位（幂等，observer/1s 轮询反复调用）：首选模型选择器所在行（几何
     * 防线守门）→ 剪贴板同排 → fixed 模型选择器左侧 → 隐藏并留候选清单。
     */
    function placeHost(host) {
      const target = findPickerRowAnchor()
      if (target) {
        if (host.style.position) { host.style.position = ''; host.style.zIndex = '' }
        if (host.parentNode !== target.row || host.nextElementSibling !== target.wrapper) {
          target.row.insertBefore(host, target.wrapper)
        }
        if (host.style.display === 'none') host.style.display = ''
        // 几何防线（0.1.6 落错竖排容器的教训）：与选择器不同一水平线则撤销
        // 并永弃此路径。只在 host 已有内容后判定——刚插入的空壳高度为 0，
        // 行容器非垂直居中时中线必错位，会把正确落点误杀（0.2.3 真机实锤：
        // hostTop 792 vs 选择器中线 810 被拒，圆环跌回剪贴板旁）。空壳先接
        // 受落点，1s 轮询在内容渲染后复核。
        const hr = host.getBoundingClientRect()
        const pr = target.picker.getBoundingClientRect()
        if (hr.height > 0 && Math.abs(hr.top + hr.height / 2 - (pr.top + pr.height / 2)) > 8) {
          host.remove()
          pickerRowBroken = true
          report('picker-row-rejected', { hostTop: Math.round(hr.top), pickerTop: Math.round(pr.top), hostH: Math.round(hr.height) })
        } else {
          tracePlacement(host, 'picker-flow', pr)
          return
        }
      }
      const clip = findClipboardAnchor()
      if (clip) {
        if (host.style.position) { host.style.position = ''; host.style.zIndex = '' }
        if (host.parentNode !== clip.row || host.nextElementSibling !== clip.span) {
          clip.row.insertBefore(host, clip.span)
          const now = Date.now()
          if (!placeHost.lastAttach || now - placeHost.lastAttach > 10_000) {
            placeHost.lastAttach = now
            report('flow-attach', {})
          }
        }
        if (host.style.display === 'none') host.style.display = ''
        tracePlacement(host, 'clip-flow', null)
        return
      }
      const picker = findPickerButton()
      if (!picker || picker.offsetParent === null) {
        if (host.style.display !== 'none') {
          host.style.display = 'none'
          if (host.parentNode !== document.body) {
            host.style.position = 'fixed'
            host.style.zIndex = '50'
            document.body.appendChild(host)
          }
          if (!picker) {
            const dock = document.querySelector('[data-composer-dock]')
            const candidates = [...(dock ?? document).querySelectorAll('button')]
              .filter((b) => b.isConnected && b.offsetParent !== null)
              .slice(0, 12)
              .map((b) => `${b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 12) ?? '?'}|menu=${b.getAttribute('aria-haspopup') !== null}`)
            report('anchor-miss', { candidates: candidates.join(' ; ').slice(0, 600) })
          } else {
            report('hidden', { reason: 'anchor-invisible' })
          }
        }
        return
      }
      if (host.style.position !== 'fixed') { host.style.position = 'fixed'; host.style.zIndex = '50' }
      if (host.parentNode !== document.body) document.body.appendChild(host)
      if (host.style.display === 'none') host.style.display = ''
      const a = picker.getBoundingClientRect()
      const r = host.getBoundingClientRect()
      if (r.width <= 0) return
      host.style.left = `${Math.round(a.left - r.width - 8)}px`
      host.style.top = `${Math.round(a.top + (a.height - r.height) / 2)}px`
      tracePlacement(host, 'fixed', a)
    }

    /**
     * 几何校正（0.2.0 起为 fixed 定位同步）：host 脱离布局流挂 body，
     * 坐标完全由锚点按钮矩形驱动——布局流怎么挤都影响不到它（0.1.6/0.1.7
     * 的 transform 校正在 rc.5 布局下仍会被 flex wrap 掉行，根治即脱流）。
     */
    let hideObserver = null
    let hideRefcount = 0
    // visibility:hidden 而非 display:none：官方环占位保留，状态行 flex 不
    // 会把费用/用量按钮挤过来盖住我们的环。
    let knownMeters = new Set()
    function hideBuiltInOnce(force) {
      if (!force && [...knownMeters].every((b) => b.isConnected && b.style.visibility === 'hidden')) return
      knownMeters = new Set(findBuiltInMeterButtons())
      for (const btn of knownMeters) btn.style.visibility = 'hidden'
    }
    function acquireDockHide() {
      hideRefcount += 1
      hideBuiltInOnce(true)
      if (!hideObserver) {
        hideObserver = new MutationObserver(() => hideBuiltInOnce(false))
        hideObserver.observe(document.body, { childList: true, subtree: true })
      }
    }
    function releaseDockHide() {
      hideRefcount = Math.max(0, hideRefcount - 1)
      if (hideRefcount === 0) {
        if (hideObserver) { hideObserver.disconnect(); hideObserver = null }
        for (const btn of knownMeters) btn.style.visibility = ''
        knownMeters = new Set()
      }
    }

    class QuietBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { report('crash', { message: String(error?.message ?? error) }) }
      render() { return this.state.error ? null : this.props.children }
    }

    // 官方命令通道：dock 槽位组件的标准 props 带 inputActions（followup
    // 同款）。「立即压缩」优先把 /compact 落进草稿再 submit——命令在
    // agent 宿主进程执行，不受本进程 webServer 无 agents 服务的影响。
    let commandBridge = null

    function CommandBridge(props) {
      useEffect(() => {
        commandBridge = props.inputActions ?? null
        return () => { if (commandBridge === props.inputActions) commandBridge = null }
      }, [props.inputActions])
      return null
    }

    /** 走官方 /compact 命令（草稿→提交），返回是否已受理。 */
    const compactViaCommand = () => {
      if (!commandBridge) return false
      try {
        commandBridge.setDraft('/compact')
        window.setTimeout(() => {
          try { commandBridge.submit() } catch (err) { report('submit-error', { message: String(err?.message ?? err) }) }
        }, 250)
        return true
      } catch (err) {
        report('bridge-error', { message: String(err?.message ?? err) })
        return false
      }
    }

    function RingSvg({ percent }) {
      return h('svg', { viewBox: '0 0 14 14', width: RING_SIZE, height: RING_SIZE, 'aria-hidden': true },
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

      // 宿主节点：插成剪贴板按钮的同排兄弟（布局流，见 placeHost）。React
      // 只渲染进我们自己的 host，host 本身由我们搬运，React 不知情；被宿主
      // 重渲染清掉时 MutationObserver/1s 轮询会重新插回。
      useEffect(() => {
        const hostNode = document.createElement('span')
        hostNode.className = 'dsh-cc-host'
        placeHost(hostNode)
        setHost(hostNode)
        // 幂等落位：React 清掉被插入的 host / 行重排 / 窗口变化都直接重插。
        const reposition = () => placeHost(hostNode)
        const observer = new MutationObserver(reposition)
        observer.observe(document.body, { childList: true, subtree: true })
        window.addEventListener('resize', reposition)
        // 兜底：flex 空间变化等纯布局漂移不触发 DOM mutation，1s 轮询补漏
        // （fixed 同步只是两次 getBoundingClientRect，开销可忽略）。
        const poll = setInterval(reposition, 1000)
        return () => {
          observer.disconnect()
          window.removeEventListener('resize', reposition)
          clearInterval(poll)
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

      // 隐藏官方环的生命周期跟 draft.hideBuiltIn 走（面板里可切换）。
      // 未加载（undefined）也按默认隐藏——任何加载失败场景都不出现双环。
      useEffect(() => {
        if (draft?.hideBuiltIn === false) return undefined
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

      // 0.2.3 拆除 0.2.1 的退场门（hideBuiltIn=false 时本环卸载）：持久化值
      // 恰为 false，环被卸成空 host 占位（用户看到的「剪贴板左侧大间隔」即
      // 空壳）。本环与官方环如今分处两行、永不重叠，该开关只管官方环隐藏。
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
        // 优先官方命令通道：结果以官方 chip 形式出现在对话流里。
        if (compactViaCommand()) {
          setFlash({ kind: 'ok', text: '已执行 /compact，结果见对话流' })
          return
        }
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
              h('span', { className: 'dsh-cc-field-label' }, '官方圆环'),
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
            // 隐形桥接：只为拿 inputActions（setDraft/submit），不渲染任何 UI。
            scope.slots.inject('conversation.input.dock', () => scope.slots.register({
              name: 'conversation.input.dock',
              id: 'dsh-compaction-control-bridge',
              order: 90,
            }, (props) => h(QuietBoundary, null, h(CommandBridge, props))))
            report('register', {})
          }).catch((err) => report('gate-error', { message: String(err?.message ?? err) }))
        })
      },
    }
  },
})
