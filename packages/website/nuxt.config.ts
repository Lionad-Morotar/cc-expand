export default defineNuxtConfig({
  ssr: false,
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      title: 'cc-expand',
      meta: [
        { name: 'description', content: 'Expand Claude Code context window beyond 200k tokens' }
      ]
    }
  },
  nitro: {
    preset: 'github-pages',
    prerender: {
      routes: ['/']
    }
  },
  compatibilityDate: '2026-06-13'
})
