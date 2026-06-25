/**
 * PatchCleanupService —— 清理已生成的 patched binary。
 *
 * 为什么独立成模块：patch 生命周期中「移除记录」与「删除 binary 文件」是两个不同的失败域。
 * 记录由 ConfigService 管理，文件由本服务管理；拆分后命令层可以分别处理错误与警告，
 * 避免文件占用（Windows 常见）或孤儿文件导致整个 remove 命令失败。
 */
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface PatchCleanupResult {
  /** binary 是否实际被删除 */
  removed: boolean
  /** 文件不存在或删除失败时的提示（不阻断记录删除） */
  warning?: string
}

export interface PatchCleanupOptions {
  /** 覆盖默认 home 目录（测试隔离用） */
  homeDir?: string
}

export class PatchCleanupService {
  private readonly homeDir: string

  constructor(options?: PatchCleanupOptions) {
    this.homeDir = options?.homeDir ?? homedir()
  }

  /**
   * 根据 combo 删除对应的 patched binary。
   * 文件不存在或删除失败时返回 warning，由调用方决定如何展示，不抛异常。
   */
  remove(combo: string): PatchCleanupResult {
    const ext = process.platform === 'win32' ? '.exe' : ''
    const binaryPath = join(this.homeDir, '.cc-expand', 'bin', `claude-${combo}${ext}`)
    if (!existsSync(binaryPath)) {
      return { removed: false, warning: `Patched binary '${combo}' not found` }
    }
    try {
      rmSync(binaryPath)
      return { removed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        removed: false,
        warning: `Could not remove patched binary '${combo}': ${message}`
      }
    }
  }
}
