/**
 * 监听 patterns/ 目录并自动上传变更到阿里云 OSS
 * 用法: pnpm watch:patterns
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import chokidar from 'chokidar'
import OSS from 'ali-oss'

/** 从 .env 文件加载环境变量 */
function loadEnv(): void {
  if (!existsSync('.env')) return
  const content = readFileSync('.env', 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key && value && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnv()

const accessKeyId = process.env.AccessKeyID
const accessKeySecret = process.env.AccessKeySecret

if (!accessKeyId || !accessKeySecret) {
  console.error('错误: 请在 .env 中设置 AccessKeyID 和 AccessKeySecret')
  process.exit(1)
}

const client = new OSS({
  region: 'oss-cn-shanghai',
  bucket: 'cc-expand',
  accessKeyId,
  accessKeySecret,
  secure: true,
})

/** 记录已上传文件的内容 hash，用于去重 */
const uploadedHashes = new Map<string, string>()

/** 计算文件 MD5 hash */
function getFileHash(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('md5').update(content).digest('hex')
}

/** 上传文件到 OSS，带重试 */
async function uploadFile(localPath: string, retryCount = 0): Promise<void> {
  const objectKey = `patterns/${basename(localPath)}`
  const hash = getFileHash(localPath)
  const lastHash = uploadedHashes.get(localPath)

  if (lastHash === hash) {
    console.log(`[SKIP] ${basename(localPath)} (内容未变化)`)
    return
  }

  try {
    await client.put(objectKey, localPath)
    uploadedHashes.set(localPath, hash)
    console.log(`[UPLOAD] ${objectKey}`)
  } catch (error) {
    if (retryCount < 3) {
      const delay = 2 ** retryCount * 1000
      console.log(`[RETRY] ${objectKey} 将在 ${delay}ms 后重试 (${retryCount + 1}/3)`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return uploadFile(localPath, retryCount + 1)
    }
    console.error(`[FAIL] ${objectKey}:`, error instanceof Error ? error.message : String(error))
  }
}

/** 启动文件监听 */
function startWatcher(): void {
  // chokidar v5 已移除 glob 支持，使用目录监听 + 手动过滤
  const watcher = chokidar.watch('patterns', {
    persistent: true,
    ignoreInitial: false,
    depth: 0,
  })

  watcher.on('add', (filePath) => {
    if (!filePath.endsWith('.json')) return
    console.log(`[ADD] ${basename(filePath)}`)
    uploadFile(filePath)
  })

  watcher.on('change', (filePath) => {
    if (!filePath.endsWith('.json')) return
    console.log(`[CHANGE] ${basename(filePath)}`)
    uploadFile(filePath)
  })

  watcher.on('ready', () => {
    console.log('👀 正在监听 patterns/ 目录变化...')
  })

  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\n👋 停止监听')
    watcher.close().then(() => process.exit(0))
  })
}

startWatcher()
