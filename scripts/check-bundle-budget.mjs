import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const kibibyte = 1024
const entryScriptBudget = Object.freeze({
  raw: 185 * kibibyte,
  gzip: 64 * kibibyte,
})
const entryStyleBudget = Object.freeze({
  raw: 78 * kibibyte,
  gzip: 15 * kibibyte,
})

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const distDirectory = resolve(projectRoot, 'dist')
const indexPath = resolve(distDirectory, 'index.html')

if (!existsSync(indexPath)) {
  fail('dist/index.html 不存在；请先运行 `pnpm build`。')
}

const indexHtml = readFileSync(indexPath, 'utf8')
const entrySources = Array.from(indexHtml.matchAll(/<script\b([^>]*)>/gi))
  .map(match => match[1] ?? '')
  .filter(attributes => readAttribute(attributes, 'type') === 'module')
  .map(attributes => readAttribute(attributes, 'src'))
  .filter(source => source !== null)

if (entrySources.length !== 1) {
  fail(`期望 dist/index.html 中恰好有一个外部 module entry，实际找到 ${entrySources.length} 个。`)
}

const entrySource = entrySources[0]
if (!entrySource) {
  fail('module entry 缺少 src。')
}

const styleSources = Array.from(indexHtml.matchAll(/<link\b([^>]*)>/gi))
  .map(match => match[1] ?? '')
  .filter(attributes => (readAttribute(attributes, 'rel') ?? '').split(/\s+/).includes('stylesheet'))
  .map(attributes => readAttribute(attributes, 'href'))
  .filter(source => source !== null)

if (styleSources.length !== 1) {
  fail(`期望 dist/index.html 中恰好有一个入口样式，实际找到 ${styleSources.length} 个。`)
}

const styleSource = styleSources[0]
if (!styleSource) {
  fail('入口样式缺少 href。')
}

const assets = [
  resolveBudgetAsset('Entry script', entrySource, entryScriptBudget),
  resolveBudgetAsset('Entry style', styleSource, entryStyleBudget),
]

for (const asset of assets) {
  console.log(`${asset.label}: dist/${asset.pathFromDist}`)
  for (const result of asset.results) {
    const status = result.passed ? 'PASS' : 'FAIL'
    console.log(`  ${result.kind.padEnd(4)} ${formatSize(result.size)} / ${formatSize(result.limit)}  ${status}`)
  }
}

const failures = assets.flatMap(asset => asset.results
  .filter(result => !result.passed)
  .map(result => ({ ...result, label: asset.label })))
if (failures.length > 0) {
  const summary = failures
    .map(result => `${result.label} ${result.kind} 超出 ${formatSize(result.size - result.limit)}`)
    .join('，')
  fail(`入口包超过预算：${summary}。请拆分低频功能或有意调整预算并说明依据。`)
}

function resolveBudgetAsset(label, source, budget) {
  const assetUrl = new URL(source, 'https://miru.invalid/')
  const assetRelativePath = decodeURIComponent(assetUrl.pathname).replace(/^\/+/, '')
  const assetPath = resolve(distDirectory, assetRelativePath)
  const pathFromDist = relative(distDirectory, assetPath)

  if (pathFromDist === '..' || pathFromDist.startsWith(`..${sep}`) || resolve(assetPath) === distDirectory) {
    fail(`${label} 路径超出 dist：${source}`)
  }

  if (!existsSync(assetPath)) {
    fail(`${label} 不存在：dist/${pathFromDist}`)
  }

  const content = readFileSync(assetPath)
  const sizes = {
    raw: content.byteLength,
    gzip: gzipSync(content).byteLength,
  }
  const results = Object.entries(budget).map(([kind, limit]) => ({
    kind,
    limit,
    size: sizes[kind],
    passed: sizes[kind] <= limit,
  }))

  return { label, pathFromDist, results }
}

function readAttribute(attributes, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i')
  const match = pattern.exec(attributes)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

function formatSize(bytes) {
  return `${(bytes / kibibyte).toFixed(1)} KiB`
}

function fail(message) {
  console.error(`Bundle budget check failed: ${message}`)
  process.exit(1)
}
