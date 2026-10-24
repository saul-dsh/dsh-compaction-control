# dsh-compaction-control

English | [中文](README.md)

A **context-compaction control center** for the dsh (DeepSeek Harness) composer: a context-usage ring beside the model picker that opens a panel with **one-click manual compaction**, **runtime tuning of the auto-compaction threshold**, and an optional **hide for the built-in bottom-right ring**.

## Why

dsh's built-in auto compaction (`compaction-basic`) triggers only at 80% of the context window on turn boundaries, with parameters fixed inside the profile composition; the only manual entry is the `/compact` slash command. This plugin turns both into visual controls on the input bar:

- **Ring**: same geometry as the built-in ContextMeter (14px ring + percent), fed by the official `contextPressure` / `contextBreakdown` session projections.
- **Compact now**: calls the official `ctx.compaction.compactNow(agent, signal)` — the programmatic twin of `/compact`, no typing. Idle sessions only; busy/failure reasons surface in Chinese-friendly messages inside the panel.
- **Auto tuning**: enable toggle + trigger threshold (50%–95%) + retain ratio (4%–40%). Saving writes an id-targeted `compaction-basic` config override into the **user patch layer** (`~/.dsh/profiles/<name>/cordis.patch.yml`) of every profile mounting this plugin; **takes effect after restarting dsh**.
- **Hide built-in ring**: the built-in ring is hard-coded in the dock strip below the composer card (not a slot, no official switch). When enabled, the plugin sets it `display:none` at runtime so only the ring next to the model picker remains.

## Install

```sh
dsh plugin --profile web add /path/to/dsh-compaction-control
dsh plugin --profile desktop add /path/to/dsh-compaction-control
```

Restart dsh afterwards.

## Usage

1. A green usage ring appears on the right side of the input bar, left of the model picker (amber at 75%, red at 90%).
2. Click it to open the panel:
   - top: occupancy percent, ~used/window, and the three-segment composition bar (system prompt / tools / conversation);
   - "立即压缩当前会话" runs one manual compaction and reports how many items and roughly how many tokens were folded;
   - the "自动压缩" section tunes parameters; "保存设置" reports which profiles were written.
3. The built-in bottom-right ring is hidden by default; switch "内置圆环" back to shown if you want both.

## How it works

```
client (conversation.input.right slot)         server (/api/dsh-compaction-control)
  useProjection('contextPressure')  ←official─ registered by token-meter
  useProjection('contextBreakdown')
  "Compact now" ─POST /compact {sessionId}→  ctx.agents.get(sessionId)
                                              ctx.compaction.compactNow(agent, signal)
  "Save" ─POST /state {auto,                 ~/.dsh/compaction-control.json (source of truth)
          thresholdRatio, retainRatio,        → ~/.dsh/profiles/*/cordis.patch.yml
          hideBuiltIn}                           (id-targeted compaction-basic config override)
```

- The patch layer is the user file officially created by `initProfile`; the plugin manager never reclaims it. The loader reads it only at boot, hence the restart requirement.
- Writes are marker-delimited text surgery between `# BEGIN/END dsh-compaction-control` comments; any other entries you keep in that file are preserved verbatim, and the server validates syntax with the `yaml` library when available.
- `~/.dsh/compaction-control.json` is the single source of truth; the patch files can be regenerated from it at any time.

## Known limits

- Manual compaction requires an idle session; a running turn or an active compaction returns a "busy" message.
- The retain-ratio < threshold-ratio constraint of compaction-basic is enforced in-panel and re-validated server-side.
- If a profile's `cordis.patch.yml` is hand-edited into a non-array shape, saving aborts with a validation error instead of corrupting the file.
- Hiding the built-in ring relies on DOM feature detection (a dialog button with a two-circle svg inside the dock strip); a future dsh redesign silently reverts to both rings showing, with no functional loss.
- After uninstalling, the managed block may remain in the profile patch layer — harmless, and you can delete everything between (and including) the BEGIN/END markers.

## Troubleshooting

Check `~/.dsh/compaction-control-debug.log` (one JSON line per boot/register/state-error/compact phase). Same heuristic as power-picker: a log containing only `server boot` means the client module never loaded. `window.__dshCompactionControl` exposes the version in DevTools.

## License

MIT
