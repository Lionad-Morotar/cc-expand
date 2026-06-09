import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackupService } from '../../src/services/backup.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'

describe('BackupService', () => {
  let tempDir: string
  let backupDir: string
  let binaryPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-test-'))
    backupDir = join(tempDir, 'backups')
    binaryPath = join(tempDir, 'claude-code')
    writeFileSync(binaryPath, 'original-binary-content')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('backup()', () => {
    it('should copy binary to backup directory', async () => {
      const service = new BackupService()

      const backupPath = await service.backup(binaryPath, backupDir)

      expect(existsSync(backupPath)).toBe(true)
      expect(readFileSync(backupPath, 'utf-8')).toBe('original-binary-content')
    })

    it('should create backup directory if it does not exist', async () => {
      const service = new BackupService()

      await service.backup(binaryPath, backupDir)

      expect(existsSync(backupDir)).toBe(true)
    })
  })

  describe('restore()', () => {
    it('should restore binary from backup', async () => {
      const service = new BackupService()
      // First create a backup
      await service.backup(binaryPath, backupDir)
      // Mutate the original
      writeFileSync(binaryPath, 'patched-binary-content')

      await service.restore(binaryPath, backupDir)

      expect(readFileSync(binaryPath, 'utf-8')).toBe('original-binary-content')
    })

    it('should error when backup does not exist', async () => {
      const service = new BackupService()

      let caught: CcxError | undefined
      try {
        await service.restore(binaryPath, backupDir)
      } catch (e) {
        caught = e as CcxError
      }

      expect(caught).toBeInstanceOf(CcxError)
      expect(caught?.code).toBe(ErrorCode.BACKUP_NOT_FOUND)
    })
  })
})
