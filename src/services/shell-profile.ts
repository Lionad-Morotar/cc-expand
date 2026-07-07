/**
 * Shell profile 解析工具
 * 检测 profile 文件路径、解析 cc() / c 快捷方式指向
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 检测当前 shell 的配置文件路径
 * macOS/Linux: ~/.zshrc（优先）、~/.bashrc（fallback）
 * Windows: PowerShell $PROFILE
 */
export function detectConfigFile(homeDir: string): string {
  if (process.platform === 'win32') {
    return join(
      homeDir,
      'Documents',
      'PowerShell',
      'Microsoft.PowerShell_profile.ps1'
    )
  }

  const zshrc = join(homeDir, '.zshrc')
  const bashrc = join(homeDir, '.bashrc')

  if (existsSync(zshrc)) return zshrc
  if (existsSync(bashrc)) return bashrc
  return zshrc
}

/**
 * Shell 快捷方式状态
 */
export interface ShortcutState {
  /** cc() 函数指向的二进制路径或模式 */
  ccTarget?: string
  /** c alias 指向 */
  cTarget?: string
  /** 快捷方式是否指向 patch 版本 */
  pointsToPatched: boolean
}

/**
 * 从 shell profile 内容中解析 cc() / c 快捷方式的指向
 */
export function detectShortcutState(profileContent: string): ShortcutState {
  const state: ShortcutState = { pointsToPatched: false }

  // 解析 bash/zsh cc() 函数中的 default_binary
  const bashBinaryMatch = profileContent.match(
    /default_binary\s*=\s*["']?(.+?)["']?\s*$/m
  )
  if (bashBinaryMatch) {
    state.ccTarget = bashBinaryMatch[1]
  }

  // 解析 bash/zsh c alias
  const aliasMatch = profileContent.match(/alias\s+c\s*=\s*['"](.+?)['"]/)
  if (aliasMatch) {
    state.cTarget = aliasMatch[1]
  }

  // 解析 PowerShell cc 函数中的 binary 路径
  const psBinaryMatch = profileContent.match(
    /\$binary\s*=\s*Join-Path\s+\$env:USERPROFILE\s+["'](.+?)["']/
  )
  if (psBinaryMatch) {
    state.ccTarget = psBinaryMatch[1]
  }

  // 判断是否为 cc-expand 生成的快捷方式（指向 patched binary）
  if (state.ccTarget?.includes('.cc-expand/bin/claude-')) {
    state.pointsToPatched = true
  }

  return state
}

/**
 * 读取当前用户的 shell profile，返回快捷方式状态
 */
export function readShortcutState(homeDir?: string): ShortcutState {
  const home = homeDir ?? homedir()
  const configFile = detectConfigFile(home)

  if (!existsSync(configFile)) {
    return { pointsToPatched: false }
  }

  const content = readFileSync(configFile, 'utf-8')
  return detectShortcutState(content)
}
