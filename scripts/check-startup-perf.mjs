import { spawn } from 'node:child_process'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4175
const BASE_URL = `http://${HOST}:${PORT}`
const ITERATIONS = Number(process.env.QUILL_STARTUP_RUNS ?? 5)
const MAX_MEDIAN_MS = Number(process.env.QUILL_BUDGET_STARTUP_MEDIAN_MS ?? 1000)
const MAX_P95_MS = Number(process.env.QUILL_BUDGET_STARTUP_P95_MS ?? 1400)

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function startPreviewServer() {
  const child = spawn(
    'bunx',
    ['vite', 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'],
    { stdio: 'pipe', env: process.env },
  )

  child.stdout.on('data', (buf) => process.stdout.write(`[preview] ${buf}`))
  child.stderr.on('data', (buf) => process.stderr.write(`[preview] ${buf}`))
  return child
}

async function waitForServer(timeoutMs = 20_000) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(BASE_URL)
      if (res.ok) return
    } catch {
      // retry
    }
    await delay(200)
  }

  throw new Error(`Preview server did not become ready within ${timeoutMs}ms`)
}

async function measureStartup(page) {
  const start = Date.now()
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window).__QUILL_STARTUP_DONE__ === true, { timeout: 15_000 })
  return Date.now() - start
}

async function main() {
  const preview = startPreviewServer()
  const samples = []

  try {
    await waitForServer()
    const browser = await chromium.launch({ headless: true })
    try {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const context = await browser.newContext()
        const page = await context.newPage()
        const ms = await measureStartup(page)
        samples.push(ms)
        await context.close()
      }
    } finally {
      await browser.close()
    }
  } finally {
    preview.kill('SIGTERM')
    await delay(300)
    if (!preview.killed) {
      preview.kill('SIGKILL')
    }
  }

  const median = percentile(samples, 50)
  const p95 = percentile(samples, 95)
  const max = Math.max(...samples)
  const min = Math.min(...samples)

  console.log(`Startup samples (ms): ${samples.join(', ')}`)
  console.log(`Startup summary: min=${min} median=${median} p95=${p95} max=${max}`)
  console.log(`Budgets: median<=${MAX_MEDIAN_MS}ms p95<=${MAX_P95_MS}ms`)

  if (median > MAX_MEDIAN_MS || p95 > MAX_P95_MS) {
    console.error('Startup performance budget failed.')
    process.exitCode = 1
    return
  }

  console.log('Startup performance budget passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
