import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const publicDir = resolve(process.cwd(), 'packages/website/.output/public')
const referencePath = resolve(process.cwd(), 'zRefs/banner.png')
const screenshotPath = resolve(process.cwd(), 'tmp/banner-screenshot.png')
const diffPath = resolve(process.cwd(), 'tmp/banner-diff.png')

if (!existsSync(referencePath)) {
  console.error('参考图不存在:', referencePath)
  process.exit(1)
}

const server = createServer((req, res) => {
  let filePath = join(publicDir, req.url === '/' ? 'index.html' : req.url!)
  try {
    const data = readFileSync(filePath)
    const ext = filePath.split('.').pop() || 'html'
    const contentType =
      ext === 'js' ? 'application/javascript' :
      ext === 'css' ? 'text/css' :
      ext === 'png' ? 'image/png' :
      'text/html'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(3456, async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } })
  await page.goto('http://localhost:3456/')

  // 等待 WebGL 场景渲染若干帧，让动画到达中性状态
  await page.waitForTimeout(2000)

  await page.screenshot({ path: screenshotPath, type: 'png' })

  await browser.close()
  server.close()

  const reference = PNG.sync.read(readFileSync(referencePath))
  const screenshot = PNG.sync.read(readFileSync(screenshotPath))

  const { width, height } = reference
  const diff = new PNG({ width, height })
  const diffPixels = pixelmatch(reference.data, screenshot.data, diff.data, width, height, { threshold: 0.1 })
  writeFileSync(diffPath, PNG.sync.write(diff))

  const totalPixels = width * height
  const similarity = 1 - diffPixels / totalPixels

  console.log(`不同像素: ${diffPixels} / ${totalPixels}`)
  console.log(`相似度: ${(similarity * 100).toFixed(2)}%`)

  if (similarity < 0.95) {
    console.error('相似度未达标（< 95%）')
    process.exit(1)
  }

  console.log('视觉回归通过')
})
