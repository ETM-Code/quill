import { createGzip } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST_ASSETS_DIR = new URL('../dist/assets/', import.meta.url)

const BUDGETS = {
  jsRawBytes: Number(process.env.QUILL_BUDGET_JS_RAW ?? 1_800_000),
  cssRawBytes: Number(process.env.QUILL_BUDGET_CSS_RAW ?? 60_000),
  jsGzipBytes: Number(process.env.QUILL_BUDGET_JS_GZIP ?? 560_000),
  cssGzipBytes: Number(process.env.QUILL_BUDGET_CSS_GZIP ?? 12_500),
}

async function listFilesRecursively(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = new URL(entry.name, dirUrl)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function gzipSize(filePath) {
  return new Promise((resolve, reject) => {
    const gzip = createGzip({ level: 9 })
    let total = 0
    gzip.on('data', (chunk) => {
      total += chunk.length
    })
    gzip.on('end', () => resolve(total))
    gzip.on('error', reject)
    createReadStream(filePath).on('error', reject).pipe(gzip)
  })
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`
}

async function main() {
  const files = await listFilesRecursively(DIST_ASSETS_DIR)
  const jsFiles = files.filter((file) => extname(file.pathname) === '.js')
  const cssFiles = files.filter((file) => extname(file.pathname) === '.css')

  let jsRawBytes = 0
  let cssRawBytes = 0
  let jsGzipBytes = 0
  let cssGzipBytes = 0

  for (const file of jsFiles) {
    const fsPath = fileURLToPath(file)
    jsRawBytes += (await stat(file)).size
    jsGzipBytes += await gzipSize(fsPath)
  }

  for (const file of cssFiles) {
    const fsPath = fileURLToPath(file)
    cssRawBytes += (await stat(file)).size
    cssGzipBytes += await gzipSize(fsPath)
  }

  const checks = [
    ['jsRawBytes', jsRawBytes, BUDGETS.jsRawBytes],
    ['cssRawBytes', cssRawBytes, BUDGETS.cssRawBytes],
    ['jsGzipBytes', jsGzipBytes, BUDGETS.jsGzipBytes],
    ['cssGzipBytes', cssGzipBytes, BUDGETS.cssGzipBytes],
  ]

  console.log('Bundle size summary:')
  console.log(`- JS raw: ${formatBytes(jsRawBytes)} (budget ${formatBytes(BUDGETS.jsRawBytes)})`)
  console.log(`- CSS raw: ${formatBytes(cssRawBytes)} (budget ${formatBytes(BUDGETS.cssRawBytes)})`)
  console.log(`- JS gzip: ${formatBytes(jsGzipBytes)} (budget ${formatBytes(BUDGETS.jsGzipBytes)})`)
  console.log(`- CSS gzip: ${formatBytes(cssGzipBytes)} (budget ${formatBytes(BUDGETS.cssGzipBytes)})`)

  const failures = checks.filter(([, actual, budget]) => actual > budget)
  if (failures.length > 0) {
    for (const [name, actual, budget] of failures) {
      console.error(`Budget exceeded: ${name} actual=${actual} budget=${budget}`)
    }
    process.exitCode = 1
    return
  }

  console.log('Size budgets passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
