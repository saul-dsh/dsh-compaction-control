/**
 * dsh-compaction-control — 上下文压缩控制中心（DeepSeek Harness / dsh）
 *
 * 三件事：
 *   1. 手动压缩：把官方 compaction 服务的 ctx.compaction.compactNow(agent, signal)
 *      暴露成 HTTP 路由，客户端面板一键触发（等价 /compact，免打字）。
 *   2. 调节自动压缩：把 {auto, thresholdRatio, retainRatio} 写进每个挂载了
 *      本插件的 profile 的用户补丁层（~/.dsh/profiles/<name>/cordis.patch.yml，
 *      id 定向覆盖 compaction-basic 的 config；applyEntryPatches 后写者胜）。
 *      补丁层是 initProfile 官方创建的用户文件，插件管理器不会回收它；
 *      但 loader 只在启动时读取——保存后需重启 dsh 生效。
 *   3. 状态源：~/.dsh/compaction-control.json 是唯一事实源（含 hideBuiltIn
 *      等 UI 偏好），补丁文件由它派生，可随时重生成。
 *
 * 已核对的 dsh API（dsh-reference 源码对照）：
 *   - ctx.agents.get(sessionId) → Agent（core/agent AgentRegistry，实现
 *     runMaintenance，满足 compaction 的 ManualCompactAgentContext）
 *   - ctx.compaction.compactNow(agent, signal) → CompactionResult |
 *     null；错误带 code: busy/cancelled/changed/summary/commit/persistence
 *   - BasicCompactionConfig 键集（compaction-basic/src/config.ts）：
 *     auto/thresholdRatio/retainRatio/headroomTokens/maxTokens/
 *     summarizationProvider/summarizationModel/compactionRetries/
 *     maxOverflowRetries/modelPolicies —— 只写前三个，其余走默认
 *   - applyEntryPatches（vendor/include）：{id, name, config} 直接整体
 *     替换目标条目的 config；未知键会让 compaction-basic 加载即抛错，
 *     所以这里的 config 永远是完整合法子集
 */

import Schema from '@deepseek-ai/schemastery'
import { createRequire } from 'node:module'
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export const name = 'compaction-control'

const DSH_DIR = join(homedir(), '.dsh')
const PROFILES_DIR = join(DSH_DIR, 'profiles')
const STATE_FILE = join(DSH_DIR, 'compaction-control.json')
const DIAG_LOG = join(DSH_DIR, 'compaction-control-debug.log')

/** 与 compaction-basic 的默认对齐（thresholdRatio 0.8 / retainRatio 0.16 / auto）。 */
const DEFAULT_STATE = { auto: true, thresholdRatio: 0.8, retainRatio: 0.16, hideBuiltIn: true }

const MANAGED_BEGIN = '# BEGIN dsh-compaction-control (managed)'
const MANAGED_END = '# END dsh-compaction-control'

/** 补丁文件语法校验用；运行时没带 yaml 就跳过校验（写入逻辑本身保守）。 */
let Yaml = null
try {
  const mod = require('yaml')
  if (typeof mod?.parse === 'function') Yaml = mod
} catch { Yaml = null }

export const Config = Schema.object({
  /** 关闭后客户端不再注册圆环与面板（压缩行为恢复 compaction-basic 默认）。 */
  enabled: Schema.boolean().default(true).description('是否启用上下文压缩控制'),
})

/** 校验并归一化一份状态；不合法直接抛中文错误给面板显示。 */
function sanitizeState(input) {
  const ratio = (value, fallback, lo, hi, label) => {
    const n = Number(value ?? fallback)
    if (!Number.isFinite(n) || n < lo || n > hi) {
      throw new Error(`${label} 需在 ${lo}~${hi} 之间`)
    }
    return Math.round(n * 1000) / 1000
  }
  const state = {
    auto: input?.auto === undefined ? DEFAULT_STATE.auto : Boolean(input.auto),
    thresholdRatio: ratio(input?.thresholdRatio, DEFAULT_STATE.thresholdRatio, 0.3, 0.99, '触发阈值'),
    retainRatio: ratio(input?.retainRatio, DEFAULT_STATE.retainRatio, 0.02, 0.5, '保留比例'),
    hideBuiltIn: input?.hideBuiltIn === undefined ? DEFAULT_STATE.hideBuiltIn : Boolean(input.hideBuiltIn),
  }
  // compaction-basic 加载期硬约束：retainRatio >= thresholdRatio 直接抛错。
  if (state.retainRatio >= state.thresholdRatio) {
    throw new Error(`保留比例 (${state.retainRatio}) 必须小于触发阈值 (${state.thresholdRatio})`)
  }
  return state
}

async function readState() {
  try {
    return sanitizeState(JSON.parse(await readFile(STATE_FILE, 'utf8')))
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/** 列出挂载了本插件的 profile 名（manifest 里出现包名即算）。 */
async function listMountedProfiles() {
  let entries = []
  try { entries = await readdir(PROFILES_DIR, { withFileTypes: true }) } catch { return [] }
  const mounted = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const raw = await readFile(join(PROFILES_DIR, entry.name, 'package.json'), 'utf8')
      if (raw.includes('dsh-compaction-control')) mounted.push(entry.name)
    } catch { /* 无 manifest 的目录不是 profile */ }
  }
  return mounted.sort()
}

function managedBlock(state) {
  return [
    MANAGED_BEGIN,
    '- id: compaction-basic',
    "  name: '@deepseek-ai/dsh-compaction-basic'",
    '  config:',
    `    auto: ${state.auto}`,
    `    thresholdRatio: ${state.thresholdRatio}`,
    `    retainRatio: ${state.retainRatio}`,
    MANAGED_END,
  ].join('\n')
}

/** 纯文本手术：由现有内容与目标状态算出下一版补丁文件内容（不落盘）。 */
function composePatch(raw, state) {
  const begin = raw.indexOf(MANAGED_BEGIN)
  const end = raw.indexOf(MANAGED_END)
  if (begin !== -1 && end !== -1 && end > begin) {
    return raw.slice(0, begin) + managedBlock(state) + raw.slice(end + MANAGED_END.length)
  }
  const stripped = raw
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('')
    .trim()
  if (stripped === '[]') {
    return raw.replace('[]', managedBlock(state))
  }
  if (stripped === '') {
    return `${managedBlock(state)}\n`
  }
  const base = raw.replace(/\s+$/, '')
  return `${base}\n${managedBlock(state)}\n`
}

/** 移除受管块后的剩余内容；没有受管块时返回 null（无需写回）。 */
function stripManaged(raw) {
  const begin = raw.indexOf(MANAGED_BEGIN)
  const end = raw.indexOf(MANAGED_END)
  if (begin === -1 || end === -1 || end < begin) return null
  return raw.slice(0, begin) + raw.slice(end + MANAGED_END.length)
}

/** 官方 initProfile 的用户补丁层模板（移除后文件为空时回填）。 */
const PATCH_TEMPLATE = '# Your patch layer for this dsh profile, applied after every bundle layer:\n'
  + '# a top-level YAML array of loader patch entries (id-targeted config\n'
  + '# overrides, disables, and insert lists; `!!js` expressions allowed).\n'
  + '[]\n'

/** 恢复默认：从 profile 补丁层移除受管块，让 compaction-basic 回落自身默认。 */
async function clearProfilePatch(profileName, report) {
  const file = join(PROFILES_DIR, profileName, 'cordis.patch.yml')
  let raw = ''
  try { raw = await readFile(file, 'utf8') } catch { return }
  const strippedManaged = stripManaged(raw)
  if (strippedManaged === null) return
  const stripped = strippedManaged
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('')
    .trim()
  const next = stripped === ''
    ? PATCH_TEMPLATE
    : `${strippedManaged.replace(/\s+$/, '')}\n`
  if (Yaml) {
    try {
      const parsed = Yaml.parse(next)
      if (!Array.isArray(parsed)) throw new Error('not an array')
    } catch (error) {
      throw new Error(`${profileName}/cordis.patch.yml 语法校验失败，未写入：${String(error?.message ?? error)}`)
    }
  } else {
    report(`yaml lib unavailable, rewrote ${profileName}/cordis.patch.yml without validation`)
  }
  await writeFile(file, next, 'utf8')
  return file
}

/**
 * 把受管块写入一个 profile 的 cordis.patch.yml。
 * 纯文本手术：只动 BEGIN/END 标记之间的内容，用户自己写的其他条目原样保留；
 * 全新文件（官方模板是注释 + `[]`）用受管块替换 `[]`。写前用 yaml 库校验
 * （如果运行时带了这个库），校验失败不落盘。
 */
async function syncProfilePatch(profileName, state, report) {
  const file = join(PROFILES_DIR, profileName, 'cordis.patch.yml')
  let raw = ''
  try { raw = await readFile(file, 'utf8') } catch { raw = '' }
  const next = composePatch(raw, state)

  if (Yaml) {
    try {
      const parsed = Yaml.parse(next)
      if (!Array.isArray(parsed)) throw new Error('not an array')
    } catch (error) {
      throw new Error(`${profileName}/cordis.patch.yml 语法校验失败，未写入：${String(error?.message ?? error)}`)
    }
  } else {
    report(`yaml lib unavailable, wrote ${profileName}/cordis.patch.yml without validation`)
  }

  await writeFile(file, next, 'utf8')
  return file
}

/** 把状态同步进所有挂载 profile；返回写入的 profile 名单。 */
async function syncAllProfiles(state, report) {
  const profiles = await listMountedProfiles()
  const written = []
  for (const profileName of profiles) {
    await syncProfilePatch(profileName, state, report)
    written.push(profileName)
  }
  return written
}

export function apply(ctx, config) {
  const say = (message) => {
    try { console.info(`[dsh-compaction-control] ${message}`) } catch { /* ignore */ }
  }
  const report = async (line) => {
    try {
      await mkdir(dirname(DIAG_LOG), { recursive: true })
      await appendFile(DIAG_LOG, `${new Date().toISOString()} ${line}\n`, 'utf8')
    } catch { /* ignore */ }
  }

  say(`server boot, enabled=${config.enabled !== false}`)
  void report(`server boot enabled=${config.enabled !== false}`)

  // compaction/agents 属于可选依赖：base bundle 没带它们时路由仍注册，
  // /compact 返回 503，面板其余功能（状态展示、参数保存）不受影响。
  let runtime = null

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/api/dsh-compaction-control',
      handler: async (req, res) => {
        const send = (status, body) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        const readBody = async () => {
          let raw = ''
          for await (const chunk of req) raw += chunk
          try { return raw ? JSON.parse(raw) : {} } catch { return null }
        }
        const path = (req.url ?? '').split('?')[0].replace(/^\/api\/dsh-compaction-control/, '')

        if (path === '/enabled' && req.method === 'GET') {
          send(200, { enabled: config.enabled !== false, name })
          return
        }

        if (path === '/diag' && req.method === 'POST') {
          await report(String((await readBody())?.line ?? '').slice(0, 2000))
          send(200, { ok: true })
          return
        }

        if (path === '/state' && req.method === 'GET') {
          try {
            const [state, profiles] = await Promise.all([readState(), listMountedProfiles()])
            send(200, { ok: true, state, defaults: DEFAULT_STATE, profiles, version: '0.1.0' })
          } catch (error) {
            send(500, { error: String(error?.message ?? error) })
          }
          return
        }

        if (path === '/state' && req.method === 'POST') {
          const body = await readBody()
          if (body === null) { send(400, { error: '请求体不是合法 JSON' }); return }
          try {
            const state = sanitizeState(body)
            await mkdir(DSH_DIR, { recursive: true })
            await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
            const profiles = await syncAllProfiles(state, report)
            await report(`state saved ${JSON.stringify(state)} profiles=${profiles.join(',') || 'none'}`)
            send(200, { ok: true, state, profiles, restartRequired: true })
          } catch (error) {
            send(400, { error: String(error?.message ?? error) })
          }
          return
        }

        if (path === '/reset' && req.method === 'POST') {
          try {
            const state = { ...DEFAULT_STATE }
            await mkdir(DSH_DIR, { recursive: true })
            await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
            const profiles = await listMountedProfiles()
            for (const profileName of profiles) await clearProfilePatch(profileName, report)
            await report(`state reset to defaults, managed block removed from: ${profiles.join(',') || 'none'}`)
            send(200, { ok: true, state, profiles, restartRequired: true })
          } catch (error) {
            send(400, { error: String(error?.message ?? error) })
          }
          return
        }

        if (path === '/compact' && req.method === 'POST') {
          if (!runtime) { send(503, { error: '压缩服务未就绪（本 profile 未挂载 compaction/agents）' }); return }
          const body = await readBody()
          const sessionId = body?.sessionId
          if (!sessionId) { send(400, { error: '缺少 sessionId' }); return }
          const agent = runtime.agents.get(sessionId)
          if (!agent) { send(409, { error: '未找到该会话的 agent' }); return }
          const controller = new AbortController()
          try {
            const result = await runtime.compaction.compactNow(agent, controller.signal)
            if (result === null) {
              send(200, { ok: true, empty: true, message: '暂无可压缩的历史' })
            } else {
              await report(`manual compact ok: ${result.shadowedSeqs.length} items ~${result.shadowedTokenCount} tokens`)
              send(200, {
                ok: true,
                shadowed: result.shadowedSeqs.length,
                tokens: result.shadowedTokenCount,
              })
            }
          } catch (error) {
            const code = typeof error?.code === 'string' ? error.code.toLowerCase() : ''
            const messages = {
              busy: '会话正忙（运行中或已有压缩任务），请在空闲时重试',
              cancelled: '压缩已取消',
              changed: '待压缩历史在提交前发生了变化，本次已放弃并记录',
              summary: '未能生成有效摘要，本次已记录',
              commit: '压缩未干净完成，请检查会话状态后再试',
              persistence: '压缩完成，但会话保存失败',
            }
            await report(`manual compact failed: code=${code || 'unknown'} ${String(error?.message ?? error).slice(0, 300)}`)
            if (messages[code]) { send(409, { error: messages[code], code }); return }
            send(500, { error: String(error?.message ?? error) })
          }
          return
        }

        send(404, { error: 'not-found' })
      },
    }), 'dsh-compaction-control: /api/dsh-compaction-control/*')

    webCtx.inject(['compaction', 'agents'], (deep) => {
      runtime = { compaction: deep.compaction, agents: deep.agents }
      say('compaction + agents ready')
      void report('runtime ready (compaction + agents)')
      return () => { runtime = null }
    })
  })
}

export default { name, Config, apply }

/** 仅供离线自测（scripts/ 与 CI 可直接 import），运行时不使用。 */
export const __internals = { sanitizeState, managedBlock, composePatch, stripManaged, PATCH_TEMPLATE, DEFAULT_STATE }
