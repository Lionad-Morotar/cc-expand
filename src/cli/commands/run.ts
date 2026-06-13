/**
 * cc-expand run — 启动已 patch 的 Claude Code
 */
import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CcxError, ErrorCode } from '../../types/index.js'
import { parseTokenCount } from '../../utils/parse-token-count.js'
import { makeErrorResult, type CommandResult } from '../result.js'

/** 获取运行时的 binary 路径（Windows 需 .exe 扩展名） */
export function getRunBinaryPath(target: string): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return join(homedir(), '.cc-expand', 'bin', `claude-${target}${ext}`)
}

export interface RunData {
  binaryPath: string
  targetTokens: number
}

/** spawn 函数签名，便于测试注入替换 */
export type SpawnFn = (
  command: string,
  args: string[],
  options: object,
) => ChildProcess

export interface RunOptions {
  /** 在测试中避免直接 process.exit */
  exitOnChildExit?: boolean
  /** 注入 spawn 实现（测试用），默认使用 node:child_process.spawn */
  spawn?: SpawnFn
}

export async function runCommand(
  targetTokens?: string,
  options?: RunOptions,
): Promise<CommandResult<RunData> | void> {
  const target = targetTokens ? String(parseTokenCount(targetTokens)) : '270000'
  const binaryPath = getRunBinaryPath(target)

  if (!existsSync(binaryPath)) {
    return makeErrorResult(
      'run',
      ErrorCode.BINARY_NOT_FOUND,
      `Patched binary for ${target} tokens not found`,
      `Run: ccx patch --target ${target}`,
    )
  }

  const doSpawn = options?.spawn ?? defaultSpawn
  const child = doSpawn(binaryPath, ['--dangerously-skip-permissions'], {
    stdio: 'inherit',
    detached: false,
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
          `Re-run \`ccx patch --target ${target}\` to rebuild, or check the binary's execute permission`,
        ),
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
          targetTokens: Number(target),
        },
      })
    })
  })
}
