import * as THREE from 'three'

/**
 * Banner 动态叠加层的公共接口。
 * 在底图之上叠加微妙的粒子、中心辉光和鼠标视差。
 */
export interface BannerOverlay {
  mount(container: HTMLElement): void
  destroy(): void
}

const AMBER = new THREE.Color('#ffaa33')
const GOLD = new THREE.Color('#ffcc00')

/**
 * 创建透明 Three.js 叠加层，用于在静态设计稿背景上添加动态光效。
 */
export function createBannerOverlay(): BannerOverlay {
  let container: HTMLElement | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.OrthographicCamera | null = null
  let scene: THREE.Scene | null = null
  let animationId = 0
  let clock = new THREE.Clock()

  const targetCameraOffset = { x: 0, y: 0 }
  const currentCameraOffset = { x: 0, y: 0 }

  const disposables: THREE.Object3D[] = []

  function buildScene(): void {
    scene = new THREE.Scene()

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 1

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    buildGlow(scene)
    buildParticles(scene)
  }

  function buildGlow(scene: THREE.Scene): void {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: GOLD.clone() }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 center = vec2(0.5, 0.485);
          float d = distance(vUv, center);
          float glow = 1.0 - smoothstep(0.0, 0.32, d);
          float pulse = 0.94 + 0.06 * sin(uTime * 1.0);
          gl_FragColor = vec4(uColor, glow * pulse * 0.16);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    scene.add(glow)
    disposables.push(glow)
  }

  function buildParticles(scene: THREE.Scene): void {
    const count = 120
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1.6
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.9
      positions[i * 3 + 2] = 0
      speeds[i] = 0.03 + Math.random() * 0.06
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: AMBER.clone() }
      },
      vertexShader: /* glsl */ `
        attribute float aSpeed;
        uniform float uTime;
        void main() {
          vec3 pos = position;
          pos.y -= fract(uTime * aSpeed);
          if (pos.y < -0.55) pos.y += 1.1;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = 1.2 * (1.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        void main() {
          float d = distance(gl_PointCoord, vec2(0.5));
          if (d > 0.5) discard;
          float glow = 1.0 - d * 2.0;
          gl_FragColor = vec4(uColor, glow * 0.5);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    const points = new THREE.Points(geometry, material)
    scene.add(points)
    disposables.push(points)
  }

  function resize(): void {
    if (!container || !renderer || !camera) return
    const width = container.clientWidth
    const height = container.clientHeight
    const pixelRatio = Math.min(window.devicePixelRatio, 2)

    renderer.setSize(width, height, false)
    renderer.setPixelRatio(pixelRatio)
  }

  function onMouseMove(event: MouseEvent): void {
    targetCameraOffset.x = ((event.clientX / window.innerWidth) * 2 - 1) * 0.008
    targetCameraOffset.y = (-(event.clientY / window.innerHeight) * 2 + 1) * 0.005
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      clock.stop()
    } else {
      clock.start()
    }
  }

  function animate(): void {
    animationId = requestAnimationFrame(animate)
    if (!scene || !camera || !renderer) return

    const elapsed = clock.getElapsedTime()

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh | THREE.Points
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((m) => {
          const shaderMat = m as THREE.ShaderMaterial
          if (shaderMat.uniforms?.uTime) {
            shaderMat.uniforms.uTime.value = elapsed
          }
        })
      }
    })

    currentCameraOffset.x += (targetCameraOffset.x - currentCameraOffset.x) * 0.04
    currentCameraOffset.y += (targetCameraOffset.y - currentCameraOffset.y) * 0.04

    camera.position.x = currentCameraOffset.x
    camera.position.y = currentCameraOffset.y

    renderer.render(scene, camera)
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

      disposables.forEach((obj) => {
        scene?.remove(obj)
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
          obj.geometry?.dispose()
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
          materials.forEach((m) => m?.dispose())
        }
      })
      disposables.length = 0

      renderer?.dispose()

      if (renderer?.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement)
      }

      container = null
      renderer = null
      camera = null
      scene = null
      clock = new THREE.Clock()
    }
  }
}
