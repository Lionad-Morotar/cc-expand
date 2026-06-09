/**
 * cc-expand restore — 回滚到原始二进制
 */
import { DiscoveryService } from '../../services/discovery.js'
import { BackupService } from '../../services/backup.js'
import { ConfigService } from '../../services/config.js'

export async function restoreCommand(): Promise<void> {
  const discovery = new DiscoveryService()
  const backupService = new BackupService()
  const configService = new ConfigService()

  const binaryPath = await discovery.findClaudeBinary()
  const backupDir = configService.getBackupDir()

  await backupService.restore(binaryPath, backupDir)

  console.log(`Restored ${binaryPath} from backup ✓`)
}
