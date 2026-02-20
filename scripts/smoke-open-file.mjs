import { spawn } from 'node:child_process'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4173
const BASE_URL = `http://${HOST}:${PORT}`

function startDevServer() {
  const child = spawn(
    'bunx',
    ['vite', '--host', HOST, '--port', String(PORT), '--strictPort'],
    {
      stdio: 'pipe',
      env: process.env,
    },
  )

  child.stdout.on('data', (buf) => process.stdout.write(`[vite] ${buf}`))
  child.stderr.on('data', (buf) => process.stderr.write(`[vite] ${buf}`))

  return child
}

async function waitForServer(timeoutMs = 20_000) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(BASE_URL)
      if (res.ok) {
        return
      }
    } catch {
      // retry
    }

    await delay(200)
  }

  throw new Error(`Vite dev server did not become ready within ${timeoutMs}ms`)
}

async function runSmoke() {
  const devServer = startDevServer()

  try {
    await waitForServer()

    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext()
      await context.addInitScript(() => {
        ;(window).openedFiles = ['/tmp/missing.md', '/tmp/smoke-ok.md']
        ;(window).__QUILL_TEST_FILE_CONTENTS__ = {
          '/tmp/smoke-ok.md': '# Smoke test document\n\nOpen path works.',
        }
      })

      const page = await context.newPage()
      await page.goto(`${BASE_URL}/?open=%2Ftmp%2Fignored.md`)

      await page.waitForFunction(() => {
        const name = document.querySelector('#filename')?.textContent?.trim()
        return name === 'smoke-ok.md'
      }, { timeout: 15_000 })

      const filename = await page.locator('#filename').textContent()
      if (filename?.trim() !== 'smoke-ok.md') {
        throw new Error(`Expected filename smoke-ok.md, got ${filename}`)
      }

      if (filename.trim() === 'untitled.md') {
        throw new Error('Editor stayed on untitled.md instead of opening a file')
      }

      const editorText = await page.locator('#editor').innerText()
      if (!editorText.includes('Smoke test document')) {
        throw new Error('Expected loaded file content in editor')
      }

      console.log('Smoke test passed: startup fallback opened smoke-ok.md')
    } finally {
      await browser.close()
    }
  } finally {
    devServer.kill('SIGTERM')
    await delay(300)
    if (!devServer.killed) {
      devServer.kill('SIGKILL')
    }
  }
}

runSmoke().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
