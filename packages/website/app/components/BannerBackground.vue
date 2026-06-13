<template>
  <!-- 全屏 Banner 容器：底层是设计稿背景图，上层是 Three.js 动态光效 canvas -->
  <div ref="container" class="banner-container">
    <img
      src="/banner-bg.png"
      alt=""
      class="banner-image"
      draggable="false"
    />
    <div ref="overlay" class="banner-overlay" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const container = ref<HTMLDivElement | null>(null)
const overlay = ref<HTMLDivElement | null>(null)

let sceneApi: Awaited<ReturnType<typeof import('~/banner/banner-overlay').createBannerOverlay>> | null = null

onMounted(async () => {
  if (!overlay.value) return
  const { createBannerOverlay } = await import('~/banner/banner-overlay')
  sceneApi = createBannerOverlay()
  sceneApi.mount(overlay.value)
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

.banner-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}

.banner-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.banner-overlay canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
