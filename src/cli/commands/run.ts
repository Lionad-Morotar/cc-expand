/**
 * cc-expand run — 启动已 patch 的 Claude Code
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CcxError, ErrorCode } from '../../types/index.js'

export async function runCommand(targetTokens?: string): Promise<void> {
  const target = targetTokens ?? '270000'
  const binaryPath = join(homedir(), '.cc-expand', 'bin', `claude-${target}`)

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
