#!/usr/bin/env node
/**
 * dry-run 回归验证:对 zRefs 已解压版本,断言 PatternDiscovery 产出与现网 shard patch 等价
 * (每条 search 的 200000 字节位置与现网一致 → patch 定位同字节)
 *
 * 用法:
 *   pnpm pattern:verify              验证所有 zRefs 已解压版本
 *   pnpm pattern:verify 2.1.178      验证指定版本
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PatternDiscovery } from '../src/core/pattern-discovery.js'

const ROOT = process.cwd()
const EXTRACTED = join(ROOT, 'zRefs/claude-codes/extracted')

/** 定位 darwin-arm64 二进制(兼容 package/claude 与 claude 两种布局) */
function findBin(v: string): string | null {
  for (const l of [join(EXTRACTED, `v${v}`, 'darwin-arm64', 'claude'), join(EXTRACTED, `v${v}`, 'darwin-arm64', 'package', 'claude')]) {
    if (existsSync(l)) return l
  }
  return null
}

const requested = process.argv.slice(2)
const versions = requested.length
  ? requested
  : readdirSync(EXTRACTED)
      .filter((d) => d.startsWith('v'))
      .map((d) => d.slice(1))
      .sort()

const discovery = new PatternDiscovery()
let allPass = true

for (const v of versions) {
  const bin = findBin(v)
  if (!bin) {
    console.log(`${v}: 无 darwin-arm64 二进制,跳过`)
    continue
  }
  const buf = readFileSync(bin)
  const text = buf.toString('latin1')

  let res: { search: string; sourceValue: string }[]
  try {
    res = discovery.discover(buf)
  } catch (e) {
    console.log(`${v}: THROW ${(e as Error).message}`)
    allPass = false
    continue
  }

  const shardPath = join(ROOT, 'patterns', `${v}.json`)
  if (!existsSync(shardPath)) {
    console.log(`${v}: 无现网 shard,跳过对比`)
    continue
  }
  const shardSearches: string[] = JSON.parse(readFileSync(shardPath, 'utf8')).darwin.arm64.map(
    (p: { search: string }) => p.search,
  )

  let ok = true
  for (const r of res) {
    if (text.split(r.search).length - 1 !== 1) ok = false
    const r200 = text.indexOf(r.search) + r.search.indexOf('200000')
    const matched = shardSearches.some((s) => {
      const sIdx = text.indexOf(s)
      return sIdx >= 0 && sIdx + s.indexOf('200000') === r200
    })
    if (!matched) ok = false
  }
  if (!ok) allPass = false
  console.log(`${v}: ${res.length} searches → ${ok ? '✓ patch-equivalent' : '✗ MISMATCH'}`)
}

console.log(allPass ? '\n=== ALL PASS ===' : '\n=== SOME FAILED ===')
process.exit(allPass ? 0 : 1)
