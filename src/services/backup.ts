/**
 * 备份服务
 * 管理二进制文件的备份和恢复
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CcxError, ErrorCode } from '../types/index.js'

export class BackupService {
  /**
   * 备份二进制文件
   * @param binaryPath 原始二进制路径
   * @param backupDir 备份目录
   * @returns 备份文件路径
   */
  async backup(binaryPath: string, backupDir: string): Promise<string> {
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true })
    }

    const backupPath = join(backupDir, basename(binaryPath))
    copyFileSync(binaryPath, backupPath)

    return backupPath
  }

  /**
   * 从备份恢复二进制文件
   * @param binaryPath 目标二进制路径
   * @param backupDir 备份目录
   */
  async restore(binaryPath: string, backupDir: string): Promise<void> {
    const backupPath = join(backupDir, basename(binaryPath))

    if (!existsSync(backupPath)) {
      throw new CcxError(
        ErrorCode.BACKUP_NOT_FOUND,
        `Backup not found for ${basename(binaryPath)}`,
        'Run "cc-expand patch" first to create a backup',
      )
    }

    copyFileSync(backupPath, binaryPath)
  }
}
