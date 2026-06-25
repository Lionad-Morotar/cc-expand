/**
 * ccx plugins —— plugin 管理命令族
 *
 * subcommand: list / enable / disable / remove / add。
 * internalPlugins 由调用方（CLI 层）注入，本命令不硬依赖具体 internal 子包，便于单测（fake）。
 * 管理命令只动注册表（plugins.json），binary 状态由 ccx patch 显式刷新。
 *
 * add（从 GitHub repo 拉 ccx-plugins.json + confirm + --plugin）待实现（网络 fetch）。
 */
import { PluginsManager } from '../../services/plugins-manager.js'
import type { InternalPluginDefinition, PluginManifest } from '../../types/plugins.js'
import { ErrorCode } from '../../types/index.js'
import { makeErrorResult, type CommandResult } from '../result.js'

export interface PluginsCommandOptions {
  internalPlugins: InternalPluginDefinition[]
  /** 测试隔离用（注入临时 home）；CLI 入口不传，用默认 homedir()，与 patch/status 等命令一致 */
  homeDir?: string
  /** --plugin xxx yyy 过滤（仅 add） */
  plugin?: string[]
  /** --yes 跳过 confirm（仅 add） */
  yes?: boolean
}

/** 拉 repo 根的 ccx-plugins.json 索引（GitHub raw, main 分支）。
 *  返回 unknown[]：第三方 repo 内容不可信，由调用方经 validateManifest 校验后再用。 */
async function fetchPluginsIndex(repo: string): Promise<unknown[]> {
  const url = `https://raw.githubusercontent.com/${repo}/main/ccx-plugins.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const data = (await res.json()) as { plugins?: unknown[] }
  return data.plugins ?? []
}

/** 第三方 plugin manifest 运行时校验：name 非空 kebab-case、shardBaseUrl 合法 http(s) URL、shortVer 结构正确。
 *  在安装入口尽早失败，避免脏数据持久化到 ~/.cc-expand/plugins.json。 */
function validateManifest(m: unknown): m is PluginManifest {
  if (!m || typeof m !== 'object') return false
  const o = m as Record<string, unknown>
  if (typeof o.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(o.name)) return false
  if (typeof o.shardBaseUrl !== 'string' || !/^https?:\/\/.+/.test(o.shardBaseUrl)) return false
  if (!o.shortVer || typeof o.shortVer !== 'object') return false
  const sv = o.shortVer as Record<string, unknown>
  if (sv.kind === 'literal') return typeof sv.value === 'string' && sv.value.length > 0
  return sv.kind === 'token-target'
}

export interface PluginEntryView {
  name: string
  source: 'internal' | 'installed'
  enabled: boolean
}

async function ok(summary: string): Promise<CommandResult<{ plugins: PluginEntryView[] }>> {
  return { success: true, command: 'plugins', summary }
}

export async function pluginsCommand(
  args: string[],
  options: PluginsCommandOptions
): Promise<CommandResult<{ plugins: PluginEntryView[] }>> {
  const sub = args[0]
  if (!sub) {
    return makeErrorResult(
      'plugins',
      ErrorCode.INVALID_TARGET,
      'No subcommand',
      'Usage: ccx plugins <list|enable|disable|remove|add> [name]'
    )
  }

  const pm = new PluginsManager({
    internalPlugins: options.internalPlugins,
    homeDir: options.homeDir
  })

  if (sub === 'list') {
    const plugins = pm.list().map(p => ({ name: p.name, source: p.source, enabled: p.enabled }))
    return {
      success: true,
      command: 'plugins',
      summary: `${plugins.length} plugin(s): ${plugins.map(p => p.name).join(', ') || '(none)'}`,
      data: { plugins }
    }
  }

  const name = args[1]
  if (!name) {
    return makeErrorResult(
      'plugins',
      ErrorCode.INVALID_TARGET,
      `${sub} requires a plugin name`,
      `Usage: ccx plugins ${sub} <name>`
    )
  }

  if (sub === 'enable') {
    try {
      pm.enable(name)
    } catch (e) {
      return makeErrorResult('plugins', ErrorCode.INVALID_TARGET, (e as Error).message)
    }
    return ok(`enabled ${name}`)
  }
  if (sub === 'disable') {
    try {
      pm.disable(name)
    } catch (e) {
      return makeErrorResult('plugins', ErrorCode.INVALID_TARGET, (e as Error).message)
    }
    return ok(`disabled ${name}`)
  }
  if (sub === 'remove') {
    try {
      pm.remove(name)
    } catch (e) {
      return makeErrorResult('plugins', ErrorCode.INVALID_TARGET, (e as Error).message)
    }
    return ok(`removed ${name}`)
  }
  if (sub === 'add') {
    const repo = name
    if (!repo || !repo.includes('/')) {
      return makeErrorResult('plugins', ErrorCode.INVALID_TARGET, `add requires <owner/repo>`, `Usage: ccx plugins add <owner/repo> [--plugin xxx] [--yes]`)
    }
    let rawIndex: unknown[]
    try {
      rawIndex = await fetchPluginsIndex(repo)
    } catch (e) {
      return makeErrorResult('plugins', ErrorCode.NETWORK_ERROR, `Failed to fetch plugins index: ${(e as Error).message}`)
    }
    // 运行时校验第三方 manifest：非法 name/url/shortVer 跳过
    const index = rawIndex.filter(validateManifest)
    const skippedInvalid = rawIndex.length - index.length
    const selected = options.plugin?.length
      ? index.filter(p => options.plugin!.includes(p.name))
      : index
    if (selected.length === 0) {
      return makeErrorResult(
        'plugins',
        ErrorCode.PATTERN_NOT_FOUND,
        skippedInvalid > 0 ? `No valid plugins (${skippedInvalid} 个 manifest 非法被跳过)` : 'No matching plugins',
        index.length > 0 ? `Repo has: ${index.map(p => p.name).join(', ')}` : 'manifest 需含合法 name(kebab-case)、shardBaseUrl(http(s) URL)、shortVer'
      )
    }
    if (!options.yes) {
      const { confirm } = await import('@inquirer/prompts')
      const confirmed = await confirm({ message: `安装 ${selected.length} 个 plugin: ${selected.map(p => p.name).join(', ')}?` })
      if (!confirmed) return { success: true, command: 'plugins', summary: 'cancelled' }
    }
    // upsert + 同名保护：分类统计 added/updated/conflict
    const added: string[] = []
    const updated: string[] = []
    const conflicted: string[] = []
    for (const p of selected) {
      const r = pm.add(p)
      if (r === 'added') added.push(p.name)
      else if (r === 'updated') updated.push(p.name)
      else conflicted.push(p.name)
    }
    const parts = [
      added.length && `installed ${added.join(', ')}`,
      updated.length && `updated ${updated.join(', ')}`,
      conflicted.length && `${conflicted.length} 个与 internal 同名被跳过: ${conflicted.join(', ')}`
    ].filter(Boolean)
    return {
      success: true,
      command: 'plugins',
      summary: parts.join('; ') || 'nothing to do',
      data: { plugins: pm.list().map(p => ({ name: p.name, source: p.source, enabled: p.enabled })) }
    }
  }

  return makeErrorResult(
    'plugins',
    ErrorCode.INVALID_TARGET,
    `Unknown subcommand: ${sub}`,
    'Usage: ccx plugins <list|enable|disable|remove|add>'
  )
}
