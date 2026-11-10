// Attribute minified bytes of a chunk to source packages via its sourcemap.
// Usage: node harness/sourcemap-breakdown.mjs <chunk.js> [topN]
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { SourceMapConsumer } = require('source-map-js')
const js = process.argv[2]
const code = readFileSync(js, 'utf8')
const map = JSON.parse(readFileSync(js + '.map', 'utf8'))
const lines = code.split('\n')
const c = new SourceMapConsumer(map)
const maps = []
c.eachMapping(m => maps.push(m))
maps.sort((a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn)
const bySrc = new Map()
for (let i = 0; i < maps.length; i++) {
  const m = maps[i], n = maps[i + 1]
  const lineLen = (lines[m.generatedLine - 1] ?? '').length
  const end = n && n.generatedLine === m.generatedLine ? n.generatedColumn : lineLen
  const len = Math.max(0, end - m.generatedColumn)
  const s = m.source ?? '(unmapped)'
  bySrc.set(s, (bySrc.get(s) ?? 0) + len)
}
const pkg = new Map()
for (const [s, b] of bySrc) {
  let k = s
  const i = s.lastIndexOf('node_modules/')
  if (i >= 0) {
    const rest = s.slice(i + 13).split('/')
    k = rest[0].startsWith('@') ? rest[0] + '/' + rest[1] : rest[0]
    if (k === '.bun') k = 'bun:' + rest.slice(1, 3).join('/')
  } else k = 'app-src'
  pkg.set(k, (pkg.get(k) ?? 0) + b)
}
const tot = [...pkg.values()].reduce((a, b) => a + b, 0)
console.log('total mapped bytes', tot)
for (const [k, v] of [...pkg].sort((a, b) => b[1] - a[1]).slice(0, +process.argv[3] || 30))
  console.log(String(v).padStart(8), ((v / tot) * 100).toFixed(1).padStart(5) + '%', k)
