import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'

const publicDir = resolve(process.cwd(), 'packages/website/.output/public')
const referencePath = resolve(process.cwd(), 'zRefs/banner.png')
const shotDir = resolve(process.cwd(), 'packages/website/tmp')
const screenshotPath = resolve(process.cwd(), 'tmp/banner-screenshot.png')

if (!existsSync(referencePath)) {
  console.error('参考图不存在:', referencePath)
  process.exit(1)
}

mkdirSync(shotDir, { recursive: true })

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

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[${msg.type()}]`, msg.text())
    }
  })
  page.on('pageerror', (err) => {
    console.log('[page error]', err.message)
  })

  await page.goto('http://localhost:3456/')

  // 等待 WebGL 场景渲染若干帧
  await page.waitForTimeout(2000)

  await page.screenshot({ path: screenshotPath, type: 'png' })

  // 同时保存一份带时间戳的版本到 packages/website/tmp/ 方便回溯演进
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archivedPath = join(shotDir, `shot-${timestamp}.png`)
  const latestPath = join(shotDir, 'latest-shot.png')
  try {
    await page.screenshot({ path: archivedPath, type: 'png' })
    await page.screenshot({ path: latestPath, type: 'png' })
  } catch {
    // 归档失败不影响主流程
  }

  await browser.close()
  server.close()

  // 使用 Python + OpenCV + scikit-image 计算 SSIM，并保存 diff 图与指标
  const result = execSync(`python3 - <<'PY'
import cv2
from skimage.metrics import structural_similarity as ssim
import numpy as np
ref = cv2.imread('zRefs/banner.png')
shot = cv2.imread('tmp/banner-screenshot.png')
ref = cv2.resize(ref, (2560, 1440))
shot = cv2.resize(shot, (2560, 1440))
gray_ref = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
gray_shot = cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY)
score, diff = ssim(gray_ref, gray_shot, full=True)
diff_img = (np.clip((1 - diff) * 4, 0, 1) * 255).astype(np.uint8)
cv2.imwrite('packages/website/tmp/latest-diff.png', diff_img)
print(score)
PY`, { encoding: 'utf-8' }).trim()

  const similarity = parseFloat(result)
  console.log(`SSIM 相似度: ${(similarity * 100).toFixed(2)}%`)

  if (similarity < 0.95) {
    console.error('相似度未达标（< 95%）')
    process.exit(1)
  }

  console.log('视觉回归通过')
})
