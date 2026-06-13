<template>
  <ClientOnly>
    <BannerBackground />
    <template #fallback>
      <!-- Banner 正在加载，使用与设计稿一致的深色占位，避免白闪 -->
      <div class="banner-placeholder" />
    </template>
  </ClientOnly>
</template>

<script setup lang="ts">
// 首页只负责挂载全屏 Banner 背景，不渲染任何 UI 覆盖层
</script>

<style scoped>
.banner-placeholder {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: #050505;
}
</style>
