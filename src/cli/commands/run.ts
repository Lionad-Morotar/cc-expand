/**
 * cc-expand run — 启动已 patch 的 Claude Code
 */
import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ErrorCode } from '../../types/index.js'
import { parseTokenCount } from '../../utils/parse-token-count.js'
import { formatTokenCount } from '@cc-expand/plugin-context-expand'
import { makeErrorResult, type CommandResult } from '../result.js'

/** 获取运行时的 binary 路径（Windows 需 .exe 扩展名） */
export function getRunBinaryPath(target: string): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return join(homedir(), '.cc-expand', 'bin', `claude-${target}${ext}`)
}

/**
 * 把 run 参数解析为 binary 命名后缀（shortVer combo）。
 * 支持三种形态：
 * - 纯 token：27w / 270000 / 270k → formatTokenCount 规范化
 * - 显式 combo：27w-flow → token 段已规范，原样
 * - 未规范 combo：270k-flow → 首段 parse+format 规范化（270k→27w），plugin 段保留 → 27w-flow
 *
 * 为什么只规范首段：PluginsManager.computeShortVer 按 internal 先、installed 后拼接，
 * token-expansion 是首个 internal，故 token 段总在首位；后续段是 plugin literal（如 flow），
 * 不应被 token 解析。首段必须可 parse 为 token，否则视为无效输入抛错（binary 名必含 token 段）。
 */
export function resolveRunShortVer(input: string): string {
  const parts = input.split('-')
  const tokens = parseTokenCount(parts[0])
  parts[0] = formatTokenCount(tokens)
  return parts.join('-')
}

export interface RunData {
  binaryPath: string
  targetTokens: number
}

/** spawn 函数签名，便于测试注入替换 */
export type SpawnFn = (
  command: string,
  args: string[],
  options: object
) => ChildProcess

export interface RunOptions {
  /** 在测试中避免直接 process.exit */
  exitOnChildExit?: boolean
  /** 注入 spawn 实现（测试用），默认使用 node:child_process.spawn */
  spawn?: SpawnFn
  /** 仅打印 binary 路径（不启动），供 shell 快捷方式定位 */
  printBinary?: boolean
}

export async function runCommand(
  targetInput?: string,
  options?: RunOptions
): Promise<CommandResult<RunData> | void> {
  // binary 名用 shortVer combo。支持纯 token（27w/270000）与 combo（27w-flow/270k-flow），
  // 首段 token 经 parse+format 规范化，plugin 段保留。
  const shortVer = targetInput ? resolveRunShortVer(targetInput) : formatTokenCount(270000)
  // targetTokens 从规范 shortVer 的 token 段反解（parse(format(n))===n 双向对称保证还原）
  const targetTokens = parseTokenCount(shortVer.split('-')[0])
  const target = shortVer
  const binaryPath = getRunBinaryPath(shortVer)

  if (!existsSync(binaryPath)) {
    return makeErrorResult(
      'run',
      ErrorCode.BINARY_NOT_FOUND,
      `Patched binary '${shortVer}' not found`,
      `Run: ccx patch --target ${shortVer}`
    )
  }

  // --print-binary：只输出路径，不 spawn。shell 快捷方式用它定位 binary 后再做版本校验。
  if (options?.printBinary) {
    console.log(binaryPath)
    return {
      success: true,
      command: 'run',
      summary: binaryPath,
      data: { binaryPath, targetTokens }
    }
  }

  const doSpawn = options?.spawn ?? defaultSpawn
  const child = doSpawn(binaryPath, ['--dangerously-skip-permissions'], {
    stdio: 'inherit',
    detached: false
  })

  return new Promise((resolve) => {
    // binary 存在但无法 spawn（权限不足、codesign 损坏、架构不匹配）时触发 'error'
    // 不监听会变成 uncaughtException 或 Promise 永久 pending
    child.on('error', (err) => {
      resolve(
        makeErrorResult(
          'run',
          ErrorCode.BINARY_NOT_FOUND,
          `Failed to launch patched binary: ${err.message}`,
          `Re-run \`ccx patch --target ${target}\` to rebuild, or check the binary's execute permission`
        )
      )
    })

    child.on('exit', (code) => {
      if (options?.exitOnChildExit !== false) {
        process.exit(code ?? 0)
      }
      resolve({
        success: code === 0,
        command: 'run',
        summary: `Claude Code exited with code ${code ?? 0}`,
        data: {
          binaryPath,
          targetTokens
        }
      })
    })
  })
}
