/**
 * Claude Code 安装位置发现模块
 *
 * 汇总跨平台、跨包管理器的常见安装路径，作为 DiscoveryService 在 PATH/NPX
 * 都未命中时的兜底扫描表。
 *
 * 路径表主要整理自 tweakcc 的社区经验（npm/pnpm/yarn/bun/volta/fnm/nvm/nodenv/nvs/asdf/mise
 * 以及 macOS/Linux/Windows 原生安装位置），内联到 cc-expand 自身维护以避免 pnpm patch 债务。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

export interface Installation {
  /** 可执行文件路径（native）或 cli.js 路径（npm） */
  path: string
  /** 版本号；当前不读取文件内容，固定返回 'unknown' */
  version: string
  /** 安装类型 */
  kind: 'npm' | 'native'
}

const home = process.platform === 'win32'
  ? os.homedir().replace(/\\/g, '/')
  : os.homedir()

const mod = 'node_modules/@anthropic-ai/claude-code'

/**
 * 极简 glob 扩展：仅支持单星号 `*`（不匹配路径分隔符）。
 * 路径表里的 glob 都是单层目录或文件名匹配，足够使用；避免引入 globby/fast-glob 依赖。
 */
function expandGlob(pattern: string): string[] {
  if (!pattern.includes('*')) {
    return existsSync(pattern) ? [pattern] : []
  }

  const parts = pattern.split('/').filter(p => p !== '')

  // Windows 绝对路径：C:/... -> base = 'C:\'
  if (process.platform === 'win32' && /^[a-zA-Z]:$/.test(parts[0])) {
    const drive = parts.shift()!
    return expandParts(parts, `${drive}\\`)
  }

  return expandParts(parts, '/')
}

function expandParts(parts: string[], base: string): string[] {
  if (parts.length === 0) return []

  const [head, ...tail] = parts

  if (head.includes('*')) {
    let entries: string[] = []
    try {
      entries = readdirSync(base)
    } catch {
      return []
    }
    const regex = new RegExp('^' + head.replace(/\*/g, '[^/\\\\]*') + '$')
    const matched = entries.filter(e => regex.test(e))
    if (tail.length === 0) {
      return matched.map(e => join(base, e))
    }
    return matched.flatMap(e => expandParts(tail, join(base, e)))
  }

  const next = join(base, head)
  if (tail.length === 0) {
    return existsSync(next) ? [next] : []
  }
  return expandParts(tail, next)
}

function expandPatterns(patterns: string[]): string[] {
  return patterns.flatMap(expandGlob)
}

/**
 * 获取 npm-based 安装的候选基路径列表。
 * 这些路径需要再拼接 `node_modules/@anthropic-ai/claude-code/cli.js`。
 */
function getClijsSearchPaths(): string[] {
  const patterns: string[] = [
    `${os.homedir()}/.claude/local/${mod}`,
    ...(process.env.NPM_PREFIX ? [`${process.env.NPM_PREFIX}/lib/${mod}`] : []),
    ...(process.env.N_PREFIX ? [`${process.env.N_PREFIX}/lib/${mod}`] : []),
    ...(process.env.VOLTA_HOME ? [`${process.env.VOLTA_HOME}/lib/${mod}`] : []),
    ...(process.env.FNM_DIR ? [`${process.env.FNM_DIR}/lib/${mod}`] : []),
    ...(process.env.NVM_DIR ? [`${process.env.NVM_DIR}/lib/${mod}`] : []),
    ...(process.env.NODENV_ROOT ? [`${process.env.NODENV_ROOT}/versions/*/lib/${mod}`] : []),
    ...(process.env.NVS_HOME ? [`${process.env.NVS_HOME}/node/*/*/lib/${mod}`] : []),
    ...(process.env.ASDF_DATA_DIR ? [`${process.env.ASDF_DATA_DIR}/installs/nodejs/*/lib/${mod}`] : [])
  ]

  if (process.platform === 'win32') {
    patterns.push(
      `${home}/AppData/Local/Volta/tools/image/packages/@anthropic-ai/claude-code/${mod}`,
      `${home}/AppData/Roaming/npm/${mod}`,
      `${home}/AppData/Roaming/nvm/*/${mod}`,
      `${home}/AppData/Local/Yarn/config/global/${mod}`,
      `${home}/AppData/Local/pnpm/global/*/${mod}`,
      `C:/nvm4w/nodejs/${mod}`,
      `${home}/n/versions/node/*/lib/${mod}`,
      `${home}/AppData/Roaming/Yarn/config/global/${mod}`,
      `${home}/AppData/Roaming/pnpm-global/${mod}`,
      `${home}/AppData/Roaming/pnpm-global/*/${mod}`,
      `${home}/.bun/install/global/${mod}`,
      `${home}/.bun/install/cache/@anthropic-ai/claude-code*@@@*`,
      `${home}/AppData/Local/Bun/install/cache/@anthropic-ai/claude-code*@@@*`,
      `${home}/AppData/Local/fnm_multishells/*/node_modules/${mod}`,
      `${home}/AppData/Local/mise/installs/node/*/${mod}`,
      `${home}/AppData/Local/mise/installs/npm-anthropic-ai-claude-code/*/${mod}`
    )
  } else {
    if (process.platform === 'darwin') {
      patterns.push(
        `${home}/Library/${mod}`,
        `/opt/local/lib/${mod}`,
        `${home}/.bun/install/cache/@anthropic-ai/claude-code*@@@*`,
        `${home}/Library/Caches/bun/install/cache/@anthropic-ai/claude-code*@@@*`
      )
    }
    patterns.push(
      `${home}/.local/lib/${mod}`,
      `${home}/.local/share/${mod}`,
      `${home}/.npm-global/lib/${mod}`,
      `${home}/.npm-packages/lib/${mod}`,
      `${home}/.npm/lib/${mod}`,
      `${home}/npm/lib/${mod}`,
      `/etc/${mod}`,
      `/lib/${mod}`,
      `/opt/node/lib/${mod}`,
      `/usr/lib/${mod}`,
      `/usr/local/lib/${mod}`,
      `/usr/share/${mod}`,
      `/var/lib/${mod}`,
      `/opt/homebrew/lib/${mod}`,
      `${home}/.linuxbrew/lib/${mod}`,
      `${home}/.config/yarn/global/${mod}`,
      `${home}/.yarn/global/${mod}`,
      `${home}/.bun/install/global/${mod}`,
      `${home}/.pnpm-global/${mod}`,
      `${home}/.pnpm-global/*/${mod}`,
      `${home}/pnpm-global/${mod}`,
      `${home}/pnpm-global/*/${mod}`,
      `${home}/.local/share/pnpm/global/${mod}`,
      `${home}/.local/share/pnpm/global/*/${mod}`,
      `${home}/.bun/install/cache/@anthropic-ai/claude-code*@@@*`,
      `${home}/.local/share/bun/install/cache/@anthropic-ai/claude-code*@@@*`,
      `/usr/local/n/versions/node/*/lib/${mod}`,
      `${home}/n/versions/node/*/lib/${mod}`,
      `${home}/n/lib/${mod}`,
      `${home}/.volta/tools/image/node/*/lib/${mod}`,
      `${home}/.fnm/node-versions/*/installation/lib/${mod}`,
      `${home}/.local/state/fnm_multishells/*/lib/${mod}`,
      `/usr/local/nvm/versions/node/*/lib/${mod}`,
      `/usr/local/share/nvm/versions/node/*/lib/${mod}`,
      `${home}/.nvm/versions/node/*/lib/${mod}`,
      `${home}/.nodenv/versions/*/lib/${mod}`,
      `${home}/.nvs/*/lib/${mod}`,
      `${home}/.asdf/installs/nodejs/*/lib/${mod}`,
      ...(process.env.MISE_DATA_DIR ? [`${process.env.MISE_DATA_DIR}/installs/node/*/lib/${mod}`] : []),
      `${home}/.local/share/mise/installs/node/*/lib/${mod}`,
      ...(process.env.MISE_DATA_DIR ? [`${process.env.MISE_DATA_DIR}/installs/npm-anthropic-ai-claude-code/*/lib/${mod}`] : []),
      `${home}/.local/share/mise/installs/npm-anthropic-ai-claude-code/*/lib/${mod}`
    )
  }

  return expandPatterns(patterns)
}

/**
 * 获取原生二进制安装的候选路径列表。
 */
function getNativeSearchPaths(): string[] {
  return expandPatterns([
    `${home}/.local/bin/claude`,
    `${home}/.local/share/claude/versions/*/claude`
  ])
}

/**
 * 返回所有已知的 Claude Code 搜索基路径（npm-based + native）。
 */
export function getClaudeSearchPaths(): string[] {
  return [...getClijsSearchPaths(), ...getNativeSearchPaths()]
}

/**
 * 扫描系统寻找 Claude Code 安装。
 * 只返回实际存在的路径；version 字段固定为 'unknown'，调用方应自行执行 `--version`。
 */
export async function findAllInstallations(): Promise<Installation[]> {
  const installations: Installation[] = []

  for (const basePath of getClijsSearchPaths()) {
    const cliPath = join(basePath, 'cli.js')
    if (existsSync(cliPath)) {
      installations.push({ path: cliPath, version: 'unknown', kind: 'npm' })
    }
  }

  for (const nativePath of getNativeSearchPaths()) {
    try {
      if (statSync(nativePath).isFile()) {
        installations.push({ path: nativePath, version: 'unknown', kind: 'native' })
      }
    } catch {
      // ignore missing/permission errors
    }
  }

  return installations
}
