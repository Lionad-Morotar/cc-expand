/**
 * 监听 patterns/ 目录并自动上传变更到阿里云 OSS
 * 用法: pnpm watch:patterns
 *
 * 本文件仅为装配层：负责加载 .env、构造 OSS client、启动 chokidar
 * 并把事件分发给 PatternUploader。去重 / 缓存持久化 / 重试逻辑全部
 * 在 scripts/pattern-uploader.ts 中（可单元测试）。
 *
 * 启动行为：ignoreInitial 保持 false，启动时仍扫描 patterns/，但
 * PatternUploader 的持久化缓存会命中未变化文件 → [SKIP]，从而避免
 * 每次启动全量重传（旧实现的 uploadedHashes 是内存 Map，重启即丢）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import chokidar from 'chokidar'
import OSS from 'ali-oss'
import { PatternUploader, type UploadOutcome } from './pattern-uploader.js'

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

// ali-oss 的 put(name, file) 接受 string 路径，结构兼容 UploadClient 接口
const ossClient = new OSS({
  region: 'oss-cn-shanghai',
  bucket: 'cc-expand',
  accessKeyId,
  accessKeySecret,
  secure: true,
})

const uploader = new PatternUploader({
  client: ossClient,
  cachePath: join(process.cwd(), '.watch-patterns.cache.json'),
})

/** 打印上传结果日志 */
function logOutcome(filePath: string, outcome: UploadOutcome): void {
  const name = basename(filePath)
  if (outcome === 'uploaded') {
    console.log(`[UPLOAD] patterns/${name}`)
  } else if (outcome === 'skipped') {
    console.log(`[SKIP] ${name} (内容未变化)`)
  } else {
    console.error(`[FAIL] patterns/${name}`)
  }
}

/** 分发 chokidar 事件到上传器 */
function handleFile(filePath: string, kind: 'ADD' | 'CHANGE'): void {
  console.log(`[${kind}] ${basename(filePath)}`)
  uploader
    .uploadFile(filePath)
    .then((outcome) => logOutcome(filePath, outcome))
    .catch((error) => {
      console.error(`[FAIL] ${basename(filePath)}:`, error instanceof Error ? error.message : String(error))
    })
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
    handleFile(filePath, 'ADD')
  })

  watcher.on('change', (filePath) => {
    if (!filePath.endsWith('.json')) return
    handleFile(filePath, 'CHANGE')
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
