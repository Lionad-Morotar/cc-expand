import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('website build integration', () => {
  const outputDir = resolve(__dirname, '../../packages/website/.output/public')

  it('generates static index.html', () => {
    expect(existsSync(resolve(outputDir, 'index.html'))).toBe(true)
  })

  it('prerenders the SPA shell with Nuxt mount point', () => {
    const html = readFileSync(resolve(outputDir, 'index.html'), 'utf-8')
    // ssr: false 时 Nuxt 只输出挂载点，真正的 Banner 在客户端渲染
    expect(html).toContain('__nuxt')
    expect(html).toContain('<title>cc-expand</title>')
  })
})
