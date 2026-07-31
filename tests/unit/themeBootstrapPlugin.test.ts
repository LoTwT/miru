import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { themeBootstrapPlugin } from '../../vite.config'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })))
})

describe('theme bootstrap Vite plugin', () => {
  it('rebundles and reloads when a bootstrap source changes during development', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'miru-theme-bootstrap-')))
    temporaryRoots.push(root)
    const themeDirectory = join(root, 'src/lib/theme')
    const entry = join(themeDirectory, 'readingThemeBootstrap.ts')
    const contract = join(themeDirectory, 'readingThemeContract.ts')
    const helper = join(themeDirectory, 'readingThemeHelper.ts')
    await mkdir(themeDirectory, { recursive: true })
    await writeFile(helper, 'export const themeName = "first"\n')
    await writeFile(contract, 'export { themeName } from "./readingThemeHelper"\n')
    await writeFile(
      entry,
      'import { themeName } from "./readingThemeContract"\ndocument.documentElement.dataset.themeTest = themeName\n',
    )

    const plugin = themeBootstrapPlugin()
    const resolveConfig = plugin.configResolved as unknown as (
      config: { root: string, command: 'serve' },
    ) => Promise<void>
    await resolveConfig({ root, command: 'serve' })

    const watched = new Set<string>()
    const configureServer = plugin.configureServer as unknown as (
      server: { watcher: { add: (files: string | string[]) => void } },
    ) => void
    configureServer({
      watcher: {
        add(files) {
          for (const file of Array.isArray(files) ? files : [files]) {
            watched.add(file)
          }
        },
      },
    })

    expect(watched).toEqual(new Set([entry, contract, helper]))

    const template = [
      '<meta content="__MIRU_THEME_BOOTSTRAP_CSP_HASH__">',
      '<script data-theme-bootstrap></script>',
    ].join('')
    const transformHtml = plugin.transformIndexHtml as unknown as (html: string) => string
    const initialHtml = transformHtml(template)
    expect(initialHtml).toContain('first')

    await writeFile(helper, 'export const themeName = "second"\n')
    const reloads: unknown[] = []
    const handleHotUpdate = plugin.handleHotUpdate as unknown as (
      context: {
        file: string
        server: {
          watcher: { add: (files: string | string[]) => void }
          ws: { send: (payload: unknown) => void }
        }
      },
    ) => Promise<unknown>
    await handleHotUpdate({
      file: helper,
      server: {
        watcher: {
          add(files) {
            for (const file of Array.isArray(files) ? files : [files]) {
              watched.add(file)
            }
          },
        },
        ws: {
          send: payload => reloads.push(payload),
        },
      },
    })

    const updatedHtml = transformHtml(template)
    expect(updatedHtml).toContain('second')
    expect(updatedHtml).not.toBe(initialHtml)
    expect(reloads).toContainEqual({ type: 'full-reload', path: '*' })

    const cspHash = updatedHtml.match(/sha256-[\w+/=]+/)?.[0]
    expect(cspHash).toBeTruthy()
    const headers = join(root, 'public/_headers')
    await mkdir(join(root, 'public'), { recursive: true })
    await writeFile(headers, `Content-Security-Policy: script-src '${cspHash}'\n`)

    const buildPlugin = themeBootstrapPlugin()
    const resolveBuildConfig = buildPlugin.configResolved as unknown as (
      config: { root: string, command: 'build' },
    ) => Promise<void>
    await resolveBuildConfig({ root, command: 'build' })
    const buildWatched = new Set<string>()
    const buildStart = buildPlugin.buildStart as unknown as (
      this: { addWatchFile: (file: string) => void },
    ) => Promise<void>
    await buildStart.call({
      addWatchFile: file => buildWatched.add(file),
    })

    expect(buildWatched).toEqual(new Set([entry, contract, helper, headers]))
  })
})
