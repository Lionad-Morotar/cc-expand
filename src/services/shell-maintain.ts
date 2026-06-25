/**
 * patch 成功后自动维护 shell profile 中的 cc/c 快捷方式
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { detectConfigFile, generateShellFunction, generateRestoredShellFunction } from './shell-codegen.js'

const START_MARKER = '# --- cc-expand generated start ---'
const END_MARKER = '# --- cc-expand generated end ---'

export interface MaintainOptions {
  /** 覆盖默认 home 目录（用于测试） */
  homeDir?: string
  /** 本次 patch 的目标 tokens */
  targetTokens: number
  /** 跳过确认直接覆盖 */
  skipConfirm?: boolean
  /** 覆盖确认函数（用于测试） */
  confirm?: (message: string) => Promise<boolean>
}

/**
 * 从 profile 内容中提取 cc-expand generated block（含标记行）
 */
function extractBlock(content: string): { before: string, block: string, after: string } | null {
  const startIndex = content.indexOf(START_MARKER)
  const endIndex = content.indexOf(END_MARKER)

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null
  }

  const blockEnd = endIndex + END_MARKER.length
  return {
    before: content.slice(0, startIndex),
    block: content.slice(startIndex, blockEnd),
    after: content.slice(blockEnd)
  }
}

/**
 * 维护 shell profile 中的 cc/c 快捷方式
 * 返回人类可读的摘要字符串
 */
export async function maintainShellShortcuts(options: MaintainOptions): Promise<string> {
  const homeDir = options.homeDir ?? homedir()
  const configFile = detectConfigFile(homeDir)

  // 确保父目录存在（Windows PowerShell profile 可能在 Documents/PowerShell 下）
  mkdirSync(dirname(configFile), { recursive: true })

  let content = ''
  if (existsSync(configFile)) {
    content = readFileSync(configFile, 'utf-8')
  }

  const newBlock = generateShellFunction(options.targetTokens)

  const existing = extractBlock(content)
  if (!existing) {
    // 没有旧块：追加
    writeFileSync(configFile, content + newBlock, 'utf-8')
    return `Shell 快捷方式已安装到 ${configFile}`
  }

  if (existing.block.trim() === newBlock.trim()) {
    return `Shell 快捷方式已是最新（默认目标 ${options.targetTokens} tokens）`
  }

  // 旧块存在但不同：确认或直接覆盖
  if (!options.skipConfirm) {
    const doConfirm
      = options.confirm
        ?? (async (msg: string) => {
          const { confirm } = await import('@inquirer/prompts')
          return confirm({ message: msg })
        })
    const ok = await doConfirm(
      `Update shell shortcuts default target to ${options.targetTokens} tokens?`
    )
    if (!ok) {
      return `Shell 快捷方式未更新（当前默认目标与本次 patch 不一致）`
    }
  }

  writeFileSync(configFile, existing.before + newBlock + existing.after, 'utf-8')
  return `Shell 快捷方式已更新为默认目标 ${options.targetTokens} tokens`
}

/**
 * maintainShellShortcutsToOriginal 的选项
 * 与 MaintainOptions 类似，但不需要 targetTokens（restore 没有 target 概念）
 */
export interface MaintainToOriginalOptions {
  /** 覆盖默认 home 目录（用于测试） */
  homeDir?: string
  /** 跳过确认直接覆盖 */
  skipConfirm?: boolean
  /** 覆盖确认函数（用于测试） */
  confirm?: (message: string) => Promise<boolean>
}

/**
 * 把 shell profile 中的 cc-expand 块覆盖为"指向原版 Claude Code"
 * 用于 restore：cc/c 保留快捷方式结构，但调用系统原版 claude 而非 patched binary
 * 与 maintainShellShortcuts（指向 patched）形成对称操作
 */
export async function maintainShellShortcutsToOriginal(
  options: MaintainToOriginalOptions
): Promise<string> {
  const homeDir = options.homeDir ?? homedir()
  const configFile = detectConfigFile(homeDir)
  mkdirSync(dirname(configFile), { recursive: true })

  let content = ''
  if (existsSync(configFile)) {
    content = readFileSync(configFile, 'utf-8')
  }

  const newBlock = generateRestoredShellFunction()
  const existing = extractBlock(content)
  if (!existing) {
    // 无旧块：restore 场景罕见，兜底追加
    writeFileSync(configFile, content + newBlock, 'utf-8')
    return `Shell 快捷方式已更新为指向原版 ${configFile}`
  }

  if (existing.block.trim() === newBlock.trim()) {
    return `Shell 快捷方式已指向原版，无需更新`
  }

  // 旧块指向 patched：确认或直接覆盖
  if (!options.skipConfirm) {
    const doConfirm
      = options.confirm
        ?? (async (msg: string) => {
          const { confirm } = await import('@inquirer/prompts')
          return confirm({ message: msg })
        })
    const ok = await doConfirm(
      `Update cc/c shortcuts to launch the original Claude Code?`
    )
    if (!ok) {
      return `Shell 快捷方式未更新（仍指向 patched binary）`
    }
  }

  writeFileSync(configFile, existing.before + newBlock + existing.after, 'utf-8')
  return `Shell 快捷方式已更新为指向原版 ${configFile}`
}
