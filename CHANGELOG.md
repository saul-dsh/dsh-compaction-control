# Changelog

## 0.1.0 — 2026-10-24

首个版本。

- `conversation.input.right` 槽位注册上下文占用圆环（官方 `contextPressure` / `contextBreakdown` 投影，内置 ContextMeter 同款几何，75%/90% 变色）。
- 面板：占用/构成展示、三段构成条与明细。
- 「立即压缩」：服务端桥接官方 `ctx.compaction.compactNow(agent, signal)`，等价 `/compact`，busy 等 6 类错误码映射为中文提示。
- 自动压缩调节：auto 开关、触发阈值（50–95%）、保留比例（4–40%），保存写入各挂载 profile 的用户补丁层（`cordis.patch.yml` 受管块），重启生效。
- `~/.dsh/compaction-control.json` 作为事实源；补丁写入带 yaml 语法校验（运行时提供该库时）。
- 可选隐藏 dock 条内置圆环（DOM 特征识别 + MutationObserver）。
- 诊断通道 `~/.dsh/compaction-control-debug.log`。
