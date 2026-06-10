/**
 * cc-expand run — 启动已 patch 的 Claude Code
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CcxError, ErrorCode } from '../../types/index.js'

/** 获取运行时的 binary 路径（Windows 需 .exe 扩展名） */
export function getRunBinaryPath(target: string): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return join(homedir(), '.cc-expand', 'bin', `claude-${target}${ext}`)
}

export async function runCommand(targetTokens?: string): Promise<void> {
  // parseInt 确保前导零被去除，与 patch 命令生成的文件名一致
  const target = targetTokens ? String(parseInt(targetTokens, 10)) : '270000'
  const binaryPath = getRunBinaryPath(target)

  if (!existsSync(binaryPath)) {
    throw new CcxError(
      ErrorCode.BINARY_NOT_FOUND,
      `Patched binary for ${target} tokens not found`,
      `Run: cc-expand patch --target ${target}`,
    )
  }

  const child = spawn(binaryPath, ['--dangerously-skip-permissions'], {
    stdio: 'inherit',
    detached: false,
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}
