<template>
  <!-- 全屏 Banner 容器：Three.js 程序化场景将挂载到此 div 中 -->
  <div ref="container" class="banner-container" />
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const container = ref<HTMLDivElement | null>(null)

let sceneApi: Awaited<ReturnType<typeof import('~/banner/banner-scene').createBannerScene>> | null = null

onMounted(async () => {
  if (!container.value) return
  // 动态导入避免 SSR 时访问 WebGL API
  const { createBannerScene } = await import('~/banner/banner-scene')
  sceneApi = createBannerScene()
  sceneApi.mount(container.value)
})

onBeforeUnmount(() => {
  sceneApi?.destroy()
  sceneApi = null
})
</script>

<style scoped>
.banner-container {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #050505;
}

.banner-container canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
