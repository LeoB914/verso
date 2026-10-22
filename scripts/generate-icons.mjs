#!/usr/bin/env node
/* Generate the OpenLeaf application icons from resources/icon.svg.
 * Renders PNG sizes via a headless Electron page (Playwright), then:
 *   - macOS: iconutil → .icns
 *   - Windows: png2icons → .ico
 *   - Linux: PNG sizes directly
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { _electron } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build-icons')
mkdirSync(buildDir, { recursive: true })

const svg = (await import('node:fs')).readFileSync(join(root, 'resources', 'icon.svg'), 'utf8')
const SIZES = [16, 32, 64, 128, 256, 512, 1024]

// Render each size in a headless Electron page.
const app = await _electron.launch({ args: [join(root, 'out/main/index.js')] })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

for (const size of SIZES) {
  const html = `<!doctype html><html><body style="margin:0"><div id="c" style="width:${size}px;height:${size}px">${svg.replace('viewBox="0 0 512 512"', `viewBox="0 0 512 512" width="${size}" height="${size}"`)}</div></body></html>`
  const tmpHtml = join(tmpdir(), `icon-${size}.html`)
  writeFileSync(tmpHtml, html)
  await page.goto('file://' + tmpHtml)
  const buffer = await page.locator('#c').screenshot()
  writeFileSync(join(buildDir, `icon_${size}.png`), buffer)
}
await app.close()

// PNG build outputs for Linux.
const linuxDir = join(root, 'resources', 'icons')
mkdirSync(linuxDir, { recursive: true })
for (const size of [16, 32, 64, 128, 256, 512]) {
  writeFileSync(
    join(linuxDir, `${size}x${size}.png`),
    (await import('node:fs')).readFileSync(join(buildDir, `icon_${size}.png`))
  )
}

// macOS .icns via iconutil.
const iconset = join(buildDir, 'openleaf.iconset')
if (existsSync(iconset)) rmSync(iconset, { recursive: true })
mkdirSync(iconset, { recursive: true })
const mapping = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]
for (const [size, name] of mapping) {
  writeFileSync(
    join(iconset, name),
    (await import('node:fs')).readFileSync(join(buildDir, `icon_${size}.png`))
  )
}
execSync(`iconutil -c icns "${iconset}" -o "${join(root, 'resources', 'icon.icns')}"`)

// Windows .ico via png2icons.
const { createICNS, createICO } = await import('png2icons')
const png256 = (await import('node:fs')).readFileSync(join(buildDir, 'icon_256.png'))
const ico = createICO(png256, 0, 0, false, false)
writeFileSync(join(root, 'resources', 'icon.ico'), ico)

console.log('icons generated: resources/icon.icns, resources/icon.ico, resources/icons/*.png')
process.exit(0)
