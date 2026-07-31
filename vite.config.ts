import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { build as buildVite, defineConfig, normalizePath } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'

const themeBootstrapCspPlaceholder = '__MIRU_THEME_BOOTSTRAP_CSP_HASH__'
const themeBootstrapElement = '<script data-theme-bootstrap></script>'

export default defineConfig({
  plugins: [
    themeBootstrapPlugin(),
    tailwindcss(),
    vue(),
    VitePWA({
      injectRegister: 'script-defer',
      includeManifestIcons: false,
      manifest: {
        name: 'miru — 安静地阅读 Markdown',
        short_name: 'miru',
        description: 'miru 是浏览器内的 Markdown 阅读器:粘贴、拖入或打开 .md,把文字、代码、表格整理成一个安静、排版精良的阅读界面。100% 本地处理,不上传文档、不嵌入分析或追踪 —— 隐私是默认。',
        lang: 'zh-CN',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fcf6ea',
        theme_color: '#fcf6ea',
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,mjs,css,woff2,png}'],
        globIgnores: ['fonts/optional/**', '**/assets/pdf*.js', '**/assets/pdf*.mjs'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /^\/assets\/pdf(?:\.worker)?-[^/]+\.(?:js|mjs)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'miru-pdf-viewer-assets-v1',
              cacheableResponse: {
                statuses: [200],
              },
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5173,
  },
})

export function themeBootstrapPlugin(): Plugin {
  let script = ''
  let cspHash = ''
  let root = ''
  let command: 'build' | 'serve' = 'build'
  let bootstrapSourceFiles = new Set<string>()
  let headersFile = ''

  async function refreshBootstrap(validateHeaders: boolean): Promise<void> {
    const bundle = await bundleThemeBootstrap(root)
    script = bundle.script
    bootstrapSourceFiles = new Set(bundle.sourceFiles)
    cspHash = `sha256-${createHash('sha256').update(script).digest('base64')}`

    if (!validateHeaders) {
      return
    }

    const headers = readFileSync(headersFile, 'utf8')

    if (!headers.includes(`'${cspHash}'`)) {
      throw new Error(`public/_headers must allow the generated theme bootstrap with '${cspHash}'`)
    }
  }

  return {
    name: 'miru-theme-bootstrap',
    async configResolved(config) {
      root = config.root
      command = config.command
      headersFile = resolve(root, 'public/_headers')

      if (command === 'serve') {
        await refreshBootstrap(false)
      }
    },
    async buildStart() {
      if (command !== 'build') {
        return
      }

      await refreshBootstrap(true)

      for (const file of [...bootstrapSourceFiles, headersFile]) {
        this.addWatchFile(file)
      }
    },
    configureServer(server) {
      server.watcher.add([...bootstrapSourceFiles])
    },
    async handleHotUpdate(context) {
      if (!bootstrapSourceFiles.has(normalizeThemeBootstrapPath(context.file))) {
        return
      }

      await refreshBootstrap(false)
      context.server.watcher.add([...bootstrapSourceFiles])
      context.server.ws.send({ type: 'full-reload', path: '*' })
      return []
    },
    transformIndexHtml(html) {
      if (!html.includes(themeBootstrapCspPlaceholder) || !html.includes(themeBootstrapElement)) {
        throw new Error('index.html is missing the theme bootstrap CSP or script marker')
      }

      return html
        .replace(themeBootstrapCspPlaceholder, cspHash)
        .replace(themeBootstrapElement, `<script data-theme-bootstrap>${script}</script>`)
    },
  }
}

async function bundleThemeBootstrap(root: string): Promise<{
  script: string
  sourceFiles: string[]
}> {
  const sourceRoot = `${normalizeThemeBootstrapPath(resolve(root, 'src'))}/`
  const sourceFiles = new Set<string>()
  const buildResult = await buildVite({
    configFile: false,
    logLevel: 'silent',
    publicDir: false,
    plugins: [{
      name: 'miru-theme-bootstrap-dependency-collector',
      moduleParsed(moduleInfo) {
        if (moduleInfo.id.startsWith('\0')) {
          return
        }

        const moduleId = normalizeThemeBootstrapPath(moduleInfo.id.split('?')[0] ?? moduleInfo.id)
        if (moduleId.startsWith(sourceRoot)) {
          sourceFiles.add(moduleId)
        }
      },
    }],
    build: {
      emptyOutDir: false,
      minify: 'oxc',
      sourcemap: false,
      target: 'es2022',
      write: false,
      lib: {
        entry: resolve(root, 'src/lib/theme/readingThemeBootstrap.ts'),
        formats: ['iife'],
        name: 'MiruThemeBootstrap',
        fileName: 'theme-bootstrap',
      },
    },
  })
  const outputs = (Array.isArray(buildResult) ? buildResult : [buildResult])
    .flatMap(result => 'output' in result ? result.output : [])
  const chunks = outputs.filter(output => output.type === 'chunk')

  if (chunks.length !== 1) {
    throw new Error(`theme bootstrap build must emit exactly one JavaScript chunk, received ${chunks.length}`)
  }

  const script = chunks[0]?.code.trim() ?? ''

  if (!script || /<\/script/i.test(script)) {
    throw new Error('theme bootstrap build emitted empty or unsafe inline JavaScript')
  }

  if (sourceFiles.size === 0) {
    throw new Error('theme bootstrap build did not report any project source modules')
  }

  return { script, sourceFiles: [...sourceFiles] }
}

function normalizeThemeBootstrapPath(file: string): string {
  try {
    return normalizePath(realpathSync(file))
  }
  catch {
    return normalizePath(resolve(file))
  }
}
