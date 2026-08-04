import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const distDirectory = resolve(projectRoot, 'dist')

validateArtifacts()
runWranglerDryRun()
validateArtifacts()

console.log('Deployment contract: PASS')

function validateArtifacts() {
  const requiredFiles = [
    'index.html',
    '_headers',
    'manifest.webmanifest',
    'sw.js',
  ]

  for (const file of requiredFiles) {
    if (!existsSync(resolve(distDirectory, file))) {
      fail(`dist/${file} 不存在；请先运行 \`pnpm build\`。`)
    }
  }

  const headers = readFileSync(resolve(distDirectory, '_headers'), 'utf8')
  for (const header of [
    'Content-Security-Policy:',
    'Referrer-Policy: no-referrer',
    'X-Content-Type-Options: nosniff',
  ]) {
    if (!headers.includes(header)) {
      fail(`dist/_headers 缺少 ${header}`)
    }
  }

  const manifest = JSON.parse(readFileSync(resolve(distDirectory, 'manifest.webmanifest'), 'utf8'))
  for (const [field, expected] of Object.entries({
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  })) {
    if (manifest[field] !== expected) {
      fail(`manifest.webmanifest 的 ${field} 必须是 ${JSON.stringify(expected)}。`)
    }
  }

  const serviceWorker = readFileSync(resolve(distDirectory, 'sw.js'), 'utf8')
  for (const forbiddenPath of ['fonts/optional/', 'assets/pdf-', 'assets/pdf.worker-']) {
    if (serviceWorker.includes(forbiddenPath)) {
      fail(`service worker precache 不得包含 ${forbiddenPath}`)
    }
  }
}

function runWranglerDryRun() {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'miru-wrangler-dry-run-'))
  const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  let result

  try {
    result = spawnSync(
      pnpmExecutable,
      ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', outputDirectory],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: 'false',
        },
        stdio: 'inherit',
      },
    )
  }
  finally {
    rmSync(outputDirectory, { force: true, recursive: true })
  }

  if (result.error) {
    fail(`无法运行 Wrangler dry-run：${result.error.message}`)
  }

  if (result.status !== 0) {
    fail(`Wrangler dry-run 失败，退出码 ${result.status ?? 'unknown'}。`)
  }
}

function fail(message) {
  console.error(`Deployment contract check failed: ${message}`)
  process.exit(1)
}
