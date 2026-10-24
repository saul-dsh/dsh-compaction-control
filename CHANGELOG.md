# Changelog

## 0.1.9 — 2026-10-24

修复「立即压缩」在新架构下 503：dsh 桌面端更新后 webServer 进程
不再挂载 agents/compaction 服务，服务端 compactNow 桥接失效。

- 「立即压缩」优先走**官方命令通道**：隐形 dock 槽位组件捕获
  inputActions（followup 同款 props），setDraft('/compact') + 250ms
  后 submit——命令由官方命令系统在 agent 宿主执行，结果以官方
  chip 形式出现在对话流（ui-commands 保证未知命令不会当普通
  消息发出）。
- 服务端 POST /compact 降级为后备（未来运行时恢复同进程服务时
  自动生效）。

## 0.1.8 — 2026-10-24

- 圆环放大：14px → 18px（viewBox 不变，描边随比例 ≈2.6px），触发区
  高度对齐工具条按钮 28px，环色从 tertiary 提到 secondary——纯图标
  没有百分比文字撑视觉重量，14px 夹在 28px 按钮间比例失衡（真机
  反馈"还是有点怪，太小"）。

## 0.1.7 — 2026-10-24

修复 0.1.6 真机问题：圆环被顶到工具条上一行（模型按钮的父容器在
此运行时不是工具条 flex 行）。

- 锚定后加几何自校正：对比 host 与模型按钮的矩形，垂直中心差 ≥2px
  用 translateY 拉回同一水平线；横向仅在重叠或间距 >24px 时校正
  （正常 flex 行的 12px gap 不动），不依赖容器布局假设。
- MutationObserver 与 window resize 时都会重新校正/重锚定。

## 0.1.6 — 2026-10-24

- 圆环固定到模型选择器（「DeepSeek-V4.1-Flash · Max ▾」）紧左边：
  槽位渲染顺序在此运行时不可控，改为自建 host 节点
  `insertBefore(模型选择器按钮)` 并复制其 flex `order`（等 order 时按
  DOM 序，两种布局都紧贴）；React 只渲染进 host，host 由插件搬运，
  重渲染不打架；MutationObserver 在界面重建后自动重新锚定。
- 锚定识别：输入区里视觉最靠右的下拉按钮（发送按钮按语义排除）；
  找不到时回落 dock 父节点，面板功能不受影响。

## 0.1.5 — 2026-10-24

- 删掉「启用」开关：默认与官方一致（自动开），自定义只调触发阈值与
  保留比例，保存后按用户值生效（auto 字段在状态里保留为 true）。
- 「自定义压缩」折叠行改官方菜单行规格（28px、radius-sm、13px/20px
  label-secondary、hover interactive-bg、caption 色箭头，对齐
  ModelSelect trigger）；「恢复默认」改官方 ghost 行样式（去描边）。

## 0.1.4 — 2026-10-24

- 「自定义压缩」折叠化：自动压缩的设置默认收起，点「自定义压缩 ▸」
  才展开（启用/触发阈值/保留比例/内置圆环）。
- 新增「恢复默认」：与「保存设置」并排。语义是**彻底移除** profile
  补丁层里的受管覆盖块（不是写入默认值），compaction-basic 回落自身
  默认（auto 开、80%、16%）；受管块移除后若文件再无条目，回填官方
  模板注释 + `[]`。服务端新增 POST /reset。
- 折叠态下面板常驻只剩：读数 + 构成 + 立即压缩 + 折叠行。

## 0.1.3 — 2026-10-24

面板瘦身（真机反馈：解释文字多余、整体偏高）：

- 删掉两段说明文字（手动压缩提示、参数写入说明）与「手动压缩」
  「自动压缩」两个分区标题，靠分隔线区分区块。
- 行距全面收紧：条上下 10/12 → 8/8，明细行 2px → 1px，分区距 10/8 →
  8/6，按钮 26 → 24px，字段行 2px → 1px，flash 边距缩小。
- 保存成功的反馈精简为「已保存，重启 dsh 后生效」。

## 0.1.2 — 2026-10-24

面板样式整体对齐官方 ContextMeter（真机反馈：配色不统一、卡片太大）：

- 卡片 330px → 官方 `min(264px, 100vw - 24px)`，内边距 14 → 12，
  字号 13 → 12 / 行高 20，标题 20px 大数字改为官方单行头
  （「上下文已用 3%」+ 右侧 ~已用/窗口）。
- 背景/圆角/阴影/毛玻璃全部换官方 token：`--dsw-specific-menu`、
  `--dsw-radius-lg`、`--dsw-elevation-prominent`、
  `--dsw-menu-backdrop-filter`。
- 三段构成色换官方 static token（bluish-400 / violet-400 / blue-450），
  色点 8px/2px 圆角、行距 padding 2px，条 4px 高。
- 圆环填充色改官方中性 `--dsw-alias-label-tertiary`（去掉自绘绿/黄/红）。
- 按钮去掉绿色渐变，改官方描边按钮（border-l2 + hover interactive）；
  滑条/开关 accent 换 `--dsw-static-blue-450`；小号提示 11px/16px。

## 0.1.1 — 2026-10-24

修复真机反馈的两个 UI 问题：

- **面板展开方向**：定位漏了 `translateY(-100%)`，面板从按钮顶部向下伸、
  越过窗口底边（输入栏在窗口底部时整块面板几乎全被裁掉，只剩顶部一条）。
  现在默认向上展开；上方空间不足 460px 才向下。入场动画改为只动 opacity，
  不再与展开方向的内联 transform 冲突。
- **去掉圆环旁的百分比文字**：触发按钮只留 14px 圆环（悬停 title 与
  aria-label 仍带百分比，面板头部也有完整读数）。

## 0.1.0 — 2026-10-24

首个版本。

- `conversation.input.right` 槽位注册上下文占用圆环（官方 `contextPressure` / `contextBreakdown` 投影，内置 ContextMeter 同款几何，75%/90% 变色）。
- 面板：占用/构成展示、三段构成条与明细。
- 「立即压缩」：服务端桥接官方 `ctx.compaction.compactNow(agent, signal)`，等价 `/compact`，busy 等 6 类错误码映射为中文提示。
- 自动压缩调节：auto 开关、触发阈值（50–95%）、保留比例（4–40%），保存写入各挂载 profile 的用户补丁层（`cordis.patch.yml` 受管块），重启生效。
- `~/.dsh/compaction-control.json` 作为事实源；补丁写入带 yaml 语法校验（运行时提供该库时）。
- 可选隐藏 dock 条内置圆环（DOM 特征识别 + MutationObserver）。
- 诊断通道 `~/.dsh/compaction-control-debug.log`。
