# Changelog

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
