#!/usr/bin/env node
/**
 * 验证 pattern shard 已上传到 OSS 且与本地内容一致(MD5)
 * 用法: pnpm pattern:verify-oss <version>
 *
 * 复用 watch-patterns.ts 的 .env 加载与 OSS client 构造模式
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import OSS from 'ali-oss'

/** 从 .env 加载环境变量(与 watch-patterns.ts 一致) */
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

const client = new OSS({
  region: 'oss-cn-shanghai',
  bucket: 'cc-expand',
  accessKeyId,
  accessKeySecret,
  secure: true,
})

const version = process.argv[2]
if (!version) {
  console.error('用法: pnpm pattern:verify-oss <version>')
  process.exit(1)
}

async function main(): Promise<void> {
  const keys = [`${version}.json`, 'versions.json']
  let allOk = true
  for (const key of keys) {
    const localPath = join(process.cwd(), 'patterns', key)
    if (!existsSync(localPath)) {
      console.error(`✗ ${key}: 本地文件不存在 ${localPath}`)
      allOk = false
      continue
    }
    const localMd5 = createHash('md5').update(readFileSync(localPath)).digest('hex')
    try {
      const result = await client.get(`patterns/${key}`)
      const remoteMd5 = createHash('md5').update(Buffer.from(result.content)).digest('hex')
      const match = localMd5 === remoteMd5
      console.log(
        `${match ? '✓' : '✗'} ${key}: ${match ? '内容一致' : `不一致(local=${localMd5.slice(0, 8)} remote=${remoteMd5.slice(0, 8)})`}`,
      )
      if (!match) allOk = false
    } catch (e) {
      console.error(`✗ ${key}: OSS 获取失败 ${(e as Error).message}`)
      allOk = false
    }
  }
  process.exit(allOk ? 0 : 1)
}

main()
