import * as THREE from 'three'
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  NoiseEffect,
  VignetteEffect
} from 'postprocessing'

export interface BannerScene {
  mount(container: HTMLElement): void
  destroy(): void
}

/**
 * 纯 Three.js 程序化 Banner（全屏 Shader）。
 *
 * 所有像素在 GLSL fragment shader 中实时绘制，不依赖贴图。
 * 参数基于 zRefs/banner.png 的结构与亮度分布硬编码。
 */
export function createBannerScene(): BannerScene {
  let container: HTMLElement | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.OrthographicCamera | null = null
  let scene: THREE.Scene | null = null
  let composer: EffectComposer | null = null
  let animationId = 0
  let clock = new THREE.Clock()
  const targetCameraOffset = { x: 0, y: 0 }

  const disposables: THREE.Object3D[] = []
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  const ASPECT = 16 / 9

  function buildScene(): void {
    scene = new THREE.Scene()

    camera = new THREE.OrthographicCamera(-1, 1, 1 / ASPECT, -1 / ASPECT, 0.1, 10)
    camera.position.z = 1

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    buildMainScene(scene)

    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(
      new EffectPass(
        camera,
        new BloomEffect({
          intensity: 0.28,
          luminanceThreshold: 0.22,
          luminanceSmoothing: 0.45,
          radius: 0.28
        }),
        new NoiseEffect({ premultiply: true }),
        new VignetteEffect({ darkness: 0.55, offset: 0.32 })
      )
    )
  }

  function addDisposable(obj: THREE.Object3D): void {
    scene?.add(obj)
    disposables.push(obj)
  }

  function buildMainScene(scene: THREE.Scene): void {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uMouse;
        varying vec2 vUv;

        const vec3 BG = vec3(0.005, 0.0015, 0.0);
        const vec3 ORANGE = vec3(0.85, 0.28, 0.0);
        const vec3 ORANGE_DIM = vec3(0.38, 0.10, 0.0);
        const vec3 YELLOW = vec3(0.92, 0.40, 0.0);
        const vec3 HOT = vec3(0.95, 0.50, 0.08);
        const vec3 WHITE = vec3(0.95, 0.72, 0.32);

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }

        float lineSeg(vec2 p, vec2 a, vec2 b, float w) {
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return smoothstep(w, 0.0, length(pa - ba * h));
        }

        void main() {
          vec2 uv = vUv;
          vec3 col = BG;

          // 颗粒
          col += noise(uv * 900.0 + uTime * 3.0) * 0.04 * vec3(1.0, 0.35, 0.0);
          col += noise(uv * 220.0) * 0.022 * vec3(1.0, 0.35, 0.0);

          // 消失点：门中心偏右下
          vec2 vp = vec2(0.642, 0.575) + uMouse * 0.006;

          // ===== 中心透视门 =====
          vec2 gTL = vec2(0.389, 0.274);
          vec2 gTR = vec2(0.469, 0.274);
          vec2 gBL = vec2(0.389, 0.586);
          vec2 gBR = vec2(0.469, 0.586);

          for (int i = 0; i < 8; i++) {
            float t = float(i) / 7.0;
            float s = mix(1.0, 0.04, t);
            vec2 tl = vp + (gTL - vp) * s;
            vec2 tr = vp + (gTR - vp) * s;
            vec2 bl = vp + (gBL - vp) * s;
            vec2 br = vp + (gBR - vp) * s;
            float w = mix(0.018, 0.0022, t);
            float fade = mix(1.0, 0.1, t) * exp(-t * 0.8);

            float frame = 0.0;
            frame += lineSeg(uv, tl, tr, w);
            frame += lineSeg(uv, tr, br, w);
            frame += lineSeg(uv, br, bl, w);
            frame += lineSeg(uv, bl, tl, w);
            col += YELLOW * frame * fade * 0.95;

            float inside = step(min(tl.x, bl.x), uv.x) * step(uv.x, max(tr.x, br.x));
            inside *= step(min(tl.y, tr.y), uv.y) * step(uv.y, max(bl.y, br.y));
            inside *= 1.0 - min(frame, 1.0);
            col += ORANGE_DIM * inside * fade * 0.07;
          }

          // ===== 地面网格 =====
          float horizon = 0.605;
          if (uv.y > horizon) {
            float dy = uv.y - horizon;
            float depth = 1.0 / max(dy, 0.001);
            float flow = uTime * 0.75;
            float worldX = (uv.x - vp.x) * depth * 0.42;
            float worldZ = depth * 0.22;
            float gx = abs(fract(worldX * 7.0) - 0.5);
            float gz = abs(fract(worldZ * 4.5 - flow) - 0.5);
            float grid = smoothstep(0.06 * depth, 0.0, min(gx, gz));
            float fade = exp(-depth * 0.5) * smoothstep(0.0, 0.06, dy);
            col += ORANGE * grid * fade * 0.38;
          }

          // ===== 右侧数据墙 =====
          vec2 wallBaseR = vec2(0.735, horizon + 0.015);
          vec2 wallDirR = normalize(wallBaseR - vp);
          for (int colI = 0; colI < 10; colI++) {
            for (int rowI = 0; rowI < 8; rowI++) {
              float t = float(colI) / 9.0;
              float d = mix(0.08, 0.58, t);
              vec2 c = vp + wallDirR * d;
              c.y += (float(rowI) - 3.5) * mix(0.10, 0.008, t);
              float scale = mix(1.0, 0.07, t);
              vec2 hs = vec2(0.05, 0.082) * scale;
              vec2 tl = c - hs, tr = c + vec2(hs.x, -hs.y);
              vec2 bl = c - vec2(hs.x, -hs.y), br = c + hs;
              float w = 0.0038 * scale;
              float fade = (1.0 - t * 0.35) * 0.75;
              float pulse = 0.7 + 0.3 * sin(uTime * 2.0 + float(colI) * 0.6 + float(rowI));

              float frame = 0.0;
              frame += lineSeg(uv, tl, tr, w);
              frame += lineSeg(uv, tr, br, w);
              frame += lineSeg(uv, br, bl, w);
              frame += lineSeg(uv, bl, tl, w);
              col += ORANGE * frame * pulse * fade * 0.35;

              float inside = step(tl.x, uv.x) * step(uv.x, br.x) * step(tl.y, uv.y) * step(uv.y, br.y);
              float cross = lineSeg(uv, vec2(c.x, tl.y), vec2(c.x, br.y), w * 0.6);
              cross += lineSeg(uv, vec2(tl.x, c.y), vec2(br.x, c.y), w * 0.6);
              col += YELLOW * cross * inside * fade * 0.06;

              if (mod(float(rowI) + float(colI), 3.0) < 1.5) {
                float dot = smoothstep(0.012 * scale, 0.0, length(uv - (c + vec2(0.0, hs.y * 0.3))));
                col += YELLOW * dot * inside * fade * 0.32;
              }
            }
          }

          // ===== 左侧数据墙 =====
          vec2 wallBaseL = vec2(0.16, horizon + 0.015);
          vec2 wallDirL = normalize(wallBaseL - vp);
          for (int colI = 0; colI < 7; colI++) {
            for (int rowI = 0; rowI < 6; rowI++) {
              float t = float(colI) / 6.0;
              float d = mix(0.08, 0.52, t);
              vec2 c = vp + wallDirL * d;
              c.y += (float(rowI) - 2.5) * mix(0.10, 0.008, t);
              float scale = mix(1.0, 0.07, t);
              vec2 hs = vec2(0.042, 0.068) * scale;
              vec2 tl = c - hs, tr = c + vec2(hs.x, -hs.y);
              vec2 bl = c - vec2(hs.x, -hs.y), br = c + hs;
              float w = 0.0032 * scale;
              float fade = (1.0 - t * 0.35) * 0.45;
              float pulse = 0.7 + 0.3 * sin(uTime * 1.7 + float(colI) + float(rowI));

              float frame = 0.0;
              frame += lineSeg(uv, tl, tr, w);
              frame += lineSeg(uv, tr, br, w);
              frame += lineSeg(uv, br, bl, w);
              frame += lineSeg(uv, bl, tl, w);
              col += ORANGE_DIM * frame * pulse * fade * 0.30;
            }
          }

          // ===== 主导光斑 =====
          vec2 spot1 = vp + vec2(0.03, 0.0);
          float d1 = length((uv - spot1) * vec2(1.0, 0.85));
          col += HOT * exp(-d1 * 5.5) * 0.20;

          vec2 spot2 = vp + vec2(0.07, 0.01);
          float d2 = length((uv - spot2) * vec2(1.0, 0.85));
          col += ORANGE * exp(-d2 * 6.5) * 0.12;

          // 右侧强亮斑
          vec2 spot3 = vec2(0.745, 0.54);
          float d3 = length((uv - spot3) * vec2(1.0, 0.9));
          col += YELLOW * exp(-d3 * 8.0) * 0.10;

          // 右上亮斑
          vec2 spot4 = vec2(0.735, 0.27);
          float d4 = length((uv - spot4) * vec2(1.0, 0.95));
          col += WHITE * exp(-d4 * 8.5) * 0.09;

          // 右下亮斑
          vec2 spot5 = vec2(0.74, 0.63);
          float d5 = length((uv - spot5) * vec2(1.0, 0.9));
          col += YELLOW * exp(-d5 * 8.5) * 0.08;

          // 中心强光源
          vec2 core = vp + vec2(0.012, 0.008);
          float dCore = length((uv - core) * vec2(1.0, 0.9));
          float coreGlow = exp(-dCore * 6.5);
          float pulseC = 0.9 + 0.1 * sin(uTime * 1.5);
          col += mix(ORANGE, HOT, coreGlow) * coreGlow * pulseC * 0.24;

          // ===== 暗角 =====
          float vig = smoothstep(0.15, 0.88, length(uv - 0.5));
          col *= mix(1.0, 0.08, vig);

          gl_FragColor = vec4(col, 1.0);
        }
      `
    })
    materials.push(material)

    const geometry = new THREE.PlaneGeometry(2, 2 / ASPECT)
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    addDisposable(mesh)
  }

  function resize(): void {
    if (!container || !renderer || !camera || !composer) return
    const width = container.clientWidth
    const height = container.clientHeight
    const pixelRatio = Math.min(window.devicePixelRatio, 2)

    renderer.setSize(width, height, false)
    renderer.setPixelRatio(pixelRatio)
    composer.setSize(width * pixelRatio, height * pixelRatio)
  }

  function onMouseMove(event: MouseEvent): void {
    targetCameraOffset.x = ((event.clientX / window.innerWidth) * 2 - 1) * 0.025
    targetCameraOffset.y = (-(event.clientY / window.innerHeight) * 2 + 1) * 0.015
  }

  function onVisibilityChange(): void {
    if (document.hidden) clock.stop()
    else clock.start()
  }

  function animate(): void {
    animationId = requestAnimationFrame(animate)
    if (!scene || !camera || !renderer || !composer) return

    const elapsed = clock.getElapsedTime()
    materials.forEach((m) => {
      const sm = m as THREE.ShaderMaterial
      if (sm.uniforms?.uTime) sm.uniforms.uTime.value = elapsed
      if (sm.uniforms?.uMouse) {
        sm.uniforms.uMouse.value.x += (targetCameraOffset.x - sm.uniforms.uMouse.value.x) * 0.04
        sm.uniforms.uMouse.value.y += (targetCameraOffset.y - sm.uniforms.uMouse.value.y) * 0.04
      }
    })

    composer.render()
  }

  return {
    mount(target: HTMLElement): void {
      if (container) return
      container = target

      buildScene()
      target.appendChild(renderer!.domElement)
      resize()

      window.addEventListener('resize', resize)
      window.addEventListener('mousemove', onMouseMove)
      document.addEventListener('visibilitychange', onVisibilityChange)

      clock.start()
      animate()
    },

    destroy(): void {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('visibilitychange', onVisibilityChange)

      disposables.forEach((obj) => scene?.remove(obj))
      disposables.length = 0

      geometries.forEach((g) => g.dispose())
      geometries.length = 0

      materials.forEach((m) => m.dispose())
      materials.length = 0

      composer?.dispose()
      renderer?.dispose()

      if (renderer?.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement)
      }

      container = null
      renderer = null
      camera = null
      scene = null
      composer = null
      clock = new THREE.Clock()
    }
  }
}
