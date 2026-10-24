# 贡献指南

感谢你愿意改进这个插件。

## 提 Issue 之前

先看 README 的「已知边界」一节。仍然需要提 issue 时，请带上：

- 操作系统与版本
- dsh 版本（`dsh --version`）
- 复现步骤：做了什么、期望什么、实际什么
- `~/.dsh/compaction-control-debug.log` 的相关行
- 出问题的 profile 的 `cordis.patch.yml`（隐去隐私内容）

## 提 PR 之前

1. 先开 issue 讨论，避免方向不对白写一版。
2. 一个 PR 只做一件事。
3. 跑一遍自检：

```sh
node --check index.js
node --check client.js
```

4. 改了行为就更新 README。
5. 提交信息用 `feat:` / `fix:` / `docs:` / `refactor:` / `chore:` 前缀。

## 代码约定

- **只用官方通路**。占用数据走 `contextPressure` / `contextBreakdown` 投影，手动压缩走 `ctx.compaction.compactNow`，agent 查找走 `ctx.agents.get`；不碰内部 RPC、不伪造数据。
- **补丁层手术必须可逆**。对 `cordis.patch.yml` 的写入永远限制在 BEGIN/END 标记内，用户自写条目原样保留；写前校验、失败不落盘。
- **事实源唯一**。UI 偏好与压缩参数都存 `~/.dsh/compaction-control.json`，补丁文件是派生物。
- 服务端 `index.js` 与客户端 `client.js` 都不引入运行时依赖（peer 除外），保持零依赖装载。
