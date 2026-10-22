import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard: no hard-coded hex colors in renderer code outside the token/theme
 * files (all colors must come from CSS custom properties).
 */

const ALLOWED_FILES = ['src/renderer/styles/main.css', 'src/renderer/editor/editor-themes.ts']

const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(tsx?|css)$/.test(entry)) yield full
  }
}

describe('no hard-coded colors', () => {
  it('renderer sources use design tokens only', () => {
    const offenders: string[] = []
    for (const file of walk('src/renderer')) {
      const normalized = file.replace(/\\/g, '/')
      if (ALLOWED_FILES.some((allowed) => normalized.endsWith(allowed))) continue
      const content = readFileSync(file, 'utf8')
      if (HEX_COLOR_RE.test(content)) offenders.push(normalized)
    }
    expect(offenders, `Hard-coded hex colors found in:\n${offenders.join('\n')}`).toEqual([])
  })
})
