#!/usr/bin/env node
/**
 * 一次性上传指定版本的 pattern shard + versions.json 到阿里云 OSS
 * 用法: pnpm pattern:upload <version>
 *
 * Why: watch:patterns 是 chokidar persistent 监听，长时间运行会被会话
 * SIGTERM 杀掉（exit 143），作为上传通道不可靠。本脚本提供事件驱动的
 * 一次性上传，复用 PatternUploader（带内容 hash 去重 + 持久化缓存 +
 * 指数退避重试），子代理在 pattern:gen 后直接调用，不依赖持续监听进程。
 *
 * 缓存路径与 watch-patterns.ts 共享（.watch-patterns.cache.json），
 * 故两者交替使用不会重复上传未变化文件。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import OSS from 'ali-oss'
import { PatternUploader } from './pattern-uploader.js'

/** 从 .env 加载环境变量（与 watch-patterns.ts / oss-verify.ts 一致） */
function loadEnv(): void {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const idx = t.indexOf('=')
    if (idx === -1) continue
    const k = t.slice(0, idx).trim()
    const v = t.slice(idx + 1).trim()
    if (k && v && process.env[k] === undefined) process.env[k] = v
  }
}

loadEnv()
const accessKeyId = process.env.AccessKeyID
const accessKeySecret = process.env.AccessKeySecret
if (!accessKeyId || !accessKeySecret) {
  console.error('错误: 请在 .env 中设置 AccessKeyID 和 AccessKeySecret')
  process.exit(1)
}

const version = process.argv[2]
if (!version) {
  console.error('用法: pnpm pattern:upload <version>')
  process.exit(1)
}

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

async function main(): Promise<void> {
  // 上传目标：版本分片 + 全局索引；顺序上传，versions.json 最后确保索引指向最新分片
  const targets = [`${version}.json`, 'versions.json']
  let allOk = true
  for (const name of targets) {
    const localPath = join(process.cwd(), 'patterns', name)
    if (!existsSync(localPath)) {
      console.error(`✗ ${name}: 本地文件不存在 ${localPath}`)
      allOk = false
      continue
    }
    const outcome = await uploader.uploadFile(localPath)
    if (outcome === 'uploaded') {
      console.log(`[UPLOAD] patterns/${name}`)
    } else if (outcome === 'skipped') {
      console.log(`[SKIP] ${name} (内容未变化)`)
    } else {
      console.error(`[FAIL] patterns/${name}`)
      allOk = false
    }
  }
  process.exit(allOk ? 0 : 1)
}

main()
