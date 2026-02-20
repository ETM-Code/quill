import { spawn } from 'node:child_process'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4176
const BASE_URL = `http://${HOST}:${PORT}`
const ITERATIONS = Number(process.env.QUILL_PAINT_RUNS ?? 5)
const MAX_FCP_MEDIAN_MS = Number(process.env.QUILL_BUDGET_FCP_MEDIAN_MS ?? 500)
const MAX_RENDER_MEDIAN_MS = Number(process.env.QUILL_BUDGET_RENDER_MEDIAN_MS ?? 1200)

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

async function measurePaintAndRender(context) {
  await context.addInitScript(() => {
    window.openedFiles = ['/tmp/perf-render.md']
    window.__QUILL_TEST_FILE_CONTENTS__ = {
      '/tmp/perf-render.md': '# Render Perf Marker\n\nThis line confirms markdown content rendered.',
    }
  })

  const page = await context.newPage()
  const start = Date.now()
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })

  const fcpMs = await page.waitForFunction(() => {
    const entry = performance.getEntriesByName('first-contentful-paint')[0]
    return entry ? entry.startTime : null
  }, { timeout: 15_000 }).then((h) => h.jsonValue())

  await page.waitForFunction(() => {
    const text = document.querySelector('#editor')?.textContent ?? ''
    return text.includes('Render Perf Marker')
  }, { timeout: 15_000 })

  const renderMs = Date.now() - start
  return { fcpMs: Number(fcpMs), renderMs }
}

async function main() {
  const preview = startPreviewServer()
  const fcpSamples = []
  const renderSamples = []

  try {
    await waitForServer()
    const browser = await chromium.launch({ headless: true })
    try {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const context = await browser.newContext()
        const { fcpMs, renderMs } = await measurePaintAndRender(context)
        fcpSamples.push(fcpMs)
        renderSamples.push(renderMs)
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

  const fcpMedian = percentile(fcpSamples, 50)
  const renderMedian = percentile(renderSamples, 50)

  console.log(`FCP samples (ms): ${fcpSamples.map(v => v.toFixed(1)).join(', ')}`)
  console.log(`Render samples (ms): ${renderSamples.join(', ')}`)
  console.log(`FCP summary: median=${fcpMedian.toFixed(1)} p95=${percentile(fcpSamples, 95).toFixed(1)}`)
  console.log(`Render summary: median=${renderMedian} p95=${percentile(renderSamples, 95)}`)
  console.log(`Budgets: FCP median<=${MAX_FCP_MEDIAN_MS}ms render median<=${MAX_RENDER_MEDIAN_MS}ms`)

  if (fcpMedian > MAX_FCP_MEDIAN_MS || renderMedian > MAX_RENDER_MEDIAN_MS) {
    console.error('Paint/render performance budget failed.')
    process.exitCode = 1
    return
  }

  console.log('Paint/render performance budget passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
