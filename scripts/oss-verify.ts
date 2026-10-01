#!/usr/bin/env node
/**
 * 验证 shard 已上传到 OSS 且与本地内容一致(MD5)
 * 用法: pnpm pattern:verify-oss <version>
 *       pnpm plugin:verify-silence <version>
 *         （即 tsx scripts/oss-verify.ts --dir plugin-shards/silence-unrecognized-model
 *           --prefix plugins/silence-unrecognized-model/ <version>）
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

// flag+value 解析（pnpm 会把 <version> 追加在 script 末尾，故按 flag 过滤出位置参数）
const args = process.argv.slice(2)
const positional: string[] = []
let dir = 'patterns'
let prefix = 'patterns/'
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' || args[i] === '--prefix') {
    if (args[i] === '--dir') dir = args[i + 1] ?? ''
    if (args[i] === '--prefix') prefix = args[i + 1] ?? ''
    i++
    continue
  }
  if (args[i].startsWith('--')) continue
  positional.push(args[i])
}
if (!prefix.endsWith('/')) prefix += '/'
const version = positional[0]
if (!version) {
  console.error('用法: pnpm pattern:verify-oss <version>（plugin shard 用 --dir/--prefix 包装，见 package.json 的 plugin:verify-silence）')
  process.exit(1)
}

async function main(): Promise<void> {
  const keys = [`${version}.json`, 'versions.json']
  console.log(`核验 dir=${dir} prefix=${prefix}`)
  let allOk = true
  for (const key of keys) {
    const localPath = join(process.cwd(), dir, key)
    if (!existsSync(localPath)) {
      console.error(`✗ ${key}: 本地文件不存在 ${localPath}`)
      allOk = false
      continue
    }
    const localMd5 = createHash('md5').update(readFileSync(localPath)).digest('hex')
    try {
      const result = await client.get(`${prefix}${key}`)
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
